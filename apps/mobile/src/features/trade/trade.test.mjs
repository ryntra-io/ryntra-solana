import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder } from '@solana/kit'

import { ApiError } from '../../lib/api.ts'
import {
  failureFrom,
  ORDER_RETRY_MAX_MS,
  orderRetryDelay,
  prepareReview,
  recoverAttempt,
  releaseReview,
  signAndSend,
} from './trade-flow.ts'
import {
  additionalJupiterFeeBps,
  assessReview,
  formatUnits,
  lamportsToSol,
  parseAmount,
  observationFromReceipt,
  parseTradeAttempt,
  priceImpactPercent,
  readTakerSignature,
  REQUIRED_RULES,
  reviewView,
  secondsLeft,
  serviceFeeText,
  settledView,
  SOL_ASSET,
  ticketLegs,
  tradeFailureCopy,
  tradeOrigin,
  transitionTradeAttempt,
  USDC_ASSET,
} from './trade-model.ts'

/* Test doubles for the flow's shape — no server, no wallet, no key, nothing
   the app can reach. The transaction bytes are a real legacy-format wire the
   kit decodes, with the taker as the one signer; the "wallet" fills its
   signature slot and nothing else. */

const TAKER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const OTHER = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const NVDA = {
  mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  symbol: 'NVDAx',
  name: 'NVIDIA xStock',
  icon: null,
  decimals: 8,
}
const NOW = Date.parse('2026-09-16T12:00:00.000Z')

const session = {
  address: TAKER,
  token: 'test-double-token-0123456789',
  issuedAt: 'now',
  expiresAt: 'later',
  sessionId: null,
}

/** A minimal legacy transaction wire: one signature slot for the taker, an empty message the kit still decodes. */
function unsignedWire() {
  const takerBytes = base58ToBytes(TAKER)
  const message = new Uint8Array([
    1,
    0,
    0, // header: 1 signer, 0 readonly signed, 0 readonly unsigned
    1,
    ...takerBytes, // one static account: the taker
    ...new Uint8Array(32), // blockhash
    0, // no instructions
  ])
  const wire = new Uint8Array(1 + 64 + message.length)
  wire[0] = 1
  wire.set(message, 65)
  return getBase64Decoder().decode(wire)
}

function base58ToBytes(text) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let value = 0n
  for (const char of text) value = value * 58n + BigInt(ALPHABET.indexOf(char))
  const bytes = []
  while (value > 0n) {
    bytes.unshift(Number(value % 256n))
    value /= 256n
  }
  for (const char of text) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  return new Uint8Array(bytes)
}

/** The wallet's answer: the same bytes with a 64-byte signature in the taker's slot. */
function walletSigns(unsignedBase64, fill = 7) {
  const wire = new Uint8Array(getBase64Encoder().encode(unsignedBase64))
  wire.fill(fill, 1, 65)
  return getBase64Decoder().decode(wire)
}

const verdict = (over = {}) => ({
  decision: 'ALLOW',
  findings: REQUIRED_RULES.map((rule) => ({ rule, outcome: 'PASS', detail: `${rule} ok` })),
  ...over,
})

const orderCore = (over = {}) => ({
  requestId: 'req-1',
  inputMint: USDC_ASSET.mint,
  outputMint: NVDA.mint,
  inAmountRaw: '100000000', // 100 USDC
  outAmountRaw: '46800000', // 0.468 NVDAx
  minReceivedRaw: '46500000',
  slippageBps: 50,
  priceImpactPct: '0.0123',
  router: 'jupiter',
  platformFee: { basisPoints: 10, mint: USDC_ASSET.mint },
  totalFeeBasisPoints: 10,
  ryntraFee: {
    mechanism: 'JUPITER_REFERRAL',
    state: 'APPLIED',
    basisPoints: 10,
    requestedBasisPoints: 10,
    asset: USDC_ASSET.mint,
    symbol: 'USDC',
    decimals: 6,
    amountRaw: '100000',
    usd: null,
  },
  signatureFeeLamports: '5000',
  priorityFeeLamports: '15000',
  rentFeeLamports: '2039280',
  inUsdValue: '100',
  outUsdValue: '99.9',
  swapUsdValue: '100',
  route: [{ label: 'Raydium', basisPoints: 10000 }],
  taker: TAKER,
  observedAt: new Date(NOW).toISOString(),
  reviewExpiresAt: new Date(NOW + 90_000).toISOString(),
  ...over,
})

function orderResponse(over = {}) {
  return {
    order: { ...orderCore(), transactionBase64: unsignedWire(), lastValidBlockHeight: '1' },
    simulation: {
      status: 'OK',
      ownerEffects: { status: 'VERIFIED', outputAmountRaw: '46800000', inputAmountRaw: '100000000' },
    },
    policy: { verdict: verdict() },
    decimals: { [USDC_ASSET.mint]: 6, [NVDA.mint]: 8 },
    bundle: { issuer: 'signed-bundle' },
    proof: { status: 'SIGNED', digest: '0xabc' },
    preSign: { ready: true, code: 'READY', reason: 'ok' },
    expiresAt: new Date(NOW + 90_000).toISOString(),
    ...over,
  }
}

