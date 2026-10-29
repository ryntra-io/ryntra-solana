import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  checkSession,
  REFRESH_WHEN_LEFT_MS,
  sessionCheckPlan,
  signInWithWallet,
  signOut,
  walletErrorKind,
} from './session-client.ts'
import { describeSession, parseStoredSession, sessionAlive, sessionFor, sessionFromGrant } from './session-model.ts'
import { bytesToBase64, siwsMessageText, textBytes } from './siws.ts'

/* Every double below is a test double for the flow's shape. None of it is a
   server, a wallet or a key, and none of it is reachable from the app. */

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const OTHER = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const NOW = Date.parse('2026-09-15T09:00:00.000Z')
const TOKEN = 'test-double-token-0123456789'

const input = (address = ADDRESS) => ({
  domain: 'ryntra.io',
  address,
  statement: 'Confirm sign-in to Ryntra.',
  uri: 'https://ryntra.io',
  version: '1',
  chainId: 'solana:mainnet',
  nonce: 'n0nce',
  issuedAt: new Date(NOW).toISOString(),
  expirationTime: new Date(NOW + 300_000).toISOString(),
})

const grant = (over = {}) => ({
  token: TOKEN,
  issuedAt: new Date(NOW - 1_000).toISOString(),
  expiresAt: new Date(NOW + 3_600_000).toISOString(),
  sessionId: 'sess-1',
  address: ADDRESS,
  ...over,
})

/** The server's view of the session, as `GET /api/v1/auth/session` answers it. */
const held = (over = {}) => ({
  id: 'sess-1',
  address: ADDRESS,
  network: 'solana:mainnet',
  issuedAt: grant().issuedAt,
  expiresAt: grant().expiresAt,
  ...over,
})

function apiDouble(over = {}) {
  const calls = []
  return {
    calls,
    api: {
      version: 'test',
      challenge: async (address) => {
        calls.push(['challenge', address])
        const issued = input(address)
        return {
          input: issued,
          message: siwsMessageText(issued),
          nonce: issued.nonce,
          expiresAt: issued.expirationTime,
        }
      },
      verify: async (body) => {
        calls.push(['verify', body.address])
        return grant()
      },
      resolve: async (session) => {
        calls.push(['resolve', session.address])
        return held()
      },
      refresh: async (session) => {
        calls.push(['refresh', session.address])
        return grant({
          token: 'refreshed-token-0123456789',
          sessionId: 'sess-2',
          expiresAt: new Date(NOW + 86_400_000).toISOString(),
        })
      },
      revoke: async (session) => {
        calls.push(['revoke', session.address])
      },
      ...over,
    },
  }
}

function walletDouble(over = {}) {
  return {
    address: ADDRESS,
    signIn: async (payload) => ({
      signedMessage: textBytes(siwsMessageText({ ...payload })),
      signature: new Uint8Array(64).fill(1),
      account: { address: ADDRESS },
    }),
    signMessage: async () => new Uint8Array(64).fill(2),
    ...over,
  }
}

test('a grant becomes a session only for the address that signed, unexpired, with a real token', () => {
  const session = sessionFromGrant(grant(), ADDRESS, NOW)
  assert.ok(session)
  assert.equal(session.address, ADDRESS)
  assert.equal(session.sessionId, 'sess-1')
  assert.equal(session.issuedAt, grant().issuedAt, "the issue time is the server's")
  assert.equal(sessionFromGrant(grant({ issuedAt: 'never' }), ADDRESS, NOW).issuedAt, new Date(NOW).toISOString())
  assert.equal(sessionFromGrant(grant({ address: OTHER }), ADDRESS, NOW), null)
  assert.equal(sessionFromGrant(grant({ token: 'short' }), ADDRESS, NOW), null)
  assert.equal(sessionFromGrant(grant({ expiresAt: new Date(NOW - 1).toISOString() }), ADDRESS, NOW), null)
})

test('a stored session is read back or dropped; an expired one never returns', () => {
  const session = sessionFromGrant(grant(), ADDRESS, NOW)
  assert.deepEqual(parseStoredSession(JSON.stringify(session), NOW), session)
  assert.equal(parseStoredSession(JSON.stringify(session), NOW + 3_600_001), null)
  assert.equal(parseStoredSession('garbage', NOW), null)
  assert.equal(parseStoredSession(JSON.stringify({ address: 'nope', token: TOKEN }), NOW), null)
  assert.equal(parseStoredSession(null, NOW), null)
  assert.equal(sessionAlive(session, NOW), true)
  assert.equal(sessionAlive(session, NOW, 3_600_001), false)
})

