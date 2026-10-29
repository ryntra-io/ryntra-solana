import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { bytesToBase64 } from '../session/siws.ts'
import {
  BRIDGE_VERSION,
  errorResponse,
  isHttpsUrl,
  MAX_SHARE_BYTES,
  MAX_TRANSACTIONS,
  okResponse,
  parseAppMessage,
  parsePageMessage,
  readyEvent,
  serialize,
  shareFileName,
  userAgentNameOf,
  walletChangedEvent,
} from './bridge.ts'
import { codeOfWalletError, createCityHost, signatureOf, WALLET_WAIT_MS } from './city-host.ts'
import {
  CITY_PATH,
  cityCoverOf,
  cityPathOf,
  cityRouteOf,
  cityRouteOfLink,
  cityUrlOf,
  loadDecisionOf,
  pageSpeaks,
} from './city-page.ts'

const MINT = 'So11111111111111111111111111111111111111112'
const ADDRESS = '36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm'
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const b64 = (text) => Buffer.from(text).toString('base64')
const req = (fields) => JSON.stringify({ v: 1, ...fields })

/* ---- the parsers ---- */

test('the page’s six requests are read as the contract writes them', () => {
  assert.deepEqual(parsePageMessage(req({ id: 'a', type: 'wallet.connect' })), {
    kind: 'request',
    request: { v: 1, id: 'a', type: 'wallet.connect' },
  })
  assert.deepEqual(parsePageMessage(req({ id: 'b', type: 'wallet.disconnect', extra: 1 })), {
    kind: 'request',
    request: { v: 1, id: 'b', type: 'wallet.disconnect' },
  })
  assert.deepEqual(parsePageMessage(req({ id: 'c', type: 'wallet.signMessage', message: b64('Sign in to Ryntra') })), {
    kind: 'request',
    request: { v: 1, id: 'c', type: 'wallet.signMessage', message: b64('Sign in to Ryntra') },
  })
  const txs = [b64('tx-one'), b64('tx-two')]
  assert.deepEqual(parsePageMessage(req({ id: 'd', type: 'wallet.signTransactions', transactions: txs })), {
    kind: 'request',
    request: { v: 1, id: 'd', type: 'wallet.signTransactions', transactions: txs },
  })
  assert.deepEqual(
    parsePageMessage(
      req({ id: 'e', type: 'share.file', name: 'clip', mime: 'video/mp4', data: b64('mp4'), text: 'Hi' }),
    ),
    {
      kind: 'request',
      request: {
        v: 1,
        id: 'e',
        type: 'share.file',
        file: { name: 'clip', mime: 'video/mp4', data: b64('mp4'), text: 'Hi' },
      },
    },
  )
  assert.deepEqual(parsePageMessage(req({ id: 'f', type: 'open.external', url: 'https://x.com/ryntra' })), {
    kind: 'request',
    request: { v: 1, id: 'f', type: 'open.external', url: 'https://x.com/ryntra' },
  })
})

test('what the app cannot even answer is dropped: not JSON, another version, no id, an id too long', () => {
  for (const raw of [
    undefined,
    null,
    42,
    '',
    'not json',
    '[]',
    'null',
    JSON.stringify({ v: 2, id: 'a', type: 'wallet.connect' }),
    JSON.stringify({ id: 'a', type: 'wallet.connect' }),
    req({ type: 'wallet.connect' }),
    req({ id: '', type: 'wallet.connect' }),
    req({ id: 7, type: 'wallet.connect' }),
    req({ id: 'x'.repeat(65), type: 'wallet.connect' }),
  ])
    assert.equal(parsePageMessage(raw), null, String(raw))
})

test('the page’s hello is read as itself: `page.ready` with no id; with an id it is a request the app does not know', () => {
  assert.deepEqual(parsePageMessage(req({ type: 'page.ready' })), { kind: 'hello' })
  assert.deepEqual(parsePageMessage(req({ id: 'a', type: 'page.ready' })), {
    kind: 'refuse',
    id: 'a',
    code: 'unsupported',
  })
  assert.equal(parsePageMessage(JSON.stringify({ type: 'page.ready' })), null, 'another version is dropped')
})

