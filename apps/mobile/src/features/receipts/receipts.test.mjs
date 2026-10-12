import assert from 'node:assert/strict'
import { test } from 'node:test'

import { historyRow } from '../history/history-model.ts'
import { HISTORY_COPY } from '../history/copy.ts'
import { launchWords } from '../launch/copy.ts'
import { SAMPLE_JOURNAL } from '../launch/market-samples.ts'
import { RECEIPTS_COPY } from './copy.ts'
import {
  MASK,
  docFromClaim,
  docFromClaimResult,
  docFromHistory,
  docFromJournal,
  docFromLaunch,
  docFromLaunchTrade,
  docFromSend,
  docFromSwap,
  docTimes,
  feeText,
  legText,
  matchesQuery,
  mergeDocs,
  shareFace,
} from './receipt-doc.ts'

const WALLET = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const RECIPIENT = 'rEGbG2sq7PYPyFQy6Z7V3qytZDdurrvxihf8zQ7Laax'
const MINT = '7SKYne72sKvopLugvb4ibrpy1goHYAfRo68Q67A1vVDw'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC = { mint: USDC_MINT, symbol: 'USDC', decimals: 6, dollar: true }
const SIG = 'YSVkFJC5xYEJj3WwwxW5yB9c2djidUa7R8GUGedJ55Sf6DtajHGyLnBNjAbxr7WzPLiUnHMcAK3HtJ7g2U5jkNL'
const AT = '2026-10-06T21:30:00.000Z'

/** The legs as the document has them: the hero put back at the head of its own leg. */
function full(face) {
  return {
    gave: face.lead === 'gave' ? [face.hero, ...face.gave] : face.gave,
    got: face.lead === 'got' ? [face.hero, ...face.got] : face.got,
  }
}

/** Every string of the picture, flattened — what a test reads to prove what is and is not on it. */
function pictureText(face) {
  return [
    face.title,
    face.hero ?? '',
    ...face.gave,
    ...face.got,
    ...face.parts.map((part) => part.text),
    ...face.fees.map((fee) => fee.text),
    face.detail ?? '',
    face.subject ?? '',
  ].join(' | ')
}

const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,}/

const swapAction = (over = {}) => ({
  actionId: SIG,
  lane: 'SWAP',
  outcome: 'DONE',
  out: { mint: USDC_MINT, amountRaw: '25000000', decimals: 6, symbol: 'USDC' },
  in: { mint: SOL, amountRaw: '123456789', decimals: 9, symbol: 'SOL' },
  destination: 'SOLANA',
  signature: SIG,
  fee: {
    collected: true,
    basisPoints: 50,
    amountRaw: '125000',
    decimals: 6,
    symbol: 'USDC',
    usd: 0.125,
    asset: USDC_MINT,
  },
  origin: { surface: 'SPOT', side: 'BUY' },
  startedAt: AT,
  updatedAt: AT,
  ...over,
})

test('a purchase from History: the legs, Ryntra’s fee on its own row, the state, the time — no signature on the picture', () => {
  const row = historyRow(swapAction(), 'uk')
  const doc = docFromHistory(row, HISTORY_COPY.uk.words.bought('SOL'))
  assert.equal(doc.kind, 'buy')
  assert.equal(doc.initiator, 'you')
  const shown = shareFace(doc, true, 'uk')
  assert.deepEqual(full(shown).gave, ['25 USDC'])
  assert.deepEqual(full(shown).got, ['0,123456 SOL'])
  assert.deepEqual(shown.fees, [{ kind: 'ryntra', text: '0,125 USDC · 0,5%', collected: true }])
  assert.equal(shown.status, 'done')
  assert.doesNotMatch(pictureText(shown), BASE58)
})

test('hidden amounts: every figure is masked, the assets stay, a fee keeps only its rate', () => {
  const doc = docFromHistory(historyRow(swapAction(), 'en'), 'Bought SOL')
  const hidden = shareFace(doc, false, 'en')
  assert.deepEqual(full(hidden).gave, [`${MASK} USDC`])
  assert.deepEqual(full(hidden).got, [`${MASK} SOL`])
  assert.deepEqual(
    hidden.fees.map((fee) => fee.text),
    ['0.5%'],
  )
  assert.doesNotMatch(pictureText(hidden).replace(/\d{1,2} \w+ 2026, \d\d:\d\d( UTC)?/g, ''), /\d{2,}|0\.12|25/)
  assert.equal(hidden.hasAmounts, true)
})

