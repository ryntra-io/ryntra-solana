import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  blocksNewSend,
  checkNotes,
  checkRows,
  decideResume,
  decimalText,
  evidenceSummary,
  linkAmount,
  linkAmountInput,
  linkIsLive,
  overBalance,
  parsePendingSend,
  recipientView,
  resumeReadOf,
  sendAssets,
  sendFailureKey,
  settleOutcome,
  settleRefusedBeforeSubmit,
  transferInput,
} from './money-model.ts'
import { qrPath } from './qr.ts'
import { payLink, resumePending, sameTerms, sendReviewed } from './send-flow.ts'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const ME = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const THEM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SIG = '5'.repeat(88)

test('Send offers what can move: USDC first, SOL next, the rest by worth; nothing at zero', () => {
  const assets = sendAssets([
    {
      kind: 'TOKEN',
      mint: 'Bonk1111111111111111111111111111111111111111',
      spendableRaw: '5000000',
      decimals: 5,
      symbol: 'BONK',
      name: null,
      catalog: { symbol: 'BONK', name: 'Bonk', usdPrice: '0.00002' },
    },
    {
      kind: 'NATIVE_SOL',
      mint: null,
      spendableRaw: '1500000000',
      decimals: 9,
      symbol: null,
      name: null,
      catalog: null,
    },
    {
      kind: 'TOKEN',
      mint: USDC,
      spendableRaw: '12500000',
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      catalog: { symbol: 'USDC', name: 'USD Coin', usdPrice: '1' },
    },
    {
      kind: 'TOKEN',
      mint: 'Zero111111111111111111111111111111111111111',
      spendableRaw: '0',
      decimals: 6,
      symbol: 'ZERO',
      name: null,
      catalog: null,
    },
  ])
  assert.deepEqual(
    assets.map((asset) => asset.symbol),
    ['USDC', 'SOL', 'BONK'],
  )
  assert.equal(assets[1].mint, null)
  assert.equal(assets[1].decimals, 9)
})

test('the transfer input is native for SOL and a token transfer otherwise', () => {
  const sol = transferInput({ mint: null }, ME, THEM, '1000')
  assert.equal(sol.actionRef, 'action:solana-token-2022/native-sol-transfer@1')
  assert.equal('mint' in sol, false)
  const token = transferInput({ mint: USDC }, ME, THEM, '1000000')
  assert.equal(token.actionRef, 'action:solana-token-2022/spl-transfer@1')
  assert.equal(token.mint, USDC)
  assert.equal(token.network, 'mainnet')
})

test('more than the spendable balance is refused before any Review', () => {
  assert.equal(overBalance('1000001', { spendableRaw: '1000000' }), true)
  assert.equal(overBalance('1000000', { spendableRaw: '1000000' }), false)
  assert.equal(overBalance(null, { spendableRaw: '1' }), false)
})

test('an exact decimal is said in the person’s language, never invented', () => {
  assert.equal(decimalText('1250.5', 'en'), '1,250.5')
  assert.equal(decimalText('1250.5', 'uk'), '1 250,5')
  assert.equal(decimalText('0.000005', 'uk'), '0,000005')
  assert.equal(decimalText('1.000000', 'en'), '1')
  assert.equal(decimalText('1,250', 'en'), '—')
  assert.equal(decimalText(null, 'en'), '—')
})

function check(overrides = {}) {
  return {
    asset: { mint: USDC, decimals: 6 },
    from: ME,
    to: { address: THEM, kind: 'wallet', owner: THEM, account: THEM, opensAccount: false },
    send: { raw: '1000000', amount: '1' },
    issuerFee: null,
    receive: { raw: '1000000', amount: '1', less: false },
    networkFee: { lamports: '5000', sol: '0.000005' },
    setup: null,
    minimum: null,
    signable: true,
    blocked: null,
    warnings: [],
    ...overrides,
  }
}

