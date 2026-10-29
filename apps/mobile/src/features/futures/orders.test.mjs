import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  address,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import { ApiError } from '../../lib/api.ts'
import { ORDER_COPY } from './order-copy.ts'
import {
  SAMPLE_CANCEL,
  SAMPLE_CLOSE,
  SAMPLE_OPEN_LIMIT,
  SAMPLE_OPEN_MARKET,
  SAMPLE_PROTECT,
  SAMPLE_RELAY_FAILED,
  SAMPLE_RELAY_FILLED,
  SAMPLE_RELAY_PENDING,
  SAMPLE_RELAY_RESTING,
} from './order-samples.ts'
import { receiptView, reviewView } from './order-view.ts'
import { followOrder, readOrderStates, reviewOrder, signAndRelay } from './orders-flow.ts'
import {
  buyingPowerUsd,
  legTicks,
  lotsFromUnits,
  orderFailureOf,
  parseOrderResult,
  parseOrderReview,
  parseOrderStates,
  sameOrderNoWorse,
  shareLots,
  ticketOrder,
  ticksFromUsd,
  unitsOf,
  unitsTextFromLots,
  usdFromTicks,
} from './orders-model.ts'
import { parseAccount, parseMarkets } from './futures-model.ts'

/* Visibly synthetic wallets (M28): 32 bytes of 5s and of 6s. */
const OWNER = 'LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY'
const OTHER = 'QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF'
const SESSION = {
  address: OWNER,
  token: 't',
  issuedAt: '2026-10-22T00:00:00Z',
  expiresAt: '2026-10-29T00:00:00Z',
  sessionId: null,
}
/** Phoenix's SOL market: a tick of 100 quote lots per lot, two base decimals. */
const SOL = { tickSize: 100, baseLotsDecimals: 2 }

/** A real legacy wire signed by `signer` with a recognisable signature — what a wallet hands back. */
function signedWire(signer, fill = 7) {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(address(signer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n },
        m,
      ),
  )
  const compiled = compileTransaction(message)
  return getBase64EncodedWireTransaction({ ...compiled, signatures: { [signer]: new Uint8Array(64).fill(fill) } })
}

test('units: dollars to ticks keep the limit (down for a long, up for a short); lots never round up; back again exactly', () => {
  assert.equal(ticksFromUsd('103.94', SOL, 'floor'), 10394n)
  assert.equal(ticksFromUsd('103,945', SOL, 'floor'), 10394n)
  assert.equal(ticksFromUsd('103.945', SOL, 'ceil'), 10395n)
  assert.equal(ticksFromUsd('0', SOL, 'floor'), null)
  assert.equal(ticksFromUsd('abc', SOL, 'floor'), null)
  assert.equal(usdFromTicks(10394n, SOL), 103.94)
  assert.equal(lotsFromUnits('0.489', 2), 48n)
  assert.equal(unitsTextFromLots(48n, 2), '0.48')
  // PUMP's lot is a hundred tokens.
  assert.equal(lotsFromUnits('250', -2), 2n)
  assert.equal(unitsTextFromLots(2n, -2), '200')
  assert.deepEqual(unitsOf({ tickSize: 100, baseLotsDecimals: 2 }), SOL)
  assert.equal(unitsOf({ tickSize: null, baseLotsDecimals: 2 }), null)
  assert.equal(unitsOf({ tickSize: 1.5, baseLotsDecimals: 2 }), null)
})