test('a request it does not know is `unsupported`; one it cannot read is `invalid`', () => {
  assert.deepEqual(parsePageMessage(req({ id: 'a', type: 'wallet.signAndSend' })), {
    kind: 'refuse',
    id: 'a',
    code: 'unsupported',
  })
  assert.deepEqual(parsePageMessage(req({ id: 'a', type: 7 })), { kind: 'refuse', id: 'a', code: 'invalid' })
  const invalid = [
    { type: 'wallet.signMessage' },
    { type: 'wallet.signMessage', message: '' },
    { type: 'wallet.signMessage', message: 'not base64!' },
    { type: 'wallet.signMessage', message: 'abc' },
    { type: 'wallet.signMessage', message: b64('x'.repeat(16 * 1024 + 1)) },
    { type: 'wallet.signTransactions', transactions: [] },
    { type: 'wallet.signTransactions', transactions: b64('tx') },
    { type: 'wallet.signTransactions', transactions: Array.from({ length: MAX_TRANSACTIONS + 1 }, () => b64('tx')) },
    { type: 'wallet.signTransactions', transactions: [b64('tx'), 7] },
    { type: 'wallet.signTransactions', transactions: [b64('x'.repeat(4097))] },
    { type: 'share.file', name: 'clip', mime: 'text/html', data: b64('x') },
    { type: 'share.file', name: '../clip', mime: 'image/png', data: b64('x') },
    { type: 'share.file', name: 'a/b', mime: 'image/png', data: b64('x') },
    { type: 'share.file', name: '.hidden', mime: 'image/png', data: b64('x') },
    { type: 'share.file', name: 'clip', mime: 'image/png', data: '' },
    { type: 'share.file', name: 'clip', mime: 'image/png', data: b64('x'), text: 7 },
    { type: 'open.external', url: 'http://x.com' },
    { type: 'open.external' },
  ]
  for (const fields of invalid)
    assert.deepEqual(
      parsePageMessage(req({ id: 'a', ...fields })),
      { kind: 'refuse', id: 'a', code: 'invalid' },
      JSON.stringify(fields).slice(0, 80),
    )
  // Four transactions are the most one request carries.
  const four = Array.from({ length: MAX_TRANSACTIONS }, (_, i) => b64(`tx-${i}`))
  assert.equal(parsePageMessage(req({ id: 'a', type: 'wallet.signTransactions', transactions: four }))?.kind, 'request')
})

test('a shared file is at most 8 MB', () => {
  const just = Buffer.alloc(MAX_SHARE_BYTES).toString('base64')
  assert.equal(
    parsePageMessage(req({ id: 'a', type: 'share.file', name: 'clip', mime: 'video/webm', data: just }))?.kind,
    'request',
  )
  const over = Buffer.alloc(MAX_SHARE_BYTES + 1).toString('base64')
  assert.deepEqual(
    parsePageMessage(req({ id: 'a', type: 'share.file', name: 'clip', mime: 'video/webm', data: over })),
    {
      kind: 'refuse',
      id: 'a',
      code: 'invalid',
    },
  )
  assert.equal(shareFileName({ name: 'clip', mime: 'video/mp4' }), 'clip.mp4')
  assert.equal(shareFileName({ name: 'Tower.PNG', mime: 'image/png' }), 'Tower.PNG')
  assert.equal(shareFileName({ name: 'clip.mp4', mime: 'video/webm' }), 'clip.mp4.webm')
})

test('`open.external` opens https only: never http, a script, an intent, a wallet’s link or a user@host', () => {
  assert.equal(isHttpsUrl('https://x.com/ryntra?ref=city#top'), true)
  assert.equal(isHttpsUrl('https://solscan.io:443/tx/abc'), true)
  for (const url of [
    'http://x.com',
    'javascript:alert(1)',
    'intent://scan/#Intent;scheme=zxing;end',
    'solana-wallet://v1/associate/local',
    'ryntra://trade',
    'file:///etc/hosts',
    'data:text/html,hi',
    'https://user:pass@evil.example/',
    'https://ryntra.io@evil.example/',
    'https://',
    'https:// x.com',
    'HTTPS://x.com',
    ` https://x.com`,
    `https://x.com/${'a'.repeat(2048)}`,
    7,
    null,
  ])
    assert.equal(isHttpsUrl(url), false, String(url))
})

