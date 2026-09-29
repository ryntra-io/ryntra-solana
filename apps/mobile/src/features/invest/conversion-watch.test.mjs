import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseAmount } from '../trade/trade-model.ts'
import {
  convertAction,
  convertRate,
  convertReviewRows,
  deadlineDay,
  deadlineExact,
  eventFor,
  eventLine,
  eventOfRow,
  gapLine,
  isConvert,
  isIssuerEvent,
  listedPriceOf,
  rawDecimalText,
  saleIssuerFeeUsd,
  SELL_FOR_USDC,
  shareRaw,
  shortEventLine,
  swapActionWord,
  windowOpen,
} from './conversion-watch.ts'
import { CONVERT_COPY } from './convert-copy.ts'
import { BUY_COPY } from './buy-copy.ts'

const SPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'
const SPCXX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const DEADLINE = '2027-03-12T23:59:00.000Z'
const TODAY = Date.parse('2026-09-26T09:00:00.000Z')

/** SpaceX's path as production answered it on 2026-09-26: every step passed, the swap into SPCXx open. */
const PATH = {
  at: 'private',
  steps: [
    { step: 'private', state: 'passed', date: '2025-09-16' },
    { step: 'ipo', state: 'passed', date: '2026-06-12' },
    { step: 'exchange', state: 'passed', date: '2026-06-12' },
    { step: 'solana', state: 'current', date: '2026-06-12' },
  ],
  swap: {
    from: { mint: SPACEX, symbol: 'SPACEX' },
    into: { mint: SPCXX, symbol: 'SPCXx' },
    deadline: DEADLINE,
    open: true,
  },
}

const row = (over = {}) => ({
  representation: {
    mint: SPACEX,
    symbol: 'SPACEX',
    name: 'SpaceX PreStocks',
    issuer: { id: 'prestocks', label: 'PreStocks', catalogue: true },
    issuerConfirmation: 'issuer-catalogue',
    instrument: { class: 'pre-ipo', unitBasis: 'token' },
    underlying: { symbol: 'SPACEX', isin: null, listingCountry: null, name: 'SpaceX' },
    exchange: null,
    tokenProgram: null,
    decimals: 9,
    tradingHalted: false,
    sources: [],
  },
  lifecycle: {
    state: 'conversion-open',
    tradable: true,
    source: 'event-registry',
    observedAt: '2026-09-25T06:00:00.000Z',
    url: 'https://www.prestocks.com/spacex',
    recheckBy: '2026-12-01',
    deadline: DEADLINE,
    note: 'SpaceX has gone public.',
  },
  companyPath: PATH,
  ...over,
})

test('SPACEX’s row states its own swap: the company went public, into SPCXx, by the issuer’s cut-off, with its notice', () => {
  const event = eventOfRow(row(), 'SpaceX')
  assert.deepEqual(event, {
    mint: SPACEX,
    symbol: 'SPACEX',
    company: 'SpaceX',
    cause: 'ipo',
    into: { mint: SPCXX, symbol: 'SPCXx', company: 'SpaceX' },
    deadline: DEADLINE,
    open: true,
    noticeUrl: 'https://www.prestocks.com/spacex',
  })
  assert.equal(eventFor([event], SPACEX), event)
  assert.equal(eventFor([event], SPCXX), null)
  assert.equal(eventFor(null, SPACEX), null)
})

test('the listed token carries the same path but no event of its own; a token with no window has none', () => {
  const listed = row({
    representation: {
      ...row().representation,
      mint: SPCXX,
      symbol: 'SPCXx',
      instrument: { class: 'listed-equity', unitBasis: 'share' },
    },
    lifecycle: { state: 'active', tradable: true, url: null, deadline: null },
  })
  assert.equal(eventOfRow(listed, 'SpaceX'), null)
  assert.equal(eventOfRow(row({ lifecycle: { state: 'active', tradable: true }, companyPath: null }), 'OpenAI'), null)
  assert.equal(eventOfRow(row({ lifecycle: null, companyPath: undefined }), 'OpenAI'), null)
})

