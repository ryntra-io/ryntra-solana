import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { SOL_ASSET, USDC_ASSET } from '../trade/trade-model.ts'
import { BUY_COPY } from './buy-copy.ts'
import {
  approxUsd,
  BUY_FAILURE_KEYS,
  BUY_SHARE_PRESETS_PCT,
  buyCosts,
  buyFailureKey,
  buyCheckRows,
  buyEstimate,
  buyOrderRows,
  buyOutcome,
  composeAction,
  DEFAULT_BUY_USD,
  dollarBalanceText,
  dollarsText,
  exchangeState,
  feePercentText,
  formatShareUnits,
  isBuyableSum,
  isCompanyBuy,
  issuerFeeOf,
  MIN_BUY_USD,
  NO_FEE_CAP_RAW,
  offersPayChoice,
  parseDollars,
  payDollar,
  keepTogether,
  recoveryDoor,
  reserveFirstOf,
  ryntraFeeFigures,
  spentText,
  sumText,
  truthLine,
  unitsFromRaw,
  unitsPhrase,
  USDT_ASSET,
} from './buy-model.ts'

const AAPLX = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const APPLE = { mint: AAPLX, symbol: 'AAPLx', name: 'Apple', icon: null, decimals: 8 }

test('the truth is the issuer’s own line: a tracker is never called a share, a private token says so first', () => {
  assert.equal(truthLine('xstocks', 'Apple', 'uk'), 'Токен, що відстежує ціну Apple · забезпечений 1:1 · без голосу')
  assert.equal(truthLine('xstocks', 'Apple', 'en'), 'A token that tracks the price of Apple · backed 1:1 · no vote')
  assert.match(
    truthLine('backpack', 'NVIDIA', 'uk'),
    /^Токен, що відстежує ціну NVIDIA · обмін на акцію через Backpack/,
  )
  assert.match(truthLine('ondo', 'Tesla', 'uk'), /це не акція$/)
  // A private token's line is the web's since the chain states the issuer's fee (2026-09-26): the fee, then the freeze.
  assert.equal(
    truthLine('prestocks', 'OpenAI', 'uk', 300),
    'Це не акція OpenAI · комісія емітента 3% на кожен переказ · емітент може заморозити чи забрати токен',
  )
  assert.equal(
    truthLine('prestocks', 'SpaceX', 'en', 100),
    'Not a share in SpaceX · a 1% issuer fee on every transfer · the issuer can freeze or take away the token',
  )
  assert.equal(
    truthLine('prestocks', 'SpaceX', 'uk'),
    'Це не акція SpaceX · комісія емітента на кожен переказ · емітент може заморозити чи забрати токен',
    'a fee the chain did not state is not a figure',
  )
  assert.equal(
    truthLine('prestocks', 'SpaceX', 'en', 0),
    'Not a share in SpaceX · an issuer fee on every transfer · the issuer can freeze or take away the token',
  )
  assert.equal(truthLine('someone-else', 'Apple', 'uk'), null, 'no document read, no line — never a guess')
  for (const issuer of ['xstocks', 'backpack', 'ondo', 'prestocks']) {
    for (const locale of ['uk', 'en']) {
      // A negation («це не акція») is the truth; the token called a share is not.
      const line = truthLine(issuer, 'Apple', locale).replace(/не акція|not a share/gi, '')
      assert.doesNotMatch(
        line,
        /акція Apple|Apple share|a share of Apple/i,
        `${issuer}/${locale} never names the token a share`,
      )
    }
  }
})

test('the exchange is open in the issuer’s market period and closed outside it; nothing is said without a period or a flag', () => {
  assert.equal(exchangeState({ period: 'market', exchangeOpen: null }), 'open')
  for (const period of ['extended', 'overnight', 'closed'])
    assert.equal(exchangeState({ period, exchangeOpen: true }), 'closed')
  assert.equal(exchangeState({ period: 'unknown', exchangeOpen: true }), 'open')
  assert.equal(exchangeState({ period: 'unknown', exchangeOpen: false }), 'closed')
  assert.equal(exchangeState({ period: 'unknown', exchangeOpen: null }), null)
})

