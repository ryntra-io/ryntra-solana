import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import { PLAN_COPY } from './plan-copy.ts'
import {
  composeRequest,
  editFormOf,
  editRequest,
  EMPTY_COMPOSE,
  endLineOf,
  fieldOfIssue,
  findingGroups,
  isPlanId,
  parseFigure,
  parseTargets,
  planButtons,
  planFailureOf,
  plansByToken,
  stateTone,
} from './plans-model.ts'

const SOL = 'So11111111111111111111111111111111111111112'
const ALL_ACTIONS = { approve: true, watch: true, edit: true, recheck: true, cancel: true }
const NO_ACTIONS = { approve: false, watch: false, edit: false, recheck: false, cancel: false }

const body = {
  thesis: { text: 'SOL holds 180 while flows stay in', whyNow: null, horizonDays: 14, by: 'person' },
  entry: { priceUsd: 182.5, maxPriceUsd: 185, validUntil: '2026-10-30T00:00:00.000Z', condition: null, by: 'ryntra' },
  invalidation: { priceUsd: 170, by: 'person', why: null },
  lossLimit: { riskUsd: 50, budgetUsd: 1000 },
  targets: [
    { priceUsd: 200, by: 'ryntra', why: null },
    { priceUsd: 215, by: 'ryntra', why: null },
  ],
  fees: {},
  sizing: {},
  assumptions: [],
  sources: [],
}

const form = (overrides = {}) => ({ ...EMPTY_COMPOSE, mint: SOL, idea: '  SOL holds 180  ', risk: '50', ...overrides })

test('a figure is read in the person’s language: a comma is the decimal in Ukrainian, the thousands in English', () => {
  assert.equal(parseFigure('212,50', 'uk'), 212.5)
  assert.equal(parseFigure('0,125', 'uk'), 0.125)
  assert.equal(parseFigure('1 000', 'uk'), 1000)
  assert.equal(parseFigure('1,000', 'en'), 1000)
  assert.equal(parseFigure('212.50', 'en'), 212.5)
  assert.equal(parseFigure('', 'en'), 'empty')
  assert.equal(parseFigure('   ', 'uk'), 'empty')
  assert.equal(parseFigure('abc', 'en'), 'bad')
  assert.equal(parseFigure('0', 'en'), 'bad')
  assert.equal(parseFigure('-5', 'en'), 'bad')
  assert.equal(parseFigure('1,5', 'en'), 'bad')
  assert.equal(parseFigure('2000000000', 'en'), 'bad')
})

test('targets are apart by a space or a semicolon, at most three', () => {
  assert.deepEqual(parseTargets('200 215', 'en'), [200, 215])
  assert.deepEqual(parseTargets('200,5; 215,25', 'uk'), [200.5, 215.25])
  assert.deepEqual(parseTargets('200, 215', 'en'), [200, 215])
  assert.deepEqual(parseTargets('', 'en'), [])
  assert.equal(parseTargets('1 2 3 4', 'en'), 'tooMany')
  assert.equal(parseTargets('200 x', 'en'), 'bad')
})

test('composing needs the token, the idea and the loss limit or a budget — and carries exactly the price shown', () => {
  assert.deepEqual(composeRequest(form({ mint: null }), 'en', 130), { ok: false, need: { kind: 'token' } })
  assert.deepEqual(composeRequest(form({ mint: 'not-a-mint' }), 'en', 130), { ok: false, need: { kind: 'token' } })
  assert.deepEqual(composeRequest(form({ idea: '   ' }), 'en', 130), { ok: false, need: { kind: 'idea' } })
  assert.deepEqual(composeRequest(form({ risk: '' }), 'en', 130), { ok: false, need: { kind: 'money' } })
  assert.deepEqual(composeRequest(form({ risk: 'lots' }), 'en', 130), {
    ok: false,
    need: { kind: 'figure', field: 'risk' },
  })
  assert.deepEqual(composeRequest(form({ entry: '1,5' }), 'en', 130), {
    ok: false,
    need: { kind: 'figure', field: 'entry' },
  })
  assert.deepEqual(composeRequest(form({ targets: '1 2 3 4' }), 'en', 130), { ok: false, need: { kind: 'targets' } })
  assert.deepEqual(composeRequest(form({ days: '0' }), 'en', 130), { ok: false, need: { kind: 'days' } })
  assert.deepEqual(composeRequest(form({ days: '2.5' }), 'en', 130), { ok: false, need: { kind: 'days' } })
  assert.deepEqual(composeRequest(form(), 'en', null), { ok: false, need: { kind: 'price' } })

  const budgetOnly = composeRequest(form({ risk: '', budget: '1 000' }), 'uk', 130)
  assert.equal(budgetOnly.ok, true)
  assert.equal(budgetOnly.request.budgetUsd, 1000)
  assert.equal(budgetOnly.request.riskUsd, null)

  const built = composeRequest(
    form({ entry: '182,5', maxPrice: '185', invalidation: '170', targets: '200 215,5', days: '14' }),
    'uk',
    130,
  )
  assert.deepEqual(built, {
    ok: true,
    request: {
      mint: SOL,
      idea: 'SOL holds 180',
      riskUsd: 50,
      budgetUsd: null,
      entryUsd: 182.5,
      maxPriceUsd: 185,
      invalidationUsd: 170,
      targetsUsd: [200, 215.5],
      horizonDays: 14,
      acceptCredits: 130,
      locale: 'uk',
    },
  })
  // A free plan still carries the price shown: 0.
  assert.equal(composeRequest(form(), 'en', 0).request.acceptCredits, 0)
})

