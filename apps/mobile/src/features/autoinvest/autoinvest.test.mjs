import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AUTOINVEST_COPY } from './copy.ts'
import {
  bindingOf,
  BUDGET_MIN_USD,
  BUDGET_PRESETS_USD,
  budgetOfInput,
  budgetRequest,
  budgetView,
  capChoices,
  clampMonthDay,
  defaultSchedule,
  deviceTimeZone,
  dipPreview,
  dipRequest,
  dipTriggerUsd,
  dueOfIdentity,
  firstDue,
  fitsCeiling,
  fitsMonth,
  heldByBudget,
  isDipPct,
  isRuleGoneError,
  isRuleId,
  lastSettled,
  missedOf,
  monthUse,
  occurrenceAt,
  openOccurrence,
  reminderOfNote,
  reminderOffer,
  RULE_DIP_PRESETS_PCT,
  ruleAmountOf,
  ruleBuyState,
  ruleFace,
  ruleForMint,
  ruleRead,
  rulePurchaseParams,
  ruleRefusalOf,
  ruleWriteFailure,
  scheduleRequest,
  symbolOfIdentity,
  timeOfInput,
  weeklyFromSpent,
  withCadence,
  writeFailureWords,
} from './rule-model.ts'
import { isReadableSchedule, isTimeZone, nextDueAfter, wallClockAt, zonedInstant } from './schedule.ts'
import {
  budgetRowWords,
  dayWords,
  dipLine,
  dueWords,
  monthWords,
  pctWord,
  priceWord,
  ruleLine,
  ruleSentence,
  ruleWhenLine,
  unbroken,
  unbrokenParts,
  whenPhrase,
} from './words.ts'

const iso = (ms) => new Date(ms).toISOString()
const weekly = (weekday, time, timeZone = 'Europe/Kyiv') => ({
  cadence: 'weekly',
  weekday,
  monthDay: null,
  time,
  timeZone,
})

/** A rule as production answers it (contract 1.13.0, `docs/api/examples/v1/rule.response.json`). */
function rule(overrides = {}) {
  return {
    id: 'rule_5e1f0c2a9b8d4e7f6a3c1b0d9e8f7a6b',
    owner: '36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm',
    network: 'solana:mainnet',
    kind: 'schedule',
    asset: {
      network: 'solana:mainnet',
      mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      symbol: 'NVDAx',
      issuer: { id: 'xstocks', label: 'xStocks · Backed Finance' },
      underlying: { symbol: 'NVDA', name: 'NVIDIA Corporation' },
      decimals: 8,
      unitBasis: 'share',
    },
    name: 'NVIDIA',
    amountUsd: 25,
    schedule: weekly(4, '19:00'),
    dip: null,
    status: 'active',
    nextDueAt: '2026-10-01T16:00:00.000Z',
    occurrences: [],
    createdAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-25T16:30:00.000Z',
    ...overrides,
  }
}

const occurrence = (dueAt, state, extra = {}) => ({
  dueAt,
  openUntil: new Date(Date.parse(dueAt) + 86_400_000).toISOString(),
  state,
  remindedAt: state === 'missed' ? null : dueAt,
  trigger: null,
  signature: null,
  spentUsd: null,
  boughtAt: null,
  ...extra,
})

const budget = (overrides = {}) => ({
  capUsd: 100,
  timeZone: 'Europe/Kyiv',
  monthStartsAt: '2026-08-31T21:00:00.000Z',
  monthEndsAt: '2026-09-30T21:00:00.000Z',
  spentUsd: 45,
  unknownUsd: 0,
  remainingUsd: 55,
  exhausted: false,
  updatedAt: '2026-09-24T10:00:00.000Z',
  ...overrides,
})

/* ---- the wall clock: the server's own cases ---- */

test('a weekly rule in Kyiv falls on the wall clock: 16:00 UTC in summer, 17:00 UTC after the clocks go back', () => {
  const schedule = weekly(4, '19:00')
  assert.equal(iso(nextDueAfter(schedule, Date.parse('2026-09-23T21:29:00.000Z'))), '2026-09-24T16:00:00.000Z')
  assert.equal(iso(nextDueAfter(schedule, Date.parse('2026-10-22T16:00:00.000Z'))), '2026-10-29T17:00:00.000Z')
  assert.equal(
    iso(nextDueAfter(schedule, Date.parse('2026-09-24T16:00:00.000Z'))),
    '2026-10-01T16:00:00.000Z',
    'a due instant is never its own next',
  )
})

