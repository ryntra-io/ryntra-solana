import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HIDDEN_LIMIT, parseHidden, toggleHidden } from './hidden-model.ts'
import { reportTokenMailto } from './report.ts'

const MINT = 'Ckp1DhbW5vNJbHbsvAUNWzFT9Vi1NLuWfE3t6Vk5pump'
const OTHER = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const FACTS = { mint: MINT, symbol: 'THUMB', name: 'Thumb', page: `https://ryntra.io/app/launch/${MINT}`, reporter: null }

function read(url) {
  const [to, query] = url.slice('mailto:'.length).split('?')
  const params = new URLSearchParams(query)
  return { to, subject: params.get('subject'), body: params.get('body') }
}

test('a report names the token by its address and its page, to the one inbox', () => {
  const letter = read(reportTokenMailto(FACTS, 'en'))
  assert.equal(letter.to, 'hello@ryntra.io')
  assert.equal(letter.subject, 'Report a token: $THUMB')
  assert.match(letter.body, new RegExp(`Address: ${MINT}`))
  assert.match(letter.body, new RegExp(`Page: https://ryntra.io/app/launch/${MINT}`))
})

test('the reporter’s wallet is in the letter only when one is connected', () => {
  assert.doesNotMatch(read(reportTokenMailto(FACTS, 'en')).body, /My wallet/)
  assert.match(read(reportTokenMailto({ ...FACTS, reporter: OTHER }, 'en')).body, new RegExp(`My wallet: ${OTHER}`))
})

test('in Ukrainian the report speaks Ukrainian', () => {
  const letter = read(reportTokenMailto(FACTS, 'uk'))
  assert.equal(letter.subject, 'Скарга на токен: $THUMB')
  assert.match(letter.body, new RegExp(`Адреса: ${MINT}`))
})

test('hiding is a toggle on this phone’s own list', () => {
  const hidden = toggleHidden([], MINT)
  assert.deepEqual(hidden, [MINT])
  assert.deepEqual(toggleHidden(hidden, MINT), [])
  assert.deepEqual(toggleHidden(hidden, OTHER), [MINT, OTHER])
})

test('only addresses are kept; a broken store reads as nothing hidden', () => {
  assert.deepEqual(toggleHidden([], 'not a mint'), [])
  assert.deepEqual(parseHidden('{oops'), [])
  assert.deepEqual(parseHidden(JSON.stringify([MINT, 7, 'x', MINT])), [MINT])
  assert.deepEqual(parseHidden(null), [])
})

test('past the limit the oldest hidden falls off', () => {
  const many = Array.from({ length: HIDDEN_LIMIT }, (_, index) => `${String(index).padStart(4, '1')}${OTHER.slice(4)}`)
  const next = toggleHidden(many, MINT)
  assert.equal(next.length, HIDDEN_LIMIT)
  assert.equal(next.at(-1), MINT)
  assert.equal(next[0], many[1])
})
