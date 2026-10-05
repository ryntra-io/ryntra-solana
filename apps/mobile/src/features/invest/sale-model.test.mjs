import assert from 'node:assert/strict'
import { test } from 'node:test'

import { USDC_ASSET } from '../trade/trade-model.ts'
import { BUY_COPY } from './buy-copy.ts'
import {
  DEFAULT_SALE_USD,
  heldUnitsText,
  isCompanySale,
  isOverPosition,
  isWholePosition,
  MIN_SALE_USD,
  openingSaleUsd,
  positionUsd,
  rawForUsd,
  saleAction,
  saleAmountText,
  saleCheckRows,
  saleOrderRows,
  saleShareRaw,
  saleShares,
  shareUsd,
} from './sale-model.ts'

const APPLE = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const words = (locale) => {
  const w = BUY_COPY[locale]
  return {
    atLeast: w.atLeast,
    reserve: w.reserve,
    issuerFee: w.issuerFee,
    ryntraFee: w.ryntraFee,
    truthUnknown: w.truthUnknown,
    mayFail: locale === 'uk' ? 'Продати може не вийти.' : 'Selling may not be possible.',
  }
}

test('the web’s sums: from $1, opening on $10 only for a position worth that much', () => {
  assert.equal(MIN_SALE_USD, 1)
  assert.equal(DEFAULT_SALE_USD, 10)
  assert.equal(openingSaleUsd(10), 10)
  assert.equal(openingSaleUsd(250.4), 10)
  assert.equal(openingSaleUsd(9.99), null)
  assert.equal(openingSaleUsd(null), null)
})

test('a position is worth its shown units at the price — the multiplier applied once', () => {
  // 8 decimals, 0.05 shown unit at $250 = $12.50
  assert.equal(positionUsd(5_000_000n, 8, null, 250), 12.5)
  // ×5: 1 raw token unit shows as 5
  assert.equal(positionUsd(100_000_000n, 8, 5, 2), 10)
  assert.equal(positionUsd(5_000_000n, 8, null, null), null)
  assert.equal(positionUsd(null, 8, null, 250), null)
})

test('a share of the position is raw and floored; 100 % is exactly what the wallet holds', () => {
  assert.equal(saleShareRaw(1_000_003n, 25), 250_000n)
  assert.equal(saleShareRaw(1_000_003n, 50), 500_001n)
  assert.equal(saleShareRaw(1_000_003n, 100), 1_000_003n)
  assert.equal(saleShareRaw(0n, 100), 0n)
  assert.equal(saleShareRaw(10n, 0), 0n)
})

test('a sum in dollars becomes raw units at the price, never more than is held; the whole position exactly', () => {
  const held = 5_000_000n // 0.05 at $250 = $12.50
  assert.equal(rawForUsd(10, held, 8, null, 250), 4_000_000n)
  assert.equal(rawForUsd(12.5, held, 8, null, 250), held)
  assert.equal(rawForUsd(12.496, held, 8, null, 250), held, 'within half a cent is the whole position')
  assert.equal(rawForUsd(20, held, 8, null, 250), held, 'never more than is held')
  assert.equal(rawForUsd(1, 100_000_000n, 8, 5, 2), 10_000_000n, 'through the multiplier')
  assert.equal(rawForUsd(0, held, 8, null, 250), null)
  assert.equal(rawForUsd(10, held, 8, null, null), null)
  assert.equal(rawForUsd(10, null, 8, null, 250), null)
  assert.equal(rawForUsd(10, held, null, null, 250), null)
})

test('whole and over the position, within half a cent', () => {
  assert.equal(isWholePosition(12.5, 12.5), true)
  assert.equal(isWholePosition(12.49, 12.5), false)
  assert.equal(isOverPosition(12.51, 12.5), true)
  assert.equal(isOverPosition(12.504, 12.5), false)
})

test('the quick shares: a part under $1 drawn but not offered; the whole position always offered', () => {
  const small = saleShares(1_000_000n, 8, null, 250) // $2.50
  assert.deepEqual(
    small.map((s) => [s.pct, s.usd, s.offered]),
    [
      [25, 0.62, false],
      [50, 1.25, true],
      [75, 1.87, true],
      [100, 2.5, true],
    ],
  )
  assert.deepEqual(saleShares(0n, 8, null, 250), [])
  assert.deepEqual(saleShares(null, 8, null, 250), [])
  assert.equal(shareUsd(1_000_000n, 8, null, 250, 100), 2.5)
})

