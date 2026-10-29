import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  afterFailedConnect,
  KEEP_CHOICES,
  KEEP_DEFAULT,
  KEEP_MS,
  keepChoice,
  keepEnded,
  keepUntil,
  LONGEST_TIMER_MS,
  parseKeepChoice,
  rechoose,
  serializeKeepChoice,
  timerDelay,
} from './keep-connected.ts'
import {
  checkSession,
  nextRefreshAt,
  REFRESH_AFTER_MS,
  REFRESH_WHEN_LEFT_MS,
  sessionCheckPlan,
} from './session-client.ts'
import { parseStoredSession } from './session-model.ts'
import { bearerOf, forgetBearers, noteReplaced } from '../../lib/session-bearer.ts'
import {
  inWallet,
  resetWalletAway,
  WALLET_OUT_LONGEST_MS,
  WALLET_QUIET_MS,
  walletQuietAt,
} from '../wallet/wallet-away.ts'

/* A stand clock and test doubles of the server's session routes — no server,
   no wallet, no key. The clock is a number moved by hand. */

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = Date.parse('2026-10-18T09:00:00.000Z')

function stand(start = T0) {
  let now = start
  return {
    now: () => now,
    advance: (ms) => {
      now += ms
    },
  }
}

const sessionAt = (issued, n = 1) => ({
  address: ADDRESS,
  token: `stand-token-${n}-0123456789`,
  issuedAt: new Date(issued).toISOString(),
  expiresAt: new Date(issued + DAY).toISOString(),
  sessionId: `sess-${n}`,
})

/** The server's day, as line A issues it (`NATIVE_SESSION_TTL_SECONDS`): every refresh is a new day from its moment. */
function server(clock) {
  let issued = 1
  const calls = []
  let offline = false
  const api = {
    challenge: async () => {
      throw new Error('not used')
    },
    verify: async () => {
      throw new Error('not used')
    },
    resolve: async (session) => {
      calls.push('resolve')
      if (offline) throw new TypeError('Network request failed')
      if (Date.parse(session.expiresAt) <= clock.now()) throw new ApiError('SESSION_EXPIRED', 'expired', 401)
      return {
        id: session.sessionId,
        address: session.address,
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      }
    },
    refresh: async (session) => {
      calls.push('refresh')
      if (offline) throw new TypeError('Network request failed')
      if (Date.parse(session.expiresAt) <= clock.now()) throw new ApiError('SESSION_EXPIRED', 'expired', 401)
      issued += 1
      const next = sessionAt(clock.now(), issued)
      return {
        token: next.token,
        address: ADDRESS,
        issuedAt: next.issuedAt,
        expiresAt: next.expiresAt,
        sessionId: next.sessionId,
      }
    },
    revoke: async () => undefined,
  }
  return {
    api,
    calls,
    goOffline: (value) => {
      offline = value
    },
  }
}

/** One visit: the app opened (or brought back) at the stand clock's moment, the check run as the binder runs it. */
async function visit(device, srv, clock, keep = null) {
  const check = await checkSession({
    session: device.session,
    api: srv.api,
    save: async (s) => {
      device.session = s
      device.stored = JSON.stringify(s)
    },
    clear: async () => {
      device.session = null
      device.stored = null
    },
    now: clock.now,
    keepUntil: keep,
  })
  return check.status
}

test('the four choices, in the row’s order; «поки не вийду» is the default and has no end', () => {
  assert.deepEqual(KEEP_CHOICES, ['hour', 'twoHours', 'day', 'untilSignOut'])
  assert.equal(KEEP_DEFAULT, 'untilSignOut')
  assert.deepEqual(KEEP_MS, { hour: HOUR, twoHours: 2 * HOUR, day: DAY, untilSignOut: null })
  assert.equal(keepUntil(keepChoice('untilSignOut', T0)), null)
  assert.equal(keepEnded(keepChoice('untilSignOut', T0), T0 + 365 * DAY), false)
})

test('a chosen time ends exactly when it runs out, never before', () => {
  const clock = stand()
  for (const [keep, span] of [
    ['hour', HOUR],
    ['twoHours', 2 * HOUR],
    ['day', DAY],
  ]) {
    const choice = keepChoice(keep, clock.now())
    assert.equal(keepUntil(choice), T0 + span, keep)
    assert.equal(keepEnded(choice, T0 + span - 1), false, keep)
    assert.equal(keepEnded(choice, T0 + span), true, keep)
  }
})

test('the stored choice survives a restart; anything unreadable is the default, never an end', () => {
  const choice = keepChoice('twoHours', T0)
  assert.deepEqual(parseKeepChoice(serializeKeepChoice(choice), T0 + HOUR), choice)
  for (const raw of [null, undefined, '', 'nonsense', '{"keep":"week","since":1}', '[]', '{"keep":7}']) {
    const read = parseKeepChoice(raw, T0)
    assert.equal(read.keep, 'untilSignOut', String(raw))
    assert.equal(keepEnded(read, T0 + 10 * DAY), false, String(raw))
  }
  // A start in the future (the device's clock set back) counts from now: the time never runs longer than chosen.
  const ahead = parseKeepChoice(JSON.stringify({ keep: 'hour', since: T0 + 5 * HOUR }), T0)
  assert.equal(keepUntil(ahead), T0 + HOUR)
})

