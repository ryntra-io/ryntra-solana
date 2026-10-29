import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import { DETAILS_COPY } from './details-copy.ts'
import {
  CHART_LIMIT_WAIT_MS,
  chartLimited,
  chartLimitWaitMs,
  noChart,
  rangeRead,
  rangesKnownEmpty,
} from './chart-asks.ts'

const thin = new ApiError('CANDLES_THIN', 'Too few candles', 404)
const limited = new ApiError('RATE_LIMITED', 'Too many requests', 429, null, { retryAfterSeconds: 7 })
const busy = new ApiError('HTTP_503', 'Unavailable', 503)

test('a chart’s three answers: no chart for the range, a wait, or not answering (ST-5 r10, SGOVx)', () => {
  assert.equal(noChart(thin), true)
  assert.equal(noChart(new ApiError('NOT_FOUND', 'x', 404)), true)
  assert.equal(noChart(limited), false)
  assert.equal(chartLimited(limited), true)
  assert.equal(chartLimited(new ApiError('RATE_LIMITED', 'x', 400)), true)
  assert.equal(chartLimited(thin), false)
  assert.equal(chartLimited(busy), false)
  assert.equal(chartLimited(new Error('offline')), false)
  // The wait the server names, else five seconds.
  assert.equal(chartLimitWaitMs(limited), 7_250)
  assert.equal(chartLimitWaitMs(new ApiError('RATE_LIMITED', 'x', 429)), CHART_LIMIT_WAIT_MS)
  assert.equal(chartLimitWaitMs(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 600 })), 60_250)
})

test('the other ranges are read one at a time, each after the one before it is known empty', () => {
  assert.equal(rangeRead({ hasData: true, bars: 1, error: null }), 'empty')
  assert.equal(rangeRead({ hasData: true, bars: 2, error: null }), 'drawn')
  assert.equal(rangeRead({ hasData: false, bars: 0, error: thin }), 'empty')
  assert.equal(rangeRead({ hasData: false, bars: 0, error: limited }), 'unknown')
  assert.equal(rangeRead({ hasData: false, bars: 0, error: null }), 'unknown')
  // Nothing known: the first is asked. The first empty: the second is asked. A wait holds the turn.
  assert.equal(rangesKnownEmpty(['unknown', 'unknown', 'unknown']), 0)
  assert.equal(rangesKnownEmpty(['empty', 'unknown', 'unknown']), 1)
  assert.equal(rangesKnownEmpty(['empty', 'drawn', 'unknown']), 1)
  // Every range empty: the asset has no chart.
  assert.equal(rangesKnownEmpty(['empty', 'empty', 'empty']), 3)
})

test('the quote card says the tokens one receives and the shares beside them, in both languages (ST-5 r10)', () => {
  assert.equal(DETAILS_COPY.en.sharesBeside('4.5657', 4.5657), '(4.5657 shares)')
  assert.equal(DETAILS_COPY.en.sharesBeside('0.0002', 0.0002), '(0.0002 of a share)')
  assert.equal(DETAILS_COPY.en.sharesBeside('1', 1), '(1 share)')
  assert.equal(DETAILS_COPY.uk.sharesBeside('4,5657', 4.5657), '(4,5657 акції)')
  assert.equal(DETAILS_COPY.uk.sharesBeside('1', 1), '(1 акція)')
  assert.equal(DETAILS_COPY.uk.sharesBeside('3', 3), '(3 акції)')
  assert.equal(DETAILS_COPY.uk.sharesBeside('11', 11), '(11 акцій)')
  assert.equal(DETAILS_COPY.uk.sharesBeside('21', 21), '(21 акція)')
})