function apiDouble(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      quote: async (input) => {
        calls.push(['quote', input])
        return {
          order: orderCore(),
          verdict: { verdict: 'ALLOWED' },
          decimals: { [USDC_ASSET.mint]: 6, [NVDA.mint]: 8 },
          expiresAt: orderCore().reviewExpiresAt,
        }
      },
      order: async (s, input, origin) => {
        calls.push(['order', s.address, input, origin])
        return orderResponse()
      },
      execute: async (s, input) => {
        calls.push(['execute', s.address, input.signedTransactionBase64 !== input.reviewedTransactionBase64])
        return {
          state: 'MATCHED',
          signature: 'sig',
          observation: { actualInputRaw: '100000000', actualOutputRaw: '46700000' },
          facts: { reconciliation: { state: 'OK', minimumMet: true, deviations: [] } },
          receipt: {},
        }
      },
      recover: async (s, input) => {
        calls.push(['recover', input.signature])
        return {
          state: 'RECOVERED',
          signature: input.signature,
          observation: { actualInputRaw: '100000000', actualOutputRaw: '46800000' },
          facts: { reconciliation: { state: 'OK', minimumMet: true } },
          receipt: {},
        }
      },
      cancel: async (s, input) => {
        calls.push(['cancel', input.requestId])
        return { state: 'EXPIRED_BEFORE_SUBMIT' }
      },
      ...over,
    },
  }
}

function attemptsDouble() {
  const map = new Map()
  return {
    get: (taker) => map.get(taker) ?? null,
    set: (attempt) => map.set(attempt.taker, attempt),
    clear: (taker) => map.delete(taker),
    map,
  }
}

const walletDouble = (over = {}) => ({ signTransaction: async (wire) => walletSigns(wire), ...over })

test('the ticket has two legs from the mode: a Buy pays the quote asset, a Sell receives it, a Swap is what was chosen; never the same mint', () => {
  assert.deepEqual(ticketLegs('buy', { asset: NVDA, quote: USDC_ASSET, pay: null, receive: null }), {
    pay: USDC_ASSET,
    receive: NVDA,
  })
  assert.deepEqual(ticketLegs('sell', { asset: NVDA, quote: SOL_ASSET, pay: null, receive: null }), {
    pay: NVDA,
    receive: SOL_ASSET,
  })
  assert.deepEqual(ticketLegs('swap', { asset: null, quote: USDC_ASSET, pay: SOL_ASSET, receive: NVDA }), {
    pay: SOL_ASSET,
    receive: NVDA,
  })
  assert.deepEqual(ticketLegs('swap', { asset: null, quote: USDC_ASSET, pay: SOL_ASSET, receive: SOL_ASSET }), {
    pay: SOL_ASSET,
    receive: null,
  })
  assert.deepEqual(ticketLegs('buy', { asset: USDC_ASSET, quote: USDC_ASSET, pay: null, receive: null }), {
    pay: USDC_ASSET,
    receive: null,
  })
  assert.deepEqual(tradeOrigin('buy'), { surface: 'SPOT', side: 'BUY' })
  assert.deepEqual(tradeOrigin('sell'), { surface: 'SPOT', side: 'SELL' })
  assert.equal(tradeOrigin('swap'), null)
  // M16: a Buy under an autoinvest reminder names the rule and the occurrence; a Sell never does.
  const rule = { ruleId: 'rule_5e1f0c2a9b8d4e7f6a3c1b0d9e8f7a6b', dueAt: '2026-09-24T16:00:00.000Z' }
  assert.deepEqual(tradeOrigin('buy', null, rule), { surface: 'SPOT', side: 'BUY', rule })
  assert.deepEqual(tradeOrigin('sell', null, rule), { surface: 'SPOT', side: 'SELL' })
  assert.equal(tradeOrigin('swap', null, rule), null)
})

test('amounts: a typed figure becomes raw units, raw units read back in the person’s units', () => {
  assert.equal(parseAmount('100', 6), '100000000')
  assert.equal(parseAmount('0.5', 9), '500000000')
  assert.equal(parseAmount('1,25', 2), '125')
  assert.equal(parseAmount('0.1234567', 6), '123456', 'beyond the decimals is cut, never rounded up')
  assert.equal(parseAmount('0', 6), null)
  assert.equal(parseAmount('', 6), null)
  assert.equal(parseAmount('abc', 6), null)
  assert.equal(parseAmount('1', null), null)
  assert.equal(parseAmount('-1', 6), null)
  assert.equal(formatUnits('46800000', 8, 6, 'en'), '0.468')
  assert.equal(formatUnits('100000000', 6, 6, 'en'), '100')
  assert.equal(formatUnits('123456789012', 6, 6, 'en'), '123,456.789012')
  assert.equal(formatUnits('5', 9, 6, 'en'), '0', 'six places at most; a figure below them reads as zero')
  assert.equal(formatUnits('5', 9, 9, 'en'), '0.000000005')
  assert.equal(lamportsToSol(['5000', '15000'], 'en'), '0.00002')
  assert.equal(lamportsToSol(['2039280'], 'en'), '0.002039')
  assert.equal(priceImpactPercent('0.0123'), 0.01)
  assert.equal(priceImpactPercent('-0.0001'), 0, 'a favourable impact is not a warning')
  assert.equal(priceImpactPercent('x'), null)
  assert.equal(secondsLeft(new Date(NOW + 30_500).toISOString(), NOW), 31)
  assert.equal(secondsLeft(new Date(NOW - 1).toISOString(), NOW), 0)
  assert.equal(serviceFeeText(orderCore().ryntraFee, 'en'), '0.10% · 0.1 USDC')
  assert.equal(serviceFeeText({ ...orderCore().ryntraFee, amountRaw: null, usd: 0.004 }, 'en'), '0.10% · < $0.01')
  assert.equal(serviceFeeText({ ...orderCore().ryntraFee, basisPoints: 0 }, 'en'), 'None')
})