test('a tap on the choice already made changes nothing; another choice starts its time now', () => {
  const chosen = keepChoice('twoHours', T0)
  // The selected «2 год» tapped again two minutes later: the end it shows stays where it was.
  const again = rechoose(chosen, 'twoHours', T0 + 2 * 60_000)
  assert.equal(again, chosen)
  assert.equal(keepUntil(again), T0 + 2 * HOUR)
  const other = rechoose(chosen, 'hour', T0 + 2 * 60_000)
  assert.deepEqual(other, keepChoice('hour', T0 + 2 * 60_000))
})

test('a connect cancelled or failed in the wallet puts the time before it back', () => {
  const previous = keepChoice('day', T0)
  // The connect started the clock again, then the person closed the wallet.
  const started = keepChoice('day', T0 + 3 * HOUR)
  assert.equal(afterFailedConnect(started, started, previous), previous)
  assert.equal(keepUntil(afterFailedConnect(started, started, previous)), T0 + DAY)
  // A choice the person made while the wallet was open is never undone.
  const meanwhile = keepChoice('hour', T0 + 3 * HOUR + 5_000)
  assert.equal(afterFailedConnect(meanwhile, started, previous), meanwhile)
})

test('a timer is at least a second and never past what a JS timer holds', () => {
  assert.equal(timerDelay(T0 - 5_000, T0), 1_000)
  assert.equal(timerDelay(T0 + 90_000, T0), 90_000)
  assert.equal(timerDelay(T0 + 60 * DAY, T0), LONGEST_TIMER_MS)
})

test('«поки не вийду»: a visit every day keeps the sign-in past the server’s day, across restarts', async () => {
  const clock = stand()
  const srv = server(clock)
  const device = { session: sessionAt(T0), stored: null }
  device.stored = JSON.stringify(device.session)
  // Visits at uneven hours — 10 h, then 20 h later, then 22 h later: each lands past the old six-hour window.
  for (const gap of [10 * HOUR, 20 * HOUR, 22 * HOUR, 23 * HOUR - 1]) {
    clock.advance(gap)
    // A restart: the device reads its secure store again.
    device.session = parseStoredSession(device.stored, clock.now())
    assert.ok(device.session, `still signed in after ${gap / HOUR} h`)
    assert.equal(await visit(device, srv, clock), 'refreshed')
  }
  assert.equal(device.session.sessionId, 'sess-5')
  // Under the rule before ST-2 the second visit (30 h after sign-in, 20 h after a look that did not refresh) found it gone.
  const before = sessionAt(T0)
  assert.equal(sessionCheckPlan(before, T0 + 10 * HOUR, null), 'refresh')
  assert.ok(T0 + 10 * HOUR < Date.parse(before.expiresAt) - REFRESH_WHEN_LEFT_MS, 'the old rule would only have looked')
})

test('a lost network keeps the session and the wallet; the refresh is tried again when it returns', async () => {
  const clock = stand()
  const srv = server(clock)
  const device = { session: sessionAt(T0), stored: null }
  clock.advance(3 * HOUR)
  srv.goOffline(true)
  assert.equal(await visit(device, srv, clock), 'offline')
  assert.equal(device.session.sessionId, 'sess-1', 'nothing forgotten offline')
  clock.advance(HOUR)
  srv.goOffline(false)
  assert.equal(await visit(device, srv, clock), 'refreshed')
  assert.equal(device.session.sessionId, 'sess-2')
})

test('a fresh session is only looked at; the next check is due three hours after it was issued', async () => {
  const clock = stand()
  const srv = server(clock)
  const device = { session: sessionAt(T0), stored: null }
  clock.advance(REFRESH_AFTER_MS - 1)
  assert.equal(await visit(device, srv, clock), 'kept')
  assert.deepEqual(srv.calls, ['resolve'])
  assert.equal(nextRefreshAt(device.session, clock.now()), T0 + REFRESH_AFTER_MS)
  clock.advance(1)
  assert.equal(await visit(device, srv, clock), 'refreshed')
})

test('a chosen time the session already outlives asks for no refresh; one it does not outlive refreshes it', async () => {
  const clock = stand()
  const srv = server(clock)
  const device = { session: sessionAt(T0), stored: null }
  // «1 год» chosen at sign-in: the server's day outlives it — looked at, never refreshed, no refresh timer.
  const hour = keepUntil(keepChoice('hour', T0))
  clock.advance(50 * 60_000)
  assert.equal(await visit(device, srv, clock, hour), 'kept')
  assert.equal(nextRefreshAt(device.session, clock.now(), hour), null)
  // «доба» chosen five hours after the sign-in: the session ends before it, so it is refreshed.
  clock.advance(5 * HOUR)
  const day = keepUntil(keepChoice('day', clock.now()))
  assert.equal(await visit(device, srv, clock, day), 'refreshed')
  assert.ok(Date.parse(device.session.expiresAt) >= day)
  assert.deepEqual(srv.calls, ['resolve', 'refresh'])
})