test('what the app says reads back as the page reads it', () => {
  const wallet = { address: ADDRESS, name: 'Seed Vault Wallet' }
  for (const message of [
    readyEvent('1.17.0', wallet),
    readyEvent('1.17.0', null),
    walletChangedEvent(wallet),
    walletChangedEvent(null),
    okResponse('a', { signed: ['AA=='] }),
    errorResponse('a', 'declined', 'no'),
  ])
    assert.deepEqual(parseAppMessage(serialize(message)), message)
  assert.equal(
    parseAppMessage(JSON.stringify({ v: 1, type: 'app.ready', version: '1', platform: 'ios', wallet: null })),
    null,
  )
  assert.equal(
    parseAppMessage(JSON.stringify({ v: 1, type: 'wallet.changed', wallet: { address: 'x', name: 'y' } })),
    null,
  )
  assert.equal(
    parseAppMessage(JSON.stringify({ v: 1, id: 'a', ok: false, error: { code: 'oops', message: '' } })),
    null,
  )
  assert.equal(parseAppMessage(JSON.stringify({ v: 2, type: 'wallet.changed', wallet: null })), null)
  // A refusal's words never run long.
  assert.equal(errorResponse('a', 'failed', 'x'.repeat(500)).error.message.length, 200)
})

test('the page knows the app by `RyntraApp/<version>` in its user agent', () => {
  assert.equal(userAgentNameOf('1.17.0'), 'RyntraApp/1.17.0')
  assert.equal(BRIDGE_VERSION, 1)
})

/* ---- the host: a fake WebView and a fake wallet ---- */

/** A wallet double: each call records itself and waits for the test to settle it. */
function fakeWallet(held = null) {
  const calls = []
  const pending = []
  const ask = (name, args) =>
    new Promise((resolve, reject) => {
      calls.push({ name, args })
      pending.push({ name, resolve, reject })
    })
  const wallet = {
    held,
    calls,
    pending,
    current: () => wallet.held,
    connect: () => ask('connect'),
    disconnect: () => ask('disconnect'),
    signMessage: (message) => ask('signMessage', message),
    signTransactions: (transactions) => ask('signTransactions', transactions),
  }
  return wallet
}

/** Timers the test turns by hand. */
function fakeTimers() {
  const live = new Map()
  let next = 0
  return {
    live,
    set: (run, ms) => {
      next += 1
      live.set(next, { run, ms })
      return next
    },
    clear: (handle) => live.delete(handle),
    fire: () => {
      for (const [handle, timer] of [...live]) {
        live.delete(handle)
        timer.run()
      }
    },
  }
}

function harness({ held = null, share, openExternal } = {}) {
  const wallet = fakeWallet(held)
  const timers = fakeTimers()
  const posted = []
  const shared = []
  const opened = []
  const host = createCityHost({
    version: '1.17.0',
    wallet,
    share:
      share ??
      (async (file) => {
        shared.push(file)
        return true
      }),
    openExternal:
      openExternal ??
      (async (url) => {
        opened.push(url)
      }),
    post: (text) => posted.push(JSON.parse(text)),
    timers,
  })
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  return { host, wallet, timers, posted, shared, opened, tick, last: () => posted[posted.length - 1] }
}

