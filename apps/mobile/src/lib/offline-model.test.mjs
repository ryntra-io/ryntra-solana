import assert from 'node:assert/strict'
import { test } from 'node:test'

import { freshEnough, KEPT_MAX_AGE_MS, keepsQuery, offlineFrom } from './offline-model.ts'

test('the public reads a person looks back at are kept; a private read, a price to act on, a search and a chart are not', () => {
  assert.equal(keepsQuery(['trade', 'holdings', 'XsoC']), true)
  assert.equal(keepsQuery(['markets', 'stocks']), true)
  assert.equal(keepsQuery(['market', 'So11111111111111111111111111111111111111112']), true)
  assert.equal(keepsQuery(['stocks', 'popular', 12]), true, '«Популярне» is a public read, kept')

  assert.equal(keepsQuery(['trade', 'quote', 'a', 'b', '100']), false)
  assert.equal(keepsQuery(['stocks', 'quote', 'NVDAx', 'buy', 5]), false)
  assert.equal(keepsQuery(['markets', 'search', 'nvda']), false)
  assert.equal(keepsQuery(['candles', 'mint', '1D']), false)
  // Nothing read behind the session is written to the device.
  assert.equal(keepsQuery(['private', 'activity', 'XsoC', 'proven']), false)
  assert.equal(keepsQuery(['private', 'rules', 'list', 'XsoC']), false)
  assert.equal(keepsQuery(['private', 'plan', 'XsoC', 'plan_1']), false)
  assert.equal(keepsQuery(['private', 'agent-draft', 'XsoC', 'agd_1']), false)
  // The shelf keeps its own copy and says when it is the device's.
  assert.equal(keepsQuery(['stocks', 'shelf']), false)
})

test('a kept answer comes back for a week, not longer', () => {
  const now = Date.parse('2026-10-05T12:00:00.000Z')
  assert.equal(freshEnough(now - 60_000, now), true)
  assert.equal(freshEnough(now - KEPT_MAX_AGE_MS, now), true)
  assert.equal(freshEnough(now - KEPT_MAX_AGE_MS - 1, now), false)
  assert.equal(freshEnough(0, now), false)
  assert.equal(freshEnough(Number.NaN, now), false)
})

test('no network is said only when the phone says so', () => {
  assert.equal(offlineFrom({ isConnected: false, isInternetReachable: false }), true)
  // Not validated by Android is not offline: the API may still answer.
  assert.equal(offlineFrom({ isConnected: true, isInternetReachable: false }), false)
  assert.equal(offlineFrom({ isConnected: true, isInternetReachable: true }), false)
  assert.equal(offlineFrom({ isConnected: true, isInternetReachable: null }), false)
  assert.equal(offlineFrom({}), false)
})
