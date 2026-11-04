import { simulateBins } from '../../../lib/liquidity/catalog/simulate.ts';
import { candlesOf } from '../chart/candles.ts';
import type { Pier, PierStyle } from './pier.ts';
import { STYLE_HALF } from './pier.ts';

/**
 * «Past 30 days» (CITY-93): what a style would have done had the position opened thirty days ago — a picture from the
 * past, never a forecast. The price path is the engine's own candle read (`/api/spot/candles`, four-hour bars) of the
 * pier's coins in dollars, turned into the pool's price (Y per X): SOL–USDC is SOL's own line; LST–SOL is the LST's
 * line over SOL's, bar by bar at the same hour. From it: the band the style takes around the price on day one, the
 * share of the month the price stayed inside it, and where the position stood against just holding at the end —
 * before fees, which Meteora states for the last day only, so the picture never invents them.
 *
 * Pure: the candles are passed in.
 */

/** Four-hour bars over thirty days. */
export const HISTORY_TIMEFRAME = '4h';
export const HISTORY_BARS = 180;
/** Less than a week of bars is no month: the picture is left out. */
export const HISTORY_MIN_BARS = 42;

export type PricePoint = Readonly<{ t: number; p: number }>;

/** Closes by bar time, from one answer of `/api/spot/candles`; empty when the answer is not one. */
export function closesOf(body: unknown): Map<number, number> {
  const candles = candlesOf(body && typeof body === 'object' ? (body as { candles?: unknown }).candles : null);
  return new Map(candles.map((c) => [Number(c.time), c.close]));
}

/**
 * The pool's price over time, Y per X, from the dollar closes of the pier's coins. USDC stands for one dollar and is
 * not read; an LST's close is divided by SOL's close of the same bar — a bar missing on either side is left out.
 */
export function pierSeries(pier: Pier, sol: ReadonlyMap<number, number>, other: ReadonlyMap<number, number> | null): PricePoint[] {
  const points: PricePoint[] = [];
  for (const [t, solClose] of sol) {
    if (!(solClose > 0)) continue;
    let p: number;
    if (pier.pair === 'usdc') {
      // SOL–USDC: X is SOL, so the price is dollars per SOL; were USDC the X side it would be SOL per dollar.
      p = pier.solSide === 'x' ? solClose : 1 / solClose;
    } else {
      const lstClose = other?.get(t);
      if (!(lstClose && lstClose > 0)) continue;
      p = pier.solSide === 'y' ? lstClose / solClose : solClose / lstClose;
    }
    if (Number.isFinite(p) && p > 0) points.push({ t, p });
  }
  return points.sort((a, b) => a.t - b.t).slice(-HISTORY_BARS);
}

export type HistoryPicture = Readonly<{
  points: readonly PricePoint[];
  /** The band the style took around the first price. */
  low: number;
  high: number;
  /** Of the bars, the share whose close was inside the band, 0–1. */
  inRange: number;
  /** The position against holding the same two coins at the last price, in SOL, before fees; null without an amount. */
  vsHoldSol: number | null;
  /** The same, per cent of what holding would be worth. */
  vsHoldPct: number;
  /** The price moved this much over the period, per cent. */
  movePct: number;
  /** The days the picture covers. */
  days: number;
}>;

/** The picture of a style over the path, for `lamports` of SOL put in at the start (or none: per cent only). */
export function historyPicture(pier: Pier, points: readonly PricePoint[], style: PierStyle, lamports: bigint | null): HistoryPicture | null {
  if (points.length < HISTORY_MIN_BARS) return null;
  const half = STYLE_HALF[style];
  const step = 1 + pier.pool.binStepBps! / 10_000;
  const start = points[0]!.p;
  const end = points.at(-1)!.p;
  const low = start * step ** -half;
  const high = start * step ** half;
  const inside = points.filter((point) => point.p >= low && point.p <= high).length;
  // Worth in Y at the start: SOL is Y for an LST pier; for SOL–USDC it is the dollars of the SOL put in.
  const sol = lamports !== null && lamports > 0n ? Number(lamports) / 1e9 : 1;
  const value = pier.solSide === 'y' ? sol : sol * start;
  const sim = simulateBins({ binStepBps: pier.pool.binStepBps!, price: start, nextPrice: end, below: half, above: half, value });
  if (!sim) return null;
  // Back to SOL at the last price: Y is SOL already, or dollars over the last dollars-per-SOL.
  const differenceSol = pier.solSide === 'y' ? sim.difference : sim.difference / end;
  const days = Math.max(1, Math.round((points.at(-1)!.t - points[0]!.t) / 86_400));
  return {
    points,
    low,
    high,
    inRange: inside / points.length,
    vsHoldSol: lamports !== null && lamports > 0n ? differenceSol : null,
    vsHoldPct: sim.differencePct,
    movePct: (end / start - 1) * 100,
    days,
  };
}

export type Plot = Readonly<{
  /** SVG path of the price, in a box of `width` × `height`. */
  line: string;
  /** The band's top and bottom, in the same box. */
  bandTop: number;
  bandBottom: number;
  /** Runs of the path inside the band, as SVG paths to light. */
  lit: readonly string[];
  /** The last point, for its dot. */
  end: Readonly<{ x: number; y: number }>;
}>;

/** The picture in a box: the path scaled to show both the band and every price, a margin above and below. */
export function plotOf(picture: HistoryPicture, width: number, height: number): Plot {
  const prices = picture.points.map((point) => point.p);
  let top = Math.max(picture.high, ...prices);
  let bottom = Math.min(picture.low, ...prices);
  const pad = (top - bottom) * 0.12 || top * 0.001;
  top += pad;
  bottom -= pad;
  const n = picture.points.length;
  const x = (i: number) => (n === 1 ? width : (i / (n - 1)) * width);
  const y = (p: number) => ((top - p) / (top - bottom)) * height;
  const at = (i: number) => `${x(i).toFixed(1)},${y(prices[i]!).toFixed(1)}`;
  const line = prices.map((_, i) => `${i === 0 ? 'M' : 'L'}${at(i)}`).join('');
  const lit: string[] = [];
  let run: string[] = [];
  prices.forEach((p, i) => {
    if (p >= picture.low && p <= picture.high) run.push(`${run.length ? 'L' : 'M'}${at(i)}`);
    else if (run.length) {
      if (run.length > 1) lit.push(run.join(''));
      run = [];
    }
  });
  if (run.length > 1) lit.push(run.join(''));
  return { line, bandTop: y(picture.high), bandBottom: y(picture.low), lit, end: { x: x(n - 1), y: y(prices[n - 1]!) } };
}
