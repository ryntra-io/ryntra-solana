import type { RyntraChartProps } from '@ryntra/core/chart';
import type { NormalizedCandle } from '../../../lib/chart/types.ts';

/**
 * The city's own readout of the bar under the pointer (CITY-5a), in place of the core chart's legend: the core chart
 * tells where its crosshair stands on a channel of the city's own, and the window says that bar's time, close and move
 * in the city's words — only while a hand is on the chart. Pure, but for the channel.
 */

export type Crosshair = NonNullable<RyntraChartProps['crosshair']>['channel'];
type At = NonNullable<ReturnType<Crosshair['get']>>;

/** A crosshair channel for one chart: the core chart sets it; the window listens. */
export function crosshairChannel(): Crosshair {
  let at: At | null = null;
  let last: At | null = null;
  const listeners = new Set<(at: At | null) => void>();
  return {
    get: () => at,
    last: () => last,
    set(t, from) {
      at = t === null || !Number.isFinite(t) ? null : { t, from };
      if (at) last = at;
      for (const listener of listeners) listener(at);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Readout = Readonly<{ t: number; close: number; move: number }>;

/**
 * The bar the crosshair stands on (its open, ms) among the engine's bars: its close — for the newest bar the city's
 * live price, as the chart draws it — and its move from its open, per cent. Null off the bars.
 */
export function readoutOf(candles: readonly NormalizedCandle[], t: number | null, livePrice: number | null): Readout | null {
  if (t === null || !candles.length) return null;
  const index = candles.findIndex((candle) => candle.time * 1000 === t);
  if (index < 0) return null;
  const bar = candles[index]!;
  const newest = index === candles.length - 1;
  const close = newest && livePrice !== null && livePrice > 0 ? livePrice : bar.close;
  if (!(bar.open > 0) || !(close > 0)) return null;
  return { t, close, move: (close / bar.open - 1) * 100 };
}

/** A bar's time as the readout says it, in the browser's zone: the day on daily bars, the day and the hour on others. */
export function readoutTime(t: number, daily: boolean, timeZone?: string): string {
  const date = new Date(t);
  return daily
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone })
    : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}
