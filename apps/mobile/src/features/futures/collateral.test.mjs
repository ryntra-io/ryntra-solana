import assert from 'node:assert/strict'
import { test } from 'node:test'

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
import {
  followCollateral,
  readCollateralMargin,
  readCollateralStates,
  reviewCollateral,
  signAndRelayCollateral,
} from './collateral-api.ts'
import { COLLATERAL_COPY } from './collateral-copy.ts'
import {
  amountBlock,
  COLLATERAL_CLOSED,
  COLLATERAL_FAILURES,
  depositWay,
  collateralChips,
  collateralFailureOf,
  collateralReceiptView,
  collateralReviewView,
  fieldFromMicro,
  mergeSeen,
  microFromText,
  parseCollateralMargin,
  parseCollateralResult,
  parseCollateralReview,
  parseCollateralStates,
  sameMoveNoWorse,
  shareOf,
  topOf,
  unsettled,
  walletShort,
  withdrawableOf,
} from './collateral-model.ts'

/* Visibly synthetic wallets (M28): 32 bytes of 5s and of 6s. */
const OWNER = 'LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY'
const SESSION = {
  address: OWNER,
  token: 't',
  issuedAt: '2026-10-23T00:00:00Z',
  expiresAt: '2026-10-30T00:00:00Z',
  sessionId: null,
}

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

/** The Review route's answer as line A's `reviewCollateral` serves it (B6): amounts as micro-dollar digits. */
const REVIEW_DEPOSIT = {
  action: 'deposit',
  amount: '25000000',
  receive: '25000000',
  phoenixFee: '0',
  walletUsdc: '120500000',
  freeAfter: null,
  rentLamports: '2039280',
  networkFeeLamports: '15000',
  traderAccount: 'Trader1111111111111111111111111111111111111',
  transaction: { wireBase64: signedWire(OWNER, 0) },
  ticket: 'sample-ticket',
  expiresAt: 1_700_000_025_000,
  signableMs: 25_000,
}

const REVIEW_WITHDRAW = {
  ...REVIEW_DEPOSIT,
  action: 'withdraw',
  amount: '10000000',
  receive: '9990000',
  phoenixFee: '10000',
  freeAfter: '5000000',
  rentLamports: '0',
}

const SIGNATURE = '5'.repeat(88)

test('amounts: dollars typed either way become micro-dollars exactly, and back to the field down to the cent', () => {
  assert.equal(microFromText('12.5'), 12_500_000n)
  assert.equal(microFromText('12,50'), 12_500_000n)
  assert.equal(microFromText('1 250'), 1_250_000_000n)
  assert.equal(microFromText('0.000001'), 1n)
  assert.equal(microFromText('1.'), 1_000_000n)
  assert.equal(microFromText(''), null)
  assert.equal(microFromText('1.2.3'), null)
  assert.equal(microFromText('-5'), null)
  assert.equal(microFromText('0.0000001'), null)
  // The route takes digits only: the amount travels as the micro-dollars' string, never a float.
  assert.equal(microFromText('0.1').toString(), '100000')
  assert.equal(fieldFromMicro(12_500_000n, ','), '12,5')
  assert.equal(fieldFromMicro(12_050_000n, '.'), '12.05')
  assert.equal(fieldFromMicro(12_000_000n, '.'), '12')
  // Dust under a cent never reaches the field.
  assert.equal(fieldFromMicro(12_349_999n, '.'), '12.34')
})

test('quick amounts: 25/50/75 % and «Макс» of what can move, down to the cent, never over it nor the first check', () => {
  const top = topOf(120_505_555n, null)
  const chips = collateralChips(top)
  assert.deepEqual(
    chips.map((chip) => chip.key),
    ['25', '50', '75', 'max'],
  )
  assert.deepEqual(
    chips.map((chip) => chip.micro),
    [30_120_000n, 60_250_000n, 90_370_000n, 120_500_000n],
  )
  for (const chip of chips) assert.ok(chip.micro <= 120_505_555n && chip.micro % 10_000n === 0n)
  // The first check's ceiling stands for «Макс» either way.
  assert.equal(topOf(120_000_000n, 5_000_000n), 5_000_000n)
  assert.equal(collateralChips(topOf(120_000_000n, 5_000_000n)).at(-1).micro, 5_000_000n)
  // Under the minimum, or of nothing known, a chip cannot be pressed.
  assert.deepEqual(
    collateralChips(topOf(2_000_000n, null)).map((chip) => chip.micro),
    [null, 1_000_000n, 1_500_000n, 2_000_000n],
  )
  assert.ok(collateralChips(null).every((chip) => chip.micro === null))
  assert.ok(collateralChips(0n).every((chip) => chip.micro === null))
  assert.equal(shareOf(3n, 50), 0n)
})

