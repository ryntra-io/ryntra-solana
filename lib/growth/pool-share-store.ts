import type { GuardStore } from "../guard/store.ts";
import type { RewardEntry } from "../rewards/model.ts";
import {
  POOL_SHARE_COLLECTION,
  PoolShareRowSchema,
  SOLANA_CHAIN,
  launchConfigPlans,
  poolShareContent,
  poolShareKey,
  poolSharePrefix,
  poolShareTotals,
  pooledClaimPrefix,
  type PoolShareNetwork,
  type PoolShareRow,
  type PoolShareStream1,
  type PoolShareTotals,
  type RegistryRowLike,
  type Stream1PendingCount,
} from "./pool-share.ts";

/**
 * The pool-share journal in `guard_objects`: append, read, and the stream-1 rows.
 *
 * Every write is `insertIfAbsent` under the row's own key, so a second read of
 * the same claim — the next run, a retry after a crash halfway — writes
 * nothing. A row is never updated or deleted. A second read that finds a
 * *different* row under the same key writes nothing either, and is reported as
 * a conflict for a person to look at.
 *
 * The stream-1 rows are read from what the rewards core already wrote — its
 * accruals of `METEORA_LAUNCH` fees and the launch trade each belongs to — and
 * nothing of the core is changed. On 2026-10-13 the rewards rules count no
 * `METEORA_LAUNCH` fee yet (`eligibleMechanism` in `lib/rewards/record.server.ts`),
 * so there are none; the rows appear on their own once the rules count it.
 */

/** The rewards core's per-operation accrual — read only. */
type RewardAccrualRecord = Readonly<{ version: number; trader: string; entries: readonly RewardEntry[]; valuationsComplete?: boolean }>;

/** The launch trade a launch fee belongs to — read only; only the fields read here. */
type LaunchTradeRow = Readonly<{ cluster: string; signature: string; wallet: string; venue: "curve" | "pool"; curve: string; config: string; state: string; settledAt?: string | null }>;

const LAUNCH_MECHANISM = "METEORA_LAUNCH";
const STREAM1_TYPES = new Set(["CASHBACK", "REFERRAL_L1", "REFERRAL_L2"]);

export type AppendOutcome = Readonly<{
  created: number;
  existing: number;
  /** Refused by the schema — never written. */
  refused: readonly Readonly<{ reason: string }>[];
  /** A different row already stands under the same key; the stored one is kept. */
  conflicts: readonly Readonly<{ key: string }>[];
}>;