test('a change sends only what differs, with the version read; an emptied field keeps its figure', () => {
  const current = editFormOf(body, 'uk')
  assert.equal(current.entry, '182,5')
  assert.equal(current.targets, '200 215')
  assert.deepEqual(editRequest(body, 3, current, 'uk'), { kind: 'same' })
  assert.deepEqual(editRequest(body, 3, { ...current, entry: '' }, 'uk'), { kind: 'same' })
  assert.deepEqual(editRequest(body, 3, { ...current, invalidation: '172,5', reason: '  tighter  ' }, 'uk'), {
    kind: 'change',
    request: { ifVersion: 3, invalidationUsd: 172.5, reason: 'tighter', locale: 'uk' },
  })
  assert.deepEqual(editRequest(body, 3, { ...current, targets: '205' }, 'uk'), {
    kind: 'change',
    request: { ifVersion: 3, targetsUsd: [205], reason: null, locale: 'uk' },
  })
  assert.deepEqual(editRequest(body, 3, { ...current, risk: 'x' }, 'uk'), {
    kind: 'need',
    need: { kind: 'figure', field: 'risk' },
  })
})

test('the buttons are only what the plan allows now, the first drawn orange', () => {
  const prices = { recheck: 60 }
  assert.deepEqual(planButtons({ state: 'checked', actions: ALL_ACTIONS }, prices), [
    'approveWatch',
    'approve',
    'edit',
    'recheck',
    'cancel',
  ])
  assert.deepEqual(planButtons({ state: 'approved', actions: { ...NO_ACTIONS, watch: true, cancel: true } }, prices), [
    'watch',
    'cancel',
  ])
  assert.deepEqual(planButtons({ state: 'draft', actions: { ...NO_ACTIONS, recheck: true } }, { recheck: 0 }), [])
  assert.deepEqual(planButtons({ state: 'draft', actions: { ...NO_ACTIONS, recheck: true } }, null), [])
  assert.deepEqual(planButtons({ state: 'broken', actions: ALL_ACTIONS }, prices), [])
  assert.deepEqual(planButtons({ state: 'cancelled', actions: ALL_ACTIONS }, prices), [])
})

test('the critic’s findings are grouped serious · to fix · to know, in the server’s order', () => {
  const finding = (id, severity) => ({ id, severity, kind: 'level', field: 'entry', text: id, cites: [], by: 'rules' })
  const groups = findingGroups([
    finding('a', 'note'),
    finding('b', 'major'),
    finding('c', 'minor'),
    finding('d', 'major'),
  ])
  assert.deepEqual(
    groups.major.map((row) => row.id),
    ['b', 'd'],
  )
  assert.deepEqual(
    groups.minor.map((row) => row.id),
    ['c'],
  )
  assert.deepEqual(
    groups.note.map((row) => row.id),
    ['a'],
  )
})

test('every state has its words in both languages, a tone and an end line where it ended', () => {
  for (const state of ['draft', 'checked', 'approved', 'watching', 'done', 'cancelled', 'broken']) {
    assert.ok(PLAN_COPY.en.state[state])
    assert.ok(PLAN_COPY.uk.state[state])
    assert.ok(stateTone(state))
  }
  assert.equal(PLAN_COPY.uk.state.watching, 'Під наглядом')
  assert.equal(endLineOf({ state: 'broken', stateReason: 'invalidation' }), 'broken')
  assert.equal(endLineOf({ state: 'cancelled', stateReason: 'expired' }), 'expired')
  assert.equal(endLineOf({ state: 'cancelled', stateReason: 'person' }), null)
  assert.equal(endLineOf({ state: 'checked', stateReason: null }), null)
})

