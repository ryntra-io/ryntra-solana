import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BUY_COPY } from '../invest/buy-copy.ts'
import { buyFailureKey } from '../invest/buy-model.ts'
import { AUTOINVEST_COPY } from './copy.ts'
import {
  checkPriceCondition,
  conditionBounds,
  conditionChoices,
  conditionLine,
  conditionNowLine,
  conditionReviewLine,
  conditionShort,
  dataTimeWords,
  deferralLine,
  deviationOf,
  isPriceConditionLimit,
  limitWords,
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_PRESETS_PCT,
  priceFactsOf,
  referenceKindOf,
  standingWords,
} from './price-condition.ts'
import { unbrokenTail, wholeParts } from './words.ts'
import {
  deferredNow,
  dipRequest,
  dueOfIdentity,
  lastSettled,
  missedOf,
  reminderOfNote,
  ruleBuyState,
  ruleFace,
  ruleRefusalOf,
  scheduleRequest,
} from './rule-model.ts'

/*
 * «Умова ціни» on the phone — the web's
 * (contract 1.18.0): a rule buys only when the price is
 * not above its reference by more than the person's limit and the data are
 * fresh; otherwise «Купівлю відкладено» with the reason, the figure and the
 * data's time. The judgement and the words are the web's own — these checks
 * are the web's own cases (`lib/autoinvest/price-condition.test.mjs`,
 * `app/app/invest/price-condition-view.test.mjs`), in the same words; the
 * English with the phone's typographic apostrophe.
 */

