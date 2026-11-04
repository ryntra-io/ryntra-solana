/**
 * The price a bot is tried on: hourly bars of the tower's own market, oldest first — the engine's candles
 * (`/api/spot/candles`, the chart's read). A tower without them has no week to try a bot on, and the hub says so: no
 * price here is ever made up. Pure.
 */

export type Bar = Readonly<{ t: number; o: number; h: number; l: number; c: number }>;

export const HOUR_MS = 3_600_000;
/** A week of hours: the window a draft is tried on. */
export const WEEK_BARS = 168;

export const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The bars of the engine's candles (`time` in unix seconds), the last `limit` of them; bad bars are left out. */
export function barsFromCandles(candles: readonly Readonly<{ time: number; open: number; high: number; low: number; close: number }>[], limit = WEEK_BARS): Bar[] {
  const bars: Bar[] = [];
  for (const k of candles) {
    if (!Number.isFinite(k.time) || ![k.open, k.high, k.low, k.close].every(positive)) continue;
    bars.push({ t: k.time * 1000, o: k.open, h: Math.max(k.high, k.open, k.close), l: Math.min(k.low, k.open, k.close), c: k.close });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars.slice(-limit);
}

/**
 * The prices a bar passes through, in the order they most likely came: a rising bar dips to its low before its high,
 * a falling one reaches its high first.
 */
export function ticksOf(bar: Bar): readonly number[] {
  return bar.c >= bar.o ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
}

/** A straight move from one price to another in `steps` ticks, for the stress test. */
export function straightBars(from: number, to: number, start: number, steps = 48): Bar[] {
  const bars: Bar[] = [];
  let last = from;
  for (let i = 1; i <= steps; i += 1) {
    const c = from * (to / from) ** (i / steps);
    bars.push({ t: start + i * HOUR_MS, o: last, c, h: Math.max(last, c), l: Math.min(last, c) });
    last = c;
  }
  return bars;
}

export const lastPrice = (bars: readonly Bar[]): number | null => (bars.length ? bars[bars.length - 1]!.c : null);
