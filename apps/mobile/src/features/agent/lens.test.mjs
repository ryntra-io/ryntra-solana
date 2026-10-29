import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import { criticKindLabel, criticWords, LENS_COPY } from './lens-copy.ts'
import {
  briefRequest,
  criticOffer,
  criticRequest,
  lensDoors,
  lensFailureOf,
  lensFindings,
  lensPath,
  lensSources,
  lensSubjectOf,
  sentencesOf,
  shownCriticPrice,
} from './lens-model.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const PLAN = 'plan_0123456789abcdef0123456789abcdef'

const credits = (overrides = {}) => ({
  unit: 'credits',
  balance: 500,
  welcome: 0,
  bought: 500,
  free: { used: 0, left: 20, daily: 20, resetsAt: '2026-10-23T00:00:00.000Z' },
  reserved: 0,
  dailySpend: { used: 0, cap: 2000, resetsAt: '2026-10-23T00:00:00.000Z' },
  prices: { question: 2, alertExplain: 2, tokenReport: 5, priceMove: 3, voice: 24, deep: 60, plan: 80 },
  welcomeOffer: 'taken',
  holder: 'wallet',
  ...overrides,
})

const budget = (overrides = {}) => ({
  unit: 'calls',
  day: { used: 0, allowance: 100, resetsAt: '2026-10-23T00:00:00.000Z' },
  month: { used: 0, allowance: 1000, resetsAt: '2026-11-01T00:00:00.000Z' },
  inFlight: { used: 0, limit: 1 },
  exhausted: false,
  reason: null,
  model: 'configured',
  credits: credits(),
  ...overrides,
})

test('the Lens opens on an asset, a plan and the portfolio — never on a note, a page or nothing', () => {
  assert.deepEqual(lensSubjectOf({ kind: 'asset', mint: SOL, symbol: 'SOL' }), { kind: 'asset', mint: SOL, symbol: 'SOL' })
  assert.deepEqual(lensSubjectOf({ kind: 'plan', planId: PLAN }), { kind: 'plan', planId: PLAN })
  assert.deepEqual(lensSubjectOf({ kind: 'portfolio' }), { kind: 'portfolio' })
  assert.equal(lensSubjectOf({ kind: 'note', inboxId: 'abcd1234' }), null)
  assert.equal(lensSubjectOf({ kind: 'page', page: 'spot' }), null)
  assert.equal(lensSubjectOf(null), null)

  assert.equal(lensPath({ kind: 'asset', mint: SOL, symbol: 'SOL' }), `/lens?context=asset%3A${SOL}%3ASOL`)
  assert.equal(lensPath({ kind: 'plan', planId: PLAN }), `/lens?context=plan%3A${PLAN}`)
  assert.equal(lensPath({ kind: 'portfolio' }), '/lens?context=portfolio')
  assert.equal(lensPath({ kind: 'note', inboxId: 'abcd1234' }), null)
  assert.equal(lensPath({ kind: 'page', page: 'results' }), null)
})

test('the brief is asked composed from the reads — no model, no credits', () => {
  assert.deepEqual(briefRequest({ kind: 'portfolio' }, 'uk'), { subject: { kind: 'portfolio' }, locale: 'uk', compose: 'deterministic' })
})

test('the critic carries exactly the price shown, and nothing where credits are not served', () => {
  const subject = { kind: 'asset', mint: SOL, symbol: 'SOL' }

  const paid = criticOffer(budget())
  assert.equal(paid.kind, 'priced')
  assert.equal(shownCriticPrice(paid), 60)
  assert.deepEqual(criticRequest(subject, 'en', paid), { subject, locale: 'en', compose: 'model', acceptCredits: 60 })

  // No credits on this deployment: no price, no acceptCredits.
  const unserved = criticOffer(budget({ credits: undefined }))
  assert.deepEqual(unserved, { kind: 'none' })
  assert.equal(shownCriticPrice(unserved), null)
  assert.deepEqual(criticRequest(subject, 'en', unserved), { subject, locale: 'en', compose: 'model' })
  assert.equal('acceptCredits' in criticRequest(subject, 'en', unserved), false)

  // No model composes here: nothing would be charged, so nothing is priced.
  assert.deepEqual(criticOffer(budget({ model: 'absent' })), { kind: 'none' })
  assert.deepEqual(criticOffer(null), { kind: 'none' })

  // Short of credits: no price shown, none sent — the server answers from the reads and takes nothing.
  const short = criticOffer(budget({ credits: credits({ balance: 10, free: { used: 20, left: 0, daily: 20, resetsAt: 'x' } }) }))
  assert.equal(short.kind === 'priced' && short.paid.kind, 'short')
  assert.equal(shownCriticPrice(short), null)
  assert.equal('acceptCredits' in criticRequest(subject, 'en', short), false)
})