test('the amount against the minimum, what can move and the first check', () => {
  assert.equal(amountBlock('deposit', 999_999n, 10_000_000n, null), 'minimum')
  assert.equal(amountBlock('deposit', 11_000_000n, 10_000_000n, null), 'overWallet')
  assert.equal(amountBlock('withdraw', 11_000_000n, 10_000_000n, null), 'overWithdrawable')
  assert.equal(amountBlock('deposit', 6_000_000n, 10_000_000n, 5_000_000n), 'canary')
  assert.equal(amountBlock('deposit', 5_000_000n, 10_000_000n, 5_000_000n), null)
  // Unknown wallet USDC: the server checks it at the Review.
  assert.equal(amountBlock('deposit', 5_000_000n, null, null), null)
  assert.equal(amountBlock('deposit', null, null, null), null)
})

test('the gate: closed until it says otherwise; the ceiling under either name; the margin and what may leave', () => {
  assert.deepEqual(parseCollateralStates(null), COLLATERAL_CLOSED)
  assert.deepEqual(parseCollateralStates({ deposit: 'yes', withdraw: 1 }), COLLATERAL_CLOSED)
  assert.deepEqual(
    parseCollateralStates({
      deposit: true,
      withdraw: true,
      maxMicro: '5000000',
      maxDeposit: '5000000',
      walletUsdc: '0',
    }),
    { deposit: true, withdraw: true, maxMicro: 5_000_000n, walletUsdc: 0n },
  )
  assert.equal(parseCollateralStates({ deposit: true, maxDeposit: '7000000' }).maxMicro, 7_000_000n)
  assert.equal(parseCollateralStates({ deposit: true, walletUsdc: '12.5' }).walletUsdc, null)
  assert.deepEqual(parseCollateralMargin({ withdrawableMicro: '4200000', canDeposit: true, canWithdraw: false }), {
    withdrawableMicro: 4_200_000n,
    canDeposit: true,
    canWithdraw: false,
  })
  assert.equal(parseCollateralMargin(null), null)
  assert.equal(parseCollateralMargin({ withdrawableMicro: null }).withdrawableMicro, null)
  assert.equal(withdrawableOf({ portfolioUsd: 12 }), null)
  assert.equal(withdrawableOf({ withdrawableMicro: '1000000' }), 1_000_000n)
  assert.equal(withdrawableOf(null), null)
})

test('the Review read again: without its bytes, its ticket or its amounts it is none; figures stay exact', () => {
  const review = parseCollateralReview(REVIEW_WITHDRAW)
  assert.equal(review.action, 'withdraw')
  assert.equal(review.amountMicro, 10_000_000n)
  assert.equal(review.receiveMicro, 9_990_000n)
  assert.equal(review.phoenixFeeMicro, 10_000n)
  assert.equal(review.freeAfterMicro, 5_000_000n)
  assert.equal(review.networkFeeLamports, 15_000n)
  assert.equal(review.signableMs, 25_000)
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, ticket: '' }), null)
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, transaction: {} }), null)
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, amount: 25 }), null)
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, action: 'swap' }), null)
  // More arriving than leaves is not a move to sign.
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, receive: '26000000' }), null)
  assert.equal(parseCollateralReview({ ...REVIEW_DEPOSIT, signableMs: 'soon' }).signableMs, null)
})

