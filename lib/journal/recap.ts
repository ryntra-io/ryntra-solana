/* Daily discipline recap — the calm end-of-day digest (market-playbook-journal §4: "Recap as a
   calm daily digest … 4-6 lines, one number that matters (adherence %), one constructive
   next-step. Never a guilt-trip; 'best trade tomorrow' register").

   This module is PURE: it decides WHETHER to recap and WHICH single next-step to give. The
   localized wording lives in lib/beta/texts.ts (BETA_COPY[lang].dailyRecap). Honesty rules:
   - Discipline is the metric — never profit. The recap leads with plan-adherence, not returns.
   - No data → no message. A user with nothing to review is not pinged (no manufactured noise).
   - One next-step only, never a scold. The advice is the most actionable gap, in a calm register. */

export type RecapStats = {
  /** plan-adherence %, 0–100, or null when no closed trade has a plan flag yet. */
  adherencePct: number | null;
  /** win-rate %, 0–100, or null. Shown as context, never as the headline. */
  winRatePct: number | null;
  /** closed paper trades. */
  trades: number;
  /** how many closed trades carry a journal review (followed-plan flag / note). */
  journaled: number;
};

/** The single constructive next-step, chosen by the most actionable gap. */
export type RecapAdvice =
  | "flag-plans" // no plan flags yet → unlock the discipline signal
  | "review-open" // some closed trades still un-reviewed → finish the review
  | "on-plan" // fully reviewed + adherence healthy → affirm, keep the habit
  | "discipline-slipped"; // fully reviewed + adherence low → gentle, no guilt

export type RecapData = {
  adherencePct: number | null;
  winRatePct: number | null;
  trades: number;
  /** closed trades still lacking a review (trades − journaled, floored at 0). */
  unreviewed: number;
  advice: RecapAdvice;
};

/** Plan-adherence at/above this reads as "on plan" (mirrors the journal scorecard threshold). */
export const ADHERENCE_GOOD = 60;

/**
 * Build the recap payload, or null when there is nothing worth sending (no closed trades).
 * Advice priority = most fundamental gap first: no flags at all → flag them; else un-reviewed
 * trades → review them; else affirm or gently nudge on adherence.
 */
export function buildRecap(s: RecapStats): RecapData | null {
  if (s.trades <= 0) return null; // nothing to recap — never ping an inactive user
  const unreviewed = Math.max(0, s.trades - s.journaled);
  let advice: RecapAdvice;
  if (s.adherencePct == null) advice = "flag-plans";
  else if (unreviewed > 0) advice = "review-open";
  else if (s.adherencePct >= ADHERENCE_GOOD) advice = "on-plan";
  else advice = "discipline-slipped";
  return { adherencePct: s.adherencePct, winRatePct: s.winRatePct, trades: s.trades, unreviewed, advice };
}
