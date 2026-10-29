import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder } from '@solana/kit'

import { ApiError, SWAP_ORDER_TIMEOUT_MS, SWAP_SEND_TIMEOUT_MS } from '../../lib/api.ts'
import { walletCancel } from '../wallet/wallet-wait.ts'
import {
  checkAfterSend,
  failureFrom,
  freshOrderNoWorse,
  QUOTE_ASK_AGAIN_MS,
  quoteAskAgain,
  QUOTE_ASK_LIMIT_MS,
  QUOTE_LIMIT_AGAIN_MS,
  QUOTE_LIMIT_MARGIN_MS,
  QUOTE_LIMIT_WAIT_MAX_MS,
  QUOTE_LIMIT_WAIT_MS,
  quoteLimitHolds,
  quoteLimitNext,
  quoteLimitWait,
  QUOTE_STUCK_ASKS,
  QUOTE_STUCK_MS,
  quoteWithin,
  RELEASE_AFTER_DEATH_MS,
  RELEASE_ASK_EVERY_MS,
  RELEASE_ASKS,
  ORDER_RETRY_MAX_MS,
  orderRetryDelay,
  prepareReview,
  recoverAttempt,
  releaseAgedReview,
  releaseReview,
  REVIEW_RENEWALS,
  signAndSend,
  ticketEstimate,
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
    'Max price move',
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
  assert.deepEqual(view.warnings, ['The quote and the minimum received allow different price moves.'])
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
    message: 'Signing from the app is not open yet.',
    retryable: false,
  })
  assert.equal(tradeFailureCopy('ORDER_BUILD_FAILED').retryable, true)
  assert.match(tradeFailureCopy('ORDER_BUILD_FAILED').message, /does not cover/)
  assert.equal(tradeFailureCopy('QUOTE_NO_ROUTE').message, 'No route for this pair right now.')
  assert.equal(tradeFailureCopy('SWAP_PRE_SIGN_REFUSED').retryable, false)
  assert.equal(tradeFailureCopy('OWNER_SWAP_LOCKED').message, 'Checking the previous swap. Try again in a moment.')
  assert.equal(tradeFailureCopy('WALLET_REFUSED').message, 'Wallet approval was cancelled. Nothing was sent.')
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
  assert.equal(c.failure.message, 'Signing from the app is not open yet.')
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
  assert.equal(declined.failure.message, 'Wallet approval was cancelled. Nothing was sent.')
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
  // AG-2: the bytes' ~30 s are checked before the Review's window — a signature 200 s late is past both, and never sent.
  assert.equal(late.failure.code, 'BYTES_REBUILT')
  assert.equal(late.aged, 'late')
  assert.equal(late.invalidated, true)
  assert.equal(calls.filter((call) => call[0] === 'execute').length, 0)
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

