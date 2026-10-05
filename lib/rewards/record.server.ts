import { withBoundedCasRetry, type GuardStore, type GuardAtomicVersionedWrite } from "../guard/store.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { isServiceFeeIncome, type RyntraServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "./accrue.ts";
import { eligibleForRewards, rewardsActivation } from "./activation.ts";
import { ensureRewardAccount, readRewardAccount } from "./ledger.ts";
import { accrualRef, isParMint, REWARD_PAR_MINTS, rewardEntryKey, RewardEntrySchema, type RewardEntry } from "./model.ts";
import { referralLevelsAt, RewardAccountSchema, type RewardAccount } from "./referral.ts";
import { completeBenefitJob, enqueueBenefitJob } from "./benefit-jobs.ts";
import { readRankStanding, rewardRulesFor } from "./rank-store.ts";
import { rewardRulesOf, type RewardRank } from "./rules.ts";

type Price = Readonly<{ price: string; sourceRef: string; observedAt: string }>;
/** `rules` is absent for an accrual written under rules `1.0.0`, and it never changes after the first write. */
type RewardAccrualRecord = Readonly<{ version: number; trader: string; entries: readonly RewardEntry[]; valuationsComplete?: boolean; rules?: "2.0.0" }>;

/**
 * The one call a finished, fee-bearing operation makes.
 *
 * Everything difficult about rewards is in the modules under this one; this is
 * the order they run in and the promise that none of them can break a swap.
 *
 * ## Non-fatal, without exception
 *
 * A swap that moved somebody's money must never be reported as failed because a
 * reward row could not be written. Every path here returns a result rather than
 * throwing, and the callers ignore it. If a write is lost, the entitlement is
 * briefly missing and the next read of the same operation writes it under the
 * same key — which is the whole reason the key is the provider's own operation
 * reference rather than a timestamp or a counter.
 *
 * ## Why the price is read here and not in `accrue`
 *
 * `accrueRewards` is pure so the arithmetic can be checked against the owner's
 * worked examples without a network. The price is the one input that needs the
 * world, so it is fetched at this boundary and handed in. A price that does not
 * arrive is not an error: the reward is written with its exact share of the fee
 * asset and no dollar figure, and shows as Pending until it has one.
 */

export type RecordRewardsOutcome =
  | Readonly<{ state: "RECORDED"; created: number; existing: number; pending?: boolean }>
  | Readonly<{ state: "SKIPPED"; reason: string; retryable?: boolean }>;

/** Only fees a mechanism actually collected can produce a reward. */
function eligibleMechanism(fee: RyntraServiceFee): boolean {
  return fee.mechanism === "JUPITER_REFERRAL" || fee.mechanism === "JUPITER_PLATFORM_FEE" || fee.mechanism === "RELAY_APP_FEE";
}

