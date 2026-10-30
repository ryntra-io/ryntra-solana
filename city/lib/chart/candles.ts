import type { NormalizedCandle } from '../../../lib/chart/types.ts';
import { isSpotTimeframe, SPOT_TIMEFRAMES, TIMEFRAME_TTL_MS, type SpotTimeframe } from '../../../lib/spot/candles.ts';
import { wordsNow } from '../i18n/dict.ts';
import { CHART_READ } from './words.ts';

/**
 * The tower chart's candles (CITY-5a): the engine's own read of a market, `/api/spot/candles` — the deepest pool's
 * OHLCV from GeckoTerminal, the same read the core chart draws on the Solana spot page (CH-17). The city adds nothing
 * to the numbers: this file checks what came back, says why a market has no chart, and keeps the last good read on
 * screen when the source blinks. Pure; the fetch is passed in.
 */

export type Timeframe = SpotTimeframe;

/** Every interval the engine reads, finest first: the core chart's interval row shows them all. */
export const TIMEFRAMES: readonly Timeframe[] = SPOT_TIMEFRAMES;

/** Towers are about today's moves: three days of quarter hours open first. */
export const DEFAULT_TIMEFRAME: Timeframe = '15m';

/** Where this browser keeps the interval the person last picked. */
export const TIMEFRAME_KEY = 'ryntra.city.chart.timeframe.v1';

/** A stored interval if it is one the engine reads; the default otherwise. */
export function timeframeFrom(stored: unknown): Timeframe {
  return isSpotTimeframe(stored) ? stored : DEFAULT_TIMEFRAME;
}

/** How often an open chart reads its interval again: the engine's own cache time for it, never under 15 s. */
export function refreshMs(timeframe: Timeframe): number {
  return Math.max(15_000, TIMEFRAME_TTL_MS[timeframe]);
}

/** After a read that failed, one more try this soon, before the interval's own cadence takes over. */
export const RETRY_MS = 8_000;

/** The reasons the engine gives for a market without a chart (its 404), and one of the city's own: no bars at all. */
export const NO_CHART = ['NO_POOL', 'NO_MAJOR_QUOTE', 'THIN', 'QUIET', 'STALE', 'PRICE_MISMATCH', 'EMPTY'] as const;
export type NoChart = (typeof NO_CHART)[number];

export type Ready = Readonly<{
  status: 'ready';
  timeframe: Timeframe;
  /** Oldest first, unix seconds, every price above zero. */
  candles: readonly NormalizedCandle[];
  /** The pool the bars are the price of, as the engine names it. */
  pool: string | null;
  /** When the engine read the source, ms. */
  observedAt: number;
  /** The engine answered with a held copy: the source is behind. */
  stale: boolean;
  /** The source the engine read, by its own name («GeckoTerminal»); null when it named none. */
  source: string | null;
}>;

export type CandlesRead =
  | Ready
  | Readonly<{ status: 'none'; code: NoChart | null }>
  | Readonly<{ status: 'unavailable'; reason: 'busy' | 'offline' | 'failed' }>;

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The engine's bars as the chart takes them: oldest first, one bar per open, every price above zero and the high and
 * low around the open and the close. A bar that breaks any of it is left out — a wrong candle is worse than a gap.
 * Volume is kept only when it is a real figure; a bar without it has no volume, not a zero.
 */