test('sign and send with a Ledger (M45): «Скасувати» sends nothing, 6808 is its own refusal, a later version never reaches the wallet', async () => {
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
  const cancel = walletCancel()
  let answer = () => undefined
  const waiting = signAndSend({
    api,
    wallet: walletDouble({
      signTransaction: (wire) =>
        new Promise((resolve) => {
          answer = () => resolve(walletSigns(wire))
        }),
    }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
    cancel,
  })
  cancel.cancel()
  const cancelled = await waiting
  // The wallet answers after «Скасувати»: that signature is never sent.
  answer()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.phase, 'review')
  assert.equal(cancelled.failure.key, 'walletCancelled')
  assert.equal(attempts.get(TAKER), null)

  const blind = await signAndSend({
    api,
    wallet: walletDouble({
      signTransaction: async () => {
        throw new Error('Ledger device: UNKNOWN_ERROR (0x6808)')
      },
    }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(blind.failure.code, 'LEDGER_BLIND_SIGNING')
  assert.equal(blind.failure.key, 'ledgerBlind')
  assert.equal(blind.failure.retryable, true)

  // A message of version 1: the wallet is not opened.
  const v1 = getBase64Encoder().encode(prepared.order.order.transactionBase64).slice()
  v1[65] = 0x81
  let opened = false
  const later = await signAndSend({
    api,
    wallet: walletDouble({
      signTransaction: async (wire) => {
        opened = true
        return walletSigns(wire)
      },
    }),
    session,
    attempts,
    prepared: {
      ...prepared,
      order: {
        ...prepared.order,
        order: { ...prepared.order.order, transactionBase64: getBase64Decoder().decode(v1) },
      },
    },
    now: () => NOW,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(later.failure.code, 'TX_VERSION')
  assert.equal(opened, false)

  // The wait is ninety seconds at least, however short the Review's window.
  const asked = []
  await signAndSend({
    api,
    wallet: walletDouble({ signTransaction: () => new Promise(() => {}) }),
    session,
    attempts,
    prepared,
    now: () => NOW,
    sleep: async (ms) => void asked.push(ms),
  })
  assert.ok(asked[0] >= 90_000)
  assert.equal(
    calls.some((c) => c[0] === 'execute'),
    false,
    'nothing was ever sent',
  )
})

test('«Обмін» says the network’s fee beside the rate — the quote’s own lamports, in SOL (NEW-LOOK §3)', async () => {
  const { quoteNetworkFee } = await import('./trade-model.ts')
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '5000', priorityFeeLamports: '15000' }), '0.00002 SOL')
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '5000', priorityFeeLamports: '15000' }, 'uk'), '0,00002 SOL')
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '', priorityFeeLamports: '1' }), null)
  // A Solana fee is never zero: a total of 0 is a fee the quote does not know — a dash where it is said (ST-5).
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '0', priorityFeeLamports: '0' }, 'uk'), null)
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '5000', priorityFeeLamports: '0' }, 'uk'), '0,000005 SOL')
  // Under six places it is said to the lamport, never cut to «0».
  assert.equal(quoteNetworkFee({ signatureFeeLamports: '0', priorityFeeLamports: '500' }), '0.0000005 SOL')
})

/* ---- AG-2: the bytes live ~30 s — a stand clock against the server's `signableMs` ---- */

test('AG-2: the wallet never opens on bytes with less than its window left; a fresh Review instead', async () => {
  const { api } = apiDouble()
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
  assert.equal(prepared.receivedAtMs, NOW)
  let opened = 0
  const short = await signAndSend({
    api,
    wallet: walletDouble({ signTransaction: async (wire) => ((opened += 1), wire) }),
    session,
    attempts,
    // 20 s after arrival: of a 25 s window less than the wallet's 10 s is left.
    prepared: { ...prepared, order: { ...prepared.order, signableMs: 25_000 } },
    now: () => NOW + 20_000,
    sleep: () => new Promise(() => {}),
  })
  assert.equal(short.ok, false)
  assert.equal(short.aged, 'short')
  assert.equal(opened, 0)
})

for (const seconds of [25, 30, 45, 60, 90]) {
  test(`AG-2: a Ledger that confirms after ${seconds} s — the signature is never sent, the Review is built again`, async () => {
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
    let tick = 0
    const late = await signAndSend({
      api,
      wallet: walletDouble(),
      session,
      attempts,
      prepared: {
        ...prepared,
        order: { ...prepared.order, signableMs: 25_000, expiresAt: new Date(NOW + 120_000).toISOString() },
      },
      now: () => (tick++ === 0 ? NOW : NOW + seconds * 1_000),
      sleep: () => new Promise(() => {}),
    })
    assert.equal(late.ok, false)
    assert.equal(late.aged, 'late')
    assert.equal(calls.filter((call) => call[0] === 'execute').length, 0)
  })
}

