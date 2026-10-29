import { effectiveRewardEntries } from "../rewards/ledger.ts";
import { USD_MICROS_PER_USD, type RewardEntry } from "../rewards/model.ts";
import { partnerBaseSweep, rankEventPointsOf, receivedUsdMicrosOf, type RankEvent } from "../rewards/rank.ts";
import { formatPoints } from "../points/model.ts";
import { RANK_POINTS_PER_USD, RANK_THRESHOLDS, RANK_WINDOW_MS, rankForPoints, REWARD_RANKS, type RewardRank } from "../rewards/rules.ts";
import { ACHIEVEMENT_IDS, rankTier, type AchievementId } from "./badges.ts";

/**
 * What a wallet has achieved, read from the rows it already has.
 *
 * ## Kept, unlike the rank
 *
 * A rank is the last 30 days and can fall. The badge of a rank, once
 * reached, stays: the highest rank this wallet held is the highest 30-day
 * sum its rows have made, found by sliding the same window the rank uses
 * over every moment something earned a point. Same rows, same rounding,
 * same window as `rankStanding`.
 *
 * ## Only since ranks exist
 *
 * Ranks began with rules `2.0.0`. A window is read only at the moment those
 * rules came into force (holding whatever its 30 days already held) and at
 * every arrival after it — never before, so no badge is dated to a day when
 * no rank card existed. Where the moment is not known (`since` null), only
 * the ranks up to the one held now are reached, and without a date.
 *
 * ## Only what the product can see
 *
 * Every achievement is a fact of the ledger with a date: a friend's first
 * trade, five friends who traded, a launch that reached a DEX. Nothing
 * celebrates a purchase or a risk, nothing counts trades, and nothing is
 * stored — no second source of truth to drift.
 */

export type RankReached = Readonly<{ rank: RewardRank; reached: boolean; at: string | null; from: string }>;
export type AchievementState = Readonly<{ id: AchievementId; earned: boolean; at: string | null }>;
export type AchievementsSummary = Readonly<{ ranks: readonly RankReached[]; badges: readonly AchievementState[] }>;

/** Friends who traded, for the second friends' badge. */
export const FIVE_FRIENDS = 5;

/**
 * Achievements a person sees only once they hold them — a launch that
 * reached a DEX is shown when there is one, not offered as a goal before
 * launches are open to everyone. The server leaves them out until earned.
 */
export const HIDDEN_UNTIL_EARNED: ReadonlySet<AchievementId> = new Set<AchievementId>(["LAUNCH_ON_DEX"]);

type Contribution = { ms: number; trades: bigint; friends: bigint; launches: bigint };

