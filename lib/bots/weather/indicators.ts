/**
 * The three readings the market's weather stands on, each on candles oldest
 * first: Wilder's ADX (how strongly the price goes one way), ATR against its
 * own norm (how hard it swings now against usual), and the share of bars that
 * closed inside a Keltner band (EMA ± a multiple of ATR) — how much of the
 * time the price stayed in a channel.
 *
 * Pure. Floats: a reading, never a sum a transaction is sized from.
 */

import type { Candle } from "../backtest/candles.ts";

export const ADX_PERIOD = 14;
export const ATR_PERIOD = 14;
export const BAND_EMA = 20;
export const BAND_ATR_MULT = 2;

/** Each bar's true range: from the previous close to the bar's own extremes. The first bar has none before it. */
export function trueRanges(candles: readonly Candle[]): number[] {
  return candles.map((bar, i) => {
    const prev = candles[i - 1];
    return prev ? Math.max(bar.h - bar.l, Math.abs(bar.h - prev.c), Math.abs(bar.l - prev.c)) : bar.h - bar.l;
  });
}

/** Wilder's smoothing: the first value the mean of `period`, each next `(prev × (period − 1) + x) / period`. NaN before. */
export function wilder(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + values[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** ATR by Wilder over true ranges from the second bar on (the first has no previous close). */
export function atr(candles: readonly Candle[], period: number = ATR_PERIOD): number[] {
  const tr = trueRanges(candles).slice(1);
  return [Number.NaN, ...wilder(tr, period)];
}

export type AdxPoint = Readonly<{ adx: number; plusDi: number; minusDi: number }>;

/** Wilder's ADX with its +DI and −DI; NaN until `2 × period` bars have passed. */
export function adx(candles: readonly Candle[], period: number = ADX_PERIOD): AdxPoint[] {
  const n = candles.length;
  const nan: AdxPoint = { adx: Number.NaN, plusDi: Number.NaN, minusDi: Number.NaN };
  const out: AdxPoint[] = new Array<AdxPoint>(n).fill(nan);
  if (n < 2 * period + 1) return out;
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const up = candles[i]!.h - candles[i - 1]!.h;
    const down = candles[i - 1]!.l - candles[i]!.l;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRanges(candles).slice(1);
  const trS = wilder(tr, period);
  const plusS = wilder(plusDm, period);
  const minusS = wilder(minusDm, period);
  const dx: number[] = [];
  const di: { plus: number; minus: number }[] = [];
  for (let i = period - 1; i < tr.length; i += 1) {
    const plus = trS[i]! > 0 ? (100 * plusS[i]!) / trS[i]! : 0;
    const minus = trS[i]! > 0 ? (100 * minusS[i]!) / trS[i]! : 0;
    di.push({ plus, minus });
    dx.push(plus + minus > 0 ? (100 * Math.abs(plus - minus)) / (plus + minus) : 0);
  }
  const adxS = wilder(dx, period);
  for (let j = 0; j < dx.length; j += 1) {
    /* dx[j] belongs to bar j + period (one bar of lead for the first difference). */
    if (Number.isFinite(adxS[j]!)) out[j + period] = { adx: adxS[j]!, plusDi: di[j]!.plus, minusDi: di[j]!.minus };
  }
  return out;
}

export function ema(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const median = (values: readonly number[]): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** ATR now against its median over the lookback: 1 — usual, 2 — twice the usual swing. */
export function atrRatio(candles: readonly Candle[], lookback: number, period: number = ATR_PERIOD): number {
  const series = atr(candles, period);
  const now = series[series.length - 1];
  const norm = median(series.slice(-lookback));
  return now !== undefined && Number.isFinite(now) && norm > 0 ? now / norm : Number.NaN;
}

/** The share of the last `lookback` bars that closed inside EMA ± mult × ATR of their own time. */
export function bandShare(candles: readonly Candle[], lookback: number, emaPeriod: number = BAND_EMA, mult: number = BAND_ATR_MULT): number {
  const closes = candles.map((bar) => bar.c);
  const mid = ema(closes, emaPeriod);
  const range = atr(candles);
  let inside = 0;
  let counted = 0;
  for (let i = Math.max(0, candles.length - lookback); i < candles.length; i += 1) {
    if (!Number.isFinite(mid[i]!) || !Number.isFinite(range[i]!)) continue;
    counted += 1;
    if (Math.abs(closes[i]! - mid[i]!) <= mult * range[i]!) inside += 1;
  }
  return counted > 0 ? inside / counted : Number.NaN;
}