test('a window the lifecycle states without a path is still an event — no target, no cause, only the sale and the deadline', () => {
  const event = eventOfRow(row({ companyPath: null }), 'SpaceX')
  assert.equal(event.into, null)
  assert.equal(event.cause, null)
  assert.equal(event.open, true)
  assert.equal(swapActionWord(event, 'uk'), null)
  assert.equal(
    eventLine(event, 'holder', 'uk', TODAY),
    'Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.',
  )
  const closed = eventOfRow(
    row({ companyPath: null, lifecycle: { ...row().lifecycle, state: 'expired', tradable: false } }),
    'SpaceX',
  )
  assert.equal(closed.open, false)
  // A path whose server said closed, or a lifecycle that expired, is a closed window whatever the clock says.
  assert.equal(
    windowOpen(eventOfRow(row({ companyPath: { ...PATH, swap: { ...PATH.swap, open: false } } }), 'SpaceX'), TODAY),
    false,
  )
  assert.equal(
    windowOpen(eventOfRow(row({ lifecycle: { ...row().lifecycle, state: 'expired' } }), 'SpaceX'), TODAY),
    false,
  )
})

test('the window is open until the cut-off by this clock — past it, closed whatever the answer said', () => {
  const event = eventOfRow(row(), 'SpaceX')
  assert.equal(windowOpen(event, TODAY), true)
  assert.equal(windowOpen(event, Date.parse('2027-03-12T23:58:59.000Z')), true)
  assert.equal(windowOpen(event, Date.parse(DEADLINE)), false)
  assert.equal(windowOpen(event, Date.parse('2027-03-13T00:00:00.000Z')), false)
})

test('the event’s words are the web’s own, in both languages', () => {
  const event = eventOfRow(row(), 'SpaceX')
  assert.equal(
    eventLine(event, 'holder', 'uk', TODAY),
    'SpaceX вийшла на біржу. Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.',
  )
  assert.equal(
    eventLine(event, 'holder', 'en', TODAY),
    'SpaceX has gone public. Swap SPACEX by March 12, 2027 — after the deadline the token expires worthless.',
  )
  assert.equal(
    eventLine(event, 'everyone', 'uk', TODAY),
    'SpaceX вийшла на біржу. SPACEX треба обміняти до 12 березня 2027 — після строку токен згорить.',
  )
  assert.equal(
    eventLine(event, 'everyone', 'en', TODAY),
    'SpaceX has gone public. SPACEX must be swapped by March 12, 2027 — after the deadline the token expires worthless.',
  )
  assert.equal(
    eventLine(event, 'buyer', 'uk', TODAY),
    'SpaceX вийшла на біржу. Куплений SPACEX треба обміняти до 12 березня 2027 — після строку токен згорить.',
  )
  assert.equal(
    eventLine(event, 'buyer', 'en', TODAY),
    'SpaceX has gone public. SPACEX you buy must be swapped by March 12, 2027 — after the deadline the token expires worthless.',
  )
  const after = Date.parse('2027-03-13T08:00:00.000Z')
  assert.equal(
    eventLine(event, 'holder', 'uk', after),
    'SpaceX вийшла на біржу. Строк обміну SPACEX минув 12 березня 2027 — емітент більше не підтримує токен.',
  )
  assert.equal(
    eventLine(event, 'everyone', 'en', after),
    'SpaceX has gone public. The swap deadline for SPACEX passed on March 12, 2027 — the issuer no longer supports the token.',
  )
  assert.equal(shortEventLine(event, 'uk', TODAY), 'Обміняй до 12 березня 2027')
  assert.equal(shortEventLine(event, 'en', TODAY), 'Swap by March 12, 2027')
  assert.equal(shortEventLine(event, 'uk', after), 'Строк обміну минув')
  assert.equal(swapActionWord(event, 'uk'), 'Обміняти на SpaceX (SPCXx)')
  assert.equal(swapActionWord(event, 'en'), 'Swap for SpaceX (SPCXx)')
  assert.equal(SELL_FOR_USDC.uk, 'Продати за USDC')
  assert.equal(SELL_FOR_USDC.en, 'Sell for USDC')
})

test('the date is the deadline’s own day in UTC; the issuer’s minute is said only under «Деталі»', () => {
  assert.equal(deadlineDay(DEADLINE, 'uk'), '12 березня 2027')
  assert.equal(deadlineDay(DEADLINE, 'en'), 'March 12, 2027')
  assert.equal(deadlineExact(DEADLINE, 'uk'), '23:59 UTC, 12 березня 2027')
  assert.equal(deadlineExact(DEADLINE, 'en'), '23:59 UTC, March 12, 2027')
})

test('an event kept on the device reads back only whole', () => {
  const event = eventOfRow(row(), 'SpaceX')
  assert.equal(isIssuerEvent(JSON.parse(JSON.stringify(event))), true)
  assert.equal(isIssuerEvent({ ...event, mint: 'not-a-mint' }), false)
  assert.equal(isIssuerEvent({ ...event, deadline: 'soon' }), false)
  assert.equal(isIssuerEvent({ ...event, into: { mint: SPCXX, symbol: 'SPCXx' } }), false)
  assert.equal(isIssuerEvent({ ...event, noticeUrl: 'javascript:alert(1)' }), false)
  assert.equal(isIssuerEvent(null), false)
})