test('the amount Trade takes reads back to the same raw', () => {
  assert.equal(saleAmountText(5_000_000n, 8), '0.05')
  assert.equal(saleAmountText(1_000_003n, 8), '0.01000003')
  assert.equal(saleAmountText(120n, 0), '120')
  assert.equal(saleAmountText(0n, 8), '')
  assert.equal(saleAmountText(5n, null), '')
})

const base = {
  lockedReview: false,
  connected: true,
  signedIn: true,
  heldRaw: 5_000_000n,
  companyRead: true,
  sellable: true,
  valueUsd: 12.5,
  amountUsd: 10,
  pickedPct: null,
  preparing: false,
  needsSol: false,
  unavailable: false,
  priced: true,
}

test('the one action, in the web’s order', () => {
  assert.deepEqual(saleAction({ ...base, lockedReview: true }), { kind: 'release' })
  assert.deepEqual(saleAction({ ...base, connected: false }), { kind: 'connect' })
  assert.deepEqual(saleAction({ ...base, signedIn: false }), { kind: 'sign-in' })
  assert.deepEqual(saleAction({ ...base, heldRaw: null }), { kind: 'reading' })
  assert.deepEqual(saleAction({ ...base, companyRead: false }), { kind: 'reading' })
  assert.deepEqual(saleAction({ ...base, heldRaw: 0n }), { kind: 'none' })
  assert.deepEqual(saleAction({ ...base, sellable: false }), { kind: 'unavailable' })
  assert.deepEqual(saleAction({ ...base, amountUsd: 20 }), { kind: 'sell-all', usd: 12.5 })
  assert.deepEqual(saleAction({ ...base, amountUsd: null }), { kind: 'enter' })
  assert.deepEqual(saleAction({ ...base, amountUsd: 0.5 }), { kind: 'minimum' })
  assert.deepEqual(saleAction({ ...base, preparing: true }), { kind: 'preparing' })
  assert.deepEqual(saleAction({ ...base, needsSol: true }), { kind: 'need-sol' })
  assert.deepEqual(saleAction({ ...base, unavailable: true }), { kind: 'unavailable' })
  assert.deepEqual(saleAction({ ...base, priced: false }), { kind: 'settling', usd: 10, whole: false })
  assert.deepEqual(saleAction(base), { kind: 'sell', usd: 10, whole: false })
})

test('the whole position may be less than $1, and 100 % sells it whatever the field says', () => {
  const tiny = { ...base, valueUsd: 0.4, amountUsd: 0.4 }
  assert.deepEqual(saleAction(tiny), { kind: 'sell', usd: 0.4, whole: true })
  assert.deepEqual(saleAction({ ...base, pickedPct: 100, amountUsd: 12.49 }), { kind: 'sell', usd: 12.5, whole: true })
})

const check = {
  side: 'sell',
  basis: 'order',
  company: {
    mint: APPLE,
    symbol: 'AAPLx',
    name: 'Apple',
    issuer: 'xstocks',
    unit: 'share',
    privateCompany: false,
    decimals: 8,
    multiplier: 1,
  },
  spend: { mint: APPLE, unit: 'share', amount: 0.0787, usd: 10.01 },
  get: { mint: USDC_ASSET.mint, unit: 'usdc', amount: 9.97, atLeast: 9.92, usd: 9.97 },
  costs: { usd: 0.04, issuerFee: null },
  reserve: null,
  what: {
    truth: { en: 'A tokenised Apple share: …', uk: 'Токенізована акція Apple: …' },
    note: null,
    caution: false,
  },
  sol: { usd: 150, observedAt: null },
}

test('«Перевірка» of a sale draws the server’s four rows, in the web’s words', () => {
  const rows = saleCheckRows(check, { unit: 'share', company: 'Apple', locale: 'uk', words: words('uk') })
  assert.deepEqual(
    rows.map((r) => [r.key, r.value, r.sub]),
    [
      ['spend', '0,0787 частки Apple', '≈ $10,01'],
      ['get', '≈ $9,97 USDC', 'щонайменше $9,92'],
      ['costs', '≈ $0,04', null],
      ['what', 'Токенізована акція Apple: …', null],
    ],
  )
  const en = saleCheckRows(check, { unit: 'share', company: 'Apple', locale: 'en', words: words('en') })
  assert.equal(en[0].value, '0.0787 of a share')
  assert.equal(en[1].sub, 'at least $9.92')
})