const N = String.fromCharCode(0xa0)
const KYIV = 'Europe/Kyiv'
const MINUTE = 60_000
const HOUR = 3_600_000
/* Saturday 26 September 2026, 10:32 in Kyiv. */
const AT = Date.parse('2026-09-26T07:32:00.000Z')
const DUE = Date.parse('2026-09-24T16:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

/** The facts a condition is judged on: a price `deviation` per cent from a reference of `ref`, each dated. */
const facts = (
  deviation,
  { reference = 'prestocks', ref = 1000, priceAt = AT, referenceAt = AT, stale = false } = {},
) => ({
  reference,
  priceUsd: Math.round(ref * (1 + deviation / 100) * 1e6) / 1e6,
  priceAtMs: priceAt,
  referenceUsd: ref,
  referenceAtMs: referenceAt,
  referenceStale: stale,
})

/** OpenAI through PreStocks, as `GET /api/stocks/asset` serves its row: priced per token against PreStocks' valuation of one. */
function openaiRow({ price = 1300, mark = 1000, observedAt = iso(DUE), fetchedAt = iso(DUE), stale = false } = {}) {
  return {
    representation: { instrument: { class: 'pre-ipo', unitBasis: 'token' } },
    market: { priceUsd: price, observedAt },
    tokenPerShareUsd: null,
    reference: { state: 'unavailable', perShare: null, source: { id: 'none' }, observedAt: null, fetchedAt: null },
    issuerMark: { source: { id: 'issuer-prestocks' }, perUnit: mark, fetchedAt, stale },
  }
}

/** Apple through xStocks: priced per share against the issuer's reference per share. */
function appleRow({
  price = 200.8,
  reference = 200,
  observedAt = iso(DUE),
  referenceAt = iso(DUE),
  state = 'last-available',
  source = 'issuer-xstocks',
} = {}) {
  return {
    representation: { instrument: { class: 'listed-equity', unitBasis: 'share' } },
    market: { priceUsd: price, observedAt },
    tokenPerShareUsd: price,
    reference: { state, perShare: reference, source: { id: source }, observedAt: null, fetchedAt: referenceAt },
    issuerMark: null,
  }
}

/* ---- the judgement ---- */

test('the limit: up to N % above the reference passes, above it waits; a discount always passes; the figure compared is the one a person reads', () => {
  assert.equal(
    checkPriceCondition(5, facts(30, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'above',
    'OpenAI 30 % above PreStocks’ valuation, limit 5 %',
  )
  assert.equal(checkPriceCondition(5, facts(4.9, { priceAt: DUE, referenceAt: DUE }), DUE).verdict, 'met')
  assert.equal(
    checkPriceCondition(5, facts(5, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'met',
    'exactly the limit is not more than it',
  )
  assert.equal(
    checkPriceCondition(5, facts(5.04, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'met',
    '«на 5,0 %» never waits on a 5 % limit',
  )
  assert.equal(
    checkPriceCondition(5, facts(5.06, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'above',
    '5.1 % is more than 5 %',
  )
  assert.equal(
    checkPriceCondition(5, facts(-21, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'met',
    'a discount passes',
  )
  assert.equal(
    checkPriceCondition(50, facts(30, { priceAt: DUE, referenceAt: DUE }), DUE).verdict,
    'met',
    'the limit is the person’s',
  )
  const check = checkPriceCondition(5, facts(30, { priceAt: DUE - MINUTE, referenceAt: DUE - 5 * MINUTE }), DUE)
  assert.deepEqual(check, {
    reference: 'prestocks',
    limitPct: 5,
    priceUsd: 1300,
    referenceUsd: 1000,
    checkedAt: iso(DUE),
    deviationPct: 30,
    dataAt: iso(DUE - 5 * MINUTE),
    verdict: 'above',
  })
  assert.equal(deviationOf(200.8, 200), 0.4)
  assert.equal(deviationOf(null, 200), null)
  assert.equal(PRICE_CONDITION_DEFAULT_PCT, 5, '«типово 5 %»')
})

test('fresh or nothing: a figure older than half an hour, a copy its source calls stale, a figure or a time missing — the rule waits, never buys', () => {
  const edge = DUE - 30 * MINUTE
  assert.equal(
    checkPriceCondition(5, facts(1, { priceAt: edge, referenceAt: edge }), DUE).verdict,
    'met',
    'exactly half an hour old still decides',
  )
  assert.equal(
    checkPriceCondition(5, facts(1, { priceAt: edge - 1, referenceAt: DUE }), DUE).verdict,
    'stale',
    'the price is too old',
  )
  assert.equal(
    checkPriceCondition(5, facts(1, { priceAt: DUE, referenceAt: DUE - 2 * HOUR }), DUE).verdict,
    'stale',
    'the reference is too old',
  )
  assert.equal(
    checkPriceCondition(5, facts(1, { priceAt: DUE, referenceAt: DUE, stale: true }), DUE).verdict,
    'stale',
    'PreStocks’ catalogue served under grace',
  )
  assert.equal(
    checkPriceCondition(5, facts(30, { priceAt: DUE - 2 * HOUR, referenceAt: DUE }), DUE).verdict,
    'stale',
    'old data are old, not above',
  )
  assert.equal(
    checkPriceCondition(5, { ...facts(1, { priceAt: DUE, referenceAt: DUE }), priceAtMs: null }, DUE).verdict,
    'stale',
    'a price nobody dated is not fresh',
  )
  assert.equal(checkPriceCondition(5, { ...facts(1), referenceUsd: null }, DUE).verdict, 'unavailable')
  assert.equal(
    checkPriceCondition(5, { ...facts(1), reference: null }, DUE).verdict,
    'unavailable',
    'a company with no reference never passes',
  )
  assert.equal(checkPriceCondition(5, null, DUE).verdict, 'unavailable', 'facts that could not be read never pass')
  const old = checkPriceCondition(5, facts(1, { priceAt: DUE - 3 * HOUR, referenceAt: DUE - MINUTE }), DUE)
  assert.equal(old.dataAt, iso(DUE - 3 * HOUR), 'the data are as new as their oldest part')
  assert.equal(
    checkPriceCondition(5, facts(1, { priceAt: DUE - 40 * MINUTE, referenceAt: DUE }), DUE, 60).verdict,
    'met',
    'the freshness bound is the server’s',
  )
})

test('the facts a stock row states: PreStocks’ valuation per token for a private company, the reference per share for a listed one, each with its own time', () => {
  const openai = priceFactsOf(
    openaiRow({ price: 1300, mark: 1000, observedAt: iso(DUE - MINUTE), fetchedAt: iso(DUE - 7 * MINUTE) }),
  )
  assert.deepEqual(openai, {
    reference: 'prestocks',
    priceUsd: 1300,
    priceAtMs: DUE - MINUTE,
    referenceUsd: 1000,
    referenceAtMs: DUE - 7 * MINUTE,
    referenceStale: false,
  })
  assert.equal(priceFactsOf(openaiRow({ stale: true })).referenceStale, true)
  const apple = priceFactsOf(
    appleRow({ price: 200.8, reference: 200, observedAt: null, referenceAt: iso(DUE - 2 * MINUTE) }),
    DUE - 3 * MINUTE,
  )
  assert.deepEqual(
    apple,
    {
      reference: 'issuer',
      priceUsd: 200.8,
      priceAtMs: DUE - 3 * MINUTE,
      referenceUsd: 200,
      referenceAtMs: DUE - 2 * MINUTE,
      referenceStale: false,
    },
    'a price the row does not date takes the read’s own time, never the clock',
  )
  assert.equal(priceFactsOf(appleRow({ state: 'stale' })).referenceStale, true)
  assert.equal(referenceKindOf(appleRow({ source: 'pyth' })), 'market')
  assert.equal(
    referenceKindOf(appleRow({ source: 'none' })),
    null,
    'a listed company without a reference is offered no condition',
  )
  assert.equal(
    referenceKindOf({ ...openaiRow(), issuerMark: null }),
    null,
    'a private company without PreStocks’ valuation has none',
  )
  assert.equal(
    checkPriceCondition(5, priceFactsOf({ ...appleRow(), tokenPerShareUsd: null }), DUE).verdict,
    'unavailable',
    'a listed token whose multiplier nobody read has no per-share price',
  )
})

/* ---- the bounds ---- */

test('the bounds are the server’s: production’s capabilities read as they are, anything a limit cannot be falls back to the contract’s 5 % · 1–50 · 30 minutes', () => {
  const production = { defaultPct: 5, minPct: 1, maxPct: 50, maxAgeMinutes: 30 }
  assert.deepEqual(conditionBounds(production), production)
  assert.deepEqual(conditionBounds(undefined), production, 'unread')
  assert.deepEqual(conditionBounds({ ...production, defaultPct: 70 }), production, 'a default outside its own bounds')
  assert.deepEqual(conditionBounds({ ...production, minPct: 2.5 }), production, 'a bound that is not a whole per cent')
  assert.deepEqual(conditionBounds({ ...production, maxAgeMinutes: 0 }), production)
  assert.deepEqual(conditionBounds({ defaultPct: 3, minPct: 1, maxPct: 20, maxAgeMinutes: 15 }), {
    defaultPct: 3,
    minPct: 1,
    maxPct: 20,
    maxAgeMinutes: 15,
  })
  assert.deepEqual([...PRICE_CONDITION_PRESETS_PCT], [2, 5, 10], 'the web’s own')
  assert.deepEqual(conditionChoices(production), [2, 5, 10, null], '2 % · 5 % · 10 % · «Без умови»')
  assert.deepEqual(
    conditionChoices({ ...production, defaultPct: 3 }),
    [2, 3, 5, 10, null],
    'a default none of them is offered too',
  )
  assert.deepEqual(
    conditionChoices({ ...production, minPct: 3, defaultPct: 5 }),
    [5, 10, null],
    'never a limit outside the bounds',
  )
  assert.equal(isPriceConditionLimit(5), true)
  assert.equal(isPriceConditionLimit(0), false)
  assert.equal(isPriceConditionLimit(51), false)
  assert.equal(isPriceConditionLimit(2.5), false)
})

/* ---- the words ---- */

test('the rule’s condition in one line and as a short fact, in both languages — PreStocks’ figure its valuation, never a fair price', () => {
  assert.equal(
    conditionLine(5, 'prestocks', 'uk'),
    `Не купувати, якщо дорожче за оцінку PreStocks більш ніж на${N}5${N}%`,
  )
  assert.equal(conditionLine(5, 'issuer', 'en'), 'Don’t buy if it costs more than 5% above the issuer’s reference')
  assert.equal(
    conditionLine(10, 'market', 'uk'),
    `Не купувати, якщо дорожче за біржовий орієнтир більш ніж на${N}10${N}%`,
  )
  assert.equal(conditionShort(5, 'prestocks', 'uk'), `не дорожче за оцінку PreStocks більш ніж на${N}5${N}%`)
  assert.equal(conditionShort(10, 'market', 'en'), 'at most 10% above the market reference')
  assert.equal(limitWords(5, 'uk'), `ліміт 5${N}%`)
  assert.equal(limitWords(5, 'en'), 'limit 5%')
})

test('«Перевірка»’s line: the deviation to a tenth, the reference by name with its figure, the limit and the data’s time', () => {
  const listed = checkPriceCondition(5, facts(0.4, { reference: 'issuer', ref: 200 }), AT + MINUTE)
  assert.equal(
    conditionReviewLine(listed, AT + MINUTE, KYIV, 'uk'),
    `+0,4${N}% до орієнтира емітента $200,00 · ліміт 5${N}% · дані 10:32`,
  )
  assert.equal(
    conditionReviewLine(listed, AT + MINUTE, KYIV, 'en'),
    '+0.4% against the issuer’s reference of $200.00 · limit 5% · data at 10:32',
  )
  const discount = checkPriceCondition(5, facts(-21), AT)
  assert.equal(
    conditionReviewLine(discount, AT, KYIV, 'uk'),
    `−21,0${N}% до оцінки PreStocks $1${N}000,00 · ліміт 5${N}% · дані 10:32`,
  )
})

test('why a purchase waits — «Купівлю відкладено» with the reason, the figure and the data’s time; old data and a missing reference said plainly', () => {
  const above = checkPriceCondition(5, facts(30), AT)
  assert.equal(
    deferralLine(above, 'OpenAI', AT, KYIV, 'uk'),
    `OpenAI на 30${N}% дорожча за оцінку PreStocks (твій ліміт 5${N}%) · дані 10:32`,
  )
  assert.equal(
    deferralLine(above, 'OpenAI', AT, KYIV, 'en'),
    'OpenAI is 30% above PreStocks’ valuation (your limit 5%) · data at 10:32',
  )
  const listed = checkPriceCondition(5, facts(6.2, { reference: 'issuer', ref: 200 }), AT)
  assert.equal(
    deferralLine(listed, 'Apple', AT, KYIV, 'uk'),
    `Apple на 6,2${N}% дорожча за орієнтир емітента (твій ліміт 5${N}%) · дані 10:32`,
  )
  const old = checkPriceCondition(5, facts(1, { priceAt: AT - 26 * HOUR }), AT)
  assert.equal(
    deferralLine(old, 'OpenAI', AT, KYIV, 'uk'),
    'OpenAI — дані про ціну застаріли · останні — 25 вер. о 08:32',
  )
  assert.equal(
    deferralLine(old, 'OpenAI', AT, KYIV, 'en'),
    'OpenAI — price data out of date · latest at Sep 25 at 08:32',
  )
  assert.equal(
    deferralLine(checkPriceCondition(5, null, AT), 'OpenAI', AT, KYIV, 'uk'),
    'OpenAI — зараз немає орієнтира',
  )
  assert.equal(
    deferralLine(checkPriceCondition(5, null, AT), 'OpenAI', AT, KYIV, 'en'),
    'OpenAI — no reference right now',
  )
  assert.equal(dataTimeWords(AT - 26 * HOUR, AT, KYIV, 'en'), 'Sep 25 at 08:32', 'another day says its date')
  // On the phone the sentence wraps freely, its time never apart from its word («data / at 05:58» was seen on the emulator).
  assert.equal(
    unbrokenTail(deferralLine(above, 'OpenAI', AT, KYIV, 'en')),
    `OpenAI is 30% above PreStocks’ valuation (your limit 5%)${N}· data${N}at${N}10:32`,
  )
  assert.equal(unbrokenTail('OpenAI — no reference right now'), 'OpenAI — no reference right now')
  // «Перевірка»'s line: every short part whole — «ліміт 5 %» never apart from its figure — wrapped only after a «·».
  assert.equal(
    wholeParts('Умова ціни · ліміт 5 % · дані 10:32'),
    `Умова${N}ціни${N}· ліміт${N}5${N}%${N}· дані${N}10:32`,
  )
  assert.equal(standingWords({ deviationPct: 0.02, reference: 'prestocks' }, 'uk'), 'на рівні: оцінку PreStocks')
  assert.equal(standingWords({ deviationPct: -21, reference: 'prestocks' }, 'en'), '21% below PreStocks’ valuation')
})

test('how the price stands now under a rule being written: within the condition, deferred, or no fresh data', () => {
  assert.equal(
    conditionNowLine(checkPriceCondition(5, facts(29), AT), 'uk'),
    `Зараз ціна на 29${N}% дорожча за оцінку PreStocks — купівлю буде відкладено.`,
  )
  assert.equal(
    conditionNowLine(checkPriceCondition(5, facts(0.4, { reference: 'issuer', ref: 200 }), AT), 'en'),
    'Now the price is 0.4% above the issuer’s reference — within the condition.',
  )
  assert.equal(
    conditionNowLine(checkPriceCondition(5, facts(-23), AT), 'uk'),
    `Зараз ціна на 23${N}% дешевша за оцінку PreStocks — у межах умови.`,
  )
  assert.equal(
    conditionNowLine(checkPriceCondition(5, facts(1, { referenceAt: AT - HOUR }), AT), 'uk'),
    'Свіжих даних зараз немає — правило чекатиме на них.',
  )
  assert.equal(
    conditionNowLine(checkPriceCondition(5, null, AT), 'en'),
    'No fresh data right now — the rule would wait for them.',
  )
})

test('the words never call PreStocks’ figure a fair price, and the Ukrainian holds no English word but the issuer’s name', () => {
  const lines = []
  for (const locale of ['en', 'uk']) {
    lines.push(
      [locale, conditionReviewLine(checkPriceCondition(5, facts(3), AT), AT, KYIV, locale)],
      [locale, deferralLine(checkPriceCondition(5, facts(30), AT), 'OpenAI', AT, KYIV, locale)],
      [
        locale,
        deferralLine(checkPriceCondition(5, facts(1, { priceAt: AT - 26 * HOUR }), AT), 'OpenAI', AT, KYIV, locale),
      ],
      [locale, conditionNowLine(checkPriceCondition(5, facts(30), AT), locale)],
      [locale, conditionLine(5, 'prestocks', locale)],
      [locale, conditionShort(5, 'market', locale)],
    )
  }
  for (const [, line] of lines) assert.doesNotMatch(line, /справедлив|fair price/i)
  const english = (line) =>
    line
      .split('PreStocks')
      .join(' ')
      .split('OpenAI')
      .join(' ')
      .match(/[A-Za-z]{2,}/g) ?? []
  for (const [locale, line] of lines) if (locale === 'uk') assert.deepEqual(english(line), [], line)
  const words = [
    'priceCondition',
    'noCondition',
    'purchaseDeferred',
    'ruleChecksAgain',
    'checksAgainUntil',
    'deferredShort',
  ]
  for (const key of words) {
    assert.deepEqual(english(AUTOINVEST_COPY.uk[key]), [], key)
    assert.doesNotMatch(AUTOINVEST_COPY.en[key], /[А-Яа-яІіЇїЄєҐґ]/, key)
  }
  assert.equal(AUTOINVEST_COPY.uk.purchaseDeferred, 'Купівлю відкладено')
  assert.equal(AUTOINVEST_COPY.uk.deferredShort, 'Купівлю відкладено · правило перевірить знову')
})

/* ---- a rule that carries it ---- */

/** The rule as production's example states it (`docs/api/examples/v1/rule-condition.response.json`, contract 1.18.0). */
const DEFERRED = {
  dueAt: '2026-09-17T16:00:00.000Z',
  openUntil: '2026-09-18T16:00:00.000Z',
  remindedAt: null,
  trigger: null,
  condition: {
    verdict: 'above',
    reference: 'prestocks',
    limitPct: 5,
    priceUsd: 1300,
    referenceUsd: 1000,
    deviationPct: 30,
    dataAt: '2026-09-17T15:57:00.000Z',
    checkedAt: '2026-09-17T16:02:00.000Z',
  },
  state: 'deferred',
  signature: null,
  spentUsd: null,
  boughtAt: null,
}
const OPENAI_RULE = {
  id: 'rule_3c1b0d9e8f7a6b5e1f0c2a9b8d4e7f6a',
  owner: '36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm',
  network: 'solana:mainnet',
  kind: 'schedule',
  asset: {
    network: 'solana:mainnet',
    mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
    symbol: 'OPENAI',
    issuer: { id: 'prestocks', label: 'PreStocks' },
    underlying: { symbol: 'OPENAI', name: 'OpenAI' },
    decimals: 9,
    unitBasis: 'token',
  },
  name: 'OpenAI',
  amountUsd: 10,
  schedule: { cadence: 'weekly', weekday: 4, monthDay: null, time: '19:00', timeZone: KYIV },
  dip: null,
  priceCondition: { limitPct: 5 },
  status: 'active',
  nextDueAt: '2026-09-24T16:00:00.000Z',
  occurrences: [DEFERRED],
  createdAt: '2026-09-15T12:15:00.000Z',
  updatedAt: '2026-09-17T16:02:00.000Z',
}
const WHILE_OPEN = Date.parse('2026-09-17T17:00:00.000Z')
const PAST = Date.parse('2026-09-18T16:00:01.000Z')

test('a purchase the condition holds back: said on the card and in the sheet with why, until its window ends — before the budget, after an open reminder', () => {
  assert.equal(deferredNow(OPENAI_RULE, WHILE_OPEN), DEFERRED)
  assert.equal(deferredNow(OPENAI_RULE, PAST), null, 'its window over: missed at its end, never reminded late')
  assert.equal(deferredNow({ ...OPENAI_RULE, status: 'paused' }, WHILE_OPEN), null)
  const face = ruleFace(OPENAI_RULE, null, WHILE_OPEN)
  assert.deepEqual(face, { kind: 'deferred', occurrence: DEFERRED })
  const spent = { capUsd: 5, remainingUsd: 0, spentUsd: 5, unknownUsd: 0, exhausted: true }
  assert.equal(
    ruleFace(OPENAI_RULE, spent, WHILE_OPEN).kind,
    'deferred',
    'why it waits now is the price, not the budget',
  )
  assert.equal(ruleFace({ ...OPENAI_RULE, status: 'paused' }, null, WHILE_OPEN).kind, 'paused')
  const due = { ...DEFERRED, dueAt: '2026-09-17T18:00:00.000Z', state: 'due', remindedAt: '2026-09-17T18:00:00.000Z' }
  assert.equal(
    ruleFace({ ...OPENAI_RULE, occurrences: [due, DEFERRED] }, null, Date.parse('2026-09-17T18:05:00.000Z')).kind,
    'due',
  )
  assert.equal(lastSettled(OPENAI_RULE), null, 'a purchase still waiting has not settled')
  assert.equal(
    missedOf(
      {
        ...OPENAI_RULE,
        occurrences: [DEFERRED, { ...DEFERRED, dueAt: '2026-09-10T16:00:00.000Z', state: 'missed', condition: null }],
      },
      face,
    ),
    null,
  )
  assert.equal(
    deferralLine(DEFERRED.condition, OPENAI_RULE.name, WHILE_OPEN, KYIV, 'uk'),
    `OpenAI на 30${N}% дорожча за оцінку PreStocks (твій ліміт 5${N}%) · дані 18:57`,
  )
})

test('one tap on the deferral’s note opens the purchase that waits — why, and no «Купити»; a closed window is closed', () => {
  const read = (dueAt, nowMs, rule = OPENAI_RULE) => ruleBuyState({ read: 'ready', rule, dueAt, budget: null, nowMs })
  assert.deepEqual(read(DEFERRED.dueAt, WHILE_OPEN), { kind: 'deferred', rule: OPENAI_RULE, occurrence: DEFERRED })
  assert.equal(read(null, WHILE_OPEN).kind, 'deferred', 'a link without its instant finds the purchase that waits')
  assert.equal(read(DEFERRED.dueAt, PAST).kind, 'closed')
  assert.equal(read(DEFERRED.dueAt, WHILE_OPEN, { ...OPENAI_RULE, status: 'paused' }).kind, 'paused')
  // The deferral's note: the reminder's identity marked `~deferred` before the company (the web's `deferralIdentity`).
  const identity = `autoinvest:${OPENAI_RULE.id}:${DEFERRED.dueAt}~deferred@OPENAI`
  assert.equal(dueOfIdentity(identity, OPENAI_RULE.id), DEFERRED.dueAt)
  assert.deepEqual(reminderOfNote({ subject: { kind: 'autoinvest-rule', id: OPENAI_RULE.id }, triggerId: identity }), {
    ruleId: OPENAI_RULE.id,
    dueAt: DEFERRED.dueAt,
    symbol: 'OPENAI',
  })
  assert.equal(dueOfIdentity(`autoinvest:${OPENAI_RULE.id}:${DEFERRED.dueAt}~other@OPENAI`, OPENAI_RULE.id), null)
})

test('a rule is written with its condition — the limit, or none — as the web’s own request carries it; the server’s refusal in the web’s words', () => {
  const schedule = { cadence: 'weekly', weekday: 4, monthDay: null, time: '19:00', timeZone: KYIV }
  const request = scheduleRequest({ mint: OPENAI_RULE.asset.mint, amountUsd: 10, schedule, locale: 'uk', limitPct: 5 })
  // `docs/api/examples/v1/rule-create-condition.request.json`, the phone naming its kind as it always has.
  assert.deepEqual(request, {
    asset: { mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF' },
    amountUsd: 10,
    kind: 'schedule',
    schedule,
    priceCondition: { limitPct: 5 },
    locale: 'uk',
  })
  assert.equal(
    scheduleRequest({ mint: 'm', amountUsd: 1, schedule, locale: 'en', limitPct: null }).priceCondition,
    null,
    '«Без умови»',
  )
  assert.equal('priceCondition' in scheduleRequest({ mint: 'm', amountUsd: 1, schedule, locale: 'en' }), false)
  assert.deepEqual(
    dipRequest({ mint: 'm', amountUsd: 5, dropPct: 10, timeZone: KYIV, locale: 'uk', limitPct: 10 }).priceCondition,
    { limitPct: 10 },
  )
  assert.equal(ruleRefusalOf('RULE_PRICE_CONDITION'), 'condition')
  assert.equal(buyFailureKey('RULE_PRICE_CONDITION'), 'ruleCondition')
  assert.equal(BUY_COPY.uk.failures.ruleCondition, 'Умова ціни зараз не виконана — купівля за правилом чекає.')
  assert.equal(
    BUY_COPY.en.failures.ruleCondition,
    'The price condition is not met right now — the rule’s purchase waits.',
  )
})