test('the Review’s rows: expected and minimum received, the price of what is held, impact, slippage, every known cost, the notes', () => {
  const view = reviewView(
    {
      order: orderCore(),
      mode: 'buy',
      pay: USDC_ASSET,
      receive: NVDA,
      decimals: { [USDC_ASSET.mint]: 6, [NVDA.mint]: 8 },
      exact: true,
      findings: [{ rule: 'SLIPPAGE_BOUNDED', outcome: 'REVIEW', detail: 'Slippage is wider than usual.' }],
    },
    'en',
  )
  assert.ok(view)
  assert.equal(view.pay, '100 USDC')
  assert.equal(view.receive, '0.468 NVDAx')
  const labels = view.rows.map((row) => row.label)
  assert.deepEqual(labels, [
    'You receive',
    'Minimum received',
    'Price',
    'Price impact',
    'Slippage',
    'Network fee',
    'Account reserve',
    'Ryntra service fee',
  ])
  assert.equal(view.rows.find((row) => row.emphasis).value, '0.465 NVDAx')
  assert.match(view.rows[2].value, /^1 NVDAx ≈ 213\.67/)
  assert.equal(view.rows[3].value, '0.01%')
  assert.equal(view.rows[4].value, '0.50%')
  assert.equal(view.rows[5].value, '0.00002 SOL')
  assert.equal(view.rows[6].value, '0.002039 SOL')
  assert.equal(view.rows[7].value, '0.10% · 0.1 USDC')
  // The finding's own sentence is never shown: the web's words by the rule — here a minimum that disagrees with the bound.
  assert.deepEqual(view.warnings, ['The quote and minimum received use different slippage.'])
  // An estimate before the order: no slippage, no network fees, the label says estimate.
  const estimate = reviewView(
    {
      order: orderCore(),
      mode: 'sell',
      pay: NVDA,
      receive: USDC_ASSET,
      decimals: {},
      exact: false,
    },
    'en',
  )
  assert.equal(estimate.rows[0].label, 'You receive · estimate')
  assert.equal(
    estimate.rows.some((row) => row.label === 'Minimum received'),
    false,
    'an estimate promises no minimum',
  )
  assert.equal(
    estimate.rows.some((row) => row.label === 'Network fee'),
    false,
  )
  assert.match(estimate.rows.find((row) => row.label === 'Price').value, /^1 NVDAx ≈ /)
  // A Swap paid in USDC prices what is received, like a Buy; paid in anything else it prices what is paid.
  const usdcSwap = reviewView(
    {
      order: orderCore(),
      mode: 'swap',
      pay: USDC_ASSET,
      receive: NVDA,
      decimals: {},
      exact: false,
    },
    'en',
  )
  assert.match(usdcSwap.rows.find((row) => row.label === 'Price').value, /^1 NVDAx ≈ /)
  const solSwap = reviewView(
    {
      order: orderCore({ inputMint: SOL_ASSET.mint, outputMint: USDC_ASSET.mint }),
      mode: 'swap',
      pay: SOL_ASSET,
      receive: USDC_ASSET,
      decimals: {},
      exact: false,
    },
    'en',
  )
  assert.match(solSwap.rows.find((row) => row.label === 'Price').value, /^1 SOL ≈ /)
  // Unknown decimals: no rows are invented.
  assert.equal(
    reviewView(
      {
        order: orderCore(),
        mode: 'buy',
        pay: USDC_ASSET,
        receive: { ...NVDA, decimals: null },
        decimals: {},
        exact: false,
      },
      'en',
    ),
    null,
  )
})

test('the readiness rule before a wallet opens: signed proof, clean simulation, proven effects, a window with ten seconds, no blocking rule', () => {
  const base = {
    verdict: verdict(),
    proofStatus: 'SIGNED',
    simulationStatus: 'OK',
    ownerEffectsStatus: 'VERIFIED',
    expiresAt: new Date(NOW + 60_000).toISOString(),
    now: NOW,
  }
  assert.equal(assessReview(base).ready, true)
  assert.equal(assessReview({ ...base, proofStatus: 'UNSIGNED' }).code, 'PROOF_NOT_SIGNED')
  assert.equal(assessReview({ ...base, simulationStatus: 'FAILED' }).code, 'SIMULATION_NOT_CLEAR')
  assert.equal(assessReview({ ...base, ownerEffectsStatus: 'MISSING' }).code, 'EFFECTS_NOT_VERIFIED')
  assert.equal(assessReview({ ...base, now: NOW + 60_000 }).code, 'ORDER_EXPIRED')
  assert.equal(assessReview({ ...base, now: NOW + 51_000 }).code, 'ORDER_TOO_SHORT')
  assert.equal(assessReview({ ...base, invalidated: true }).code, 'REVIEW_INVALIDATED')
  const blocked = verdict({
    findings: verdict().findings.map((f) => (f.rule === 'PAYOUT_TO_SIGNER' ? { ...f, outcome: 'BLOCK' } : f)),
  })
  assert.equal(assessReview({ ...base, verdict: blocked }).code, 'POLICY_BLOCKED')
  const incomplete = verdict({ findings: verdict().findings.slice(1) })
  assert.equal(assessReview({ ...base, verdict: incomplete }).code, 'POLICY_BLOCKED')
  const reviewed = verdict({
    decision: 'REVIEW',
    findings: verdict().findings.map((f) => (f.rule === 'SLIPPAGE_BOUNDED' ? { ...f, outcome: 'REVIEW' } : f)),
  })
  assert.equal(
    assessReview({ ...base, verdict: reviewed }).ready,
    true,
    'a REVIEW finding is a note on the card, not a block',
  )
})

