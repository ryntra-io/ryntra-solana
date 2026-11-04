/**
 * Smart DCA (spec «Каталог етапу A»: rules — the dip, a condition, a budget —
 * and a ladder). Two legs of one budget:
 *
 * - **the ladder** — a share of the budget as a buy ladder under the price,
 *   placed once and filled by the pool by itself (`plan.ts`);
 * - **the time leg** — the rest, as reminders: a buy every few hours that the
 *   person answers with one tap. Bigger when the price sits under its recent
 *   average, smaller over it, and skipped while the price is above the ceiling
 *   the person set. Time-based DCA without anyone holding the money is not
 *   possible on chain today (Jupiter's Recurring V1 is gone and Trigger V2 is
 *   custodial), so this leg is never automatic here.
 *
 * Pure.
 */

export type SmartDcaRules = Readonly<{
  budgetUsd: number;
  /** Share of the budget placed as the ladder, percent; the rest is the time leg. */
  ladderPct: number;
  everyHours: number;
  buys: number;
  /** The time leg buys only while the price is at most this far over the start, percent; null — at any price. */
  ceilingPct: number | null;
}>;

export const SMART_LADDER_PCTS = [0, 30, 50, 70] as const;
export const SMART_DEFAULT_LADDER_PCT = 50;
/** How far a time-leg buy leans with the price against its recent average: half at most, double at most. */
export const DIP_FACTOR_MIN = 0.5;
export const DIP_FACTOR_MAX = 2;

export type SmartSplit = Readonly<{ ladderUsd: number; timeUsd: number; perBuyUsd: number }>;

export function smartSplit(rules: SmartDcaRules): SmartSplit {
  const share = Math.min(100, Math.max(0, rules.ladderPct)) / 100;
  const ladderUsd = rules.budgetUsd * share;
  const timeUsd = rules.budgetUsd - ladderUsd;
  return { ladderUsd, timeUsd, perBuyUsd: rules.buys > 0 ? timeUsd / rules.buys : 0 };
}

/** The lean of a time-leg buy: (average ÷ price)², kept between half and double. */
export function dipFactor(price: number, average: number): number {
  if (!(price > 0) || !(average > 0)) return 1;
  return Math.max(DIP_FACTOR_MIN, Math.min(DIP_FACTOR_MAX, (average / price) ** 2));
}

/**
 * Dollars the next reminder asks for: the even share leaned by the dip, never past what is left of the time leg, and
 * nothing while the price is over the ceiling.
 */
export function timeLegBuyUsd(
  args: Readonly<{ perBuyUsd: number; price: number; average: number; startPrice: number; ceilingPct: number | null; leftUsd: number }>,
): number {
  if (!(args.leftUsd > 0) || !(args.price > 0)) return 0;
  if (args.ceilingPct !== null && args.startPrice > 0 && args.price > args.startPrice * (1 + args.ceilingPct / 100)) return 0;
  return Math.min(args.leftUsd, args.perBuyUsd * dipFactor(args.price, args.average));
}