test('the ticket: the notional in dollars becomes whole lots at the order price, down — never more than typed', () => {
  const market = ticketOrder({
    side: 'long',
    type: 'market',
    amountUsd: '50',
    limitUsd: '',
    tpUsd: '',
    slUsd: '',
    markUsd: 103.94,
    units: SOL,
  })
  assert.equal(market.ok, true)
  assert.deepEqual(market.order, { side: 'long', type: 'market', size: '48', slippageBps: 50, tp: null, sl: null })
  assert.equal(market.sizeUnits, '0.48')
  assert.ok(market.notionalUsd <= 50)
  const limit = ticketOrder({
    side: 'short',
    type: 'limit',
    amountUsd: '25',
    limitUsd: '105',
    tpUsd: '120',
    slUsd: '',
    markUsd: 103.94,
    units: SOL,
  })
  // A limit rests: its TP/SL is never sent with it.
  assert.deepEqual(limit.order, { side: 'short', type: 'limit', size: '23', price: '10500' })
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'market',
      amountUsd: '',
      limitUsd: '',
      tpUsd: '',
      slUsd: '',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'amount' },
  )
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'market',
      amountUsd: '0,5',
      limitUsd: '',
      tpUsd: '',
      slUsd: '',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'belowMinimum' },
  )
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'limit',
      amountUsd: '20',
      limitUsd: '',
      tpUsd: '',
      slUsd: '',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'price' },
  )
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'market',
      amountUsd: '20',
      limitUsd: '',
      tpUsd: '',
      slUsd: '',
      markUsd: null,
      units: SOL,
    }),
    { ok: false, block: 'mark' },
  )
})

test('the ticket: TP/SL ride with a market order on the side they guard, rounded toward it', () => {
  const long = ticketOrder({
    side: 'long',
    type: 'market',
    amountUsd: '50',
    limitUsd: '',
    tpUsd: '115.005',
    slUsd: '98.005',
    markUsd: 103.94,
    units: SOL,
  })
  assert.equal(long.order.tp, '11500')
  assert.equal(long.order.sl, '9801')
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'market',
      amountUsd: '50',
      limitUsd: '',
      tpUsd: '100',
      slUsd: '',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'tpSide' },
  )
  assert.deepEqual(
    ticketOrder({
      side: 'short',
      type: 'market',
      amountUsd: '50',
      limitUsd: '',
      tpUsd: '',
      slUsd: '100',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'slSide' },
  )
  assert.deepEqual(
    ticketOrder({
      side: 'long',
      type: 'market',
      amountUsd: '50',
      limitUsd: '',
      tpUsd: '1.2.3',
      slUsd: '',
      markUsd: 103.94,
      units: SOL,
    }),
    { ok: false, block: 'tp' },
  )
  const short = legTicks('short', '95.005', '110.005', SOL)
  assert.deepEqual(short, { tp: 9501n, sl: 11000n })
  assert.deepEqual(legTicks('long', '', '', SOL), { tp: null, sl: null })
})

test('a cut is a share of the position in whole lots, at least one; buying power is the free collateral × leverage under the ceiling', () => {
  assert.equal(shareLots(0.48, 50, SOL), 24n)
  assert.equal(shareLots(0.01, 25, SOL), null)
  assert.equal(shareLots(0, 50, SOL), null)
  assert.equal(buyingPowerUsd({ portfolioUsd: 250, initialMarginUsd: 50 }, 25), 5000)
  assert.equal(buyingPowerUsd({ portfolioUsd: 250, initialMarginUsd: 50 }, 25, 20), 20)
  assert.equal(buyingPowerUsd({ portfolioUsd: 40, initialMarginUsd: 50 }, 25), 0)
  assert.equal(buyingPowerUsd({ portfolioUsd: null, initialMarginUsd: 50 }, 25), null)
  assert.equal(buyingPowerUsd(null, 25), null)
})

test("the gate's word: closed unless the server says plainly «open»; a canary's ceiling and the builder's bps read as they came", async () => {
  const closed = { open: false, maxNotionalUsd: null, builder: false, builderBps: null }
  assert.deepEqual(parseOrderStates({ open: false, maxNotionalUsd: null, builder: false }), closed)
  assert.deepEqual(parseOrderStates({ open: 'true' }), closed)
  assert.deepEqual(parseOrderStates(null), closed)
  assert.deepEqual(parseOrderStates({ open: true, maxNotionalUsd: 20, builder: true }), {
    open: true,
    maxNotionalUsd: 20,
    builder: true,
    builderBps: null,
  })
  assert.equal(parseOrderStates({ open: true, builder: true, builderBps: 2 }).builderBps, 2)
  assert.equal(parseOrderStates({ open: true, builder: true, builderBps: 0 }).builderBps, 0, 'a zero rate is a rate')
  assert.equal(
    parseOrderStates({ open: true, builder: true, builderBps: '2' }).builderBps,
    null,
    'not a number — unknown',
  )
  assert.equal(parseOrderStates({ open: true, builder: false, builderBps: 2 }).builderBps, null, 'no builder — no rate')
  let asked = null
  const states = await readOrderStates(
    { states: async (owner) => ((asked = owner), { open: true, maxNotionalUsd: 20, builder: false }) },
    OWNER,
  )
  assert.equal(asked, OWNER)
  assert.equal(states.maxNotionalUsd, 20)
})