test('«Перевірка» is the server’s rows, labelled in the card’s order', () => {
  const rows = checkRows(check(), 'USDC', 'uk')
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Надсилаєш', 'Комісія мережі (оцінка)'],
  )
  assert.equal(rows[0].value, '1 USDC')
  assert.equal(rows[1].value, '0,000005 SOL')
  const fuller = checkRows(
    check({
      issuerFee: { raw: '10000', amount: '0.01', basisPoints: 100 },
      receive: { raw: '990000', amount: '0.99', less: true },
      setup: { lamports: null, sol: null },
    }),
    'PYUSD',
    'en',
  )
  assert.deepEqual(
    fuller.map((row) => row.label),
    ['You send', 'Transfer fee', 'Recipient gets', 'Network fee estimate', 'Account setup'],
  )
  // A rent the server could not read is a dash, never a zero.
  assert.equal(fuller.at(-1).value, '—')
})

test('what to read before confirming comes in the server’s words', () => {
  const notes = checkNotes(
    check({
      signable: false,
      blocked: { en: 'This transfer would fail.', uk: 'Цей переказ не пройде.', code: 'SIMULATION_FAILED' },
      warnings: [{ en: 'The issuer keeps a fee.', uk: 'Емітент утримує комісію.', code: 'TRANSFER_FEE', stops: false }],
    }),
    'uk',
  )
  assert.equal(notes.blocked, 'Цей переказ не пройде.')
  assert.deepEqual(notes.warnings, [{ line: 'Емітент утримує комісію.', stops: false }])
})

test('a refusal is matched to the card’s sentence', () => {
  assert.equal(sendFailureKey('INSUFFICIENT_BALANCE'), 'amount')
  assert.equal(sendFailureKey('RECIPIENT_UNSUPPORTED'), 'recipient')
  assert.equal(sendFailureKey('PLAN_EXPIRED'), 'window')
  assert.equal(sendFailureKey('SUBMISSION_UNKNOWN'), 'earlier')
  assert.equal(sendFailureKey('BYTES_CHANGED'), 'bytes')
  assert.equal(sendFailureKey('WALLET_REFUSED'), 'walletCancelled')
  assert.equal(sendFailureKey('SEND_NOT_PERMITTED'), 'turnedOff')
  assert.equal(sendFailureKey('SOMETHING_NEW'), 'generic')
})

test('a settle refusal frees the record only when nothing reached the network', () => {
  assert.equal(settleRefusedBeforeSubmit('NOT_READY', null), true)
  assert.equal(settleRefusedBeforeSubmit('SUBMISSION_UNKNOWN', null), false)
  assert.equal(settleRefusedBeforeSubmit('REQUEST_DEADLINE', null), false)
  // The submit boundary reserved the attempt before an RPC rejection: kept, as the web keeps it.
  assert.equal(settleRefusedBeforeSubmit('REJECTED', null), false)
  // A refusal that names a signature crossed the boundary.
  assert.equal(settleRefusedBeforeSubmit('NOT_READY', SIG), false)
})

test('the outcome is sent, not sent, or open — never guessed', () => {
  assert.equal(settleOutcome({ state: 'RECEIPTED', landingState: 'FINALIZED' }), 'sent')
  assert.equal(settleOutcome({ state: 'RECEIPTED', landingState: 'LANDED_FAILED' }), 'not-sent')
  assert.equal(settleOutcome({ state: 'EXPIRED' }), 'not-sent')
  // Landed and confirmed, its receipt not yet observed: the money moved.
  assert.equal(settleOutcome({ state: 'RECOVERY', landingState: 'CONFIRMED' }), 'sent')
  assert.equal(settleOutcome({ state: 'RECOVERY', landingState: 'LANDED_FAILED' }), 'not-sent')
  assert.equal(settleOutcome({ state: 'UNKNOWN' }), 'open')
  assert.equal(settleOutcome({ state: 'SUBMITTED' }), 'open')
})

