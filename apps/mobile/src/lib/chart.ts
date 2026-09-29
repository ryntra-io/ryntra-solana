/**
 * The geometry of a price line — pure. Candles in, an SVG path and the
 * points a finger can land on out. The chart draws closes: one line, its
 * low and high named, the first and last bar's time under it. Nothing is
 * smoothed or interpolated; a bar the source did not send is not drawn.
 */

import type { Candle, Timeframe } from '@/lib/api'

export type ChartPoint = Readonly<{
  x: number
  y: number
  /** Unix seconds, the bar's open. */
  time: number
  /** The bar's close, USD. */
  value: number
}>

export type ChartGeometry = Readonly<{
  path: string
  points: readonly ChartPoint[]
  low: ChartPoint
  high: ChartPoint
  first: ChartPoint
  last: ChartPoint
}>

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * Closes scaled into a `width` × `height` box with `pad` kept clear at the
 * top and bottom so the extreme labels fit. Null when fewer than two bars
 * exist — a single bar is a figure, not a line.
 */
export function chartGeometry(
  candles: readonly Candle[],
  width: number,
  height: number,
  pad = 0,
): ChartGeometry | null {
  const bars = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0)
  if (bars.length < 2 || width <= 0 || height <= 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const bar of bars) {
    if (bar.close < min) min = bar.close
    if (bar.close > max) max = bar.close
  }
  const span = max - min
  const inner = Math.max(1, height - pad * 2)
  const points: ChartPoint[] = bars.map((bar, index) => ({
    x: round((index / (bars.length - 1)) * width),
    y: round(span === 0 ? pad + inner / 2 : pad + (1 - (bar.close - min) / span) * inner),
    time: bar.time,
    value: bar.close,
  }))
  let low = points[0]!
  let high = points[0]!
  for (const point of points) {
    if (point.value < low.value) low = point
    if (point.value > high.value) high = point
  }
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
  return { path, points, low, high, first: points[0]!, last: points[points.length - 1]! }
}

/** The point nearest to a touch at `x`, for the crosshair. */
export function nearestPoint(points: readonly ChartPoint[], x: number): ChartPoint | null {
  if (points.length === 0) return null
  let best = points[0]!
  let distance = Math.abs(best.x - x)
  for (const point of points) {
    const next = Math.abs(point.x - x)
    if (next < distance) {
      best = point
      distance = next
    }
  }
  return best
}

/** Change from the first close to the last, percent; null when the first is not a price. */
export function windowChangePct(geometry: ChartGeometry | null): number | null {
  if (!geometry || geometry.first.value <= 0) return null
  return ((geometry.last.value - geometry.first.value) / geometry.first.value) * 100
}

/* ---- «Простий»'s ranges: a day, a week, a month, a year (the web's own) ---- */

export const CHART_RANGES = ['1d', '1w', '1m', '1y'] as const
export type ChartRange = (typeof CHART_RANGES)[number]

const DAY_MS = 86_400_000

/**
 * Each range is drawn from the bars that fit it: a day of five-minute bars, a
 * week of hourly ones, a month of four-hour ones, a year of daily ones — a few
 * hundred points each, enough for a smooth line on a phone.
 */
export const RANGE_SOURCE: Readonly<Record<ChartRange, Readonly<{ timeframe: Timeframe; spanMs: number }>>> = {
  '1d': { timeframe: '5m', spanMs: DAY_MS },
  '1w': { timeframe: '1h', spanMs: 7 * DAY_MS },
  '1m': { timeframe: '4h', spanMs: 30 * DAY_MS },
  '1y': { timeframe: '1d', spanMs: 365 * DAY_MS },
}

