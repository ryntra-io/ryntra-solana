import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BLOCKED_STEMS, BLOCKED_WORDS, carriesBlocked, isBlockedToken, wordParts } from './blocked-names.ts'

// Neutral stand-ins for the list: a stem matched inside a word and a word matched only whole.
const STEMS = ['zorbq']
const WORDS = ['blip']

test('a stem is found inside a word, in any case, with digits for letters', () => {
  assert.equal(carriesBlocked('ZORBQ', STEMS, WORDS), true)
  assert.equal(carriesBlocked('zorbqinu', STEMS, WORDS), true)
  assert.equal(carriesBlocked('Baby Z0RBQ Coin', STEMS, WORDS), true)
  assert.equal(carriesBlocked('zor bq', STEMS, WORDS), true)
  assert.equal(carriesBlocked('zorb', STEMS, WORDS), false)
})

test('a word is found only whole — a symbol, a word part, a case turn, a plural', () => {
  assert.equal(carriesBlocked('BLIP', STEMS, WORDS), true)
  assert.equal(carriesBlocked('Moon Blips', STEMS, WORDS), true)
  assert.equal(carriesBlocked('MoonBlip', STEMS, WORDS), true)
  assert.equal(carriesBlocked('blip-dog', STEMS, WORDS), true)
  // An ordinary word that merely holds it stays.
  assert.equal(carriesBlocked('Bliptastic', STEMS, WORDS), false)
  assert.equal(carriesBlocked('Moonblipper', STEMS, WORDS), false)
  assert.equal(carriesBlocked('', STEMS, WORDS), false)
})

test('word parts split at signs, spaces and a lower-to-upper turn', () => {
  assert.deepEqual(wordParts('NvdaIntelGme'), ['nvda', 'intel', 'gme'])
  assert.deepEqual(wordParts('NVIDIA - Securitize'), ['nvidia', 'securitize'])
})

test('the list is short, lower case, and ordinary names pass it', () => {
  assert.ok(BLOCKED_STEMS.length > 0 && BLOCKED_WORDS.length > 0)
  for (const entry of [...BLOCKED_STEMS, ...BLOCKED_WORDS]) assert.equal(entry, entry.toLowerCase())
  for (const [symbol, name] of [
    ['SOL', 'Solana'],
    ['NVDAx', 'NVIDIA xStock'],
    ['SPICY', 'Spicy Coin'],
    ['RACCOON', 'Raccoon'],
    ['BONK', 'Bonk'],
    ['SPACEX', 'SpaceX'],
    ['FAGUS', 'Beech'],
    ['GOOGL', 'Alphabet'],
    ['NVDGE', 'NVDA Doge'],
  ]) {
    assert.equal(isBlockedToken({ symbol, name }), false, `${symbol} · ${name}`)
  }
  // Each entry is caught as a symbol, with a $ before it too.
  for (const entry of [...BLOCKED_STEMS, ...BLOCKED_WORDS]) {
    assert.equal(isBlockedToken({ symbol: entry.toUpperCase(), name: 'Plain' }), true)
    assert.equal(isBlockedToken({ symbol: `$${entry}`, name: 'Plain' }), true)
  }
})
