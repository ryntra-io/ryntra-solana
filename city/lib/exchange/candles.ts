import { symbolKey, type FuturesCandle, type FuturesCandles, type FuturesTimeframe } from '../../../lib/phoenix/market-data.ts';

/**
 * The Exchange's price chart: Phoenix's traded-price bars of the open market as the engine reads them
 * (`/api/solana/futures/candles`), drawn as candles in the window's wide view. The bars are Phoenix's; the city only
 * places them in a box from 0 to 1 so the window can draw them at any size. Pure.
 */

/** The intervals the chart offers: few, so the row stays one quiet line. */
export const CHART_TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const satisfies readonly FuturesTimeframe[];
/** Any interval Phoenix's reads serve: the core chart's own menu offers them all. */
export type ChartTimeframe = FuturesTimeframe;

/** What the chart opens on. */
export const CHART_DEFAULT: ChartTimeframe = '1h';

/** How many of the newest bars are drawn: enough for a shape, wide enough apart to read each one. */
export const CHART_BARS = 72;

/** The bars are read again this often while the chart is on screen; the route keeps a read at the edge for seconds. */
export const CHART_MS = 15_000;

export type ChartCandle = Readonly<{
  /** The bar's middle across the box, 0 (oldest) to 1 (newest). */
  x: number;
  /** Prices as heights in the box, 0 at the foot, 1 at the top. */
  open: number;
  high: number;
  low: number;
  close: number;
  up: boolean;
}>;

export type ChartView = Readonly<{
  candles: readonly ChartCandle[];
  /** One bar's width, of the box. */
  width: number;
  /** The newest close in dollars and where it stands in the box; the box's top and foot, in dollars. */
  last: number;
  lastAt: number;
  high: number;
  low: number;
}>;

const good = (bar: FuturesCandle): boolean =>
  [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value) && value > 0) && bar.h >= bar.l;

/**
 * The drawn chart of a read; null for another market's or another interval's read, or one without a bar to draw, so a
 * market just picked never shows the last one's shape.
 */
/**
 * A read with its newest bar still forming at the live mark: the close is the mark, the high and the low stretch to it.
 * The same read when there is no mark or no bar. Pure.
 */
export function withLiveMark(read: FuturesCandles, live: number | null): FuturesCandles {
  if (live === null || !Number.isFinite(live) || live <= 0 || read.last.length === 0) return read;
  const order = [...read.last].sort((a, b) => a.t - b.t);
  const forming = order[order.length - 1]!;
  const moved = { ...forming, c: live, h: Math.max(forming.h, live), l: Math.min(forming.l, live) };
  return { ...read, last: read.last.map((bar) => (bar === forming ? moved : bar)) };
}

export function chartView(read: FuturesCandles | null, symbol: string | null, timeframe: ChartTimeframe, bars = CHART_BARS, live: number | null = null): ChartView | null {
  if (!read || !symbol || symbolKey(read.symbol) !== symbolKey(symbol) || read.timeframe !== timeframe) return null;
  const drawn = [...read.last].filter(good).sort((a, b) => a.t - b.t).slice(-bars);
  if (drawn.length === 0) return null;
  // The newest bar is still forming: it closes at the live mark between the reads of the bars, so the chart moves with
  // the price on screen (30.10).
  if (live !== null && Number.isFinite(live) && live > 0) {
    const forming = drawn[drawn.length - 1]!;
    drawn[drawn.length - 1] = { ...forming, c: live, h: Math.max(forming.h, live), l: Math.min(forming.l, live) };
  }
  let high = Math.max(...drawn.map((bar) => bar.h));
  let low = Math.min(...drawn.map((bar) => bar.l));
  // A flat market still has a height: a hair above and below its one price.
  if (high === low) {
    high *= 1.001;
    low *= 0.999;
  }
  const span = high - low;
  const at = (value: number): number => (value - low) / span;
  const slot = 1 / drawn.length;
  const candles = drawn.map((bar, index) => ({
    x: slot * (index + 0.5),
    open: at(bar.o),
    high: at(bar.h),
    low: at(bar.l),
    close: at(bar.c),
    up: bar.c >= bar.o,
  }));
  const lastBar = drawn[drawn.length - 1]!;
  return {
    candles,
    width: slot * 0.62,
    last: lastBar.c,
    lastAt: at(lastBar.c),
    high,
    low,
  };
}