test('round trip: app.ready, connect in the wallet’s window, wallet.changed, sign-in, a two-part trade', async () => {
  const { host, wallet, posted, tick, last } = harness()
  // Nothing is said before the page has loaded; a request before then is not read.
  await host.receive(req({ id: 'early', type: 'wallet.connect' }))
  assert.equal(posted.length, 0)
  assert.equal(wallet.calls.length, 0)

  host.ready()
  assert.deepEqual(last(), { v: 1, type: 'app.ready', version: '1.17.0', platform: 'android', wallet: null })

  const connecting = host.receive(req({ id: 'c1', type: 'wallet.connect' }))
  await tick()
  assert.deepEqual(
    wallet.calls.map((call) => call.name),
    ['connect'],
  )
  wallet.pending.shift().resolve({ address: ADDRESS, name: 'Seed Vault Wallet' })
  await connecting
  assert.deepEqual(last(), { v: 1, id: 'c1', ok: true, result: { address: ADDRESS, name: 'Seed Vault Wallet' } })

  wallet.held = { address: ADDRESS, name: 'Seed Vault Wallet' }
  host.walletChanged(wallet.held)
  assert.deepEqual(last(), { v: 1, type: 'wallet.changed', wallet: wallet.held })
  // The same wallet again is not news.
  const count = posted.length
  host.walletChanged({ ...wallet.held })
  assert.equal(posted.length, count)

  // Connected already: the address at once, no wallet window for nothing.
  await host.receive(req({ id: 'c2', type: 'wallet.connect' }))
  assert.deepEqual(last().result, wallet.held)
  assert.equal(wallet.calls.length, 1)

  // Sign-in: the exact bytes, the signature back — whether the wallet hands the 64 bytes or the signed payload.
  const text = 'ryntra.io wants you to sign in'
  const message = new Uint8Array(Buffer.from(text))
  const signature = new Uint8Array(64).fill(7)
  for (const answer of [signature, new Uint8Array([...message, ...signature])]) {
    const signing = host.receive(req({ id: 's1', type: 'wallet.signMessage', message: b64(text) }))
    await tick()
    const call = wallet.calls[wallet.calls.length - 1]
    assert.equal(call.name, 'signMessage')
    assert.deepEqual([...call.args], [...message])
    wallet.pending.shift().resolve(answer)
    await signing
    assert.deepEqual(last(), {
      v: 1,
      id: 's1',
      ok: true,
      result: { signature: bytesToBase64(signature), signedMessage: b64(text) },
    })
  }

  // A trade in two parts: the same order back, nothing sent by the app.
  const trading = host.receive(
    req({ id: 't1', type: 'wallet.signTransactions', transactions: [b64('one'), b64('two')] }),
  )
  await tick()
  assert.deepEqual(wallet.calls[wallet.calls.length - 1], { name: 'signTransactions', args: [b64('one'), b64('two')] })
  wallet.pending.shift().resolve([b64('one-signed'), b64('two-signed')])
  await trading
  assert.deepEqual(last(), { v: 1, id: 't1', ok: true, result: { signed: [b64('one-signed'), b64('two-signed')] } })

  // Disconnect through the app's wallet.
  const leaving = host.receive(req({ id: 'd1', type: 'wallet.disconnect' }))
  await tick()
  wallet.pending.shift().resolve()
  await leaving
  assert.deepEqual(last(), { v: 1, id: 'd1', ok: true, result: {} })
  wallet.held = null
  host.walletChanged(null)
  assert.deepEqual(last(), { v: 1, type: 'wallet.changed', wallet: null })
})

test('the person’s «no» is `declined`; a wallet that fails is `failed`; a second request while one is out is `busy`', async () => {
  const { host, wallet, tick, last, posted } = harness({ held: { address: ADDRESS, name: 'W' } })
  host.ready()

  const first = host.receive(req({ id: 'a', type: 'wallet.signTransactions', transactions: [b64('tx')] }))
  await tick()
  await host.receive(req({ id: 'b', type: 'wallet.signMessage', message: b64('hi') }))
  assert.deepEqual(last(), { v: 1, id: 'b', ok: false, error: { code: 'busy', message: last().error.message } })
  assert.equal(wallet.calls.length, 1, 'the busy request never reached the wallet')

  wallet.pending.shift().reject(Object.assign(new Error('User declined the request'), { code: '-3' }))
  await first
  assert.equal(last().id, 'a')
  assert.equal(last().error.code, 'declined')

  for (const [error, code] of [
    [Object.assign(new Error('closed'), { code: 'ERROR_ASSOCIATION_CANCELLED' }), 'declined'],
    [Object.assign(new Error('Found no installed wallet'), { code: 'ERROR_WALLET_NOT_FOUND' }), 'failed'],
    [new Error('The wallet answered with another account — nothing was signed.'), 'failed'],
    [new Error('socket'), 'failed'],
  ]) {
    const asking = host.receive(req({ id: 'x', type: 'wallet.signMessage', message: b64('hi') }))
    await tick()
    wallet.pending.shift().reject(error)
    await asking
    assert.equal(last().error.code, code, error.message)
  }
  assert.deepEqual(codeOfWalletError(new Error('User rejected')).code, 'declined')

  // A wallet that hands back the wrong count, or a signature of another shape, is `failed` — never a partial answer.
  const short = host.receive(req({ id: 'y', type: 'wallet.signTransactions', transactions: [b64('1'), b64('2')] }))
  await tick()
  wallet.pending.shift().resolve([b64('1s')])
  await short
  assert.equal(last().error.code, 'failed')
  const odd = host.receive(req({ id: 'z', type: 'wallet.signMessage', message: b64('hi') }))
  await tick()
  wallet.pending.shift().resolve(new Uint8Array(10))
  await odd
  assert.equal(last().error.code, 'failed')
  assert.ok(posted.every((message) => message.v === 1))
})