test('the resume rule is the web’s: no answer keeps the record, a seen signature ends it', () => {
  assert.deepEqual(decideResume({ read: null, ageMs: 10 }), { show: 'UNKNOWN', forget: false, keepPolling: true })
  assert.deepEqual(decideResume({ read: { seen: true, err: null, hasAttempt: true }, ageMs: 10 }), {
    show: 'LANDED',
    forget: true,
    keepPolling: false,
  })
  assert.equal(decideResume({ read: { seen: true, err: 'x', hasAttempt: false }, ageMs: 10 }).show, 'FAILED')
  assert.deepEqual(decideResume({ read: { seen: false, err: null, hasAttempt: false }, ageMs: 200_000 }), {
    show: null,
    forget: true,
    keepPolling: false,
  })
  assert.equal(decideResume({ read: { seen: false, err: null, hasAttempt: true }, ageMs: 200_000 }).forget, false)
  assert.equal(blocksNewSend('UNKNOWN'), true)
  assert.equal(blocksNewSend('CHECKING'), true)
  assert.equal(blocksNewSend('LANDED'), false)
  assert.equal(blocksNewSend(null), false)
})

test('a recovery read takes the independent sighting when the primary saw nothing', () => {
  const status = (seen, err = null) => ({ state: 'READ', status: { seen, err, confirmationStatus: null, slot: null } })
  assert.deepEqual(resumeReadOf({ attempt: null, primary: status(false), independent: status(true) }), {
    seen: true,
    err: null,
    hasAttempt: false,
  })
})

test('a stored record read back is untrusted', () => {
  const good = {
    schema: 'ryntra.mobile.send-pending',
    wallet: ME,
    signature: SIG,
    network: 'mainnet',
    signedAt: '2026-10-05T10:00:00.000Z',
    summary: null,
  }
  assert.deepEqual(parsePendingSend(JSON.stringify(good)), good)
  assert.equal(parsePendingSend(JSON.stringify({ ...good, signature: 'short' })), null)
  assert.equal(parsePendingSend(JSON.stringify({ ...good, network: 'devnet' })), null)
  assert.equal(parsePendingSend('{not json'), null)
  assert.equal(parsePendingSend(null), null)
})

test('the recipient check’s one decision, in words', () => {
  const base = {
    input: 'address',
    asset: { mint: null },
    destination: null,
    asked: null,
    link: null,
    checkedAt: '2026-10-05T10:00:00.000Z',
  }
  assert.deepEqual(
    recipientView({
      ...base,
      next: 'transfer',
      problem: null,
      address: THEM,
      destination: { kind: 'wallet', owner: THEM, account: THEM, opensAccount: true },
    }),
    {
      kind: 'transfer',
      address: THEM,
      opensAccount: true,
    },
  )
  assert.deepEqual(recipientView({ ...base, next: 'none', problem: 'SELF', address: ME }, 'uk'), {
    kind: 'problem',
    line: 'Це твій власний гаманець. Введи іншого отримувача.',
  })
  assert.equal(
    recipientView({ ...base, next: 'none', problem: 'REFERENCE_UNSUPPORTED', address: null }).line,
    'Pay this request in your wallet app.',
  )
  // One's own payment link is named as a link, not as a wallet.
  assert.equal(
    recipientView({ ...base, input: 'pay-link', next: 'none', problem: 'SELF', address: ME }, 'uk').line,
    'Це твоє власне посилання на оплату.',
  )
})

test('the security source’s word is one of six, never «safe»', () => {
  const evidence = (sanctions, findings) => ({
    state: 'FRESH',
    evidence: { sanctions: { state: sanctions }, findings },
    reason: null,
    served: 'provider',
  })
  assert.equal(evidenceSummary({ state: 'UNAVAILABLE', evidence: null }), 'unavailable')
  assert.equal(evidenceSummary({ state: 'UNKNOWN', evidence: null }), 'unsupported')
  assert.equal(evidenceSummary(evidence('sanctioned', { state: 'answered', high: 0, medium: 0 })), 'sanctioned')
  assert.equal(evidenceSummary(evidence('clean', { state: 'answered', high: 1, medium: 0 })), 'evidence-found')
  assert.equal(evidenceSummary(evidence('clean', { state: 'answered', high: 0, medium: 0 })), 'nothing-found')
  assert.equal(evidenceSummary(evidence('unavailable', { state: 'answered', high: 0, medium: 0 })), 'partly-checked')
})