test('a sum of dollars as it is typed: a Ukrainian comma, an English thousands comma, cents and nothing past them', () => {
  // From a dollar, opening on $10, the quick choices shares of the wallet.
  assert.deepEqual([...BUY_SHARE_PRESETS_PCT], [25, 50, 75, 100])
  assert.equal(DEFAULT_BUY_USD, 10)
  assert.equal(MIN_BUY_USD, 1)
  assert.equal(parseDollars('25', 'uk'), 25)
  assert.equal(parseDollars('$25', 'en'), 25)
  assert.equal(parseDollars('25,50', 'uk'), 25.5)
  assert.equal(parseDollars('1 000,50', 'uk'), 1000.5)
  assert.equal(parseDollars(`1${String.fromCharCode(0xa0)}000`, 'uk'), 1000, 'a no-break space groups thousands')
  assert.equal(parseDollars('1,000.50', 'en'), 1000.5)
  assert.equal(parseDollars('1,000', 'en'), 1000)
  assert.equal(parseDollars('25,5', 'en'), 25.5, 'a keypad’s decimal comma in English')
  assert.equal(parseDollars('10.', 'en'), 10, 'a sum being typed')
  assert.equal(parseDollars('1,000', 'uk'), null, 'three places past a Ukrainian comma are not cents')
  assert.equal(parseDollars('25.555', 'en'), null)
  assert.equal(parseDollars('0', 'uk'), null)
  assert.equal(parseDollars('', 'uk'), null)
  assert.equal(parseDollars('abc', 'en'), null)
  assert.equal(isBuyableSum(0.99), false)
  assert.equal(isBuyableSum(1), true)
  assert.equal(isBuyableSum(9.99), true)
  assert.equal(isBuyableSum(1_000_001), false)
  assert.equal(isBuyableSum(null), false)
  assert.equal(sumText(20), '20.00')
  assert.equal(sumText(25.5), '25.50')
  assert.equal(dollarsText(20, 'uk'), '$20')
  assert.equal(dollarsText(25.5, 'uk'), '$25,50')
  assert.equal(dollarsText(25.5, 'en'), '$25.50')
  assert.equal(dollarsText(1000, 'en'), '$1,000')
  assert.match(dollarsText(1000, 'uk'), /^\$1\s000$/)
})

test('what a sum buys: the chain’s raw amount through the scaled-UI multiplier once, in shares or tokens with the Ukrainian plural', () => {
  assert.equal(unitsFromRaw('7870000', 8, 1), 0.0787)
  assert.equal(unitsFromRaw('787000', 8, 1.02), 0.0080274, 'the multiplier applied once')
  assert.equal(unitsFromRaw('787000', 8, null), 0.00787)
  assert.equal(unitsFromRaw('20000000', 6, null), 20)
  assert.equal(unitsFromRaw('1', 8, 1), 0.00000001)
  assert.equal(unitsFromRaw(null, 8, 1), null)
  assert.equal(unitsFromRaw('12a', 8, 1), null)
  assert.equal(unitsFromRaw('7870000', null, 1), null)
  assert.equal(formatShareUnits(0.0787, 'uk'), '0,0787')
  assert.equal(formatShareUnits(0.00001234, 'uk'), '< 0,0001', 'a real but tiny amount is never a zero')
  assert.equal(formatShareUnits(0.12345678, 'en'), '0.1235')
  assert.equal(unitsPhrase(0.0787, 'share', 'Apple', 'uk'), '0,0787 частки Apple')
  assert.equal(unitsPhrase(1, 'share', 'Apple', 'uk'), '1 частка Apple')
  assert.equal(unitsPhrase(2, 'share', 'Apple', 'uk'), '2 частки Apple')
  assert.equal(unitsPhrase(5, 'share', 'Apple', 'uk'), '5 часток Apple')
  assert.equal(unitsPhrase(11, 'share', 'Apple', 'uk'), '11 часток Apple')
  assert.equal(unitsPhrase(21, 'share', 'Apple', 'uk'), '21 частка Apple')
  assert.equal(unitsPhrase(22, 'share', 'Apple', 'uk'), '22 частки Apple')
  assert.equal(unitsPhrase(0.5, 'token', 'OpenAI', 'uk'), '0,5 токена OpenAI')
  assert.equal(unitsPhrase(3, 'token', 'OpenAI', 'uk'), '3 токени OpenAI')
  assert.equal(unitsPhrase(7, 'token', 'OpenAI', 'uk'), '7 токенів OpenAI')
  assert.equal(unitsPhrase(0.0787, 'share', 'Apple', 'en'), '0.0787 of a share')
  assert.equal(unitsPhrase(2, 'share', 'Apple', 'en'), '2 shares')
  assert.equal(unitsPhrase(1, 'token', 'OpenAI', 'en'), '1 token')
})

const COST = {
  spendUsd: 20,
  inUsdValue: '20.00',
  outUsdValue: '19.95',
  totalFeeBasisPoints: 20,
  priceImpactPct: '0.001',
  signatureFeeLamports: '5000',
  priorityFeeLamports: '40075',
  rentFeeLamports: '2039280',
  solUsd: 200,
}

