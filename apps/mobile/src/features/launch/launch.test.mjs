import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ApiError } from '../../lib/api.ts'
import { LAUNCH_WORDS, launchWords } from './copy.ts'
import { checkLaunchForm, EMPTY_FORM, linkProblem, shownProblem, utf8Length } from './form.ts'
import { exactPair, formatBps, formatMove, formatTinyPrice, fromRaw, shortPair, toRaw } from './launch-format.ts'
import { claimFees, launchToken, lostAfterSend, tradeLaunch, walletFailure } from './launch-flow.ts'
import {
  agoText,
  canClaim,
  claimFailureKey,
  claimFailureTitleKey,
  claimView,
  createFailureKey,
  earningsUnreadKey,
  inAttention,
  isPaused,
  launchedView,
  markKey,
  noClaimKey,
  presetName,
  sendTitleKey,
  riskKey,
  sourceRows,
  supplyPct,
  SUPPLY_RAW,
  toClaimByPair,
  tradeFailureKey,
} from './launch-model.ts'
import { base64Bytes, headBytes, imageTypeOfBase64 } from './picture-bytes.ts'

const here = dirname(fileURLToPath(import.meta.url))
const CREATOR = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const MINT = 'So11111111111111111111111111111111111111112'
const USDC = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6, dollar: true }

test('the moderation module is the web app’s own, unedited', () => {
  const content = readFileSync(join(here, 'moderation.ts'), 'utf8').replace(/\r\n/g, '\n')
  const bytes = Buffer.from(content, 'utf8')
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  // lib/core/launch/moderation.ts at ce43b660 (origin/master, 2026-10-06).
  assert.equal(blob, '5c480a0f39465261904da47162d4a2115266ad8a')
})

test('every word is said in both languages with the same placeholders', () => {
  for (const [key, entry] of Object.entries(LAUNCH_WORDS)) {
    assert.ok(entry.en.trim() && entry.uk.trim(), key)
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    assert.deepEqual(names(entry.en), names(entry.uk), key)
  }
  const word = launchWords('uk')
  assert.equal(word('claim', { amount: '$4,20' }), 'Забрати $4,20')
  assert.equal(word('claimPartial', { amount: '$1,00' }), 'Забрано частину: $1,00')
  assert.equal(word('mineShareWaiting'), 'після підтвердження')
  assert.equal(word('mineNotRead'), 'не прочитано')
})

test('the form holds the web’s rules: required, length in bytes, the ticker’s letters, links, borrowed names', () => {
  const empty = checkLaunchForm(EMPTY_FORM)
  assert.equal(empty.problems.name, 'REQUIRED')
  assert.equal(empty.problems.symbol, 'REQUIRED')
  // An empty required field waits for the first press; a borrowed name is said at once.
  assert.equal(shownProblem(empty, 'name', EMPTY_FORM, false), null)
  assert.equal(shownProblem(empty, 'name', EMPTY_FORM, true), 'REQUIRED')
  const good = checkLaunchForm({ ...EMPTY_FORM, name: '  Moon   Cat ', symbol: '$mcat' })
  assert.deepEqual(good.problems, {})
  assert.deepEqual(good.clean, { name: 'Moon Cat', symbol: 'MCAT' })
  assert.equal(utf8Length('Місячний кіт'), 23)
  assert.equal(checkLaunchForm({ ...EMPTY_FORM, name: 'Ж'.repeat(17), symbol: 'A' }).problems.name, 'TOO_LONG')
  assert.equal(checkLaunchForm({ ...EMPTY_FORM, name: 'A', symbol: 'MC-AT' }).problems.symbol, 'SYMBOL_CHARS')
  assert.equal(checkLaunchForm({ ...EMPTY_FORM, name: 'A', symbol: 'ABCDEFGHIJK' }).problems.symbol, 'TOO_LONG')
  const borrowed = checkLaunchForm({ ...EMPTY_FORM, name: 'T3SLA', symbol: 'CAT' })
  assert.equal(borrowed.problems.name, 'BORROWED')
  assert.equal(shownProblem(borrowed, 'name', EMPTY_FORM, false), 'BORROWED')
  assert.equal(borrowed.hits[0]?.label, 'Tesla')
  assert.equal(checkLaunchForm({ ...EMPTY_FORM, name: 'Cat', symbol: 'SOL' }).problems.symbol, 'BORROWED')
})

