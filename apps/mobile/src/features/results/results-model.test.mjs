import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  citationLabel,
  costPartText,
  forPlan,
  hasAnything,
  memoryLines,
  memorySentence,
  noTradeSentence,
  realisedLine,
  ruleTallies,
  shownStateOf,
  tallyFigure,
  tallyLine,
  verdictOf,
} from './results-model.ts'

const asset = (symbol, underlying = null) => ({ symbol, underlying: { symbol: underlying } })

const NOW = Date.parse('2026-10-05T16:40:00Z')

const occurrence = (dueAt, state, extra = {}) => ({
  dueAt,
  openUntil: dueAt,
  state,
  remindedAt: dueAt,
  signature: null,
  spentUsd: null,
  boughtAt: null,
  trigger: null,
  condition: null,
  amountUsd: null,
  events: null,
  ...extra,
})

const rule = (id, occurrences, extra = {}) => ({
  id,
  name: 'Apple',
  kind: 'schedule',
  asset: { mint: 'M', symbol: 'AAPLx', underlying: { symbol: 'AAPL' } },
  amountUsd: 1,
  schedule: { cadence: 'weekly', weekday: 4, monthDay: null, time: '19:00', timeZone: 'Europe/Kyiv' },
  dip: null,
  payments: null,
  priceCondition: null,
  status: 'active',
  nextDueAt: null,
  occurrences,
  ...extra,
})

test('a rule’s reminders against what was bought — only what the server states, the newest rule first', () => {
  const tallies = ruleTallies([
    rule('quiet', []),
    rule('older', [occurrence('2026-09-20T16:00:00Z', 'bought', { spentUsd: 1, signature: 'S1' })]),
    rule('a', [
      occurrence('2026-10-02T16:00:00Z', 'missed'),
      occurrence('2026-09-25T16:00:00Z', 'bought', { spentUsd: 1, signature: 'S2' }),
      occurrence('2026-09-18T16:00:00Z', 'bought', { spentUsd: 1.004, signature: 'S3' }),
      occurrence('2026-09-11T16:00:00Z', 'held'),
    ]),
  ], NOW)
  // A rule no reminder has come for yet has no result.
  assert.deepEqual(tallies.map((tally) => tally.rule.id), ['a', 'older'])
  const [a] = tallies
  assert.equal(a.bought, 2)
  assert.equal(a.reminders.length, 4)
  assert.equal(a.spentUsd, 2)
  assert.deepEqual(a.others, [
    { state: 'missed', count: 1 },
    { state: 'held', count: 1 },
  ])
  assert.equal(tallyLine(a, 'uk'), 'Витрачено $2 · 1 пропущено · 1 стримано бюджетом')
  assert.equal(tallyFigure(a, 'uk'), 'Куплено 2 з 4')
  assert.equal(tallyLine(a, 'en'), '$2 spent · 1 missed · 1 held by the budget')
})

test('a bought reminder without its sum makes the spent figure a dash, never a smaller number', () => {
  const [tally] = ruleTallies([
    rule('r', [
      occurrence('2026-10-02T16:00:00Z', 'bought', { spentUsd: null, signature: 'S1' }),
      occurrence('2026-09-25T16:00:00Z', 'bought', { spentUsd: 5 }),
    ]),
  ], NOW)
  assert.equal(tally.spentUsd, null)
  assert.equal(tallyLine(tally, 'en'), '— spent')
})

test('a rule with nothing bought says what became of its reminders, and no spent figure', () => {
  const [tally] = ruleTallies(
    [rule('r', [occurrence('2026-10-05T16:30:00Z', 'deferred', { openUntil: '2026-10-05T20:00:00Z' }), occurrence('2026-09-25T16:00:00Z', 'missed')])],
    NOW,
  )
  assert.equal(tally.bought, 0)
  assert.equal(tallyLine(tally, 'uk'), '1 відкладено через ціну · 1 пропущено')
})

test('one plan’s results: the feed narrowed to it; the whole feed without one', () => {
  const feed = {
    address: 'W',
    sync: { pending: 0 },
    summary: { plans: 2, trades: 1, entries: 1, exits: 0, noTrade: 1, openPositions: 1, closedPositions: 0 },
    results: [{ planId: 'p1', actual: { signature: 'x' } }],
    outcomes: [{ planId: 'p2' }],
    positions: [{ planId: 'p1' }],
  }
  assert.equal(forPlan(feed, null), feed)
  const one = forPlan(feed, 'p2')
  assert.deepEqual([one.results.length, one.outcomes.length, one.positions.length], [0, 1, 0])
  assert.equal(hasAnything(one, [], 0), true)
  assert.equal(hasAnything(forPlan(feed, 'p3'), [], 0), false)
})

test('a cost part that was not established is a dash, never a zero; a percentage keeps its comma in Ukrainian', () => {
  assert.equal(costPartText({ usd: null, pct: null, basis: 'unknown', reason: 'no-review' }, 'en'), null)
  assert.equal(costPartText({ usd: 0.12, pct: 0.5, basis: 'derived', reason: null }, 'en'), '+$0.12 · +0.50%')
  assert.equal(costPartText({ usd: -0.12, pct: -0.5, basis: 'derived', reason: null }, 'uk'), '−$0,12 · −0,50%')
})