/** The bars inside a range that ends now, oldest first; a bar's time is in seconds. */
export function rangeCandles(candles: readonly Candle[], range: ChartRange, nowMs: number): Candle[] {
  const from = nowMs - RANGE_SOURCE[range].spanMs
  return candles
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.close) &&
        candle.close > 0 &&
        candle.time * 1000 >= from &&
        candle.time * 1000 <= nowMs + 60_000,
    )
    .slice()
    .sort((a, b) => a.time - b.time)
}

/**
 * Whether the history starts inside the range — a token younger than a year
 * has no year to draw, and the chart says since when rather than calling a few
 * months a year. A tenth of the span is the slack a quiet pool's first bar gets.
 */
export function historyStartsLate(bars: readonly Candle[], range: ChartRange, nowMs: number): boolean {
  const first = bars[0]
  if (!first) return false
  const span = RANGE_SOURCE[range].spanMs
  return first.time * 1000 - (nowMs - span) > span / 10
}

/** The change from a range's first close to its last, percent; null without two prices. */
export function rangeChangePct(bars: readonly Candle[]): number | null {
  const first = bars[0]?.close
  const last = bars[bars.length - 1]?.close
  if (bars.length < 2 || typeof first !== 'number' || typeof last !== 'number' || first <= 0) return null
  return (last / first - 1) * 100
}

/**
 * The bars a range draws its line from, each at most `stepSeconds` wide: a day
 * of five-minute bars folded into quarter hours. A pool whose trades alternate
 * between the two sides of a wide spread closes each five minutes on either
 * side, and a line of those closes zigzags between two levels the price never
 * moved between (SPCXx's day, 2026-09-28: the line's length 62 times its
 * height); a quarter hour's close is still a real trade — the last one in it —
 * and the line runs at a third of that length. Each folded bar opens at its
 * first bar's open, closes at its last bar's close, and keeps the highest high
 * and the lowest low; nothing is averaged or invented, and the figures a finger
 * reads stay trades.
 */
export function coarserBars(bars: readonly Candle[], stepSeconds: number): Candle[] {
  if (stepSeconds <= 0) return bars.slice()
  const folded: Candle[] = []
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / stepSeconds) * stepSeconds
    const last = folded[folded.length - 1]
    if (last && last.time === bucket) {
      folded[folded.length - 1] = {
        time: bucket,
        open: last.open,
        high: Math.max(last.high, bar.high),
        low: Math.min(last.low, bar.low),
        close: bar.close,
        ...(last.volume !== undefined || bar.volume !== undefined
          ? { volume: (last.volume ?? 0) + (bar.volume ?? 0) }
          : {}),
      }
    } else {
      folded.push({ ...bar, time: bucket })
    }
  }
  return folded
}

/** How wide a bar of each range's line may be: a day's line is drawn from quarter hours (M27); the others as read. */
export const RANGE_STEP_SECONDS: Readonly<Record<ChartRange, number>> = {
  '1d': 900,
  '1w': 0,
  '1m': 0,
  '1y': 0,
}

/**
 * A day's line through the middle of each quarter hour — halfway between its
 * highest and lowest trade — not through its close. A quarter hour's last trade
 * falls on either side of a wide spread by chance, so even folded closes still
 * zigzag (SPCXx, 2026-09-29); a quarter hour nearly always trades both sides,
 * and its middle is where the price stood between them. The chart says every
 * figure of such a line as «≈» (`PriceChart`'s `approx`); a week, a month and a
 * year keep their closes, and the change a range states is always close to close.
 */
export const RANGE_DRAWS_MIDDLES: Readonly<Record<ChartRange, boolean>> = {
  '1d': true,
  '1w': false,
  '1m': false,
  '1y': false,
}

/** Each bar at its middle, halfway between its high and its low; a bar without a usable range keeps its close. */
export function barMiddles(bars: readonly Candle[]): Candle[] {
  return bars.map((bar) => {
    const { high, low } = bar
    const usable = Number.isFinite(high) && Number.isFinite(low) && low > 0 && high >= low
    return usable ? { ...bar, close: (high + low) / 2 } : bar
  })
}