test('the words for a refusal say what happened and whether pressing again can help', () => {
  assert.deepEqual(tradeFailureCopy('FORBIDDEN_ORIGIN'), {
    key: 'forbiddenOrigin',
    message: 'Signing from the app is not open on the server yet.',
    retryable: false,
  })
  assert.equal(tradeFailureCopy('ORDER_BUILD_FAILED').retryable, true)
  assert.match(tradeFailureCopy('ORDER_BUILD_FAILED').message, /does not cover/)
  assert.equal(tradeFailureCopy('QUOTE_NO_ROUTE').message, 'No route for this pair right now.')
  assert.equal(tradeFailureCopy('SWAP_PRE_SIGN_REFUSED').retryable, false)
  assert.equal(tradeFailureCopy('OWNER_SWAP_LOCKED').message, 'Checking the previous swap. Try again in a moment.')
  assert.equal(tradeFailureCopy('WALLET_REFUSED').message, 'Wallet approval was cancelled.')
  assert.equal(tradeFailureCopy('HTTP_504').retryable, true)
  assert.equal(tradeFailureCopy('UNAUTHORIZED').message, 'Sign in with your wallet to trade.')
  assert.equal(tradeFailureCopy('SOMETHING_ELSE').message, 'The trade could not continue. Try again.')
  const failure = failureFrom(
    new ApiError('OWNER_SWAP_LOCKED', 'locked', 409, null, {
      ownerLock: { state: 'SIGNED', requestId: 'req-9', signature: 'sig9' },
    }),
  )
  assert.deepEqual(failure.ownerLock, { state: 'SIGNED', requestId: 'req-9', signature: 'sig9' })
  assert.equal(
    failureFrom(new ApiError('EXECUTE_FAILED', 'x', 409, null, { submitBoundary: 'NOT_CROSSED' })).notCrossed,
    true,
  )
  assert.equal(failureFrom(new TypeError('Network request failed')).code, 'NETWORK')
})

test('the attempt record survives storage and is judged by what the server said', () => {
  const attempt = {
    schema: 'ryntra.mobile.trade-attempt',
    schemaVersion: '1.0.0',
    requestId: 'req-1',
    signature: '5'.repeat(88),
    taker: TAKER,
    state: 'SIGNED_NOT_SENT',
    recordedAt: new Date(NOW).toISOString(),
    context: null,
  }
  assert.deepEqual(parseTradeAttempt(JSON.stringify(attempt)), attempt)
  assert.equal(parseTradeAttempt(JSON.stringify({ ...attempt, signature: 'short' })), null)
  assert.equal(parseTradeAttempt(JSON.stringify({ ...attempt, state: 'NOPE' })), null)
  assert.equal(parseTradeAttempt('garbage'), null)
  assert.equal(parseTradeAttempt(null), null)
  assert.equal(transitionTradeAttempt(attempt, { kind: 'FAILURE' }).state, 'SUBMITTED_UNKNOWN')
  assert.equal(
    transitionTradeAttempt(attempt, { kind: 'SUCCESS', serverState: 'RECOVERY_PENDING' }).state,
    'SUBMITTED_UNKNOWN',
  )
  assert.equal(transitionTradeAttempt(attempt, { kind: 'SUCCESS', serverState: 'RECEIPTED' }).state, 'SETTLED')
  assert.equal(
    transitionTradeAttempt(attempt, { kind: 'SUCCESS', serverState: 'FAILED' }).state,
    'SETTLED',
    'a failed landing is a settled outcome, not an open one',
  )
})

test('the taker’s signature is read out of the signed wire; an unsigned or foreign slot yields none', () => {
  const unsigned = unsignedWire()
  assert.equal(readTakerSignature(unsigned, TAKER), null, 'no signature yet')
  const signed = walletSigns(unsigned, 9)
  const signature = readTakerSignature(signed, TAKER)
  assert.ok(signature && signature.length >= 64)
  assert.equal(readTakerSignature(signed, OTHER), null)
  assert.equal(readTakerSignature('not base64!', TAKER), null)
  // The kit round-trips the same bytes: what was signed is what is sent.
  const decoded = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(signed)))
  assert.equal(getBase64Decoder().decode(getTransactionEncoder().encode(decoded)), signed)
})