test('a session belongs to one wallet: another connected wallet gets none of it', () => {
  const session = sessionFromGrant(grant(), ADDRESS, NOW)
  assert.equal(sessionFor(session, ADDRESS, NOW), session)
  assert.equal(sessionFor(session, OTHER, NOW), null)
  assert.equal(sessionFor(session, null, NOW), null)
  assert.equal(sessionFor(null, ADDRESS, NOW), null)
  assert.equal('token' in describeSession(session), false)
})

test("the server's refusals say why in the words a screen may use, and no session is invented", async () => {
  const cases = [
    [new ApiError('UNSUPPORTED_CLIENT', 'App 0.1.0 is below the minimum 1.0.0.', 426, '1.0.0'), 'outdated', /1\.0\.0/],
    [new ApiError('RATE_LIMITED', 'Too many sign-in attempts.', 429), 'refused', /minute/],
    [new ApiError('VALIDATION_ERROR', 'address: not a Solana address.', 400), 'failed', /did not answer/],
    [new TypeError('Network request failed'), 'network', /network/],
  ]
  for (const [error, kind, words] of cases) {
    let saved = null
    const { api } = apiDouble({
      challenge: async () => {
        throw error
      },
    })
    const outcome = await signInWithWallet({ wallet: walletDouble(), api, save: async (s) => (saved = s) })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.failure.kind, kind, error.message)
    assert.equal(outcome.failure.step, 'challenge')
    assert.match(outcome.failure.message, words)
    assert.equal(saved, null)
  }
  const spent = apiDouble({
    verify: async () => {
      throw new ApiError('NONCE_INVALID', 'The nonce was spent.', 401)
    },
  })
  const outcome = await signInWithWallet({ wallet: walletDouble(), api: spent.api, save: async () => undefined })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failure.kind, 'refused')
  assert.equal(outcome.failure.step, 'verify')
})

test('a verify the network failed right after the wallet is sent once more; a refusal never is', async () => {
  const waits = []
  let attempts = 0
  const flaky = apiDouble({
    verify: async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed: Unable to resolve host "ryntra.io"')
      return grant()
    },
  })
  const recovered = await signInWithWallet({
    wallet: walletDouble(),
    api: flaky.api,
    save: async () => undefined,
    now: () => NOW,
    wait: async (ms) => void waits.push(ms),
  })
  assert.equal(recovered.ok, true)
  assert.equal(attempts, 2)
  assert.deepEqual(waits, [1200])

  let refusedAttempts = 0
  const refused = apiDouble({
    verify: async () => {
      refusedAttempts += 1
      throw new ApiError('SIGNATURE_INVALID', 'No.', 401)
    },
  })
  const outcome = await signInWithWallet({
    wallet: walletDouble(),
    api: refused.api,
    save: async () => undefined,
    wait: async () => undefined,
  })
  assert.equal(outcome.failure.kind, 'refused')
  assert.equal(refusedAttempts, 1)

  // Offline twice: said as the network, after one retry and no more.
  let offlineAttempts = 0
  const offline = apiDouble({
    verify: async () => {
      offlineAttempts += 1
      throw new TypeError('Network request failed')
    },
  })
  const down = await signInWithWallet({
    wallet: walletDouble(),
    api: offline.api,
    save: async () => undefined,
    wait: async () => undefined,
  })
  assert.equal(down.failure.kind, 'network')
  assert.equal(down.failure.step, 'verify')
  assert.equal(offlineAttempts, 2)
})

test('the full flow: challenge → sign → verify → a saved session for that wallet', async () => {
  const { api, calls } = apiDouble()
  let saved = null
  const outcome = await signInWithWallet({
    wallet: walletDouble(),
    api,
    save: async (s) => (saved = s),
    now: () => NOW,
  })
  assert.equal(outcome.ok, true)
  assert.equal(saved.address, ADDRESS)
  assert.equal(saved.token, TOKEN)
  assert.deepEqual(calls, [
    ['challenge', ADDRESS],
    ['verify', ADDRESS],
  ])
})