test('all, half or a quarter of what the wallet holds, raw and never rounded up — and back through Trade’s field exactly', () => {
  assert.equal(shareRaw(16906000n, 100), 16906000n)
  assert.equal(shareRaw(16906000n, 50), 8453000n)
  assert.equal(shareRaw(16906001n, 25), 4226500n)
  assert.equal(shareRaw(3n, 25), null, 'a share that is nothing is not offered')
  assert.equal(shareRaw(0n, 100), null)
  assert.equal(shareRaw(null, 100), null)
  assert.equal(rawDecimalText(16906000n, 9), '0.016906')
  assert.equal(rawDecimalText(5n, 9), '0.000000005')
  assert.equal(rawDecimalText(1000000000n, 9), '1')
  assert.equal(rawDecimalText(123456789012n, 9), '123.456789012')
  assert.equal(rawDecimalText(42n, 0), '42')
  for (const raw of [16906000n, 5n, 1000000000n, 123456789012n, 8453000n])
    assert.equal(parseAmount(rawDecimalText(raw, 9), 9), raw.toString())
})

/** About $10 of SPACEX (×5) into SPCXx (8 places), as a route quoted it — the order the server builds carries these figures. */
const SWAP_ORDER = {
  inAmountRaw: '16906000',
  outAmountRaw: '6640000',
  minReceivedRaw: '6574000',
  inUsdValue: '9.89',
  outUsdValue: '9.8',
  totalFeeBasisPoints: 10,
  priceImpactPct: '0.001',
  signatureFeeLamports: '5000',
  priorityFeeLamports: '15000',
  rentFeeLamports: '2039280',
}
const SALE_ORDER = {
  ...SWAP_ORDER,
  outAmountRaw: '9880000',
  minReceivedRaw: '9830000',
  outUsdValue: '9.88',
  rentFeeLamports: '0',
}
const FEE = { basisPoints: 100, maximumFeeRaw: '18446744073709551615' }
const words = (locale) => ({
  atLeast: BUY_COPY[locale].atLeast,
  reserve: BUY_COPY[locale].reserve,
  issuerFee: BUY_COPY[locale].issuerFee,
})

test('«Перевірка» of the swap is four rows: what leaves, what arrives, all costs with the issuer’s 1%, the rate against the exchange', () => {
  const rows = convertReviewRows({
    mode: 'swap',
    order: SWAP_ORDER,
    token: { symbol: 'SPACEX', multiplier: 5 },
    giveDecimals: 9,
    getDecimals: 8,
    target: { mint: SPCXX, symbol: 'SPCXx', company: 'SpaceX', multiplier: 1 },
    listed: listedPriceOf(148.57, 148.5697, 'SPCXx'),
    company: 'SpaceX',
    issuerFee: FEE,
    solUsd: 150,
    locale: 'uk',
    words: words('uk'),
  })
  assert.deepEqual(
    rows.map((entry) => entry.key),
    ['give', 'get', 'costs', 'rate'],
  )
  const [give, get, costs, rate] = rows
  assert.equal(give.value, '0,0845 SPACEX', 'through the ×5: 0.016906 raw is 0.08453 shown')
  assert.equal(give.sub, '≈ $9,89')
  assert.equal(get.value, '≈ 0,0664 SpaceX (SPCXx)')
  assert.equal(get.sub, 'щонайменше 0,0657')
  assert.equal(costs.value, '≈ $0,11', 'never below the stated fees, the issuer’s 1% among them, plus the network’s')
  assert.equal(costs.fee, 'з них комісія емітента 1% ≈ $0,10')
  assert.equal(costs.sub, '≈ $0,31 у SOL разово лишаються в гаманці на рахунку токена')
  assert.equal(rate.value, '1 SPACEX → 0,7855 SPCXx')
  assert.equal(rate.sub, 'на 21% менше, ніж ціна SpaceX на біржі ($148,57)')
  const en = convertReviewRows({
    mode: 'swap',
    order: SWAP_ORDER,
    token: { symbol: 'SPACEX', multiplier: 5 },
    giveDecimals: 9,
    getDecimals: 8,
    target: { mint: SPCXX, symbol: 'SPCXx', company: 'SpaceX', multiplier: 1 },
    listed: listedPriceOf(null, 148.5697, 'SPCXx'),
    company: 'SpaceX',
    issuerFee: FEE,
    solUsd: 150,
    locale: 'en',
    words: words('en'),
  })
  assert.equal(en[0].value, '0.0845 SPACEX')
  assert.equal(en[1].sub, 'at least 0.0657')
  assert.equal(en[2].fee, 'including the issuer’s 1% fee ≈ $0.10')
  // While the exchange's price is unread, the listed token's own price is named as that — never as the exchange's.
  assert.equal(en[3].sub, '21% below the price of SPCXx ($148.57)')
})

