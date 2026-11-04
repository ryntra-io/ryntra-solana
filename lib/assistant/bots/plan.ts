/**
 * A bot's settings as Ryntra sizes them (CITY-133, B3): relative to the price
 * the bot starts at, so the same plan replays honestly on any past window —
 * «had you started this a month ago» — and becomes a draft at today's price.
 *
 * The size comes from the engine's candles only: a typical day's move, the
 * week's low and high. Nothing here reads, signs or sends; the person
 * changes every figure in the window's review before anything starts. Pure.
 */

import type { Candle } from "../../bots/backtest/candles.ts";
import type { BotSetting } from "../../bots/backtest/backtest.ts";
import { HORIZONS, type AssistantBotKind, type Horizon } from "./kinds.ts";

/* ------------------------------------------------------------------ the week's size */

export type WeekSize = Readonly<{
  /** A typical day's move, percent (the bars' swings scaled to a day). */
  dayMovePct: number;
  low: number;
  high: number;
  /** The newest close: the price a draft is sized at. */
  price: number;
  /** The newest bar's open, ms. */
  at: number;
}>;

/** The size of the engine's bars: a typical day's move, the low, the high and the last close; null on fewer than two. */
export function weekSize(candles: readonly Candle[]): WeekSize | null {
  if (candles.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i += 1) returns.push(Math.log(candles[i]!.c / candles[i - 1]!.c));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const stepHours = Math.max(1 / 60, (candles[candles.length - 1]!.t - candles[0]!.t) / 3_600_000 / (candles.length - 1));
  let low = Infinity;
  let high = -Infinity;
  for (const bar of candles) {
    low = Math.min(low, bar.l);
    high = Math.max(high, bar.h);
  }
  const last = candles[candles.length - 1]!;
  return { dayMovePct: Math.sqrt(variance) * Math.sqrt(24 / stepHours) * 100, low, high, price: last.c, at: last.t };
}

/* ------------------------------------------------------------------ plans */

/** Percents from the start price, so a plan replays on any window. */
export type Plan =
  | Readonly<{ kind: "grid"; lowerPct: number; upperPct: number; levels: number }>
  | Readonly<{ kind: "buyLadder"; steps: number; firstPct: number; lastPct: number }>
  | Readonly<{ kind: "exitLadder"; steps: number; firstPct: number; lastPct: number }>
  | Readonly<{ kind: "recurring"; everyHours: number; buys: number }>;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/** The window's grid levels by amount (`city/lib/bots/draft.ts` `GRID_LEVELS`): more levels need more money to be worth a fill. */
const levelsFor = (amountUsd: number) => (amountUsd < 250 ? 10 : amountUsd < 2_000 ? 16 : 24);

/** The window's schedules (`EVERY_HOURS`): daily for a week, every three days for a month, weekly for half a year. */
const EVERY: Readonly<Record<Horizon, number>> = { week: 24, month: 72, half_year: 168 };

/**
 * A plan sized to the amount and the horizon from the engine's typical daily move (4 % where it was not measured):
 * a grid's half-width grows with the square root of the days; ladders step by about a day's move, wider for longer.
 */
export function planFor(kind: AssistantBotKind, amountUsd: number, horizon: Horizon, dayMovePct: number | null): Plan {
  const days = HORIZONS[horizon];
  const day = dayMovePct !== null && Number.isFinite(dayMovePct) && dayMovePct > 0 ? clamp(dayMovePct, 1.5, 15) : 4;
  const stretch = Math.sqrt(days / 7);
  switch (kind) {
    case "grid": {
      const width = clamp(Math.round(day * Math.sqrt(days) * 0.75), 3, 60);
      return { kind, lowerPct: width, upperPct: width, levels: levelsFor(amountUsd) };
    }
    case "buyLadder": {
      const first = round1(clamp((day / 2) * stretch, 0.5, 30));
      return { kind, steps: amountUsd < 100 ? 4 : 5, firstPct: first, lastPct: round1(clamp(day * 3 * stretch, first + 1, 60)) };
    }
    case "exitLadder": {
      const first = round1(clamp(day * stretch, 1, 60));
      return { kind, steps: 4, firstPct: first, lastPct: round1(clamp(day * 4 * stretch, first + 1, 200)) };
    }
    case "recurring": {
      const every = EVERY[horizon];
      return { kind, everyHours: every, buys: clamp(Math.ceil((days * 24) / every), 2, 60) };
    }
  }
}

/** `steps` evenly spaced percents from `first` to `last`. */
export function spread(first: number, last: number, steps: number): number[] {
  if (steps <= 1) return [first];
  return Array.from({ length: steps }, (_, i) => first + ((last - first) * i) / (steps - 1));
}

/**
 * The plan as the engine's backtest takes it, for a window that starts at `startPrice` on bars `barHours` long:
 * a grid around the start, a ladder's legs from it (DLMM limit bins first, as the window's live bots will), a
 * recurring buy that spends the amount over the window.
 */
export function engineSetting(plan: Plan, amountUsd: number, startPrice: number, bars: number, barHours: number): BotSetting | null {
  if (!(amountUsd > 0) || !(startPrice > 0)) return null;
  switch (plan.kind) {
    case "grid":
      return { bot: "grid", grid: { lower: startPrice * (1 - plan.lowerPct / 100), upper: startPrice * (1 + plan.upperPct / 100), levels: plan.levels, side: "both", amountQuote: amountUsd } };
    case "buyLadder":
      return { bot: "ladder", ladder: { venue: "dlmm", legs: spread(plan.firstPct, plan.lastPct, plan.steps).map((pct) => ({ side: "buy" as const, price: startPrice * (1 - pct / 100), amount: amountUsd / plan.steps })) } };
    case "exitLadder": {
      const base = amountUsd / startPrice;
      return { bot: "ladder", ladder: { venue: "dlmm", legs: spread(plan.firstPct, plan.lastPct, plan.steps).map((pct) => ({ side: "sell" as const, price: startPrice * (1 + pct / 100), amount: base / plan.steps })) } };
    }
    case "recurring": {
      const everyBars = Math.max(1, Math.round(plan.everyHours / barHours));
      return { bot: "dca", dca: { everyBars, amountQuote: amountUsd / Math.max(1, Math.ceil(bars / everyBars)) } };
    }
  }
}

/** A price with enough significant digits for its size. */
export function priceRound(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const digits = Math.min(12, Math.max(0, 4 - Math.floor(Math.log10(value))));
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