test('signing with no wallet held asks no wallet and says so', async () => {
  const { host, wallet, last } = harness()
  host.ready()
  await host.receive(req({ id: 'a', type: 'wallet.signTransactions', transactions: [b64('tx')] }))
  assert.equal(last().error.code, 'failed')
  await host.receive(req({ id: 'b', type: 'wallet.signMessage', message: b64('hi') }))
  assert.equal(last().error.code, 'failed')
  // Disconnecting nothing is done at once.
  await host.receive(req({ id: 'c', type: 'wallet.disconnect' }))
  assert.deepEqual(last(), { v: 1, id: 'c', ok: true, result: {} })
  assert.equal(wallet.calls.length, 0)
})

test('a wallet that never answers is `failed` before the page’s 120 s; its late answer goes nowhere and the lane frees', async () => {
  const { host, wallet, timers, tick, last, posted } = harness({ held: { address: ADDRESS, name: 'W' } })
  host.ready()
  assert.ok(WALLET_WAIT_MS < 120_000)
  const asking = host.receive(req({ id: 'slow', type: 'wallet.signTransactions', transactions: [b64('tx')] }))
  await tick()
  assert.equal([...timers.live.values()][0].ms, WALLET_WAIT_MS)
  timers.fire()
  await asking
  assert.equal(last().id, 'slow')
  assert.equal(last().error.code, 'failed')
  const count = posted.length
  wallet.pending.shift().resolve([b64('late')])
  await tick()
  assert.equal(posted.length, count, 'the late signature is never handed to the page')
  // The lane is free again: the next request reaches the wallet.
  const next = host.receive(req({ id: 'next', type: 'wallet.signMessage', message: b64('hi') }))
  await tick()
  assert.equal(wallet.calls.length, 2)
  wallet.pending.shift().resolve(new Uint8Array(64))
  await next
  assert.equal(last().ok, true)
  assert.equal(timers.live.size, 0, 'an answered request leaves no clock behind')
})

test('an answer belongs to the page that asked: after a reload, the old page’s answer is dropped', async () => {
  const { host, wallet, tick, posted } = harness({ held: { address: ADDRESS, name: 'W' } })
  host.ready()
  const asking = host.receive(req({ id: 'old', type: 'wallet.signMessage', message: b64('hi') }))
  await tick()
  host.detach()
  host.ready()
  wallet.pending.shift().resolve(new Uint8Array(64))
  await asking
  assert.equal(posted.filter((message) => message.id === 'old').length, 0)
  // The new page heard app.ready with the wallet held now.
  assert.deepEqual(posted[posted.length - 1], {
    v: 1,
    type: 'app.ready',
    version: '1.17.0',
    platform: 'android',
    wallet: { address: ADDRESS, name: 'W' },
  })
  // A wallet the app switches to while the page is gone is told on its next ready, not to a page that is not there.
  host.detach()
  const count = posted.length
  host.walletChanged({ address: OTHER, name: 'W' })
  assert.equal(posted.length, count)
})

test('the page’s hello brings app.ready even before the load ends, and again later; an answer still owed is kept', async () => {
  const { host, wallet, tick, posted, last } = harness({ held: { address: ADDRESS, name: 'W' } })
  // The page’s code listened before the load ended: its hello is the app’s cue.
  await host.receive(req({ type: 'page.ready' }))
  assert.deepEqual(last(), {
    v: 1,
    type: 'app.ready',
    version: '1.17.0',
    platform: 'android',
    wallet: { address: ADDRESS, name: 'W' },
  })
  const asking = host.receive(req({ id: 's1', type: 'wallet.signMessage', message: b64('hi') }))
  await tick()
  // The load ends, or the page moves its address and says hello again: app.ready again, and the signature still lands.
  host.ready()
  await host.receive(req({ type: 'page.ready' }))
  assert.equal(posted.filter((message) => message.type === 'app.ready').length, 3)
  wallet.pending.shift().resolve(new Uint8Array(64))
  await asking
  assert.equal(posted.filter((message) => message.id === 's1' && message.ok === true).length, 1)
  // After the page is gone, its hello alone is heard: requests wait for it.
  host.detach()
  const count = posted.length
  await host.receive(req({ id: 'late', type: 'wallet.connect' }))
  assert.equal(posted.length, count)
  await host.receive(req({ type: 'page.ready' }))
  assert.equal(last().type, 'app.ready')
})

