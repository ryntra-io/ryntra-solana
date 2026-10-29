import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  initialAnswers,
  memoryFailureOf,
  mergeMemory,
  newNotes,
  noteSourceText,
  notesNewestFirst,
  profileSummary,
  profileUpdateOf,
  quietWindowOf,
  SKIP_UPDATE,
  walletLine,
} from './memory-model.ts'

const profile = (overrides = {}) => ({
  skipped: false,
  goal: 'learn',
  experience: 'new',
  riskPct: 1,
  horizon: 'days',
  updatedAt: '2026-10-22T08:00:00.000Z',
  ...overrides,
})

const read = (overrides = {}) => ({
  profile: null,
  delivery: { inbox: true, telegram: false, push: true, quietHours: null },
  ...overrides,
})

const note = (id, at, source = 'said') => ({ id, text: `note ${id}`, source, at })

test('the answers read in one line, in both languages', () => {
  assert.equal(profileSummary(profile(), 'uk'), 'Ти: вчуся · новачок · ризик 1 % · дні')
  assert.equal(
    profileSummary(profile({ goal: 'trade', experience: 'pro', riskPct: 0.5, horizon: 'hours' }), 'uk'),
    'Ти: торгую · досвідчений · ризик 0,5 % · години',
  )
  assert.equal(
    profileSummary(profile({ goal: 'hold', experience: 'some', riskPct: 2, horizon: 'weeks' }), 'en'),
    'You: holding · some experience · risk 2 % · weeks',
  )
  assert.equal(profileSummary(profile({ riskPct: 0.5 }), 'en'), 'You: learning · new · risk 0.5 % · days')
})

test('no summary without answers', () => {
  assert.equal(profileSummary(null, 'uk'), null)
  assert.equal(profileSummary(undefined, 'en'), null)
  assert.equal(profileSummary(profile({ skipped: true }), 'uk'), null)
  assert.equal(profileSummary(profile({ horizon: null }), 'uk'), null)
})

test('skipping is its own body', () => {
  assert.deepEqual(SKIP_UPDATE, { skipped: true })
})

test('the four answers go up with where notes go', () => {
  const window = { start: '23:00', end: '08:00', timezone: 'Europe/Kyiv' }
  const answers = {
    goal: 'trade',
    experience: 'some',
    riskPct: 2,
    horizon: 'weeks',
    telegram: true,
    push: false,
    quiet: true,
  }
  assert.deepEqual(profileUpdateOf(answers, window), {
    goal: 'trade',
    experience: 'some',
    riskPct: 2,
    horizon: 'weeks',
    delivery: { telegram: true, push: false, quietHours: window },
  })
  assert.equal(profileUpdateOf({ ...answers, quiet: false }, window).delivery.quietHours, null)
  assert.equal(profileUpdateOf({ ...answers, horizon: null }, window), null)
  assert.equal(profileUpdateOf({ ...answers, goal: null }, window), null)
})

test('the card starts from what was saved; the window kept from Нагляд', () => {
  const first = initialAnswers(read())
  assert.deepEqual(first, {
    goal: null,
    experience: null,
    riskPct: 1,
    horizon: null,
    telegram: false,
    push: true,
    quiet: true,
  })
  const saved = initialAnswers(
    read({
      profile: profile({ riskPct: 0.5 }),
      delivery: { inbox: true, telegram: true, push: false, quietHours: null },
    }),
  )
  assert.equal(saved.goal, 'learn')
  assert.equal(saved.riskPct, 0.5)
  assert.equal(saved.quiet, false)
  const own = { start: '22:00', end: '07:00', timezone: 'Europe/Warsaw' }
  assert.deepEqual(
    quietWindowOf(read({ delivery: { inbox: true, telegram: false, push: false, quietHours: own } }), 'Europe/Kyiv'),
    own,
  )
  assert.deepEqual(quietWindowOf(read(), 'Europe/Kyiv'), { start: '23:00', end: '08:00', timezone: 'Europe/Kyiv' })
})

test('a note says where it came from', () => {
  assert.equal(noteSourceText('said', 'uk'), 'з розмови')
  assert.equal(noteSourceText('asked', 'uk'), 'на твоє прохання')
  assert.equal(noteSourceText('typed', 'uk'), 'додано вручну')
  assert.equal(noteSourceText('asked', 'en'), 'at your ask')
})

test('the new notes are those the snapshot did not hold', () => {
  const before = new Set(['a', 'b'])
  const after = [
    note('a', '2026-10-22T08:00:00Z'),
    note('b', '2026-10-22T08:01:00Z'),
    note('c', '2026-10-22T08:02:00Z'),
  ]
  assert.deepEqual(
    newNotes(before, after).map((row) => row.id),
    ['c'],
  )
  assert.deepEqual(newNotes(new Set(['a', 'b', 'c']), after), [])
  assert.deepEqual(newNotes(before, [after[0]]), [])
  assert.deepEqual(
    notesNewestFirst(after).map((row) => row.id),
    ['c', 'b', 'a'],
  )
})

test('the wallet in one line; a dash when it was not read', () => {
  const picture = {
    state: 'current',
    tokens: 12,
    largest: [
      { symbol: 'SOL', mint: 'x' },
      { symbol: 'JUP', mint: 'y' },
    ],
  }
  assert.equal(walletLine(picture, 'uk'), 'Твій гаманець зараз: 12 токенів · найбільші SOL, JUP')
  assert.equal(walletLine({ ...picture, tokens: 1, largest: [] }, 'en'), 'Your wallet now: 1 token')
  assert.equal(walletLine({ ...picture, tokens: 3, largest: [] }, 'uk'), 'Твій гаманець зараз: 3 токени')
  assert.equal(walletLine({ state: 'unavailable', tokens: null, largest: [] }, 'uk'), 'Твій гаманець зараз: —')
})

test("a write keeps the wallet's picture already shown", () => {
  const shown = {
    about: null,
    noticing: true,
    notes: [],
    profile: null,
    wallet: { state: 'current', tokens: 4, largest: [] },
    updatedAt: null,
  }
  const next = { ...shown, about: 'hi', wallet: { state: 'unavailable', tokens: null, largest: [] } }
  assert.deepEqual(mergeMemory(shown, next).wallet, shown.wallet)
  assert.equal(mergeMemory(shown, next).about, 'hi')
  assert.deepEqual(mergeMemory(undefined, next).wallet, next.wallet)
})

test('a secret is said plainly', () => {
  assert.equal(memoryFailureOf(new ApiError('MEMORY_SECRET_REFUSED', 'no', 422)), 'secret')
  assert.equal(memoryFailureOf(new ApiError('VALIDATION_ERROR', 'no', 400)), 'failed')
  assert.equal(memoryFailureOf(new TypeError('Network request failed')), 'network')
})
