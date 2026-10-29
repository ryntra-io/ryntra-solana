/**
 * The rules a reward is computed by, versioned — and the five ranks.
 *
 * ## Three versions, and the line between them is never moved backwards
 *
 * `1.0.0` is the programme of 2026-09-10: 50 % cashback, 10 % to the inviter
 * and 5 % to the inviter's inviter, all of the **gross** fee the person paid.
 * `2.0.0` is the decision of 2026-10-04: the base is the fee Ryntra **actually received** — after the
 * provider's own cut — the inviter's share depends on the inviter's rank, and
 * the sum of everything paid out of one fee never exceeds what was received.
 * `2.1.0` is the decision of 2026-10-17: the same shares, plus «First $10
 * back», the inviter's 30 % for a friend's first 90 days, and the claim floor.
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

export const REWARD_RULES_VERSIONS = ["1.0.0", "2.0.0", "2.1.0", "2.2.0"] as const;
export type RewardRulesVersion = (typeof REWARD_RULES_VERSIONS)[number];

/** What a share is a share of. */
export type RewardShareBase = "GROSS" | "RECEIVED";

/**
 * «First $10 back» (rules `2.1.0`, the decision of 2026-10-17): a new wallet gets back all of the fee Ryntra
 * received until what came back reaches `capUsdMicros`, for at most `days` from its first trade — only the first
 * `walletsPerMonth` new wallets of a calendar month (UTC) that pass the cluster check. Its inviter gets nothing in
 * the window, and the window's fee earns no rank points. Paid from the fee, never from the growth budget.
 */
export type FirstTenRules = Readonly<{ capUsdMicros: bigint; days: number; walletsPerMonth: number }>;

/** «30 % to who brought them» (rules `2.1.0`): the inviter's share of each friend's trades for `days` from that friend's first trade, whatever the inviter's rank. */
export type InviterWindowRules = Readonly<{ bps: number; days: number }>;

/** The least a claim may be: with a USDC account the payout needs no rent, without one it opens it. */
export type ClaimFloorRules = Readonly<{ withAccountUsdMicros: bigint; withoutAccountUsdMicros: bigint }>;