test('the price line says what pays it, and a door to top up when the credits are short', () => {
  const uk = LENS_COPY.uk
  const en = LENS_COPY.en

  const free = criticWords(criticOffer(budget({ credits: credits({ free: { used: 0, left: 100, daily: 100, resetsAt: 'x' } }) })), uk, 'uk')
  assert.equal(free.button, 'Оскаржити це · 60 кредитів')
  assert.equal(free.paid, 'Оплатять безкоштовні кредити дня')
  assert.equal(free.topUp, false)

  const balance = criticWords(criticOffer(budget()), en, 'en')
  assert.equal(balance.button, 'Challenge this · 60 credits')
  assert.equal(balance.paid, '40 credits from the balance (500)')

  const short = criticWords(
    criticOffer(budget({ credits: credits({ balance: 0, free: { used: 20, left: 0, daily: 20, resetsAt: 'x' } }) })),
    uk,
    'uk',
  )
  assert.equal(short.button, 'Оскаржити це')
  assert.equal(short.paid, 'Бракує кредитів')
  assert.equal(short.topUp, true)
  assert.ok(short.note)

  const cap = criticWords(
    criticOffer(budget({ credits: credits({ free: { used: 20, left: 0, daily: 20, resetsAt: 'x' }, dailySpend: { used: 1990, cap: 2000, resetsAt: 'x' } }) })),
    uk,
    'uk',
  )
  assert.equal(cap.button, 'Оскаржити це')
  assert.equal(cap.paid, 'Денний ліміт кредитів досягнуто')
  assert.equal(cap.topUp, false)

  const none = criticWords({ kind: 'none' }, uk, 'uk')
  assert.deepEqual(none, { button: 'Оскаржити це', paid: null, note: null, topUp: false })
})

test('findings keep the server’s order and drop the word-less; kinds wear the web’s labels', () => {
  const critic = {
    findings: [
      { id: 'f1', kind: 'evidence-missing', text: 'The price read is stale.', figures: [], cites: [], state: 'stale' },
      { id: 'f2', kind: 'thesis-weakness', text: '   ', figures: [], cites: [], state: 'current' },
      { id: 'f3', kind: 'asset-structure', text: 'Mint authority is live.', figures: [], cites: [], state: 'current' },
    ],
    gaps: [],
    insufficient: false,
  }
  assert.deepEqual(
    lensFindings(critic).map((finding) => finding.id),
    ['f1', 'f3'],
  )
  assert.equal(criticKindLabel('previous-result', LENS_COPY.uk), 'Твій власний запис')
  assert.equal(criticKindLabel('assumption-conflict', LENS_COPY.en), 'Assumption')
  assert.deepEqual(sentencesOf([{ text: ' a ', cites: [] }, { text: '', cites: [] }]), ['a'])
})

test('doors lead to the phone’s own places, once each; sources by name and time', () => {
  const doors = lensDoors({
    cards: [],
    handoffs: [
      { kind: 'results', href: '/app/results', label: 'Open Results', primary: false },
      { kind: 'results', href: '/app/results?tab=all', label: 'Open Results', primary: false },
      { kind: 'plan', href: '/app/settings', label: 'Settings', primary: false },
    ],
  })
  // The settings have no place on the phone; the two Results links are one place there.
  assert.deepEqual(
    doors.map((door) => [door.path.split('?')[0], door.words.kind]),
    [['/results', 'results']],
  )

  assert.deepEqual(
    lensSources([
      { id: 'c1', tool: 't', source: 'Jupiter price', observedAt: '2026-10-22T10:00:00.000Z', state: 'current', ref: null, href: null },
      { id: 'c2', tool: 't', source: '  ', observedAt: null, state: 'unknown', ref: null, href: null },
    ]),
    [{ key: 'c1-0', source: 'Jupiter price', observedAt: '2026-10-22T10:00:00.000Z', state: 'current' }],
  )
})

test('a failure is said in the app’s words', () => {
  assert.equal(lensFailureOf(new ApiError('AGENT_BUSY', 'busy', 409)), 'busy')
  assert.equal(lensFailureOf(new TypeError('Network request failed')), 'network')
  assert.equal(lensFailureOf(new ApiError('UNAVAILABLE', 'nope', 500)), 'unavailable')
})