test('`open.external` hands https to the browser and refuses everything else as `invalid`', async () => {
  const { host, opened, last } = harness()
  host.ready()
  await host.receive(req({ id: 'a', type: 'open.external', url: 'https://x.com/ryntra' }))
  assert.deepEqual(opened, ['https://x.com/ryntra'])
  assert.deepEqual(last(), { v: 1, id: 'a', ok: true, result: {} })
  for (const url of ['http://x.com', 'javascript:alert(1)', 'intent://x#Intent;end', 'ryntra://trade']) {
    await host.receive(req({ id: 'b', type: 'open.external', url }))
    assert.equal(last().error.code, 'invalid', url)
  }
  assert.deepEqual(opened, ['https://x.com/ryntra'])

  const broken = harness({
    openExternal: async () => {
      throw new Error('no browser')
    },
  })
  broken.host.ready()
  await broken.host.receive(req({ id: 'c', type: 'open.external', url: 'https://x.com' }))
  assert.equal(broken.last().error.code, 'failed')
})

test('`share.file` opens the share sheet on the page’s file; a sheet that fails is `failed`', async () => {
  const { host, shared, last } = harness()
  host.ready()
  await host.receive(req({ id: 'a', type: 'share.file', name: 'tower', mime: 'image/png', data: b64('png') }))
  assert.deepEqual(shared, [{ name: 'tower', mime: 'image/png', data: b64('png'), text: null }])
  assert.deepEqual(last(), { v: 1, id: 'a', ok: true, result: { shared: true } })

  const none = harness({ share: async () => false })
  none.host.ready()
  await none.host.receive(req({ id: 'b', type: 'share.file', name: 'clip', mime: 'video/mp4', data: b64('mp4') }))
  assert.deepEqual(none.last().result, { shared: false })

  const broken = harness({
    share: async () => {
      throw new Error('disk full')
    },
  })
  broken.host.ready()
  await broken.host.receive(req({ id: 'c', type: 'share.file', name: 'clip', mime: 'video/mp4', data: b64('mp4') }))
  assert.equal(broken.last().error.code, 'failed')
})

test('the host answers an unknown request `unsupported` and an unreadable one `invalid`; without an id, silence', async () => {
  const { host, wallet, last, posted } = harness()
  host.ready()
  await host.receive(req({ id: 'a', type: 'wallet.signAllAndSend' }))
  assert.equal(last().error.code, 'unsupported')
  await host.receive(req({ id: 'b', type: 'wallet.signTransactions', transactions: 'no' }))
  assert.equal(last().error.code, 'invalid')
  const count = posted.length
  await host.receive('{"v":1,"type":"wallet.connect"}')
  await host.receive('garbage')
  assert.equal(posted.length, count)
  assert.equal(wallet.calls.length, 0)
})

test('a signature is the 64 bytes or the signed payload’s tail — nothing else', () => {
  const message = new Uint8Array([1, 2, 3])
  const signature = new Uint8Array(64).fill(9)
  assert.deepEqual([...signatureOf(signature, message)], [...signature])
  assert.deepEqual([...signatureOf(new Uint8Array([1, 2, 3, ...signature]), message)], [...signature])
  assert.equal(signatureOf(new Uint8Array([1, 2, 4, ...signature]), message), null)
  assert.equal(signatureOf(new Uint8Array(63), message), null)
})

/* ---- the page in the WebView, and the links ---- */

test('the city opens on its own site; a coin’s link opens its tower', () => {
  assert.equal(cityPathOf('/'), '/')
  assert.equal(cityPathOf(''), '/')
  assert.equal(cityPathOf('/?ref=x'), '/')
  assert.equal(cityPathOf(`/c/${MINT}`), `/c/${MINT}`)
  assert.equal(cityPathOf(`/c/${MINT}/`), `/c/${MINT}`)
  assert.equal(cityPathOf(`/c/${MINT}?from=x`), `/c/${MINT}`)
  assert.equal(cityPathOf('/c/not-a-mint'), null)
  assert.equal(cityPathOf(`/c/${MINT}/more`), null)
  assert.equal(cityPathOf('/app/home'), null)
  assert.equal(cityUrlOf(null), 'https://ryntra.io/')
  assert.equal(cityUrlOf(''), 'https://ryntra.io/')
  assert.equal(cityUrlOf(`/c/${MINT}`), `https://ryntra.io/c/${MINT}`)
  assert.equal(cityUrlOf('//evil.example/x'), 'https://ryntra.io/')
  assert.equal(cityUrlOf('https://evil.example'), 'https://ryntra.io/')
  assert.equal(CITY_PATH, '/')
  assert.equal(cityRouteOf('/'), '/')
  assert.equal(cityRouteOf(`/c/${MINT}`), `/?at=%2Fc%2F${MINT}`)
})