test('a link’s amount is typed as the contract takes it, and said in the person’s language', () => {
  assert.equal(linkAmountInput(''), null)
  assert.equal(linkAmountInput('1'), '1')
  assert.equal(linkAmountInput('0,50'), '0.50')
  assert.equal(linkAmountInput('007.5'), '7.5')
  assert.equal(linkAmountInput('0'), 'invalid')
  assert.equal(linkAmountInput('1.2.3'), 'invalid')
  const link = { token: { symbol: 'USDC', mint: USDC, decimals: 6 }, amount: { raw: '1250000000', display: '1,250' } }
  assert.equal(linkAmount(link, 'uk'), '1 250 USDC')
  assert.equal(linkAmount({ ...link, amount: null }, 'en'), null)
  assert.equal(linkIsLive('AWAITING'), true)
  assert.equal(linkIsLive('PAID'), false)
})

test('a QR code is one path on its own grid, the same for the same text', () => {
  const one = qrPath(`solana:${ME}`)
  assert.equal(one.size, 33)
  assert.match(one.path, /^M0 0h7v1h-7z/)
  assert.deepEqual(qrPath(`solana:${ME}`), one)
})

/* ---- the flow, with doubles ---- */

function review(overrides = {}) {
  return {
    plan: {
      actionKind: 'SPL_TRANSFER_CHECKED',
      unsignedWireBase64: 'UNSIGNED',
      fingerprint: { messageHash: 'H', feePayer: ME },
    },
    preflight: {},
    verdict: {},
    provider: { role: 'primary', host: 'rpc' },
    canaryIntent: {},
    canaryVerdict: {},
    reviewProof: {},
    check: check(),
    ...overrides,
  }
}

function memoryStore() {
  const rows = new Map()
  return {
    get: (wallet) => rows.get(wallet) ?? null,
    set: (pending) => rows.set(pending.wallet, pending),
    clear: (wallet) => rows.delete(wallet),
    rows,
  }
}

const TRANSFER = transferInput({ mint: USDC }, ME, THEM, '1000000')

function api(overrides = {}) {
  const calls = []
  return {
    calls,
    plan: async (input) => (calls.push(['plan', input]), review()),
    returned: async (request) => (
      calls.push(['returned', request]),
      { verdict: 'BYTES_MATCH', next: 'settle', signature: SIG, detail: '' }
    ),
    adopt: async (request) => (calls.push(['adopt', request]), review()),
    settle: async (request) => (
      calls.push(['settle', request]),
      { state: 'RECEIPTED', landingState: 'FINALIZED', signature: SIG }
    ),
    ...overrides,
  }
}

const wallet = { signTransaction: async (wire) => `${wire}:SIGNED` }

test('a transfer is planned again, signed, written down, settled once and forgotten on its receipt', async () => {
  const doubles = api()
  const pending = memoryStore()
  let written = null
  const settle = doubles.settle
  doubles.settle = async (request) => {
    written = pending.get(ME)
    return settle(request)
  }
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
  })
  assert.equal(result.ok, true)
  assert.equal(result.outcome, 'sent')
  assert.equal(written?.signature, SIG, 'the signature is kept before the settle is asked')
  assert.equal(pending.get(ME), null)
  assert.deepEqual(
    doubles.calls.map(([name]) => name),
    ['plan', 'returned', 'settle'],
  )
  assert.equal(doubles.calls[2][1].signedWireBase64, 'UNSIGNED:SIGNED')
})

