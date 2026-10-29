import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountLeverageAfter,
  bookFill,
  clampLeverage,
  decimalInput,
  freeCollateralUsd,
  heldUnitsOf,
  legResult,
  leverageChoices,
  leverageKey,
  leverageSteps,
  liquidationEstimate,
  lotsOfUnits,
  lotsOfUsdSize,
  orderableUsd,
  marginCarried,
  maxOrderUsd,
  newPerpDraft,
  onlyReduces,
  perpOrderBody,
  perpOrderOf,
  perpTicketFigures,
  positionsValueUsdOf,
  sizeAtPercent,
  sizeInUnit,
  sizeUnitsOf,
  sizingLeverage,
  tierLeverage,
  wantsDeposit,
} from './perp-order-model.ts'

/*
 * The phone's ticket model (C4c) is the web's PERP-2 `perp-order-model.ts` ported: these are the web's own cases
 * (`app/solana/workspace/futures/perp-order-model.test.mjs` on line A), then the phone's helpers around them.
 */
/* SOL on Phoenix: a lot is a thousandth of SOL, a tick a hundredth of a dollar (tickSize 10 × 10^3 / 10^6). */
const SOL = { tickSize: 10, baseLotsDecimals: 3 }
const draft = (over) => ({ ...newPerpDraft(50), ...over })

test('a decimal as typed: a comma or a point, spaces between thousands', () => {
  assert.equal(decimalInput('1 250,5'), '1250.5')
  assert.equal(decimalInput('0.25'), '0.25')
  assert.equal(decimalInput('.5'), '0.5')
  assert.equal(decimalInput('12.'), '12')
  assert.equal(decimalInput('1e3'), null)
  assert.equal(decimalInput('-2'), null)
  assert.equal(decimalInput(''), null)
})

test("the leverage: the tier by the position's size, the picker's steps, a pick inside the market's range", () => {
  const market = {
    maxLeverage: 20,
    leverageTiers: [
      { maxLeverage: 20, maxSizeUnits: 1_000 },
      { maxLeverage: 10, maxSizeUnits: 5_000 },
      { maxLeverage: 5, maxSizeUnits: null },
    ],
  }
  assert.equal(tierLeverage(market, 10), 20)
  assert.equal(tierLeverage(market, -1_000), 20, 'a short counts by its size')
  assert.equal(tierLeverage(market, 2_000), 10)
  assert.equal(tierLeverage(market, 9_999_999), 5)
  assert.equal(tierLeverage({ maxLeverage: 8 }, 1), 8, "no tiers sent — the market's highest")
  assert.deepEqual(leverageSteps(20), [1, 2, 3, 5, 10, 20])
  assert.deepEqual(leverageSteps(5), [1, 2, 3, 5])
  assert.deepEqual(leverageSteps(null), [1])
  assert.equal(clampLeverage(50, 20), 20)
  assert.equal(clampLeverage(0, 20), 1)
  assert.equal(clampLeverage(7.4, 20), 7)
  assert.equal(clampLeverage(NaN, 20), 10)
})