test('the markets and the account carry what an order needs: units, fees, TP/SL, the sequence a cancel names, the margin', () => {
  const markets = parseMarkets({
    markets: [
      {
        symbol: 'SOL',
        status: 'active',
        tickSize: 100,
        baseLotsDecimals: 2,
        takerRate: 0.00035,
        makerRate: 0.00005,
        markPrice: 103.94,
      },
    ],
  })
  assert.deepEqual(
    [
      markets.markets[0].tickSize,
      markets.markets[0].baseLotsDecimals,
      markets.markets[0].takerRate,
      markets.markets[0].makerRate,
    ],
    [100, 2, 0.00035, 0.00005],
  )
  const account = parseAccount(
    {
      state: 'active',
      positions: [
        { symbol: 'SOL', subaccount: 0, side: 'long', size: 0.48, entryPrice: 103.96, tpPrice: 115, slPrice: null },
      ],
      orders: [
        {
          id: '0:SOL:1',
          symbol: 'SOL',
          subaccount: 0,
          side: 'sell',
          type: 'limit',
          price: 105,
          size: 0.23,
          sequence: '18446744073638547647',
        },
        {
          id: '2:SOL:2',
          symbol: 'SOL',
          subaccount: 2,
          side: 'sell',
          type: 'limit',
          price: 106,
          size: 0.1,
          sequence: 'x1',
        },
      ],
      margin: {
        portfolioUsd: 250,
        initialMarginUsd: 2,
        maintenanceMarginUsd: 1,
        riskTier: 'safe',
        withdrawableMicro: '248000000',
        canDeposit: true,
        canWithdraw: 'yes',
      },
    },
    OWNER,
  )
  assert.equal(account.positions[0].tpPrice, 115)
  assert.equal(account.positions[0].slPrice, null)
  assert.equal(account.positions[0].subaccount, 0)
  assert.equal(account.orders[0].sequence, '18446744073638547647')
  assert.equal(account.orders[1].sequence, null)
  assert.equal(account.orders[1].subaccount, 2)
  assert.deepEqual(account.margin, {
    portfolioUsd: 250,
    initialMarginUsd: 2,
    maintenanceMarginUsd: 1,
    riskTier: 'safe',
    // What may leave and Phoenix's own yes/no on moves (C4c); a word that is not a boolean is none.
    withdrawableMicro: '248000000',
    canDeposit: true,
    canWithdraw: null,
  })
  assert.equal(parseAccount({ state: 'none' }, OWNER).margin, null)
})

test('a Review is read again: without its bytes, ticket or fees it is none; a figure that is not a number is a dash', () => {
  const review = parseOrderReview(SAMPLE_OPEN_MARKET)
  assert.equal(review.kind, 'open')
  assert.equal(review.sizeUnits, '0.48')
  assert.equal(review.networkFeeLamports, 5000n)
  assert.equal(review.rentLamports, 2039280n)
  assert.equal(review.signableMs, 24_000)
  assert.equal(parseOrderReview({ ...SAMPLE_OPEN_MARKET, ticket: '' }), null)
  assert.equal(parseOrderReview({ ...SAMPLE_OPEN_MARKET, transaction: {} }), null)
  assert.equal(parseOrderReview({ ...SAMPLE_OPEN_MARKET, networkFeeLamports: 5000 }), null)
  assert.equal(parseOrderReview({ ...SAMPLE_OPEN_MARKET, kind: 'swap' }), null)
  const odd = parseOrderReview({
    ...SAMPLE_OPEN_MARKET,
    markUsd: '103.94',
    after: { ...SAMPLE_OPEN_MARKET.after, liquidationUsd: 'n/a' },
  })
  assert.equal(odd.markUsd, null)
  assert.equal(odd.after.liquidationUsd, null)
})