test('a fee with neither amount nor rate is masked when hidden, a dash never stands for a hidden figure', () => {
  assert.equal(feeText({ kind: 'network', amount: '0.000005 SOL', percent: null, collected: true }, false, 'en'), MASK)
  assert.equal(feeText({ kind: 'ryntra', amount: null, percent: null, collected: true }, true, 'en'), '—')
})

test('a launch’s trade in History is a launch receipt, its token searchable', () => {
  const action = swapAction({ origin: { surface: 'LAUNCH', side: 'SELL', token: MINT, venue: 'pool' } })
  const doc = docFromHistory(historyRow(action, 'en'), 'Sold THUMB')
  assert.equal(doc.kind, 'launchSell')
  assert.ok(doc.mints.includes(MINT))
  assert.ok(matchesQuery(doc, MINT))
})

test('a receive names no initiator; a rule’s purchase names the rule', () => {
  const received = docFromHistory(historyRow(swapAction({ lane: 'RECEIVE', origin: null, out: null }), 'en'), 'x')
  assert.equal(received.initiator, null)
  const byRule = docFromHistory(
    historyRow(
      swapAction({ origin: { surface: 'SPOT', side: 'BUY', rule: { ruleId: 'r', occurrenceId: 'o' } } }),
      'en',
    ),
    'x',
  )
  assert.equal(byRule.initiator, 'rule')
})

test('a swap signed on the phone: the chain’s figures over the Review’s, Ryntra’s stated fee', () => {
  const context = {
    mode: 'swap',
    pay: { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9, logo: null },
    receive: { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: null },
    payDecimals: 9,
    receiveDecimals: 6,
    inAmountRaw: '20000000',
    outAmountRaw: '1900000',
    minReceivedRaw: '1890000',
  }
  const settlement = {
    state: 'MATCHED',
    signature: SIG,
    observation: { actualInputRaw: '20000000', actualOutputRaw: '1921719' },
    facts: {
      reconciliation: { state: 'MATCHED' },
      fees: {
        serviceFee: {
          mechanism: 'JUPITER_REFERRAL',
          state: 'COLLECTED',
          basisPoints: 50,
          requestedBasisPoints: 50,
          asset: USDC_MINT,
          symbol: 'USDC',
          decimals: 6,
          amountRaw: '9608',
          usd: null,
        },
      },
    },
    receipt: null,
  }
  const doc = docFromSwap({ title: 'Swapped SOL → USDC', status: 'done', settlement, context, at: AT }, 'en')
  const face = shareFace(doc, true, 'en')
  assert.deepEqual(full(face).gave, ['0.02 SOL'])
  assert.deepEqual(full(face).got, ['1.921719 USDC'])
  assert.deepEqual(face.fees[0], { kind: 'ryntra', text: '0.009608 USDC · 0.5%', collected: true })
  const failed = docFromSwap({ title: 'x', status: 'failed', settlement, context, at: AT }, 'en')
  assert.equal(failed.got.length, 0, 'nothing arrived on a swap that did not happen')
  assert.equal(failed.fees.length, 0)
})

test('a launch: the creator’s first buy, never the creator’s or the vault’s address', () => {
  const token = {
    network: 'solana:mainnet',
    token: MINT,
    name: 'Thumb',
    symbol: 'THUMB',
    description: '',
    image: null,
    links: { website: null, x: null, telegram: null },
    preset: 'protected',
    creator: WALLET,
    launchedAt: AT,
    signature: SIG,
    progressBps: 100,
    migrated: false,
    lock: null,
    receipt: {
      creator: WALLET,
      created: { signature: SIG, slot: 1, at: AT },
      creatorFirstBuy: { quoteInRaw: '1000000', tokensOutRaw: '197960754204', capRaw: '1' },
      token2022: { decimals: 6 },
      feeSharing: { vault: RECIPIENT, shares: [{ address: WALLET, bps: 10000 }] },
    },
    receiptProblems: [],
    shareLink: 'https://ryntra.io/launch/x?ref=abc',
    observedAt: AT,
  }
  const doc = docFromLaunch(token, USDC, 'Launched $THUMB', 'en')
  const face = shareFace(doc, true, 'en')
  assert.deepEqual(full(face).gave, ['$1.00'])
  assert.deepEqual(full(face).got, ['197,960.7542 $THUMB'])
  assert.doesNotMatch(pictureText(face), BASE58)
  assert.doesNotMatch(pictureText(face), /ref=/)
  assert.ok(matchesQuery(doc, '$thumb') && matchesQuery(doc, 'thu') && !matchesQuery(doc, 'sol'))
})

