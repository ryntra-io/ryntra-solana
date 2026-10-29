import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  barMiddles,
  chartGeometry,
  coarserBars,
  DAILY_BARS_SERVED,
  historyStartsLate,
  nearestPoint,
  RANGE_DRAWS_MIDDLES,
  RANGE_SOURCE,
  RANGE_STEP_SECONDS,
  rangeCandles,
  rangeChangePct,
  windowChangePct,
} from './chart.ts'

const bar = (time, close) => ({ time, open: close, high: close, low: close, close })

test('fewer than two bars is not a line', () => {
  assert.equal(chartGeometry([], 300, 100), null)
  assert.equal(chartGeometry([bar(1, 10)], 300, 100), null)
  assert.equal(chartGeometry([bar(1, 10), bar(2, 0)], 300, 100), null)
})

test('closes scale into the box, low at the bottom and high at the top, padding kept clear', () => {
  const geometry = chartGeometry([bar(1, 10), bar(2, 30), bar(3, 20)], 200, 110, 5)
  assert.ok(geometry)
  assert.equal(geometry.path, 'M0 105 L100 5 L200 55')
  assert.equal(geometry.low.value, 10)
  assert.equal(geometry.high.value, 30)
  assert.equal(geometry.first.time, 1)
  assert.equal(geometry.last.time, 3)
})

test('a flat line sits in the middle', () => {
  const geometry = chartGeometry([bar(1, 5), bar(2, 5)], 100, 50)
  assert.ok(geometry)
  assert.equal(geometry.points[0].y, 25)
  assert.equal(geometry.points[1].y, 25)
})

test('a broken bar is skipped, not drawn as zero', () => {
  const geometry = chartGeometry([bar(1, 10), bar(2, Number.NaN), bar(3, 20)], 100, 100)
  assert.ok(geometry)
  assert.equal(geometry.points.length, 2)
})

test('the nearest point answers a touch; the window change reads first to last', () => {
  const geometry = chartGeometry([bar(1, 10), bar(2, 30), bar(3, 20)], 200, 100)
  assert.ok(geometry)
  assert.equal(nearestPoint(geometry.points, 90).time, 2)
  assert.equal(nearestPoint(geometry.points, 160).time, 3)
  assert.equal(nearestPoint([], 10), null)
  assert.equal(windowChangePct(geometry), 100)
  assert.equal(windowChangePct(null), null)
})

test('«Простий»’s four ranges: the bars that fit each, oldest first; a young history says since when; the change first to last', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(RANGE_SOURCE).map(([range, source]) => [range, source.timeframe])),
    { '1d': '5m', '1w': '1h', '1m': '4h', '6m': '1d' },
  )
  const now = Date.UTC(2026, 8, 23, 20, 0) // seconds below
  const hour = 3600
  const t = Math.floor(now / 1000)
  const bars = [
    bar(t - 30 * hour, 90),
    bar(t - 2 * hour, 110),
    bar(t - 23 * hour, 100),
    bar(t - hour, Number.NaN),
    bar(t, 99),
  ]
  const day = rangeCandles(bars, '1d', now)
  assert.deepEqual(
    day.map((candle) => candle.close),
    [100, 110, 99],
    'older than a day dropped, a broken bar dropped, sorted by time',
  )
  assert.equal(historyStartsLate(day, '1d', now), false)
  assert.ok(Math.abs(rangeChangePct(day) - -1) < 1e-9)
  assert.equal(
    historyStartsLate(rangeCandles(bars, '6m', now), '6m', now),
    true,
    'half a year that starts yesterday is not half a year',
  )
  // The route's 183 daily bars fill the half year: a token older than them is not said to start with them.
  const served = Array.from({ length: DAILY_BARS_SERVED }, (_, index) =>
    bar(t - (DAILY_BARS_SERVED - 1 - index) * 24 * hour, 100),
  )
  assert.equal(historyStartsLate(rangeCandles(served, '6m', now), '6m', now), false)
  assert.equal(rangeCandles(served, '6m', now).length, DAILY_BARS_SERVED)
  assert.equal(rangeChangePct([bar(t, 10)]), null)
  assert.equal(historyStartsLate([], '1w', now), false)
})

test('a day’s line is drawn from quarter hours folded from its five-minute bars — real closes, no zigzag', () => {
  // SPCXx, 2026-09-28: every five minutes both sides of a ~2 % spread traded, and the closes alternated between them.
  const five = [
    { time: 900, open: 145.85, high: 148.98, low: 145.82, close: 148.98, volume: 10 },
    { time: 1200, open: 148.98, high: 148.99, low: 145.82, close: 145.83, volume: 20 },
    { time: 1500, open: 145.83, high: 149.14, low: 145.68, close: 148.22 },
    { time: 1800, open: 148.22, high: 149.35, low: 145.49, close: 146.6, volume: 5 },
  ]
  const quarter = coarserBars(five, 900)
  assert.equal(quarter.length, 2)
  // Each folded bar: the first open, the last close — a real trade — the highest high and the lowest low.
  assert.deepEqual(quarter[0], { time: 900, open: 145.85, high: 149.14, low: 145.68, close: 148.22, volume: 30 })
  assert.deepEqual(quarter[1], { time: 1800, open: 148.22, high: 149.35, low: 145.49, close: 146.6, volume: 5 })
  for (const bar of quarter)
    assert.ok(
      five.some((one) => one.close === bar.close),
      'every close is one that traded',
    )
  // A step of none keeps the bars as read; the day's line alone is folded.
  assert.deepEqual(coarserBars(five, 0), five)
  assert.equal(RANGE_STEP_SECONDS['1d'], 900)
  assert.equal(RANGE_STEP_SECONDS['1w'], 0)
  assert.deepEqual(coarserBars([], 900), [])
})

test('a day’s line runs through each quarter hour’s middle; the other ranges keep their closes', () => {
  const quarter = [
    { time: 900, open: 145.85, high: 149.14, low: 145.68, close: 148.22 },
    { time: 1800, open: 148.22, high: 149.35, low: 145.49, close: 145.84 },
  ]
  const middles = barMiddles(quarter).map((candle) => candle.close)
  assert.ok(Math.abs(middles[0] - 147.41) < 0.01)
  assert.ok(Math.abs(middles[1] - 147.42) < 0.01, 'the two sides of the spread no longer set the line')
  // A bar without a usable range keeps its close; the rest of a bar is untouched.
  const broken = { time: 5, open: 1, high: Number.NaN, low: 1, close: 2 }
  assert.deepEqual(barMiddles([broken]), [broken])
  assert.equal(barMiddles(quarter)[1].open, 148.22)
  assert.equal(RANGE_DRAWS_MIDDLES['1d'], true)
  for (const range of ['1w', '1m', '6m']) assert.equal(RANGE_DRAWS_MIDDLES[range], false)
})

test('a day of five-minute bars says the first mark’s day too — never «03:45 … 03:45» (M44.6)', async () => {
  const { firstScale } = await import('./chart.ts')
  const now = Date.UTC(2026, 9, 17, 12, 0) / 1000
  assert.equal(firstScale(now - 86_400, now, 'intraday'), 'days')
  assert.equal(firstScale(now - 3_600, now, 'intraday'), 'intraday')
  assert.equal(firstScale(now - 86_400 * 30, now, 'months'), 'months')
})