test('a Review whose terms moved goes back to the person, not to the wallet', async () => {
  const moved = review({ check: check({ send: { raw: '2000000', amount: '2' } }) })
  const doubles = api({ plan: async () => moved })
  let opened = false
  const result = await sendReviewed({
    api: doubles,
    wallet: { signTransaction: async () => ((opened = true), 'x') },
    pending: memoryStore(),
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'changed')
  assert.equal(result.review, moved)
  assert.equal(opened, false)
  assert.equal(sameTerms(review(), review()), true)
})

test('a Review that is not signable never opens the wallet', async () => {
  const doubles = api({ plan: async () => review({ check: check({ signable: false }) }) })
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending: memoryStore(),
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'cannotSend')
})

test('bytes the wallet changed stop everything, and nothing is written down', async () => {
  const pending = memoryStore()
  const doubles = api({
    returned: async () => ({ verdict: 'BYTES_CHANGED', next: 'stop', signature: SIG, detail: '' }),
  })
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'bytes')
  assert.equal(pending.rows.size, 0)
})

test('a wallet that added only its fee is adopted, read again and settled with the adopted Review', async () => {
  let reads = 0
  const adopted = review({ reviewProof: { adopted: true } })
  const doubles = api({
    returned: async () =>
      (reads += 1) === 1
        ? { verdict: 'BYTES_FEE_ADDED', next: 'adopt', signature: SIG, detail: '' }
        : { verdict: 'BYTES_MATCH', next: 'settle', signature: SIG, detail: '' },
    adopt: async () => adopted,
  })
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending: memoryStore(),
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(doubles.calls.at(-1)[1].reviewProof, { adopted: true })
})