test('every link opens the city: a coin’s tower on its tower, anything else the city itself (decision 75)', () => {
  const tower = `/?at=%2Fc%2F${MINT}`
  assert.equal(cityRouteOfLink('https://ryntra.io/'), '/')
  assert.equal(cityRouteOfLink('https://ryntra.io'), '/')
  assert.equal(cityRouteOfLink(`https://ryntra.io/c/${MINT}`), tower)
  assert.equal(cityRouteOfLink(`https://www.ryntra.io/c/${MINT}?ref=x#top`), tower)
  assert.equal(cityRouteOfLink(`ryntra://c/${MINT}`), tower)
  assert.equal(cityRouteOfLink(`ryntra-dev:///c/${MINT}`), tower)
  assert.equal(cityRouteOfLink(`/c/${MINT}`), tower)
  // The old pages' addresses, a push's link, a door that no longer exists — the city, never an old screen.
  for (const link of [
    'https://ryntra.io/app/home',
    'https://ryntra.io/app/alerts/open?n=inb_0123456789abcdef01234567',
    'ryntra://money/send',
    '/(tabs)/portfolio',
    '/trade?mint=x',
    '/settings',
    'https://ryntra.io/c/nope',
    `https://evil.example/c/${MINT}`,
    `//evil.example/c/${MINT}`,
    'javascript:alert(1)',
    '',
  ])
    assert.equal(cityRouteOfLink(link), '/', link)
})