test('the Review in words: what leaves, what arrives, Phoenix’s collateral after, the network in SOL; Ryntra takes nothing', () => {
  const words = COLLATERAL_COPY.uk
  const deposit = collateralReviewView(parseCollateralReview(REVIEW_DEPOSIT), words, 'uk')
  assert.equal(deposit.title, 'Поповнити Perps на Phoenix: 25,00 USDC')
  assert.equal(deposit.pay, '25,00 USDC з твого гаманця')
  assert.equal(deposit.get, '25,00 USDC застави на Phoenix')
  assert.deepEqual(deposit.rows, [])
  const cost = (view, label) => view.costs.find((entry) => entry.label === label)?.value
  assert.equal(cost(deposit, 'Ryntra'), '0')
  assert.equal(cost(deposit, 'Phoenix'), '0')
  assert.equal(cost(deposit, 'Мережа'), '0,000015 SOL')
  assert.equal(cost(deposit, 'Депозит токен-рахунку'), '0,00203928 SOL')
  assert.equal(deposit.total, 'Ryntra не бере нічого · 0,00205428 SOL')
  const withdraw = collateralReviewView(parseCollateralReview(REVIEW_WITHDRAW), COLLATERAL_COPY.en, 'en')
  assert.equal(withdraw.title, 'Withdraw 10.00 USDC from Perps on Phoenix')
  assert.equal(withdraw.pay, '10.00 USDC of Phoenix collateral')
  assert.equal(withdraw.get, '9.99 USDC to your wallet')
  assert.deepEqual(withdraw.rows, [
    { label: 'Free to withdraw after', value: '5.00 USDC' },
    { label: 'Margin after', value: 'Less collateral brings the account closer to liquidation.', tone: 'warning' },
  ])
  assert.equal(cost(withdraw, 'Phoenix'), '0.01 USDC')
  assert.equal(cost(withdraw, 'Token account deposit'), undefined)
})

test('one press after the bytes aged: only the same move, no worse, opens the wallet by itself', () => {
  const shown = parseCollateralReview(REVIEW_WITHDRAW)
  assert.equal(sameMoveNoWorse(shown, parseCollateralReview({ ...REVIEW_WITHDRAW, ticket: 'fresh' })), true)
  assert.equal(sameMoveNoWorse(shown, parseCollateralReview({ ...REVIEW_WITHDRAW, receive: '9980000' })), false)
  assert.equal(sameMoveNoWorse(shown, parseCollateralReview({ ...REVIEW_WITHDRAW, amount: '11000000' })), false)
  assert.equal(
    sameMoveNoWorse(shown, parseCollateralReview({ ...REVIEW_WITHDRAW, networkFeeLamports: '20000' })),
    false,
  )
  assert.equal(sameMoveNoWorse(shown, parseCollateralReview({ ...REVIEW_WITHDRAW, action: 'deposit' })), false)
})

test('the relay and the chain: the USDC moved is the chain’s, signed; an unknown word never overwrites what is known', () => {
  const landed = parseCollateralResult({
    results: [{ signature: SIGNATURE, state: 'LANDED', reason: null, usdcMoved: '-25000000' }],
    settled: true,
  })
  assert.deepEqual(landed, { signature: SIGNATURE, state: 'LANDED', usdcMoved: -25_000_000n })
  assert.equal(unsettled(landed), false)
  const unread = parseCollateralResult({ results: [{ signature: SIGNATURE, state: 'LANDED', usdcMoved: null }] })
  assert.equal(unread.usdcMoved, null)
  assert.equal(unsettled(unread), true)
  const waiting = parseCollateralResult({ results: [{ signature: SIGNATURE, state: 'SOMETHING' }] })
  assert.deepEqual(waiting, { signature: SIGNATURE, state: 'UNKNOWN' })
  assert.equal(unsettled(waiting), true)
  assert.equal(parseCollateralResult({ results: [{ state: 'LANDED' }] }), null)
  assert.equal(parseCollateralResult(null), null)
  assert.deepEqual(mergeSeen(waiting, { signature: SIGNATURE, state: 'UNKNOWN' }), waiting)
  assert.deepEqual(mergeSeen(waiting, { signature: 'other', state: 'LANDED' }), waiting)
  assert.deepEqual(mergeSeen(waiting, landed), landed)
  // A later read without the figure keeps the one already read.
  assert.deepEqual(mergeSeen(landed, { signature: SIGNATURE, state: 'LANDED' }), landed)
})