test('«Усі витрати»: the route’s own dollar difference, never below the stated fees, plus the network fee at SOL’s price; the account reserve apart', () => {
  const costs = buyCosts(COST)
  assert.ok(Math.abs(costs.totalUsd - (0.05 + 0.009015)) < 1e-9, 'the route’s difference and the network’s fee')
  assert.ok(Math.abs(costs.accountUsd - 0.407856) < 1e-9)
  assert.equal(approxUsd(costs.totalUsd, 'uk'), '≈ $0,06')
  assert.equal(approxUsd(costs.totalUsd, 'en'), '≈ $0.06')
  const favourable = buyCosts({ ...COST, outUsdValue: '20.10', rentFeeLamports: '0' })
  assert.ok(
    Math.abs(favourable.totalUsd - (0.0402 + 0.009015)) < 1e-9,
    'a price that moved in the person’s favour is not a negative cost',
  )
  assert.equal(favourable.accountUsd, null, 'no account opened, no reserve said')
  const bare = buyCosts({
    ...COST,
    inUsdValue: null,
    outUsdValue: null,
    signatureFeeLamports: '0',
    priorityFeeLamports: '0',
  })
  assert.ok(Math.abs(bare.totalUsd - (0.0402 + 0.001)) < 1e-9, 'the stated fees and the least a signature costs')
  assert.equal(buyCosts({ ...COST, solUsd: null }), null, 'without SOL’s price the figure is unknown, never smaller')
  assert.equal(approxUsd(0.004, 'uk'), '< $0,01')
})

const ROW_WORDS = BUY_COPY.uk

/* The server's own «Перевірка» of Apple bought for $10 — the contract's example, built by the server's builder
   (docs/api/examples/v1/swap-check-buy.json at contract 1.20.0). */
const APPLE_CHECK = {
  side: 'buy',
  basis: 'order',
  company: {
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    symbol: 'AAPLx',
    name: 'Apple',
    issuer: 'xstocks',
    unit: 'share',
    privateCompany: false,
    decimals: 8,
    multiplier: 1.0118,
  },
  spend: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 10, usd: 10 },
  get: {
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    unit: 'share',
    amount: 0.04313729,
    atLeast: 0.04270592,
    usd: 9.9612,
  },
  costs: { usd: 0.047778371999999646, issuerFee: null },
  reserve: { lamports: '2074080', usd: 0.44219385599999994, first: false },
  what: {
    truth: {
      en: 'A token that tracks the price of Apple · backed 1:1 · no vote',
      uk: 'Токен, що відстежує ціну Apple · забезпечений 1:1 · без голосу',
    },
    note: null,
    caution: false,
  },
  sol: { usd: 213.2, observedAt: '2026-09-27T12:00:00.000Z' },
}

test('«Перевірка» is exactly four rows — Спишеться · Отримаєш · Усі витрати · Що це — drawn from the server’s check', () => {
  const rows = buyCheckRows(APPLE_CHECK, { unit: 'share', company: 'Apple', locale: 'uk', words: ROW_WORDS })
  assert.deepEqual(
    rows.map((row) => row.key),
    ['spend', 'get', 'costs', 'what'],
  )
  assert.deepEqual(rows[0], { key: 'spend', value: '$10,00', fee: null, sub: 'USDC', caution: false })
  assert.deepEqual(rows[1], {
    key: 'get',
    value: '≈ 0,0431 частки Apple',
    fee: null,
    sub: 'щонайменше 0,0427',
    caution: false,
  })
  assert.equal(rows[2].value, '≈ $0,05', 'the server’s figure, as the web prints it')
  assert.equal(rows[2].fee, null, 'a token its issuer charges nothing to move has no fee line')
  // The reserve is a line of its own under «Усі витрати», never joined to the costs.
  assert.equal(rows[2].sub, '≈ $0,44 у SOL разово лишаються в гаманці на рахунку токена')
  assert.deepEqual(rows[3], {
    key: 'what',
    value: 'Токен, що відстежує ціну Apple · забезпечений 1:1 · без голосу',
    fee: null,
    sub: null,
    caution: false,
  })
  const english = buyCheckRows(APPLE_CHECK, { unit: 'share', company: 'Apple', locale: 'en', words: BUY_COPY.en })
  assert.equal(english[0].value, '$10.00')
  assert.equal(english[1].value, '≈ 0.0431 of a share')
  assert.equal(english[2].value, '≈ $0.05')
  assert.equal(english[3].value, APPLE_CHECK.what.truth.en)
  // The quote's check carries no reserve, and a figure the server could not count is a dash — never one counted here.
  const quoted = buyCheckRows(
    { ...APPLE_CHECK, basis: 'quote', costs: null, reserve: null, get: { ...APPLE_CHECK.get, atLeast: null } },
    { unit: 'share', company: 'Apple', locale: 'uk', words: ROW_WORDS },
  )
  assert.equal(quoted[2].value, '—', 'no SOL price on the server, no cost figure')
  assert.equal(quoted[2].sub, null, 'no reserve on a quote')
  assert.equal(quoted[1].sub, null)
})