test('App Links: the app claims ryntra.io/ and ryntra.io/c/ only, verified', () => {
  const app = JSON.parse(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8')).expo
  const filters = app.android.intentFilters
  assert.ok(filters.every((filter) => filter.autoVerify === true))
  const data = filters.flatMap((filter) => filter.data)
  assert.deepEqual(
    data.map((d) => `${d.scheme}://${d.host}${d.path ?? d.pathPrefix}`),
    ['https://ryntra.io/', 'https://ryntra.io/c/'],
  )
})

test('what loads in the city: its own site; another https page opens in the browser; other schemes never', () => {
  assert.equal(loadDecisionOf({ url: 'https://ryntra.io/', isTopFrame: true }), 'load')
  assert.equal(loadDecisionOf({ url: `https://ryntra.io/c/${MINT}` }), 'load')
  assert.equal(loadDecisionOf({ url: 'about:blank' }), 'load')
  assert.equal(loadDecisionOf({ url: 'https://ryntra.io.evil.example/', isTopFrame: true }), 'external')
  assert.equal(loadDecisionOf({ url: 'https://x.com/ryntra', isTopFrame: true }), 'external')
  // Another site's frame would hold the bridge too (Android gives it to every frame): only the site's own frames load.
  assert.equal(loadDecisionOf({ url: 'https://www.youtube.com/embed/x', isTopFrame: false }), 'block')
  assert.equal(loadDecisionOf({ url: 'https://ryntra.io/embed/x', isTopFrame: false }), 'load')
  assert.equal(loadDecisionOf({ url: 'http://ryntra.io/', isTopFrame: true }), 'block')
  assert.equal(loadDecisionOf({ url: 'http://frame.example/', isTopFrame: false }), 'block')
  assert.equal(loadDecisionOf({ url: 'intent://x#Intent;end', isTopFrame: true }), 'block')
  assert.equal(loadDecisionOf({ url: 'solana-wallet://v1/associate/local', isTopFrame: true }), 'block')
  assert.equal(loadDecisionOf({ url: 'javascript:alert(1)', isTopFrame: true }), 'block')

  assert.equal(pageSpeaks('https://ryntra.io'), true)
  assert.equal(pageSpeaks(`https://ryntra.io/c/${MINT}`), true)
  assert.equal(pageSpeaks('https://ryntra.io.evil.example'), false)
  assert.equal(pageSpeaks('https://evil.example/?https://ryntra.io'), false)
  assert.equal(pageSpeaks(undefined), false)
})

test('the cover: no network before the page shows, the page that did not open, then nothing', () => {
  assert.equal(cityCoverOf({ offline: false, failed: false, loaded: false }), 'loading')
  assert.equal(cityCoverOf({ offline: true, failed: false, loaded: false }), 'offline')
  assert.equal(cityCoverOf({ offline: true, failed: true, loaded: false }), 'offline')
  assert.equal(cityCoverOf({ offline: false, failed: true, loaded: false }), 'failed')
  assert.equal(cityCoverOf({ offline: false, failed: false, loaded: true }), 'none')
  // A page already shown stays in reach when the network drops; its own calls say what failed.
  assert.equal(cityCoverOf({ offline: true, failed: false, loaded: true }), 'none')
  assert.equal(cityCoverOf({ offline: false, failed: true, loaded: true }), 'failed')
})

test('the screen holds the rules: the user agent, Back through the page’s history, the bridge only from the site', () => {
  const screen = readFileSync(new URL('../../screens/city/index.tsx', import.meta.url), 'utf8')
  assert.match(screen, /applicationNameForUserAgent=\{userAgentNameOf\(/)
  assert.match(screen, /useSafeAreaInsets\(\)/)
  assert.match(screen, /hardwareBackPress/)
  assert.match(screen, /view\.current\?\.goBack\(\)/)
  assert.match(screen, /if \(!pageSpeaks\(event\.nativeEvent\.url\)\) return/)
  assert.match(screen, /onShouldStartLoadWithRequest=/)
  assert.match(screen, /setSupportMultipleWindows=\{false\}/)
  assert.match(screen, /allowFileAccess=\{false\}/)
  assert.match(screen, /mixedContentMode="never"/)
  // Android raises onLoadStart on every replaceState with no load after it: the bridge must not go deaf on it.
  assert.doesNotMatch(screen, /onLoadStart=/)
  // The app never signs for the page on its own: every signature goes through the wallet hook's own window.
  const host = readFileSync(new URL('./use-city-host.ts', import.meta.url), 'utf8')
  assert.match(host, /wallet\.signTransactions\(transactions\)/)
  assert.match(host, /wallet\.signMessage\(message\)/)
})

/* ---- the app is the city and nothing else (decision 75) ---- */

test('one place: the routes are the city, its links and its fallback — no old screen is reachable', () => {
  const app = new URL('../../app/', import.meta.url)
  const routes = []
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      else routes.push(`${prefix}${entry.name}`)
    }
  }
  walk(app)
  assert.deepEqual(routes.sort(), ['+native-intent.tsx', '+not-found.tsx', '_layout.tsx', 'index.tsx'])
  // What the routes import is the city's own: no old screen, bar, menu, binder or frame.
  const imports = routes
    .flatMap((file) => [...readFileSync(new URL(file, app), 'utf8').matchAll(/from '(@\/[^']+)'/g)].map((m) => m[1]))
    .filter((name) => !name.startsWith('@/features/city/') && name !== '@/screens/city')
  assert.deepEqual(imports, [])
  const screen = ['index.tsx', 'cover.tsx']
    .map((file) => readFileSync(new URL(`../../screens/city/${file}`, import.meta.url), 'utf8'))
    .join('\n')
  assert.doesNotMatch(screen, /@\/components\/|@\/screens\/(?!city)|@\/theme/)
})

test('nothing of the old app runs beside the city: no widget, quick actions, push, camera or microphone', () => {
  const entry = readFileSync(new URL('../../../index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(entry, /widget/i)
  const expo = JSON.parse(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8')).expo
  const plugins = expo.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin))
  for (const gone of [
    'expo-camera',
    'expo-image-picker',
    'expo-notifications',
    'expo-quick-actions',
    'react-native-android-widget',
    './plugins/with-widget-strings.js',
  ])
    assert.ok(!plugins.includes(gone), gone)
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'POST_NOTIFICATIONS'])
    assert.ok(expo.android.blockedPermissions.includes(`android.permission.${permission}`), permission)
})

test('no picture stands in for the city: the launch and the empty states are the night and the Ryntra mark', () => {
  const look = readFileSync(new URL('./city-look.ts', import.meta.url), 'utf8')
  const ground = /CITY_GROUND = '([^']+)'/.exec(look)?.[1]
  const pictures = [...look.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual(pictures, ['../../../assets/images/splash-icon.png'])
  const expo = JSON.parse(readFileSync(new URL('../../../app.json', import.meta.url), 'utf8')).expo
  const splash = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1]
  // The app's night is the launch screen's own, so the one gives way to the other without a seam.
  assert.equal(splash.backgroundColor, ground)
  assert.equal(expo.backgroundColor, ground)
  assert.equal(splash.image, './assets/images/splash-icon.png')
})