test('the receipt: the chain’s figure once landed; a withdrawal’s arrival is expected until the chain shows it', () => {
  const words = COLLATERAL_COPY.uk
  const deposit = parseCollateralReview(REVIEW_DEPOSIT)
  const done = collateralReceiptView(
    deposit,
    { signature: SIGNATURE, state: 'LANDED', usdcMoved: -25_000_000n },
    words,
    'uk',
  )
  assert.equal(done.status, 'done')
  assert.equal(done.title, 'Поповнення Perps на Phoenix')
  assert.equal(done.big, '−25,00 USDC')
  assert.equal(done.line, '25,00 USDC застави на Phoenix')
  const withdraw = parseCollateralReview(REVIEW_WITHDRAW)
  const arrived = collateralReceiptView(
    withdraw,
    { signature: SIGNATURE, state: 'LANDED', usdcMoved: 9_985_000n },
    words,
    'uk',
  )
  assert.equal(arrived.big, '+9,985 USDC')
  const expected = collateralReceiptView(withdraw, { signature: SIGNATURE, state: 'LANDED' }, words, 'uk')
  assert.equal(expected.big, '+≈ 9,99 USDC')
  assert.equal(expected.line, '9,99 USDC у твій гаманець · очікувано, мережа ще не показала')
  const pending = collateralReceiptView(withdraw, { signature: SIGNATURE, state: 'UNKNOWN' }, words, 'uk')
  assert.deepEqual([pending.status, pending.big, pending.note], ['pending', null, words.pendingLine])
  assert.equal(
    collateralReceiptView(withdraw, { signature: SIGNATURE, state: 'UNKNOWN' }, words, 'uk', false).note,
    words.pendingStopped,
  )
  const failed = collateralReceiptView(deposit, { signature: SIGNATURE, state: 'FAILED' }, words, 'uk')
  assert.deepEqual([failed.status, failed.note], ['failed', words.receiptNothing])
})

test('failures in the person’s words: every route code the web names has a line in both languages', () => {
  for (const code of COLLATERAL_FAILURES) {
    assert.equal(collateralFailureOf(code), code)
    assert.ok(COLLATERAL_COPY.en.failures[code].length > 0)
    assert.ok(COLLATERAL_COPY.uk.failures[code].length > 0)
  }
  assert.equal(collateralFailureOf('SESSION_EXPIRED'), 'signIn')
  assert.equal(collateralFailureOf('TICKET_EXPIRED'), 'reviewAged')
  assert.equal(collateralFailureOf('SOMETHING_NEW'), 'general')
  assert.equal(collateralFailureOf(null), 'general')
  assert.equal(COLLATERAL_COPY.uk.failures.NEEDS_SOL, 'Гаманцю потрібно трохи SOL на комісію мережі.')
  for (const locale of ['en', 'uk']) {
    const keys = Object.keys(COLLATERAL_COPY[locale].failures).sort()
    assert.deepEqual(keys, Object.keys(COLLATERAL_COPY.en.failures).sort())
  }
})

/** The collateral routes as doubles: what was asked, and the answers a test sets. */
function routes(answers = {}) {
  const calls = { states: [], review: [], submit: [], status: [] }
  const answer = async (value) => {
    if (value instanceof Error) throw value
    return value
  }
  return {
    calls,
    api: {
      states: async (owner) => (calls.states.push(owner), answer(answers.states ?? { deposit: false })),
      account: async () => answer(answers.account ?? { state: 'none' }),
      review: async (session, body) => (calls.review.push(body), answer(answers.review ?? REVIEW_DEPOSIT)),
      submit: async (session, body) => (
        calls.submit.push(body),
        answer(
          answers.submit ?? {
            results: [{ signature: SIGNATURE, state: 'LANDED', reason: null, usdcMoved: '-25000000' }],
            settled: true,
          },
        )
      ),
      status: async (signature) => (
        calls.status.push(signature),
        answer(answers.status ?? { results: [{ signature, state: 'LANDED', reason: null, usdcMoved: '-25000000' }] })
      ),
    },
  }
}