test('an uncounted figure is a dash; the issuer’s fee, the reserve and the caution as the server says them', () => {
  const rows = saleCheckRows(
    {
      ...check,
      spend: { ...check.spend, amount: null, usd: null },
      get: { ...check.get, amount: null, atLeast: null },
      costs: { usd: 0.3, issuerFee: { basisPoints: 100, usd: 0.1 } },
      reserve: { lamports: '2039280', usd: 0.31, first: false },
      what: {
        truth: { en: 'OpenAI, private', uk: 'OpenAI, приватна' },
        note: { kind: 'sale-may-fail', en: 'Selling may not be possible.', uk: 'Продати може не вийти.' },
        caution: true,
      },
    },
    { unit: 'token', company: 'OpenAI', locale: 'uk', words: words('uk') },
  )
  assert.equal(rows[0].value, '—')
  assert.equal(rows[0].sub, null)
  assert.equal(rows[1].value, '—')
  assert.equal(rows[2].fee, 'з них комісія емітента 1% ≈\u00a0$0,10')
  assert.match(rows[2].sub, /у SOL разово/)
  assert.equal(rows[3].sub, 'Продати може не вийти.')
  assert.equal(rows[3].caution, true)
})

test('without the server’s count the rows come from the order’s own figures; the costs are a dash', () => {
  const rows = saleOrderRows({
    order: {
      inAmountRaw: '7870000',
      outAmountRaw: '9970000',
      minReceivedRaw: '9920000',
      inUsdValue: '10.01',
      outUsdValue: '9.97',
      totalFeeBasisPoints: 0,
      priceImpactPct: '0',
      signatureFeeLamports: '5000',
      priorityFeeLamports: '0',
      rentFeeLamports: '0',
    },
    payDecimals: 8,
    receiveDecimals: 6,
    multiplier: null,
    unit: 'share',
    company: 'Apple',
    truth: 'Tokenised Apple',
    preIpo: false,
    issuerFee: null,
    locale: 'en',
    words: words('en'),
  })
  assert.deepEqual(
    rows.map((r) => [r.key, r.value]),
    [
      ['spend', '0.0787 of a share'],
      ['get', '≈ $9.97 USDC'],
      ['costs', '—'],
      ['what', 'Tokenised Apple'],
    ],
  )
  assert.equal(rows[3].sub, null)
})

test('a sale is the sheet’s own only when it sells this company into USDC', () => {
  const ctx = (mode, pay, receive) => ({ mode, pay: { mint: pay }, receive: { mint: receive } })
  assert.equal(isCompanySale(ctx('sell', APPLE, USDC_ASSET.mint), APPLE), true)
  assert.equal(isCompanySale(ctx('buy', USDC_ASSET.mint, APPLE), APPLE), false)
  assert.equal(isCompanySale(ctx('sell', APPLE, 'So11111111111111111111111111111111111111112'), APPLE), false)
  assert.equal(isCompanySale(null, APPLE), false)
})

test('what the wallet holds, said as units of the company', () => {
  const apple = { decimals: 8, multiplier: null, unit: 'share', name: 'Apple' }
  assert.equal(heldUnitsText(7_870_000n, apple, 'uk'), '0,0787 частки Apple')
  assert.equal(heldUnitsText(0n, apple, 'uk'), null)
  assert.equal(heldUnitsText(null, apple, 'uk'), null)
})

test('Ryntra’s fee on a sale is said inside «Усі витрати» beside the issuer’s, counted or not', () => {
  const NB = String.fromCharCode(0xa0)
  const counted = saleCheckRows(
    { ...check, costs: { usd: 0.3, issuerFee: { basisPoints: 100, usd: 0.1 } } },
    { unit: 'token', company: 'OpenAI', locale: 'uk', words: words('uk'), ryntraFee: '0,50%' },
  )
  assert.equal(counted[2].fee, `з них комісія емітента 1% ≈${NB}$0,10
з них комісія Ryntra${NB}0,50%`)
  const uncounted = saleOrderRows({
    order: { inAmountRaw: '7870000', outAmountRaw: '9970000', minReceivedRaw: '9920000', inUsdValue: null },
    payDecimals: 8,
    receiveDecimals: 6,
    multiplier: null,
    unit: 'share',
    company: 'Apple',
    truth: 'Tokenised Apple',
    preIpo: false,
    issuerFee: null,
    ryntraFee: '0.50%',
    locale: 'en',
    words: words('en'),
  })
  assert.equal(uncounted[2].value, '—')
  assert.equal(uncounted[2].fee, `including the Ryntra fee${NB}0.50%`)
})