test('the sale into USDC says dollars, the rate per token and the same gap; unknown figures are dashes', () => {
  const [give, get, costs, rate] = convertReviewRows({
    mode: 'sell',
    order: SALE_ORDER,
    token: { symbol: 'SPACEX', multiplier: 5 },
    giveDecimals: 9,
    getDecimals: 6,
    target: null,
    listed: listedPriceOf(148.57, null, 'SPCXx'),
    company: 'SpaceX',
    issuerFee: FEE,
    solUsd: 150,
    locale: 'uk',
    words: words('uk'),
  })
  assert.equal(give.value, '0,0845 SPACEX')
  assert.equal(get.value, '≈ $9,88 USDC')
  assert.equal(get.sub, 'щонайменше $9,83')
  assert.equal(costs.sub, null, 'USDC’s account is there already: no reserve')
  assert.equal(rate.value, '1 SPACEX → $116,88')
  assert.equal(rate.sub, 'на 21% менше, ніж ціна SpaceX на біржі ($148,57)')
  const unknown = convertReviewRows({
    mode: 'sell',
    order: { ...SALE_ORDER, inUsdValue: null },
    token: { symbol: 'SPACEX', multiplier: 5 },
    giveDecimals: 9,
    getDecimals: null,
    target: null,
    listed: null,
    company: 'SpaceX',
    issuerFee: null,
    solUsd: null,
    locale: 'en',
    words: words('en'),
  })
  assert.equal(unknown[0].sub, null)
  assert.equal(unknown[1].value, '—')
  assert.equal(unknown[2].value, '—')
  assert.equal(unknown[2].fee, null)
  assert.equal(unknown[3].value, '—')
})

test('the rate and its gap: none without both legs; about the same said as such; the sale’s gap is its dollars against a share', () => {
  assert.equal(convertRate({ mode: 'swap', inUnits: null, outUnits: 1, listed: null }), null)
  assert.equal(convertRate({ mode: 'swap', inUnits: 0, outUnits: 1, listed: null }), null)
  const swap = convertRate({
    mode: 'swap',
    inUnits: 0.08453,
    outUnits: 0.0664,
    listed: { usd: 148.57, basis: 'exchange', symbol: 'SPCXx' },
  })
  assert.ok(Math.abs(swap.perToken - 0.78552) < 1e-6)
  assert.ok(Math.abs(swap.gapPct - -21.448) < 1e-2)
  assert.equal(convertRate({ mode: 'swap', inUnits: 1, outUnits: 0.8, listed: null }).gapPct, null)
  const sale = convertRate({
    mode: 'sell',
    inUnits: 1,
    outUnits: 114.67,
    listed: { usd: 148.57, basis: 'exchange', symbol: 'SPCXx' },
  })
  assert.ok(Math.abs(sale.gapPct - -22.818) < 1e-2)
  const listed = { usd: 148.57, basis: 'exchange', symbol: 'SPCXx' }
  assert.equal(gapLine(-0.3, listed, 'SpaceX', 'uk'), '≈ як ціна SpaceX на біржі ($148,57)')
  assert.equal(gapLine(4.26, listed, 'SpaceX', 'en'), '4.3% above SpaceX’s price on the exchange ($148.57)')
  assert.equal(gapLine(null, listed, 'SpaceX', 'en'), null)
  assert.equal(listedPriceOf(0, 0, 'SPCXx'), null)
  assert.deepEqual(listedPriceOf(null, 148.5, 'SPCXx'), { usd: 148.5, basis: 'token', symbol: 'SPCXx' })
  // A sale into dollars names the listed token it is measured against, even with no target of its own.
  assert.equal(
    gapLine(-21.3, { usd: 148.57, basis: 'token', symbol: 'SPCXx' }, 'SpaceX', 'uk'),
    'на 21% менше, ніж ціна SPCXx ($148,57)',
  )
})