test('AG-2: an aged Review is released only after its bytes should be dead, and the chain is asked at most four times', async () => {
  const waits = []
  let asked = 0
  const api = {
    cancel: async () => {
      asked += 1
      throw new ApiError('BLOCKHASH_STILL_VALID', 'still valid', 409, null, {})
    },
  }
  const prepared = { order: { signableMs: 20_000, order: { requestId: 'r1' } }, receivedAtMs: 1_000, context: null }
  const out = await releaseAgedReview({
    api,
    session,
    prepared,
    now: () => 11_000,
    sleep: async (ms) => void waits.push(ms),
  })
  assert.equal(out.ok, false)
  assert.equal(out.failure.code, 'BLOCKHASH_STILL_VALID')
  assert.equal(asked, 4)
  // First the bytes' death (arrival + window + 5 s margin − now) and half a second for the chain (ST-3: from 1.5 s),
  // then three pauses of three seconds — the last ask still about ten seconds past the death, for a lagging RPC.
  assert.equal(RELEASE_ASKS, 4)
  assert.deepEqual(waits, [1_000 + 20_000 + 5_000 - 11_000 + 500, 3_000, 3_000, 3_000])
  assert.ok(RELEASE_AFTER_DEATH_MS + (RELEASE_ASKS - 1) * RELEASE_ASK_EVERY_MS >= 9_000)
  let once = 0
  const freed = await releaseAgedReview({
    api: { cancel: async () => ((once += 1), { state: 'EXPIRED_BEFORE_SUBMIT' }) },
    session,
    prepared,
    now: () => 60_000,
    sleep: async () => undefined,
  })
  assert.equal(freed.ok, true)
  assert.equal(once, 1)
})

test('AG-2b: fresh bytes open the wallet on the old press only when nothing is worse', () => {
  const old = orderCore()
  assert.equal(freshOrderNoWorse(old, orderCore({ requestId: 'req-2' })), true)
  assert.equal(freshOrderNoWorse(old, orderCore({ minReceivedRaw: '46600000' })), true)
  assert.equal(freshOrderNoWorse(old, orderCore({ minReceivedRaw: '46400000' })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ priorityFeeLamports: '15001' })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ rentFeeLamports: '2039281' })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ totalFeeBasisPoints: 11 })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ platformFee: { basisPoints: 11, mint: USDC_ASSET.mint } })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ inAmountRaw: '100000001' })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ outputMint: USDC_ASSET.mint })), false)
  assert.equal(freshOrderNoWorse(old, orderCore({ minReceivedRaw: 'n/a' })), false)
})

test('AG-2b: an open Review renews itself a bounded number of times — about two minutes, within the action budget', () => {
  assert.ok(REVIEW_RENEWALS >= 1 && REVIEW_RENEWALS <= 4)
})

/* ---- ST-3 «Швидкі обміни» ---- */

test('ST-3: a send whose end the phone did not hear is checked by itself; a heard end or a refusal before the network is not', () => {
  const pending = { schema: 'ryntra.mobile.trade-attempt', requestId: 'r', signature: 's', taker: TAKER, state: 'SUBMITTED_UNKNOWN' }
  const settled = { ...pending, state: 'SETTLED' }
  assert.equal(checkAfterSend({ ok: true, settlement: { state: 'PENDING' }, attempt: pending }), pending)
  assert.equal(checkAfterSend({ ok: true, settlement: { state: 'MATCHED' }, attempt: settled }), null)
  assert.equal(checkAfterSend({ ok: false, failure: { code: 'NETWORK' }, phase: 'recovery', attempt: pending }), pending)
  assert.equal(checkAfterSend({ ok: false, failure: { code: 'WALLET_REFUSED' }, phase: 'review' }), null)
  assert.equal(checkAfterSend({ ok: false, failure: { code: 'X' }, phase: 'recovery' }), null)
})

