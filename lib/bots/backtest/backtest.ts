/**
 * The honest backtest of a bot over 7, 30 or 180 days of the gateway's
 * candles:
 *
 * - **in-sample** — the person's own setting run over the whole period, fees,
 *   slippage and priority fees in, against holding;
 * - **walk-forward** — the period cut in consecutive windows; the setting for
 *   each window is fitted on the window before it only (a grid's range from
 *   that window's closes), then run on the next. What a bot would have done
 *   without knowing the future it is shown on;
 * - **worst drawdown** — the deepest fall of the bot's value from a high;
 * - **a dollar stress test** — what the bot as it ends would lose if the base
 *   fell by a shock at once («якщо SOL −30 %: ~$X»), the grid's levels buying
 *   on the way down.
 *
 * A grid's figures are labelled «приблизно» (`sim.ts`). Pure.
 */

import type { BacktestPeriod, Candle } from "./candles.ts";
import { coverage } from "./candles.ts";
import {
  DEFAULT_COSTS,
  gridMove,
  gridStart,
  gridValue,
  runGrid,
  simulateDca,
  simulateGrid,
  simulateHold,
  simulateLadder,
  type DcaSetting,
  type ExecutionCosts,
  type GridSetting,
  type GridState,
  type LadderSetting,
  type SimResult,
} from "./sim.ts";

export const WALK_FORWARD_FOLDS = 4;
/** The share of closes left out at each end when a grid's range is fitted: a wick is not the range. */
export const FIT_TRIM = 0.1;
export const STRESS_SHOCK_PCT = 30;

export type BotSetting =
  | Readonly<{ bot: "grid"; grid: GridSetting }>
  | Readonly<{ bot: "ladder"; ladder: LadderSetting }>
  | Readonly<{ bot: "dca"; dca: DcaSetting }>;

export function simulate(candles: readonly Candle[], setting: BotSetting, costs: ExecutionCosts = DEFAULT_COSTS): SimResult | null {
  if (setting.bot === "grid") return simulateGrid(candles, setting.grid, costs);
  if (setting.bot === "ladder") return simulateLadder(candles, setting.ladder, costs);
  return simulateDca(candles, setting.dca, costs);
}

/* ------------------------------------------------------------------ walk-forward */

const quantile = (sorted: readonly number[], q: number): number => {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
};

/** A grid fitted on past candles: its range the closes' 10th to 90th percentile, its levels and amount kept. */
export function fitGrid(past: readonly Candle[], setting: GridSetting): GridSetting | null {
  const closes = past.map((bar) => bar.c).sort((a, b) => a - b);
  if (closes.length < 10) return null;
  const lower = quantile(closes, FIT_TRIM);
  const upper = quantile(closes, 1 - FIT_TRIM);
  return upper > lower ? { ...setting, lower, upper } : null;
}

/**
 * A ladder fitted on past candles: its legs keep their amounts and their distances from the price, re-anchored on the
 * past window's last close. A DCA has nothing to fit.
 */
function fitSetting(past: readonly Candle[], setting: BotSetting, anchor: number): BotSetting | null {
  if (setting.bot === "grid") {
    const grid = fitGrid(past, setting.grid);
    return grid ? { bot: "grid", grid } : null;
  }
  if (setting.bot === "ladder") {
    const close = past[past.length - 1]?.c;
    if (!close) return null;
    return { bot: "ladder", ladder: { ...setting.ladder, legs: setting.ladder.legs.map((leg) => ({ ...leg, price: (leg.price / anchor) * close })) } };
  }
  return setting;
}

export type Fold = Readonly<{ from: number; to: number; result: SimResult; setting: BotSetting }>;

export type WalkForward = Readonly<{
  folds: readonly Fold[];
  pnlUsd: number;
  vsHoldUsd: number;
  /** The worst drawdown of any window. */
  maxDrawdownPct: number;
}>;