test('a PreStocks purchase reviews with the issuer’s 1% inside «Усі витрати» and the event said to a buyer, as the server counts them', () => {
  const check = {
    ...APPLE_CHECK,
    company: { ...APPLE_CHECK.company, issuer: 'prestocks', unit: 'token', privateCompany: true, name: 'OpenAI' },
    get: { ...APPLE_CHECK.get, unit: 'token', amount: 0.00727215, atLeast: 0.00727215 },
    costs: { usd: 0.2534, issuerFee: { basisPoints: 100, usd: 0.0985 } },
    what: {
      truth: { en: 'A private company', uk: 'Приватна компанія' },
      note: { kind: 'issuer-event', en: 'Swap it by 12 March 2027.', uk: 'Обміняй до 12 березня 2027.' },
      caution: true,
    },
  }
  const rows = buyCheckRows(check, { unit: 'token', company: 'OpenAI', locale: 'uk', words: ROW_WORDS })
  assert.equal(rows.length, 4, 'still exactly four rows')
  assert.equal(rows[1].value, '≈ 0,0073 токена OpenAI')
  assert.equal(rows[2].value, '≈ $0,25')
  assert.equal(rows[2].fee, 'з них комісія емітента 1% ≈ $0,10', '«1% ≈ $0,10» kept on one line')
  assert.deepEqual(rows[3], {
    key: 'what',
    value: 'Приватна компанія',
    fee: null,
    sub: 'Обміняй до 12 березня 2027.',
    caution: true,
  })
  const english = buyCheckRows(check, { unit: 'token', company: 'OpenAI', locale: 'en', words: BUY_COPY.en })
  assert.equal(english[1].value, '≈ 0.0073 of a token')
  assert.equal(english[2].fee, 'including the issuer’s 1% fee ≈ $0.10')
  assert.equal(english[3].sub, 'Swap it by 12 March 2027.')
  // A sale's caution is never said to a buyer.
  const sale = buyCheckRows(
    { ...check, what: { ...check.what, note: { kind: 'sale-may-fail', en: 'x', uk: 'x' } } },
    { unit: 'token', company: 'OpenAI', locale: 'uk', words: ROW_WORDS },
  )
  assert.equal(sale[3].sub, null)
})

test('the account’s reserve is said first only when the server judged it more than the purchase', () => {
  assert.equal(reserveFirstOf(null), null)
  assert.equal(reserveFirstOf(APPLE_CHECK), null, 'a reserve under the purchase is a line under «Усі витрати» only')
  assert.deepEqual(
    reserveFirstOf({
      ...APPLE_CHECK,
      spend: { ...APPLE_CHECK.spend, amount: 1 },
      reserve: { lamports: '9000000', usd: 1.92, first: true },
    }),
    { reserveUsd: 1.92, spendUsd: 1 },
  )
  assert.equal(reserveFirstOf({ ...APPLE_CHECK, reserve: { lamports: '9000000', usd: null, first: true } }), null)
  assert.equal(reserveFirstOf({ ...APPLE_CHECK, reserve: null }), null)
})

test('an order the server did not count — paid in USDT — says what leaves and arrives as the order states it, and the costs as a dash', () => {
  const order = {
    inAmountRaw: '20000000',
    outAmountRaw: '7870000',
    minReceivedRaw: '7830000',
    inUsdValue: '20.00',
    outUsdValue: '19.95',
    totalFeeBasisPoints: 20,
    priceImpactPct: '0.001',
    signatureFeeLamports: '5000',
    priorityFeeLamports: '40075',
    rentFeeLamports: '2039280',
  }
  const truth = truthLine('xstocks', 'Apple', 'uk')
  const rows = buyOrderRows({
    order,
    pay: USDT_ASSET,
    payDecimals: 6,
    receiveDecimals: 8,
    multiplier: 1,
    unit: 'share',
    company: 'Apple',
    truth,
    preIpo: false,
    locale: 'uk',
    words: ROW_WORDS,
  })
  assert.deepEqual(rows[0], { key: 'spend', value: '$20,00', fee: null, sub: 'USDT', caution: false })
  assert.equal(rows[1].value, '≈ 0,0787 частки Apple')
  assert.deepEqual(rows[2], { key: 'costs', value: '—', fee: null, sub: null, caution: false })
  assert.deepEqual(rows[3], { key: 'what', value: truth, fee: null, sub: null, caution: false })
  const unknown = buyOrderRows({
    order,
    pay: USDT_ASSET,
    payDecimals: 6,
    receiveDecimals: null,
    multiplier: 1,
    unit: 'token',
    company: 'OpenAI',
    truth: null,
    preIpo: true,
    eventLine: 'event',
    locale: 'uk',
    words: ROW_WORDS,
  })
  assert.equal(unknown[1].value, '—', 'no decimals, no figure')
  assert.equal(unknown[3].value, ROW_WORDS.truthUnknown)
  assert.equal(unknown[3].sub, 'event')
  assert.equal(unknown[3].caution, true)
})

