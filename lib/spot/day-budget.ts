/**
 * A ceiling on what one instance spends of a paid source in a calendar day (UTC) — the coin page's reads that cost
 * Helius credits or the node's calls. The key behind them is the whole site's: a crowd on one page, or a loop nobody
 * meant, must not spend what every other page stands on.
 *
 * Counted in the process: every instance has its own day, so the deployment's ceiling is this one times its
 * instances — a bound, not a meter. A new UTC day starts from nothing. A read the day does not allow is simply not
 * made: the caller answers as it does when the source is closed or failed, and says nothing to the person.
 *
 * Pure: the clock and the ceiling are the caller's.
 */

const DAY_MS = 86_400_000;

export type DayBudget = Readonly<{
  /** Whether `cost` more still fits under `ceiling` in the day of `now`. */
  allows(cost: number, ceiling: number, now: number): boolean;
  spend(cost: number, now: number): void;
  spent(now: number): number;
  /** Test seam: the day starts over. */
  reset(): void;
}>;

export function dayBudget(): DayBudget {
  let day = -1;
  let spent = 0;
  const turn = (now: number): void => {
    const today = Math.floor(now / DAY_MS);
    if (today !== day) {
      day = today;
      spent = 0;
    }
  };
  return {
    allows(cost, ceiling, now) {
      turn(now);
      return spent + cost <= ceiling;
    },
    spend(cost, now) {
      turn(now);
      if (Number.isFinite(cost) && cost > 0) spent += cost;
    },
    spent(now) {
      turn(now);
      return spent;
    },
    reset() {
      day = -1;
      spent = 0;
    },
  };
}

/** A day's ceiling from a setting: a whole number from nought up; absent or anything else — the default. */
export function dayCeilingOf(value: string | undefined, fallback: number): number {
  const text = value?.trim() ?? "";
  if (!/^\d{1,9}$/.test(text)) return fallback;
  return Number(text);
}