const BODY = { action: 'deposit', owner: OWNER, amount: '25000000' }

test('the routes read: a closed gate stays closed; the margin comes from the account route', async () => {
  assert.deepEqual(await readCollateralStates(routes().api, OWNER), COLLATERAL_CLOSED)
  const open = routes({ states: { deposit: true, withdraw: true, maxMicro: null, walletUsdc: '120500000' } })
  assert.equal((await readCollateralStates(open.api, OWNER)).walletUsdc, 120_500_000n)
  assert.deepEqual(open.calls.states, [OWNER])
  assert.equal(await readCollateralMargin(routes().api, OWNER), null)
  const margin = await readCollateralMargin(
    routes({
      account: { state: 'active', margin: { withdrawableMicro: '3000000', canDeposit: true, canWithdraw: true } },
    }).api,
    OWNER,
  )
  assert.equal(margin.withdrawableMicro, 3_000_000n)
})

test('the Review: a closed gate is said, nothing built; an answer for another move is no Review of this one', async () => {
  const closed = routes({ review: new ApiError('ACTIONS_CLOSED', 'Not open.', 403) })
  const refused = await reviewCollateral(closed.api, SESSION, BODY)
  assert.deepEqual(refused, { ok: false, reason: 'ACTIONS_CLOSED' })
  assert.deepEqual(closed.calls.review, [BODY])
  assert.equal(COLLATERAL_COPY.uk.failures[refused.reason], 'Поповнення й виведення для цього гаманця ще не відкриті.')
  assert.equal(
    (await reviewCollateral(routes({ review: new TypeError('offline') }).api, SESSION, BODY)).reason,
    'network',
  )
  assert.equal((await reviewCollateral(routes({ review: { nonsense: true } }).api, SESSION, BODY)).reason, 'general')
  const other = await reviewCollateral(routes().api, SESSION, { ...BODY, amount: '30000000' })
  assert.deepEqual(other, { ok: false, reason: 'general' })
  const ok = await reviewCollateral(routes().api, SESSION, BODY, () => 1_000)
  assert.equal(ok.ok, true)
  assert.equal(ok.receivedAt, 1_000)
})

test('the move: the wallet signs the exact bytes once, the relay gets them with the ticket, the chain’s USDC comes back', async () => {
  const { api, calls } = routes()
  const review = parseCollateralReview(REVIEW_DEPOSIT)
  const handed = []
  let signedTold = 0
  const outcome = await signAndRelayCollateral({
    api,
    wallet: { signTransaction: async (wire) => (handed.push(wire), signedWire(OWNER)) },
    session: SESSION,
    review,
    receivedAt: 1_000,
    wait: { now: () => 2_000, onSigned: () => (signedTold += 1) },
  })
  assert.deepEqual(handed, [review.wireBase64])
  assert.equal(signedTold, 1)
  assert.equal(calls.submit.length, 1)
  assert.equal(calls.submit[0].ticket, 'sample-ticket')
  assert.deepEqual(calls.submit[0].signed, [signedWire(OWNER)])
  assert.deepEqual(outcome, {
    kind: 'sent',
    result: { signature: SIGNATURE, state: 'LANDED', usdcMoved: -25_000_000n },
  })
})