test('the issuer’s fee: none when the mint charges none, its per cent as read', () => {
  assert.equal(issuerFeeOf(null), null)
  assert.equal(issuerFeeOf({ basisPoints: 0, maximumFeeRaw: NO_FEE_CAP_RAW, configUsed: 'NEWER' }), null)
  assert.deepEqual(issuerFeeOf({ basisPoints: 100, maximumFeeRaw: NO_FEE_CAP_RAW, configUsed: 'NEWER' }), {
    basisPoints: 100,
    maximumFeeRaw: NO_FEE_CAP_RAW,
  })
  assert.equal(feePercentText(100, 'uk'), '1%')
  assert.equal(feePercentText(50, 'uk'), '0,5%')
  assert.equal(feePercentText(20, 'en'), '0.2%')
  // The issuer's event swap still counts its own costs, as the web's issuer-event sheet does: never below the stated fees.
  const floor = buyCosts({ ...COST, inUsdValue: null, outUsdValue: null, issuerFeeBps: 100 })
  assert.ok(Math.abs(floor.totalUsd - (0.24 + 0.0002 + 0.009015)) < 1e-9)
})

const CONTEXT = {
  mode: 'buy',
  pay: USDC_ASSET,
  receive: APPLE,
  payDecimals: 6,
  receiveDecimals: 8,
  inAmountRaw: '20000000',
  outAmountRaw: '7870000',
  minReceivedRaw: '7830000',
}

test('the answer after a signature in the purchase’s words: a fill with the chain’s figures, pending, nothing moved, rejected', () => {
  const filled = buyOutcome(
    {
      state: 'MATCHED',
      signature: 'sig',
      observation: { actualInputRaw: '20000000', actualOutputRaw: '7868000' },
      facts: { reconciliation: { state: 'MATCHED', minimumMet: true, deviations: [] } },
      receipt: {},
    },
    CONTEXT,
  )
  assert.deepEqual(filled, {
    kind: 'filled',
    spentRaw: '20000000',
    gotRaw: '7868000',
    fromReview: false,
    belowMinimum: false,
  })
  const receipted = buyOutcome(
    {
      state: 'ALREADY_RECEIPTED',
      signature: 'sig',
      observation: null,
      facts: null,
      receipt: {
        outcome: {
          status: 'MATCHED',
          observedEffects: [
            {
              description: `Swap 20000000 raw of EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v for 7866000 raw of ${AAPLX} (quoted 7870000, minimum 7830000).`,
            },
          ],
        },
      },
    },
    CONTEXT,
  )
  assert.equal(receipted.kind, 'filled')
  assert.equal(receipted.gotRaw, '7866000', 'the chain’s figure out of the receipt')
  assert.equal(receipted.fromReview, false)
  const bare = buyOutcome(
    { state: 'RECOVERED', signature: 'sig', observation: null, facts: null, receipt: null },
    CONTEXT,
  )
  assert.equal(bare.fromReview, true, 'a Review figure is never passed off as the chain’s')
  assert.equal(bare.gotRaw, '7870000')
  const below = buyOutcome(
    {
      state: 'DEVIATION_RECORDED',
      signature: 'sig',
      observation: { actualInputRaw: '20000000', actualOutputRaw: '7800000' },
      facts: { reconciliation: { state: 'DEVIATION_RECORDED', minimumMet: false, deviations: ['BELOW_MINIMUM'] } },
      receipt: {},
    },
    CONTEXT,
  )
  assert.equal(below.belowMinimum, true)
  for (const state of ['UNKNOWN', 'RECOVERY', 'SUBMITTED_UNKNOWN', 'PENDING']) {
    assert.deepEqual(buyOutcome({ state, signature: 's', observation: null, facts: null, receipt: null }, CONTEXT), {
      kind: 'pending',
    })
  }
  for (const state of ['EXPIRED_BEFORE_SUBMIT', 'UNKNOWN_TO_CHAIN', 'EXPIRED_AFTER_SUBMIT']) {
    assert.deepEqual(buyOutcome({ state, signature: 's', observation: null, facts: null, receipt: null }, CONTEXT), {
      kind: 'nothing',
    })
  }
  assert.deepEqual(
    buyOutcome({ state: 'FAILED', signature: 's', observation: null, facts: null, receipt: null }, CONTEXT),
    {
      kind: 'not-filled',
    },
  )
})

test('the sheet’s own purchase is this company bought with dollars; what left the wallet is said in dollars', () => {
  assert.equal(isCompanyBuy(CONTEXT, AAPLX), true)
  assert.equal(isCompanyBuy({ ...CONTEXT, pay: USDT_ASSET }, AAPLX), true)
  assert.equal(isCompanyBuy(CONTEXT, 'So11111111111111111111111111111111111111112'), false)
  assert.equal(isCompanyBuy({ ...CONTEXT, mode: 'sell' }, AAPLX), false)
  assert.equal(isCompanyBuy({ ...CONTEXT, pay: SOL_ASSET }, AAPLX), false)
  assert.equal(isCompanyBuy(null, AAPLX), false)
  assert.equal(spentText('20000000', USDC_ASSET, 6, 'uk'), '$20')
  assert.equal(spentText('19990000', USDC_ASSET, 6, 'uk'), '$19,99')
  assert.equal(spentText('120000000', SOL_ASSET, 9, 'uk'), '0,12 SOL')
  assert.equal(spentText(null, USDC_ASSET, 6, 'uk'), null)
})

