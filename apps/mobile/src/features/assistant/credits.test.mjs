import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CREDITS_COPY } from './credits-copy.ts'
import {
  badgeText,
  badgeVisible,
  creditedMore,
  entryAmount,
  entryLabel,
  entryShown,
  minutesLeft,
  nearDayCap,
  openOrderOf,
  orderPayable,
  orderPolls,
  orderRefusalOf,
  orderStatusLine,
  packageLabel,
  payHeld,
  paymentLine,
  shownEntries,
  welcomeRefusalOf,
  withOrder,
  ORDER_POLL_AFTER_MS,
} from './credits-panel-model.ts'

/** Ukrainian figures group with a no-break space; the tests read it as a plain one. */
const norm = (value) =>
  typeof value === 'string'
    ? value.replace(/[\u00a0\u202f]/g, ' ')
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, norm(inner)]))
      : value
const eq = (actual, expected) => assert.equal(norm(actual), expected)
const same = (actual, expected) => assert.deepEqual(norm(actual), expected)

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const UK = CREDITS_COPY.uk
const EN = CREDITS_COPY.en

const credits = (overrides = {}) => ({
  unit: 'credits',
  balance: 1500,
  welcome: 500,
  bought: 1000,
  free: { used: 20, left: 30, daily: 50, resetsAt: '2026-10-23T00:00:00.000Z' },
  reserved: 0,
  dailySpend: { used: 100, cap: 1000, resetsAt: '2026-10-23T00:00:00.000Z' },
  prices: { question: 10, alertExplain: 5, tokenReport: 30, priceMove: 20, voice: 10, deep: 100, plan: 150 },
  welcomeOffer: 'taken',
  holder: 'wallet',
  ...overrides,
})

const pkg = (overrides = {}) => ({ id: 'usdc-5', usdc: '5', credits: 5500, bonusPercent: 10, ...overrides })

