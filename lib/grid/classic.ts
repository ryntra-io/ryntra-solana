/**
 * The grid where a coin has no DLMM Pro pool: the same band and levels, as the two legs of a ladder of Meteora DLMM limit
 * orders — the engine «Order ladder» already runs on mainnet (`lib/bots/ladder/`). One form, two venues: the
 * person picks the coin, not the venue.
 *
 * What the classic venue gives and does not:
 * - buys and sells in one approval: the ladder's Review takes a buy leg and an exit leg together;
 * - from 2 to 12 prices on a side (`LADDER_MIN_STEPS`, `LADDER_MAX_STEPS`), each on a bin of the pool;
 * - no maker's bonus; what filled is taken back only with its order, whole — so «place again» on this venue takes the
 *   grid back and places it again around the price, one tap and two approvals.
 *
 * Pure: no I/O. The legs are the ladder's own type; `planLeg` makes their bins.
 */

import { LADDER_MAX_STEPS, LADDER_MIN_STEPS, legIssues, planIssues, planLeg, type LadderLeg, type LadderPool, type LegPlan } from '../bots/ladder/plan.ts';

import { onLevels, type GridPlan } from './plan.ts';

export type ClassicIssue = 'classicSide' | 'classicStep';

/** A side's levels as a ladder leg: its nearest and farthest price as percents from the price, a step a level, even. */
function legOf(levels: readonly number[], price: number, side: 'buy' | 'exit', amountRaw: bigint): LadderLeg | null {
  if (!levels.length || amountRaw <= 0n) return null;
  const pcts = levels.map((level) => Math.abs(level / price - 1) * 100).sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { side, steps: levels.length, firstPct: round(pcts[0]!), lastPct: round(pcts[pcts.length - 1]!), shape: 'even', amountRaw: amountRaw.toString() };
}

export type ClassicGrid = Readonly<{ legs: readonly LadderLeg[]; plans: readonly LegPlan[]; issue: ClassicIssue | null }>;

/**
 * The grid's plan as the classic ladder's legs on a pool: the buys a buy leg resting the quote coin, the sells an exit
 * leg resting the coin. A side of one level, or of more than twelve, is not a leg the ladder takes; levels closer than
 * the pool's bins become fewer prices — both said, never placed otherwise.
 */
export function classicGrid(plan: GridPlan, price: number, pool: LadderPool): ClassicGrid {
  const sides = [plan.split.buys.length, plan.split.sells.length].filter((n) => n > 0);
  if (sides.some((n) => n < LADDER_MIN_STEPS || n > LADDER_MAX_STEPS)) return { legs: [], plans: [], issue: 'classicSide' };
  const legs = [legOf(plan.split.buys, price, 'buy', plan.put.quoteRaw), legOf(plan.split.sells, price, 'exit', plan.put.coinRaw)].filter((leg): leg is LadderLeg => leg !== null);
  const plans: LegPlan[] = [];
  for (const leg of legs) {
    if (legIssues(leg).length) return { legs: [], plans: [], issue: 'classicStep' };
    const planned = planLeg(leg, pool);
    if (!planned || planned.rungs.length < leg.steps || planIssues(planned, pool).length) return { legs: [], plans: [], issue: 'classicStep' };
    /* The ladder spaces its steps evenly in percent, the grid in ratio: on a wide band they part — the legs must still stand on the levels. */
    const levels = leg.side === 'buy' ? plan.split.buys : plan.split.sells;
    if (!onLevels(planned.rungs.map((rung) => rung.price), levels, leg.steps, plan.step)) return { legs: [], plans: [], issue: 'classicStep' };
    plans.push(planned);
  }
  return { legs, plans, issue: null };
}