test('which dollars pay: the person’s pick, else USDC unless the wallet is known to hold none and holds USDT; the choice only where there is one', () => {
  assert.equal(payDollar({ picked: null, usdcRaw: 5_000_000n, usdtRaw: 0n }), 'USDC')
  assert.equal(payDollar({ picked: null, usdcRaw: 0n, usdtRaw: 30_000_000n }), 'USDT')
  assert.equal(
    payDollar({ picked: null, usdcRaw: null, usdtRaw: 30_000_000n }),
    'USDC',
    'a balance not read is not a zero',
  )
  assert.equal(payDollar({ picked: 'USDT', usdcRaw: 5_000_000n, usdtRaw: 1n }), 'USDT')
  assert.equal(offersPayChoice(1n), true)
  assert.equal(offersPayChoice(0n), false)
  assert.equal(offersPayChoice(null), false)
})

test('every refusal has its sentence, in both languages, and the codes land where the person can act on them', () => {
  const expect = {
    WALLET_REFUSED: 'walletDeclined',
    WALLET_NOT_FOUND: 'noWallet',
    WALLET_TIMEOUT: 'walletTimeout',
    WALLET_FAILED: 'walletFailed',
    REVIEW_CLOSED_UNDER_WALLET: 'closedUnderWallet',
    SIGNATURE_UNREADABLE: 'signatureUnreadable',
    SWAP_PAUSED: 'paused',
    ASSET_NOT_OFFERED: 'notOffered',
    PROOF_NOT_SIGNED: 'notSetUp',
    BLOCKHASH_STILL_VALID: 'previousStillValid',
    OWNER_SWAP_LOCKED: 'reviewOpen',
    ATTEMPT_OPEN: 'checkPrevious',
    POLICY_BLOCKED: 'notPassed',
    SIMULATION_FAILED: 'routeFailed',
    EFFECTS_NOT_VERIFIED: 'routeFailed',
    ORDER_BUILD_FAILED: 'buildFailed',
    ORDER_UNREACHABLE: 'providerDown',
    SESSION_EXPIRED: 'signIn',
    WALLET_MISMATCH: 'otherWallet',
    REVIEWED_BYTES_MISMATCH: 'bytesChanged',
    HTTP_504: 'tooLong',
    NETWORK: 'offline',
    NO_ROUTE: 'noRoute',
    INSUFFICIENT_BALANCE: 'notEnough',
    RATE_LIMITED: 'rateLimited',
    ORDER_EXPIRED: 'priceExpired',
    ORDER_TOO_SHORT: 'priceExpired',
    REVIEW_INVALIDATED: 'priceExpired',
    INVALID_AMOUNT: 'amount',
    VALIDATION_ERROR: 'notAccepted',
    // The order route's word on an autoinvest reminder.
    RULE_NOT_DUE: 'ruleClosed',
    RULE_NOT_FOUND: 'ruleGone',
    RULE_MISMATCH: 'ruleMismatch',
    RULE_BUDGET_EXHAUSTED: 'ruleBudget',
    SOMETHING_NEW: 'failed',
  }
  for (const [code, key] of Object.entries(expect)) assert.equal(buyFailureKey(code), key, code)
  for (const locale of ['uk', 'en']) {
    for (const key of BUY_FAILURE_KEYS) {
      const sentence = BUY_COPY[locale].failures[key]
      assert.ok(typeof sentence === 'string' && sentence.length > 0, `${locale}/${key}`)
      if (locale === 'uk') assert.match(sentence, /[А-ЯҐЄІЇа-яґєії]/, `${key} speaks Ukrainian`)
    }
  }
})

