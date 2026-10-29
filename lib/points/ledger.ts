import type { GuardStore } from "../guard/store.ts";
import {
  pointsDayPrefix,
  pointsEntryKey,
  PointsEntrySchema,
  pointsWalletPrefix,
  type PointsEntry,
} from "./model.ts";
import { levelFor, POINTS_POLICY_V1, type PointsPolicy, type PointsReason } from "./policy.ts";

/**
 * The durable half of Points: the rows, and the sums over them.
 *
 * This module reads immutable rows and provides the low-level insert helper
 * for fixtures. Production accrual in record.server.ts atomically commits the
 * operation identity, daily version fence, rows and qualification marker.
 * A competing write changes that fence, forcing the tier/cap calculation to
 * read the newly committed day before it can retry.
 */

const ENTRIES = "pointsEntries" as const;

export type RecordPointsResult = Readonly<{
  created: readonly PointsEntry[];
  existing: number;
}>;

/** Write rows, once each. Non-fatal by contract; the caller ignores a failure. */
export async function recordPointsEntries(store: GuardStore, entries: readonly PointsEntry[]): Promise<RecordPointsResult> {
  const collection = store.collection<PointsEntry>(ENTRIES);
  const created: PointsEntry[] = [];
  let existing = 0;
  for (const entry of entries) {
    const parsed = PointsEntrySchema.parse(entry);
    const [reason, ...rest] = parsed.eventId.split(":");
    const key = pointsEntryKey({ wallet: parsed.wallet, day: parsed.day, reason: reason as PointsReason, ref: rest.join(":") });
    const inserted = await collection.insertIfAbsent(key, parsed);
    if (inserted) created.push(parsed);
    else existing += 1;
  }
  return { created, existing };
}

function parseRows(rows: readonly unknown[]): PointsEntry[] {
  // Omitting a malformed row understates both the balance and the daily cap.
  return rows.map(row => PointsEntrySchema.parse(row));
}

/** Every row belonging to one wallet, newest first. */
export async function listPointsEntries(store: GuardStore, wallet: string): Promise<readonly PointsEntry[]> {
  const rows = await store.collection<unknown>(ENTRIES).valuesWithPrefix(pointsWalletPrefix(wallet));
  return parseRows(rows).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** One wallet's rows for one UTC day. */
export async function listPointsDay(store: GuardStore, wallet: string, day: string): Promise<readonly PointsEntry[]> {
  const rows = await store.collection<unknown>(ENTRIES).valuesWithPrefix(pointsDayPrefix(wallet, day));
  return parseRows(rows);
}

/**
 * Every row there is.
 *
 * Scanned whole, which is right at this product's volume and is written down
 * here so it is not mistaken for a design: the Guard port has one scan, and
 * the day this collection holds tens of thousands of rows the rank moves to
 * a periodic rollup rather than growing a timeout.
 */
export async function listAllPointsEntries(store: GuardStore): Promise<readonly PointsEntry[]> {
  const rows = await store.collection<unknown>(ENTRIES).valuesWithPrefix("");
  return parseRows(rows);
}

/* ------------------------------------------------------------------- sums */

export type PointsSummary = Readonly<{
  points: bigint;
  level: number;
  nextLevelAt: bigint | null;
  /** Eligible volume ever, USD micro-units. */
  volumeUsdMicros: bigint;
  /** Completed trades — every `TRADE_VOLUME` row, valued or not. */
  trades: number;
  /** Distinct UTC days with at least one completed trade. */
  activeDays: number;
  byReason: Readonly<Record<PointsReason, bigint>>;
  firstEarnedAt: string | null;
  lastActiveAt: string | null;
}>;

/** Add up one wallet's rows. A null volume counts as a trade and as no dollars. */
export function pointsSummary(entries: readonly PointsEntry[], policy: PointsPolicy = POINTS_POLICY_V1): PointsSummary {
  let points = 0n;
  let volume = 0n;
  let trades = 0;
  const days = new Set<string>();
  const byReason: Record<PointsReason, bigint> = {
    TRADE_VOLUME: 0n,
    ACTIVE_DAY: 0n,
    QUALIFIED_REFERRAL: 0n,
    STRATEGY_COMPLETED: 0n,
    ADJUSTMENT: 0n,
  };
  let first: string | null = null;
  let last: string | null = null;
  for (const entry of entries) {
    const value = BigInt(entry.points);
    points += value;
    byReason[entry.valuationOf ? "TRADE_VOLUME" : entry.reason] += value;
    if (entry.reason === "TRADE_VOLUME") {
      trades += 1;
      days.add(entry.day);
      if (entry.source?.volumeUsdMicros) volume += BigInt(entry.source.volumeUsdMicros);
    }
    if (entry.valuationOf && entry.source?.volumeUsdMicros) volume += BigInt(entry.source.volumeUsdMicros);
    if (first === null || entry.createdAt < first) first = entry.createdAt;
    if (last === null || entry.createdAt > last) last = entry.createdAt;
  }
  const { level, nextAt } = levelFor(policy, points);
  return {
    points,
    level,
    nextLevelAt: nextAt,
    volumeUsdMicros: volume,
    trades,
    activeDays: days.size,
    byReason,
    firstEarnedAt: first,
    lastActiveAt: last,
  };
}

/** Rows grouped by the wallet they belong to. */
export function groupByWallet(entries: readonly PointsEntry[]): ReadonlyMap<string, readonly PointsEntry[]> {
  const grouped = new Map<string, PointsEntry[]>();
  for (const entry of entries) {
    const rows = grouped.get(entry.wallet);
    if (rows) rows.push(entry);
    else grouped.set(entry.wallet, [entry]);
  }
  return grouped;
}

export type PointsRanking = Readonly<{
  /** External wallets in rank order — points descending, the earlier first row first, then the address. */
  order: readonly string[];
  rankOf(wallet: string): number | null;
}>;

/**
 * Who stands where, among external wallets only.
 *
 * An internal wallet is left out of the order entirely rather than ranked
 * and hidden, so the numbers people see — *you are 7th of 42* — are numbers
 * about customers. The person still sees their own points; what they do not
 * get is a rank, because a rank among test wallets is not a fact about
 * anything.
 */
export function rankPoints(
  entries: readonly PointsEntry[],
  internalWallets: ReadonlySet<string>,
  policy: PointsPolicy = POINTS_POLICY_V1,
): PointsRanking {
  const grouped = groupByWallet(entries);
  const scored: { wallet: string; points: bigint; first: string }[] = [];
  for (const [wallet, rows] of grouped) {
    if (internalWallets.has(wallet)) continue;
    const summary = pointsSummary(rows, policy);
    scored.push({ wallet, points: summary.points, first: summary.firstEarnedAt ?? "" });
  }
  return rankOrder(scored);
}

/** The order itself — points descending, the earlier first row first, then the address — over figures already summed. */
export function rankOrder(figures: readonly Readonly<{ wallet: string; points: bigint; first: string }>[]): PointsRanking {
  const scored = [...figures];
  scored.sort((left, right) => {
    if (left.points !== right.points) return left.points > right.points ? -1 : 1;
    if (left.first !== right.first) return left.first < right.first ? -1 : 1;
    return left.wallet < right.wallet ? -1 : left.wallet > right.wallet ? 1 : 0;
  });
  const order = scored.map((row) => row.wallet);
  const positions = new Map(order.map((wallet, index) => [wallet, index + 1] as const));
  return {
    order,
    rankOf: (wallet) => positions.get(wallet) ?? null,
  };
}