test('no word names a persona other than Ryntra, and both languages carry every key', () => {
  const words = JSON.stringify(PLAN_COPY.en) + JSON.stringify(PLAN_COPY.uk)
  assert.doesNotMatch(words, /\bRyn\b/)
  assert.deepEqual(Object.keys(PLAN_COPY.uk).sort(), Object.keys(PLAN_COPY.en).sort())
  assert.equal(PLAN_COPY.uk.horizon(1), '1 день')
  assert.equal(PLAN_COPY.uk.horizon(3), '3 дні')
  assert.equal(PLAN_COPY.uk.horizon(11), '11 днів')
})

test('a token’s plans come first, newest first', () => {
  const plan = (id, mint, updatedAt) => ({ id, mint, updatedAt })
  const plans = [
    plan('a', 'X', '2026-10-20T10:00:00Z'),
    plan('b', SOL, '2026-10-21T10:00:00Z'),
    plan('c', SOL, '2026-10-22T10:00:00Z'),
  ]
  const split = plansByToken(plans, SOL)
  assert.deepEqual(
    split.here.map((row) => row.id),
    ['c', 'b'],
  )
  assert.deepEqual(
    split.other.map((row) => row.id),
    ['a'],
  )
  assert.deepEqual(
    plansByToken(plans, null).other.map((row) => row.id),
    ['c', 'b', 'a'],
  )
})

test('a refusal becomes one line of its own kind', () => {
  const fail = (code, message = '', status = 400, details = {}) => new ApiError(code, message, status, null, details)
  assert.equal(planFailureOf(new Error('offline')).kind, 'network')
  assert.equal(
    planFailureOf(fail('AGENT_BUDGET_EXHAUSTED', 'The price is now 140 credits — more than the 130 shown.', 429)).kind,
    'priceChanged',
  )
  assert.equal(
    planFailureOf(
      fail('AGENT_BUDGET_EXHAUSTED', 'This needs 130 credits; today’s free ones and the balance hold fewer.', 429),
    ).kind,
    'short',
  )
  assert.equal(
    planFailureOf(fail('AGENT_BUDGET_EXHAUSTED', "The day's limit of 2000 credits is reached.", 429)).kind,
    'dayCap',
  )
  assert.equal(planFailureOf(fail('PRICE_NOT_SHOWN')).kind, 'priceChanged')
  assert.equal(planFailureOf(fail('AGENT_BUSY', '', 429)).kind, 'busy')
  assert.equal(planFailureOf(fail('ASSISTANT_PLAN_VERSION_CONFLICT', '', 409)).kind, 'conflict')
  assert.equal(planFailureOf(fail('SOMETHING_VERSION_CONFLICT', '', 409)).kind, 'conflict')
  assert.equal(
    planFailureOf(fail('ASSISTANT_PLAN_STATE_REFUSED', 'An ended plan is not changed.', 409)).kind,
    'refused',
  )
  assert.equal(
    planFailureOf(fail('ASSISTANT_PLAN_STATE_REFUSED', 'A wallet keeps 20 open plans; end one first.', 409)).kind,
    'limit',
  )
  assert.equal(planFailureOf(fail('ASSISTANT_PLAN_NOT_FOUND', '', 404)).kind, 'notFound')
  assert.equal(planFailureOf(fail('UNAUTHORIZED', '', 401)).kind, 'signIn')
  assert.equal(planFailureOf(fail('UNAVAILABLE', '', 503)).kind, 'failed')
  assert.deepEqual(
    planFailureOf(
      fail('PLAN_INVALID', 'no', 400, {
        issues: [
          { path: 'invalidationUsd', message: 'x' },
          { path: ['targetsUsd', 0], message: 'y' },
        ],
      }),
    ),
    { kind: 'invalid', fields: ['invalidation', 'targets'] },
  )
  assert.equal(fieldOfIssue('entry.maxPriceUsd'), 'maxPrice')
  assert.equal(fieldOfIssue('exit.stopLoss'), 'invalidation')
  assert.equal(fieldOfIssue('risk.plannedRiskUsd'), 'risk')
  assert.equal(fieldOfIssue('somethingElse'), null)
})

test('a plan id from a link is read loosely', () => {
  assert.equal(isPlanId('apl_0123456789abcdef01234567'), true)
  assert.equal(isPlanId('../etc'), false)
  assert.equal(isPlanId(''), false)
  assert.equal(isPlanId(undefined), false)
})