test('a link is https with a host; X and Telegram on their own hosts with a path', () => {
  assert.equal(linkProblem('website', ''), false)
  assert.equal(linkProblem('website', 'example.com'), false)
  assert.equal(linkProblem('website', 'http://example.com'), true)
  assert.equal(linkProblem('website', 'localhost'), true)
  assert.equal(linkProblem('website', 'https://user@example.com'), true)
  assert.equal(linkProblem('x', 'x.com/moon'), false)
  assert.equal(linkProblem('x', 'https://www.twitter.com/moon'), false)
  assert.equal(linkProblem('x', 'x.com'), true)
  assert.equal(linkProblem('x', 'example.com/moon'), true)
  assert.equal(linkProblem('telegram', 't.me/moon'), false)
  assert.equal(linkProblem('telegram', 'telegram.org/moon'), true)
})

test('amounts typed and raw, shares and money as the web writes them', () => {
  assert.equal(toRaw('', 6), 0n)
  assert.equal(toRaw('1,5', 6), 1_500_000n)
  assert.equal(toRaw('0.0000001', 6), null)
  assert.equal(toRaw('abc', 6), null)
  assert.equal(fromRaw('1500000', 6), '1.5')
  assert.equal(fromRaw(1_234_567n, 6, 2), '1.23')
  assert.equal(formatBps(4600, 'en'), '46%')
  assert.equal(formatBps(46, 'uk').replace(/ /g, ' '), '0,46 %')
  assert.equal(formatMove(-80, 'en'), '−0.8%')
  assert.equal(formatTinyPrice(0.00000509, 'en').text, '0.0₅509')
  assert.equal(exactPair('4200', USDC, 'en'), '< $0.01')
  assert.equal(exactPair('174090000', USDC, 'en'), '$174.09')
  assert.equal(shortPair('0', USDC, 'en'), '$0')
  // The same sum reads the same as earned and as to claim: cut, never rounded up.
  assert.equal(shortPair('16021', USDC, 'en'), exactPair('16021', USDC, 'en'))
  assert.equal(shortPair('16021', USDC, 'en'), '$0.01')
  assert.equal(shortPair('12400000000', USDC, 'en'), '$12.4K')
  assert.equal(supplyPct('20000000000000', SUPPLY_RAW), 2)
})

test('a picture’s bytes are judged by what they are', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')
  assert.equal(imageTypeOfBase64(png), 'image/png')
  const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1').toString('base64')
  assert.equal(imageTypeOfBase64(webp), 'image/webp')
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')
  assert.equal(imageTypeOfBase64(jpeg), 'image/jpeg')
  assert.equal(imageTypeOfBase64(Buffer.from('hello world!').toString('base64')), null)
  assert.deepEqual(headBytes(Buffer.from([1, 2, 3, 4, 5]).toString('base64'), 5), [1, 2, 3, 4, 5])
  for (const size of [0, 1, 2, 3, 4, 100, 262_144])
    assert.equal(base64Bytes(Buffer.alloc(size).toString('base64')), size, String(size))
})

