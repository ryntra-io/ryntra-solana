import { withBoundedCasRetry, type GuardStore, type GuardAtomicVersionedWrite } from "../guard/store.ts";
import { fetchTokenCatalog } from "../solana/catalog.ts";
import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { isServiceFeeIncome, type RyntraServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "./accrue.ts";
import { eligibleForRewards, rewardsActivation } from "./activation.ts";
import { ensureRewardAccount, readRewardAccount } from "./ledger.ts";
import { accrualRef, isParMint, REWARD_PAR_MINTS, rewardEntryKey, rewardEntryRefOf, RewardEntrySchema, type RewardEntry } from "./model.ts";
import { nextEarningSince, referralLevelsAt, referrerAt, RewardAccountSchema, type RewardAccount } from "./referral.ts";
import { completeBenefitJob, enqueueBenefitJob } from "./benefit-jobs.ts";
import { readRankStanding, rewardRulesFor } from "./rank-store.ts";
import { hasWindows, rewardRulesOf, type RewardRank, storedVersion } from "./rules.ts";
import { FIRST_TEN_COLLECTION, FirstTenRecordSchema, inviterWindowOpen, planFirstTen, readFirstTen, type FirstTenPlan } from "./first-ten.ts";
import { internalWalletsForMoney, levelsWithoutInternal } from "./internal.ts";

type Price = Readonly<{ price: string; sourceRef: string; observedAt: string }>;
/** `rules` is absent for an accrual written under rules `1.0.0`, and it never changes after the first write. */
/** `internalInviter` — the inviter at settlement when it was an internal wallet (Ріст 3): it got no row, and a late
    valuation still knows there was an inviter, so the second level is paid as on a trade priced at once. */
type RewardAccrualRecord = Readonly<{ version: number; trader: string; entries: readonly RewardEntry[]; valuationsComplete?: boolean; rules?: "2.0.0" | "2.1.0" | "2.2.0"; internalInviter?: string }>;

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
    /* The owner's and the test wallets earn no money (`internal.ts`): an internal trader's operation writes nothing,
       an internal inviter's share stays with Ryntra. A list that cannot be read waits for the retry. A row written
       before this rule is still priced as it was — the past is not recomputed. */
    const env = args.env ?? process.env;
    const internal = await internalWalletsForMoney(store, env);
    if (!internal) return { state: "SKIPPED", reason: "The internal wallets could not be read; the accrual waits for its retry.", retryable: true };
    if (!existingAccrual && internal.has(args.trader)) return { state: "SKIPPED", reason: "An internal wallet's operation pays nobody.", retryable: false };
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
    const rulesInForce = existingAccrual ? null : await rewardRulesFor(store, settledAt, now, env);
    /* The inviter's rank, read at most once per call however many times the
       write below retries. */
    const ranks = new Map<string, RewardRank>();
    return await withBoundedCasRetry<RecordRewardsOutcome>(async () => {
    const prior = await coordinator.get(ref);
    if (prior && prior.trader !== args.trader) return { state: "SKIPPED", reason: "This fee already belongs to another trader." };
    if (prior?.valuationsComplete || prior?.entries.every(entry => entry.usdMicros !== null)) return { state: "RECORDED", created: 0, existing: prior.entries.length };
    const account = await ensureRewardAccount(store, args.trader, now);
    /* The inviter at settlement — the one before a change, for an operation
       that settled before it — and that inviter's own account for Level 2. */
    const inviterAtSettlement = referrerAt(account, settledAt);
    const above = inviterAtSettlement ? await readRewardAccount(store, inviterAtSettlement) : null;
    const levels = prior ? { l1: prior.entries.find(entry => entry.type === "REFERRAL_L1")?.recipient ?? null, l2: prior.entries.find(entry => entry.type === "REFERRAL_L2")?.recipient ?? null } : levelsWithoutInternal(referralLevelsAt(account, above, settledAt), internal);
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
    /* The windows of rules 2.1.0: read from the trader's record for a first write — and decided on its first trade —
       or, for a row priced later, kept exactly as first written. */
    let plan: FirstTenPlan | null = null;
    let window: Parameters<typeof accrueRewards>[0]["window"];
    if (hasWindows(rules)) {
      if (prior) {
        window = {
          firstTen: prior.entries.some(entry => entry.window === "FIRST_TEN") ? "FROZEN" : null,
          inviter: prior.entries.some(entry => entry.window === "INVITER_90"),
        };
      } else {
        plan = await planFirstTen(store, { trader: args.trader, settledAt, now, rules });
        window = plan.window;
      }
    }
    const accrual = accrueRewards({
      rules,
      window,
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
      /*
       * «First $10 back» priced late — the same split as a trade priced at once: of a fee worth B, the part w that
       * reaches the cap comes back whole, the rest of the fee pays as an ordinary trade. The trader's half row already
       * holds half of all of B, so the rest due is w + (B − w) / 2 − half; the inviters get their shares of B − w in
       * rows of their own; what came back grows by w. A window cancelled meanwhile still has its rest valued — taken
       * back by a row of its own, so an appeal that wins gives back all of it. One atomic write with the counters.
       */
      const welcome = hasWindows(rules) && prior.entries.some(entry => entry.window === "FIRST_TEN") ? await readFirstTen(store, args.trader) : null;
      const valuedOf = (original: RewardEntry) => accrual.entries.find(entry => entry.type === original.type && entry.recipient === original.recipient && (entry.window ?? null) === (original.window ?? null));
      const halfRow = prior.entries.find(entry => entry.window === "FIRST_TEN" && entry.type === "CASHBACK" && entry.usdMicros === null);
      const restRow = prior.entries.find(entry => entry.window === "FIRST_TEN_REST" && entry.usdMicros === null);
      const halfFound = halfRow ? valuedOf(halfRow) : undefined;
      /* A rest worth less than a micro-dollar has no row in the recomputation: it is due nothing, never left pending. */
      const restFound = restRow ? valuedOf(restRow) ?? (halfFound?.usdMicros != null ? { ...restRow, usdMicros: "0", valuation: halfFound.valuation } : undefined) : undefined;
      let restDue: bigint | null = null;
      let returned = 0n;
      const after: RewardEntry[] = [];
      if (welcome?.window && rules.firstTen && halfFound?.usdMicros != null && restFound?.usdMicros != null && restRow) {
        const half = BigInt(halfFound.usdMicros);
        const restFull = BigInt(restFound.usdMicros);
        const whole = half + restFull;
        const room = rules.firstTen.capUsdMicros - BigInt(welcome.window.returnedUsdMicros);
        const inside = whole <= room ? whole : room > 0n ? room : 0n;
        const due = inside + (whole - inside) / 2n - half;
        restDue = due < 0n ? 0n : due > restFull ? restFull : due;
        returned = inside;
        if (inside < whole) {
          /* The ordinary part's shares: the inviter's (the 90 days' unless the window was cancelled, else the rank's) and the second level's. */
          const baseRaw = BigInt(halfRow!.rules?.baseRaw ?? "0");
          const afterRaw = baseRaw - (whole > 0n ? (baseRaw * inside) / whole : 0n);
          const afterUsd = whole - inside;
          const zero = prior.entries.find(entry => entry.type === "REFERRAL_L1" && entry.window === "FIRST_TEN");
          const fresh = levelsWithoutInternal(referralLevelsAt(account, above, settledAt), internal);
          /* The inviter at the trade, as the first write saw it: its zero row — or, for an internal inviter that got no
             row (Ріст 3), the record's note of it. Neither means no inviter at the first write: nothing for the second
             level, as before — whatever the graph says now. */
          const inviterThen = zero?.recipient ?? prior.internalInviter ?? null;
          const inviterBps = welcome.window.check !== "FAILED" && inviterWindowOpen(welcome, settledAt, rules)
            ? rules.inviterWindow!.bps
            : rules.referralL1BpsByRank[zero?.rules?.rank ?? "BRONZE"];
          const share = (type: "REFERRAL_L1" | "REFERRAL_L2", recipient: string, rateBps: number) => {
            const usdMicros = (afterUsd * BigInt(rateBps)) / 10_000n;
            if (usdMicros === 0n) return;
            after.push(RewardEntrySchema.parse({
              version: 0, type, recipient, rateBps,
              shareRaw: ((afterRaw * BigInt(rateBps)) / 10_000n).toString(),
              usdMicros: usdMicros.toString(),
              valuation: halfFound.valuation, source: halfRow!.source, createdAt: now, claimId: null, signature: null,
              rules: { version: storedVersion(rules), base: "RECEIVED", baseRaw: afterRaw.toString(), rank: type === "REFERRAL_L1" ? zero?.rules?.rank ?? null : null },
              fundedBy: "fee", window: "FIRST_TEN_AFTER",
            }));
          };
          if (zero && zero.recipient !== args.trader && !internal.has(zero.recipient)) share("REFERRAL_L1", zero.recipient, inviterBps);
          if (inviterThen && fresh.l2 && fresh.l2 !== args.trader && fresh.l2 !== inviterThen) share("REFERRAL_L2", fresh.l2, rules.referralL2Bps);
        }
      }
      for (const original of prior.entries.filter(entry => entry.usdMicros === null)) {
        const found = original === restRow ? restFound : valuedOf(original);
        if (!found || found.usdMicros === null) continue;
        let valued = found;
        if (original.window === "FIRST_TEN_REST") {
          /* A rest whose due could not be measured (its window's record unreadable, its half valued apart) is never
             valued at nothing: the valuation waits for its retry. */
          if (restDue === null) return { state: "SKIPPED", reason: "The rest of a First $10 back trade could not be measured against the cap yet.", retryable: true };
          valued = { ...found, usdMicros: restDue.toString() };
        }
        if (valued.rateBps !== original.rateBps || valued.shareRaw !== original.shareRaw || valued.source?.asset !== original.source?.asset || valued.source?.decimals !== original.source?.decimals) {
          return { state: "SKIPPED", reason: "The recorded fee facts require an explicit correction." };
        }
        if (original.type !== "CASHBACK" && original.type !== "REFERRAL_L1" && original.type !== "REFERRAL_L2") continue;
        const originalKey = rewardEntryKey({ recipient: original.recipient, type: original.type, ref: rewardEntryRefOf(original, ref) });
        const adjustment = RewardEntrySchema.parse({ ...original, type: "ADJUSTMENT", usdMicros: valued.usdMicros,
          valuation: valued.valuation, valuationOf: { key: originalKey, type: original.type }, createdAt: now, version: 0 });
        const key = rewardEntryKey({ recipient: original.recipient, type: "ADJUSTMENT", ref: `valuation:${rewardEntryRefOf(original, ref)}:${original.type}` });
        if (!await store.collection("rewardEntries").has(key)) writes.push({ collection: "rewardEntries", key, expectedVersion: null, next: { ...adjustment, version: 0 } });
      }
      if (!writes.length) return { state: "RECORDED", created: 0, existing: prior.entries.length, pending: true };
      for (const entry of after) {
        writes.push({ collection: "rewardEntries", key: rewardEntryKey({ recipient: entry.recipient, type: entry.type, ref: rewardEntryRefOf(entry, ref) }), expectedVersion: null, next: { ...entry, version: 0 } });
      }
      if (welcome?.window && restDue !== null && restDue > 0n && welcome.window.check === "FAILED") {
        writes.push({ collection: "rewardEntries", key: rewardEntryKey({ recipient: args.trader, type: "ADJUSTMENT", ref: `first-ten:void:${ref}` }), expectedVersion: null,
          next: { ...RewardEntrySchema.parse({ version: 0, type: "ADJUSTMENT", recipient: args.trader, rateBps: 0, shareRaw: null, usdMicros: (-restDue).toString(),
            valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "first-ten", observedAt: now }, source: null, createdAt: now, claimId: null, signature: null, fundedBy: "fee", window: "FIRST_TEN_VOID" }), version: 0 } });
      }
      const next: RewardAccrualRecord = { ...prior, version: prior.version + 1, valuationsComplete: true };
      const created = writes.length;
      writes.push({ collection: "rewardAccruals", key: ref, expectedVersion: prior.version, next });
      if (welcome?.window && (returned > 0n || (restDue ?? 0n) > 0n)) {
        const window = { ...welcome.window, returnedUsdMicros: (BigInt(welcome.window.returnedUsdMicros) + returned).toString(), restUsdMicros: (BigInt(welcome.window.restUsdMicros) + (restDue ?? 0n)).toString() };
        writes.push({ collection: FIRST_TEN_COLLECTION, key: args.trader, expectedVersion: welcome.version, next: FirstTenRecordSchema.parse({ ...welcome, window, version: welcome.version + 1 }) });
      }
      return await store.compareAndSetMany(writes) ? { state: "RECORDED", created, existing: prior.entries.length } : false;
    }

    const writes: GuardAtomicVersionedWrite[] = [];
    const accounts = new Map<string, RewardAccount>([[account.wallet, account]]);
    if (above) accounts.set(above.wallet, above);
    let created = 0;
    const canonicalEntries: RewardEntry[] = [];
    for (const entry of accrual.entries) {
      const parsed = RewardEntrySchema.parse({ ...entry, version: 0 });
      const key = rewardEntryKey({ recipient: parsed.recipient, type: parsed.type, ref: rewardEntryRefOf(parsed, ref) });
      const existing = await store.collection<RewardEntry>("rewardEntries").get(key);
      canonicalEntries.push(existing ? RewardEntrySchema.parse(existing) : parsed);
      if (!existing) {
        writes.push({ collection: "rewardEntries", key, expectedVersion: null, next: { ...parsed, version: 0 } });
        created++;
      }
      if (!accounts.has(entry.recipient)) accounts.set(entry.recipient, await ensureRewardAccount(store, entry.recipient, now));
    }
    for (const owner of accounts.values()) {
      /* A row of nothing — the inviter's inside «First $10 back» — is no earning. */
      const earnsNow = accrual.entries.some(entry => entry.recipient === owner.wallet && entry.shareRaw !== "0");
      const earning = owner.earning || earnsNow;
      /* The first earning dates the seven days in which an inviter can still
         be added, measured from the trade rather than from this write. */
      const earningSince = nextEarningSince(owner, earnsNow, settledAt);
      writes.push({ collection: "rewardAccounts", key: owner.wallet, expectedVersion: owner.version,
        next: RewardAccountSchema.parse({ ...owner, earning, earningSince, version: owner.version + 1 }) });
    }
    const inviterAtFirst = referralLevelsAt(account, above, settledAt).l1;
    const snapshot: RewardAccrualRecord = { version: 0, trader: args.trader, entries: canonicalEntries, ...(rules.version !== "1.0.0" ? { rules: rules.version } : {}),
      ...(inviterAtFirst && internal.has(inviterAtFirst) ? { internalInviter: inviterAtFirst } : {}) };
    writes.push({ collection: "rewardAccruals", key: ref, expectedVersion: null, next: snapshot });
    if (plan) writes.push(...plan.writes(accrual.firstTen));
    if (!await store.compareAndSetMany(writes)) return false;
    /* A window waiting for its check: the check is queued — again on each window trade, so a lost write is mended. */
    if (plan?.queueCheck) await enqueueBenefitJob(store, { kind: "FIRST_TEN_CHECK", wallet: args.trader, operationId: "first-ten", settledAt }, now).catch(() => undefined);
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
    if ((result.state === "RECORDED" && !result.pending) || (result.state === "SKIPPED" && result.retryable === false)) await completeBenefitJob(store, { wallet: args.trader, kind: "REWARDS", operationId: `${fee.mechanism}:${operationId}` });
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
