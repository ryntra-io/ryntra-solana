import { z } from "zod";

import { formatPoints } from "../points/model.ts";
import { JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT } from "../solana/quotes.ts";
import { effectiveRewardEntries } from "./ledger.ts";
import { USD_MICROS_PER_USD, type RewardEntry } from "./model.ts";
import {
  nextRank,
  RANK_EVENT_KINDS,
  RANK_POINTS_PER_USD,
  RANK_THRESHOLDS,
  RANK_WINDOW_MS,
  rankForPoints,
  REWARD_RANKS,
  REWARD_RULES_CURRENT,
  type RewardRank,
  type RewardRules,
} from "./rules.ts";

/**
 * Where a wallet stands: its Ryntra points over the last 30 days and the rank
 * they make.
 *
 * ## Computed, never stored
 *
 * Points are a sum over rows that already exist for other reasons — the
 * wallet's own cashback rows say what fee Ryntra received on its trades, its
 * level-1 rows say what Ryntra received on its friends' trades — plus the
 * few events that earn points without a fee. A stored rank would be a second
 * source of truth that drifts; this one is always a function of the ledger
 * and the moment it is asked about.
 *
 * ## What a dollar of received fee is, row by row
 *
 * A row under rules `2.0.0` carries its own base, so its dollar figure
 * divided by its rate is exactly the received fee. A row under `1.0.0` was a
 * share of the gross; the received part is the gross less the provider's
 * documented cut — Jupiter's fifth, nothing for Relay. A row still waiting
 * for a price adds nothing until it has one.
 */

