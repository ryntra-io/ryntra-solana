import { QUIET_MISSES, type ChartData, type Timeframe } from '../../city/lib/chart/candles.ts';

/*
 * The chart's waits, without React (the young coin's chart): a wait the source keeps going — its limit, its
 * silence — is said after a while, never shown for ever as «Chart in a moment».
 */

/** How long the chart waits with no bar before it says it is unavailable, whatever the source asked, ms. */
export const STUCK_MS = 20_000;

/**
 * The engine's read as the chart says it: past `QUIET_MISSES` failed reads or `STUCK_MS` of waiting with no bar, a
 * refusal for rate is «unavailable» too — the chart draws the coin's trades, or says so with «Try again», and never
 * waits with «Chart in a moment» for ever. The reads go on behind it as they were.
 */
export function stuckOf(data: ChartData, waitedMs: number): ChartData {
  if (data.status !== 'unavailable' || data.last) return data;
  if (data.misses < QUIET_MISSES && waitedMs < STUCK_MS) return data;
  return { ...data, busy: false, misses: Math.max(data.misses, QUIET_MISSES) };
}

/** Each interval's bar, s. */
const SECONDS: Readonly<Record<Timeframe, number>> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 };

/** A chart opens on a minute's bars when the coin's whole life is fewer than this many bars of its interval. */
export const YOUNG_BARS = 40;

/**
 * Whether the coin is younger than its chart's interval can show (flaw 68: a coin of 29–56 minutes opened on
 * «1h» as one candle at the right edge, nine tenths of the field empty): its first bar is newer than `YOUNG_BARS` bars
 * of the interval. Such a chart opens on a minute's bars — until the person picks an interval themselves.
 */
export function tooYoungFor(candles: readonly Readonly<{ time: number }>[], timeframe: Timeframe, nowMs: number): boolean {
  const first = candles[0]?.time;
  if (timeframe === '1m' || first === undefined) return false;
  return nowMs / 1000 - first < YOUNG_BARS * SECONDS[timeframe];
}