test('a daily rule keeps its hour across the spring change in New York; a monthly 31st falls on the last day', () => {
  const daily = { cadence: 'daily', weekday: null, monthDay: null, time: '09:30', timeZone: 'America/New_York' }
  assert.equal(iso(nextDueAfter(daily, Date.parse('2026-03-07T15:00:00.000Z'))), '2026-03-08T13:30:00.000Z')
  const monthly = { cadence: 'monthly', weekday: null, monthDay: 31, time: '10:00', timeZone: 'Europe/Kyiv' }
  assert.equal(iso(nextDueAfter(monthly, Date.parse('2027-01-31T09:00:00.000Z'))), '2027-02-28T08:00:00.000Z')
  assert.equal(iso(nextDueAfter(monthly, Date.parse('2027-02-28T08:00:00.000Z'))), '2027-03-31T07:00:00.000Z')
})

test('the skipped spring hour reads as the hour after it; the weekday is ISO', () => {
  const at = zonedInstant(2026, 3, 29, 3, 30, 'Europe/Kyiv')
  const wall = wallClockAt(at, 'Europe/Kyiv')
  assert.equal(`${wall.hour}:${wall.minute}`, '4:30')
  const thursday = wallClockAt(Date.parse('2026-09-24T16:00:00.000Z'), 'Europe/Kyiv')
  assert.deepEqual([thursday.day, thursday.hour, thursday.weekday], [24, 19, 4])
  assert.equal(wallClockAt(Date.parse('2026-09-27T12:00:00.000Z'), 'Europe/Kyiv').weekday, 7)
})

test('a time zone is one the runtime knows; a schedule is readable only whole', () => {
  assert.equal(isTimeZone('Europe/Kyiv'), true)
  assert.equal(isTimeZone('Europe/Kiev'), true, 'the older name a phone may still report')
  assert.equal(isTimeZone('Mars/Olympus'), false)
  assert.equal(isReadableSchedule(weekly(4, '19:00')), true)
  assert.equal(isReadableSchedule(weekly(null, '19:00')), false)
  assert.equal(isReadableSchedule({ ...weekly(4, '19:00'), time: '24:00' }), false)
  assert.equal(
    deviceTimeZone(() => 'Europe/Kyiv'),
    'Europe/Kyiv',
  )
  assert.equal(
    deviceTimeZone(() => 'Nowhere/Land'),
    'UTC',
  )
  assert.equal(
    deviceTimeZone(() => {
      throw new Error('no Intl')
    }),
    'UTC',
  )
})

/* ---- where a rule starts ---- */

test('a new rule starts weekly, today, at the next full hour — tomorrow when that hour is midnight', () => {
  // Thursday 24 September 2026, 18:20 in Kyiv.
  assert.deepEqual(defaultSchedule(Date.parse('2026-09-24T15:20:00.000Z'), 'Europe/Kyiv'), weekly(4, '19:00'))
  // Thursday 23:40 in Kyiv → Friday 00:00.
  assert.deepEqual(defaultSchedule(Date.parse('2026-09-24T20:40:00.000Z'), 'Europe/Kyiv'), weekly(5, '00:00'))
  // Sunday 23:10 → Monday.
  assert.equal(defaultSchedule(Date.parse('2026-09-27T20:10:00.000Z'), 'Europe/Kyiv').weekday, 1)
})

test('another cadence keeps the day and the time; the first purchase is the instant the server reminds at', () => {
  const now = Date.parse('2026-09-24T15:20:00.000Z')
  const start = weekly(4, '19:00')
  assert.deepEqual(withCadence(start, 'daily', now), { ...start, cadence: 'daily', weekday: null })
  assert.deepEqual(withCadence(start, 'monthly', now), { ...start, cadence: 'monthly', weekday: null, monthDay: 24 })
  assert.deepEqual(withCadence(withCadence(start, 'monthly', now), 'weekly', now), start)
  assert.equal(iso(firstDue(start, now)), '2026-09-24T16:00:00.000Z')
  assert.equal(firstDue({ ...start, time: '25:00' }, now), null)
})

test('a time is read as a person types it; a day of the month stays within the month', () => {
  assert.equal(timeOfInput('19:00'), '19:00')
  assert.equal(timeOfInput('9:5'), '09:05')
  assert.equal(timeOfInput('9.30'), '09:30')
  assert.equal(timeOfInput('0730'), '07:30')
  assert.equal(timeOfInput('24:00'), null)
  assert.equal(timeOfInput('7 pm'), null)
  assert.equal(clampMonthDay(0), 1)
  assert.equal(clampMonthDay(32), 31)
  assert.equal(clampMonthDay(15), 15)
})

