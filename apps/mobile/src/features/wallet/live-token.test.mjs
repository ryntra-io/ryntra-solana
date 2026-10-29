import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { createLiveToken, HUMAN_ANSWER_MS, tokenRefused } from './live-token.ts'

/** The native module's refusal as Mobile Wallet Adapter 2.3.0 hands it on: untyped, the JSON-RPC code in userInfo. */
function nativeRefusal(code = -1) {
  return Object.assign(new Error('JSON-RPC error'), { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: code } })
}

/** A wallet that answers each `authorize` from a script, on a clock the test moves. */
function wallet(clock, script) {
  const calls = []
  return {
    calls,
    authorize: async (params) => {
      calls.push(params)
      const step = script.shift()
      clock.t += step.ms
      if (step.error) throw step.error
      return { auth_token: 'new', accounts: [] }
    },
  }
}

test('the refusal is read typed and untyped, and nothing else counts', () => {
  assert.equal(tokenRefused(nativeRefusal()), true)
  assert.equal(tokenRefused({ code: -1 }), true)
  assert.equal(tokenRefused({ code: '-1' }), true)
  assert.equal(tokenRefused(nativeRefusal(-3)), false)
  assert.equal(tokenRefused({ code: 'ERROR_SESSION_CLOSED' }), false)
  assert.equal(tokenRefused(new Error('java.util.concurrent.CancellationException')), false)
  assert.equal(tokenRefused(null), false)
})

test('a dead token refused at once is dropped and asked again in the same session', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const w = wallet(clock, [{ ms: 90, error: nativeRefusal() }, { ms: 4000 }])
  const result = await live.authorize(w.authorize, { chain: 'solana:mainnet', auth_token: 'dead' })
  assert.equal(result.auth_token, 'new')
  assert.equal(w.calls.length, 2)
  assert.equal(w.calls[0].auth_token, 'dead')
  assert.equal('auth_token' in w.calls[1], false)
  assert.equal(w.calls[1].chain, 'solana:mainnet')
  assert.equal(live.suspect(), false)
})

test('a slow refusal is the person: not asked again now, the next press goes without the token', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const w = wallet(clock, [{ ms: HUMAN_ANSWER_MS + 1, error: nativeRefusal() }, { ms: 3000 }])
  await assert.rejects(live.authorize(w.authorize, { auth_token: 'kept' }))
  assert.equal(w.calls.length, 1)
  assert.equal(live.suspect(), true)
  await live.authorize(w.authorize, { auth_token: 'kept' })
  assert.equal('auth_token' in w.calls[1], false)
  assert.equal(live.suspect(), false)
})

test('without a token, or on another error, nothing is asked again', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const fresh = wallet(clock, [{ ms: 50, error: nativeRefusal() }])
  await assert.rejects(live.authorize(fresh.authorize, { chain: 'solana:mainnet' }))
  assert.equal(fresh.calls.length, 1)
  const closed = wallet(clock, [{ ms: 50, error: Object.assign(new Error('closed'), { code: 'ERROR_SESSION_CLOSED' }) }])
  await assert.rejects(live.authorize(closed.authorize, { auth_token: 'live' }))
  assert.equal(closed.calls.length, 1)
  assert.equal(live.suspect(), false)
})

test('the person declining the fresh ask is final, the token stays dropped, and a reset forgets the suspicion', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const w = wallet(clock, [
    { ms: 80, error: nativeRefusal() },
    { ms: 6000, error: nativeRefusal() },
  ])
  await assert.rejects(live.authorize(w.authorize, { auth_token: 'dead' }))
  assert.equal(w.calls.length, 2)
  assert.equal(live.suspect(), true)
  live.reset()
  assert.equal(live.suspect(), false)
})

test('a fresh ask that fails on the way (the session closed) leaves the dead token out of the next press', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const closed = Object.assign(new Error('The wallet session ended'), { code: 'ERROR_SESSION_CLOSED' })
  const w = wallet(clock, [{ ms: 40, error: nativeRefusal() }, { ms: 300, error: closed }, { ms: 5000 }])
  await assert.rejects(live.authorize(w.authorize, { auth_token: 'dead' }), (error) => error === closed)
  assert.equal(live.suspect(), true)
  await live.authorize(w.authorize, { auth_token: 'dead' })
  assert.equal(w.calls.length, 3)
  assert.equal('auth_token' in w.calls[2], false)
  assert.equal(live.suspect(), false)
})

test('a refusal leaves untyped, so the kit never asks a second time on top', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  // A protocol that one day types the refusal inside the session: the kit would ask again on a typed code -1.
  const typed = Object.assign(new Error('authorization failed'), { code: -1 })
  const w = wallet(clock, [{ ms: HUMAN_ANSWER_MS + 10, error: typed }])
  await assert.rejects(live.authorize(w.authorize, { auth_token: 'held' }), (error) => {
    assert.notEqual(error, typed)
    assert.equal(error.code, 'JSON_RPC_ERROR')
    assert.equal(error.userInfo.jsonRpcErrorCode, -1)
    assert.equal(tokenRefused(error), true)
    return true
  })
})

test('a refusal of a request without a token leaves untyped too, and is not asked again', async () => {
  const clock = { t: 0 }
  const live = createLiveToken(() => clock.t)
  const typed = Object.assign(new Error('authorization failed'), { code: -1 })
  const w = wallet(clock, [{ ms: 50, error: typed }])
  await assert.rejects(live.authorize(w.authorize, { chain: 'solana:mainnet' }), (error) => {
    assert.notEqual(error, typed)
    assert.equal(error.code, 'JSON_RPC_ERROR')
    return true
  })
  assert.equal(w.calls.length, 1)
  assert.equal(live.suspect(), false)
})

test('every wallet request of the app goes through its own session with the live token', () => {
  const source = readFileSync(new URL('./use-wallet.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
  // The kit's own request helpers skip the live token: none is called for connect, sign-in or signing.
  for (const helper of ['wallet.connect(', 'wallet.signIn(', 'wallet.signMessages(', 'wallet.signTransactions(']) {
    assert.equal(source.includes(helper), false, helper)
  }
  assert.match(source, /withLiveToken\(/)
  assert.match(source, /liveToken\.authorize\(/)
  // Signing asks for the account the request was made for.
  assert.match(source, /authorizeAs\(session, address\)/)
})