test("a Review says Phoenix's view after the order: leverage, liquidation and its distance, collateral, every cost, funding", () => {
  const en = ORDER_COPY.en
  const view = reviewView(parseOrderReview(SAMPLE_OPEN_MARKET), en, 'en')
  assert.equal(view.title, 'Long 0.48 SOL-PERP · market')
  assert.equal(view.pay, '2.00 USDC of collateral as margin')
  assert.equal(view.get, 'Long 0.48 SOL ≈ 50.13 USD')
  const row = (label) => view.rows.find((entry) => entry.label === label)?.value
  assert.equal(row('Worst price'), '$104.45')
  assert.equal(row('Tolerance'), '0.5%')
  assert.equal(row('Position after'), 'Long 0.48 SOL')
  assert.equal(row('Leverage after'), '0.2×')
  assert.equal(row('Liquidation (mark)'), '$61.20 · 41.1% from the mark')
  assert.equal(row('Collateral after'), '249.98 USDC')
  assert.equal(row('Funding, an hour'), '+0.0012% · longs pay shorts')
  assert.equal(row('Take profit'), '$115.00')
  const cost = (label) => view.costs.find((entry) => entry.label === label)?.value
  assert.equal(cost('Phoenix'), '0.017547 USDC · 0.035%')
  assert.equal(cost('Ryntra'), 'none')
  assert.equal(cost('Network'), '0.000005 SOL')
  assert.equal(cost('TP/SL deposit'), '0.00203928 SOL')
  assert.equal(view.total, '≈ 0.017547 USDC + 0.00204428 SOL')
  // A limit's fees depend on how it fills: its rates stand on their line, its total is the network's.
  const limit = reviewView(parseOrderReview(SAMPLE_OPEN_LIMIT), ORDER_COPY.uk, 'uk')
  assert.equal(limit.title, 'Шорт 0,23 SOL-PERP · ліміт')
  assert.equal(limit.costs[0].value, '0,005 % у стакані, 0,035 %, якщо виконається одразу')
  assert.equal(limit.total, '0,000005 SOL')
  const close = reviewView(parseOrderReview(SAMPLE_CLOSE), en, 'en')
  assert.equal(close.title, 'Close the long 0.48 SOL-PERP')
  // A close whose fees outweigh its result takes from the collateral: said so, never «-0.03 to your collateral».
  assert.equal(close.get, '0.03 USDC out of your collateral')
  assert.ok(close.rows.some((entry) => entry.label === 'Current TP/SL'))
  assert.equal(reviewView(parseOrderReview(SAMPLE_PROTECT), en, 'en').get, 'TP/SL on the whole position')
  const cancel = reviewView(parseOrderReview(SAMPLE_CANCEL), en, 'en')
  assert.equal(cancel.rows[0].value, 'Short 0.23 SOL · $105.00')
  assert.equal(cancel.pay, 'Nothing moves from the wallet')
})

test("Ryntra's builder fee is said when the server routes through it — on a market order in dollars, on a limit as its rate", () => {
  const en = ORDER_COPY.en
  const market = parseOrderReview({
    ...SAMPLE_OPEN_MARKET,
    fees: { ...SAMPLE_OPEN_MARKET.fees, builderBps: 2, builderUsd: 0.010027 },
  })
  assert.equal(reviewView(market, en, 'en').costs[1].value, '0.010027 USDC · 0.02%')
  const limit = parseOrderReview({
    ...SAMPLE_OPEN_LIMIT,
    fees: { ...SAMPLE_OPEN_LIMIT.fees, builderBps: 2, builderUsd: null },
  })
  assert.equal(reviewView(limit, en, 'en').costs[1].value, '0.02% only of the part that fills at once')
  // A cancel fills nothing: no builder's share is said for it.
  const cancel = parseOrderReview({
    ...SAMPLE_CANCEL,
    fees: { ...SAMPLE_CANCEL.fees, builderBps: 2, builderUsd: null },
  })
  assert.equal(reviewView(cancel, en, 'en').costs[1].value, 'none')
})