test('a wallet answering through the adapter as base64 text signs in all the same', async () => {
  const { api, calls } = apiDouble()
  const wallet = walletDouble({
    signIn: async (payload) => ({
      signedMessage: textBytes(bytesToBase64(textBytes(siwsMessageText({ ...payload })))),
      signature: textBytes(bytesToBase64(new Uint8Array(64).fill(4))),
      account: { address: ADDRESS },
    }),
  })
  const outcome = await signInWithWallet({ wallet, api, save: async () => undefined, now: () => NOW })
  assert.equal(outcome.ok, true)
  assert.equal(calls.length, 2)
})

test('a challenge for another address or a message that is not the input is refused before signing', async () => {
  const { api } = apiDouble({
    challenge: async () => ({ input: input(OTHER), message: siwsMessageText(input(OTHER)) }),
  })
  let signed = false
  const wallet = walletDouble({
    signIn: async () => {
      signed = true
      throw new Error('must not sign')
    },
  })
  const outcome = await signInWithWallet({ wallet, api, save: async () => undefined })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failure.step, 'challenge')
  assert.equal(signed, false)
})

test('the person closing the wallet is a cancellation, not a failure, and nothing is sent', async () => {
  const { api, calls } = apiDouble()
  const wallet = walletDouble({
    signIn: async () => {
      throw Object.assign(new Error('closed'), { code: 'ERROR_ASSOCIATION_CANCELLED' })
    },
  })
  const outcome = await signInWithWallet({ wallet, api, save: async () => undefined })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failure.kind, 'cancelled')
  assert.match(outcome.failure.message, /closed before/)
  assert.deepEqual(calls, [['challenge', ADDRESS]])
  const declined = await signInWithWallet({
    wallet: walletDouble({
      signIn: async () => {
        throw Object.assign(new Error('declined'), { code: -3 })
      },
    }),
    api,
    save: async () => undefined,
  })
  assert.equal(declined.ok, false)
  assert.equal(declined.failure.kind, 'cancelled')
  // A plain decline says it was declined — no Ledger advice where no Ledger was involved (ST-5).
  assert.equal(declined.failure.message, 'You declined the sign-in in your wallet.')
  assert.equal(declined.failure.hint, undefined)
})

test('the Ledger sentence comes only when the wallet names a Ledger or fails to sign without a decline', async () => {
  const { api } = apiDouble()
  const named = await signInWithWallet({
    wallet: walletDouble({
      signIn: async () => {
        throw Object.assign(new Error('Ledger device: declined (0x6985)'), { code: -3 })
      },
    }),
    api,
    save: async () => undefined,
  })
  assert.equal(named.ok, false)
  assert.equal(named.failure.hint, 'ledger')
  assert.match(named.failure.message, /on a Ledger/)
  const broke = await signInWithWallet({
    wallet: walletDouble({
      signIn: async () => {
        throw new Error('transport failure')
      },
    }),
    api,
    save: async () => undefined,
  })
  assert.equal(broke.ok, false)
  assert.equal(broke.failure.hint, 'ledger')
})

test('a wallet that comes back with nothing says so, and nothing is sent to verify', async () => {
  const { api, calls } = apiDouble()
  const empty = await signInWithWallet({
    wallet: walletDouble({ signIn: async () => undefined }),
    api,
    save: async () => undefined,
  })
  assert.equal(empty.ok, false)
  assert.equal(empty.failure.message, 'The wallet did not answer — try again.')
  assert.equal(empty.failure.hint, undefined)
  // A wallet without sign-in whose message signature comes back empty: the same line, never a silent throw.
  const blank = await signInWithWallet({
    wallet: walletDouble({
      signIn: async () => {
        throw new Error('Sign in result not retrieved.')
      },
      signMessage: async () => undefined,
    }),
    api,
    save: async () => undefined,
  })
  assert.equal(blank.ok, false)
  assert.equal(blank.failure.message, 'The wallet did not answer — try again.')
  assert.ok(calls.every(([name]) => name === 'challenge'))
  // A throw nobody foresaw (here the store) still ends in a line.
  const unsaved = await signInWithWallet({
    wallet: walletDouble(),
    api: apiDouble().api,
    save: async () => {
      throw new Error('store full')
    },
    now: () => NOW,
  })
  assert.equal(unsaved.ok, false)
  assert.equal(unsaved.failure.message, 'The sign-in did not finish. Try again.')
})