test('the sheet’s one action follows what stands between the person and a Review; only «buy» asks for one', () => {
  const ready = {
    connected: true,
    signedIn: true,
    amountUsd: 20,
    lockedReview: false,
    preparing: false,
    priced: true,
    needsSol: false,
    insufficient: false,
    unavailable: false,
  }
  assert.deepEqual(composeAction(ready), { kind: 'buy', usd: 20 })
  assert.deepEqual(composeAction({ ...ready, lockedReview: true, connected: false }), { kind: 'release' })
  assert.deepEqual(composeAction({ ...ready, connected: false, signedIn: false }), { kind: 'connect' })
  assert.deepEqual(composeAction({ ...ready, signedIn: false }), { kind: 'sign-in' })
  assert.deepEqual(composeAction({ ...ready, amountUsd: 0.5 }), { kind: 'minimum' })
  assert.deepEqual(composeAction({ ...ready, amountUsd: 1 }), { kind: 'buy', usd: 1 }, 'a dollar is a purchase')
  assert.deepEqual(composeAction({ ...ready, amountUsd: null }), { kind: 'enter' })
  // No route for the sum: the company's own minimum put in with one tap, never a dead button.
  const found = { state: 'found', minimumUsd: 5 }
  assert.deepEqual(composeAction({ ...ready, amountUsd: 1, route: found }), { kind: 'use-minimum', usd: 5 })
  assert.deepEqual(
    composeAction({ ...ready, amountUsd: 1, route: found, insufficient: true, needsSol: true }),
    { kind: 'use-minimum', usd: 5 },
    'the sum is settled before the wallet is asked to hold it',
  )
  assert.deepEqual(composeAction({ ...ready, connected: false, route: found }), { kind: 'connect' })
  assert.deepEqual(composeAction({ ...ready, amountUsd: 1, route: { state: 'finding' } }), {
    kind: 'finding-minimum',
    usd: 1,
  })
  assert.deepEqual(composeAction({ ...ready, amountUsd: 1, route: { state: 'none' } }), { kind: 'unavailable' })
  assert.deepEqual(composeAction({ ...ready, route: { state: 'idle' } }), { kind: 'buy', usd: 20 })
  assert.deepEqual(composeAction({ ...ready, preparing: true, needsSol: true }), { kind: 'preparing' })
  assert.deepEqual(composeAction({ ...ready, needsSol: true, insufficient: true }), { kind: 'need-sol' })
  assert.deepEqual(composeAction({ ...ready, insufficient: true }), { kind: 'not-enough' })
  assert.deepEqual(composeAction({ ...ready, unavailable: true }), { kind: 'unavailable' })
  assert.deepEqual(composeAction({ ...ready, priced: false }), { kind: 'settling', usd: 20 })
})