test('a launch’s trade: the fill, and the fee by who it went to — each on its own row', () => {
  const quote = {
    venue: 'curve',
    side: 'buy',
    amountInRaw: '10000000',
    amountOutRaw: '5000000000',
    minimumOutRaw: '4900000000',
    amountLeftRaw: '0',
    slippageBps: 100,
    feeBps: 100,
    fee: { totalRaw: '100000', creatorRaw: '40000', ryntraRaw: '20000', meteoraRaw: '40000', liquidityRaw: null },
    priceMoveBps: 10,
    marketCapAfter: { raw: '0' },
    referral: true,
    observedAt: AT,
  }
  const submit = { signature: SIG, state: 'CONFIRMED', filled: { tokensRaw: '5010000000', pairRaw: '10000000' } }
  const doc = docFromLaunchTrade(
    { token: MINT, symbol: 'THUMB', tokenDecimals: 6, pair: USDC, quote, submit, title: 'Bought $THUMB', at: AT },
    'en',
  )
  const face = shareFace(doc, true, 'en')
  assert.deepEqual(full(face).gave, ['$10.00'])
  assert.deepEqual(full(face).got, ['5,010 $THUMB'])
  assert.deepEqual(
    face.fees.map((fee) => [fee.kind, fee.text]),
    [
      ['venue', '$0.04'],
      ['creator', '$0.04'],
      ['ryntra', '$0.02'],
    ],
  )
  assert.equal(doc.status, 'done')
})

test('«Забрати»: what arrived and what each program paid; a source that paid nothing is not a row', () => {
  const receipt = {
    token: MINT,
    name: 'Thumb',
    symbol: 'THUMB',
    signature: SIG,
    at: AT,
    pair: USDC,
    paid: { curve: '3000000', graduation: '0', lp: '1500000' },
    vaultPaidRaw: null,
    receivedRaw: '4500000',
  }
  const doc = docFromClaim(receipt, 'Claimed · $THUMB', 'uk')
  const face = shareFace(doc, true, 'uk')
  assert.deepEqual(full(face).got, ['$4,50'])
  assert.deepEqual(
    face.parts.map((part) => [part.kind, part.text]),
    [
      ['curve', '$3,00'],
      ['lp', '$1,50'],
    ],
  )
  assert.deepEqual(
    shareFace(doc, false, 'uk').parts.map((part) => part.text),
    [`${MASK} USDC`, `${MASK} USDC`],
  )
})

test('dollars to the cent, cut and never rounded up; a crumb is «< $0.01», never a false zero', () => {
  const receipt = (receivedRaw) => ({
    token: MINT,
    name: 'Thumb',
    symbol: 'THUMB',
    signature: SIG,
    at: AT,
    pair: USDC,
    paid: { curve: '0', graduation: '0', lp: '0' },
    vaultPaidRaw: null,
    receivedRaw,
  })
  assert.deepEqual(full(shareFace(docFromClaim(receipt('4999'), 'x', 'en'), true, 'en')).got, ['< $0.01'])
  assert.deepEqual(full(shareFace(docFromClaim(receipt('1239999'), 'x', 'en'), true, 'en')).got, ['$1.23'])
})

test('a transfer: the network’s fee and a new account’s rent — the recipient is nowhere on the picture', () => {
  const result = {
    ok: true,
    state: 'RECEIPTED',
    signature: SIG,
    sendReceiptFacts: {
      mint: USDC_MINT,
      sender: WALLET,
      recipient: RECIPIENT,
      transferFeeRaw: '0',
      actualBaseFeeLamports: '5000',
      actualPriorityFeeLamports: '1200',
      ataRentLamports: '2039280',
    },
  }
  const doc = docFromSend(
    { outcome: 'sent', result, signature: SIG, amount: '1.000000', symbol: 'USDC', title: 'Sent USDC', at: AT },
    'en',
  )
  const face = shareFace(doc, true, 'en')
  assert.deepEqual(full(face).gave, ['1 USDC'])
  assert.deepEqual(
    face.fees.map((fee) => [fee.kind, fee.text]),
    [
      ['network', '0.0000062 SOL'],
      ['rent', '0.00203928 SOL'],
    ],
  )
  assert.equal(full(face).got.length, 0)
  assert.doesNotMatch(JSON.stringify(face), new RegExp(`${RECIPIENT}|${WALLET}`))
})

