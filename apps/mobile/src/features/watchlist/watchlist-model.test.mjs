import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseWatchlist, toggleMint, WATCHLIST_LIMIT } from './watchlist-model.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'

test('the limit is the web watchlist limit', () => {
  assert.equal(WATCHLIST_LIMIT, 200)
})

test('stored text becomes a clean list; garbage becomes an empty one', () => {
  assert.deepEqual(parseWatchlist(undefined), [])
  assert.deepEqual(parseWatchlist(''), [])
  assert.deepEqual(parseWatchlist('not json'), [])
  assert.deepEqual(parseWatchlist('{"a":1}'), [])
  assert.deepEqual(parseWatchlist(JSON.stringify([SOL, 'nope', SOL, 42, NVDA])), [SOL, NVDA])
})

test('toggle adds an absent mint at the end and removes a present one', () => {
  const added = toggleMint([SOL], NVDA)
  assert.deepEqual(added, { mints: [SOL, NVDA], added: true, refused: false })
  const removed = toggleMint(added.mints, SOL)
  assert.deepEqual(removed, { mints: [NVDA], added: false, refused: false })
})

test('a full list refuses another mint and keeps itself unchanged', () => {
  const full = Array.from({ length: WATCHLIST_LIMIT }, () => SOL)
  const result = toggleMint(full, NVDA)
  assert.equal(result.refused, true)
  assert.equal(result.added, false)
  assert.equal(result.mints, full)
})

test('an address that is not a mint is refused', () => {
  assert.equal(toggleMint([], 'hello').refused, true)
})