test('a settle refused before submit lets the record go; one with no answer keeps it', async () => {
  const refused = memoryStore()
  const before = await sendReviewed({
    api: api({
      settle: async () => {
        throw new ApiError('NOT_READY', 'no', 409)
      },
    }),
    wallet,
    pending: refused,
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(before.ok, false)
  assert.equal(before.phase, 'review')
  assert.equal(refused.rows.size, 0)

  const silent = memoryStore()
  const open = await sendReviewed({
    api: api({
      settle: async () => {
        throw new Error('socket closed')
      },
    }),
    wallet,
    pending: silent,
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(open.ok, false)
  assert.equal(open.phase, 'open')
  assert.equal(open.signature, SIG)
  assert.equal(silent.get(ME)?.signature, SIG)
})

test('an open earlier transfer holds back a new signature', async () => {
  const pending = memoryStore()
  pending.set({
    schema: 'ryntra.mobile.send-pending',
    wallet: ME,
    signature: SIG,
    network: 'mainnet',
    signedAt: new Date().toISOString(),
    summary: null,
  })
  const doubles = api()
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'earlier')
  assert.equal(doubles.calls.length, 0)
})

test('a signed transfer is read again until the network answers, then forgotten', async () => {
  const pending = memoryStore()
  const record = {
    schema: 'ryntra.mobile.send-pending',
    wallet: ME,
    signature: SIG,
    network: 'mainnet',
    signedAt: '1970-01-01T00:00:00.000Z',
    summary: null,
  }
  pending.set(record)
  const shown = []
  let reads = 0
  const status = (seen) => ({ state: 'READ', status: { seen, err: null, confirmationStatus: null, slot: null } })
  const final = await resumePending({
    recover: async () => ((reads += 1), { attempt: {}, primary: status(reads >= 2), independent: null }),
    pending,
    record,
    show: (value) => shown.push(value),
    live: () => true,
    now: () => 1_000,
    sleep: async () => undefined,
  })
  assert.equal(final, 'LANDED')
  assert.deepEqual(shown, ['CHECKING', 'UNKNOWN', 'LANDED'])
  assert.equal(pending.rows.size, 0)
})

test('a Ryntra link is paid on its own routes: the transaction, the signature, one submit', async () => {
  const calls = []
  const result = await payLink({
    api: {
      transaction: async (id, request) => (
        calls.push(['transaction', id, request]),
        {
          data: {
            intentId: 'I',
            unsignedWireBase64: 'PAY',
            createsRecipientAccount: false,
            simulated: { succeeded: true, error: null },
          },
        }
      ),
      submit: async (id, request) => (calls.push(['submit', id, request]), { data: { signature: SIG, view: null } }),
    },
    wallet,
    id: 'abc',
    payer: ME,
    amount: null,
  })
  assert.deepEqual(result, { ok: true, signature: SIG, createsAccount: false })
  assert.deepEqual(calls[0][2], { payer: ME })
  assert.deepEqual(calls[1][2], { intentId: 'I', signedWireBase64: 'PAY:SIGNED' })

  const pending = await payLink({
    api: {
      transaction: async () => {
        throw new ApiError('PAYMENT_PENDING', 'on its way', 409)
      },
      submit: async () => assert.fail(),
    },
    wallet,
    id: 'abc',
    payer: ME,
    amount: '1',
  })
  assert.equal(pending.ok, false)
  assert.equal(pending.failure.key, 'payPending')
  assert.equal(pending.sent, 'no')

  // A transaction the server saw fail in simulation never opens the wallet.
  let opened = false
  const tx = (simulated) => async () => ({
    data: { intentId: 'I', unsignedWireBase64: 'PAY', createsRecipientAccount: false, simulated },
  })
  const failed = await payLink({
    api: { transaction: tx({ succeeded: false, error: 'x' }), submit: async () => assert.fail() },
    wallet: { signTransaction: async () => ((opened = true), 'x') },
    id: 'abc',
    payer: ME,
    amount: null,
  })
  assert.equal(failed.ok, false)
  assert.equal(opened, false)

  // No answer to the submit is never «sent»: the link's own state decides; a refusal the server stated is «not sent».
  const silent = await payLink({
    api: {
      transaction: tx(null),
      submit: async () => {
        throw new Error('timeout')
      },
    },
    wallet,
    id: 'abc',
    payer: ME,
    amount: null,
  })
  assert.equal(silent.ok === false && silent.sent, 'unknown')
  const refused = await payLink({
    api: {
      transaction: tx(null),
      submit: async () => {
        throw new ApiError('INTENT_EXPIRED', 'expired', 409)
      },
    },
    wallet,
    id: 'abc',
    payer: ME,
    amount: null,
  })
  assert.equal(refused.ok === false && refused.sent, 'no')
})

test('a Review closed while it is rebuilt never opens the wallet', async () => {
  let opened = false
  let closed = false
  const doubles = api({ plan: async () => ((closed = true), review()) })
  const result = await sendReviewed({
    api: doubles,
    wallet: { signTransaction: async () => ((opened = true), 'x') },
    pending: memoryStore(),
    read: review(),
    transfer: TRANSFER,
    summary: null,
    cancelled: () => closed,
  })
  assert.equal(result.ok, false)
  assert.equal(opened, false)
})

test('a wallet answer with no signature to write down is never settled', async () => {
  const pending = memoryStore()
  const doubles = api({
    returned: async () => ({ verdict: 'BYTES_MATCH', next: 'settle', signature: null, detail: '' }),
  })
  const result = await sendReviewed({
    api: doubles,
    wallet,
    pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(
    doubles.calls.some(([name]) => name === 'settle'),
    false,
  )
})

test('a fresh Review that adds a cost the person did not read goes back to them', async () => {
  const costlier = review({
    check: check({
      to: { address: THEM, kind: 'wallet', owner: THEM, account: THEM, opensAccount: true },
      setup: { lamports: '2039280', sol: '0.00203928' },
    }),
  })
  const result = await sendReviewed({
    api: api({ plan: async () => costlier }),
    wallet,
    pending: memoryStore(),
    read: review(),
    transfer: TRANSFER,
    summary: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'changed')
})
