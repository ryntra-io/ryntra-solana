import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import { withBoundedCasRetry, type GuardStore, type GuardAtomicVersionedWrite } from "../guard/store.ts";
import { ensureRewardAccount, readRewardAccount } from "../rewards/ledger.ts";
import { referralLevelsAt, RewardAccountSchema, type RewardAccount } from "../rewards/referral.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { accruePoints, eligibleVolume, type PointsStatedUsd } from "./accrue.ts";
import { listPointsDay, listPointsEntries } from "./ledger.ts";
import { pointsEntryKey, pointsEventId, PointsEntrySchema, utcDayOf, type PointsEntry } from "./model.ts";
import { completeBenefitJob, enqueueBenefitJob } from "../rewards/benefit-jobs.ts";

/**
 * The one call a settled operation makes to earn points.
 *
 * Sits beside `recordOperationRewards` in the three settlement paths — the
 * Solana swap execute, the cross-chain status read and the cross-chain
 * receipt — and shares its contract: **non-fatal, without exception.** A swap
 * that moved somebody's money must never be reported as failed because a
 * points row could not be written. Every path returns a result rather than
 * throwing, the callers ignore it, and a lost write is repaired by the next
 * read of the same settlement, which writes the same keys.
 *
 * ## What is read before the arithmetic
 *
 * - the internal list, so the owner's test wallets earn nothing at the source
 *   as well as being left out of every rank;
 * - the trader's rows for the settlement day, which decide the tier;
 * - the trader's rows ever, which decide whether this is a first active day;
 * - the inviter, from the rewards ledger's referral graph — one graph, not a
 *   second one — and whether the inviter already earned the bonus for this
 *   person.
 *
 * No price is fetched. Eligible volume is par, the provider's own figure, or
 * unvalued; a network read inside the tail of a request that has already
 * moved money is a cost the Points ledger does not need to add.
 */

export type RecordPointsOutcome =
  | Readonly<{ state: "RECORDED"; created: number; existing: number; points: string; pending?: boolean }>
  | Readonly<{ state: "SKIPPED"; reason: string; retryable?: boolean }>;