test('a wallet without sign-in signs the exact text instead', async () => {
  const { api, calls } = apiDouble()
  let signedText = null
  const wallet = walletDouble({
    signIn: async () => {
      throw new Error('Sign in result not retrieved.')
    },
    signMessage: async (bytes) => {
      signedText = new TextDecoder().decode(bytes)
      return new Uint8Array(64).fill(3)
    },
  })
  const outcome = await signInWithWallet({ wallet, api, save: async () => undefined, now: () => NOW })
  assert.equal(outcome.ok, true)
  assert.equal(signedText, siwsMessageText(input()))
  assert.equal(calls.length, 2)
})

test('a wallet that signs something else is stopped on the phone', async () => {
  const { api, calls } = apiDouble()
  const wallet = walletDouble({
    signIn: async () => ({
      signedMessage: textBytes('I signed my own text'),
      signature: new Uint8Array(64).fill(1),
      account: { address: ADDRESS },
    }),
  })
  const outcome = await signInWithWallet({ wallet, api, save: async () => undefined })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.failure.step, 'sign')
  assert.deepEqual(calls, [['challenge', ADDRESS]])
})

test('the server refusing the signature, or answering for another wallet, leaves no session', async () => {
  const refused = apiDouble({
    verify: async () => {
      throw new ApiError('SIGNATURE_INVALID', 'verification failed', 401)
    },
  })
  const a = await signInWithWallet({ wallet: walletDouble(), api: refused.api, save: async () => undefined })
  assert.equal(a.ok, false)
  assert.equal(a.failure.kind, 'refused')
  const other = apiDouble({ verify: async () => grant({ address: OTHER }) })
  const b = await signInWithWallet({
    wallet: walletDouble(),
    api: other.api,
    save: async () => undefined,
    now: () => NOW,
  })
  assert.equal(b.ok, false)
  assert.equal(b.failure.step, 'verify')
})

test('sign-out tells the server when it can and forgets the device copy either way', async () => {
  const { api, calls } = apiDouble()
  let cleared = 0
  const session = sessionFromGrant(grant(), ADDRESS, NOW)
  await signOut({ session, api, clear: async () => void cleared++ })
  assert.deepEqual(calls, [['revoke', ADDRESS]])
  const failing = apiDouble({
    revoke: async () => {
      throw new Error('offline')
    },
  })
  await signOut({ session, api: failing.api, clear: async () => void cleared++ })
  await signOut({ session: null, api, clear: async () => void cleared++ })
  assert.equal(cleared, 3)
})

test('wallet errors map to the words a screen may use', () => {
  assert.equal(walletErrorKind({ code: 'ERROR_WALLET_NOT_FOUND' }), 'no-wallet')
  assert.equal(walletErrorKind({ code: -1 }), 'cancelled')
  assert.equal(walletErrorKind({ code: -3 }), 'cancelled')
  assert.equal(walletErrorKind({ code: 'ERROR_SESSION_CLOSED' }), 'cancelled')
  assert.equal(walletErrorKind(new Error('user declined')), 'cancelled')
  assert.equal(walletErrorKind(new Error('Sign in result not retrieved.')), 'unsupported')
  assert.equal(walletErrorKind(new Error('boom')), 'failed')
})

test('the launch check: a session the server still holds is kept; one near its end is refreshed', async () => {
  const session = sessionFromGrant(grant({ expiresAt: new Date(NOW + 86_400_000).toISOString() }), ADDRESS, NOW)
  assert.equal(sessionCheckPlan(session, NOW), 'resolve')
  assert.equal(sessionCheckPlan(session, Date.parse(session.expiresAt) - REFRESH_WHEN_LEFT_MS), 'refresh')
  assert.equal(sessionCheckPlan(session, Date.parse(session.expiresAt)), 'none')
  assert.equal(sessionCheckPlan(null, NOW), 'none')

  const kept = apiDouble({ resolve: async () => held({ expiresAt: session.expiresAt }) })
  let saved = null
  let cleared = 0
  const a = await checkSession({
    session,
    api: kept.api,
    save: async (s) => (saved = s),
    clear: async () => void cleared++,
    now: () => NOW,
  })
  assert.equal(a.status, 'kept')
  assert.equal(a.session, session)
  assert.equal(saved, null, 'nothing to save when the server agrees')

  const refreshed = apiDouble()
  const late = Date.parse(session.expiresAt) - REFRESH_WHEN_LEFT_MS + 1
  const b = await checkSession({
    session,
    api: refreshed.api,
    save: async (s) => (saved = s),
    clear: async () => void cleared++,
    now: () => late,
  })
  assert.equal(b.status, 'refreshed')
  assert.equal(saved.token, 'refreshed-token-0123456789')
  assert.equal(saved.sessionId, 'sess-2')
  assert.equal(b.session, saved)
  assert.deepEqual(refreshed.calls, [['refresh', ADDRESS]])
  assert.equal(cleared, 0)
})