test('ST-3: a slow execute that lands reads «Готово», a «still pending» one is checked until it lands — nothing sent twice', async () => {
  const calls = []
  const attempts = new Map()
  const store = { get: (t) => attempts.get(t) ?? null, set: (a) => attempts.set(a.taker, a), clear: (t) => attempts.delete(t) }
  let polls = 0
  const api = {
    execute: async () => (calls.push('execute'), { state: 'PENDING', signature: 'sig', observation: null, facts: null, receipt: null }),
    recover: async () => (calls.push('recover'), (polls += 1) < 3 ? { state: 'PENDING', signature: 'sig' } : { state: 'MATCHED', signature: 'sig' }),
  }
  const prepared = { order: orderResponse(), context: { mode: 'buy' }, receivedAtMs: NOW }
  const sent = await signAndSend({
    api,
    wallet: { signTransaction: async (wire) => walletSigns(wire) },
    session,
    attempts: store,
    prepared,
    now: () => NOW + 1_000,
  })
  const open = checkAfterSend(sent)
  assert.ok(open, 'a pending answer is checked by itself')
  const checked = await recoverAttempt({ api, session, attempts: store, attempt: open, sleep: async () => undefined })
  assert.equal(checked.ok, true)
  assert.equal(checked.final, true)
  assert.equal(checked.settlement.state, 'MATCHED')
  assert.deepEqual(calls, ['execute', 'recover', 'recover', 'recover'])
  assert.equal(store.get(TAKER), null)
})

test('ST-3: the first asks of a check come every 1.5 s, then every 3 s', async () => {
  const waits = []
  let asked = 0
  const store = { get: () => null, set: () => undefined, clear: () => undefined }
  const attempt = { schema: 'ryntra.mobile.trade-attempt', requestId: 'r', signature: 's', taker: TAKER, state: 'SUBMITTED_UNKNOWN', context: null }
  await recoverAttempt({
    api: { recover: async () => ((asked += 1) < 7 ? { state: 'PENDING', signature: 's' } : { state: 'MATCHED', signature: 's' }) },
    session,
    attempts: store,
    attempt,
    sleep: async (ms) => void waits.push(ms),
  })
  assert.deepEqual(waits, [1_500, 1_500, 1_500, 3_000, 3_000, 3_000])
})

test('ST-3: a check nobody waits on writes nothing back — a signature another check settled stays settled', async () => {
  let held = null
  const store = { get: () => held, set: (a) => (held = a), clear: () => (held = null) }
  const attempt = { schema: 'ryntra.mobile.trade-attempt', requestId: 'r', signature: 's', taker: TAKER, state: 'SUBMITTED_UNKNOWN', context: null }
  const out = await recoverAttempt({
    api: { recover: async () => ({ state: 'PENDING', signature: 's' }) },
    session,
    attempts: store,
    attempt,
    sleep: async () => undefined,
    cancelled: () => true,
  })
  assert.equal(out.final, false)
  assert.equal(held, null)
})

test('ST-3: a check the person walked away from stops asking and keeps the attempt for the next look', async () => {
  let asked = 0
  let gone = false
  const attempts = new Map()
  const store = { get: (t) => attempts.get(t) ?? null, set: (a) => attempts.set(a.taker, a), clear: (t) => attempts.delete(t) }
  const attempt = { schema: 'ryntra.mobile.trade-attempt', requestId: 'r', signature: 's', taker: TAKER, state: 'SUBMITTED_UNKNOWN', context: null }
  store.set(attempt) // the send wrote it before the check began
  const out = await recoverAttempt({
    api: { recover: async () => ((asked += 1), (gone = true), { state: 'PENDING', signature: 's' }) },
    session,
    attempts: store,
    attempt,
    sleep: async () => undefined,
    cancelled: () => gone,
  })
  assert.equal(asked, 1)
  assert.equal(out.final, false)
  assert.equal(store.get(TAKER).state, 'SUBMITTED_UNKNOWN')
})

