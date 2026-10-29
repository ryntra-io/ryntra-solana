import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MONEY_COPY } from '../money/copy.ts'
import { sendFailureKey, transferInput } from '../money/money-model.ts'
import { sendReviewed } from '../money/send-flow.ts'
import { SEEKER_COPY } from './copy.ts'
import {
  addressGroups,
  addressNameOf,
  isAddress,
  nameAnswerFor,
  nameStopOf,
  resolveOf,
  reviewNameOf,
  shownNameOf,
  seekerMarkOf,
  skrNameOf,
  UNREAD,
} from './seeker-model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ME = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const THEM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SIG = '5'.repeat(88)

/* ---- the pinned client carries both routes (contracts 1.65.0 and 1.66.0) ---- */

test('the pinned client asks «Перевірено Seeker» with the bearer and a `.skr` name by name or by address', () => {
  const client = readFileSync(join(here, '../../lib/api/v1/client.ts'), 'utf8').replace(/\r\n/g, '\n')
  const types = readFileSync(join(here, '../../lib/api/v1/types.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(client, /seeker: \(\) => call<SeekerCheckResponse>\("GET", "\/api\/v1\/auth\/seeker", undefined, true\)/)
  assert.match(client, /skrName: \(query: /)
  assert.match(client, /\/api\/v1\/research\/skr-name\?/)
  assert.match(types, /export type SeekerCheckResponse = Readonly<\{ address: string; verified: boolean;/)
  assert.match(types, /export type SkrNameRead =/)
})

/* ---- names ---- */

test('a `.skr` name is one ASCII label — a homograph or a dotted name is no name', () => {
  assert.equal(skrNameOf(' Alice.SKR '), 'alice.skr')
  assert.equal(skrNameOf('a_b-c9.skr'), 'a_b-c9.skr')
  assert.equal(skrNameOf('аlice.skr'), null, 'a Cyrillic «а» is never read as a Latin one')
  assert.equal(skrNameOf('a.b.skr'), null)
  assert.equal(skrNameOf('.skr'), null)
  assert.equal(skrNameOf('alice.sol'), null)
  assert.equal(skrNameOf(THEM), null)
  assert.equal(skrNameOf(null), null)
  assert.equal(isAddress(THEM), true)
  assert.equal(isAddress('0x52908400098527886E0F7030069857D2E4169EE7'), false)
})

test('a name’s answer counts only for the name asked, with an address that is one', () => {
  const found = { direction: 'name', state: 'FOUND', name: 'alice.skr', address: THEM }
  assert.deepEqual(resolveOf('alice.skr', found), { state: 'FOUND', name: 'alice.skr', address: THEM })
  assert.deepEqual(resolveOf('alice.skr', { ...found, name: 'bob.skr' }), { state: 'UNAVAILABLE', name: 'alice.skr' })
  assert.deepEqual(resolveOf('alice.skr', { ...found, address: 'nope' }), { state: 'UNAVAILABLE', name: 'alice.skr' })
  assert.deepEqual(resolveOf('alice.skr', { ...found, direction: 'address' }), {
    state: 'UNAVAILABLE',
    name: 'alice.skr',
  })
  assert.deepEqual(resolveOf('alice.skr', { direction: 'name', state: 'NOT_FOUND', name: 'alice.skr', address: null }), {
    state: 'NOT_FOUND',
    name: 'alice.skr',
  })
  assert.deepEqual(
    resolveOf('alice.skr', { direction: 'name', state: 'UNAVAILABLE', name: 'alice.skr', address: null }),
    { state: 'UNAVAILABLE', name: 'alice.skr' },
    '«the chain did not answer» is never «no such name»',
  )
  assert.deepEqual(resolveOf('alice.skr', null), { state: 'UNAVAILABLE', name: 'alice.skr' })
})

test('an address’s name is shown only for that address; unread is never «no name»', () => {
  const read = { direction: 'address', state: 'FOUND', address: THEM, name: 'alice.skr', source: 'primary' }
  assert.equal(addressNameOf(THEM, read), 'alice.skr')
  assert.equal(addressNameOf(ME, read), UNREAD, 'an answer about another wallet answers nothing')
  assert.equal(addressNameOf(THEM, { ...read, name: 'аlice.skr' }), null, 'a homograph the server sent is not shown')
  assert.equal(addressNameOf(THEM, { ...read, state: 'NOT_FOUND', name: null, source: null }), null)
  assert.equal(addressNameOf(THEM, { ...read, state: 'UNAVAILABLE', name: null, source: null }), UNREAD)
  assert.equal(addressNameOf(THEM, undefined), UNREAD)
})

test('a name read again stops a step when it went, moved or could not be read', () => {
  assert.equal(nameStopOf({ state: 'FOUND', name: 'alice.skr', address: THEM }, THEM), null)
  assert.equal(nameStopOf({ state: 'FOUND', name: 'alice.skr', address: OTHER }, THEM), 'SKR_CHANGED')
  assert.equal(nameStopOf({ state: 'NOT_FOUND', name: 'alice.skr' }, THEM), 'SKR_GONE')
  assert.equal(nameStopOf({ state: 'UNAVAILABLE', name: 'alice.skr' }, THEM), 'SKR_UNREAD')
  assert.deepEqual(addressGroups(THEM).join(''), THEM, 'Review’s groups carry every character')
  assert.equal(addressGroups(THEM)[0], '7xKX')
})

test('each stop has its sentence in both languages — the generic «unavailable» never swallows one', () => {
  assert.equal(sendFailureKey('SKR_GONE'), 'nameGone')
  assert.equal(sendFailureKey('SKR_CHANGED'), 'nameMoved')
  assert.equal(sendFailureKey('SKR_UNREAD'), 'nameUnread')
  assert.equal(sendFailureKey('SKR_UNCHECKED'), 'nameUnchecked')
  assert.equal(sendFailureKey('SKR_UNREAD_SIGNED'), 'nameUnreadSigned')
  for (const locale of ['en', 'uk']) {
    const failures = MONEY_COPY[locale].failures
    for (const key of ['nameGone', 'nameMoved', 'nameUnread', 'nameUnreadSigned']) assert.match(failures[key], /\S/)
    assert.match(failures.nameUnreadSigned, locale === 'en' ? /signature was not used/ : /підпис не використано/)
    assert.match(failures.nameGone, locale === 'en' ? /Nothing was sent/ : /Нічого не надіслано/)
    assert.match(failures.nameUnread, locale === 'en' ? /Nothing was sent/ : /Нічого не надіслано/)
    assert.equal(failures.nameUnchecked, SEEKER_COPY[locale].nameUnchecked)
  }
})

test('the screen’s name holds only for the name typed now and the address its answer gave', () => {
  const found = { state: 'FOUND', name: 'alice.skr', address: THEM }
  assert.equal(nameAnswerFor('alice.skr', found), found)
  assert.equal(nameAnswerFor('bob.skr', found), null, 'the last name’s answer never stands for a new one')
  assert.equal(nameAnswerFor(null, found), null)
  assert.equal(shownNameOf({ name: 'alice.skr', answer: found, address: THEM }), 'alice.skr')
  assert.equal(shownNameOf({ name: 'alice.skr', answer: found, address: OTHER }), null, 'another address, no name')
  assert.equal(shownNameOf({ name: 'alice.skr', answer: { state: 'UNAVAILABLE', name: 'alice.skr' }, address: THEM }), null)
  // Review: the typed name for its address; a pasted address only with a forward read to exactly it.
  assert.equal(reviewNameOf({ reviewAddress: THEM, name: 'alice.skr', address: THEM, forward: null }), 'alice.skr')
  assert.equal(reviewNameOf({ reviewAddress: OTHER, name: 'alice.skr', address: THEM, forward: null }), null)
  assert.equal(reviewNameOf({ reviewAddress: THEM, name: null, address: THEM, forward: { address: THEM, name: 'bob.skr' } }), 'bob.skr')
  assert.equal(reviewNameOf({ reviewAddress: THEM, name: null, address: THEM, forward: { address: OTHER, name: 'bob.skr' } }), null)
  assert.equal(reviewNameOf({ reviewAddress: null, name: 'alice.skr', address: THEM, forward: null }), null)
})

test('names are offered only where the server serves them; the mark’s route not served yet is never retried', () => {
  const hook = readFileSync(join(here, 'use-seeker.ts'), 'utf8')
  assert.match(hook, /capabilities\.data\.research\?\.skrName !== undefined/)
  // Capabilities not read yet are «unread», never «no names»: a typed name then waits or says unchecked.
  assert.match(hook, /: 'unread'/)
  const send = readFileSync(join(here, '../money/use-send.ts'), 'utf8')
  assert.match(send, /namesUnread \? null : settled/, 'a name is never sent to the recipient check as plain text')
  assert.match(hook, /error\.status === 503 \|\| error\.status === 429/)
  assert.doesNotMatch(hook, /status === 404/)
  assert.match(SEEKER_COPY.uk.toPlaceholder, /\.skr/)
})

/* ---- «Перевірено Seeker» ---- */

const CHECKED = {
  address: ME,
  verified: true,
  tokens: [{ mint: 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te', memberNumber: '1024' }],
  network: 'solana:mainnet',
  checkedAt: '2026-10-22T10:00:00.000Z',
}

test('the mark is the server’s answer about exactly the signed-in wallet; no answer is never «no Seeker»', () => {
  assert.equal(seekerMarkOf(ME, CHECKED), 'verified')
  assert.equal(seekerMarkOf(ME, { ...CHECKED, verified: false, tokens: [] }), 'none')
  assert.equal(seekerMarkOf(THEM, CHECKED), UNREAD, 'another wallet’s answer marks nothing')
  assert.equal(seekerMarkOf(ME, { ...CHECKED, network: 'solana:devnet' }), UNREAD)
  assert.equal(seekerMarkOf(ME, undefined), UNREAD, 'a 503 or no answer yet shows nothing new')
  assert.equal(seekerMarkOf(null, CHECKED), UNREAD)
})

test('the mark says what it is and that it opens and pays nothing — behind «?», never as a permission', () => {
  assert.equal(SEEKER_COPY.uk.verified, 'Перевірено Seeker')
  assert.equal(SEEKER_COPY.en.verified, 'Verified Seeker')
  assert.match(SEEKER_COPY.uk.verifiedHelp, /нічого не відкриває й не платить/)
  assert.match(SEEKER_COPY.en.verifiedHelp, /opens and pays nothing/)
  for (const locale of ['en', 'uk']) assert.doesNotMatch(SEEKER_COPY[locale].verifiedHelp, /Seed Vault/)
})

/* ---- the transfer to a name: read again before the wallet and after it ---- */

function review() {
  return {
    plan: { actionKind: 'SPL_TRANSFER_CHECKED', unsignedWireBase64: 'UNSIGNED', fingerprint: { messageHash: 'H', feePayer: ME } },
    preflight: {},
    verdict: {},
    provider: { role: 'primary', host: 'rpc' },
    canaryIntent: {},
    canaryVerdict: {},
    reviewProof: {},
    check: {
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
    },
  }
}

function doubles() {
  const calls = []
  const rows = new Map()
  return {
    calls,
    rows,
    api: {
      plan: async () => (calls.push('plan'), review()),
      returned: async () => (calls.push('returned'), { verdict: 'BYTES_MATCH', next: 'settle', signature: SIG, detail: '' }),
      adopt: async () => (calls.push('adopt'), review()),
      settle: async () => (calls.push('settle'), { state: 'RECEIPTED', landingState: 'FINALIZED', signature: SIG }),
    },
    pending: {
      get: (wallet) => rows.get(wallet) ?? null,
      set: (row) => rows.set(row.wallet, row),
      clear: (wallet) => rows.delete(wallet),
    },
    wallet: { signTransaction: async (wire) => (calls.push('sign'), `${wire}:SIGNED`) },
  }
}

const TRANSFER = transferInput({ mint: USDC }, ME, THEM, '1000000')

function still(answers) {
  let at = 0
  return async () => {
    const stop = answers[Math.min(at, answers.length - 1)]
    at += 1
    return stop ? { code: stop, key: sendFailureKey(stop) } : null
  }
}

test('a name still pointing where the transfer pays is read before the wallet and after it, then sent once', async () => {
  const d = doubles()
  let reads = 0
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: async () => ((reads += 1), null),
  })
  assert.equal(result.ok, true)
  assert.equal(reads, 2, 'once before the wallet opens, once after it signed')
  assert.deepEqual(d.calls, ['plan', 'sign', 'returned', 'settle'])
})

test('a name that moved before the wallet never opens it', async () => {
  const d = doubles()
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: still(['SKR_CHANGED']),
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'nameMoved')
  assert.equal(result.phase, 'review')
  assert.deepEqual(d.calls, [], 'not even planned: the read comes before the bytes, so it never eats their life')
})

test('a name that moved while the wallet was open drops the signature unsent and unrecorded', async () => {
  const d = doubles()
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: still([null, 'SKR_GONE']),
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'nameGone')
  assert.equal(result.phase, 'review')
  assert.deepEqual(d.calls, ['plan', 'sign', 'returned'], 'signed and read back (never broadcasts), never settled')
  assert.equal(d.rows.size, 0, 'nothing written down — nothing was sent')
})

test('an unread name before the wallet keeps the Review to try again; nothing is planned or signed', async () => {
  const d = doubles()
  const read = review()
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read,
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: still(['SKR_UNREAD']),
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'nameUnread')
  assert.equal(result.review, read)
  assert.deepEqual(d.calls, [])
})

test('the read after signing runs beside the read-back and is bounded — a slow one drops the signature', async () => {
  const d = doubles()
  let asked = null
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: (after) => (after === 'signed' ? ((asked = after), new Promise(() => {})) : Promise.resolve(null)),
    recipientStillMs: 20,
  })
  assert.equal(asked, 'signed')
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'nameUnreadSigned', 'said as «your signature was not used»')
  assert.deepEqual(d.calls, ['plan', 'sign', 'returned'], 'read back beside it, never settled')
  assert.equal(d.rows.size, 0, 'nothing written down')
})

test('a name the chain did not answer for after signing is not sent either', async () => {
  const d = doubles()
  const result = await sendReviewed({
    api: d.api,
    wallet: d.wallet,
    pending: d.pending,
    read: review(),
    transfer: TRANSFER,
    summary: null,
    now: () => 0,
    recipientStill: still([null, 'SKR_UNREAD_SIGNED']),
  })
  assert.equal(result.ok, false)
  assert.equal(result.failure.key, 'nameUnreadSigned')
  assert.equal(d.calls.includes('settle'), false)
})
