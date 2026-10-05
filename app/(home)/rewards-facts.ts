import { POINTS_POLICY_V1, levelFor } from "../../lib/points/policy.ts";

/**
 * What the fourth block says in numbers, and where each number comes from.
 *
 * The three shares are the programme's own rates — the rules in force,
 * declared once in `lib/rewards/rules.ts` as basis points of the fee Ryntra
 * received; the inviter's share runs by the inviter's rank, so it reads as
 * the range from Bronze to Diamond. They are written here rather than
 * imported so the landing carries no rewards code; rewards.test.mjs holds the
 * two in agreement, so a changed rate cannot leave the page saying the old one.
 *
 * The points figure is an example — a preview of the Points panel, not a
 * balance — and is marked as such on the page. Its level and the total the
 * next level begins at are read from the live policy through `levelFor`, so
 * the example can never show a level the policy does not have.
 */
export const REWARDS = {
  feeSharePercent: 50,
  referralLevel1Percent: "10–30",
  referralLevel2Percent: 5,
} as const;

/** One illustrative lifetime total, easy to change. */
export const POINTS_EXAMPLE = 12_480n;

const placed = levelFor(POINTS_POLICY_V1, POINTS_EXAMPLE);
const levelStart = POINTS_POLICY_V1.levels[placed.level - 1] ?? 0n;

export const POINTS = {
  total: Number(POINTS_EXAMPLE),
  level: placed.level,
  nextAt: placed.nextAt === null ? null : Number(placed.nextAt),
  /** How far the example sits between its level's start and the next one, 0–1. */
  progress: placed.nextAt === null ? 1 : Number(POINTS_EXAMPLE - levelStart) / Number(placed.nextAt - levelStart),
} as const;