const order = (overrides = {}) => ({
  id: 'ord_1',
  package: pkg(),
  status: 'awaiting',
  amount: { raw: '5000000', display: '5', symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  received: { raw: '0', display: '0' },
  credited: 0,
  payPage: 'https://ryntra.io/pay/ord_1',
  payUrl: 'solana:…',
  reference: 'Ref1111111111111111111111111111111111111111',
  treasury: { address: 'AmKrrLoH1111111111111111111111111111SUVo', abbreviated: 'AmKr…SUVo' },
  createdAt: '2026-10-22T11:55:00.000Z',
  expiresAt: '2026-10-22T12:10:00.000Z',
  payments: [],
  wrongToken: false,
  ...overrides,
})

const entry = (overrides = {}) => ({
  at: '2026-10-22T10:00:00.000Z',
  kind: 'grant',
  action: null,
  reason: null,
  credits: 0,
  charged: null,
  ...overrides,
})

test('a package says its price, credits and bonus — the server’s figures', () => {
  same(packageLabel(pkg(), 'uk'), { price: '$5', credits: '5 500 кредитів', bonus: '+10 %' })
  same(packageLabel(pkg({ id: 'usdc-2', usdc: '2', credits: 2000, bonusPercent: 0 }), 'en'), {
    price: '$2',
    credits: '2,000 credits',
    bonus: null,
  })
  eq(packageLabel(pkg({ usdc: '2.50' }), 'uk').price, '$2,50')
})

test('holds and releases net to nothing and are hidden, as on the web', () => {
  eq(entryShown(entry({ kind: 'grant', credits: 500, reason: 'welcome' })), true)
  eq(entryShown(entry({ kind: 'hold', credits: -10, action: 'question' })), false)
  eq(entryShown(entry({ kind: 'release', credits: 10, action: 'question' })), false)
  eq(entryShown(entry({ kind: 'expire', credits: 10 })), false)
  eq(entryShown(entry({ kind: 'capture', charged: 0, action: 'question' })), false)
  eq(entryShown(entry({ kind: 'capture', charged: 10, action: 'question' })), true)
  eq(entryShown(entry({ kind: 'merge-in', credits: 0 })), false)
  eq(entryShown(entry({ kind: 'merge-out', credits: -300 })), true)
  const list = [
    entry({ kind: 'hold' }),
    entry({ kind: 'capture', charged: 10 }),
    entry({ kind: 'release' }),
    entry({ credits: 5 }),
  ]
  eq(shownEntries(list).length, 2)
  eq(shownEntries(list, 1).length, 1)
})

test('an entry in words, with its sign', () => {
  eq(entryLabel(entry({ kind: 'capture', charged: 10, action: 'question' }), UK), 'Списано · Питання')
  eq(entryLabel(entry({ kind: 'grant', reason: 'purchase', credits: 5500 }), UK), 'Куплено')
  eq(entryLabel(entry({ kind: 'grant', reason: 'welcome', credits: 500 }), UK), 'Додано · вітальні')
  eq(entryLabel(entry({ kind: 'grant', reason: 'adjust', credits: 50 }), EN), 'Added · adjustment')
  eq(entryLabel(entry({ kind: 'merge-out', reason: 'welcome', credits: -500 }), UK), UK.entrySecondWelcome)
  eq(entryAmount(entry({ kind: 'capture', charged: 150, credits: -150 }), 'uk'), '−150')
  eq(entryAmount(entry({ kind: 'grant', credits: 5500 }), 'uk'), '+5 500')
})

test('an order’s state in words', () => {
  eq(orderStatusLine(order({ status: 'paid', credited: 5500 }), UK, 'uk'), 'Зараховано 5 500 кредитів')
  eq(orderStatusLine(order({ status: 'paid', credited: 5500 }), EN, 'en'), 'Credited 5,500 credits')
  eq(
    orderStatusLine(
      order({ status: 'underpaid', received: { raw: '2500000', display: '2.5' }, credited: 2500 }),
      UK,
      'uk',
    ),
    'Прийшло 2,5 з 5 USDC — додано 2 500 кредитів за базовим курсом, без бонусу.',
  )
  eq(orderStatusLine(order({ status: 'expired' }), UK, 'uk'), UK.expired)
  eq(orderStatusLine(order({ status: 'checking' }), UK, 'uk'), UK.checking)
  assert.match(norm(orderStatusLine(order(), UK, 'uk')), /^Чекаємо на оплату · до \d\d:\d\d$/)
})

test('polling stops once paid, runs while waiting, and past the window only while a payment of ours is out', () => {
  eq(orderPolls(order({ status: 'paid' }), NOW, true), false)
  eq(orderPolls(order(), NOW, false), true)
  eq(orderPolls(order({ status: 'checking' }), NOW, false), true)
  const ends = Date.parse(order().expiresAt)
  eq(orderPolls(order(), ends + ORDER_POLL_AFTER_MS - 1, false), true)
  eq(orderPolls(order(), ends + ORDER_POLL_AFTER_MS, false), false)
  eq(orderPolls(order({ status: 'expired' }), NOW, false), false)
  eq(orderPolls(order({ status: 'underpaid' }), NOW, false), false)
  eq(orderPolls(order({ status: 'expired' }), NOW, true), true)
})

test('an order is paid once: only while it waits, nothing arrived, its window is open and nothing of ours is out', () => {
  eq(orderPayable(order(), NOW, false), true)
  eq(orderPayable(order(), NOW, true), false)
  eq(orderPayable(order({ status: 'checking' }), NOW, false), false)
  eq(orderPayable(order({ payments: [{ signature: 'sig', amount: '5', at: null }] }), NOW, false), false)
  eq(orderPayable(order({ received: { raw: '100', display: '0.0001' } }), NOW, false), false)
  eq(orderPayable(order(), Date.parse(order().expiresAt), false), false)
  eq(payHeld(NOW - 1_000, NOW, 180_000), true)
  eq(payHeld(NOW - 180_000, NOW, 180_000), false)
  eq(payHeld(null, NOW, 180_000), false)
  eq(minutesLeft(order(), NOW), 10)
  eq(minutesLeft(order(), NOW + 9 * 60_000 + 1), 1)
  eq(minutesLeft(order(), NOW + 11 * 60_000), null)
})

test('orders: the open one is found, a fresh copy replaces the old, credits moving are noticed', () => {
  const paid = order({ id: 'ord_0', status: 'paid', credited: 5500 })
  const open = order({ id: 'ord_2' })
  eq(openOrderOf([paid, open], NOW)?.id, 'ord_2')
  eq(openOrderOf([paid], NOW), null)
  const updated = withOrder([paid, open], { ...open, status: 'paid' })
  eq(updated.length, 2)
  eq(updated[1].status, 'paid')
  eq(withOrder([paid], open)[0].id, 'ord_2')
  eq(creditedMore(0, 5500), true)
  eq(creditedMore(5500, 5500), false)
  eq(creditedMore(undefined, 0), false)
  eq(paymentLine({ signature: '4kQ2abcdefghijk9xYz', amount: '5.00', at: null }, 'uk'), '5,00 USDC · 4kQ2…9xYz')
})

test('refusals are said in words; taken and not eligible close the welcome ask', () => {
  eq(orderRefusalOf('RATE_LIMITED'), 'orderLimit')
  eq(orderRefusalOf('CAPABILITY_UNAVAILABLE'), 'buyClosed')
  eq(orderRefusalOf(null), 'orderFailed')
  same(welcomeRefusalOf('WELCOME_TAKEN'), { key: 'welcomeTaken', final: true })
  same(welcomeRefusalOf('WELCOME_NOT_ELIGIBLE'), { key: 'welcomeNo', final: true })
  same(welcomeRefusalOf('NETWORK'), { key: 'welcomeLater', final: false })
})

test('the day’s ceiling is said only near it', () => {
  eq(nearDayCap(credits()), false)
  eq(nearDayCap(credits({ dailySpend: { used: 800, cap: 1000, resetsAt: '' } })), true)
  eq(nearDayCap(credits({ dailySpend: { used: 0, cap: 0, resetsAt: '' } })), false)
})

test('the badge shows only for a proven wallet with credits above zero', () => {
  eq(badgeVisible(true, credits()), true)
  eq(badgeVisible(false, credits()), false)
  eq(badgeVisible(true, credits({ balance: 0 })), false)
  eq(badgeVisible(true, undefined), false)
  eq(badgeVisible(true, null), false)
  eq(badgeText(950, 'uk'), '950')
  eq(badgeText(9500, 'uk'), '9 500')
  eq(badgeText(28_750, 'en'), '28.7K')
  eq(badgeText(28_750, 'uk'), '28,7 тис.')
  eq(badgeText(2_000_000, 'en'), '2M')
})

test('both languages carry every word', () => {
  for (const key of Object.keys(EN)) assert.ok(key in UK, key)
  for (const word of [...Object.values(UK.failures), UK.sign, UK.topUp, UK.badge('1 500')])
    assert.doesNotMatch(word, /Ryn\b/)
})