export type RewardRules = Readonly<{
  version: RewardRulesVersion;
  base: RewardShareBase;
  cashbackBps: number;
  /** The inviter's share, by the inviter's rank when the friend's trade settled. */
  referralL1BpsByRank: Readonly<Record<RewardRank, number>>;
  referralL2Bps: number;
  /** From `2.1.0`. */
  firstTen?: FirstTenRules;
  inviterWindow?: InviterWindowRules;
  claimFloor?: ClaimFloorRules;
  /** The points each rank begins at, over the window. Absent — the ladder these rules were written with (`RANK_THRESHOLDS_V1`). */
  rankThresholds?: Readonly<Record<RewardRank, bigint>>;
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

/**
 * `2.1.0` is the decision of 2026-10-17: the shares of `2.0.0`
 * unchanged, «First $10 back» for new wallets, 30 % to the inviter for each friend's first 90 days, and the claim
 * floor of $0.25 with a USDC account, $1 without.
 */
export const REWARD_RULES_V2_1: RewardRules = {
  ...REWARD_RULES_V2,
  version: "2.1.0",
  firstTen: { capUsdMicros: 10_000_000n, days: 30, walletsPerMonth: 100 },
  inviterWindow: { bps: 3000, days: 90 },
  claimFloor: { withAccountUsdMicros: 250_000n, withoutAccountUsdMicros: 1_000_000n },
};

/**
 * No operation that settled before the decision is ever computed by `2.1.0`, whenever the moment it came into
 * force is written (`rank-store.ts`): the moment is the first production ask on or after this instant.
 */
export const REWARD_RULES_V2_1_NOT_BEFORE = "2026-10-17T00:00:00.000Z";

/**
 * `2.2.0` is the decision of 2026-10-27: **the ladder moved one decade down, and nothing else moved.**
 *
 * The shares are `2.1.0`'s to the basis point — cashback 50 %, the inviter 10…30 % by rank, the second level 5 %,
 * the ceiling 85 %, «First $10 back», the inviter's 90 days, the claim floor. Only the points each rank begins at
 * changed: Silver from $100 of received fee to $10, Gold from $1 000 to $100, Sapphire to $1 000, Diamond to
 * $10 000.
 *
 * Why it is a version and not an edit: a rank is a share of a friend's fee, so a ladder is money. A trade that
 * settled under the old ladder must be paid by the old ladder even when it is recorded later — the rank is read as
 * of the moment the trade settled, and these thresholds travel with the rules that moment chose. Nothing already
 * written is recomputed: a rank frozen in an accrual stays frozen.
 */
export const REWARD_RULES_V2_2: RewardRules = {
  ...REWARD_RULES_V2_1,
  version: "2.2.0",
  rankThresholds: { BRONZE: 0n, SILVER: 10n, GOLD: 100n, SAPPHIRE: 1_000n, DIAMOND: 10_000n },
};

/** The decision's own instant: no operation that settled before it is ever computed by `2.2.0`. */
export const REWARD_RULES_V2_2_NOT_BEFORE = "2026-10-27T00:00:00.000Z";

/** The version every new operation is computed by, once it is in force. */
export const REWARD_RULES_CURRENT = REWARD_RULES_V2_2;

export function rewardRulesOf(version: RewardRulesVersion | undefined | null): RewardRules {
  if (version === "2.2.0") return REWARD_RULES_V2_2;
  return version === "2.1.0" ? REWARD_RULES_V2_1 : version === "2.0.0" ? REWARD_RULES_V2 : REWARD_RULES_V1;
}

/**
 * From `2.1.0` on: «First $10 back», the inviter's 90 days, the claim floor, the 85 % ceiling and `fundedBy` on
 * every row. Every later version keeps them, so the question is «at least 2.1.0», never «exactly 2.1.0».
 */
export function hasWindows(rules: RewardRules): boolean {
  return rules.version !== "1.0.0" && rules.version !== "2.0.0";
}

/** The versions a row of a received base can carry: `1.0.0` wrote no `rules` block at all. */
export type StoredRulesVersion = "2.0.0" | "2.1.0" | "2.2.0";

/** The version a row stores — its own rules', so a row always says which rules computed it. */
export function storedVersion(rules: RewardRules): StoredRulesVersion {
  return rules.version === "2.2.0" ? "2.2.0" : rules.version === "2.1.0" ? "2.1.0" : "2.0.0";
}

/**
 * The most one fee can ever pay out, in basis points of its base, outside «First $10 back».
 *
 * For a received base this is the whole of the «payouts ≤ received» rule: if
 * the largest cashback plus the largest inviter share — a rank's, or the
 * inviter's window's — plus the second level fits inside the ceiling, no
 * combination of ranks and windows can pay more.
 */
export function maxPayoutBps(rules: RewardRules): number {
  const inviter = Math.max(...REWARD_RANKS.map((rank) => rules.referralL1BpsByRank[rank]), rules.inviterWindow?.bps ?? 0);
  return rules.cashbackBps + inviter + rules.referralL2Bps;
}

/**
 * The ceiling of one fee's payouts, in basis points of what was received: 85 % from `2.1.0` (the decision —
 * «разом ≤ 85 %»), all of it otherwise; a trade inside «First $10 back» may return all of it (`FIRST_TEN_CEILING_BPS`).
 */
export function payoutCeilingBps(rules: RewardRules): number {
  return hasWindows(rules) ? 8500 : 10_000;
}

export const FIRST_TEN_CEILING_BPS = 10_000;

for (const rules of [REWARD_RULES_V1, REWARD_RULES_V2, REWARD_RULES_V2_1, REWARD_RULES_V2_2]) {
  if (rules.base === "RECEIVED" && maxPayoutBps(rules) > payoutCeilingBps(rules)) {
    throw new Error(`Reward rules ${rules.version} could pay out more than their ceiling of what Ryntra receives.`);
  }
}

/* ------------------------------------------------------------------- ranks */

/** The ladder of rules `1.0.0` … `2.1.0`: the points each rank begins at. Bronze is everyone. */
export const RANK_THRESHOLDS_V1: Readonly<Record<RewardRank, bigint>> = {
  BRONZE: 0n,
  SILVER: 100n,
  GOLD: 1_000n,
  SAPPHIRE: 10_000n,
  DIAMOND: 50_000n,
};

/** The ladder in force: what a person is shown and what a new operation is judged by. */
export const RANK_THRESHOLDS: Readonly<Record<RewardRank, bigint>> = REWARD_RULES_CURRENT.rankThresholds ?? RANK_THRESHOLDS_V1;

/** The ladder of one version of the rules — the one an operation of that version is judged by. */
export function rankThresholdsOf(rules: RewardRules): Readonly<Record<RewardRank, bigint>> {
  return rules.rankThresholds ?? RANK_THRESHOLDS_V1;
}

export const RANK_WINDOW_DAYS = 30;
export const RANK_WINDOW_MS = RANK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** One point per whole dollar of received fee. */
export const RANK_POINTS_PER_USD = 1n;

/**
 * Things that earn points without a fee of the wallet's own or its friends' trades. Written by the caller that
 * knows they happened.
 *
 * `PARTNER_POOL` — Ryntra's received part of a launch pool whose creator this wallet brought (the Ryntra Network),
 * after what the pool's own trades already paid back: one point per whole dollar of it, as for a friend's trade.
 * Its event carries the dollars rather than points, so many small claims add up before they are floored.
 */
export const RANK_EVENT_KINDS = ["LAUNCH_GRADUATED", "PARTNER_POOL"] as const;
export type RankEventKind = (typeof RANK_EVENT_KINDS)[number];

export const RANK_EVENT_POINTS: Readonly<Record<"LAUNCH_GRADUATED", bigint>> = {
  /* A token launched through Ryntra that left its bonding curve for a DEX. */
  LAUNCH_GRADUATED: 250n,
};

/** The rank those points hold, by the ladder of the rules given — the ones in force unless an older operation says otherwise. */
export function rankForPoints(points: bigint, rules: RewardRules = REWARD_RULES_CURRENT): RewardRank {
  const thresholds = rankThresholdsOf(rules);
  let rank: RewardRank = "BRONZE";
  for (const candidate of REWARD_RANKS) if (points >= thresholds[candidate]) rank = candidate;
  return rank;
}

export function nextRank(rank: RewardRank): RewardRank | null {
  return REWARD_RANKS[REWARD_RANKS.indexOf(rank) + 1] ?? null;
}