test('the issuer’s fee on what leaves the wallet: its share of the input’s value, under the mint’s cap', () => {
  assert.equal(saleIssuerFeeUsd({ fee: FEE, inUsd: 9.89, inAmountRaw: '16906000' }), 0.0989)
  assert.equal(
    saleIssuerFeeUsd({ fee: { basisPoints: 100, maximumFeeRaw: '16906' }, inUsd: 9.89, inAmountRaw: '16906000' }),
    0.00989,
  )
  assert.equal(saleIssuerFeeUsd({ fee: null, inUsd: 9.89, inAmountRaw: '16906000' }), null)
  assert.equal(saleIssuerFeeUsd({ fee: FEE, inUsd: null, inAmountRaw: '16906000' }), null)
})

test('a Review or an attempt is the sheet’s own only when it sells this token into this target', () => {
  const asset = (mint, symbol) => ({ mint, symbol, name: symbol, icon: null, decimals: 9 })
  const context = (mode, pay, receive) => ({
    mode,
    pay,
    receive,
    payDecimals: 9,
    receiveDecimals: 8,
    inAmountRaw: '1',
    outAmountRaw: '1',
    minReceivedRaw: '1',
  })
  const spacex = asset(SPACEX, 'SPACEX')
  assert.equal(isConvert(context('sell', spacex, asset(SPCXX, 'SPCXx')), SPACEX, SPCXX), true)
  assert.equal(isConvert(context('sell', spacex, asset(USDC, 'USDC')), SPACEX, USDC), true)
  assert.equal(isConvert(context('sell', spacex, asset(USDC, 'USDC')), SPACEX, SPCXX), false)
  assert.equal(isConvert(context('buy', asset(USDC, 'USDC'), spacex), SPACEX, SPCXX), false)
  assert.equal(isConvert(null, SPACEX, SPCXX), false)
})

test('the swap’s words exist in both languages and never speak of a purchase', () => {
  for (const locale of ['en', 'uk']) {
    const copy = CONVERT_COPY[locale]
    assert.deepEqual(Object.keys(copy.failures).sort(), Object.keys(BUY_COPY[locale].failures).sort())
    for (const text of Object.values(copy.failures)) assert.doesNotMatch(text, /purchase|buy|купів|купит/i)
    for (const mode of ['swap', 'sell']) {
      assert.ok(copy.title(mode, 'SPACEX').includes('SPACEX'))
      assert.ok(copy.noneHeld(mode, 'SPACEX').includes('SPACEX'))
      assert.doesNotMatch(copy.unknownTx, /buy|купу/i)
    }
  }
  assert.equal(CONVERT_COPY.uk.title('swap', 'SPACEX'), 'Обміняти SPACEX')
  assert.equal(CONVERT_COPY.uk.review('sell'), 'Перевірити продаж')
  assert.equal(CONVERT_COPY.uk.shares[100], 'Усе')
})

test('the sheet’s one button: a held Review, the wallet, the read, none held, the session, the fee, the route, the price — then the Review', () => {
  const base = {
    lockedReview: false,
    connected: true,
    signedIn: true,
    heldRaw: 16906000n,
    decimalsKnown: true,
    preparing: false,
    needsSol: false,
    unavailable: false,
    priced: true,
  }
  assert.deepEqual(convertAction(base), { kind: 'review' })
  assert.deepEqual(convertAction({ ...base, lockedReview: true, connected: false }), { kind: 'release' })
  assert.deepEqual(convertAction({ ...base, connected: false }), { kind: 'connect' })
  assert.deepEqual(convertAction({ ...base, signedIn: false }), { kind: 'sign-in' })
  // A wallet that holds none is told so before any signature is asked for — there is nothing to sign.
  assert.deepEqual(convertAction({ ...base, signedIn: false, heldRaw: 0n }), { kind: 'none' })
  assert.deepEqual(convertAction({ ...base, signedIn: false, heldRaw: null }), { kind: 'reading' })
  assert.deepEqual(convertAction({ ...base, heldRaw: null }), { kind: 'reading' })
  assert.deepEqual(convertAction({ ...base, decimalsKnown: false }), { kind: 'reading' })
  assert.deepEqual(convertAction({ ...base, heldRaw: 0n, needsSol: true }), { kind: 'none' })
  assert.deepEqual(convertAction({ ...base, preparing: true }), { kind: 'preparing' })
  assert.deepEqual(convertAction({ ...base, needsSol: true, unavailable: true }), { kind: 'need-sol' })
  assert.deepEqual(convertAction({ ...base, unavailable: true, priced: false }), { kind: 'unavailable' })
  assert.deepEqual(convertAction({ ...base, priced: false }), { kind: 'pricing' })
})