test('ST-5: a refresh that failed never leaves its old figure beside the refusal — «—» and one status line', () => {
  // The quote for the amount on screen, its latest ask answered: shown, also while it refreshes under it.
  assert.equal(ticketEstimate({ matches: true, failed: false, fetching: false }), 'shown')
  assert.equal(ticketEstimate({ matches: true, failed: false, fetching: true }), 'shown')
  // Offline after a quote: the cache keeps the last answer, the ticket does not show it.
  assert.equal(ticketEstimate({ matches: true, failed: true, fetching: false }), 'none')
  // «Спробувати ще» pressed: pricing, never the old figure.
  assert.equal(ticketEstimate({ matches: true, failed: true, fetching: true }), 'pricing')
  // Another amount typed: no figure until its own answer.
  assert.equal(ticketEstimate({ matches: false, failed: false, fetching: true }), 'pricing')
  assert.equal(ticketEstimate({ matches: false, failed: false, fetching: false }), 'none')
})

test('ST-3: a quote refused for a moment is asked once more by itself; a refusal that stands is said at once', () => {
  assert.equal(QUOTE_ASK_AGAIN_MS, 1_000)
  // Ryntra's own fixed window is not asked again at one second; the venue's «too many requests» is.
  assert.equal(quoteAskAgain(new ApiError('RATE_LIMITED', 'x', 429), 0), false)
  assert.equal(quoteAskAgain(new ApiError('QUOTE_RATE_LIMITED', 'x', 429), 0), true)
  assert.equal(quoteAskAgain(new ApiError('HTTP_504', 'x', 504), 0), true)
  assert.equal(quoteAskAgain(new ApiError('ORDER_UNREACHABLE', 'x', 502), 0), true)
  assert.equal(quoteAskAgain(new TypeError('Network request failed'), 0), true)
  assert.equal(quoteAskAgain(new ApiError('QUOTE_RATE_LIMITED', 'x', 429), 1), false)
  assert.equal(quoteAskAgain(new ApiError('NO_ROUTE', 'x', 404), 0), false)
  assert.equal(quoteAskAgain(new ApiError('AMOUNT_TOO_SMALL', 'x', 400), 0), false)
  assert.equal(quoteAskAgain(new ApiError('SWAP_POLICY_BLOCKED', 'x', 403), 0), false)
  // A limiter that names a longer pause is not asked again at one second.
  assert.equal(quoteAskAgain(new ApiError('QUOTE_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 2 }), 0), true)
  assert.equal(quoteAskAgain(new ApiError('QUOTE_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 10 }), 0), false)
})

test('ST-5 r9–r10: «too many requests» is waited out for the pause it names, then asked again while the ticket is open', () => {
  const limited = new ApiError('RATE_LIMITED', 'x', 429)
  // No pause named: about two seconds; a named one is kept, with a small margin past it.
  assert.equal(quoteLimitWait(limited), QUOTE_LIMIT_WAIT_MS)
  assert.equal(QUOTE_LIMIT_WAIT_MS, 2_000)
  assert.equal(
    quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 3 })),
    3_000 + QUOTE_LIMIT_MARGIN_MS,
  )
  // Ryntra's 60-second window names up to 60 s (ST-5 r10): waited out, never said at once.
  assert.equal(
    quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 47 })),
    47_000 + QUOTE_LIMIT_MARGIN_MS,
  )
  assert.equal(
    quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 60 })),
    60_000 + QUOTE_LIMIT_MARGIN_MS,
  )
  assert.equal(QUOTE_LIMIT_WAIT_MAX_MS, 60_000 + QUOTE_LIMIT_MARGIN_MS)
  assert.equal(
    quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 900 })),
    QUOTE_LIMIT_WAIT_MAX_MS,
  )
  // A pause of nothing still leaves a second between asks.
  assert.equal(quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 0 })), QUOTE_ASK_AGAIN_MS)
  // The venue's limiter: its short one reaches the ticket only after the query's own retry — then it is paced too.
  assert.equal(
    quoteLimitWait(new ApiError('QUOTE_RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 5 })),
    5_000 + QUOTE_LIMIT_MARGIN_MS,
  )
  assert.equal(quoteLimitWait(new ApiError('QUOTE_RATE_LIMITED', 'x', 429)), QUOTE_LIMIT_WAIT_MS)
  // After the ask past the window is refused too: every ten seconds while the ticket is open, or the pause named.
  assert.equal(QUOTE_LIMIT_AGAIN_MS, 10_000)
  assert.equal(quoteLimitWait(limited, true), QUOTE_LIMIT_AGAIN_MS)
  assert.equal(
    quoteLimitWait(new ApiError('RATE_LIMITED', 'x', 429, null, { retryAfterSeconds: 20 }), true),
    20_000 + QUOTE_LIMIT_MARGIN_MS,
  )
  // Any refusal that is not «too many requests» is no pacing.
  assert.equal(quoteLimitWait(new ApiError('NO_ROUTE', 'x', 404)), null)
  assert.equal(quoteLimitWait(new TypeError('Network request failed')), null)

  // The refusal starts the wait from when it arrived; the refusal is held back as pricing meanwhile.
  let held = quoteLimitNext(null, { kind: 'refused', error: limited, key: 'A', nowMs: 1_000 })
  assert.deepEqual(held, { phase: 'waiting', until: 3_000 })
  assert.equal(quoteLimitHolds(held, limited, 'A'), true)
  // Before the state is set, the refusal is held back already — never a red line for a frame.
  assert.equal(quoteLimitHolds(null, limited, 'A'), true)
  // Typing on during the wait starts no ask and no second wait: the window is the one window.
  assert.equal(quoteLimitNext(held, { kind: 'refused', error: limited, key: 'B', nowMs: 2_000 }), held)
  assert.equal(quoteLimitHolds(held, null, 'C'), true)
  // The window passes: the newest amount on screen is the one asked.
  held = quoteLimitNext(held, { kind: 'waited', key: 'C' })
  assert.deepEqual(held, { phase: 'spent', key: 'C' })
  // That one ask refused too: said now — and asked again by itself ten seconds on, never left until a press.
  held = quoteLimitNext(held, { kind: 'refused', error: limited, key: 'C', nowMs: 4_000 })
  assert.deepEqual(held, { phase: 'resting', key: 'C', until: 14_000 })
  assert.equal(quoteLimitHolds(held, limited, 'C'), false)
  // Its pause over, the same amount is asked again; refused again, it rests another ten seconds.
  const again = quoteLimitNext(held, { kind: 'again', key: 'C' })
  assert.deepEqual(again, { phase: 'spent', key: 'C' })
  assert.deepEqual(quoteLimitNext(again, { kind: 'refused', error: limited, key: 'C', nowMs: 14_100 }), {
    phase: 'resting',
    key: 'C',
    until: 24_100,
  })
  // Another amount on screen when the pause ends is asked as any amount is: the pacing is over.
  assert.equal(quoteLimitNext(held, { kind: 'again', key: 'E' }), null)
  assert.equal(quoteLimitNext(held, { kind: 'again', key: null }), null)
  // A new amount typed after it is a new ask — refused, it waits its own window first.
  assert.deepEqual(quoteLimitNext(held, { kind: 'refused', error: limited, key: 'D', nowMs: 5_000 }), {
    phase: 'waiting',
    until: 7_000,
  })
  // Any answer ends the pacing; a wait with nothing typed at its end owes no ask.
  assert.equal(quoteLimitNext(held, { kind: 'answered' }), null)
  assert.equal(quoteLimitNext({ phase: 'waiting', until: 3_000 }, { kind: 'waited', key: null }), null)
  // A refusal that is not waited out is said as before.
  assert.equal(quoteLimitNext(null, { kind: 'refused', error: new ApiError('NO_ROUTE', 'x', 404), key: 'A', nowMs: 0 }), null)
  assert.equal(quoteLimitHolds(null, new ApiError('NO_ROUTE', 'x', 404), 'A'), false)
})

