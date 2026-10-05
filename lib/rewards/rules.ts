/**
 * The rules a reward is computed by, versioned — and the five ranks.
 *
 * ## Two versions, and the line between them is never moved backwards
 *
 * `1.0.0` is the programme of 2026-09-10: 50 % cashback, 10 % to the inviter
 * and 5 % to the inviter's inviter, all of the **gross** fee the person paid.
 * `2.0.0` is the decision of 2026-10-04: the base is the fee Ryntra **actually received** — after the
 * provider's own cut — the inviter's share depends on the inviter's rank, and
 * the sum of everything paid out of one fee never exceeds what was received.
 *
 * An operation is computed by the version in force when it settled, and an
 * accrual keeps the version it was written with. A later version changes what
 * the *next* trade earns and never recomputes an earlier one.
 *
 * ## Ranks
 *
 * Bronze · Silver · Gold · Sapphire · Diamond, by Ryntra points over the last
 * 30 days: one point per dollar of fee Ryntra received on the person's own
 * trades, one per dollar received on trades by people they invited, and a
 * fixed number for a launch of theirs that reached a DEX. Points here are a
 * measure of standing and nothing else — no cash value, no conversion, no
 * transfer, no token.
 *
 * Integers only, as everywhere in Rewards: shares are basis points, points are
 * whole numbers, dollars are micro-units.
 */

export const REWARD_RANKS = ["BRONZE", "SILVER", "GOLD", "SAPPHIRE", "DIAMOND"] as const;
export type RewardRank = (typeof REWARD_RANKS)[number];

export const REWARD_RULES_VERSIONS = ["1.0.0", "2.0.0"] as const;
export type RewardRulesVersion = (typeof REWARD_RULES_VERSIONS)[number];

/** What a share is a share of. */
export type RewardShareBase = "GROSS" | "RECEIVED";

export type RewardRules = Readonly<{
  version: RewardRulesVersion;
  base: RewardShareBase;
  cashbackBps: number;
  /** The inviter's share, by the inviter's rank when the friend's trade settled. */
  referralL1BpsByRank: Readonly<Record<RewardRank, number>>;
  referralL2Bps: number;
}>;

export const REWARD_RULES_V1: RewardRules = {
  version: "1.0.0",
  base: "GROSS",
  cashbackBps: 5000,
  referralL1BpsByRank: { BRONZE: 1000, SILVER: 1000, GOLD: 1000, SAPPHIRE: 1000, DIAMOND: 1000 },
  referralL2Bps: 500,
};

export const REWARD_RULES_V2: RewardRules = {
  version: "2.0.0",
  base: "RECEIVED",
  cashbackBps: 5000,
  referralL1BpsByRank: { BRONZE: 1000, SILVER: 1500, GOLD: 2000, SAPPHIRE: 2500, DIAMOND: 3000 },
  referralL2Bps: 500,
};

/** The version every new operation is computed by, once it is in force. */
export const REWARD_RULES_CURRENT = REWARD_RULES_V2;

export function rewardRulesOf(version: RewardRulesVersion | undefined | null): RewardRules {
  return version === "2.0.0" ? REWARD_RULES_V2 : REWARD_RULES_V1;
}

/**
 * The most one fee can ever pay out, in basis points of its base.
 *
 * For a received base this is the whole of the «payouts ≤ received» rule: if
 * the largest cashback plus the largest inviter share plus the second level
 * fits inside 10 000, no combination of ranks can pay more than arrived.
 */
export function maxPayoutBps(rules: RewardRules): number {
  return rules.cashbackBps + Math.max(...REWARD_RANKS.map((rank) => rules.referralL1BpsByRank[rank])) + rules.referralL2Bps;
}

for (const rules of [REWARD_RULES_V1, REWARD_RULES_V2]) {
  if (rules.base === "RECEIVED" && maxPayoutBps(rules) > 10_000) {
    throw new Error(`Reward rules ${rules.version} could pay out more than Ryntra receives.`);
  }
}

/* ------------------------------------------------------------------- ranks */

/** Points over the window at which each rank begins. Bronze is everyone. */
export const RANK_THRESHOLDS: Readonly<Record<RewardRank, bigint>> = {
  BRONZE: 0n,
  SILVER: 100n,
  GOLD: 1_000n,
  SAPPHIRE: 10_000n,
  DIAMOND: 50_000n,
};

export const RANK_WINDOW_DAYS = 30;
export const RANK_WINDOW_MS = RANK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** One point per whole dollar of received fee. */
export const RANK_POINTS_PER_USD = 1n;

/** Things that earn points without a fee of their own. Written by the caller that knows they happened. */
export const RANK_EVENT_KINDS = ["LAUNCH_GRADUATED"] as const;
export type RankEventKind = (typeof RANK_EVENT_KINDS)[number];

export const RANK_EVENT_POINTS: Readonly<Record<RankEventKind, bigint>> = {
  /* A token launched through Ryntra that left its bonding curve for a DEX. */
  LAUNCH_GRADUATED: 250n,
};

export function rankForPoints(points: bigint): RewardRank {
  let rank: RewardRank = "BRONZE";
  for (const candidate of REWARD_RANKS) if (points >= RANK_THRESHOLDS[candidate]) rank = candidate;
  return rank;
}

export function nextRank(rank: RewardRank): RewardRank | null {
  return REWARD_RANKS[REWARD_RANKS.indexOf(rank) + 1] ?? null;
}