test('a journal entry: its words with the amounts or without them, its mark, never its transaction', () => {
  const word = launchWords('uk')
  for (const entry of SAMPLE_JOURNAL.events) {
    const doc = docFromJournal(entry, SAMPLE_JOURNAL, 'COMM', word, 'uk')
    const shown = shareFace(doc, true, 'uk')
    const hidden = shareFace(doc, false, 'uk')
    assert.doesNotMatch(pictureText(shown), BASE58, entry.kind)
    // Hidden, the entry's line goes: a sentence of masks says nothing.
    assert.equal(hidden.detail, null, entry.kind)
    if (doc.detail) assert.equal(hidden.hasAmounts, true, entry.kind)
    assert.equal(hidden.subject, '$COMM')
  }
})

test('the time twice — the phone’s clock and UTC — each with day and year; a dash when there is none', () => {
  const times = docTimes('2026-10-06T21:30:00.000Z', 'en')
  assert.match(times.utc, /^6 Oct 2026, 21:30 UTC$/)
  assert.match(times.local, /^\d{1,2} \w+ 2026, \d\d:\d\d$/)
  assert.deepEqual(docTimes(null, 'uk'), { local: '—', utc: '—' })
})

test('the list: every source once, newest first; the same transaction from two sources is one receipt', () => {
  const a = docFromHistory(historyRow(swapAction(), 'en'), 'a')
  const b = docFromHistory(
    historyRow(swapAction({ actionId: 'other-id-1', signature: 'sig-2', startedAt: '2026-10-07T00:00:00.000Z' }), 'en'),
    'b',
  )
  const merged = mergeDocs([a], [b, { ...a, id: 'dup' }])
  assert.deepEqual(
    merged.map((doc) => doc.title),
    ['b', 'a'],
  )
})

test('the words exist in both languages for every kind, state, fee and source', () => {
  for (const locale of ['en', 'uk']) {
    const copy = RECEIPTS_COPY[locale]
    for (const group of ['kinds', 'statuses', 'feeKinds', 'parts', 'initiators'])
      for (const value of Object.values(copy[group])) assert.ok(value.length > 0)
  }
  assert.deepEqual(Object.keys(RECEIPTS_COPY.uk.kinds), Object.keys(RECEIPTS_COPY.en.kinds))
})

test('the hidden picture carries no figure at all — not in its title, its hero, its legs or its fees', () => {
  const docs = [
    docFromHistory(historyRow(swapAction(), 'en'), 'Bought SOL'),
    docFromSend(
      { outcome: 'sent', result: null, signature: SIG, amount: '12.5', symbol: 'USDC', title: 'Sent USDC', at: AT },
      'en',
    ),
  ]
  for (const doc of docs) {
    const hidden = shareFace(doc, false, 'en')
    assert.equal(hidden.hero, null)
    assert.doesNotMatch(pictureText(hidden).replace(/\d+(\.\d+)?%/g, ''), /\d/)
  }
})

test('an operation that did not happen moved nothing: no legs, only a fee that was taken all the same', () => {
  const failed = docFromHistory(historyRow(swapAction({ outcome: 'FAILED' }), 'en'), 'x')
  assert.equal(failed.status, 'failed')
  assert.deepEqual([failed.gave, failed.got], [[], []])
  assert.equal(failed.fees.length, 1, 'the collected fee stays')
  const notSent = docFromSend(
    { outcome: 'not-sent', result: null, signature: null, amount: '1', symbol: 'USDC', title: 'x', at: AT },
    'en',
  )
  assert.deepEqual(notSent.gave, [])
})