test("the receipt is Phoenix's record of the signature: fills, fees; resting, waiting and failed said as themselves", () => {
  const en = ORDER_COPY.en
  const market = parseOrderReview(SAMPLE_OPEN_MARKET)
  const filled = receiptView(market, parseOrderResult(SAMPLE_RELAY_FILLED), en, 'en')
  assert.equal(filled.status, 'done')
  assert.equal(filled.title, 'Filled on Phoenix')
  assert.equal(filled.fill, 'Long 0.48 SOL · $103.96')
  assert.equal(filled.line, '+0.48 SOL in the position · Phoenix fee 0.017465 USDC')
  // Landed, but Phoenix's record has not come: the fill is never taken from the Review.
  const landed = receiptView(market, { signature: 's', state: 'LANDED' }, en, 'en')
  assert.equal(landed.fill, null)
  assert.equal(landed.note, 'Phoenix has not shown the fill yet')
  const resting = receiptView(parseOrderReview(SAMPLE_OPEN_LIMIT), parseOrderResult(SAMPLE_RELAY_RESTING), en, 'en')
  assert.equal(resting.title, 'Order in Phoenix’s book')
  assert.equal(resting.note, 'Nothing filled — the order rests')
  assert.equal(receiptView(market, parseOrderResult(SAMPLE_RELAY_PENDING), en, 'en').status, 'pending')
  const failed = receiptView(market, parseOrderResult(SAMPLE_RELAY_FAILED), en, 'en')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.note, 'The order did not go through; the network fee was charged.')
  const closed = receiptView(parseOrderReview(SAMPLE_CLOSE), parseOrderResult(SAMPLE_RELAY_FILLED), ORDER_COPY.uk, 'uk')
  assert.equal(closed.title, 'Позицію закрито')
  assert.equal(closed.fill, 'Шорт 0,48 SOL · $103,96')
})

/** The order routes as doubles: what was asked, and the answers a test sets. */
function routes(answers = {}) {
  const calls = { review: [], submit: [], status: [] }
  return {
    calls,
    api: {
      states: async () => ({ open: false }),
      review: async (session, body) => {
        calls.review.push(body)
        if (answers.review instanceof Error) throw answers.review
        return answers.review ?? SAMPLE_OPEN_MARKET
      },
      submit: async (session, body) => {
        calls.submit.push(body)
        if (answers.submit instanceof Error) throw answers.submit
        return answers.submit ?? SAMPLE_RELAY_FILLED
      },
      status: async (owner, signature) => {
        calls.status.push([owner, signature])
        return answers.status ?? SAMPLE_RELAY_FILLED
      },
    },
  }
}

test('without the gate the server answers ORDERS_CLOSED at the Review: the phone says «view only» — nothing is built or signed', async () => {
  const { api, calls } = routes({
    review: new ApiError('ORDERS_CLOSED', 'Orders are not open for this wallet yet.', 403),
  })
  const reviewed = await reviewOrder(api, SESSION, {
    kind: 'open',
    owner: OWNER,
    symbol: 'SOL',
    side: 'long',
    type: 'market',
    size: '48',
    slippageBps: 50,
  })
  assert.deepEqual(reviewed, { ok: false, reason: 'ORDERS_CLOSED' })
  assert.equal(calls.review.length, 1)
  assert.equal(
    ORDER_COPY.uk.failures[reviewed.reason],
    'Ордери з Ryntra для цього гаманця ще не відкриті — лише перегляд.',
  )
  assert.equal(orderFailureOf('SESSION_EXPIRED'), 'signIn')
  assert.equal(orderFailureOf('SOMETHING_NEW'), 'general')
  assert.equal((await reviewOrder(routes({ review: new TypeError('offline') }).api, SESSION, {})).reason, 'network')
  assert.equal((await reviewOrder(routes({ review: { nonsense: true } }).api, SESSION, {})).reason, 'general')
})