async function recordPointsCore(
  store: GuardStore,
  args: Readonly<{
    action: SolanaWalletAction;
    /** The provider's own dollar figure for the leg that left, where it states one. Never a quote of another amount. */
    statedUsd?: PointsStatedUsd | null;
    settledAt: string;
    now?: string;
    env?: NodeJS.ProcessEnv;
    jobReplay?: boolean;
  }>,
): Promise<RecordPointsOutcome> {
  const now = args.now ?? new Date().toISOString();
  try {
    const { action } = args;
    if (action.outcome !== "DONE") return { state: "SKIPPED", reason: `A ${action.outcome} operation earns nothing.` };
    if (action.lane !== "SWAP" && action.lane !== "CROSS_SWAP") {
      return { state: "SKIPPED", reason: `The ${action.lane} lane earns nothing.` };
    }
    const internal = await resolveInternalWallets(store, args.env ?? process.env);
    if (internal.wallets.has(action.wallet)) return { state: "SKIPPED", reason: "An internal wallet earns nothing.", retryable: false };
    if (internal.store !== "measured") return { state: "SKIPPED", reason: "The internal-wallet exclusions could not be verified." };

    return await withBoundedCasRetry<RecordPointsOutcome>(async () => {
    const identities = store.versioned<{ version: number; day?: string; entries?: readonly PointsEntry[]; valued?: boolean }>("pointsAccruals");
    const operationKey = `operation:${action.wallet}:${action.actionId}`;
    const prior = await identities.get(operationKey);
    const priorUnvalued = prior?.valued === false;
    if (prior && !priorUnvalued) return { state: "RECORDED", created: 0, existing: prior.entries?.length ?? 0, points: "0" };
    const volume = eligibleVolume(action, args.statedUsd ?? null);
    if (priorUnvalued && volume.usdMicros === null) return { state: "RECORDED", created: 0, existing: prior.entries?.length ?? 0, points: "0", pending: true };

    const walletEntries = await listPointsEntries(store, action.wallet);
    const legacy = walletEntries.find(entry => entry.reason === "TRADE_VOLUME" && entry.source?.actionId === action.actionId);
    const original = prior?.entries?.find(entry => entry.reason === "TRADE_VOLUME") ?? legacy;
    const settledAt = original?.source?.settledAt ?? args.settledAt;
    const day = original?.day ?? utcDayOf(settledAt);
    const revaluing = original?.source?.valuation.basis === "UNVALUED" && volume.usdMicros !== null;
    const dayKey = `day:${action.wallet}:${day}`;
    // Read the fence before the ledger. The atomic write below retries if any
    // other operation changed this day's rows while they were being read.
    const fence = await identities.get(dayKey);
    const account = await ensureRewardAccount(store, action.wallet, now);
    const above = account.referrer ? await readRewardAccount(store, account.referrer) : null;
    const levels = referralLevelsAt(account, above, settledAt);
    const dayEntries = await listPointsDay(store, action.wallet, day);
    /* The inviter is a customer too: an internal inviter earns nothing. */
    const referrerL1 = levels.l1 && !internal.wallets.has(levels.l1) ? levels.l1 : null;
    const referrerAlreadyQualified = referrerL1
      ? (await listPointsEntries(store, referrerL1)).some(
          (entry) => entry.reason === "QUALIFIED_REFERRAL" && entry.source?.trader === action.wallet,
        )
      : false;

    const accrual = accruePoints({
      action,
      statedUsd: args.statedUsd ?? null,
      internal: false,
      dayEntries: legacy ? dayEntries.filter(entry => entry.eventId !== legacy.eventId) : dayEntries,
      priorActiveDays: walletEntries.filter((entry) => entry.reason === "ACTIVE_DAY").length,
      referrerL1,
      referrerAlreadyQualified,
      settledAt,
      now,
    });
    if (!accrual.ok) return { state: "SKIPPED", reason: accrual.reason, retryable: false };

    const collection = store.collection<PointsEntry>("pointsEntries");
    const created: PointsEntry[] = [];
    const writes: GuardAtomicVersionedWrite[] = [];
    for (const entry of accrual.entries) {
      const adjusted = revaluing && entry.reason === "TRADE_VOLUME" ? { ...entry, reason: "ADJUSTMENT", eventId: pointsEventId("ADJUSTMENT", `valuation:${action.actionId}`), valuationOf: original!.eventId } : entry;
      const parsed = PointsEntrySchema.parse({ ...adjusted, version: 0 });
      const ref = parsed.eventId.slice(parsed.reason.length + 1);
      const key = pointsEntryKey({ wallet: parsed.wallet, day: parsed.day, reason: parsed.reason, ref });
      if (await collection.has(key)) continue;
      if (parsed.reason === "QUALIFIED_REFERRAL") {
        const qualificationKey = `qualified:${parsed.wallet}:${action.wallet}`;
        if (await identities.has(qualificationKey)) continue;
        writes.push({ collection: "pointsAccruals", key: qualificationKey, expectedVersion: null, next: { version: 0 } });
      }
      writes.push({ collection: "pointsEntries", key, expectedVersion: null, next: { ...parsed, version: 0 } });
      created.push(parsed);
    }
    writes.push({ collection: "pointsAccruals", key: dayKey, expectedVersion: fence?.version ?? null, next: { version: (fence?.version ?? -1) + 1 } });
    const accounts = new Map<string, RewardAccount>([[account.wallet, account]]);
    if (above) accounts.set(above.wallet, above);
    for (const owner of accounts.values()) {
      const earning = owner.earning || created.some(entry => entry.wallet === owner.wallet && BigInt(entry.points) > 0n);
      writes.push({ collection: "rewardAccounts", key: owner.wallet, expectedVersion: owner.version,
        next: RewardAccountSchema.parse({ ...owner, earning, version: owner.version + 1 }) });
    }
    writes.push({ collection: "pointsAccruals", key: operationKey, expectedVersion: prior?.version ?? null,
      next: { version: (prior?.version ?? -1) + 1, day, entries: prior?.entries ?? accrual.entries, valued: volume.usdMicros !== null } as { version: number } });
    if (!await store.compareAndSetMany(writes)) return false;
    const points = created.reduce((sum, entry) => sum + BigInt(entry.points), 0n);
    return { state: "RECORDED", created: created.length, existing: accrual.entries.length - created.length, points: points.toString(), pending: volume.usdMicros === null };
    });
  } catch (failure) {
    return { state: "SKIPPED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

export async function recordOperationPoints(store: GuardStore, args: Parameters<typeof recordPointsCore>[1]): Promise<RecordPointsOutcome> {
  const now = args.now ?? new Date().toISOString();
  const { action } = args;
  if (action.outcome !== "DONE" || (action.lane !== "SWAP" && action.lane !== "CROSS_SWAP")) return recordPointsCore(store, args);
  try {
    if (!args.jobReplay) await enqueueBenefitJob(store, { kind: "POINTS", wallet: action.wallet, operationId: action.actionId,
      settledAt: args.settledAt, action, statedUsd: args.statedUsd }, now);
    const result = await recordPointsCore(store, args);
    if ((result.state === "RECORDED" && !result.pending) || (result.state === "SKIPPED" && result.retryable === false)) {
      await completeBenefitJob(store, { wallet: action.wallet, kind: "POINTS", operationId: action.actionId });
    }
    return result;
  } catch (cause) { return { state: "SKIPPED", reason: cause instanceof Error ? cause.message : "The bookkeeping job could not be stored.", retryable: true }; }
}