test('ST-5 r10: an estimate is never asked for minutes — an ask that does not settle is a «took too long», asked once more', async () => {
  assert.equal(QUOTE_ASK_LIMIT_MS, 13_000)
  // An answer in time passes through.
  assert.equal(await quoteWithin(Promise.resolve('quote'), 50), 'quote')
  // An ask that never settles is refused at the limit, and its own abort is called.
  let aborted = false
  const never = new Promise(() => undefined)
  await assert.rejects(
    quoteWithin(never, 10, () => {
      aborted = true
    }),
    (error) => error instanceof ApiError && error.code === 'QUOTE_TIMEOUT',
  )
  assert.equal(aborted, true)
  // «Took too long» — the query asks it once more by itself, then the ticket says it with «Спробувати ще».
  const late = new ApiError('QUOTE_TIMEOUT', 'x', 0)
  assert.equal(failureFrom(late).key, 'tooLong')
  assert.equal(quoteAskAgain(late, 0), true)
  assert.equal(quoteAskAgain(late, 1), false)
  // A typed amount the query left idle under a cancelled ask is asked again soon, a bounded number of times.
  assert.ok(QUOTE_STUCK_MS <= 2_000)
  assert.equal(QUOTE_STUCK_ASKS, 2)
})

test('ST-3: the phone waits for the swap routes past the venue’s own wait — a slow send is never cut into «no network»', () => {
  // The routes' `maxDuration` is 60 s; the execute hands the bytes to the venue for up to 30 s, the order asks it again
  // for up to 10 s and then simulates.
  // The send waits past the venue's 30 s, never as long as the route's 60: the sheet cannot be left while it waits, and
  // an answer that does not come is asked of the chain by itself after.
  assert.ok(SWAP_SEND_TIMEOUT_MS > 30_000 && SWAP_SEND_TIMEOUT_MS <= 40_000)
  assert.ok(SWAP_ORDER_TIMEOUT_MS > 12_000 && SWAP_ORDER_TIMEOUT_MS <= 25_000)
})