test("the most an order may be worth: the free collateral times the leverage, under the first check's ceiling", () => {
  assert.equal(freeCollateralUsd({ portfolioUsd: 1_270.55, initialMarginUsd: 120.55 }), 1_150)
  assert.equal(freeCollateralUsd({ portfolioUsd: 10, initialMarginUsd: 30 }), 0, 'never below nothing')
  assert.equal(freeCollateralUsd({ portfolioUsd: null, initialMarginUsd: 0 }), null)
  /* 5 USD at 20× with 0.5 % tolerance and 5.5 bps of fees: what the collateral carries, not 5 × 20 = 100 (the operator's TSLA order, 22.10). */
  const most = maxOrderUsd(5, 20, null, 50, 0.00055)
  assert.ok(most < 90 && most > 88, `${most}`)
  assert.ok(
    marginCarried(5, most / 20, most * 0.00055, 50, most),
    '«100 %» is an order the collateral carries with its fees',
  )
  assert.equal(marginCarried(5, 97 / 20, 97 * 0.00055, 50, 97), false, '97 USD on 5 USD at 20× is not')
  /* The operator's SPCX long of 23.10: 3.652 USD free at 15× — Phoenix refused 55.13 USD («Invalid margin after trade»). */
  const spcx = maxOrderUsd(3.652, 15, null, 50, 0.00055)
  assert.ok(spcx < 51 && spcx > 49, `${spcx}`)
  assert.equal(
    marginCarried(3.652, 55.13 / 15, 55.13 * 0.00055, 50, 55.13),
    false,
    'the order Phoenix refused is not carried',
  )
  assert.equal(marginCarried(null, 1, 1, 50), true, 'without the figures the Review decides')
  assert.ok(
    Math.abs(maxOrderUsd(100, 10, 20, 50) - 20 / 1.005) < 1e-9,
    'the ceiling at the worst price the tolerance allows',
  )
  assert.equal(maxOrderUsd(null, 10, null, 50), null)
})

test("a market order's fill from the book: the asks for a long, the bids for a short; thin when it cannot fill", () => {
  const book = {
    asks: [
      { price: 100, size: 1 },
      { price: 101, size: 2 },
    ],
    bids: [
      { price: 99, size: 1 },
      { price: 98, size: 5 },
    ],
  }
  assert.deepEqual(bookFill('long', 2, book), { averageUsd: 100.5, worstUsd: 101 })
  assert.deepEqual(bookFill('short', 1, book), { averageUsd: 99, worstUsd: 99 })
  assert.equal(bookFill('long', 4, book), 'thin')
  assert.equal(bookFill('long', 1, null), null)
})

test('the size: USD at the counted price or the asset itself', () => {
  assert.equal(sizeUnitsOf({ size: '100', unit: 'usd' }, 200), 0.5)
  assert.equal(sizeUnitsOf({ size: '0,5', unit: 'coin' }, null), 0.5)
  assert.equal(sizeUnitsOf({ size: '100', unit: 'usd' }, null), null)
  assert.equal(sizeUnitsOf({ size: 'abc', unit: 'coin' }, 1), null)
})

test('the liquidation estimate solves for the mark at which the account keeps only its maintenance margin', () => {
  const account = { valueUsd: 100, maintenanceUsd: 0, heldUnits: 0 }
  /* 10 SOL at 100 on 100 USD: tier 20×, maintenance half of the initial — 2.5 % of the value kept. */
  const long = liquidationEstimate({
    account,
    orderUnits: 10,
    fillUsd: 100,
    markUsd: 100,
    feesUsd: 0,
    maintenanceRatio: 0.5,
    tierLeverage: 20,
  }).priceUsd
  assert.ok(Math.abs(long - 900 / 9.75) < 1e-9)
  /* At that mark the account's value equals what it must keep. */
  assert.ok(Math.abs(100 + 10 * (long - 100) - 10 * long * 0.025) < 1e-9)
  const short = liquidationEstimate({
    account,
    orderUnits: -10,
    fillUsd: 100,
    markUsd: 100,
    feesUsd: 0,
    maintenanceRatio: 0.5,
    tierLeverage: 20,
  }).priceUsd
  assert.ok(short > 100 && Math.abs(100 - 10 * (short - 100) - 10 * short * 0.025) < 1e-9)
  /* Fees and a worse fill bring it closer. */
  assert.ok(
    liquidationEstimate({
      account,
      orderUnits: 10,
      fillUsd: 100.5,
      markUsd: 100,
      feesUsd: 0.35,
      maintenanceRatio: 0.5,
      tierLeverage: 20,
    }).priceUsd > long,
  )
  /* A long the account covers to nothing is never liquidated; nothing after — none; no maintenance share — not known. */
  assert.deepEqual(
    liquidationEstimate({
      account: { valueUsd: 1_000, maintenanceUsd: 0, heldUnits: 0 },
      orderUnits: 10,
      fillUsd: 100,
      markUsd: 100,
      feesUsd: 0,
      maintenanceRatio: 0.5,
      tierLeverage: 20,
    }),
    { kind: 'none' },
  )
  assert.deepEqual(
    liquidationEstimate({
      account: { valueUsd: 100, maintenanceUsd: 25, heldUnits: 10 },
      orderUnits: -10,
      fillUsd: 100,
      markUsd: 100,
      feesUsd: 0,
      maintenanceRatio: 0.5,
      tierLeverage: 20,
    }),
    { kind: 'none' },
  )
  assert.deepEqual(
    liquidationEstimate({
      account,
      orderUnits: 10,
      fillUsd: 100,
      markUsd: 100,
      feesUsd: 0,
      maintenanceRatio: null,
      tierLeverage: 20,
    }),
    { kind: 'unknown' },
  )
  /* A short on an account already under water has no price above nothing: not «none» — not known here. */
  assert.deepEqual(
    liquidationEstimate({
      account: { valueUsd: -50, maintenanceUsd: 0, heldUnits: 0 },
      orderUnits: -10,
      fillUsd: 100,
      markUsd: 100,
      feesUsd: 0,
      maintenanceRatio: 0.5,
      tierLeverage: 20,
    }),
    { kind: 'unknown' },
  )
})