/** Fitted on each window, run on the next; null when the period is too short to cut. */
export function walkForward(candles: readonly Candle[], setting: BotSetting, costs: ExecutionCosts = DEFAULT_COSTS, folds: number = WALK_FORWARD_FOLDS): WalkForward | null {
  const size = Math.floor(candles.length / (folds + 1));
  if (size < 10) return null;
  const anchor = candles[0]!.o;
  const out: Fold[] = [];
  for (let k = 1; k <= folds; k += 1) {
    const past = candles.slice((k - 1) * size, k * size);
    const next = candles.slice(k * size, k === folds ? candles.length : (k + 1) * size);
    const fitted = fitSetting(past, setting, anchor);
    const result = fitted ? simulate(next, fitted, costs) : null;
    if (fitted && result) out.push({ from: next[0]!.t, to: next[next.length - 1]!.t, result, setting: fitted });
  }
  if (out.length === 0) return null;
  return {
    folds: out,
    pnlUsd: out.reduce((sum, fold) => sum + fold.result.pnlUsd, 0),
    vsHoldUsd: out.reduce((sum, fold) => sum + fold.result.vsHoldUsd, 0),
    maxDrawdownPct: Math.max(...out.map((fold) => fold.result.maxDrawdownPct)),
  };
}

/* ------------------------------------------------------------------ stress */

export type Stress = Readonly<{
  shockPct: number;
  priceFrom: number;
  priceTo: number;
  /** What the bot would lose, USD; positive is a loss. */
  lossUsd: number;
  line: Readonly<{ uk: string; en: string }>;
}>;

const dollars = (usd: number) => `$${Math.round(Math.abs(usd)).toLocaleString("en-US")}`;

export function stressLine(symbol: string, shockPct: number, lossUsd: number): Readonly<{ uk: string; en: string }> {
  const sign = lossUsd > 0 ? "−" : "+";
  return { uk: `Якщо ${symbol} −${shockPct} %: ~${sign}${dollars(lossUsd)}`, en: `If ${symbol} falls ${shockPct}%: ~${sign}${dollars(lossUsd)}` };
}

/** A grid's loss from a sudden fall: its levels below buy all the way down, at their own prices. */
export function stressGrid(state: GridState, symbol: string, shockPct: number = STRESS_SHOCK_PCT, quoteUsd = 1): Stress {
  const priceTo = state.price * (1 - shockPct / 100);
  const lossUsd = (gridValue(state) - gridValue(gridMove(state, priceTo))) * quoteUsd;
  return { shockPct, priceFrom: state.price, priceTo, lossUsd, line: stressLine(symbol, shockPct, lossUsd) };
}

/** Plain holdings' loss from a sudden fall: the base alone loses. */
export function stressHoldings(holdings: Readonly<{ base: number; price: number }>, symbol: string, shockPct: number = STRESS_SHOCK_PCT, quoteUsd = 1): Stress {
  const lossUsd = holdings.base * holdings.price * (shockPct / 100) * quoteUsd;
  return { shockPct, priceFrom: holdings.price, priceTo: holdings.price * (1 - shockPct / 100), lossUsd, line: stressLine(symbol, shockPct, lossUsd) };
}

/* ------------------------------------------------------------------ the backtest */

export type Backtest = Readonly<{
  period: BacktestPeriod;
  /** Bars the gateway holds of the period, 0–1. */
  coverage: number;
  result: SimResult;
  hold: SimResult | null;
  walkForward: WalkForward | null;
  stress: Stress;
  approximate: boolean;
  /** «приблизно» on a grid's figures; null elsewhere. */
  label: Readonly<{ uk: string; en: string }> | null;
}>;

export function backtest(
  candles: readonly Candle[],
  setting: BotSetting,
  args: Readonly<{ period: BacktestPeriod; symbol: string; costs?: ExecutionCosts; shockPct?: number }>,
): Backtest | null {
  const costs = args.costs ?? DEFAULT_COSTS;
  const result = simulate(candles, setting, costs);
  if (!result) return null;
  const first = candles[0]!;
  const startQuote = result.startUsd / costs.quoteUsd;
  let stress: Stress;
  if (setting.bot === "grid") {
    /* Replay to the end to stand where the grid stands, then shock it. */
    stress = stressGrid(runGrid(gridStart(setting.grid, first.o, costs.poolFeeBps), candles), args.symbol, args.shockPct, costs.quoteUsd);
  } else {
    stress = stressHoldings(result.end, args.symbol, args.shockPct, costs.quoteUsd);
  }
  return {
    period: args.period,
    coverage: coverage(candles, args.period),
    result,
    hold: simulateHold(candles, startQuote, costs),
    walkForward: walkForward(candles, setting, costs),
    stress,
    approximate: result.approximate,
    label: result.approximate ? { uk: "приблизно", en: "approximate" } : null,
  };
}