const settled = (fee, observation = {}) => ({
  state: 'MATCHED',
  signature: SIG,
  observation: { actualInputRaw: '20000000', actualOutputRaw: '1921719', ...observation },
  facts: { reconciliation: { state: 'MATCHED' }, fees: fee ? { serviceFee: fee } : {} },
  receipt: null,
})
const fee = (state, over = {}) => ({
  mechanism: 'JUPITER_REFERRAL',
  state,
  basisPoints: 50,
  requestedBasisPoints: 50,
  asset: USDC_MINT,
  symbol: 'USDC',
  decimals: 6,
  amountRaw: '9608',
  usd: null,
  ...over,
})
const SWAP_CONTEXT = {
  mode: 'swap',
  pay: { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9 },
  receive: { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  payDecimals: 9,
  receiveDecimals: 6,
  inAmountRaw: '20000000',
  outAmountRaw: '1900000',
  minReceivedRaw: '1890000',
}
const swapDoc = (settlement, over = {}) =>
  docFromSwap({ title: 'x', status: 'done', settlement, context: SWAP_CONTEXT, at: AT, ...over }, 'en')

test('Ryntra’s fee: a row only where it was due — taken, or due and not taken; the amount the chain shows it took', () => {
  for (const state of ['NONE', 'UNCONFIGURED', 'NOT_APPLIED', 'QUOTED'])
    assert.equal(swapDoc(settled(fee(state))).fees.length, 0, state)
  const notTaken = swapDoc(settled(fee('NOT_COLLECTED'))).fees[0]
  assert.equal(notTaken.collected, false)
  assert.equal(notTaken.amount, null)
  const taken = swapDoc(settled(fee('COLLECTED'), { serviceFeeCollectedRaw: '9000' })).fees[0]
  assert.equal(taken.amount, '0.009 USDC')
  const crumb = swapDoc(
    settled(fee('COLLECTED', { amountRaw: '0', decimals: 9, symbol: 'SOL' }), { serviceFeeCollectedRaw: '1' }),
  ).fees[0]
  assert.equal(crumb.amount, '< 0.000001 SOL', 'a crumb is never a false zero')
})

test('the network’s fee on a swap: in SOL when the chain’s base and priority are both read — else no row, never «0»', () => {
  const read = swapDoc(settled(null, { baseFeeLamports: '5000', priorityFeeLamports: '15000' }))
  assert.deepEqual(read.fees, [{ kind: 'network', amount: '0.00002 SOL', percent: null, collected: true }])
  assert.equal(swapDoc(settled(null, { baseFeeLamports: '5000' })).fees.length, 0)
})

test('without the chain’s figures the Review’s are said as «≈»; a company’s token is counted with its multiplier', () => {
  const review = swapDoc(
    { state: 'PENDING', signature: SIG, observation: null, facts: null, receipt: null },
    { status: 'pending' },
  )
  assert.match(review.gave[0].amount, /^≈ /)
  const scaled = docFromSwap(
    {
      title: 'x',
      status: 'done',
      settlement: settled(null, { actualInputRaw: '10000000', actualOutputRaw: '100000000' }),
      context: {
        ...SWAP_CONTEXT,
        mode: 'buy',
        receive: { ...SWAP_CONTEXT.receive, symbol: 'AAPLx' },
        receiveDecimals: 8,
      },
      at: AT,
      multipliers: { receive: 1.5 },
    },
    'en',
  )
  assert.equal(scaled.got[0].amount, '1.5')
})

test('a claim that went into the shared vault says so — never «received $0.00»', () => {
  const doc = docFromClaimResult(
    {
      token: MINT,
      symbol: 'THUMB',
      pair: USDC,
      kind: 'partial',
      receivedRaw: 0n,
      intoVaultRaw: 2500000n,
      signature: SIG,
      title: 'x',
      at: AT,
    },
    'en',
  )
  assert.deepEqual(doc.got, [])
  assert.deepEqual(
    doc.parts.map((part) => [part.kind, legText(part.leg, true)]),
    [['vault', '$2.50']],
  )
})

test('a ledger «Операція» gives way to the richer receipt of the same transaction', () => {
  const other = docFromHistory(historyRow(swapAction({ lane: 'OTHER', origin: null }), 'en'), 'Operation')
  const claim = docFromClaim(
    {
      token: MINT,
      name: 'Thumb',
      symbol: 'THUMB',
      signature: SIG,
      at: AT,
      pair: USDC,
      paid: { curve: '1', graduation: '0', lp: '0' },
      vaultPaidRaw: null,
      receivedRaw: '1',
    },
    'Claimed',
    'en',
  )
  assert.equal(other.kind, 'other')
  assert.equal(other.initiator, null)
  assert.deepEqual(
    mergeDocs([other], [claim]).map((doc) => doc.kind),
    ['claim'],
  )
})
