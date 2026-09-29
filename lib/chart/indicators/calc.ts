/* Indicator math. Pure functions, no value imports — this file is imported by
   Node tests via native type stripping, so only erasable TS syntax is allowed.
   Input: NormalizedCandle[] oldest-first. Output points align to candle times,
   starting at the first defined value (LWC tolerates late-starting series). */

import type { NormalizedCandle, LinePoint, HistogramPoint } from "../types";

export function sma(candles: NormalizedCandle[], period: number): LinePoint[] {
  if (period < 1 || candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles: NormalizedCandle[], period: number): LinePoint[] {
  if (period < 1 || candles.length < period) return [];
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  let prev = seed / period;
  const out: LinePoint[] = [{ time: candles[period - 1].time, value: prev }];
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

export function wma(candles: NormalizedCandle[], period: number): LinePoint[] {
  if (period < 1 || candles.length < period) return [];
  const denom = (period * (period + 1)) / 2;
  const out: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += candles[i - period + 1 + j].close * (j + 1);
    out.push({ time: candles[i].time, value: acc / denom });
  }
  return out;
}

/** Population std dev over the window (matches TradingView), not sample. */
export function bollinger(
  candles: NormalizedCandle[],
  period = 20,
  mult = 2,
): { basis: LinePoint[]; upper: LinePoint[]; lower: LinePoint[] } {
  const basis = sma(candles, period);
  const upper: LinePoint[] = [];
  const lower: LinePoint[] = [];
  for (let b = 0; b < basis.length; b++) {
    const i = b + period - 1;
    const mean = basis[b].value;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    upper.push({ time: basis[b].time, value: mean + mult * sd });
    lower.push({ time: basis[b].time, value: mean - mult * sd });
  }
  return { basis, upper, lower };
}

/** Session VWAP anchored to the UTC day; cumulative sums reset at day change. */
export function vwap(candles: NormalizedCandle[]): LinePoint[] {
  if (!hasVolume(candles)) return [];
  const out: LinePoint[] = [];
  let day = Number.NaN;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const d = Math.floor(c.time / 86_400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const v = c.volume ?? 0;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;
    if (vol > 0) out.push({ time: c.time, value: pv / vol });
  }
  return out;
}

/** Wilder RSI: seed averages = simple mean of first `period` changes,
    then avg = (prev*(n-1)+cur)/n. down==0 → 100, up==0 → 0 (Pine convention). */
export function rsi(candles: NormalizedCandle[], period = 14): LinePoint[] {
  if (period < 1 || candles.length < period + 1) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  const toRsi = (): number =>
    avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  const out: LinePoint[] = [{ time: candles[period].time, value: toRsi() }];
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (ch > 0 ? ch : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    out.push({ time: candles[i].time, value: toRsi() });
  }
  return out;
}

export function macd(
  candles: NormalizedCandle[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: LinePoint[]; signal: LinePoint[]; hist: LinePoint[] } {
  const startIdx = Math.max(fast, slow) - 1; // tolerate fast >= slow from stale persisted params
  if (candles.length <= startIdx) return { macd: [], signal: [], hist: [] };
  const fastE = ema(candles, fast);
  const slowE = ema(candles, slow);
  const macdLine: LinePoint[] = [];
  for (let i = startIdx; i < candles.length; i++) {
    macdLine.push({
      time: candles[i].time,
      value: fastE[i - fast + 1].value - slowE[i - slow + 1].value,
    });
  }
  if (macdLine.length < signal) return { macd: macdLine, signal: [], hist: [] };
  const k = 2 / (signal + 1);
  let seed = 0;
  for (let i = 0; i < signal; i++) seed += macdLine[i].value;
  let prev = seed / signal;
  const signalLine: LinePoint[] = [{ time: macdLine[signal - 1].time, value: prev }];
  for (let i = signal; i < macdLine.length; i++) {
    prev = macdLine[i].value * k + prev * (1 - k);
    signalLine.push({ time: macdLine[i].time, value: prev });
  }
  const histOffset = macdLine.length - signalLine.length;
  const hist: LinePoint[] = signalLine.map((p, i) => ({
    time: p.time,
    value: macdLine[i + histOffset].value - p.value,
  }));
  return { macd: macdLine, signal: signalLine, hist };
}

/** ATR with Wilder smoothing. TR[0] = high-low (no prior close). */
export function atr(candles: NormalizedCandle[], period = 14): LinePoint[] {
  if (period < 1 || candles.length < period) return [];
  const tr: number[] = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  let prev = seed / period;
  const out: LinePoint[] = [{ time: candles[period - 1].time, value: prev }];
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

export function volumeHistogram(
  candles: NormalizedCandle[],
  up: string,
  down: string,
): HistogramPoint[] {
  if (!hasVolume(candles)) return [];
  return candles.map((c) => ({
    time: c.time,
    value: c.volume ?? 0,
    color: c.close >= c.open ? up : down,
  }));
}

export function hasVolume(candles: NormalizedCandle[]): boolean {
  return candles.some((c) => typeof c.volume === "number" && Number.isFinite(c.volume) && c.volume > 0);
}