test('the open path: the wallet signs the exact bytes once, the relay gets them with the ticket, the fills come back', async () => {
  const { api, calls } = routes()
  const reviewed = await reviewOrder(
    api,
    SESSION,
    { kind: 'open', owner: OWNER, symbol: 'SOL', side: 'long', type: 'market', size: '48', slippageBps: 50 },
    () => 1_000,
  )
  assert.equal(reviewed.ok, true)
  const handed = []
  let signedTold = 0
  const outcome = await signAndRelay({
    api,
    wallet: { signTransaction: async (wire) => (handed.push(wire), signedWire(OWNER)) },
    session: SESSION,
    review: reviewed.review,
    receivedAt: 1_000,
    wait: { now: () => 2_000, onSigned: () => (signedTold += 1) },
  })
  assert.deepEqual(handed, [reviewed.review.wireBase64])
  assert.equal(signedTold, 1)
  assert.equal(calls.submit.length, 1)
  assert.equal(calls.submit[0].ticket, 'sample-ticket')
  assert.equal(calls.submit[0].signed.length, 1)
  assert.equal(outcome.kind, 'sent')
  assert.equal(outcome.result.state, 'LANDED')
  assert.equal(outcome.result.fills.length, 2)
})

test('bytes too short for a wallet, or signed after their window, are never relayed: the Review is built again', async () => {
  const review = parseOrderReview(SAMPLE_OPEN_MARKET)
  const { api, calls } = routes()
  let asked = 0
  const wallet = { signTransaction: async () => ((asked += 1), signedWire(OWNER)) }
  const early = await signAndRelay({
    api,
    wallet,
    session: SESSION,
    review,
    receivedAt: 0,
    wait: { now: () => 20_000 },
  })
  assert.deepEqual(early, { kind: 'refused', reason: 'reviewAged', afterSignature: false })
  assert.equal(asked, 0)
  let clock = 1_000
  const late = await signAndRelay({
    api,
    wallet: { signTransaction: async () => ((clock = 40_000), signedWire(OWNER)) },
    session: SESSION,
    review,
    receivedAt: 1_000,
    wait: { now: () => clock },
  })
  assert.deepEqual(late, { kind: 'refused', reason: 'reviewAged', afterSignature: true })
  assert.equal(calls.submit.length, 0)
})

test("the wallet's own refusals send nothing; the relay's refusals before sending are said; a lost answer follows the signature", async () => {
  const review = parseOrderReview(SAMPLE_OPEN_MARKET)
  const refuse = await signAndRelay({
    ...routes(),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet: { signTransaction: async () => Promise.reject(new Error('User rejected')) },
    wait: { now: () => 2_000 },
  })
  assert.deepEqual(refuse, { kind: 'refused', reason: 'walletRefused', afterSignature: false })
  const sends = await signAndRelay({
    ...routes(),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet: {
      signTransaction: async () => Promise.reject(Object.assign(new Error('Method not found'), { code: -32601 })),
    },
    wait: { now: () => 2_000 },
  })
  assert.equal(sends.reason, 'walletCannotSign')
  const wallet = { signTransaction: async () => signedWire(OWNER) }
  const closed = await signAndRelay({
    ...routes({ submit: new ApiError('ORDERS_CLOSED', 'closed', 403) }),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet,
    wait: { now: () => 2_000 },
  })
  assert.deepEqual(closed, { kind: 'refused', reason: 'ORDERS_CLOSED', afterSignature: true })
  const canary = await signAndRelay({
    ...routes({ submit: new ApiError('CANARY_LIMIT', 'smaller', 403) }),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet,
    wait: { now: () => 2_000 },
  })
  assert.equal(canary.reason, 'CANARY_LIMIT')
  const expired = await signAndRelay({
    ...routes({ submit: new ApiError('TICKET_EXPIRED', 'old', 410) }),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet,
    wait: { now: () => 2_000 },
  })
  assert.equal(expired.reason, 'reviewAged')
  // A gateway's 504 or no answer at all may hide a send that landed: the receipt asks the chain, never a second relay.
  for (const error of [new ApiError('HTTP_504', 'gateway', 504), new TypeError('Network request failed')]) {
    const lost = await signAndRelay({
      ...routes({ submit: error }),
      session: SESSION,
      review,
      receivedAt: 1_000,
      wallet,
      wait: { now: () => 2_000 },
    })
    assert.equal(lost.kind, 'sent')
    assert.equal(lost.result.state, 'UNKNOWN')
    assert.match(lost.result.signature, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/)
  }
  // A Ledger cannot sign a later version: the wallet is not opened.
  const v1 = await signAndRelay({
    ...routes(),
    session: SESSION,
    review: { ...review, wireBase64: 'gQ==' },
    receivedAt: 1_000,
    wallet,
    wait: { now: () => 2_000 },
  })
  assert.equal(v1.reason, 'txVersion')
})