test('nothing on the purchase offers what does not work yet, and the wallet’s vault is never named', () => {
  // The loss limit is not on the phone yet; «Автоінвест» and «Купувати щотижня» are.
  const forbidden = /Seed Vault|межу збитку|loss limit/i
  const texts = []
  for (const locale of ['uk', 'en']) {
    const copy = BUY_COPY[locale]
    for (const value of Object.values(copy)) {
      if (typeof value === 'string') texts.push(value)
      else if (typeof value === 'function') texts.push(value('Apple'))
      else texts.push(...Object.values(value))
    }
  }
  for (const text of texts) assert.doesNotMatch(text, forbidden, text)
  // What the sheet draws, not what its comments explain: no door to a later row, no vault's name.
  const sheet = readFileSync(new URL('../../screens/invest/buy-sheet.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(sheet, /Seed Vault|lossLimit|loss limit/i)
  // The receipt names the rule a purchase was made under and offers «Купувати щотижня» after a plain one.
  assert.match(sheet, /ruleMark\.words\.byRule/)
  assert.match(sheet, /ruleWords\.buyWeekly/)
})

test('a balance is said in the cents it holds', () => {
  assert.equal(dollarBalanceText(13.7196, 'uk'), '13,71', 'never more than it holds')
  assert.equal(dollarBalanceText(13.7196, 'en'), '13.71')
  assert.equal(dollarBalanceText(0, 'uk'), '0,00')
  assert.match(dollarBalanceText(1234.5, 'uk'), /^1\s234,50$/)
})

test('a signature to check opens where it was made: a company bought with dollars on its page, anything else in Trade', () => {
  const company = (mint) => mint === AAPLX
  assert.deepEqual(recoveryDoor(CONTEXT, company), { kind: 'company', mint: AAPLX, symbol: 'AAPLx' })
  assert.deepEqual(recoveryDoor({ ...CONTEXT, pay: USDT_ASSET }, company), {
    kind: 'company',
    mint: AAPLX,
    symbol: 'AAPLx',
  })
  assert.deepEqual(
    recoveryDoor({ ...CONTEXT, pay: SOL_ASSET }, company),
    { kind: 'trade' },
    'a purchase with SOL is Trade’s',
  )
  assert.deepEqual(recoveryDoor({ ...CONTEXT, mode: 'sell' }, company), { kind: 'trade' })
  assert.deepEqual(
    recoveryDoor(CONTEXT, () => false),
    { kind: 'trade' },
    'a token the shelf does not name is Trade’s',
  )
  assert.deepEqual(recoveryDoor(null, company), { kind: 'trade' }, 'a signature this phone never made')
})

const NB = String.fromCharCode(0xa0)
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_MINT = 'So11111111111111111111111111111111111111112'

test('Ryntra’s fee inside «Усі витрати» in the web’s words: the rate, the amount of the side it is taken from, a dollar anchor for SOL', () => {
  const order = {
    inputMint: USDC_MINT,
    outputMint: AAPLX,
    inAmountRaw: '10000000',
    outAmountRaw: '2980006',
    inUsdValue: '10.00',
    outUsdValue: '9.95',
    ryntraFee: { mechanism: 'JUPITER_REFERRAL', state: 'QUOTED', basisPoints: 50, requestedBasisPoints: 50, asset: USDC_MINT, symbol: null, decimals: null, amountRaw: null, usd: null },
  }
  assert.equal(ryntraFeeFigures(order, 'uk'), `0,50%${NB}· ≈${NB}0,05${NB}USDC`)
  assert.equal(ryntraFeeFigures(order, 'en'), `0.50%${NB}· ≈${NB}0.05${NB}USDC`)
  // /build states the input side's fee exactly before the signature: no «≈».
  const exact = { ...order, ryntraFee: { ...order.ryntraFee, mechanism: 'JUPITER_PLATFORM_FEE', basisPoints: 25, amountRaw: '25000', decimals: 6 } }
  assert.equal(ryntraFeeFigures(exact, 'en'), `0.25%${NB}· 0.025${NB}USDC`)
  // A fee in SOL carries its dollars from the order's own value of that side.
  const sol = { ...order, inputMint: SOL_MINT, inAmountRaw: '100000000', inUsdValue: '20.00', ryntraFee: { ...order.ryntraFee, asset: SOL_MINT, basisPoints: 10 } }
  assert.equal(ryntraFeeFigures(sol, 'en'), `0.10%${NB}· ≈${NB}0.0001${NB}SOL (≈${NB}$0.02)`)
  // The company's own token: no scale the phone knows — the rate alone, as the web says it.
  const output = { ...order, ryntraFee: { ...order.ryntraFee, asset: AAPLX } }
  assert.equal(ryntraFeeFigures(output, 'uk'), '0,50%')
  assert.equal(ryntraFeeFigures({ ...order, ryntraFee: { ...order.ryntraFee, basisPoints: 0 } }, 'uk'), null, 'no fee, no line')
  assert.equal(ryntraFeeFigures(null, 'uk'), null)
  // Said beside the issuer's, each on its own line.
  const rows = buyCheckRows(
    { ...APPLE_CHECK, costs: { usd: 0.35, issuerFee: { basisPoints: 100, usd: 0.0985 } } },
    { unit: 'share', company: 'Apple', locale: 'uk', words: ROW_WORDS, ryntraFee: ryntraFeeFigures(order, 'uk') },
  )
  assert.equal(rows[2].fee, `з них комісія емітента 1% ≈${NB}$0,10\nз них комісія Ryntra${NB}0,50%${NB}· ≈${NB}0,05${NB}USDC`)
})

test('an order the server did not count still says the fees the mint and the order state — the issuer’s per cent, Ryntra’s', () => {
  const rows = buyOrderRows({
    order: { inAmountRaw: '10000000', outAmountRaw: '4893336', minReceivedRaw: '4893336' },
    pay: USDT_ASSET,
    payDecimals: 6,
    receiveDecimals: 9,
    multiplier: 1.4861347,
    unit: 'token',
    company: 'OpenAI',
    truth: null,
    preIpo: true,
    issuerFee: { basisPoints: 100, maximumFeeRaw: NO_FEE_CAP_RAW },
    ryntraFee: '0,50%',
    locale: 'uk',
    words: ROW_WORDS,
  })
  assert.equal(rows[2].value, '—', 'the costs are the server’s count alone')
  assert.equal(rows[2].fee, `з них комісія емітента 1%\nз них комісія Ryntra${NB}0,50%`)
})

test('the estimate under the sum is the quote’s check; without one, what arrives as the order states it and no costs', () => {
  const company = { mint: AAPLX, decimals: 8, multiplier: 1 }
  assert.equal(buyEstimate(null, company), null)
  assert.deepEqual(buyEstimate({ order: { outAmountRaw: '1' }, decimals: {}, check: APPLE_CHECK }, company), {
    units: 0.04313729,
    costsUsd: 0.047778371999999646,
  })
  assert.deepEqual(
    buyEstimate({ order: { outAmountRaw: '1' }, decimals: {}, check: { ...APPLE_CHECK, costs: null } }, company),
    { units: 0.04313729, costsUsd: null },
    'a cost the server could not count stays unknown',
  )
  assert.deepEqual(buyEstimate({ order: { outAmountRaw: '2980006' }, decimals: { [AAPLX]: 8 }, check: null }, company), {
    units: 0.02980006,
    costsUsd: null,
  })
  assert.deepEqual(buyEstimate({ order: { outAmountRaw: '2980006' }, decimals: {}, check: null }, { ...company, decimals: null }), {
    units: null,
    costsUsd: null,
  })
})

test('«≈» and «<» never end a line apart from their figure', () => {
  assert.equal(keepTogether('≈ $0,07'), `≈${NB}$0,07`)
  assert.equal(keepTogether('< $0,01'), `<${NB}$0,01`)
  assert.equal(keepTogether('$0,07'), '$0,07')
})