export const RankEventSchema = z
  .object({
    wallet: z.string().min(32).max(64),
    kind: z.enum(RANK_EVENT_KINDS),
    /** The thing that happened — for a launch, the token's mint. With `kind`, the duplicate defence. */
    ref: z.string().min(1).max(200),
    points: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    rulesVersion: z.literal("2.0.0"),
    /** When it happened. The window reads this. */
    at: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RankEvent = z.output<typeof RankEventSchema>;

export type RankStanding = Readonly<{
  rank: RewardRank;
  points: bigint;
  /** Points from fees Ryntra received on this wallet's own trades. */
  fromTrades: bigint;
  /** Points from fees Ryntra received on trades by people this wallet invited. */
  fromFriends: bigint;
  /** Points from launches that reached a DEX. */
  fromLaunches: bigint;
  /** Points at which the current rank began. */
  rankFrom: bigint;
  next: Readonly<{ rank: RewardRank; at: bigint }> | null;
  /** The inviter share this rank earns, in basis points of the received fee. */
  referralL1Bps: number;
  referralL2Bps: number;
  windowFrom: string;
  at: string;
}>;

/** The fee Ryntra received behind one row, in USD micro-units; zero when the row says nothing about it. */
export function receivedUsdMicrosOf(entry: RewardEntry): bigint {
  if (entry.type !== "CASHBACK" && entry.type !== "REFERRAL_L1") return 0n;
  if (entry.usdMicros === null || entry.rateBps <= 0 || !entry.source) return 0n;
  const share = BigInt(entry.usdMicros);
  if (share <= 0n) return 0n;
  const base = (share * 10_000n) / BigInt(entry.rateBps);
  if (entry.rules?.base === "RECEIVED") return base;
  const retained = entry.source.mechanism === "JUPITER_REFERRAL" ? BigInt(JUPITER_REFERRAL_PROVIDER_SHARE_PERCENT) : 0n;
  return (base * (100n - retained)) / 100n;
}

function inWindow(iso: string, fromMs: number, toMs: number): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > fromMs && ms <= toMs;
}

/**
 * The standing of one wallet at one moment, from its own rows.
 *
 * `entries` are the wallet's reward rows (it is their recipient); `events`
 * its rank events. The window is the 30 days ending at `at`, inclusive of
 * `at` and exclusive of its start, read by when each trade **settled** — so
 * the same rows asked about the same moment always give the same rank.
 */
export function rankStanding(
  args: Readonly<{ wallet: string; entries: readonly RewardEntry[]; events: readonly RankEvent[]; at: string }>,
): RankStanding {
  const toMs = Date.parse(args.at);
  if (!Number.isFinite(toMs)) throw new Error("A rank needs a readable moment.");
  const fromMs = toMs - RANK_WINDOW_MS;
  let trades = 0n;
  let friends = 0n;
  for (const entry of effectiveRewardEntries(args.entries)) {
    if (entry.recipient !== args.wallet || !entry.source || !inWindow(entry.source.settledAt, fromMs, toMs)) continue;
    if (entry.type === "CASHBACK" && entry.source.trader === args.wallet) trades += receivedUsdMicrosOf(entry);
    if (entry.type === "REFERRAL_L1" && entry.source.trader !== args.wallet) friends += receivedUsdMicrosOf(entry);
  }
  let launches = 0n;
  for (const event of args.events) {
    if (event.wallet !== args.wallet || !inWindow(event.at, fromMs, toMs)) continue;
    launches += BigInt(event.points);
  }
  /* Whole points per whole dollar, each source floored on its own so the
     parts a person reads add up to the total they are shown. */
  const fromTrades = (trades * RANK_POINTS_PER_USD) / USD_MICROS_PER_USD;
  const fromFriends = (friends * RANK_POINTS_PER_USD) / USD_MICROS_PER_USD;
  const points = fromTrades + fromFriends + launches;
  const rank = rankForPoints(points);
  const following = nextRank(rank);
  return {
    rank,
    points,
    fromTrades,
    fromFriends,
    fromLaunches: launches,
    rankFrom: RANK_THRESHOLDS[rank],
    next: following ? { rank: following, at: RANK_THRESHOLDS[following] } : null,
    referralL1Bps: REWARD_RULES_CURRENT.referralL1BpsByRank[rank],
    referralL2Bps: REWARD_RULES_CURRENT.referralL2Bps,
    windowFrom: new Date(fromMs).toISOString(),
    at: new Date(toMs).toISOString(),
  };
}

/**
 * What the Rewards page is allowed to know about a rank.
 *
 * Grouped whole points and percentages — no rows, no other wallet, no rules
 * arithmetic. The rank is an id the page names in its own language.
 */
export type RankSummary = Readonly<{
  rank: RewardRank;
  points: string;
  fromTrades: string;
  fromFriends: string;
  fromLaunches: string;
  rankFrom: string;
  /** The next rank, where it begins, how far away it is and the friend share it pays. */
  next: Readonly<{ rank: RewardRank; at: string; toGo: string; friendShare: number }> | null;
  /** Whole percent of the fee Ryntra received: what an invited friend's trade pays this wallet now. */
  friendShare: number;
  secondLevelShare: number;
  /** Every rank, where it begins and the level-1 share it pays, under the rules in force. */
  ladder: readonly Readonly<{ rank: RewardRank; from: string; friendShare: number }>[];
  windowDays: number;
  rulesVersion: string;
}>;

/**
 * The page's view of a standing, under the rules in force now — so a
 * deployment where 2.0.0 has not begun shows what a friend's trade actually
 * pays (1.0.0: 10 % at every rank) rather than what it will.
 */
export function rankSummary(standing: RankStanding, rules: RewardRules = REWARD_RULES_CURRENT): RankSummary {
  return {
    rank: standing.rank,
    points: formatPoints(standing.points),
    fromTrades: formatPoints(standing.fromTrades),
    fromFriends: formatPoints(standing.fromFriends),
    fromLaunches: formatPoints(standing.fromLaunches),
    rankFrom: formatPoints(standing.rankFrom),
    next: standing.next
      ? {
          rank: standing.next.rank,
          at: formatPoints(standing.next.at),
          toGo: formatPoints(standing.next.at - standing.points),
          friendShare: rules.referralL1BpsByRank[standing.next.rank] / 100,
        }
      : null,
    friendShare: rules.referralL1BpsByRank[standing.rank] / 100,
    secondLevelShare: rules.referralL2Bps / 100,
    ladder: REWARD_RANKS.map((rank) => ({ rank, from: formatPoints(RANK_THRESHOLDS[rank]), friendShare: rules.referralL1BpsByRank[rank] / 100 })),
    windowDays: Math.round((Date.parse(standing.at) - Date.parse(standing.windowFrom)) / 86_400_000),
    rulesVersion: rules.version,
  };
}