async function recordRewardsCore(
  store: GuardStore,
  args: Readonly<{
    fee: RyntraServiceFee | null | undefined;
    trader: string;
    settledAt: string;
    now?: string;
    env?: NodeJS.ProcessEnv;
    /**
     * The provider's own dollar figure for the fee it took, where it states one.
     *
     * Relay does. Passing it makes the entitlement a share of a number the
     * provider measured on this fill, rather than of a price read afterwards.
     * Only ever a *paid* figure; a quote must never arrive here.
     */
    providerUsd?: number | null;
    price?: Price | null;
    jobReplay?: boolean;
    deps?: Readonly<{ readPrice?: (asset: string | null) => Promise<Price | null>; readDecimals?: (asset: string) => Promise<number | null> }>;
  }>,
): Promise<RecordRewardsOutcome> {
  const now = args.now ?? new Date().toISOString();
  try {
    let fee = args.fee;
    if (!fee) return { state: "SKIPPED", reason: "The operation carries no service fee." };
    if (!isServiceFeeIncome(fee)) {
      return { state: "SKIPPED", reason: `A ${fee.state} fee is not income.` };
    }
    if (!eligibleMechanism(fee)) {
      /* Mayan quotes a fee it cannot confirm collecting, and CCTP has no
         mechanism at all. Neither is money Ryntra can share. */
      return { state: "SKIPPED", reason: `${fee.mechanism} collection is not confirmable, so it accrues nothing.` };
    }
    const activation = rewardsActivation(args.env ?? process.env);
    if (!eligibleForRewards(args.settledAt, activation)) {
      return {
        state: "SKIPPED",
        reason: activation.state === "OPEN"
          ? "This operation settled before Rewards began."
          : activation.reason,
      };
    }

    const settlement = fee.settlement;
    if (!settlement?.operationRef) return { state: "SKIPPED", reason: "The fee has no stable settlement identity." };
    const ref = accrualRef(fee.mechanism, settlement.operationRef);
    const coordinator = store.versioned<RewardAccrualRecord>("rewardAccruals");
    const existingAccrual = await coordinator.get(ref);
    if (existingAccrual) {
      if (existingAccrual.trader !== args.trader) return { state: "SKIPPED", reason: "This fee already belongs to another trader." };
      if (existingAccrual.valuationsComplete || existingAccrual.entries.every(entry => entry.usdMicros !== null)) {
        return { state: "RECORDED", created: 0, existing: existingAccrual.entries.length };
      }
    }
    const asset = settlement?.asset ?? fee.asset;
    let decimals = settlement.decimals ?? fee.decimals;
    // Jupiter supplies the fee mint but may omit its display metadata. The
    // missing scale must be resolved, not mistaken for a fee that earned nothing.
    if (decimals === null && asset) {
      decimals = REWARD_PAR_MINTS[asset] ?? (asset === "So11111111111111111111111111111111111111112" ? 9 : await (args.deps?.readDecimals ?? readFeeDecimals)(asset));
    }
    if (decimals === null) return { state: "SKIPPED", reason: "The confirmed fee's token scale is not yet available." };
    const symbol = settlement.symbol ?? fee.symbol ?? (asset === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : asset === "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" ? "USDT" : asset === "So11111111111111111111111111111111111111112" ? "SOL" : null);
    fee = { ...fee, asset, decimals, symbol, settlement: { ...settlement, asset, decimals, symbol } };
    /* A price is only worth fetching when nothing better is available: the fee
       is not already dollars, and the provider did not measure it. */
    const stated = typeof args.providerUsd === "number" && args.providerUsd > 0;
    const settledAt = existingAccrual?.entries[0]?.source?.settledAt ?? args.settledAt;
    const candidate = args.price !== undefined ? args.price : !isParMint(asset, decimals) && !stated
      && (args.deps?.readPrice || Math.abs(Date.parse(now) - Date.parse(settledAt)) <= 5 * 60_000) ? await (args.deps?.readPrice ?? readPrice)(asset) : null;
    const price = candidate && Math.abs(Date.parse(candidate.observedAt) - Date.parse(settledAt)) <= 5 * 60_000 ? candidate : null;
    const resolvedFee = fee;
    /* The rules this operation is computed by: the ones its accrual was first
       written with, or — for a first write — the ones in force when it
       settled. Never the newest by default; see `rank-store.ts`. */
    const env = args.env ?? process.env;
    const rulesInForce = existingAccrual ? null : await rewardRulesFor(store, settledAt, now, env);
    /* The inviter's rank, read at most once per call however many times the
       write below retries. */
    const ranks = new Map<string, RewardRank>();
    return await withBoundedCasRetry<RecordRewardsOutcome>(async () => {
    const prior = await coordinator.get(ref);
    if (prior && prior.trader !== args.trader) return { state: "SKIPPED", reason: "This fee already belongs to another trader." };
    if (prior?.valuationsComplete || prior?.entries.every(entry => entry.usdMicros !== null)) return { state: "RECORDED", created: 0, existing: prior.entries.length };
    const account = await ensureRewardAccount(store, args.trader, now);
    const above = account.referrer ? await readRewardAccount(store, account.referrer) : null;
    const levels = prior ? { l1: prior.entries.find(entry => entry.type === "REFERRAL_L1")?.recipient ?? null, l2: prior.entries.find(entry => entry.type === "REFERRAL_L2")?.recipient ?? null } : referralLevelsAt(account, above, settledAt);
    const rules = prior ? rewardRulesOf(prior.rules) : rulesInForce ?? await rewardRulesFor(store, settledAt, now, env);
    /* The inviter's share follows the inviter's rank when the trade settled —
       frozen on the first write, so pricing a pending row later can never
       move it. A rank that cannot be read is not guessed: Bronze would freeze
       an underpayment for good, so the whole accrual waits for its retry. */
    let referrerL1Rank: RewardRank = "BRONZE";
    if (prior) referrerL1Rank = prior.entries.find(entry => entry.type === "REFERRAL_L1")?.rules?.rank ?? "BRONZE";
    else if (rules.base === "RECEIVED" && levels.l1) {
      const inviter = levels.l1;
      if (!ranks.has(inviter)) {
        try { ranks.set(inviter, (await readRankStanding(store, inviter, settledAt)).rank); }
        catch { return { state: "SKIPPED", reason: "The inviter's rank could not be read; the accrual waits for its retry.", retryable: true }; }
      }
      referrerL1Rank = ranks.get(inviter)!;
    }
    const accrual = accrueRewards({
      rules,
      referrerL1Rank,
      fee: resolvedFee,
      trader: args.trader,
      referrerL1: levels.l1,
      referrerL2: levels.l2,
      settledAt,
      now,
      price,
      providerUsd: args.providerUsd ?? null,
    });
    if (!accrual.ok) return { state: "SKIPPED", reason: accrual.reason };

    if (prior) {
      const writes: GuardAtomicVersionedWrite[] = [];
      for (const original of prior.entries.filter(entry => entry.usdMicros === null)) {
        const valued = accrual.entries.find(entry => entry.type === original.type && entry.recipient === original.recipient);
        if (!valued || valued.usdMicros === null) continue;
        if (valued.rateBps !== original.rateBps || valued.shareRaw !== original.shareRaw || valued.source?.asset !== original.source?.asset || valued.source?.decimals !== original.source?.decimals) {
          return { state: "SKIPPED", reason: "The recorded fee facts require an explicit correction." };
        }
        if (original.type !== "CASHBACK" && original.type !== "REFERRAL_L1" && original.type !== "REFERRAL_L2") continue;
        const originalKey = rewardEntryKey({ recipient: original.recipient, type: original.type, ref });
        const adjustment = RewardEntrySchema.parse({ ...original, type: "ADJUSTMENT", usdMicros: valued.usdMicros,
          valuation: valued.valuation, valuationOf: { key: originalKey, type: original.type }, createdAt: now, version: 0 });
        const key = rewardEntryKey({ recipient: original.recipient, type: "ADJUSTMENT", ref: `valuation:${ref}:${original.type}` });
        if (!await store.collection("rewardEntries").has(key)) writes.push({ collection: "rewardEntries", key, expectedVersion: null, next: { ...adjustment, version: 0 } });
      }
      if (!writes.length) return { state: "RECORDED", created: 0, existing: prior.entries.length, pending: true };
      const next: RewardAccrualRecord = { ...prior, version: prior.version + 1, valuationsComplete: true };
      const created = writes.length;
      writes.push({ collection: "rewardAccruals", key: ref, expectedVersion: prior.version, next });
      return await store.compareAndSetMany(writes) ? { state: "RECORDED", created, existing: prior.entries.length } : false;
    }

    const writes: GuardAtomicVersionedWrite[] = [];
    const accounts = new Map<string, RewardAccount>([[account.wallet, account]]);
    if (above) accounts.set(above.wallet, above);
    let created = 0;
    const canonicalEntries: RewardEntry[] = [];
    for (const entry of accrual.entries) {
      const parsed = RewardEntrySchema.parse({ ...entry, version: 0 });
      const key = rewardEntryKey({ recipient: parsed.recipient, type: parsed.type, ref });
      const existing = await store.collection<RewardEntry>("rewardEntries").get(key);
      canonicalEntries.push(existing ? RewardEntrySchema.parse(existing) : parsed);
      if (!existing) {
        writes.push({ collection: "rewardEntries", key, expectedVersion: null, next: { ...parsed, version: 0 } });
        created++;
      }
      if (!accounts.has(entry.recipient)) accounts.set(entry.recipient, await ensureRewardAccount(store, entry.recipient, now));
    }
    for (const owner of accounts.values()) {
      const earning = owner.earning || accrual.entries.some(entry => entry.recipient === owner.wallet);
      writes.push({ collection: "rewardAccounts", key: owner.wallet, expectedVersion: owner.version,
        next: RewardAccountSchema.parse({ ...owner, earning, version: owner.version + 1 }) });
    }
    const snapshot: RewardAccrualRecord = { version: 0, trader: args.trader, entries: canonicalEntries, ...(rules.version === "2.0.0" ? { rules: "2.0.0" as const } : {}) };
    writes.push({ collection: "rewardAccruals", key: ref, expectedVersion: null, next: snapshot });
    if (!await store.compareAndSetMany(writes)) return false;
    return { state: "RECORDED", created, existing: accrual.entries.length - created, pending: canonicalEntries.some(entry => entry.usdMicros === null) };
    });
  } catch (failure) {
    return { state: "SKIPPED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

async function readFeeDecimals(asset: string): Promise<number | null> {
  try {
    const mint = await readMintAccount(createSolanaRpcHandle({ network: "mainnet" }), asset);
    return mint.ok ? mint.decoded.decimals : null;
  } catch { return null; }
}

/** A durable retry exists before metadata or ledger work can fail. */
export async function recordOperationRewards(store: GuardStore, args: Parameters<typeof recordRewardsCore>[1]): Promise<RecordRewardsOutcome> {
  const now = args.now ?? new Date().toISOString();
  const fee = args.fee;
  const operationId = fee?.settlement?.operationRef;
  if (!fee || !operationId || !isServiceFeeIncome(fee) || !eligibleMechanism(fee)
    || !eligibleForRewards(args.settledAt, rewardsActivation(args.env ?? process.env))) return recordRewardsCore(store, args);
  try {
    if (!args.jobReplay) await enqueueBenefitJob(store, { kind: "REWARDS", wallet: args.trader, operationId: `${fee.mechanism}:${operationId}`,
      settledAt: args.settledAt, fee, providerUsd: args.providerUsd, ...(args.price !== undefined ? { price: args.price } : {}) }, now);
    const result = await recordRewardsCore(store, args);
    if (result.state === "RECORDED" && !result.pending) await completeBenefitJob(store, { wallet: args.trader, kind: "REWARDS", operationId: `${fee.mechanism}:${operationId}` });
    return result;
  } catch (cause) { return { state: "SKIPPED", reason: cause instanceof Error ? cause.message : "The bookkeeping job could not be stored.", retryable: true }; }
}

/**
 * A USD price for the fee asset, from the same catalog the rest of the product
 * prices with.
 *
 * Short timeout and a null on anything unexpected. This runs inside the tail of
 * a swap request that has already moved money, and a slow price feed must not
 * hold that response open — a Pending reward is a much better outcome than a
 * request that times out after the transfer succeeded.
 */
async function readPrice(
  asset: string | null,
): Promise<Readonly<{ price: string; sourceRef: string; observedAt: string }> | null> {
  if (!asset) return null;
  try {
    const catalog = await fetchTokenCatalog([asset], 2_500);
    if (!catalog.ok) return null;
    const entry = catalog.byMint[asset];
    if (!entry?.usdPrice) return null;
    return { price: entry.usdPrice, sourceRef: `${entry.source.ref}:price:${asset}`, observedAt: catalog.observedAt };
  } catch {
    return null;
  }
}