test('an addition counts the position already held and the margin the rest of the account keeps', () => {
  /* 5 SOL held (its maintenance 12.5 at 2.5 %), 10 USD kept for another market. */
  const account = { valueUsd: 100, maintenanceUsd: 22.5, heldUnits: 5 }
  const price = liquidationEstimate({
    account,
    orderUnits: 5,
    fillUsd: 100,
    markUsd: 100,
    feesUsd: 0,
    maintenanceRatio: 0.5,
    tierLeverage: 20,
  }).priceUsd
  assert.ok(Math.abs(100 + 10 * (price - 100) - (10 + 10 * price * 0.025)) < 1e-9)
})

test("the account's leverage after — a flip counted on its new side — the sizing leverage under the tier, a leg's result", () => {
  /* 5 SOL long at 100 among 500 USD of positions on a 100 USD account. */
  assert.equal(accountLeverageAfter(500, 5, 5, 100, 100), 10, 'an addition')
  assert.equal(accountLeverageAfter(500, 5, -2, 100, 100), 3, 'a cut')
  assert.equal(accountLeverageAfter(500, 1, -3, 100, 100), 6, '1 long, sell 3 — 2 short: 400 + 200')
  assert.equal(accountLeverageAfter(500, 5, 1, 100, 0), null)
  assert.equal(onlyReduces(5, -2), true)
  assert.equal(onlyReduces(1, -3), false, 'a flip adds the new side')
  assert.equal(onlyReduces(0, -1), false)
  const market = {
    maxLeverage: 20,
    leverageTiers: [
      { maxLeverage: 20, maxSizeUnits: 10 },
      { maxLeverage: 5, maxSizeUnits: null },
    ],
  }
  assert.equal(sizingLeverage(market, 20, 100, 100, 0), 5, '20× of 100 USD at 100 is 20 SOL — past the first tier')
  assert.equal(sizingLeverage(market, 5, 100, 100, 0), 5)
  assert.equal(sizingLeverage(market, 10, 50, 100, 0), 10, '5 SOL stays in the first tier')
  assert.deepEqual(legResult('long', 100, 110, 2, 10), { usd: 20, percent: 100 })
  assert.deepEqual(legResult('short', 100, 110, 2, 5), { usd: -20, percent: -50 })
})

