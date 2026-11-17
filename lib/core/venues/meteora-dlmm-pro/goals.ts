/**
 * What the money is for, on a DLMM Pro pool: a person says a goal and how close to the price, never a
 * shape, a tick or a count of ranges.
 *
 * The words are the city's own (`city/lib/earn/pier.ts`): **Even** — the same at every price of the range;
 * **Near price** — most by the price, for a pair that moves little; **Catch moves** — most at the edges, for a pair
 * that swings. And three widths: **Calm** · **Balanced** · **Dense** — 34 · 16 · 5 steps of the pool's tick spacing
 * on each side of the price, the same counts the city's other piers use for bins.
 *
 * A goal becomes one position: one NFT that holds the whole shape in a few ranges. How many is a cost, not a detail —
 * every range keeps rent until the position is closed (0.004552 SOL each on mainnet, 14.11.2026) — so an even shape
 * is the one range it always merges into, and the two that thin or thicken are drawn in at most seven steps. Seven
 * ranges and the pool's two sides fit one transaction with the deposit (`REHEARSAL.md` §12: up to 15 do).
 *
 * Pure: no I/O, no clock, no SDK.
 */

import type { ShapeRequest, ShapeStrategy } from "./shapes.server.ts";
import { MAX_TICK_ID, MIN_TICK_ID, alignTickDown } from "./ticks.ts";

export const EARN_GOALS = ["even", "near", "edges"] as const;
export type EarnGoal = (typeof EARN_GOALS)[number];

export const EARN_STYLES = ["calm", "balanced", "dense"] as const;
export type EarnStyle = (typeof EARN_STYLES)[number];

/** The shape each goal is drawn in. */
export const GOAL_STRATEGY: Readonly<Record<EarnGoal, ShapeStrategy>> = { even: "spot", near: "curve", edges: "bidAsk" };

/** Steps of the pool's tick spacing on each side of the price. */
export const STYLE_STEPS: Readonly<Record<EarnStyle, number>> = { calm: 34, balanced: 16, dense: 5 };

/** The most ranges a goal's position takes: an even shape is one range whatever its width. */
export const GOAL_MAX_RANGES: Readonly<Record<EarnGoal, number>> = { even: 1, near: 7, edges: 7 };

export const isEarnGoal = (value: unknown): value is EarnGoal => typeof value === "string" && (EARN_GOALS as readonly string[]).includes(value);
export const isEarnStyle = (value: unknown): value is EarnStyle => typeof value === "string" && (EARN_STYLES as readonly string[]).includes(value);

export type GoalPlan = Readonly<{
  goal: EarnGoal;
  style: EarnStyle;
  shape: ShapeRequest;
  maxRanges: number;
  /** The range the position earns in: its first tick and the tick just past its last step. */
  tickLowerId: number;
  tickUpperId: number;
  /** The same as a share of the price, basis points: how far down and how far up the price may go before the position stops earning. */
  downBps: number;
  upBps: number;
}>;

/** How far a move of `ticks` ticks takes the price, basis points of the price; a tick is a ten-thousandth. */
const bpsOfTicks = (ticks: number): number => Math.round((Math.pow(1.0001, ticks) - 1) * 10_000);

/**
 * The shape a goal and a style ask for on a pool at `tickCurrentId`: the step the price stands in, and the style's
 * steps on each side of it. Where the pool's price stands too close to the program's first or last tick for the whole
 * width, the range is cut there — and null where nothing of it is left on a side: a goal around the price needs both.
 */
export function goalPlanOf(goal: EarnGoal, style: EarnStyle, pool: Readonly<{ tickSpacing: number; tickCurrentId: number }>): GoalPlan | null {
  const spacing = pool.tickSpacing;
  if (!Number.isInteger(spacing) || spacing < 1 || !Number.isInteger(pool.tickCurrentId)) return null;
  const steps = STYLE_STEPS[style];
  const here = alignTickDown(pool.tickCurrentId, spacing);
  /* The first and the last tick a pool of this spacing can use; the last step reaches one spacing above `maxTickId`. */
  const first = Math.ceil(MIN_TICK_ID / spacing) * spacing;
  const last = Math.floor(MAX_TICK_ID / spacing) * spacing - spacing;
  const minTickId = Math.max(first, here - steps * spacing);
  const maxTickId = Math.min(last, here + steps * spacing);
  if (minTickId >= here || maxTickId <= here) return null;
  const tickUpperId = maxTickId + spacing;
  return {
    goal,
    style,
    shape: { strategy: GOAL_STRATEGY[goal], minTickId, maxTickId },
    maxRanges: GOAL_MAX_RANGES[goal],
    tickLowerId: minTickId,
    tickUpperId,
    downBps: -bpsOfTicks(minTickId - pool.tickCurrentId),
    upBps: bpsOfTicks(tickUpperId - pool.tickCurrentId),
  };
}

/**
 * The band of the price a deposit of a goal is built for, basis points either way: the person's own tolerance, never
 * wider than an eighth of the way to the range's nearer edge, and never nothing.
 *
 * A deposit is sized so that the wallet can pay for it at both ends of its band, and takes what the price it lands at
 * asks for: the rest of the two budgets stays in the wallet. How much stays follows the band over the range's
 * half-width — a band half as wide as the way to the edge leaves a third of the money out (rehearsed: 0.49 of 2 SOL),
 * an eighth leaves about a tenth. So a narrow range is given a narrow band: a price that leaves it before the deposit
 * lands refuses the deposit, and nothing is lost by that but the network fee.
 */
export const GOAL_BAND_SHARE = 8;
/**
 * The same for a deposit the program sizes at the price it lands at — a position of one range, the «Even» goal: it
 * takes the most both budgets afford there, so the band costs nothing by itself and may be twice as wide — a quarter
 * of the way to the nearer edge. What a move inside it leaves out is only the coin the new price asks less of.
 */
export const GOAL_BAND_SHARE_AT_LANDING = 4;

export function goalBandBps(plan: Pick<GoalPlan, "downBps" | "upBps">, askedBps: number, share: number = GOAL_BAND_SHARE): number {
  const most = Math.max(1, Math.floor(Math.min(plan.downBps, plan.upBps) / share));
  return Math.max(1, Math.min(askedBps, most));
}

/** Whether a goal's deposit is sized by the program at the price it lands at: a shape of one range is. */
export const sizedAtLanding = (plan: Pick<GoalPlan, "maxRanges">): boolean => plan.maxRanges === 1;