/** Every moment this wallet earned points, oldest first, up to `atMs`. */
function contributions(wallet: string, entries: readonly RewardEntry[], events: readonly RankEvent[], atMs: number): Contribution[] {
  const out: Contribution[] = [];
  for (const entry of effectiveRewardEntries(entries)) {
    if (entry.recipient !== wallet || !entry.source) continue;
    const ms = Date.parse(entry.source.settledAt);
    if (!Number.isFinite(ms) || ms > atMs) continue;
    if (entry.type === "CASHBACK" && entry.source.trader === wallet) out.push({ ms, trades: receivedUsdMicrosOf(entry), friends: 0n, launches: 0n });
    if (entry.type === "REFERRAL_L1" && entry.source.trader !== wallet) out.push({ ms, trades: 0n, friends: receivedUsdMicrosOf(entry), launches: 0n });
  }
  for (const event of events) {
    const ms = Date.parse(event.at);
    if (event.wallet !== wallet || !Number.isFinite(ms) || ms > atMs) continue;
    /* A partner's base is read whole at each moment (it leaves the window by its own rule); its arrival is a moment to read. */
    out.push({ ms, trades: 0n, friends: 0n, launches: rankEventPointsOf(event) });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * When this wallet first reached each rank, since ranks exist. Bronze is held
 * from the start (`at` null); a rank never reached is `reached: false`;
 * `from` is where each rank begins, grouped as the page writes points.
 *
 * The window ending at a moment holds what settled after its start and up to
 * the moment itself, exactly as the rank card's does; its sum only rises when
 * something new arrives, so the moments worth asking about are the moment
 * ranks began and every arrival after it.
 */
export function ranksReached(
  args: Readonly<{ wallet: string; entries: readonly RewardEntry[]; events: readonly RankEvent[]; at: string; since: string | null }>,
): readonly RankReached[] {
  const atMs = Date.parse(args.at);
  if (!Number.isFinite(atMs)) throw new Error("Achievements need a readable moment.");
  const sinceMs = args.since === null ? atMs : Date.parse(args.since);
  if (!Number.isFinite(sinceMs)) throw new Error("Achievements need a readable start of ranks.");
  const dated = args.since !== null;
  const list = contributions(args.wallet, args.entries, args.events, atMs);
  const first = new Map<RewardRank, string | null>();
  let trades = 0n;
  let friends = 0n;
  let launches = 0n;
  let tail = 0;
  /* The partners' base is read in one pass over its spans: the moments asked about rise. */
  const partners = partnerBaseSweep(args.events, args.wallet, RANK_WINDOW_MS);
  const read = (ms: number) => {
    while (tail < list.length && list[tail].ms <= ms - RANK_WINDOW_MS) {
      trades -= list[tail].trades;
      friends -= list[tail].friends;
      launches -= list[tail].launches;
      tail += 1;
    }
    const fromPartners = (partners(ms) * RANK_POINTS_PER_USD) / USD_MICROS_PER_USD;
    const points = (trades * RANK_POINTS_PER_USD) / USD_MICROS_PER_USD + (friends * RANK_POINTS_PER_USD) / USD_MICROS_PER_USD + launches + fromPartners;
    const held = rankForPoints(points);
    for (const rank of REWARD_RANKS) {
      if (rank === "BRONZE" || rankTier(rank) > rankTier(held) || first.has(rank)) continue;
      first.set(rank, dated ? new Date(ms).toISOString() : null);
    }
  };
  let head = 0;
  /* Everything up to the moment ranks began, then one reading at it. */
  while (head < list.length && list[head].ms <= sinceMs) {
    trades += list[head].trades;
    friends += list[head].friends;
    launches += list[head].launches;
    head += 1;
  }
  if (sinceMs <= atMs) read(sinceMs);
  /* Then every arrival after it — those at one moment together. */
  for (; head < list.length; head += 1) {
    const now = list[head];
    trades += now.trades;
    friends += now.friends;
    launches += now.launches;
    if (head + 1 < list.length && list[head + 1].ms === now.ms) continue;
    read(now.ms);
  }
  return REWARD_RANKS.map((rank) => ({
    rank,
    reached: rank === "BRONZE" || first.has(rank),
    at: first.get(rank) ?? null,
    from: formatPoints(RANK_THRESHOLDS[rank]),
  }));
}

/** The highest rank in a `ranksReached` list. */
export function highestRank(ranks: readonly RankReached[]): RewardRank {
  let best: RewardRank = "BRONZE";
  for (const step of ranks) if (step.reached && rankTier(step.rank) > rankTier(best)) best = step.rank;
  return best;
}

/**
 * This wallet's badges: its ranks reached since ranks exist and its
 * achievements, each with the day it was earned. An achievement hidden until
 * earned is left out while it is not.
 */
export function achievementsOf(
  args: Readonly<{ wallet: string; entries: readonly RewardEntry[]; events: readonly RankEvent[]; at: string; since: string | null }>,
): AchievementsSummary {
  const atMs = Date.parse(args.at);
  const ranks = ranksReached(args);
  /* Friends in the order their first trade settled. */
  const friendFirst = new Map<string, number>();
  for (const entry of effectiveRewardEntries(args.entries)) {
    if (entry.type !== "REFERRAL_L1" || entry.recipient !== args.wallet || !entry.source || entry.source.trader === args.wallet) continue;
    const ms = Date.parse(entry.source.settledAt);
    if (!Number.isFinite(ms) || ms > atMs) continue;
    const seen = friendFirst.get(entry.source.trader);
    if (seen === undefined || ms < seen) friendFirst.set(entry.source.trader, ms);
  }
  const friends = [...friendFirst.values()].sort((a, b) => a - b);
  const launches = args.events
    .filter((event) => event.wallet === args.wallet && event.kind === "LAUNCH_GRADUATED")
    .map((event) => Date.parse(event.at))
    .filter((ms) => Number.isFinite(ms) && ms <= atMs)
    .sort((a, b) => a - b);
  const when = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());
  const at: Readonly<Record<AchievementId, string | null>> = {
    FIRST_FRIEND: when(friends[0]),
    FIVE_FRIENDS: when(friends[FIVE_FRIENDS - 1]),
    LAUNCH_ON_DEX: when(launches[0]),
  };
  return {
    ranks,
    badges: ACHIEVEMENT_IDS.filter((id) => at[id] !== null || !HIDDEN_UNTIL_EARNED.has(id)).map((id) => ({ id, earned: at[id] !== null, at: at[id] })),
  };
}