test('a rule’s sum is from $1 to $100 000 in dollars and cents; the request is «Регулярно» on the phone’s own clock', () => {
  assert.equal(ruleAmountOf('25', 'uk'), 25)
  assert.equal(ruleAmountOf('25,50', 'uk'), 25.5)
  assert.equal(ruleAmountOf('$1,000.50', 'en'), 1000.5)
  // A dollar a day is a rule («Кожний день по долару»); under a dollar is none.
  assert.equal(ruleAmountOf('1', 'uk'), 1)
  assert.equal(ruleAmountOf('9.99', 'en'), 9.99)
  assert.equal(ruleAmountOf('0.99', 'en'), null)
  assert.equal(ruleAmountOf('100001', 'en'), null)
  assert.deepEqual(
    scheduleRequest({
      mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
      amountUsd: 25.004,
      schedule: weekly(4, '19:00'),
      locale: 'uk',
    }),
    {
      asset: { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
      amountUsd: 25,
      kind: 'schedule',
      schedule: weekly(4, '19:00'),
      locale: 'uk',
    },
  )
})

/* ---- the words ---- */

test('a rule is said in both languages the web app’s way', () => {
  assert.equal(ruleLine(weekly(4, '19:00'), 'uk'), 'Щотижня · чт о 19:00')
  assert.equal(ruleLine(weekly(4, '19:00'), 'en'), 'Every week · Thu at 19:00')
  const monthly = { cadence: 'monthly', weekday: null, monthDay: 1, time: '10:00', timeZone: 'Europe/Kyiv' }
  assert.equal(whenPhrase(monthly, 'uk'), '1-го о 10:00')
  assert.equal(whenPhrase(monthly, 'en'), 'on the 1st at 10:00')
  assert.equal(whenPhrase({ ...monthly, monthDay: 22 }, 'en'), 'on the 22nd at 10:00')
  assert.equal(ruleLine({ ...monthly, cadence: 'daily', monthDay: null }, 'uk'), 'Щодня · о 10:00')
  assert.equal(ruleSentence(rule(), 'NVIDIA', 'uk'), 'Щотижня $25 в NVIDIA')
  assert.equal(ruleSentence(rule(), 'NVIDIA', 'en'), '$25 of NVIDIA, every week')
  assert.equal(dueWords(Date.parse('2026-09-24T16:00:00.000Z'), 'Europe/Kyiv', 'uk'), 'чт, 24 вер. о 19:00')
  assert.equal(dueWords(Date.parse('2026-09-24T16:00:00.000Z'), 'Europe/Kyiv', 'en'), 'Thu, Sep 24 at 19:00')
  assert.equal(dayWords(Date.parse('2026-09-24T16:00:00.000Z'), 'Europe/Kyiv', 'en'), 'Sep 24')
})

test('a rule that waits for a fall is said in its own words', () => {
  const dip = rule({
    kind: 'dip',
    schedule: null,
    nextDueAt: null,
    amountUsd: 20,
    dip: {
      dropPct: 5,
      timeZone: 'Europe/Kyiv',
      anchorUsd: 200,
      anchorAt: '2026-09-24T10:00:00.000Z',
      anchorFrom: 'enabled',
      triggerUsd: 190,
      armed: true,
      heldAt: null,
    },
  })
  assert.equal(ruleWhenLine(dip, 'uk'), 'Якщо впаде на 5 %')
  assert.equal(ruleWhenLine(dip, 'en'), 'If it falls 5%')
  assert.equal(dipLine(10, 'en'), 'If it falls 10%')
  assert.equal(ruleSentence(dip, 'NVIDIA', 'uk'), 'Якщо NVIDIA впаде на 5 % — докупити $20')
  assert.equal(priceWord(189, 'uk'), '$189,00')
  assert.equal(priceWord(0.5, 'en'), '$0.5000')
  assert.equal(pctWord(5.5, 'uk', 1), '5,5 %')
  assert.deepEqual(ruleFace(dip, null, Date.parse('2026-09-25T10:00:00.000Z')), { kind: 'dip', triggerUsd: 190 })
})

/* ---- a rule as it stands ---- */

test('a company shows the rule that is on first, else its newest', () => {
  const mint = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
  const paused = rule({ id: 'rule_00000000000000000000000000000001', status: 'paused' })
  const active = rule({ id: 'rule_00000000000000000000000000000002' })
  assert.equal(ruleForMint([paused, active], mint)?.id, active.id)
  assert.equal(ruleForMint([paused], mint)?.id, paused.id)
  assert.equal(ruleForMint([active], 'So11111111111111111111111111111111111111112'), null)
})

test('one tap buys only an open reminder of a rule that is on; the last line says what became of the one before', () => {
  const now = Date.parse('2026-09-24T16:05:00.000Z')
  const due = occurrence('2026-09-24T16:00:00.000Z', 'due')
  const bought = occurrence('2026-09-17T16:00:00.000Z', 'bought', { spentUsd: 25, signature: 'Sx' })
  const open = rule({ occurrences: [due, bought] })
  assert.equal(openOccurrence(open, now), due)
  assert.equal(openOccurrence(open, Date.parse('2026-09-25T16:00:01.000Z')), null, 'its day passed')
  assert.equal(openOccurrence(rule({ status: 'paused', occurrences: [due] }), now), null)
  assert.equal(lastSettled(open), bought)
  assert.equal(occurrenceAt(open, '2026-09-17T16:00:00Z'), bought, 'the same instant, however written')
  assert.deepEqual(ruleFace(open, null, now), { kind: 'due', occurrence: due })
  assert.deepEqual(ruleFace(rule({ status: 'paused', occurrences: [due] }), null, now), { kind: 'paused' })
  assert.deepEqual(ruleFace(rule(), null, now), {
    kind: 'next',
    atMs: Date.parse('2026-10-01T16:00:00.000Z'),
    timeZone: 'Europe/Kyiv',
  })
  assert.deepEqual(ruleFace(rule({ nextDueAt: null }), null, now), { kind: 'plain' })
})

test('a month’s budget holds a rule its rest does not cover; a paused rule is paused, not held', () => {
  assert.equal(fitsMonth(rule(), null), true)
  assert.equal(fitsMonth(rule(), budget({ capUsd: null, remainingUsd: null })), true)
  assert.equal(fitsMonth(rule(), budget({ remainingUsd: 25 })), true)
  assert.equal(fitsMonth(rule(), budget({ remainingUsd: 24.99 })), false)
  const now = Date.parse('2026-09-24T16:05:00.000Z')
  const open = rule({ occurrences: [occurrence('2026-09-24T16:00:00.000Z', 'due')] })
  assert.deepEqual(ruleFace(open, budget({ remainingUsd: 10 }), now), { kind: 'held' })
  assert.deepEqual(ruleFace(rule(), budget({ remainingUsd: 0, exhausted: true }), now), { kind: 'held' })
  assert.equal(heldByBudget(rule(), budget({ remainingUsd: 10 })), true)
  assert.equal(heldByBudget(rule({ status: 'paused' }), budget({ remainingUsd: 10 })), false)
  assert.equal(heldByBudget(rule(), budget({ capUsd: null, remainingUsd: null })), false)
})

/* ---- «Якщо впаде» ---- */

test('a fall is a whole per cent from 1 to 50; the sheet offers −5, −10, −15 and −20 %', () => {
  assert.deepEqual([...RULE_DIP_PRESETS_PCT], [5, 10, 15, 20])
  for (const pct of [1, 5, 50]) assert.equal(isDipPct(pct), true)
  for (const pct of [0, 51, 5.5, -5, Number.NaN, '5', null]) assert.equal(isDipPct(pct), false, String(pct))
})

test('where a new fall’s rule would remind: the page’s price now less N % — nothing without a price', () => {
  assert.equal(dipTriggerUsd(200, 5), 190)
  assert.deepEqual(dipPreview(254.3, 5), { priceUsd: 254.3, triggerUsd: 254.3 * 0.95 })
  assert.equal(priceWord(dipPreview(254.3, 5).triggerUsd, 'uk'), '$241,59')
  assert.equal(priceWord(dipPreview(254.3, 5).triggerUsd, 'en'), '$241.59')
  assert.equal(dipPreview(null, 5), null)
  assert.equal(dipPreview(0, 5), null)
  assert.equal(dipPreview(Number.NaN, 5), null)
  assert.equal(dipPreview(200, 60), null, 'a fall the server would refuse is not previewed')
})

test('«Якщо впаде» as the server takes it: the fall and the phone’s zone in place of a schedule', () => {
  const request = dipRequest({
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    amountUsd: 20.004,
    dropPct: 5,
    timeZone: 'Europe/Kyiv',
    locale: 'uk',
  })
  assert.deepEqual(request, {
    asset: { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
    amountUsd: 20,
    kind: 'dip',
    dip: { dropPct: 5, timeZone: 'Europe/Kyiv' },
    locale: 'uk',
  })
  assert.equal('schedule' in request, false, 'a fall’s rule must not name a schedule')
})

/* ---- «Бюджет місяця» ---- */

test('the month as its bar says it: $45 of $100, what is still on its way counted as spent', () => {
  const words = AUTOINVEST_COPY
  assert.deepEqual(monthUse(budget()), { countedUsd: 45, share: 0.45 })
  assert.deepEqual(monthUse(budget({ spentUsd: 40, unknownUsd: 20, remainingUsd: 40 })), { countedUsd: 60, share: 0.6 })
  assert.deepEqual(monthUse(budget({ spentUsd: 120, remainingUsd: 0, exhausted: true })), { countedUsd: 120, share: 1 })
  assert.deepEqual(monthUse(budget({ capUsd: null, remainingUsd: null })), { countedUsd: 45, share: null })
  assert.equal(monthWords(budget(), words.uk, 'uk'), 'Цього місяця $45 з $100')
  assert.equal(monthWords(budget(), words.en, 'en'), 'This month $45 of $100')
  assert.equal(monthWords(budget({ spentUsd: 12.5 }), words.uk, 'uk'), 'Цього місяця $12,50 з $100')
  assert.equal(
    monthWords(budget({ capUsd: null, remainingUsd: null, spentUsd: 0 }), words.uk, 'uk'),
    'Цього місяця $0 · без стелі',
  )
  assert.equal(
    monthWords(budget({ capUsd: null, remainingUsd: null, spentUsd: 0 }), words.en, 'en'),
    'This month $0 · no limit',
  )
})

test('a card’s date wraps whole, and a line of parts wraps only between its parts', () => {
  const nbsp = String.fromCharCode(0xa0)
  const due = dueWords(Date.parse('2026-09-25T08:00:00.000Z'), 'Europe/Kyiv', 'uk')
  assert.equal(unbroken(due), due.replaceAll(' ', nbsp))
  assert.equal(unbroken(due).includes(' '), false)
  assert.equal(unbrokenParts('$10 · Щодня · о 11:00'), `$10 · Щодня · о${nbsp}11:00`)
  assert.equal(unbrokenParts('Бюджет вичерпано · до 1-го числа'), `Бюджет${nbsp}вичерпано · до${nbsp}1-го${nbsp}числа`)
})

test('a ceiling is typed from $1 to $1 000 000; the quick ones are $31 · $50 · $100 · $200, and the one set now', () => {
  // The web's own ceilings: the first is a dollar a day for the longest month.
  assert.deepEqual([...BUDGET_PRESETS_USD], [31, 50, 100, 200])
  assert.equal(BUDGET_PRESETS_USD[0], 31 * 1)
  assert.equal(BUDGET_MIN_USD, 1)
  assert.equal(budgetOfInput('100', 'uk'), 100)
  assert.equal(budgetOfInput('$150,50', 'uk'), 150.5)
  assert.equal(budgetOfInput('1,000.25', 'en'), 1000.25)
  assert.equal(budgetOfInput('1', 'en'), 1)
  assert.equal(budgetOfInput('9.99', 'en'), 9.99)
  assert.equal(budgetOfInput('0.99', 'en'), null)
  assert.equal(budgetOfInput('1000000.01', 'en'), null)
  assert.equal(budgetOfInput('', 'en'), null)
  assert.deepEqual(capChoices(null), [31, 50, 100, 200])
  assert.deepEqual(capChoices(100), [31, 50, 100, 200])
  assert.deepEqual(capChoices(150), [31, 50, 100, 150, 200])
})

test('a new rule fits the month under the ceiling shown — what is left after the month’s purchases — or stands until the 1st', () => {
  assert.equal(fitsCeiling(20, null, budget()), true, 'no ceiling')
  assert.equal(fitsCeiling(55, 100, budget()), true, '$45 of $100 taken, $55 left')
  assert.equal(fitsCeiling(55.01, 100, budget()), false)
  assert.equal(fitsCeiling(20, 10, budget({ spentUsd: 0, remainingUsd: 10 })), false, 'a ceiling below the rule’s sum')
  assert.equal(fitsCeiling(20, 50, null), true, 'the month not read yet: nothing taken')
  assert.equal(fitsCeiling(20, 50, budget({ spentUsd: 25, unknownUsd: 10 })), false, 'on its way counts as spent')
})

test('a ceiling set before keeps the clock its month is counted on; a new one takes the phone’s', () => {
  assert.deepEqual(budgetRequest({ capUsd: 100.004, budget: null, deviceZone: 'Europe/Kyiv', locale: 'uk' }), {
    capUsd: 100,
    timeZone: 'Europe/Kyiv',
    locale: 'uk',
  })
  // Without a ceiling the month is counted on the newest rule's clock — a new ceiling takes the phone's own.
  assert.equal(
    budgetRequest({
      capUsd: 50,
      budget: budget({ capUsd: null, remainingUsd: null, timeZone: 'America/New_York' }),
      deviceZone: 'Europe/Kyiv',
      locale: 'en',
    }).timeZone,
    'Europe/Kyiv',
  )
  assert.equal(
    budgetRequest({
      capUsd: 200,
      budget: budget({ timeZone: 'America/New_York' }),
      deviceZone: 'Europe/Kyiv',
      locale: 'en',
    }).timeZone,
    'America/New_York',
  )
})

/* ---- «Пропущено» ---- */

test('«Пропущено» stands under a rule’s line while nothing newer does — never with an open reminder or a held one', () => {
  const now = Date.parse('2026-09-26T10:00:00.000Z')
  const missed = occurrence('2026-09-24T16:00:00.000Z', 'missed')
  const bought = occurrence('2026-09-17T16:00:00.000Z', 'bought', { spentUsd: 25 })
  const after = rule({ occurrences: [missed, bought] })
  assert.equal(missedOf(after, ruleFace(after, null, now)), missed)
  assert.equal(missedOf(rule({ occurrences: [bought, missed] }), ruleFace(rule(), null, now)), null, 'bought since')
  const open = rule({ occurrences: [occurrence('2026-09-26T09:00:00.000Z', 'due'), missed] })
  assert.equal(missedOf(open, ruleFace(open, null, now)), null, 'the reminder open now is what the card says')
  assert.equal(missedOf(after, ruleFace(after, budget({ remainingUsd: 5 }), now)), null, 'held says the budget')
  const paused = rule({ status: 'paused', nextDueAt: null, occurrences: [missed] })
  assert.equal(missedOf(paused, ruleFace(paused, null, now)), missed)
})

/* ---- a refusal in words ---- */

test('a refused write says what the person can do next — the price for a fall, the budget for the budget', () => {
  const words = AUTOINVEST_COPY.uk
  const create = { write: 'create', dip: false }
  assert.equal(writeFailureWords('RULE_LIMIT_REACHED', words, create), words.limit)
  assert.equal(writeFailureWords('SESSION_EXPIRED', words, create), words.signInFirst)
  assert.equal(writeFailureWords('NETWORK', words, create), words.offline)
  assert.equal(writeFailureWords('UNAVAILABLE', words, create), words.failed)
  assert.equal(writeFailureWords('UNAVAILABLE', words, { write: 'create', dip: true }), words.priceUnknownNow)
  assert.equal(writeFailureWords('UNAVAILABLE', words, { write: 'change', dip: true }), words.priceUnknownNow)
  assert.equal(writeFailureWords('INTERNAL', words, { write: 'change', dip: false }), words.changeFailed)
  assert.equal(writeFailureWords('VALIDATION_ERROR', words, { write: 'budget', dip: false }), words.budgetFailed)
  assert.equal(writeFailureWords('UNAVAILABLE', words, { write: 'budget', dip: true }), words.budgetFailed)
  assert.equal(writeFailureWords('NETWORK', words, { write: 'budget', dip: false }), words.offline)
  assert.equal(ruleWriteFailure('UNAVAILABLE'), 'unavailable')
})

test('a reminder’s purchase is offered only while it is open; otherwise the sheet says what became of it', () => {
  const now = Date.parse('2026-09-24T16:05:00.000Z')
  const dueAt = '2026-09-24T16:00:00.000Z'
  const at = (state, extra) => rule({ occurrences: [occurrence(dueAt, state), ...(extra ?? [])] })
  const read = (r, overrides = {}) =>
    ruleBuyState({ read: 'ready', rule: r, dueAt, budget: null, nowMs: now, ...overrides })

  const open = read(at('due'))
  assert.equal(open.kind, 'open')
  assert.deepEqual(bindingOf(open), { ruleId: rule().id, dueAt })
  assert.equal(read(at('bought')).kind, 'bought')
  assert.equal(read(at('pending')).kind, 'pending')
  assert.equal(read(at('missed')).kind, 'closed', 'never caught up')
  assert.equal(read(at('held'), { budget: budget({ remainingUsd: 5 }) }).kind, 'held')
  assert.equal(
    read(at('held')).kind,
    'closed',
    'a due the budget held is never reminded afterwards: covered again, it is over',
  )
  assert.equal(read(at('due'), { budget: budget({ remainingUsd: 5 }) }).kind, 'held')
  assert.equal(read(at('due'), { nowMs: Date.parse('2026-09-25T16:00:01.000Z') }).kind, 'closed', 'its day passed')
  assert.equal(read(rule({ status: 'paused', occurrences: [occurrence(dueAt, 'due')] })).kind, 'paused')
  assert.equal(read(rule({ occurrences: [] })).kind, 'closed', 'an occurrence the rule does not hold')
  assert.equal(ruleBuyState({ read: 'ready', rule: null, dueAt, budget: null, nowMs: now }).kind, 'gone')
  assert.equal(ruleBuyState({ read: 'failed', rule: null, dueAt, budget: null, nowMs: now }).kind, 'read-failed')
  assert.equal(ruleBuyState({ read: 'reading', rule: null, dueAt, budget: null, nowMs: now }).kind, 'reading')
  assert.equal(bindingOf(read(at('bought'))), null)
  // From the company's own card the reminder open now is the one bought.
  assert.equal(ruleBuyState({ read: 'ready', rule: at('due'), dueAt: null, budget: null, nowMs: now }).kind, 'open')
})

/* ---- the reminder a note is ---- */

test('a reminder note names its rule, its due instant and its company; any other note is none', () => {
  const ruleId = rule().id
  const note = {
    subject: { kind: 'autoinvest-rule', id: ruleId },
    triggerId: `autoinvest:${ruleId}:2026-09-24T16:00:00.000Z@NVDAx`,
  }
  assert.deepEqual(reminderOfNote(note), { ruleId, dueAt: '2026-09-24T16:00:00.000Z', symbol: 'NVDAx' })
  assert.deepEqual(reminderOfNote({ subject: note.subject }), { ruleId, dueAt: null, symbol: null })
  assert.equal(reminderOfNote({ subject: { kind: 'trading-plan', id: 'plan_0f3a9c2e7b4d4e1f8a6c5b7d9e0f1a2b' } }), null)
  assert.equal(reminderOfNote({ subject: { kind: 'autoinvest-budget', id: 'budget:2026-09' } }), null)
  assert.equal(reminderOfNote({ subject: { kind: 'autoinvest-rule', id: 'rule_nope' } }), null)
  assert.equal(reminderOfNote({}), null)
  assert.equal(dueOfIdentity(`autoinvest:${ruleId}:not-a-date@NVDAx`, ruleId), null)
  assert.equal(dueOfIdentity(note.triggerId, 'rule_00000000000000000000000000000009'), null, 'another rule’s identity')
  assert.equal(symbolOfIdentity('autoinvest:x:2026@S%26P'), null, 'a symbol outside the safe shape is dropped')
  assert.equal(symbolOfIdentity('autoinvest:x:2026@SPYx'), 'SPYx')
  assert.equal(isRuleId(ruleId), true)
  assert.deepEqual(rulePurchaseParams({ mint: 'M', symbol: 'NVDAx', ruleId, dueAt: '2026-09-24T16:00:00.000Z' }), {
    mint: 'M',
    symbol: 'NVDAx',
    category: 'stock',
    rule: ruleId,
    due: '2026-09-24T16:00:00.000Z',
  })
})

/* ---- the server's word ---- */

test('a refusal is said by what the person can do next', () => {
  assert.equal(ruleRefusalOf('RULE_NOT_DUE'), 'closed')
  assert.equal(ruleRefusalOf('RULE_NOT_FOUND'), 'gone')
  assert.equal(ruleRefusalOf('RULE_MISMATCH'), 'mismatch')
  assert.equal(ruleRefusalOf('RULE_BUDGET_EXHAUSTED'), 'budget')
  assert.equal(ruleRefusalOf('ORDER_NO_ROUTE'), null)
  assert.equal(ruleWriteFailure('RULE_LIMIT_REACHED'), 'limit')
  assert.equal(ruleWriteFailure('SESSION_EXPIRED'), 'sign-in')
  assert.equal(ruleWriteFailure('NETWORK'), 'offline')
  assert.equal(ruleWriteFailure('ASSET_UNCONFIRMED'), 'failed')
})

test('«Купувати щотижня» starts from what left the wallet, to the cent — from a dollar', () => {
  assert.equal(weeklyFromSpent(20), 20)
  assert.equal(weeklyFromSpent(9.998), 10, 'a $10 purchase that spent a hair less is still the $10 rule')
  assert.equal(weeklyFromSpent(25.456), 25.46)
  assert.equal(weeklyFromSpent(5), 5)
  assert.equal(weeklyFromSpent(0.998), 1, 'a $1 purchase is a $1 rule')
  assert.equal(weeklyFromSpent(0.5), null)
  assert.equal(weeklyFromSpent(null), null)
})

test('a rule the server answers 404 for is gone, even with an earlier read still at hand', () => {
  const old = { rule: rule() }
  assert.deepEqual(ruleRead({ isPending: true, isError: false, error: null, data: undefined }), {
    read: 'reading',
    rule: null,
  })
  assert.deepEqual(ruleRead({ isPending: false, isError: false, error: null, data: old }), {
    read: 'ready',
    rule: old.rule,
  })
  // Deleted since the last visit: the refetch's 404 wins over the data kept from before.
  assert.deepEqual(
    ruleRead({ isPending: false, isError: true, error: { code: 'RULE_NOT_FOUND', status: 404 }, data: old }),
    { read: 'ready', rule: null },
  )
  // Unreadable (offline): said as that; what was read before is not thrown away.
  assert.deepEqual(ruleRead({ isPending: false, isError: true, error: { code: 'NETWORK' }, data: undefined }), {
    read: 'failed',
    rule: null,
  })
  assert.equal(isRuleGoneError({ status: 404 }), true)
  assert.equal(isRuleGoneError({ code: 'UNAUTHORIZED', status: 401 }), false)
  assert.equal(isRuleGoneError(null), false)
})

/* ---- «Автоінвест» made clear ---- */

test('the month’s budget is its own line: «Бюджет не задано», or «Бюджет місяця $10 з $50» over its bar', () => {
  const words = AUTOINVEST_COPY
  assert.equal(budgetView(null), null, 'nothing is said before the rules’ read')
  assert.deepEqual(budgetView(budget({ capUsd: null, remainingUsd: null })), { kind: 'unset' })
  assert.deepEqual(budgetView(budget({ capUsd: 50, spentUsd: 10, remainingUsd: 40 })), {
    kind: 'capped',
    countedUsd: 10,
    capUsd: 50,
    percent: 20,
    exhausted: false,
  })
  // A purchase still on its way is counted until it is known; a month past its ceiling fills the bar, never more.
  assert.equal(budgetView(budget({ spentUsd: 40, unknownUsd: 20, remainingUsd: 40 }))?.percent, 60)
  assert.deepEqual(budgetView(budget({ spentUsd: 120, remainingUsd: 0, exhausted: true })), {
    kind: 'capped',
    countedUsd: 120,
    capUsd: 100,
    percent: 100,
    exhausted: true,
  })
  const unset = budgetView(budget({ capUsd: null, remainingUsd: null }))
  const capped = budgetView(budget({ capUsd: 50, spentUsd: 10, remainingUsd: 40 }))
  assert.equal(budgetRowWords(unset, words.uk, 'uk'), 'Бюджет не задано')
  assert.equal(budgetRowWords(unset, words.en, 'en'), 'No budget set')
  assert.equal(budgetRowWords(capped, words.uk, 'uk'), 'Бюджет місяця $10 з $50')
  assert.equal(budgetRowWords(capped, words.en, 'en'), 'Monthly budget $10 of $50')
  assert.equal(budgetRowWords(budgetView(budget({ spentUsd: 12.5 })), words.uk, 'uk'), 'Бюджет місяця $12,50 з $100')
  // The line's one action, and the words the two sums are read in — a rule's sum is each purchase, never the budget.
  assert.deepEqual([words.uk.setShort, words.uk.changeShort], ['Задати', 'Змінити'])
  assert.deepEqual([words.en.setShort, words.en.changeShort], ['Set', 'Change'])
  assert.equal(words.uk.eachPurchase, 'Кожна купівля')
  assert.equal(words.uk.atMostPerMonth, 'Не більше на місяць')
  assert.equal(words.en.eachPurchase, 'Each purchase')
  assert.equal(words.en.atMostPerMonth, 'At most per month')
})

test('an open reminder the month covers is offered first; one the budget holds, paused or past its window is not', () => {
  const now = Date.parse('2026-09-24T16:05:00.000Z')
  const due = occurrence('2026-09-24T16:00:00.000Z', 'due')
  const open = rule({ occurrences: [due] })
  assert.equal(reminderOffer(open, null, now), due)
  assert.equal(reminderOffer(open, budget({ remainingUsd: 25 }), now), due, 'to the cent of what is left')
  assert.equal(reminderOffer(open, budget({ remainingUsd: 10 }), now), null, 'the budget holds it: «Змінити бюджет»')
  assert.equal(reminderOffer(rule({ status: 'paused', occurrences: [due] }), null, now), null)
  assert.equal(reminderOffer(open, null, Date.parse('2026-09-25T16:00:01.000Z')), null, 'its window passed')
  assert.equal(
    reminderOffer(rule({ occurrences: [occurrence('2026-09-24T16:00:00.000Z', 'bought')] }), null, now),
    null,
  )
  assert.equal(reminderOffer(null, null, now), null)
})

test('a rule’s purchase is never mistaken for an ordinary one, in both languages — the web’s own words', () => {
  const { uk, en } = AUTOINVEST_COPY
  assert.equal(uk.buyByRule('$20'), 'Купити $20 за правилом')
  assert.equal(en.buyByRule('$20'), 'Buy $20 by your rule')
  assert.equal(uk.plainPurchase, 'Звичайна купівля')
  assert.equal(en.plainPurchase, 'One-off purchase')
  assert.equal(uk.reminderStaysOpen, 'Нагадування правила лишиться відкритим')
  assert.equal(uk.plainLeavesOpen('$20'), 'Це звичайна купівля: нагадування правила на $20 лишиться відкритим.')
  assert.equal(en.plainLeavesOpen('$20'), 'This is a one-off purchase: your rule’s $20 reminder stays open.')
  assert.equal(uk.reminderOpenHere, 'Нагадування правила відкрите')
  assert.equal(uk.plainHereLeavesOpen, 'Купівля тут його не закриває — правило рахує лише купівлю за правилом.')
  assert.equal(uk.budgetNotSet, 'Бюджет не задано')
  // Every word in both languages, and none the product forbids — a help topic's every line too.
  assert.deepEqual(Object.keys(uk).sort(), Object.keys(en).sort())
  const texts = (value) =>
    typeof value === 'function'
      ? [value('$20', '$100')]
      : typeof value === 'string'
        ? [value]
        : Object.values(value).flat()
  for (const [key, value] of Object.entries(uk)) {
    for (const text of texts(value)) assert.doesNotMatch(text, /\bDCA\b|тригер|автоматично|пасивн/i, key)
  }
})