export function candlesOf(raw: unknown): NormalizedCandle[] {
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<number, NormalizedCandle>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const { time, open, high, low, close, volume } = row as Record<string, unknown>;
    if (typeof time !== 'number' || !Number.isInteger(time) || time <= 0) continue;
    if (!positive(open) || !positive(high) || !positive(low) || !positive(close)) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close)) continue;
    const candle: NormalizedCandle = { time: time as NormalizedCandle['time'], open, high, low, close };
    if (typeof volume === 'number' && Number.isFinite(volume) && volume >= 0) candle.volume = volume;
    byTime.set(time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** One answer of `/api/spot/candles`, as the chart reads it. `now` stands in for a read without its own time. */
export function readCandles(timeframe: Timeframe, status: number, body: unknown, now: number): CandlesRead {
  const json = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (status === 404) {
    const error = json?.error && typeof json.error === 'object' ? (json.error as Record<string, unknown>) : null;
    const code = typeof error?.code === 'string' ? error.code.replace(/^CANDLES_/, '') : '';
    return { status: 'none', code: (NO_CHART as readonly string[]).includes(code) ? (code as NoChart) : null };
  }
  if (status === 429) return { status: 'unavailable', reason: 'busy' };
  if (status < 200 || status >= 300 || !json) return { status: 'unavailable', reason: 'failed' };
  // An answer for another interval is not this one's: the person may have switched while it travelled.
  if (json.timeframe !== timeframe) return { status: 'unavailable', reason: 'failed' };
  const candles = candlesOf(json.candles);
  if (!candles.length) return { status: 'none', code: 'EMPTY' };
  const observed = typeof json.observedAt === 'string' ? Date.parse(json.observedAt) : Number.NaN;
  const pool = json.pool && typeof json.pool === 'object' ? (json.pool as Record<string, unknown>).name : null;
  const source = json.source && typeof json.source === 'object' ? (json.source as Record<string, unknown>).label : null;
  return {
    status: 'ready',
    timeframe,
    candles,
    pool: typeof pool === 'string' && pool ? pool : null,
    observedAt: Number.isFinite(observed) ? Math.min(observed, now) : now,
    stale: json.stale === true,
    source: typeof source === 'string' && source ? source : null,
  };
}

export type CandlesFetch = (url: string, init: { signal?: AbortSignal }) => Promise<Readonly<{ status: number; json: () => Promise<unknown> }>>;

/** The URL of one market's bars at one interval. */
export const candlesUrl = (mint: string, timeframe: Timeframe): string => `/api/spot/candles?${new URLSearchParams({ mint, tf: timeframe })}`;

/** Reads one market's bars. Never throws: a network that failed is `offline`, an answer that was not JSON `failed`. */
export async function fetchCandles(mint: string, timeframe: Timeframe, deps: Readonly<{ fetch: CandlesFetch; now: () => number; signal?: AbortSignal }>): Promise<CandlesRead> {
  let answer: Awaited<ReturnType<CandlesFetch>>;
  try {
    answer = await deps.fetch(candlesUrl(mint, timeframe), { signal: deps.signal });
  } catch {
    return { status: 'unavailable', reason: 'offline' };
  }
  let body: unknown = null;
  try {
    body = await answer.json();
  } catch {
    if (answer.status >= 200 && answer.status < 300) return { status: 'unavailable', reason: 'failed' };
  }
  return readCandles(timeframe, answer.status, body, deps.now());
}

/** What the window shows: the newest answer, and the last bars it had for this market and interval. */
export type ChartData = Readonly<{
  mint: string;
  timeframe: Timeframe;
  status: 'loading' | 'ready' | 'none' | 'unavailable';
  /** The last good read of this market and interval; kept, marked stale, while the source does not answer. */
  last: Ready | null;
  code: NoChart | null;
}>;

/** The state of a market and interval before any answer: the bars it already had, only if they are this market's. */
export function loading(mint: string, timeframe: Timeframe, before: ChartData | null): ChartData {
  const keep = before && before.mint === mint && before.timeframe === timeframe ? before.last : null;
  return { mint, timeframe, status: 'loading', last: keep, code: null };
}

/**
 * The next state after an answer. A market without a chart drops its bars; a source that blinked keeps the last good
 * ones and marks them stale, so the age under the chart counts from them.
 */
export function settle(state: ChartData, read: CandlesRead): ChartData {
  if (read.status === 'ready') return { ...state, status: 'ready', last: read, code: null };
  if (read.status === 'none') return { ...state, status: 'none', last: null, code: read.code };
  return { ...state, status: 'unavailable', last: state.last ? { ...state.last, stale: true } : null };
}

/**
 * The price the chart's head says: the city's live price when its read is live, else the close of the engine's newest
 * bar of this market (the price the chart's last bar stands at), else none — the caller falls back to the tower's.
 */
export function headPrice(livePrice: number | null, data: ChartData, mint: string): number | null {
  if (livePrice !== null && Number.isFinite(livePrice) && livePrice > 0) return livePrice;
  if (data.mint !== mint || !data.last) return null;
  const close = data.last.candles.at(-1)?.close;
  return typeof close === 'number' && Number.isFinite(close) && close > 0 ? close : null;
}

/** How old a read is, in the city's short words: 8s · 3m · 2h. */
export function ageText(ms: number): string {
  const w = wordsNow(CHART_READ);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? w.seconds(s) : s < 3600 ? w.minutes(Math.floor(s / 60)) : w.hours(Math.floor(s / 3600));
}

/**
 * The chart's «Details»: where the bars come from and how old they are — the source, the pool, the age and, when the
 * engine answered with a held copy, «Delayed». Nothing while there are no bars.
 */
export function detailsOf(data: ChartData, now: number): string[] {
  const read = data.last;
  if (!read) return [];
  const w = wordsNow(CHART_READ);
  const parts: string[] = [];
  if (read.source) parts.push(read.source);
  if (read.pool) parts.push(read.pool);
  parts.push(w.ago(ageText(now - read.observedAt)));
  if (read.stale) parts.push(w.delayed);
  return parts;
}

/** One sentence on why a market has no chart, in the language on screen. */
export const whyNoChart = (code: NoChart | null): string => wordsNow(CHART_READ)[code ?? 'NO_POOL'];