test('prepare: the exact Review for the session’s wallet, judged before it is shown', async () => {
  const { api, calls } = apiDouble()
  const outcome = await prepareReview({
    api,
    session,
    attempts: attemptsDouble(),
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '100000000',
    origin: tradeOrigin('buy'),
    now: () => NOW,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.prepared.context.mode, 'buy')
  assert.equal(outcome.prepared.context.receiveDecimals, 8)
  assert.deepEqual(calls[0], [
    'order',
    TAKER,
    { inputMint: USDC_ASSET.mint, outputMint: NVDA.mint, amountRaw: '100000000' },
    { surface: 'SPOT', side: 'BUY' },
  ])
  // A refused pre-sign or a blocked policy never reaches a wallet.
  const refused = apiDouble({
    order: async () => orderResponse({ preSign: { ready: false, code: 'SWAP_PRE_SIGN_REFUSED', reason: 'no' } }),
  })
  const a = await prepareReview({
    api: refused.api,
    session,
    attempts: attemptsDouble(),
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(a.ok, false)
  assert.equal(a.failure.code, 'SWAP_PRE_SIGN_REFUSED')
  const expired = apiDouble({ order: async () => orderResponse({ expiresAt: new Date(NOW + 3_000).toISOString() }) })
  const b = await prepareReview({
    api: expired.api,
    session,
    attempts: attemptsDouble(),
    mode: 'swap',
    pay: SOL_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(b.ok, false)
  assert.equal(b.failure.code, 'ORDER_TOO_SHORT')
  // The server not open to the app yet: the one line, not retryable.
  const closed = apiDouble({
    order: async () => {
      throw new ApiError('FORBIDDEN_ORIGIN', 'must come from this site', 403)
    },
  })
  const c = await prepareReview({
    api: closed.api,
    session,
    attempts: attemptsDouble(),
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(c.ok, false)
  assert.equal(c.failure.message, 'Signing from the app is not open on the server yet.')
  assert.equal(c.failure.retryable, false)
})

test('prepare: the venue’s «too many requests» is asked again twice with a pause, then said; nothing else is repeated', async () => {
  const limited = () => new ApiError('ORDER_RATE_LIMITED', 'rate limited', 429)
  const base = {
    session,
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1000000',
    origin: tradeOrigin('buy'),
    now: () => NOW,
  }
  // Refused once, then built: the Review stands, after one pause.
  let first = 0
  const once = apiDouble({
    order: async () => {
      first += 1
      if (first === 1) throw limited()
      return orderResponse()
    },
  })
  const waits = []
  const a = await prepareReview({
    ...base,
    api: once.api,
    attempts: attemptsDouble(),
    wait: async (ms) => waits.push(ms),
  })
  assert.equal(a.ok, true)
  assert.equal(first, 2)
  assert.deepEqual(waits, [1_500])
  // Refused every time: three asks, two pauses, then the one line.
  let asked = 0
  const always = apiDouble({
    order: async () => {
      asked += 1
      throw limited()
    },
  })
  const waited = []
  const b = await prepareReview({
    ...base,
    api: always.api,
    attempts: attemptsDouble(),
    wait: async (ms) => waited.push(ms),
  })
  assert.equal(b.ok, false)
  assert.equal(b.failure.code, 'ORDER_RATE_LIMITED')
  assert.equal(asked, 3)
  assert.deepEqual(waited, [1_500, 3_000])
  // A pause the server names is kept when longer, never past the cap; Ryntra's own limit and any other refusal are not repeated.
  assert.equal(orderRetryDelay(new ApiError('ORDER_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 4 }), 0), 4_000)
  // A pause longer than the phone waits out is not waited: the refusal is said, never asked again early.
  assert.equal(orderRetryDelay(new ApiError('ORDER_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 60 }), 1), null)
  assert.equal(
    orderRetryDelay(new ApiError('ORDER_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 5 }), 0),
    ORDER_RETRY_MAX_MS,
  )
  // Closed during a pause: the order is not asked again.
  let asks = 0
  let open = true
  const closing = apiDouble({
    order: async () => {
      asks += 1
      throw limited()
    },
  })
  const c = await prepareReview({
    ...base,
    api: closing.api,
    attempts: attemptsDouble(),
    wait: async () => {
      open = false
    },
    cancelled: () => !open,
  })
  assert.equal(c.ok, false)
  assert.equal(asks, 1, 'the sheet closed during the pause — no second ask')
  assert.equal(orderRetryDelay(new ApiError('ORDER_RATE_LIMITED', 'x', 429), 2), null)
  assert.equal(orderRetryDelay(new ApiError('RATE_LIMITED', 'x', 429), 0), null)
  assert.equal(orderRetryDelay(new ApiError('ORDER_NO_ROUTE', 'x', 422), 0), null)
  // The venue's refusal of a moment is asked again once; its own failure twice; then it is said.
  assert.equal(orderRetryDelay(new ApiError('ORDER_REFUSED', 'x', 502), 0), 1_500)
  assert.equal(orderRetryDelay(new ApiError('ORDER_HTTP_ERROR', 'x', 502), 1), 3_000)
  assert.equal(orderRetryDelay(new ApiError('ORDER_REFUSED', 'x', 502), 1), null)
  assert.equal(orderRetryDelay(new ApiError('ORDER_HTTP_ERROR', 'x', 502), 2), null)
  // A wallet short of funds, or a check that refused the bytes, is never asked again.
  assert.equal(orderRetryDelay(new ApiError('ORDER_BUILD_FAILED', 'x', 409), 0), null)
  assert.equal(orderRetryDelay(new ApiError('SWAP_PRE_SIGN_REFUSED', 'x', 409), 0), null)
  assert.equal(orderRetryDelay(new Error('offline'), 0), null)
})

test('prepare: an unresolved signature of this wallet — on the phone or on the server — is checked, never signed over', async () => {
  const attempts = attemptsDouble()
  attempts.set({
    schema: 'ryntra.mobile.trade-attempt',
    schemaVersion: '1.0.0',
    requestId: 'req-0',
    signature: '4'.repeat(88),
    taker: TAKER,
    state: 'SUBMITTED_UNKNOWN',
    recordedAt: new Date(NOW).toISOString(),
    context: null,
  })
  const { api, calls } = apiDouble()
  const a = await prepareReview({
    api,
    session,
    attempts,
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(a.ok, false)
  assert.equal(a.failure.code, 'ATTEMPT_OPEN')
  assert.equal(a.attempt.requestId, 'req-0')
  assert.deepEqual(calls, [], 'no order was asked for')
  // The server holds a signed attempt this phone never saw: it becomes the attempt to recover.
  const locked = apiDouble({
    order: async () => {
      throw new ApiError('OWNER_SWAP_LOCKED', 'open', 409, null, {
        ownerLock: { state: 'SIGNED', requestId: 'req-web', signature: '3'.repeat(88) },
      })
    },
  })
  const fresh = attemptsDouble()
  const b = await prepareReview({
    api: locked.api,
    session,
    attempts: fresh,
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(b.ok, false)
  assert.equal(b.attempt.signature, '3'.repeat(88))
  assert.equal(fresh.get(TAKER).state, 'SUBMITTED_UNKNOWN')
  // An open Review nobody signed can be released.
  const unsigned = apiDouble({
    order: async () => {
      throw new ApiError('OWNER_SWAP_LOCKED', 'open', 409, null, {
        ownerLock: { state: 'REVIEW_ISSUED', requestId: 'req-open', signature: null },
      })
    },
  })
  const c = await prepareReview({
    api: unsigned.api,
    session,
    attempts: attemptsDouble(),
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(c.ok, false)
  assert.deepEqual(c.lockedReview, { requestId: 'req-open' })
  const released = await releaseReview({ api: unsigned.api, session, requestId: 'req-open' })
  assert.equal(released.ok, true)
  assert.deepEqual(unsigned.calls.at(-1), ['cancel', 'req-open'])
})

test('sign and send: the wallet signs the reviewed bytes, the attempt is remembered before the send, the server settles it', async () => {
  const { api, calls } = apiDouble()
  const attempts = attemptsDouble()
  const prepared = (
    await prepareReview({
      api,
      session,
      attempts,
      mode: 'buy',
      pay: USDC_ASSET,
      receive: NVDA,
      amountRaw: '100000000',
      origin: tradeOrigin('buy'),
      now: () => NOW,
    })
  ).prepared
  const seen = []
  const outcome = await signAndSend({
    api: {
      ...api,
      execute: async (s, input) => {
        seen.push(attempts.get(TAKER)?.state)
        return api.execute(s, input)
      },
    },
    wallet: walletDouble(),
    session,
    attempts,
    prepared,
    now: () => NOW + 1_000,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.settlement.state, 'MATCHED')
  assert.deepEqual(seen, ['SIGNED_NOT_SENT'], 'the signature was on the device before the send')
  assert.equal(attempts.get(TAKER), null, 'a settled attempt is history, not a lock')
  assert.equal(
    calls.find((c) => c[0] === 'execute')[2],
    true,
    'the signed bytes differ from the reviewed ones only by the signature',
  )
  const card = settledView(outcome.settlement, prepared.context)
  assert.equal(card.status, 'settled')
  assert.equal(card.title, 'Bought NVDAx')
  assert.equal(card.paid, '100 USDC')
  assert.equal(card.received, '0.467 NVDAx', 'the chain’s figure, not the quote’s')
  assert.equal(
    card.note,
    'Filled below the quote, above the minimum: −0.001 NVDAx.',
    'the fill against the quote, as a figure',
  )
})

test('sign and send: the wallet’s refusal, an unreadable signature and a window closed under the wallet send nothing', async () => {
  const { api, calls } = apiDouble()
  const attempts = attemptsDouble()
  const prepared = (
    await prepareReview({
      api,
      session,
      attempts,
      mode: 'buy',
      pay: USDC_ASSET,
      receive: NVDA,
      amountRaw: '100000000',
      origin: null,
      now: () => NOW,
    })
  ).prepared
  const declined = await signAndSend({
    api,
    wallet: walletDouble({
      signTransaction: async () => {
        throw Object.assign(new Error('declined'), { code: -3 })
      },
    }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(declined.ok, false)
  assert.equal(declined.phase, 'review')
  assert.equal(declined.failure.message, 'Wallet approval was cancelled.')
  const unsigned = await signAndSend({
    api,
    wallet: walletDouble({ signTransaction: async (wire) => wire }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(unsigned.ok, false)
  assert.equal(unsigned.failure.code, 'SIGNATURE_UNREADABLE')
  let tick = 0
  const late = await signAndSend({
    api,
    wallet: walletDouble(),
    session,
    attempts,
    prepared,
    now: () => (tick++ === 0 ? NOW : NOW + 200_000),
    sleep: () => new Promise(() => {}),
  })
  assert.equal(late.ok, false)
  assert.equal(late.failure.code, 'REVIEW_CLOSED_UNDER_WALLET')
  assert.equal(late.invalidated, true)
  const timedOut = await signAndSend({
    api,
    wallet: walletDouble({ signTransaction: () => new Promise(() => {}) }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: async () => undefined,
  })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.failure.code, 'WALLET_TIMEOUT')
  assert.equal(
    calls.some((c) => c[0] === 'execute'),
    false,
    'nothing was ever sent',
  )
  assert.equal(attempts.get(TAKER), null)
})

test('sign and send: a refusal before the network frees the wallet; an unknown answer is a recovery state for that signature', async () => {
  const attempts = attemptsDouble()
  const notCrossed = apiDouble({
    execute: async () => {
      throw new ApiError('ORDER_EXPIRED', 'expired', 409, null, { submitBoundary: 'NOT_CROSSED' })
    },
  })
  const prepared = (
    await prepareReview({
      api: notCrossed.api,
      session,
      attempts,
      mode: 'sell',
      pay: NVDA,
      receive: USDC_ASSET,
      amountRaw: '46800000',
      origin: tradeOrigin('sell'),
      now: () => NOW,
    })
  ).prepared
  const a = await signAndSend({
    api: notCrossed.api,
    wallet: walletDouble(),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(a.ok, false)
  assert.equal(a.phase, 'review')
  assert.equal(a.invalidated, true)
  assert.equal(attempts.get(TAKER), null, 'the signature was let go')
  const unknown = apiDouble({
    execute: async () => {
      throw new TypeError('Network request failed')
    },
  })
  const b = await signAndSend({
    api: unknown.api,
    wallet: walletDouble(),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(b.ok, false)
  assert.equal(b.phase, 'recovery')
  assert.equal(b.attempt.state, 'SUBMITTED_UNKNOWN')
  assert.equal(attempts.get(TAKER).state, 'SUBMITTED_UNKNOWN', 'the app closing now finds it')
  const again = await prepareReview({
    api: unknown.api,
    session,
    attempts,
    mode: 'buy',
    pay: USDC_ASSET,
    receive: NVDA,
    amountRaw: '1',
    origin: null,
    now: () => NOW,
  })
  assert.equal(again.ok, false)
  assert.equal(again.failure.code, 'ATTEMPT_OPEN', 'no second order while one signature is out')
})

test('the execute route’s reconciliation states are fills: MATCHED as reviewed, DEVIATION_RECORDED with a note; UNKNOWN and RECOVERY are pending', () => {
  const context = {
    mode: 'buy',
    pay: USDC_ASSET,
    receive: SOL_ASSET,
    payDecimals: 6,
    receiveDecimals: 9,
    inAmountRaw: '4836823',
    outAmountRaw: '49799705',
    minReceivedRaw: '49645325',
  }
  const matched = settledView(
    {
      state: 'MATCHED',
      signature: 'sig',
      observation: { actualInputRaw: '4836823', actualOutputRaw: '49796121' },
      facts: { reconciliation: { state: 'MATCHED', minimumMet: true, deviations: [] } },
      receipt: {},
    },
    context,
  )
  assert.equal(matched.status, 'settled')
  assert.equal(matched.title, 'Bought SOL')
  assert.equal(matched.paid, '4.836823 USDC')
  assert.equal(matched.received, '0.049796 SOL', 'the chain’s figure')
  assert.equal(matched.note, 'Filled below the quote, above the minimum: −0.000003 SOL.')
  const above = settledView(
    {
      state: 'MATCHED',
      signature: 'sig',
      observation: { actualInputRaw: '4836823', actualOutputRaw: '49900000' },
      facts: { reconciliation: { state: 'MATCHED', minimumMet: true, deviations: ['OUTPUT_MISMATCH'] } },
      receipt: {},
    },
    context,
  )
  assert.equal(above.note, 'Filled above the quote: +0.000100 SOL.'.replace('+0.000100', '+0.0001'))
  const exact = settledView(
    {
      state: 'MATCHED',
      signature: 'sig',
      observation: { actualInputRaw: '4836823', actualOutputRaw: '49799705' },
      facts: { reconciliation: { state: 'MATCHED', minimumMet: true, deviations: [] } },
      receipt: {},
    },
    context,
  )
  assert.equal(exact.note, null)
  const deviated = settledView(
    {
      state: 'DEVIATION_RECORDED',
      signature: 'sig',
      observation: { actualInputRaw: '4836823', actualOutputRaw: '49600000' },
      facts: { reconciliation: { state: 'DEVIATION_RECORDED', minimumMet: false, deviations: ['OUTPUT_MISMATCH'] } },
      receipt: {},
    },
    context,
  )
  assert.equal(deviated.status, 'settled')
  assert.match(deviated.note, /differ from the Review/)
  assert.equal(
    settledView({ state: 'UNKNOWN', signature: 'sig', observation: null, facts: null, receipt: null }, context).status,
    'pending',
  )
  assert.equal(
    settledView({ state: 'RECOVERY', signature: 'sig', observation: null, facts: null, receipt: null }, context).status,
    'pending',
  )
  assert.equal(
    transitionTradeAttempt(
      {
        schema: 'ryntra.mobile.trade-attempt',
        schemaVersion: '1.0.0',
        requestId: 'r',
        signature: '5'.repeat(88),
        taker: TAKER,
        state: 'SIGNED_NOT_SENT',
        recordedAt: new Date(NOW).toISOString(),
        context: null,
      },
      { kind: 'SUCCESS', serverState: 'MATCHED' },
    ).state,
    'SETTLED',
  )
  assert.equal(
    transitionTradeAttempt(
      {
        schema: 'ryntra.mobile.trade-attempt',
        schemaVersion: '1.0.0',
        requestId: 'r',
        signature: '5'.repeat(88),
        taker: TAKER,
        state: 'SIGNED_NOT_SENT',
        recordedAt: new Date(NOW).toISOString(),
        context: null,
      },
      { kind: 'SUCCESS', serverState: 'UNKNOWN' },
    ).state,
    'SUBMITTED_UNKNOWN',
  )
})

test('a recovery that finds the swap already receipted reads the chain’s figures from the receipt, never from the Review', () => {
  const context = {
    mode: 'swap',
    pay: SOL_ASSET,
    receive: USDC_ASSET,
    payDecimals: 9,
    receiveDecimals: 6,
    inAmountRaw: '20000000',
    outAmountRaw: '1940973',
    minReceivedRaw: '1931268',
  }
  const receipt = {
    kind: 'OUTCOME_RECEIPT',
    outcome: {
      status: 'MATCHED',
      transactionHash: 'sig',
      observedEffects: [
        {
          description:
            'Swap 20000000 raw of So11111111111111111111111111111111111111112 for 1935666 raw of EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (quoted 1940973, minimum 1931268).',
        },
        { description: 'Network fees 5000 base + 40075 priority lamports; router jupiter.' },
      ],
    },
  }
  assert.deepEqual(observationFromReceipt(receipt), { actualInputRaw: '20000000', actualOutputRaw: '1935666' })
  assert.equal(observationFromReceipt({ outcome: { observedEffects: [{ description: 'Something else.' }] } }), null)
  assert.equal(observationFromReceipt(null), null)
  const card = settledView(
    { state: 'ALREADY_RECEIPTED', signature: 'sig', observation: null, facts: null, receipt },
    context,
  )
  assert.equal(card.status, 'settled')
  assert.equal(card.received, '1.935666 USDC', 'the chain’s figure out of the receipt')
  assert.equal(card.note, 'Filled below the quote, above the minimum: −0.005307 USDC.')
  const bare = settledView(
    {
      state: 'ALREADY_RECEIPTED',
      signature: 'sig',
      observation: null,
      facts: null,
      receipt: { outcome: { status: 'MATCHED', observedEffects: [] } },
    },
    context,
  )
  assert.equal(bare.received, '1.940973 USDC')
  assert.equal(
    bare.note,
    'Figures from the Review; the receipt holds the chain’s.',
    'a Review figure is never passed off as the chain’s',
  )
})

test('recover: the server’s answer settles the attempt; pending keeps asking to the deadline; unknown to the chain frees the wallet', async () => {
  const attempts = attemptsDouble()
  const attempt = {
    schema: 'ryntra.mobile.trade-attempt',
    schemaVersion: '1.0.0',
    requestId: 'req-1',
    signature: '6'.repeat(88),
    taker: TAKER,
    state: 'SUBMITTED_UNKNOWN',
    recordedAt: new Date(NOW).toISOString(),
    context: null,
  }
  attempts.set(attempt)
  const { api } = apiDouble()
  const a = await recoverAttempt({ api, session, attempts, attempt, now: () => NOW, sleep: async () => undefined })
  assert.equal(a.ok, true)
  assert.equal(a.final, true)
  assert.equal(a.settlement.state, 'RECOVERED')
  assert.equal(attempts.get(TAKER), null)
  assert.equal(settledView(a.settlement, null).status, 'recovered')
  let asked = 0
  let clock = NOW
  const pending = apiDouble({
    recover: async () => ({ state: 'PENDING', signature: attempt.signature, reason: 'not yet' }),
  })
  attempts.set(attempt)
  const b = await recoverAttempt({
    api: pending.api,
    session,
    attempts,
    attempt,
    now: () => clock,
    sleep: async () => {
      asked++
      clock += 60_000
    },
    deadlineMs: 150_000,
    intervalMs: 1,
  })
  assert.equal(b.ok, true)
  assert.equal(b.final, false)
  assert.equal(b.settlement.state, 'RECOVERY_PENDING')
  assert.equal(asked, 3, 'asked until the deadline, then stopped')
  assert.equal(attempts.get(TAKER).state, 'SUBMITTED_UNKNOWN')
  assert.equal(settledView(b.settlement, null).status, 'pending')
  const never = apiDouble({
    recover: async () => ({ state: 'UNKNOWN_TO_CHAIN', signature: attempt.signature, reason: 'never seen' }),
  })
  const c = await recoverAttempt({
    api: never.api,
    session,
    attempts,
    attempt,
    now: () => NOW,
    sleep: async () => undefined,
  })
  assert.equal(c.ok, true)
  assert.equal(attempts.get(TAKER), null, 'the wallet is free')
  assert.equal(settledView(c.settlement, null).title, 'Earlier attempt · nothing happened')
  const failed = apiDouble({
    recover: async () => ({
      state: 'FAILED',
      signature: attempt.signature,
      reason: 'the program refused',
      observation: null,
      facts: null,
      receipt: null,
    }),
  })
  attempts.set(attempt)
  const d = await recoverAttempt({
    api: failed.api,
    session,
    attempts,
    attempt,
    now: () => NOW,
    sleep: async () => undefined,
  })
  assert.equal(d.ok, true)
  assert.equal(d.final, true)
  assert.equal(
    settledView(d.settlement, null).title,
    'Earlier attempt · not filled',
    'a signature this phone never made is named as such',
  )
  assert.equal(
    settledView(d.settlement, {
      mode: 'buy',
      pay: USDC_ASSET,
      receive: NVDA,
      payDecimals: 6,
      receiveDecimals: 8,
      inAmountRaw: '1',
      outAmountRaw: '1',
      minReceivedRaw: '1',
    }).title,
    'Not filled',
  )
  assert.match(
    settledView({ state: 'EXPIRED_AFTER_SUBMIT', signature: 'x', observation: null, facts: null, receipt: null }, null)
      .note,
    /sent but never landed/,
  )
  assert.equal(attempts.get(TAKER), null)
})

test('Ryntra’s fee is inside Jupiter’s total on an `/order` referral and on a `/build` platform fee (1.24.0): only the venue’s own remains', () => {
  const fee = (mechanism) => ({ mechanism, basisPoints: 25 })
  assert.equal(additionalJupiterFeeBps(45, fee('JUPITER_REFERRAL')), 20)
  assert.equal(additionalJupiterFeeBps(45, fee('JUPITER_PLATFORM_FEE')), 20)
  assert.equal(additionalJupiterFeeBps(45, fee('NONE')), 45)
  assert.equal(additionalJupiterFeeBps(10, fee('JUPITER_PLATFORM_FEE')), 0, 'never below nothing')
})