/** Write rows the journal does not have yet. */
export async function appendPoolShareRows(store: GuardStore, rows: readonly PoolShareRow[]): Promise<AppendOutcome> {
  const collection = store.collection<PoolShareRow>(POOL_SHARE_COLLECTION);
  let created = 0;
  let existing = 0;
  const refused: Array<{ reason: string }> = [];
  const conflicts: Array<{ key: string }> = [];
  for (const row of rows) {
    const parsed = PoolShareRowSchema.safeParse(row);
    if (!parsed.success) {
      refused.push({ reason: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
      continue;
    }
    const key = poolShareKey(parsed.data);
    if (await collection.insertIfAbsent(key, parsed.data)) {
      created += 1;
      continue;
    }
    existing += 1;
    const stored = await collection.get(key);
    if (stored && poolShareContent(stored) !== poolShareContent(parsed.data)) conflicts.push({ key });
  }
  return { created, existing, refused, conflicts };
}

/** Every row of the journal, or every row that credits one pool (its own and its part of split claims). */
export async function readPoolShareRows(store: GuardStore, scope?: Readonly<{ network: PoolShareNetwork; pool: string }>): Promise<PoolShareRow[]> {
  const collection = store.collection<PoolShareRow>(POOL_SHARE_COLLECTION);
  if (!scope) return (await collection.valuesWithPrefix("")).map((row) => PoolShareRowSchema.parse(row));
  const own = await collection.valuesWithPrefix(poolSharePrefix(scope.network, scope.pool));
  const split = (await collection.valuesWithPrefix(pooledClaimPrefix(scope.network))).filter((row) => row.kind === "CLAIM" && row.allocation?.some((slice) => slice.pool === scope.pool));
  return [...own, ...split].map((row) => PoolShareRowSchema.parse(row));
}

export type Stream1Pending = Readonly<{ operationRef: string; pool: string | null; reason: string }>;

export type Stream1Read = Readonly<{
  rows: readonly PoolShareStream1[];
  /** Operations that belong to a counted pool (or may) and cannot be written yet. */
  pending: readonly Stream1Pending[];
  /** Operations of the demo market, an uncounted config or devnet — never stream 1 of a counted pool. */
  excluded: number;
}>;

/**
 * The stream-1 rows the journal should hold: one per launch-fee accrual whose
 * mainnet trade is on a counted config and whose every entry has a dollar
 * figure. An unvalued entry keeps its operation pending — the row is written
 * once, so it is written whole — and the totals show that pool's stream 1 as
 * "no data" meanwhile. The core's later valuation is an `ADJUSTMENT` beside the
 * original entry, and it is read here.
 */
export async function readStream1(store: GuardStore, args: Readonly<{ registry: readonly RegistryRowLike[]; now?: string }>): Promise<Stream1Read> {
  const now = args.now ?? new Date().toISOString();
  const counted = launchConfigPlans(args.registry).counted;
  const accruals = await store.collection<RewardAccrualRecord>("rewardAccruals").valuesWithPrefix(`${LAUNCH_MECHANISM}:`);
  const entries = store.collection<RewardEntry>("rewardEntries");
  const trades = store.collection<LaunchTradeRow>("launchTradeRecords");
  const rows: PoolShareStream1[] = [];
  const pending: Stream1Pending[] = [];
  let excluded = 0;
  for (const accrual of accruals) {
    const operationRef = accrual.entries.find((entry) => entry.source?.operationRef)?.source?.operationRef;
    if (!operationRef) continue;
    const trade = await trades.get(`mainnet:${operationRef}`);
    if (!trade) {
      if (await trades.has(`devnet:${operationRef}`)) excluded += 1;
      else pending.push({ operationRef, pool: null, reason: "no launch trade carries this signature" });
      continue;
    }
    if (!counted.has(trade.config)) {
      excluded += 1;
      continue;
    }
    let sum = 0n;
    let unvalued = false;
    for (const entry of accrual.entries) {
      if (!STREAM1_TYPES.has(entry.type)) continue;
      let usd = entry.usdMicros;
      if (usd === null) usd = (await entries.get(`${entry.recipient}:ADJUSTMENT:valuation:${LAUNCH_MECHANISM}:${operationRef}:${entry.type}`))?.usdMicros ?? null;
      if (usd === null) {
        unvalued = true;
        break;
      }
      sum += BigInt(usd);
    }
    if (unvalued) {
      pending.push({ operationRef, pool: trade.curve, reason: "a reward of this trade has no dollar figure yet" });
      continue;
    }
    const settledAt = accrual.entries[0]?.source?.settledAt ?? trade.settledAt ?? null;
    if (!settledAt) {
      pending.push({ operationRef, pool: trade.curve, reason: "the trade has no settlement time" });
      continue;
    }
    rows.push({
      kind: "STREAM1",
      schema: 1,
      network: "solana",
      chain: SOLANA_CHAIN,
      pool: trade.curve,
      config: trade.config,
      venue: trade.venue,
      operationRef,
      trader: accrual.trader,
      entries: accrual.entries.filter((entry) => STREAM1_TYPES.has(entry.type)).length,
      usdMicros: sum.toString(),
      settledAt,
      recordedAt: now,
    });
  }
  return { rows, pending, excluded };
}

export type Stream1Outcome = Readonly<{ created: number; existing: number; pending: readonly Stream1Pending[]; excluded: number; refused: number; conflicts: number }>;

/** Write the stream-1 rows `readStream1` finds. */
export async function recordStream1(store: GuardStore, args: Readonly<{ registry: readonly RegistryRowLike[]; now?: string }>): Promise<Stream1Outcome> {
  const read = await readStream1(store, args);
  const written = await appendPoolShareRows(store, read.rows);
  return { created: written.created, existing: written.existing, pending: read.pending, excluded: read.excluded, refused: written.refused.length, conflicts: written.conflicts.length };
}

const pendingCounts = (pending: readonly Stream1Pending[]): Stream1PendingCount[] => {
  const by = new Map<string | null, number>();
  for (const item of pending) by.set(item.pool, (by.get(item.pool) ?? 0) + 1);
  return [...by].map(([pool, count]) => ({ pool, count }));
};

/**
 * Both sums per pool, with stream 1 left open wherever an operation is pending
 * — or ready but not written to the journal yet: a sum without it would be too
 * small, and the partner's base too large.
 */
export async function readPoolShareTotals(store: GuardStore, args: Readonly<{ registry: readonly RegistryRowLike[] }>): Promise<PoolShareTotals[]> {
  const stream1 = await readStream1(store, args);
  const collection = store.collection<PoolShareRow>(POOL_SHARE_COLLECTION);
  const unwritten: Stream1Pending[] = [];
  for (const row of stream1.rows) {
    if (!(await collection.has(poolShareKey(row)))) unwritten.push({ operationRef: row.operationRef, pool: row.pool, reason: "ready, not written yet" });
  }
  return poolShareTotals(await readPoolShareRows(store), pendingCounts([...stream1.pending, ...unwritten]));
}

/** What a chain read returns: the rows it found, or that it found nothing it can stand behind. */
export type PoolShareRead =
  | Readonly<{
      state: "OK";
      rows: readonly PoolShareRow[];
      /** Every claim of a counted config the read saw, as the chain states it — the reconciliation's other side. */
      chain: readonly Readonly<{ network: PoolShareNetwork; tx: string; index: string; claimedRaw: string }>[];
      /** Claims seen and deliberately not counted (demo market, unregistered config, the creator's part). */
      skipped: readonly Readonly<{ tx: string; index: string; reason: string }>[];
      /** Claims seen and not written yet (no event, not finalized, no time) — the next read tries again. */
      pending: readonly Readonly<{ tx: string; index: string; reason: string }>[];
      /** EVM: the hook's payee the claims were read for. */
      payee?: string;
    }>
  | Readonly<{ state: "NO_DATA"; reason: string }>;

export type JournalReport = Readonly<{
  networks: Readonly<Partial<Record<PoolShareNetwork, Readonly<{ state: "OK"; created: number; existing: number; skipped: number; pending: number; refused: number; conflicts: number } | { state: "NO_DATA"; reason: string }>>>>;
  stream1: Stream1Outcome;
}>;

/**
 * Write what the reads found, then the stream-1 rows.
 *
 * A read that failed writes nothing and is reported as `NO_DATA` — never as a
 * network with no claims.
 */
export async function journalPoolShares(
  store: GuardStore,
  reads: Readonly<Partial<Record<PoolShareNetwork, PoolShareRead>>>,
  args: Readonly<{ registry: readonly RegistryRowLike[]; now?: string }>,
): Promise<JournalReport> {
  const networks: Record<string, unknown> = {};
  for (const [network, read] of Object.entries(reads)) {
    if (!read) continue;
    if (read.state === "NO_DATA") {
      networks[network] = { state: "NO_DATA", reason: read.reason };
      continue;
    }
    const written = await appendPoolShareRows(store, read.rows);
    networks[network] = { state: "OK", created: written.created, existing: written.existing, skipped: read.skipped.length, pending: read.pending.length, refused: written.refused.length, conflicts: written.conflicts.length };
  }
  const stream1 = await recordStream1(store, args);
  return { networks: networks as JournalReport["networks"], stream1 };
}
