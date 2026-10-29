import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import { WATCH_COPY } from './watch-copy.ts'
import {
  activeCount,
  channelOffer,
  channelsToSend,
  cooldownChoice,
  createBody,
  draftOf,
  draftProblem,
  EMPTY_DRAFT,
  focusedWatch,
  numberOf,
  readAgainAfter,
  ruleOf,
  shownProblem,
  watchFailureOf,
} from './watches-model.ts'

const MINT = 'So11111111111111111111111111111111111111112'
const POOL = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'

test('a typed figure: comma is a decimal point, spaces are thousands, words are not figures', () => {
  assert.equal(numberOf('0,5'), 0.5)
  assert.equal(numberOf('1 000'), 1000)
  assert.equal(numberOf('12.'), 12)
  assert.ok(Number.isNaN(numberOf('')))
  assert.ok(Number.isNaN(numberOf('ten')))
  assert.ok(Number.isNaN(numberOf('-5')))
  assert.ok(Number.isNaN(numberOf('1e5')))
})

test('the form becomes the rule the server takes, every kind', () => {
  assert.deepEqual(ruleOf({ ...EMPTY_DRAFT, kind: 'price', direction: 'above', level: '1,25' }), {
    kind: 'price',
    direction: 'above',
    level: 1.25,
  })
  assert.deepEqual(ruleOf(EMPTY_DRAFT), { kind: 'move', window: 'h24', direction: 'down', pct: 10 })
  assert.deepEqual(ruleOf({ ...EMPTY_DRAFT, kind: 'volume', factor: '3' }), { kind: 'volume', factor: 3 })
  assert.deepEqual(ruleOf({ ...EMPTY_DRAFT, kind: 'liquidity' }), {
    kind: 'liquidity',
    window: 'h1',
    direction: 'drop',
    pct: 30,
    pool: null,
  })
  assert.deepEqual(ruleOf({ ...EMPTY_DRAFT, kind: 'liquidity', pool: ` ${POOL} ` }), {
    kind: 'liquidity',
    window: 'h1',
    direction: 'drop',
    pct: 30,
    pool: POOL,
  })
})

test('a figure out of the server’s range holds no rule and names its field', () => {
  assert.equal(ruleOf({ ...EMPTY_DRAFT, kind: 'price', level: '0' }), null)
  assert.equal(draftProblem({ ...EMPTY_DRAFT, kind: 'price', level: '0' }), 'level')
  assert.equal(draftProblem({ ...EMPTY_DRAFT, pct: '0.4' }), 'pct')
  assert.equal(draftProblem({ ...EMPTY_DRAFT, pct: '1000' }), null)
  assert.equal(draftProblem({ ...EMPTY_DRAFT, pct: '1001' }), 'pct')
  assert.equal(draftProblem({ ...EMPTY_DRAFT, kind: 'volume', factor: '1.4' }), 'factor')
  assert.equal(draftProblem({ ...EMPTY_DRAFT, kind: 'liquidity', liqPct: '4' }), 'liqPct')
  assert.equal(draftProblem({ ...EMPTY_DRAFT, kind: 'liquidity', pool: 'not-an-address' }), 'pool')
})

test('an empty field is not yet wrong; a typed wrong one is marked', () => {
  assert.equal(shownProblem({ ...EMPTY_DRAFT, kind: 'price', level: '' }), null)
  assert.equal(shownProblem({ ...EMPTY_DRAFT, kind: 'price', level: '0' }), 'level')
})

test('a watch’s rule goes back into the form and out again unchanged', () => {
  const rules = [
    { kind: 'price', direction: 'below', level: 0.0123 },
    { kind: 'move', window: 'm5', direction: 'any', pct: 2.5 },
    { kind: 'volume', factor: 4 },
    { kind: 'liquidity', window: 'h24', direction: 'rise', pct: 50, pool: POOL },
  ]
  for (const rule of rules) assert.deepEqual(ruleOf(draftOf(rule)), rule)
})

test('a pause set elsewhere is shown as the nearest one offered', () => {
  assert.equal(cooldownChoice(5), 15)
  assert.equal(cooldownChoice(60), 60)
  assert.equal(cooldownChoice(200), 240)
  assert.equal(cooldownChoice(5000), 1440)
})

test('only a connected channel is offered; the rest are named once', () => {
  assert.deepEqual(channelOffer({ telegram: true, push: false }), { telegram: true, push: false, missing: ['Push'] })
  assert.deepEqual(channelOffer({ telegram: false, push: false }).missing, ['Telegram', 'Push'])
  assert.deepEqual(channelOffer({ telegram: true, push: true }).missing, [])
  assert.deepEqual(channelsToSend({ telegram: true, push: true }, { telegram: false, push: true }), {
    telegram: false,
    push: true,
  })
})