function doubles(overrides = {}) {
  const calls = []
  const api = {
    metadata: async (request) => {
      calls.push(['metadata', request])
      return {
        metadataUri: 'https://ryntra.io/api/launch/metadata/aa',
        imageUrl: 'https://ryntra.io/i',
        name: request.name,
        symbol: request.symbol,
      }
    },
    build: async (request) => {
      calls.push(['build', request])
      return {
        buildId: 'b1',
        network: 'solana:mainnet',
        unsignedWireBase64: 'CREATE',
        lockUnsignedWireBase64: request.lock ? 'LOCK' : null,
        token: MINT,
        firstBuyOutRaw: '0',
        payerCoveredLamports: '1',
        creatorCostLamports: '10000000',
        expiresAt: '2026-10-06T12:00:00Z',
      }
    },
    submit: async (request) => {
      calls.push(['submit', request])
      return { token: MINT, signature: 'sig', state: 'LAUNCHED', lock: null, tokenPath: `/app/launch/${MINT}` }
    },
    token: async () => ({ token: MINT, lock: null }),
    ...overrides,
  }
  const wallet = {
    signTransactions: async (wires) => {
      calls.push(['sign', wires])
      return wires.map((wire) => `${wire}-signed`)
    },
  }
  return { api, wallet, calls }
}

const FIELDS = { name: 'Moon Cat', symbol: 'MCAT', description: '', website: '', x: '', telegram: '' }

test('a launch: stored, built, both signed in one prompt, sent once in their order', async () => {
  const { api, wallet, calls } = doubles()
  const steps = []
  const outcome = await launchToken({
    api,
    wallet,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'AAAA',
    firstBuyRaw: 5_000_000n,
    lock: '1m-3m',
    onStep: (step) => steps.push(step),
  })
  assert.equal(outcome.ok, true)
  assert.deepEqual(steps, ['prepare', 'sign', 'send'])
  assert.deepEqual(calls.find(([name]) => name === 'sign')[1], ['CREATE', 'LOCK'])
  const submit = calls.find(([name]) => name === 'submit')[1]
  assert.equal(submit.signedWireBase64, 'CREATE-signed')
  assert.equal(submit.signedLockWireBase64, 'LOCK-signed')
  assert.equal(calls.filter(([name]) => name === 'submit').length, 1)
})

test('a lock is never asked without a first buy', async () => {
  const { api, wallet, calls } = doubles()
  await launchToken({
    api,
    wallet,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'A',
    firstBuyRaw: 0n,
    lock: '1m-3m',
  })
  assert.equal(calls.find(([name]) => name === 'build')[1].lock, null)
  assert.deepEqual(calls.find(([name]) => name === 'sign')[1], ['CREATE'])
})

test('the wallet’s cancel sends nothing; a paused build is the stop, not a failure', async () => {
  const refusing = doubles()
  refusing.wallet.signTransactions = async () => {
    throw Object.assign(new Error('User rejected the request'), { code: -1 })
  }
  const cancelled = await launchToken({
    ...refusing,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'A',
    firstBuyRaw: 0n,
    lock: null,
  })
  assert.deepEqual(cancelled.ok ? null : cancelled.failure, {
    step: 'before',
    code: 'WALLET_REFUSED',
    detail: null,
  })
  assert.equal(
    refusing.calls.some(([name]) => name === 'submit'),
    false,
  )
  const paused = doubles({
    build: async () => {
      throw new ApiError('LAUNCH_PAUSED', 'Launch is paused', 503)
    },
  })
  const stopped = await launchToken({
    ...paused,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'A',
    firstBuyRaw: 0n,
    lock: null,
  })
  assert.equal(stopped.ok, false)
  assert.equal(isPaused(stopped.failure.code), true)
  assert.equal(createFailureKey(stopped.failure), 'errLaunchingPaused')
  assert.equal(
    walletFailure(Object.assign(new Error('x'), { code: 'ERROR_WALLET_NOT_FOUND' })).code,
    'WALLET_NOT_FOUND',
  )
})

