/* Adherence-vs-outcome — the journal's hero signal (market-playbook-journal §4): does following
   your own pre-trade plan correlate with winning, in YOUR data? Splits closed trades into two
   cohorts by the plan-adherence flag and reports each cohort's win-rate.

   Honesty rules baked in (capability-honesty · playbook "never/always"):
   - This measures DISCIPLINE, not profit. Win-rate is a behavioral signal; the promise is fewer
     avoidable losses over time, never returns. Callers must not frame it as "journal your way to
     profits".
   - A tiny cohort is noise. Below MIN_COHORT per side we do NOT claim a correlation — `sufficient`
     is false and the delta must be presented as "not enough data yet", never as proof.
   - The direction is REPORTED, not assumed. If broke-plan happens to out-win followed-plan over a
     short stretch, we surface the real numbers plainly (a short run can invert; discipline is a
     long-run edge) — we never fabricate "discipline paid" when the data doesn't show it. */

/** One closed trade reduced to what the cohort split needs. `won` = the trade closed in profit
    (pnl > 0); break-even/loss are both "not won". `followedPlan` null = no plan flag recorded
    (that trade is excluded from both cohorts — an unflagged trade is not evidence either way). */
export type AdherenceTrade = { followedPlan: boolean | null; won: boolean };

export type CohortStat = {
  /** trades in this cohort (with a non-null flag). */
  n: number;
  wins: number;
  /** wins / n as a 0–100 number, or null when the cohort is empty. */
  winRatePct: number | null;
};

export type AdherenceReport = {
  followed: CohortStat;
  broke: CohortStat;
  /** trades that carried a plan flag (followed.n + broke.n). */
  flagged: number;
  /** closed trades with NO plan flag — surfaced honestly as "flag these to include them". */
  unflagged: number;
  /** followed.winRatePct − broke.winRatePct in points; null unless BOTH cohorts are non-empty. */
  deltaPts: number | null;
  /** both cohorts reached MIN_COHORT → the comparison is worth reading as a signal (still not proof). */
  sufficient: boolean;
};

/** Minimum trades per cohort before the delta is presented as a (still-preliminary) signal
    rather than noise. Deliberately not "statistical significance" — this is a personal behavioral
    journal, not a study; the copy stays hedged ("so far", "firms up over more trades") even above
    the floor. Kept modest so it's reachable through practice, raised from an earlier 3 (too thin
    to license any directional wording). */
export const MIN_COHORT = 5;

function cohort(trades: AdherenceTrade[]): CohortStat {
  const n = trades.length;
  const wins = trades.reduce((acc, t) => acc + (t.won ? 1 : 0), 0);
  return { n, wins, winRatePct: n > 0 ? (wins / n) * 100 : null };
}

export function adherenceOutcome(trades: AdherenceTrade[]): AdherenceReport {
  const flaggedTrades = trades.filter((t) => t.followedPlan != null);
  const followed = cohort(flaggedTrades.filter((t) => t.followedPlan === true));
  const broke = cohort(flaggedTrades.filter((t) => t.followedPlan === false));
  const deltaPts =
    followed.winRatePct != null && broke.winRatePct != null
      ? followed.winRatePct - broke.winRatePct
      : null;
  return {
    followed,
    broke,
    flagged: flaggedTrades.length,
    unflagged: trades.length - flaggedTrades.length,
    deltaPts,
    sufficient: followed.n >= MIN_COHORT && broke.n >= MIN_COHORT,
  };
}