test('the new watch’s request: a token and a preset, or a token and a rule that holds', () => {
  const channels = { telegram: true, push: false }
  assert.equal(createBody(null, { kind: 'preset', preset: 'drop24h' }, 60, channels, 'uk'), null)
  assert.deepEqual(createBody(MINT, { kind: 'preset', preset: 'below' }, 60, channels, 'uk'), {
    mint: MINT,
    preset: 'below',
    cooldownMinutes: 60,
    channels,
    locale: 'uk',
  })
  assert.deepEqual(createBody(MINT, { kind: 'rule', draft: { ...EMPTY_DRAFT, pct: '7' } }, 240, channels, 'en'), {
    mint: MINT,
    rule: { kind: 'move', window: 'h24', direction: 'down', pct: 7 },
    cooldownMinutes: 240,
    channels,
    locale: 'en',
  })
  assert.equal(
    createBody(MINT, { kind: 'rule', draft: { ...EMPTY_DRAFT, kind: 'price', level: '' } }, 60, channels, 'en'),
    null,
  )
})

test('a level on a token Jupiter does not price is told apart from a price not read now', () => {
  const unpriced = new ApiError(
    'PRICE_UNAVAILABLE',
    'Jupiter does not price this token, so a price level cannot be watched; watch a move in % instead.',
    422,
  )
  const unread = new ApiError(
    'PRICE_UNAVAILABLE',
    'The price could not be read now, so a level cannot be set from it; name the level yourself.',
    422,
  )
  assert.equal(watchFailureOf(unpriced), 'unpriced')
  assert.equal(watchFailureOf(unread), 'noPrice')
})

test('every refusal has its own line, a dropped connection is not a refusal', () => {
  assert.equal(watchFailureOf(new ApiError('WATCH_LIMIT_REACHED', '3 watches are free', 409)), 'full')
  assert.equal(
    watchFailureOf(new ApiError('ASSET_UNCONFIRMED', 'Jupiter marks this token as suspicious.', 422)),
    'suspicious',
  )
  assert.equal(
    watchFailureOf(new ApiError('ASSET_UNCONFIRMED', 'Jupiter’s catalogue does not know this mint.', 422)),
    'unknownToken',
  )
  assert.equal(
    watchFailureOf(new ApiError('VALIDATION_ERROR', 'You already watch this token by this rule.', 400)),
    'duplicate',
  )
  assert.equal(watchFailureOf(new ApiError('VALIDATION_ERROR', 'Invalid rule', 400)), 'invalid')
  assert.equal(watchFailureOf(new ApiError('WATCH_VERSION_CONFLICT', 'changed', 409)), 'changed')
  assert.equal(watchFailureOf(new ApiError('SESSION_EXPIRED', 'expired', 401)), 'signIn')
  assert.equal(watchFailureOf(new ApiError('UNAVAILABLE', 'later', 503)), 'failed')
  assert.equal(watchFailureOf(new TypeError('Network request failed')), 'network')
  assert.equal(readAgainAfter('changed'), true)
  assert.equal(readAgainAfter('full'), false)
  for (const locale of ['en', 'uk']) {
    for (const key of [
      'full',
      'unknownToken',
      'suspicious',
      'unpriced',
      'noPrice',
      'duplicate',
      'changed',
      'gone',
      'invalid',
      'network',
      'signIn',
      'failed',
    ]) {
      assert.ok(WATCH_COPY[locale].failure[key].length > 0, `${locale}.${key}`)
    }
  }
})

test('a note’s watch is in view only while this wallet has it', () => {
  const watches = [
    { id: 'wch_a', status: 'active' },
    { id: 'wch_b', status: 'paused' },
  ]
  assert.equal(focusedWatch('wch_b', watches), 'wch_b')
  assert.equal(focusedWatch('wch_z', watches), null)
  assert.equal(focusedWatch('all', watches), null)
  assert.equal(focusedWatch(null, watches), null)
  assert.equal(activeCount({ watches }), 1)
  assert.equal(activeCount(null), 0)
})

test('the words: the assistant is Ryntra, never another name', () => {
  for (const locale of ['en', 'uk']) {
    const text = JSON.stringify(WATCH_COPY[locale])
    assert.ok(!/\bRyn\b/.test(text), locale)
  }
  assert.equal(WATCH_COPY.uk.title, 'Стежу')
  assert.equal(WATCH_COPY.uk.detail, 'Детально')
  assert.equal(WATCH_COPY.uk.why('2 кредити'), 'Чому? · 2 кредити')
  assert.equal(WATCH_COPY.uk.cooldownLabel(1440), '1 доба')
  assert.equal(WATCH_COPY.en.cooldownLabel(240), '4 h')
})