test('a lost answer to the send may hide a landed launch: the token is named, never «nothing was sent»', async () => {
  const lost = doubles({
    submit: async () => {
      throw new TypeError('Network request failed')
    },
  })
  const outcome = await launchToken({
    ...lost,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'A',
    firstBuyRaw: 0n,
    lock: null,
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.token, MINT)
  assert.equal(lostAfterSend(outcome.failure), true)
  assert.equal(createFailureKey(outcome.failure), 'errUnknownAfterSend')
  assert.equal(createFailureKey({ step: 'send', code: 'LAUNCH_SUBMIT_FAILED', detail: null }), 'errUnknownAfterSend')
  assert.equal(createFailureKey({ step: 'before', code: 'UNAVAILABLE', detail: null }), 'errGeneric')
})

test('the token read after the send outranks the send’s own word on the lock', () => {
  const submit = { token: MINT, signature: 's', state: 'LAUNCHED', lock: { state: 'PENDING' }, tokenPath: '' }
  assert.equal(launchedView(submit, null).lockPending, true)
  const locked = launchedView(submit, { lock: { state: 'LOCKED', cliffAt: '2027-01-01', endsAt: '2027-03-01' } })
  assert.equal(locked.lockPending, false)
  assert.deepEqual(locked.locked, { cliffAt: '2027-01-01', endsAt: '2027-03-01' })
  const failed = launchedView({ ...submit, lock: { state: 'FAILED' } }, null)
  assert.equal(failed.lockFailed, true)
  assert.equal(launchedView({ ...submit, state: 'PENDING', lock: { state: 'FAILED' } }, null).lockFailed, false)
})

test('a trade: built, signed, sent once; the network’s refusal is said as the trade’s', async () => {
  const sent = []
  const api = {
    build: async () => ({
      buildId: 't1',
      network: 'solana:mainnet',
      unsignedWireBase64: 'SWAP',
      quote: { amountOutRaw: '1' },
      expiresAt: '',
    }),
    submit: async (request) => {
      sent.push(request)
      return { signature: 'x', state: 'CONFIRMED', filled: null }
    },
  }
  const wallet = { signTransactions: async (wires) => wires.map((wire) => `${wire}!`) }
  const outcome = await tradeLaunch({ api, wallet, address: CREATOR, side: 'buy', amountRaw: 10n, slippageBps: 100 })
  assert.equal(outcome.ok, true)
  assert.deepEqual(sent, [{ buildId: 't1', wallet: CREATOR, signedWireBase64: 'SWAP!' }])
  assert.equal(tradeFailureKey('LAUNCH_SLIPPAGE'), 'errSlippage')
  assert.equal(tradeFailureKey('LAUNCH_PAUSED'), 'errLaunchPaused')
  assert.equal(tradeFailureKey('SOMETHING'), 'errGeneric')
})

test('a claim hands every signed transaction to the server in the order it built them', async () => {
  let handed = null
  const api = {
    build: async () => ({
      buildId: 'c1',
      network: 'solana:mainnet',
      unsignedWireBase64: ['ONE', 'TWO'],
      sources: ['curve'],
      expectedRaw: '5',
      networkCostLamports: null,
      pair: USDC,
      expiresAt: '',
    }),
    submit: async (request) => {
      handed = request.signedWireBase64
      return {
        state: 'PARTIAL',
        receipts: [{ signature: 'a', receivedRaw: '1000000', paid: { curve: '1000000', graduation: '0', lp: '0' } }],
        pending: [],
        failed: [{ signature: 'b', reason: 'x' }],
      }
    },
  }
  const wallet = { signTransactions: async (wires) => wires.map((wire) => wire.toLowerCase()) }
  const outcome = await claimFees({ api, wallet, address: CREATOR })
  assert.deepEqual(handed, ['one', 'two'])
  assert.equal(claimView(outcome.result).kind, 'partial')
  assert.equal(claimView(outcome.result).receivedRaw, 1_000_000n)
  // A PARTIAL with nothing received is still on its way, never «забрано частину».
  assert.equal(claimView({ state: 'PARTIAL', receipts: [], pending: ['p'], failed: [] }).kind, 'pending')
  assert.equal(claimView({ state: 'CONFIRMED', receipts: [], pending: [], failed: [] }).kind, 'done')
})

test('a claim’s refusal says only what is known', () => {
  assert.equal(claimFailureTitleKey('UNAVAILABLE', true), 'errClaimTitleUnknown')
  assert.equal(claimFailureKey('UNAVAILABLE', true), 'errClaimUnknown')
  assert.equal(claimFailureTitleKey('UNAVAILABLE', false), 'errClaimTitle')
  assert.equal(claimFailureKey('UNAVAILABLE', false), 'errGeneric')
  assert.equal(claimFailureTitleKey('LAUNCH_BUILD_USED', true), 'errClaimTitleSent')
  assert.equal(claimFailureKey('LAUNCH_PAUSED', false), 'errLaunchPaused')
  assert.equal(claimFailureTitleKey('LAUNCH_SUBMIT_FAILED', true), 'errClaimTitleUnknown')
  assert.equal(claimFailureKey('LAUNCH_SUBMIT_FAILED', true), 'errClaimUnknown')
  assert.equal(claimFailureKey('LAUNCH_SUBMIT_FAILED', false), 'errClaimSubmit')
})

const row = (patch = {}) => ({
  token: MINT,
  name: 'Moon Cat',
  symbol: 'MCAT',
  image: null,
  preset: 'protected',
  creator: CREATOR,
  role: 'creator',
  launchedAt: '2026-10-06T10:00:00Z',
  pair: USDC,
  progressBps: 1200,
  migrated: false,
  earnings: {
    role: {
      curve: { earnedRaw: '3000000', unclaimedRaw: '1000000' },
      graduation: { earnedRaw: '0', unclaimedRaw: '0' },
      lp: { earnedRaw: '0', unclaimedRaw: '0' },
      earnedRaw: '3000000',
      unclaimedRaw: '1000000',
    },
    mine: { shareBps: 10_000, earnedRaw: '3000000', unclaimedRaw: '1000000', claimedRaw: '2000000' },
  },
  feeSharing: null,
  claimable: true,
  ...patch,
})

test('earnings not read are «не прочитано» or «після підтвердження» — never a zero, never a claim', () => {
  const unread = row({ earnings: null, claimable: false })
  assert.equal(earningsUnreadKey(unread), 'mineNotRead')
  assert.equal(canClaim(unread, false), false)
  const waiting = row({
    role: 'recipient',
    earnings: null,
    claimable: false,
    feeSharing: { vault: 'v', shares: [], signature: null, state: 'PENDING', reason: null },
  })
  assert.equal(earningsUnreadKey(waiting), 'mineShareWaiting')
  assert.equal(noClaimKey(waiting), 'mineSharePending')
  assert.equal(canClaim(row(), false), true)
  assert.equal(canClaim(row(), true), false)
  assert.equal(
    noClaimKey(row({ earnings: { ...row().earnings, mine: { ...row().earnings.mine, shareBps: 0 } } })),
    'claimNotYours',
  )
  const sums = toClaimByPair({ launches: [row(), row({ token: 'x' }), unread] })
  assert.equal(sums.get(USDC.mint), 2_000_000n)
})

test('where the fees come from: graduation and the pool only once on the DEX; what is left said when it differs', () => {
  const rows = sourceRows(row())
  assert.deepEqual(
    rows.map((entry) => [entry.source, entry.later, entry.earnedRaw, entry.leftRaw]),
    [
      ['curve', false, 3_000_000n, 1_000_000n],
      ['graduation', true, 0n, null],
      ['lp', true, 0n, null],
    ],
  )
  const shared = sourceRows(
    row({
      feeSharing: { vault: 'v', shares: [], signature: null, state: 'SHARED', reason: null },
      earnings: { ...row().earnings, mine: { ...row().earnings.mine, shareBps: 2500 } },
    }),
  )
  assert.equal(shared[0].earnedRaw, 750_000n)
  assert.equal(shared[0].leftRaw, null)
  // Not read: no rows — the card says «не прочитано» in one line, never a zero.
  assert.deepEqual(sourceRows(row({ earnings: null })), [])
  // Its way to the DEX not read: nothing said of «once it reaches the DEX» — read earnings show what they read.
  assert.deepEqual(
    sourceRows(row({ migrated: null })).map((entry) => [entry.later, entry.earnedRaw]),
    [
      [false, 3_000_000n],
      [false, 0n],
      [false, 0n],
    ],
  )
})

test('a mark of locked liquidity is named by whose it is; facts of risk by their figures', () => {
  const receipt = {
    creator: CREATOR,
    graduated: {
      positions: [
        { position: 'P1', owner: CREATOR },
        { position: 'P2', owner: 'R' },
      ],
    },
  }
  assert.equal(markKey({ code: 'LP_LOCKED_FOREVER', account: 'P1' }, receipt), 'mark_LP_LOCKED_FOREVER_creator')
  assert.equal(markKey({ code: 'LP_LOCKED_FOREVER', account: 'P2' }, receipt), 'mark_LP_LOCKED_FOREVER_partner')
  assert.equal(markKey({ code: 'LP_LOCKED_FOREVER', account: 'P3' }, receipt), 'mark_LP_LOCKED_FOREVER')
  assert.equal(markKey({ code: 'NO_FREEZE', account: 'x' }, receipt), 'mark_NO_FREEZE')
  assert.equal(
    riskKey({ code: 'CREATOR_SOLD', level: 'attention', values: { supplyBps: 100 } }),
    'risk_CREATOR_SOLD_SUPPLY',
  )
  assert.equal(
    riskKey({ code: 'BUNDLE_HOLDS', level: 'attention', values: { atLeast: 1 } }),
    'risk_BUNDLE_HOLDS_AT_LEAST',
  )
  assert.equal(riskKey({ code: 'HISTORY_PARTIAL', level: 'info', values: {} }), 'risk_HISTORY_UNREAD')
  assert.equal(inAttention({ code: 'CREATOR_SOLD', level: 'attention', values: {} }), false)
  assert.equal(inAttention({ code: 'HISTORY_PARTIAL', level: 'info', values: {} }), true)
  for (const key of Object.keys(LAUNCH_WORDS).filter((name) => name.startsWith('risk_')))
    assert.ok(LAUNCH_WORDS[`riskWhy_${key.slice(5)}`] || /_(SUPPLY|AT_LEAST|UNREAD)$/.test(key), key)
  const word = launchWords('en')
  assert.equal(agoText(word, 5), 'just now')
  assert.equal(agoText(word, 125), '2 min ago')
})

test('an answer lost at the send is never «nothing was sent»: a gateway error or the server’s own failure may hide a landed send', () => {
  for (const code of ['UNAVAILABLE', 'HTTP_502', 'HTTP_504', 'INTERNAL']) {
    const failure = { step: 'send', code, detail: null }
    assert.equal(lostAfterSend(failure), true, code)
    assert.equal(createFailureKey(failure), 'errUnknownAfterSend', code)
    assert.equal(sendTitleKey(failure, 'errTitle'), 'errClaimTitleUnknown', code)
    assert.equal(tradeFailureKey(code, true), 'tradeUnknown', code)
  }
  for (const code of ['LAUNCH_BUILD_EXPIRED', 'LAUNCH_SIGNED_OTHER_BYTES', 'LAUNCH_PAUSED', 'LAUNCH_SLIPPAGE']) {
    assert.equal(lostAfterSend({ step: 'send', code, detail: null }), false, code)
  }
  // Before the send nothing went out, whatever the code.
  assert.equal(lostAfterSend({ step: 'before', code: 'HTTP_502', detail: null }), false)
  assert.equal(tradeFailureKey('HTTP_502', false), 'errGeneric')
})

test('the wallet’s answer is said by what it was: a cancel, no wallet, or a wallet that did not finish', () => {
  assert.equal(
    walletFailure(Object.assign(new Error('User rejected the request'), { code: -1 })).code,
    'WALLET_REFUSED',
  )
  assert.equal(
    walletFailure(Object.assign(new Error('x'), { code: 'ERROR_ASSOCIATION_CANCELLED' })).code,
    'WALLET_REFUSED',
  )
  assert.equal(
    walletFailure(Object.assign(new Error('x'), { code: 'ERROR_WALLET_NOT_FOUND' })).code,
    'WALLET_NOT_FOUND',
  )
  assert.equal(
    walletFailure(Object.assign(new Error('Session timed out'), { code: 'ERROR_SESSION_TIMEOUT' })).code,
    'WALLET_FAILED',
  )
  assert.equal(createFailureKey({ step: 'before', code: 'WALLET_FAILED', detail: null }), 'walletUnfinished')
  assert.equal(createFailureKey({ step: 'before', code: 'WALLET_NOT_FOUND', detail: null }), 'walletMissing')
  assert.equal(claimFailureKey('WALLET_FAILED', false), 'walletUnfinished')
})

test('a wallet that hands back fewer signed transactions did not finish, and nothing is sent', async () => {
  const short = doubles()
  short.wallet.signTransactions = async () => ['CREATE-signed']
  const outcome = await launchToken({
    ...short,
    creator: CREATOR,
    preset: 'protected',
    fields: FIELDS,
    imageBase64: 'A',
    firstBuyRaw: 5n,
    lock: '1m-3m',
  })
  assert.equal(outcome.ok ? null : outcome.failure.code, 'WALLET_FAILED')
  assert.equal(
    short.calls.some(([name]) => name === 'submit'),
    false,
  )
})

test('a part that went into the shared vault is a part, not «on its way»; not read is not «nothing to claim»', () => {
  const vault = claimView({
    state: 'PARTIAL',
    receipts: [{ signature: 'a', receivedRaw: '0', paid: { curve: '700000', graduation: '0', lp: '0' } }],
    pending: [],
    failed: [{ signature: 'b', reason: 'x' }],
  })
  assert.equal(vault.kind, 'partial')
  assert.equal(vault.intoVaultRaw, 700_000n)
  assert.equal(noClaimKey(row({ earnings: null, claimable: false })), 'claimUnread')
  const word = launchWords('uk')
  assert.equal(presetName('community', [], 'uk', word), 'Спільнота')
  assert.equal(
    presetName('protected', [{ id: 'protected', name: { en: 'Protected', uk: 'Захищений' } }], 'en', word),
    'Protected',
  )
  assert.equal(presetName('other', [], 'en', word), null)
  assert.equal(linkProblem('website', 'сайт.укр'), false)
  assert.equal(linkProblem('website', 'exa mple.com'), true)
})

test('a known refusal at the send is «nothing landed»; a build the network refused for this wallet says what most often lacks', () => {
  for (const code of ['LAUNCH_LIMIT', 'LAUNCH_FIRST_BUY_ABOVE_CAP', 'LAUNCH_NAME_BORROWED', 'WALLET_CHANGED'])
    assert.equal(lostAfterSend({ step: 'send', code, detail: null }), false, code)
  assert.equal(
    createFailureKey({
      step: 'before',
      code: 'UNAVAILABLE',
      detail: 'The creation does not simulate: {"InstructionError":[0,{"Custom":1}]}.',
    }),
    'buildNotSimulated',
  )
  assert.equal(createFailureKey({ step: 'before', code: 'UNAVAILABLE', detail: null }), 'errGeneric')
})

test('English counts agree with their nouns: «1 holder», «2 holders», «1 launch», «3 launches»', () => {
  const word = launchWords('en')
  assert.equal(word('risk_FEW_HOLDERS', { n: 1 }), '1 holder')
  assert.equal(word('risk_FEW_HOLDERS', { n: 2 }), '2 holders')
  assert.equal(word('risk_HOLDERS_UNCOUNTED', { n: '1' }), 'At least 1 holder')
  assert.equal(word('tradesLatest', { n: '1,200' }), '1,200 trades read — not all')
  assert.ok(Object.values(LAUNCH_WORDS).every((pair) => !/\{(s|es):/.test(pair.uk)))
  assert.equal(launchWords('uk')('risk_FEW_HOLDERS', { n: 1 }), 'Холдерів: 1')
})