test('more than a day away, the server’s day is over: the one sign-in asked again until line A keeps it longer (request 59)', async () => {
  const clock = stand()
  const srv = server(clock)
  const device = { session: sessionAt(T0), stored: null }
  clock.advance(DAY + HOUR)
  // The device's own clock already says it is over: dropped without a request.
  assert.equal(await visit(device, srv, clock), 'ended')
  assert.deepEqual(srv.calls, [])
})

test('no refresh while the wallet is open or just answered: the flow finishes on the bearer it started with', async () => {
  resetWalletAway()
  const clock = stand()
  assert.equal(walletQuietAt(clock.now()), clock.now(), 'a phone that never opened a wallet is quiet')
  let release
  const signing = inWallet(() => new Promise((resolve) => (release = resolve)), clock.now)
  assert.ok(walletQuietAt(clock.now()) > clock.now(), 'not while the wallet is out')
  clock.advance(40_000)
  release('signed')
  assert.equal(await signing, 'signed')
  assert.equal(walletQuietAt(clock.now()), clock.now() + WALLET_QUIET_MS, 'a minute behind the answer')
  // A refused or failed wallet request counts the same.
  await assert.rejects(
    inWallet(async () => {
      throw new Error('declined')
    }, clock.now),
  )
  assert.equal(walletQuietAt(clock.now()), clock.now() + WALLET_QUIET_MS)

  // The return from the wallet lands on a session held for hours: it is only looked at, not replaced.
  const srv = server(clock)
  const device = { session: sessionAt(clock.now() - 4 * HOUR), stored: null }
  const check = await checkSession({
    session: device.session,
    api: srv.api,
    save: async (s) => void (device.session = s),
    clear: async () => void (device.session = null),
    now: clock.now,
    mayRefresh: walletQuietAt(clock.now()) <= clock.now(),
  })
  assert.equal(check.status, 'kept')
  assert.deepEqual(srv.calls, ['resolve'])
  clock.advance(WALLET_QUIET_MS)
  assert.equal(walletQuietAt(clock.now()), clock.now())
  assert.equal(await visit(device, srv, clock), 'refreshed')
  resetWalletAway()
})

test('a session read before a refresh sends the new bearer, never the replaced one; another wallet’s never', async () => {
  // The doubles' tokens repeat between tests: the chain starts clean.
  forgetBearers(ADDRESS)
  const clock = stand()
  const srv = server(clock)
  const held = sessionAt(T0)
  const device = { session: held, stored: null }
  clock.advance(4 * HOUR)
  assert.equal(await visit(device, srv, clock), 'refreshed')
  // A flow that captured `held` before the refresh: its request carries the newest token.
  assert.equal(bearerOf(held), device.session.token)
  clock.advance(4 * HOUR)
  assert.equal(await visit(device, srv, clock), 'refreshed')
  assert.equal(bearerOf(held), device.session.token, 'a chain of refreshes is followed to its end')
  const other = { address: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', token: 'other-wallet-token-0123456789' }
  noteReplaced(held, other)
  assert.equal(bearerOf(held), device.session.token, 'another wallet’s token is never a replacement')
  forgetBearers(ADDRESS)
  assert.equal(bearerOf(held), held.token, 'a sign-out keeps none of the old chain')
})

test('no refresh timer when the session already outlives the chosen end', () => {
  const session = sessionAt(T0)
  assert.equal(nextRefreshAt(session, T0, T0 + HOUR), null, '«1 год»: the day outlives it')
  // «доба» chosen two hours in: the refresh is due before the end, at three hours.
  assert.equal(nextRefreshAt(session, T0 + 2 * HOUR, T0 + 26 * HOUR), T0 + REFRESH_AFTER_MS)
  // The refresh would fall at or after the end: none.
  assert.equal(nextRefreshAt(sessionAt(T0), T0, T0 + REFRESH_AFTER_MS), null)
  assert.equal(nextRefreshAt(session, T0 + DAY), null, 'a session that is over has no timer')
})

test('a wallet request that never comes back stops holding the refresh once the flows have given up on it', async () => {
  resetWalletAway()
  const clock = stand()
  void inWallet(() => new Promise(() => undefined), clock.now)
  assert.ok(walletQuietAt(clock.now()) > clock.now())
  clock.advance(WALLET_OUT_LONGEST_MS)
  assert.equal(walletQuietAt(clock.now()), clock.now(), 'given up on: quiet')
  resetWalletAway()
})
