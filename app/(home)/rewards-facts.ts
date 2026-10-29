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
 * The rank is here for the same reason, and it replaced something else
 * (UX-751, following Ріст 19). This file used to carry `POINTS_EXAMPLE` —
 * «12,480 PTS · LEVEL 03» — a preview of the Points V1 programme, levels and
 * all. The server counts that programme; no screen a person can open draws it.
 * So the landing was selling a balance and a level nobody could go and find,
 * and support was answering «where are my 12,480 points?». What a person
 * actually has is the rank: a dollar of the fee Ryntra received is a rank
 * point, read over a window, and the rank sets the share from a friend's
 * trade. The landing now says that, and the example is gone rather than
 * relabelled — an example of a programme with no screen is the defect, not
 * its wording.
 */
export const REWARDS = {
  feeSharePercent: 50,
  referralLevel1Percent: "10–30",
  referralLevel2Percent: 5,
  /** A dollar of the fee Ryntra received is one rank point (`RANK_POINTS_PER_USD`). */
  rankPointsPerUsd: 1,
  /** The window a rank is read over (`RANK_WINDOW_DAYS`). */
  rankWindowDays: 30,
} as const;