test('an exit is judged by its own adherence, an entry by the plan’s checks', () => {
  assert.deepEqual(verdictOf({ verdict: 'unknown', exit: { verdict: 'followed' } }, 'uk'), { word: 'Виконав кожне правило', tone: 'success' })
  assert.deepEqual(verdictOf({ verdict: 'deviated', exit: null }, 'en'), { word: 'Off the plan', tone: 'warning' })
  assert.deepEqual(verdictOf({ verdict: 'unknown', exit: null }, 'en'), { word: 'Not judged', tone: 'neutral' })
})

test('no trade is said about a rule, never about the person, in the reader’s language', () => {
  const outcome = { asset: asset('NVDAx', 'NVDA'), reason: 'entry-bound-unmet', everyReview: true, reviews: 3 }
  assert.equal(noTradeSentence(outcome, 'uk'), 'Без угоди: виконувана ціна лишалася вищою за максимум, який готовий платити план — в усіх 3 Review.')
  assert.equal(noTradeSentence({ ...outcome, reason: 'no-review' }, 'en'), 'NVDA is live and nothing has been reviewed under it yet.')
  assert.doesNotMatch(noTradeSentence({ ...outcome, reason: 'review-blocked' }, 'en'), /fail/i)
})

test('a realised figure is absent with its reasons; an unknown reason is left out, never printed as an id', () => {
  const position = { realisedUsd: null, unknowns: ['position-open', 'something-new'] }
  assert.equal(realisedLine(position, 'uk'), 'Реалізованого результату немає, бо позиція ще відкрита.')
  assert.equal(realisedLine({ realisedUsd: 3, unknowns: [] }, 'en'), null)
})

test('memory: a sentence from the fact’s own figures; a fact that does not make one is not shown', () => {
  const fact = (kind, figures, symbol = 'NVDA') => ({
    id: kind,
    kind,
    scope: { kind: 'asset', mint: 'M', symbol, planId: null },
    figures: figures.map(([key, value, text = null]) => ({ key, value, text, unit: 'count' })),
    cites: [{ kind: 'version', id: 'p1#2', at: null, href: '/app/strategies/plans/p1' }],
    observedAt: '2026-10-05T10:00:00Z',
  })
  assert.equal(memorySentence(fact('plans-written', [['plans', 3], ['active', 1]]), 'uk'), '3 плани на NVDA, з них 1 активний.')
  assert.equal(memorySentence(fact('plans-written', [['plans', 1], ['active', 1]]), 'uk'), '1 план на NVDA — активний.')
  assert.equal(memorySentence(fact('plans-written', [['plans', 2], ['active', 2]]), 'en'), '2 plans written on NVDA — all live.')
  assert.equal(memorySentence(fact('blocked-by-rule', [['plans', 2], ['rule', null, 'entryPrice']]), 'en'), '2 plans on NVDA never traded: the rule “entry bound” refused every Review.')
  // A rule id the phone does not know, or a kind it does not know, is not said.
  assert.equal(memorySentence(fact('blocked-by-rule', [['plans', 2], ['rule', null, 'brandNewCheck']]), 'en'), null)
  assert.equal(memorySentence(fact('monitoring-said', [['finding', null, 'plan.mystery']]), 'en'), null)
  assert.equal(memoryLines([fact('position-open', [])], 'en').length, 0)
  assert.equal(citationLabel({ kind: 'version', id: 'p1#2', at: null, href: null }, 'uk'), 'Версія 2')
  assert.equal(citationLabel({ kind: 'plan', id: 'abcdef0123', at: null, href: null }, 'en'), 'Plan')
})

test('a reminder is open only while its window lasts and the rule is on; one that lapsed is missed, never “open now”', () => {
  const open = occurrence('2026-10-05T16:30:00Z', 'due', { openUntil: '2026-10-05T20:00:00Z' })
  const lapsed = occurrence('2026-10-04T16:30:00Z', 'due', { openUntil: '2026-10-04T20:00:00Z' })
  assert.equal(shownStateOf(rule('r', []), open, NOW), 'open')
  assert.equal(shownStateOf(rule('r', [], { status: 'paused' }), open, NOW), 'paused')
  assert.equal(shownStateOf(rule('r', []), lapsed, NOW), 'missed')
  // A purchase the price held back to the end is said so, never as the person's miss.
  assert.equal(shownStateOf(rule('r', []), { ...lapsed, state: 'deferred' }, NOW), 'priceHeld')
  const [tally] = ruleTallies([rule('r', [open, lapsed])], NOW)
  // Only the reminders that are over count against the purchases.
  assert.equal(tally.settled, 1)
  assert.equal(tallyFigure(tally, 'en'), '0 of 1 bought')
  assert.equal(tallyLine(tally, 'uk'), '1 відкрите зараз · 1 пропущено')
  const [fresh] = ruleTallies([rule('r', [open])], NOW)
  assert.equal(tallyFigure(fresh, 'uk'), null)
  const [two] = ruleTallies([rule('r', [open, { ...open, dueAt: '2026-10-05T16:31:00Z' }])], NOW)
  assert.equal(tallyLine(two, 'uk'), '2 відкриті зараз')
})