test("the receipt follows the signature: the chain's word and Phoenix's fills merged in; a failed read keeps what it holds", async () => {
  const { api, calls } = routes({ status: SAMPLE_RELAY_FILLED })
  const pending = parseOrderResult(SAMPLE_RELAY_PENDING)
  const seen = await followOrder(api, OTHER, pending)
  assert.deepEqual(calls.status, [[OTHER, pending.signature]])
  assert.equal(seen.state, 'LANDED')
  assert.equal(seen.fills.length, 2)
  const kept = await followOrder(
    { ...api, status: async () => Promise.reject(new TypeError('offline')) },
    OTHER,
    pending,
  )
  assert.equal(kept, pending)
  const still = await followOrder({ ...api, status: async () => SAMPLE_RELAY_PENDING }, OTHER, pending)
  assert.equal(still, pending)
})

test('AG-2b: an order built again opens the wallet by itself only when it is the same and no worse', () => {
  const shown = parseOrderReview(SAMPLE_OPEN_MARKET)
  assert.equal(sameOrderNoWorse(shown, parseOrderReview({ ...SAMPLE_OPEN_MARKET, priceUsd: 104.4 })), true)
  assert.equal(sameOrderNoWorse(shown, parseOrderReview({ ...SAMPLE_OPEN_MARKET, priceUsd: 104.5 })), false)
  assert.equal(sameOrderNoWorse(shown, parseOrderReview({ ...SAMPLE_OPEN_MARKET, sizeLots: '47' })), false)
  assert.equal(sameOrderNoWorse(shown, parseOrderReview({ ...SAMPLE_OPEN_MARKET, networkFeeLamports: '6000' })), false)
  // A close sells a long: a higher worst price is better for the person.
  const close = parseOrderReview(SAMPLE_CLOSE)
  assert.equal(sameOrderNoWorse(close, parseOrderReview({ ...SAMPLE_CLOSE, priceUsd: 103.5 })), true)
  assert.equal(sameOrderNoWorse(close, parseOrderReview({ ...SAMPLE_CLOSE, priceUsd: 103.3 })), false)
  const limit = parseOrderReview(SAMPLE_OPEN_LIMIT)
  assert.equal(sameOrderNoWorse(limit, parseOrderReview({ ...SAMPLE_OPEN_LIMIT })), true)
  assert.equal(sameOrderNoWorse(limit, parseOrderReview({ ...SAMPLE_OPEN_LIMIT, priceUsd: 104.9 })), false)
})

test('the phone carries the same four routes as the web, and nothing in the futures segment builds, signs or sends on its own', () => {
  const src = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const carrier = src('./orders-api.ts')
  for (const route of [
    "'/api/solana/futures/orders/review'",
    "'/api/solana/futures/orders/submit'",
    '/api/solana/futures/orders/status?',
    '/api/solana/futures/orders${',
  ]) {
    assert.ok(carrier.includes(route), route)
  }
  // The one wallet call is `signTransaction` through the flow: never sign-and-send, never a key.
  const flow = src('./orders-flow.ts')
  assert.match(flow, /input\.wallet\.signTransaction\(review\.wireBase64\)/)
  for (const path of [
    './orders-flow.ts',
    './orders-model.ts',
    './orders-api.ts',
    './use-orders.ts',
    '../../screens/futures/order-sheet.tsx',
  ]) {
    const code = src(path)
    assert.doesNotMatch(code, /signAndSend|sendTransaction|secretKey|Keypair|PHOENIX_ORDERS/, path)
  }
})

