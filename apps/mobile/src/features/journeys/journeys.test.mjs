import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendJourney,
  JOURNEY_LIMIT,
  journeyLine,
  parseJourneys,
  sanitizeJourney,
  serializeJourneys,
  summarizeJourneys,
} from './journeys.ts'

const AT = '2026-09-22T10:00:00.000Z'

test('a journey is words from a closed shape; anything else is dropped or refused', () => {
  assert.deepEqual(sanitizeJourney({ at: AT, name: 'home_go', to: 'asset', state: 'signed-in' }), {
    at: AT,
    name: 'home_go',
    state: 'signed-in',
    to: 'asset',
  })
  // An address, an id, a sentence, a figure: none of them is a word.
  const leaky = sanitizeJourney({
    at: AT,
    name: 'note_open',
    from: 'home',
    target: 'plan',
    to: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    address: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    token: 'secret',
    amount: 12.5,
    text: 'my thesis in full',
  })
  assert.deepEqual(leaky, { at: AT, name: 'note_open', from: 'home', target: 'plan' })
  assert.equal(sanitizeJourney({ at: AT, name: 'not_a_name' }), null)
  assert.equal(sanitizeJourney({ at: 'never', name: 'home_view' }), null)
  assert.equal(sanitizeJourney({ at: AT, name: 'home_view', state: 'admin' }).state, undefined)
  assert.equal(sanitizeJourney({ at: AT, name: 'home_go', to: 'inb_' + '2'.repeat(24) }).to, undefined)
  assert.equal(sanitizeJourney(null), null)
  assert.equal(sanitizeJourney('home_go'), null)
})

test('the ring keeps the newest up to the limit', () => {
  let list = []
  for (let index = 0; index < JOURNEY_LIMIT + 5; index += 1) {
    list = appendJourney(list, { at: AT, name: 'home_view', to: `s${index}` })
  }
  assert.equal(list.length, JOURNEY_LIMIT)
  assert.equal(list[0].to, 's5')
  assert.equal(list[list.length - 1].to, `s${JOURNEY_LIMIT + 4}`)
  assert.equal(appendJourney([], { at: AT, name: 'home_view' }, 1).length, 1)
})

test('the store round-trips and drops what does not pass', () => {
  const list = [
    { at: AT, name: 'home_view', state: 'guest' },
    { at: AT, name: 'home_go', to: 'plan' },
  ]
  assert.deepEqual(parseJourneys(serializeJourneys(list)), list)
  assert.deepEqual(parseJourneys(JSON.stringify([...list, { at: AT, name: 'nope' }, 'junk'])), list)
  assert.deepEqual(parseJourneys('{'), [])
  assert.deepEqual(parseJourneys(null), [])
  assert.deepEqual(parseJourneys('{"a":1}'), [])
})

test('the summary counts by name and where Home led', () => {
  const summary = summarizeJourneys([
    { at: '2026-09-22T09:00:00.000Z', name: 'home_view', state: 'signed-in' },
    { at: '2026-09-22T09:01:00.000Z', name: 'home_go', to: 'plan' },
    { at: '2026-09-22T09:02:00.000Z', name: 'home_go', to: 'plan' },
    { at: '2026-09-22T09:03:00.000Z', name: 'home_go', to: 'asset' },
    { at: AT, name: 'note_tap' },
  ])
  assert.equal(summary.count, 5)
  assert.equal(summary.byName.home_go, 3)
  assert.equal(summary.byName.note_tap, 1)
  assert.equal(summary.byName.plan_review, 0)
  assert.deepEqual(summary.homeGoTo, { plan: 2, asset: 1 })
  assert.equal(summary.first, '2026-09-22T09:00:00.000Z')
  assert.equal(summary.last, AT)
  assert.deepEqual(summarizeJourneys([]).first, null)
})

test('a line reads the way it happened', () => {
  assert.equal(
    journeyLine({ at: AT, name: 'note_open', from: 'home', target: 'choose' }),
    'note_open from home (choose)',
  )
  assert.equal(journeyLine({ at: AT, name: 'home_go', state: 'guest', to: 'markets' }), 'home_go guest → markets')
})