test('bytes too short for a wallet, or signed after their window, are never relayed', async () => {
  const review = parseCollateralReview(REVIEW_DEPOSIT)
  const { api, calls } = routes()
  let asked = 0
  const early = await signAndRelayCollateral({
    api,
    wallet: { signTransaction: async () => ((asked += 1), signedWire(OWNER)) },
    session: SESSION,
    review,
    receivedAt: 0,
    wait: { now: () => 20_000 },
  })
  assert.deepEqual(early, { kind: 'refused', reason: 'reviewAged', afterSignature: false })
  assert.equal(asked, 0)
  let clock = 1_000
  const late = await signAndRelayCollateral({
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

test('the wallet’s refusals send nothing; the relay’s refusals before sending are said; a lost answer follows the signature', async () => {
  const review = parseCollateralReview(REVIEW_DEPOSIT)
  const base = { session: SESSION, review, receivedAt: 1_000, wait: { now: () => 2_000 } }
  const wallet = { signTransaction: async () => signedWire(OWNER) }
  const refuse = await signAndRelayCollateral({
    ...base,
    api: routes().api,
    wallet: { signTransaction: async () => Promise.reject(new Error('User rejected')) },
  })
  assert.deepEqual(refuse, { kind: 'refused', reason: 'walletRefused', afterSignature: false })
  const sol = await signAndRelayCollateral({
    ...base,
    wallet,
    api: routes({ submit: new ApiError('RELAY_REFUSED', 'Refused.', 422) }).api,
  })
  assert.deepEqual(sol, { kind: 'refused', reason: 'RELAY_REFUSED', afterSignature: true })
  const expired = await signAndRelayCollateral({
    ...base,
    wallet,
    api: routes({ submit: new ApiError('TICKET_EXPIRED', 'Old.', 410) }).api,
  })
  assert.deepEqual(expired, { kind: 'refused', reason: 'reviewAged', afterSignature: true })
  // A gateway's page or no answer after the bytes left: never «nothing moved» — the chain is asked.
  for (const lost of [new ApiError('HTTP_504', 'Gateway', 504), new TypeError('offline'), { nothing: true }]) {
    const outcome = await signAndRelayCollateral({ ...base, wallet, api: routes({ submit: lost }).api })
    assert.equal(outcome.kind, 'sent')
    assert.equal(outcome.result.state, 'UNKNOWN')
    assert.equal(outcome.result.signature.length > 80, true)
  }
})

test('the receipt follows the chain: a landed word with its figure replaces the unknown; a failed read keeps it', async () => {
  const waiting = { signature: SIGNATURE, state: 'UNKNOWN' }
  const { api, calls } = routes()
  assert.deepEqual(await followCollateral(api, waiting), {
    signature: SIGNATURE,
    state: 'LANDED',
    usdcMoved: -25_000_000n,
  })
  assert.deepEqual(calls.status, [SIGNATURE])
  assert.deepEqual(await followCollateral(routes({ status: new TypeError('offline') }).api, waiting), waiting)
})

test('C4e: a wallet short of USDC is one under the minimum; one that holds some keeps «more than the wallet»', () => {
  // The operator's Seeker on 2026-10-23: 0.005753 USDC in the wallet.
  assert.equal(walletShort(5_753n), true)
  assert.equal(walletShort(0n), true)
  assert.equal(walletShort(1_000_000n), false)
  assert.equal(walletShort(10_000_000n), false)
  assert.equal(walletShort(null), false)
})

test('C4e: the deposit sheet leads on — its Review, a trade on what is free, or USDC for the wallet', () => {
  const base = { walletUsdc: 5_753n, open: true, freeUsd: 1.85, toTrade: true }
  // The operator's case from the account card: free collateral, no USDC — the trade, not a dead grey button.
  assert.equal(depositWay(base), 'trade')
  // From a ticket (no way back into it) — USDC for the wallet.
  assert.equal(depositWay({ ...base, toTrade: false }), 'buy')
  // Too little free for a trade, or unknown — USDC for the wallet.
  assert.equal(depositWay({ ...base, freeUsd: 0.5 }), 'buy')
  assert.equal(depositWay({ ...base, freeUsd: null }), 'buy')
  // A wallet that can deposit keeps the Review, whatever was typed.
  assert.equal(depositWay({ ...base, walletUsdc: 10_000_000n }), 'review')
  // Deposits closed (the gate, or Phoenix on this account), or the wallet not read: the Review and its own line.
  assert.equal(depositWay({ ...base, open: false }), 'review')
  assert.equal(depositWay({ ...base, walletUsdc: null }), 'review')
})

test('C4e: the short deposit has its words and its ways on in both languages', () => {
  for (const words of [COLLATERAL_COPY.en, COLLATERAL_COPY.uk]) {
    assert.ok(words.walletShort.length > 0 && words.buyUsdc.length > 0 && words.receiveUsdc.length > 0)
    assert.ok(words.toTrade.length > 0)
    assert.match(words.freeNow('1.85 USDC · 11:28'), /1\.85 USDC · 11:28/)
  }
})
