import { groupByWallet, pointsSummary, rankPoints } from "../points/ledger.ts";
import type { PointsEntry } from "../points/model.ts";
import { POINTS_POLICY_V1, type PointsPolicy } from "../points/policy.ts";
import { maskWallet, type BusinessPresence, type BusinessReferralEdge, type BusinessScope } from "./business.ts";

/**
 * Admin Points — the owner's view of the same ledger the customer reads.
 *
 * Pure and client-safe: no clock, no store, no `process.env`. A projection
 * over the points ledger, the wallet presence index and the referral graph —
 * one row per wallet, sortable four ways, and the ledger itself one disclosure
 * down so every figure can be traced to the rows that made it.
 *
 * Internal wallets are out by default: out of the order, out of the counts,
 * and shown tagged only under *all activity*, the same switch the business
 * dashboard has. A rank shown here is the same rank the person sees, because
 * both come from `rankPoints` over the same rows and the same list.
 */

export const POINTS_SORTS = ["points", "volume", "active", "newest"] as const;
export type PointsSort = (typeof POINTS_SORTS)[number];

export function isPointsSort(value: unknown): value is PointsSort {
  return typeof value === "string" && (POINTS_SORTS as readonly string[]).includes(value);
}

const DAY_MS = 86_400_000;

export type PointsTableRow = Readonly<{
  wallet: string;
  walletFull: string;
  internal: boolean;
  points: string;
  level: number;
  /** Position among external wallets; null for an internal one. */
  rank: number | null;
  lifetimeVolumeUsd: number;
  volume30dUsd: number;
  trades: number;
  activeDays: number;
  /** Direct (level-1) referrals, from the referral graph. */
  referrals: number;
  /** First cabinet visit where presence recorded one, else the first points row. */
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  firstEarnedAt: string | null;
}>;

export type PointsLedgerRow = Readonly<{
  eventId: string;
  reason: PointsEntry["reason"];
  points: string;
  day: string;
  surface: string | null;
  lane: string | null;
  actionId: string | null;
  operationRef: string | null;
  trader: string | null;
  volumeUsd: number | null;
  valuation: string;
  dayVolumeBeforeUsd: number | null;
  policyVersion: string;
  createdAt: string;
}>;

export type PointsTableModel = Readonly<{
  generatedAt: string;
  scope: BusinessScope;
  sort: PointsSort;
  policyVersion: string;
  rows: readonly PointsTableRow[];
  /** How many wallets hold at least one row, external only. */
  ranked: number;
  internalWallets: number;
  totals: Readonly<{ points: string; lifetimeVolumeUsd: number; trades: number }>;
}>;

export type PointsTableInputs = Readonly<{
  now: string;
  scope: BusinessScope;
  sort: PointsSort;
  entries: readonly PointsEntry[];
  presence: readonly BusinessPresence[];
  edges: readonly BusinessReferralEdge[];
  internalWallets: ReadonlySet<string>;
  policy?: PointsPolicy;
}>;

function usdNumber(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

export function projectPointsTable(input: PointsTableInputs): PointsTableModel {
  const policy = input.policy ?? POINTS_POLICY_V1;
  const grouped = groupByWallet(input.entries);
  const ranking = rankPoints(input.entries, input.internalWallets, policy);
  const since30d = new Date(Date.parse(input.now) - 30 * DAY_MS).toISOString();
  const presenceByWallet = new Map(input.presence.map((row) => [row.wallet, row] as const));
  const referralsByWallet = new Map<string, number>();
  for (const edge of input.edges) {
    if (edge.level !== 1) continue;
    referralsByWallet.set(edge.referrer, (referralsByWallet.get(edge.referrer) ?? 0) + 1);
  }

  const rows: PointsTableRow[] = [];
  let totalPoints = 0n;
  let totalVolume = 0n;
  let totalTrades = 0;
  for (const [wallet, entries] of grouped) {
    const internal = input.internalWallets.has(wallet);
    if (internal && input.scope === "external") continue;
    const summary = pointsSummary(entries, policy);
    let volume30d = 0n;
    for (const entry of entries) {
      if (entry.reason === "TRADE_VOLUME" && entry.source?.volumeUsdMicros && entry.source.settledAt >= since30d) {
        volume30d += BigInt(entry.source.volumeUsdMicros);
      }
    }
    if (!internal) {
      totalPoints += summary.points;
      totalVolume += summary.volumeUsdMicros;
      totalTrades += summary.trades;
    }
    const presence = presenceByWallet.get(wallet);
    rows.push({
      wallet: maskWallet(wallet),
      walletFull: wallet,
      internal,
      points: summary.points.toString(),
      level: summary.level,
      rank: internal ? null : ranking.rankOf(wallet),
      lifetimeVolumeUsd: usdNumber(summary.volumeUsdMicros),
      volume30dUsd: usdNumber(volume30d),
      trades: summary.trades,
      activeDays: summary.activeDays,
      referrals: referralsByWallet.get(wallet) ?? 0,
      firstSeenAt: presence?.firstSeenAt ?? summary.firstEarnedAt,
      lastActiveAt: summary.lastActiveAt,
      firstEarnedAt: summary.firstEarnedAt,
    });
  }

  const byPoints = (left: PointsTableRow, right: PointsTableRow): number => {
    const l = BigInt(left.points);
    const r = BigInt(right.points);
    if (l !== r) return l > r ? -1 : 1;
    return (left.firstEarnedAt ?? "").localeCompare(right.firstEarnedAt ?? "");
  };
  const sorters: Record<PointsSort, (left: PointsTableRow, right: PointsTableRow) => number> = {
    points: byPoints,
    volume: (left, right) => right.lifetimeVolumeUsd - left.lifetimeVolumeUsd || byPoints(left, right),
    active: (left, right) => right.activeDays - left.activeDays || right.trades - left.trades || byPoints(left, right),
    newest: (left, right) => (right.firstEarnedAt ?? "").localeCompare(left.firstEarnedAt ?? "") || byPoints(left, right),
  };
  rows.sort(sorters[input.sort]);

  return {
    generatedAt: input.now,
    scope: input.scope,
    sort: input.sort,
    policyVersion: policy.version,
    rows,
    ranked: ranking.order.length,
    internalWallets: [...grouped.keys()].filter((wallet) => input.internalWallets.has(wallet)).length,
    totals: { points: totalPoints.toString(), lifetimeVolumeUsd: usdNumber(totalVolume), trades: totalTrades },
  };
}

/** One wallet's rows, newest first, with every audit field the ledger holds. */
export function projectPointsLedger(entries: readonly PointsEntry[]): readonly PointsLedgerRow[] {
  return [...entries]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((entry) => ({
      eventId: entry.eventId,
      reason: entry.reason,
      points: entry.points,
      day: entry.day,
      surface: entry.source?.surface ?? null,
      lane: entry.source?.lane ?? null,
      actionId: entry.source?.actionId ?? null,
      operationRef: entry.source?.operationRef ?? null,
      trader: entry.source?.trader ?? null,
      volumeUsd: entry.source?.volumeUsdMicros ? usdNumber(BigInt(entry.source.volumeUsdMicros)) : null,
      valuation: entry.source?.valuation.basis ?? "—",
      dayVolumeBeforeUsd: entry.source?.dayVolumeBeforeUsdMicros ? usdNumber(BigInt(entry.source.dayVolumeBeforeUsdMicros)) : null,
      policyVersion: entry.policyVersion,
      createdAt: entry.createdAt,
    }));
}