test('«Комісія мережі» keeps the pair’s last stated fee for a crumb’s quote that states none — only when the person pays it (ST-5 r8)', async () => {
  const { swapNetworkFee } = await import('./trade-model.ts')
  const pair = { inputMint: 'So11111111111111111111111111111111111111112', outputMint: 'USDC' }
  const stated = { ...pair, signatureFeeLamports: '5000', priorityFeeLamports: '0' }
  const none = { ...pair, signatureFeeLamports: '0', priorityFeeLamports: '0', gasless: false }
  assert.equal(swapNetworkFee(stated, null, 'uk'), '0,000005 SOL')
  assert.equal(swapNetworkFee(none, stated, 'uk'), '0,000005 SOL')
  assert.equal(swapNetworkFee(none, null, 'uk'), null)
  // Another pair's fee is not this pair's; a gasless order, or one that does not say, keeps the dash.
  assert.equal(swapNetworkFee(none, { ...stated, outputMint: 'BONK' }, 'uk'), null)
  assert.equal(swapNetworkFee({ ...none, gasless: true }, stated, 'uk'), null)
  const { gasless: _unsaid, ...unsaid } = none
  assert.equal(swapNetworkFee(unsaid, stated, 'uk'), null)
})

test('the Swap’s pay figure is grouped as the estimate beside it; the field stays as typed (ST-5 r8)', async () => {
  const { groupedField } = await import('./trade-model.ts')
  assert.equal(groupedField('500000', 'en'), '500,000')
  assert.equal(groupedField('500000', 'uk'), '500 000')
  assert.equal(groupedField('1234567,5', 'uk'), '1 234 567,5')
  assert.equal(groupedField('0.00001', 'en'), '0.00001')
  assert.equal(groupedField('1000.', 'en'), '1,000.')
  assert.equal(groupedField('', 'en'), '')
})