test('a market long with TP/SL as the route builds it, rounded toward the side each guards', () => {
  const made = perpOrderOf({
    draft: draft({ size: '1,5', unit: 'coin', tpsl: true, tp: '210.005', sl: '170.005' }),
    units: SOL,
    markUsd: 186.42,
    maxUsd: 10_000,
    heldUnits: 0,
  })
  assert.deepEqual(made.order, {
    kind: 'open',
    side: 'long',
    type: 'market',
    size: '1500',
    slippageBps: 50,
    tp: '21000',
    sl: '17001',
  })
  assert.equal(made.sizeUnits, 1.5)
  const short = perpOrderOf({
    draft: draft({ side: 'short', size: '1', unit: 'coin', tpsl: true, tp: '170.005', sl: '210.005' }),
    units: SOL,
    markUsd: 186.42,
    maxUsd: null,
    heldUnits: 0,
  })
  assert.deepEqual(short.order, {
    kind: 'open',
    side: 'short',
    type: 'market',
    size: '1000',
    slippageBps: 50,
    tp: '17001',
    sl: '21000',
  })
})

test("USD becomes lots at the mark, down to a whole lot; the asset as typed becomes lots exactly; a limit's price in ticks", () => {
  assert.equal(
    perpOrderOf({
      draft: draft({ size: '0,123', unit: 'coin' }),
      units: SOL,
      markUsd: 186.42,
      maxUsd: null,
      heldUnits: 0,
    }).order.size,
    '123',
  )
  const made = perpOrderOf({ draft: draft({ size: '100' }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 })
  assert.equal(made.order.size, '536', '100 / 186.42 = 0.53642… SOL — 536 lots, never more than typed')
  const limit = perpOrderOf({
    draft: draft({ type: 'limit', price: '180,123', size: '100' }),
    units: SOL,
    markUsd: 186.42,
    maxUsd: null,
    heldUnits: 0,
  })
  assert.deepEqual(limit.order, { kind: 'open', side: 'long', type: 'limit', size: '555', price: '18012' })
  const sellLimit = perpOrderOf({
    draft: draft({ side: 'short', type: 'limit', price: '190.001', size: '1', unit: 'coin' }),
    units: SOL,
    markUsd: 186.42,
    maxUsd: null,
    heldUnits: 0,
  })
  assert.equal(sellLimit.order.price, '19001', "a sell's limit up — never under what was typed")
})

test('what blocks a draft: a size under a lot or a dollar, over the most, legs on the wrong side, an empty price', () => {
  const order = (over, extra = {}) =>
    perpOrderOf({ draft: draft(over), units: SOL, markUsd: 186.42, maxUsd: 1_000, heldUnits: 0, ...extra })
  assert.equal(order({ size: '' }), null, 'nothing typed — nothing to say')
  assert.deepEqual(order({ size: 'x' }), { block: 'SIZE' })
  assert.deepEqual(order({ size: '0.0001', unit: 'coin' }), { block: 'MINIMUM' })
  assert.deepEqual(order({ size: '0.5' }), { block: 'MINIMUM' }, 'under a dollar')
  assert.deepEqual(order({ size: '1200' }), { block: 'OVER_MAX' })
  assert.deepEqual(order({ size: '100', tpsl: true, tp: '180' }), { block: 'TP_SIDE' })
  assert.deepEqual(order({ size: '100', tpsl: true, sl: '190' }), { block: 'SL_SIDE' })
  /* The side is checked on the tick: a take profit a fraction above the mark that rounds down onto it is refused here. */
  assert.deepEqual(
    perpOrderOf({
      draft: draft({ size: '100', tpsl: true, tp: '100.009' }),
      units: SOL,
      markUsd: 100.005,
      maxUsd: null,
      heldUnits: 0,
    }),
    { block: 'TP_SIDE' },
  )
  /* The first check's ceiling has its own word, and a sell counts at the mark when that is above its limit. */
  assert.deepEqual(order({ size: '30' }, { ceilingUsd: 20 }), { block: 'CEILING' })
  assert.deepEqual(
    order({ side: 'short', type: 'limit', price: '150', size: '0.12', unit: 'coin' }, { ceilingUsd: 20 }),
    { block: 'CEILING' },
    '0.12 × the mark 186.42 > 20',
  )
  assert.ok(
    'order' in order({ side: 'short', type: 'limit', price: '150', size: '0.1', unit: 'coin' }, { ceilingUsd: 20 }),
  )
  assert.equal(
    order({ size: '100', tpsl: false, tp: '180' }).order.tp,
    null,
    'legs off — what was typed in them is not sent',
  )
  assert.equal(order({ type: 'limit', price: '', size: '100' }), null)
  assert.deepEqual(order({ type: 'limit', price: 'abc', size: '100' }), { block: 'PRICE' })
})

test('reduce-only: a market order against the position held, never more than it', () => {
  const order = (over, held) =>
    perpOrderOf({
      draft: draft({ reduceOnly: true, ...over }),
      units: SOL,
      markUsd: 186.42,
      maxUsd: 1,
      heldUnits: held,
    })
  assert.deepEqual(order({ side: 'short', size: '1', unit: 'coin' }, 2.5).order, {
    kind: 'reduce',
    size: '1000',
    slippageBps: 50,
  })
  assert.deepEqual(order({ side: 'long', size: '1', unit: 'coin' }, 2.5), { block: 'REDUCE_SIDE' })
  assert.deepEqual(order({ side: 'short', size: '3', unit: 'coin' }, 2.5), { block: 'REDUCE_OVER' })
  assert.deepEqual(order({ side: 'short', size: '1', unit: 'coin' }, 0), { block: 'REDUCE_NONE' })
  assert.deepEqual(
    order({ side: 'short', size: '0.0001', unit: 'coin' }, 2.5),
    { block: 'LOT' },
    'reduce-only has no dollar minimum, only a lot',
  )
  assert.deepEqual(order({ side: 'short', type: 'limit', price: '190', size: '1', unit: 'coin' }, 2.5), {
    block: 'REDUCE_LIMIT',
  })
})

test("the slider's share as the size, down to the lot", () => {
  assert.equal(sizeAtPercent(50, 1_000, 186.42, 'usd', SOL), '499.97', '2.682 SOL at the mark, down to the cent')
  assert.equal(sizeAtPercent(100, 1_000, 186.42, 'coin', SOL), '5.364')
  assert.equal(sizeAtPercent(25, null, 186.42, 'usd', SOL), '')
  assert.equal(sizeAtPercent(0, 1_000, 186.42, 'usd', SOL), '')
  /* «100 %» is never over the most. */
  const made = perpOrderOf({
    draft: draft({ size: sizeAtPercent(100, 1_000, 186.42, 'usd', SOL) }),
    units: SOL,
    markUsd: 186.42,
    maxUsd: 1_000,
    heldUnits: 0,
  })
  assert.ok('order' in made)
})

test('the size in the other unit keeps the order: USD to the asset down to the lot, the asset to USD down to the cent', () => {
  assert.equal(sizeInUnit(0.53642, 186.42, 'coin', SOL), '0.536')
  assert.equal(sizeInUnit(1.5, 186.42, 'usd', SOL), '279.63')
  assert.equal(sizeInUnit(null, 186.42, 'usd', SOL), '')
  assert.equal(sizeInUnit(1, null, 'usd', SOL), '')
})

test('the leverage kept on the phone: one key per market, every whole leverage up to the highest', () => {
  assert.equal(leverageKey('kBONK'), 'futures.leverage.kbonk')
  assert.deepEqual(leverageChoices(5), ['1', '2', '3', '4', '5'])
  assert.deepEqual(leverageChoices(null), ['1'])
})

test("the account's position on this market and every position's value: subaccount 0 only, unknown is not zero", () => {
  const position = (over) => ({
    symbol: 'SOL',
    subaccount: 0,
    side: 'long',
    size: 2,
    entryPrice: 100,
    tpPrice: null,
    slPrice: null,
    ...over,
  })
  const account = (positions) => ({
    wallet: 'w',
    state: 'active',
    collateralUsd: 100,
    collateralSol: null,
    positions,
    orders: [],
    margin: null,
    observedAt: 1,
  })
  assert.equal(
    heldUnitsOf(account([position({ side: 'short', size: 3, symbol: 'sol' })]), 'SOL'),
    -3,
    'case-blind, signed',
  )
  assert.equal(heldUnitsOf(account([position({ subaccount: 1 })]), 'SOL'), 0, 'an isolated one is not the ticket’s')
  assert.equal(heldUnitsOf(null, 'SOL'), 0)
  const marks = [
    { symbol: 'SOL', markPrice: 100 },
    { symbol: 'BTC', markPrice: 50_000 },
  ]
  assert.equal(
    positionsValueUsdOf(account([position({}), position({ symbol: 'BTC', size: 0.01, side: 'short' })]), marks),
    700,
  )
  assert.equal(positionsValueUsdOf(account([position({ symbol: 'ETH' })]), marks), null, 'a mark not read — a dash')
  assert.equal(positionsValueUsdOf(account([position({ size: null })]), marks), null)
  assert.equal(positionsValueUsdOf(null, marks), 0)
})

test('the route takes the ticket as its body, without leverage; the collateral’s blocks ask for a deposit', () => {
  const owner = 'Owner1111111111111111111111111111111111111'
  assert.deepEqual(perpOrderBody({ kind: 'reduce', size: '1000', slippageBps: 50 }, owner, 'SOL'), {
    kind: 'reduce',
    owner,
    symbol: 'SOL',
    size: '1000',
    slippageBps: 50,
  })
  assert.deepEqual(
    perpOrderBody({ kind: 'open', side: 'short', type: 'limit', size: '555', price: '18012' }, owner, 'SOL'),
    { kind: 'open', owner, symbol: 'SOL', side: 'short', type: 'limit', size: '555', price: '18012' },
  )
  const market = perpOrderBody(
    { kind: 'open', side: 'long', type: 'market', size: '1500', slippageBps: 50, tp: '21000', sl: null },
    owner,
    'SOL',
  )
  assert.deepEqual(market, {
    kind: 'open',
    owner,
    symbol: 'SOL',
    side: 'long',
    type: 'market',
    size: '1500',
    slippageBps: 50,
    tp: '21000',
    sl: null,
  })
  assert.equal('leverage' in market, false)
  assert.equal(wantsDeposit('OVER_MAX'), true)
  assert.equal(wantsDeposit('MARGIN'), true)
  assert.equal(wantsDeposit('MINIMUM'), false)
  assert.equal(wantsDeposit(null), false)
})

test("the ticket's figures before the Review: the most at the leverage, the margin at the tier's, the fill from the book, the fees", () => {
  const market = {
    markPrice: 100,
    maxLeverage: 20,
    leverageTiers: [{ maxLeverage: 20, maxSizeUnits: 1_000 }],
    takerRate: 0.00035,
    maintenanceRatio: 0.5,
  }
  const base = {
    market,
    units: SOL,
    leverage: 10,
    margin: { portfolioUsd: 100, initialMarginUsd: 0, maintenanceMarginUsd: 0 },
    opened: true,
    maxNotionalUsd: null,
    builder: true,
    builderBps: 2,
    book: {
      asks: [
        { price: 100, size: 1 },
        { price: 101, size: 100 },
      ],
      bids: [{ price: 99, size: 100 }],
    },
    heldUnits: 0,
    positionsValueUsd: 0,
  }
  const figures = perpTicketFigures({ ...base, draft: draft({ size: '2', unit: 'coin' }) })
  assert.equal(figures.free, 100)
  // 100 USD at 10×: the margin, the fees and the 0.5 % tolerance on the notional out of the same collateral, a percent of room.
  assert.ok(figures.maxUsd > 930 && figures.maxUsd < 945, `${figures.maxUsd}`)
  assert.deepEqual(figures.order, {
    kind: 'open',
    side: 'long',
    type: 'market',
    size: '2000',
    slippageBps: 50,
    tp: null,
    sl: null,
  })
  assert.equal(figures.fillUsd, 100.5, 'the asks walked: 1 at 100, 1 at 101')
  assert.ok(Math.abs(figures.valueUsd - 201) < 1e-9)
  assert.ok(Math.abs(figures.marginUsd - 201 / 20) < 1e-9, "the tier's leverage holds the margin, not the one picked")
  assert.ok(Math.abs(figures.feesUsd - 201 * 0.00055) < 1e-12, "Phoenix's 3.5 bps and Ryntra's 2")
  assert.equal(figures.liquidation.kind, 'price')
  assert.ok(Math.abs(figures.leverageAfter - 2) < 1e-9, '2 SOL at the mark 100 on a 100 USD account')
  assert.ok(Math.abs(figures.share - (201 / figures.maxUsd) * 100) < 1e-9)
  // A builder whose rate was not read: the fees are not said as Phoenix's alone.
  assert.equal(
    perpTicketFigures({ ...base, builderBps: null, draft: draft({ size: '2', unit: 'coin' }) }).ryntraKnown,
    false,
  )
  // Over the most asks for a deposit; a book that cannot fill is thin; a reduce-only sell of a long takes no margin.
  assert.equal(perpTicketFigures({ ...base, draft: draft({ size: '2000' }) }).block, 'OVER_MAX')
  const rich = { portfolioUsd: 10_000, initialMarginUsd: 0, maintenanceMarginUsd: 0 }
  assert.equal(
    perpTicketFigures({ ...base, leverage: 20, margin: rich, draft: draft({ size: '200', unit: 'coin' }) }).block,
    'thin',
  )
  const cut = perpTicketFigures({
    ...base,
    heldUnits: 2,
    draft: draft({ side: 'short', reduceOnly: true, size: '1', unit: 'coin' }),
  })
  assert.deepEqual(cut.order, { kind: 'reduce', size: '1000', slippageBps: 50 })
  assert.equal(cut.maxUsd, null)
  assert.equal(cut.marginUsd, null)
  // No account: nothing free, no most; a position value not known: no account leverage after.
  const none = perpTicketFigures({ ...base, opened: false, positionsValueUsd: null, draft: draft({ size: '100' }) })
  assert.equal(none.free, null)
  assert.equal(none.maxUsd, null)
  assert.equal(none.leverageAfter, null)
})

test('C4f: «Макс» on a market whose lot is a whole coin orders every lot and reads 100 %', () => {
  // The operator's NEAR short on 2026-10-24: one lot is one NEAR, the mark $4.357, 3.15 USDC free at 10×.
  const NEAR = { tickSize: 100, baseLotsDecimals: 0 }
  const market = { symbol: 'NEAR', markPrice: 4.357, maxLeverage: 10, takerRate: 0.00035, maintenanceRatio: 0.5 }
  const base = {
    market,
    units: NEAR,
    leverage: 10,
    margin: { portfolioUsd: 3.15, initialMarginUsd: 0, maintenanceMarginUsd: 0 },
    opened: true,
    maxNotionalUsd: null,
    builder: true,
    builderBps: 2,
    book: null,
    heldUnits: 0,
    positionsValueUsd: 0,
  }
  const empty = perpTicketFigures({ ...base, draft: draft({ side: 'short' }) })
  assert.ok(Math.abs(empty.maxUsd - 6 * 4.357) < 1e-9, `the most is six whole NEAR, not ${empty.maxUsd}`)
  const size = sizeAtPercent(100, empty.maxUsd, empty.countPrice, 'usd', NEAR)
  assert.equal(size, '26.14', 'six NEAR, said to the cent')
  const max = perpTicketFigures({ ...base, draft: draft({ side: 'short', size, percent: 100 }) })
  assert.equal(max.order?.size, '6', 'six lots ordered, not five')
  assert.equal(Math.round(max.share), 100)
  // A size a cent short of a lot is that lot; a dollar short is not.
  assert.equal(lotsOfUsdSize(26.14 / 4.357, 4.357, NEAR), 6n)
  assert.equal(lotsOfUsdSize(25.14 / 4.357, 4.357, NEAR), 5n)
  assert.equal(lotsOfUsdSize(0.5 / 4.357, 4.357, NEAR), null)
  // Fine lots too: SOL's «50 %» wrote $499.97 for 2.682 SOL, which read back one lot short before C4f.
  assert.equal(lotsOfUsdSize(499.97 / 186.42, 186.42, SOL), 2682n)
  // A lot worth under a cent: a size typed exactly is that many lots, never one over.
  const TINY = { tickSize: 1, baseLotsDecimals: 0 }
  assert.equal(lotsOfUsdSize(1 / 0.004, 0.004, TINY), 250n)
})

test('C4f: «Макс» keeps every lot on low-priced markets with coarse lots — the float a hair under a whole lot', () => {
  // PUMP: a lot is 100 coins at $0.0041213; kBONK, SKR alike (the critic's sweep of the live markets, 2026-10-24).
  const PUMP = { tickSize: 1, baseLotsDecimals: -2 }
  const mostUsd = orderableUsd(57 * 100 * 0.0041213 + 0.0005, 0.0041213, PUMP)
  assert.equal(lotsOfUnits(mostUsd / 0.0041213, PUMP), 57n)
  const size = sizeAtPercent(100, mostUsd, 0.0041213, 'usd', PUMP)
  assert.equal(lotsOfUsdSize(Number(size) / 0.0041213, 0.0041213, PUMP), 57n)
  assert.equal(sizeAtPercent(100, mostUsd, 0.0041213, 'coin', PUMP), '5700')
  const SKR = { tickSize: 1, baseLotsDecimals: 0 }
  for (const price of [0.0143, 0.01429, 0.014311]) {
    for (let lots = 2000; lots < 6000; lots += 37) {
      const most = lots * price
      assert.equal(lotsOfUnits(most / price, SKR), BigInt(lots), `${lots} lots at ${price}`)
    }
  }
})

test('C4f: a size the chips set is their lots — XRP, whose lot is about a cent, keeps its last lot', () => {
  const XRP = { tickSize: 10, baseLotsDecimals: 2 }
  const market = { symbol: 'XRP', markPrice: 1.263, maxLeverage: 10, takerRate: 0.00035, maintenanceRatio: 0.5 }
  const base = {
    market,
    units: XRP,
    leverage: 10,
    margin: { portfolioUsd: 0.87, initialMarginUsd: 0, maintenanceMarginUsd: 0 },
    opened: true,
    maxNotionalUsd: null,
    builder: true,
    builderBps: 2,
    book: null,
    heldUnits: 0,
    positionsValueUsd: 0,
  }
  const empty = perpTicketFigures({ ...base, draft: draft({}) })
  const lots = Math.round(empty.maxUsd / 1.263 / 0.01)
  const size = sizeAtPercent(100, empty.maxUsd, empty.countPrice, 'usd', XRP)
  const max = perpTicketFigures({ ...base, draft: draft({ size, percent: 100 }) })
  assert.equal(max.order?.size, String(lots))
  assert.equal(Math.round(max.share), 100)
  // The same dollars typed by hand go to the lot below the cent's rounding, as typed.
  const typed = perpTicketFigures({ ...base, draft: draft({ size }) })
  assert.ok(Number(typed.order?.size) <= lots)
})

test('C4f: the order is the size in the field — after the mark moves, and across the unit switch', () => {
  const XRP = { tickSize: 10, baseLotsDecimals: 2 }
  const SKR = { tickSize: 1, baseLotsDecimals: 0 }
  for (const [units, price] of [
    [XRP, 1.263],
    [SKR, 0.0143],
  ]) {
    const lot = 10 ** -units.baseLotsDecimals
    for (let lots = 1; lots < 5000; lots += 7) {
      // The coins switched to USD read back as the same lots.
      const usd = sizeInUnit(lots * lot, price, 'usd', units)
      assert.equal(lotsOfUsdSize(Number(usd) / price, price, units), BigInt(lots), `${lots} lots at ${price}: $${usd}`)
    }
  }
})
