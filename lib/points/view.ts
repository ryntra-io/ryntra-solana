import { formatUsdMicros } from "../rewards/model.ts";
import { formatPoints, type PointsEntry } from "./model.ts";
import { pointsSummary, type PointsRanking } from "./ledger.ts";
import { POINTS_POLICY_V1, type PointsPolicy } from "./policy.ts";

/**
 * What the Rewards page is allowed to know about Points.
 *
 * Six figures and nothing internal: no event ids, no policy arithmetic, no
 * valuation bases, no other wallet's address. The rank says *7 of 42* and
 * never who the other forty-one are — there is no public leaderboard, and this projection is where that stays true.
 */

export type PointsView = Readonly<{
  /** Whole points, grouped for reading. */
  points: string;
  level: number;
  /** Points at which the current level began, grouped — the ring's zero. */
  levelFrom: string;
  /** Points at which the next level begins, grouped, or null at the top. */
  nextLevelAt: string | null;
  /** Position among external wallets, or null for a wallet that has none. */
  rank: number | null;
  /** How many external wallets are ranked at all. */
  ranked: number;
  /** Lifetime eligible volume, as `$1 234.56` — grouped like the points beside it. */
  volume: string;
  trades: number;
  activeDays: number;
  policyVersion: string;
}>;

export function pointsView(
  args: Readonly<{ entries: readonly PointsEntry[]; wallet: string; ranking: PointsRanking; policy?: PointsPolicy }>,
): PointsView {
  const policy = args.policy ?? POINTS_POLICY_V1;
  const summary = pointsSummary(args.entries, policy);
  return {
    points: formatPoints(summary.points),
    level: summary.level,
    levelFrom: formatPoints(policy.levels[summary.level - 1] ?? 0n),
    nextLevelAt: summary.nextLevelAt === null ? null : formatPoints(summary.nextLevelAt),
    rank: args.ranking.rankOf(args.wallet),
    ranked: args.ranking.order.length,
    volume: formatUsdGrouped(summary.volumeUsdMicros),
    trades: summary.trades,
    activeDays: summary.activeDays,
    policyVersion: policy.version,
  };
}

/** Dollars with the whole part grouped the way the points are, two decimals kept. */
export function formatUsdGrouped(micros: bigint): string {
  const [whole, cents] = formatUsdMicros(micros).split(".");
  return `$${formatPoints(BigInt(whole!))}.${cents}`;
}