test("the critic's cases: an unknown Phoenix fee is a dash and the total says so; NOT_SENT is «not sent»; a Review without its size is none", () => {
  const en = ORDER_COPY.en
  const unknown = reviewView(
    parseOrderReview({ ...SAMPLE_OPEN_MARKET, fees: { ...SAMPLE_OPEN_MARKET.fees, venueUsd: null } }),
    en,
    'en',
  )
  assert.equal(unknown.costs[0].value, '—')
  assert.equal(unknown.total, '≈ — USDC + 0.00204428 SOL')
  // TP/SL and a cancel take no liquidity: their Phoenix fee is a plain 0.
  assert.equal(reviewView(parseOrderReview(SAMPLE_CANCEL), en, 'en').costs[0].value, 'none')
  const notSent = receiptView(parseOrderReview(SAMPLE_OPEN_MARKET), { signature: 's', state: 'NOT_SENT' }, en, 'en')
  assert.equal(notSent.note, 'The order was not sent. Nothing moved.')
  const { sizeLots: _lots, ...noLots } = SAMPLE_OPEN_MARKET
  assert.equal(parseOrderReview(noLots), null)
  const { sizeUnits: _units, ...noUnits } = SAMPLE_OPEN_MARKET
  assert.equal(parseOrderReview(noUnits), null)
})

test('AG-2b: a rebuilt open with its liquidation nearer the mark, or a higher Phoenix fee, is shown again — never signed blind', () => {
  const shown = parseOrderReview(SAMPLE_OPEN_MARKET)
  const nearer = { ...SAMPLE_OPEN_MARKET, priceUsd: 104.4, after: { ...SAMPLE_OPEN_MARKET.after, liquidationUsd: 62 } }
  assert.equal(sameOrderNoWorse(shown, parseOrderReview(nearer)), false)
  const further = { ...SAMPLE_OPEN_MARKET, priceUsd: 104.4, after: { ...SAMPLE_OPEN_MARKET.after, liquidationUsd: 60 } }
  assert.equal(sameOrderNoWorse(shown, parseOrderReview(further)), true)
  const dearer = { ...SAMPLE_OPEN_MARKET, fees: { ...SAMPLE_OPEN_MARKET.fees, venueUsd: 0.02 } }
  assert.equal(sameOrderNoWorse(shown, parseOrderReview(dearer)), false)
})

test('a signature whose bytes cannot be read back is never «nothing moved»: the person is told to check the position', async () => {
  const review = parseOrderReview(SAMPLE_OPEN_MARKET)
  const wallet = { signTransaction: async () => 'AQ==' }
  const lost = await signAndRelay({
    ...routes({ submit: new TypeError('offline') }),
    session: SESSION,
    review,
    receivedAt: 1_000,
    wallet,
    wait: { now: () => 2_000 },
  })
  assert.deepEqual(lost, { kind: 'refused', reason: 'outcomeUnknown', afterSignature: true })
  assert.match(ORDER_COPY.en.failures.outcomeUnknown, /may have been sent/)
})

test("the critic's round 2: a fill that cannot be read makes the fills unknown; a receipt past its two minutes points to the explorer", () => {
  const partial = parseOrderResult({
    results: [
      {
        signature: 's',
        state: 'LANDED',
        fills: [{ sizeUnits: 0.3, priceUsd: 103.95, feeUsd: 0.01 }, { sizeUnits: 'x' }],
      },
    ],
  })
  assert.equal(partial.fills, null)
  const market = parseOrderReview(SAMPLE_OPEN_MARKET)
  const pending = parseOrderResult(SAMPLE_RELAY_PENDING)
  assert.match(receiptView(market, pending, ORDER_COPY.en, 'en', true).note, /follows it/)
  assert.match(receiptView(market, pending, ORDER_COPY.en, 'en', false).note, /explorer/)
  // A position's size Phoenix could not read is never drawn as «0» on the sheet.
  const sheet = readFileSync(fileURLToPath(new URL('../../screens/futures/order-sheet.tsx', import.meta.url)), 'utf8')
  assert.doesNotMatch(sheet, /size \?\? 0/)
})