test('the launch check: a session the server revoked, expired or does not know is forgotten here', async () => {
  const session = sessionFromGrant(grant({ expiresAt: new Date(NOW + 86_400_000).toISOString() }), ADDRESS, NOW)
  for (const code of ['SESSION_REVOKED', 'SESSION_EXPIRED', 'UNAUTHORIZED']) {
    let cleared = 0
    const { api } = apiDouble({
      resolve: async () => {
        throw new ApiError(code, 'gone', 401)
      },
    })
    const outcome = await checkSession({
      session,
      api,
      save: async () => undefined,
      clear: async () => void cleared++,
      now: () => NOW,
    })
    assert.equal(outcome.status, 'ended', code)
    assert.equal(outcome.session, null)
    assert.equal(cleared, 1)
  }
  // The server answering for another wallet is no session of ours.
  let cleared = 0
  const other = apiDouble({ resolve: async () => held({ address: OTHER }) })
  const a = await checkSession({
    session,
    api: other.api,
    save: async () => undefined,
    clear: async () => void cleared++,
    now: () => NOW,
  })
  assert.equal(a.status, 'ended')
  assert.equal(cleared, 1)
  // A refresh the server refuses because the session is already dead ends it too.
  const dead = apiDouble({
    refresh: async () => {
      throw new ApiError('SESSION_EXPIRED', 'expired', 401)
    },
  })
  const late = Date.parse(session.expiresAt) - 1_000
  const b = await checkSession({
    session,
    api: dead.api,
    save: async () => undefined,
    clear: async () => void cleared++,
    now: () => late,
  })
  assert.equal(b.status, 'ended')
  assert.equal(cleared, 2)
  // One that expired by the clock is dropped without asking.
  const quiet = apiDouble()
  const c = await checkSession({
    session,
    api: quiet.api,
    save: async () => undefined,
    clear: async () => void cleared++,
    now: () => Date.parse(session.expiresAt) + 1,
  })
  assert.equal(c.status, 'ended')
  assert.equal(cleared, 3)
  assert.deepEqual(quiet.calls, [])
})

test('the launch check offline keeps the session; a server hiccup keeps it too', async () => {
  const session = sessionFromGrant(grant({ expiresAt: new Date(NOW + 86_400_000).toISOString() }), ADDRESS, NOW)
  let cleared = 0
  const offline = apiDouble({
    resolve: async () => {
      throw new TypeError('Network request failed')
    },
  })
  const a = await checkSession({
    session,
    api: offline.api,
    save: async () => undefined,
    clear: async () => void cleared++,
    now: () => NOW,
  })
  assert.equal(a.status, 'offline')
  assert.equal(a.session, session)
  const hiccup = apiDouble({
    resolve: async () => {
      throw new ApiError('UNAVAILABLE', 'The store did not answer.', 503)
    },
  })
  const b = await checkSession({
    session,
    api: hiccup.api,
    save: async () => undefined,
    clear: async () => void cleared++,
    now: () => NOW,
  })
  assert.equal(b.status, 'kept')
  assert.equal(cleared, 0)
  // The server's own expiry wins over the device's copy.
  const moved = apiDouble({
    resolve: async () => held({ expiresAt: new Date(NOW + 7_200_000).toISOString(), id: 'sess-1' }),
  })
  let saved = null
  const c = await checkSession({
    session,
    api: moved.api,
    save: async (s) => (saved = s),
    clear: async () => void cleared++,
    now: () => NOW,
  })
  assert.equal(c.status, 'kept')
  assert.equal(saved.expiresAt, new Date(NOW + 7_200_000).toISOString())
  assert.equal(saved.token, TOKEN)
})
