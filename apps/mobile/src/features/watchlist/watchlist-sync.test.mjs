import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ApiError } from '../../lib/api.ts'
import {
  parseWalletList,
  sameList,
  scopeFor,
  toggleInWallet,
  walletListAfterWrite,
  walletListFromServer,
  WATCHLIST_LIMIT,
} from './watchlist-model.ts'
import { createWatchlistSync } from './watchlist-sync.ts'

/* Test doubles for the sync's shape — no server, no wallet, nothing the app
   can reach. The server double follows contract 1.3.0 §3: the row's version,
   `ifVersion` refused when stale, and the one merge — the server's order
   first, the device's additions after, removals honoured and remembered with
   their time, so an addition the web removed after the phone's mark is not
   re-added. */

const A = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const B = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const SOL = 'So11111111111111111111111111111111111111112'
const NVDA = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'

const session = (address) => ({
  address,
  token: 'test-double-token-0123456789',
  issuedAt: 'now',
  expiresAt: 'later',
  sessionId: null,
})

function serverDouble(initial = {}) {
  const rows = new Map()
  const log = []
  let clock = 0
  const tick = () => `2026-09-16T00:00:${String(++clock).padStart(2, '0')}.000Z`
  const row = (address) => {
    if (!rows.has(address)) rows.set(address, { mints: [], version: 0, updatedAt: null, removed: new Map() })
    return rows.get(address)
  }
  for (const [address, mints] of Object.entries(initial)) {
    const r = row(address)
    r.mints = [...mints]
    r.version = 1
    r.updatedAt = tick()
  }
  const answer = (r) => ({ mints: [...r.mints], version: r.version, updatedAt: r.updatedAt })
  return {
    rows,
    log,
    listOf: (address) => [...row(address).mints],
    read: async (s) => {
      log.push(['get', s.address])
      return answer(row(s.address))
    },
    write: async (s, mints, ifVersion) => {
      const r = row(s.address)
      log.push(['put', s.address, [...mints], ifVersion])
      if (ifVersion !== null && ifVersion !== r.version) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'ifVersion: the list changed since it was read; read it again and merge.',
          400,
        )
      }
      const now = tick()
      for (const mint of r.mints) if (!mints.includes(mint)) r.removed.set(mint, now)
      r.mints = [...mints]
      r.version += 1
      r.updatedAt = now
      return answer(r)
    },
    merge: async (s, { mints, removed, syncedAt }) => {
      const r = row(s.address)
      log.push(['merge', s.address, [...mints], [...removed], syncedAt])
      const droppedByServer = []
      const notKept = []
      const next = r.mints.filter((mint) => !removed.includes(mint))
      for (const mint of mints) {
        if (next.includes(mint)) continue
        const removedAt = r.removed.get(mint)
        if (syncedAt !== null && removedAt && removedAt > syncedAt) {
          droppedByServer.push(mint)
          continue
        }
        if (next.length >= WATCHLIST_LIMIT) {
          notKept.push(mint)
          continue
        }
        next.push(mint)
      }
      const now = tick()
      for (const mint of removed) if (r.mints.includes(mint)) r.removed.set(mint, now)
      r.mints = next
      r.version += 1
      r.updatedAt = now
      return { mints: [...next], notKept, droppedByServer, version: r.version, syncedAt: now }
    },
    /** The person on the web. */
    webRemove(address, mint) {
      const r = row(address)
      const now = tick()
      r.mints = r.mints.filter((item) => item !== mint)
      r.removed.set(mint, now)
      r.version += 1
      r.updatedAt = now
    },
    webAdd(address, mint) {
      const r = row(address)
      const now = tick()
      if (!r.mints.includes(mint)) r.mints.push(mint)
      r.removed.delete(mint)
      r.version += 1
      r.updatedAt = now
    },
  }
}

function harness(initial = {}, over = {}) {
  const server = serverDouble(initial)
  const device = { mints: [] }
  const wallets = new Map()
  let clock = 0
  const sync = createWatchlistSync({
    read: server.read,
    write: server.write,
    merge: server.merge,
    device: { get: () => device.mints, set: (mints) => (device.mints = [...mints]) },
    wallet: { get: (address) => wallets.get(address) ?? null, set: (address, list) => wallets.set(address, list) },
    now: () => `phone-t${++clock}`,
    ...over,
  })
  /** A star tapped on the phone while signed in: the store applies it and the binder pushes the list. */
  const tap = (address, mint) => {
    const current = wallets.get(address) ?? {
      mints: [],
      removed: [],
      version: null,
      mark: null,
      syncedAt: null,
      pending: false,
    }
    const { list } = toggleInWallet(current, mint)
    wallets.set(address, list)
    return sync.push(session(address))
  }
  return { sync, server, device, wallets, tap }
}

test('scopes: a session address owns a wallet list, no session means the device', () => {
  assert.equal(scopeFor(null), 'device')
  assert.equal(scopeFor('nope'), 'device')
  assert.equal(scopeFor(A), `wallet:${A}`)
})

test("a wallet's list as a value: a tap changes it now and remembers a removal; the server's answer settles it", () => {
  const fresh = walletListFromServer({ mints: [NVDA, BONK], version: 3, mark: 'm1' }, 'p1')
  assert.deepEqual(fresh, { mints: [NVDA, BONK], removed: [], version: 3, mark: 'm1', syncedAt: 'p1', pending: false })
  const added = toggleInWallet(fresh, SOL)
  assert.deepEqual(added.list.mints, [NVDA, BONK, SOL])
  assert.equal(added.list.pending, true)
  assert.equal(added.toggle.added, true)
  const removed = toggleInWallet(added.list, BONK)
  assert.deepEqual(removed.list.mints, [NVDA, SOL])
  assert.deepEqual(removed.list.removed, [BONK])
  const back = toggleInWallet(removed.list, BONK)
  assert.deepEqual(back.list.removed, [], 'adding it back forgets the removal')
  const refused = toggleInWallet(fresh, 'nope')
  assert.equal(refused.list, fresh)
  assert.equal(refused.toggle.refused, true)
  // The answer to a write of exactly this list replaces it; a newer tap keeps its own list and takes the version.
  const settled = walletListAfterWrite(
    removed.list,
    removed.list.mints,
    { mints: [NVDA, SOL], version: 4, mark: 'm2' },
    'p2',
  )
  assert.equal(settled.pending, false)
  assert.deepEqual(settled.removed, [])
  const newer = toggleInWallet(removed.list, WIF).list
  const kept = walletListAfterWrite(newer, removed.list.mints, { mints: [NVDA, SOL], version: 4, mark: 'm2' }, 'p2')
  assert.deepEqual(kept.mints, [NVDA, SOL, WIF])
  assert.equal(kept.pending, true)
  assert.equal(kept.version, 4)
  assert.equal(kept.mark, 'm2')
  // Stored text comes back as a list; garbage is no list.
  assert.deepEqual(parseWalletList(JSON.stringify(settled)), settled)
  assert.equal(parseWalletList('garbage'), null)
  assert.equal(parseWalletList('[]'), null)
  assert.equal(parseWalletList(null), null)
  assert.deepEqual(parseWalletList('{"mints":["nope"],"version":"3"}'), {
    mints: [],
    removed: [],
    version: null,
    mark: null,
    syncedAt: null,
    pending: false,
  })
})

test('local list → sign in → the one merge: the server order first, the device extras after, the device emptied', async () => {
  const h = harness({ [A]: [NVDA, BONK] })
  h.device.mints = [SOL, NVDA]
  const result = await h.sync.sync(session(A))
  assert.equal(result.ok, true)
  assert.equal(result.how, 'adopted')
  assert.equal(result.adopted, 2)
  assert.deepEqual(result.mints, [NVDA, BONK, SOL])
  assert.deepEqual(h.server.listOf(A), [NVDA, BONK, SOL])
  assert.deepEqual(h.device.mints, [], 'the device list was adopted')
  const list = h.wallets.get(A)
  assert.deepEqual(list.mints, [NVDA, BONK, SOL])
  assert.equal(list.version, 2)
  assert.equal(list.pending, false)
  assert.equal(typeof list.mark, 'string')
  assert.equal(list.syncedAt, 'phone-t1')
  assert.deepEqual(h.server.log, [['merge', A, [SOL, NVDA], [], null]])
  // A second sync is a plain read: nothing merged again.
  const again = await h.sync.sync(session(A))
  assert.equal(again.how, 'read')
  assert.equal(h.server.log.length, 2)
  assert.equal(h.server.log[1][0], 'get')
})

test('a change on the web reaches the phone; a mint removed on the web is not resurrected by the phone', async () => {
  const h = harness({ [A]: [NVDA, BONK] })
  await h.sync.sync(session(A))
  h.server.webAdd(A, WIF)
  h.server.webRemove(A, BONK)
  const read = await h.sync.sync(session(A))
  assert.equal(read.how, 'read')
  assert.deepEqual(h.wallets.get(A).mints, [NVDA, WIF])
  assert.equal(h.wallets.get(A).version, 4)
  // Offline on the phone: BONK starred again from an old view, then the web removed it after the phone's mark.
  const h2 = harness({ [A]: [NVDA, BONK] })
  await h2.sync.sync(session(A))
  h2.server.webRemove(A, BONK)
  const offline = harness(
    {},
    {
      write: async () => {
        throw new TypeError('Network request failed')
      },
      merge: async () => {
        throw new TypeError('Network request failed')
      },
    },
  )
  offline.wallets.set(A, h2.wallets.get(A))
  const pushed = await offline.tap(A, SOL)
  assert.equal(pushed, false, 'the push did not reach the server')
  assert.equal(offline.wallets.get(A).pending, true)
  // Back online, the next sync merges: the phone's SOL is added, BONK stays removed, nothing is resurrected.
  h2.wallets.set(A, offline.wallets.get(A))
  const merged = await h2.sync.sync(session(A))
  assert.equal(merged.how, 'merged')
  assert.deepEqual(h2.server.listOf(A), [NVDA, SOL])
  assert.deepEqual(h2.wallets.get(A).mints, [NVDA, SOL])
  assert.equal(h2.wallets.get(A).pending, false)
  assert.deepEqual(merged.droppedByServer, [BONK], 'the stale BONK the phone still carried is named, not re-added')
})

test('a phone addition the web removed after the mark is dropped by the server and named', async () => {
  const h = harness({ [A]: [NVDA, BONK] })
  await h.sync.sync(session(A))
  const list = h.wallets.get(A)
  // The phone removes BONK offline; meanwhile the web removes NVDA. Then the phone, still offline, stars NVDA again.
  const stale = toggleInWallet(toggleInWallet(list, BONK).list, NVDA).list // BONK removed, NVDA already present → removed too
  const restarred = toggleInWallet(stale, NVDA).list // NVDA back on the phone, after the web removed it
  h.server.webRemove(A, NVDA)
  h.wallets.set(A, restarred)
  const merged = await h.sync.sync(session(A))
  assert.equal(merged.how, 'merged')
  assert.deepEqual(merged.droppedByServer, [NVDA], 'the web removed it after the phone last agreed')
  assert.deepEqual(h.server.listOf(A), [])
  assert.deepEqual(h.wallets.get(A).mints, [])
})

test('taps while signed in are pushed as full lists naming the version read, one after another', async () => {
  const h = harness({ [A]: [NVDA] })
  await h.sync.sync(session(A))
  assert.equal(await h.tap(A, SOL), true)
  assert.equal(await h.tap(A, WIF), true)
  assert.equal(await h.tap(A, NVDA), true)
  const puts = h.server.log.filter((entry) => entry[0] === 'put')
  assert.deepEqual(
    puts.map((entry) => entry[2]),
    [
      [NVDA, SOL],
      [NVDA, SOL, WIF],
      [SOL, WIF],
    ],
  )
  assert.deepEqual(
    puts.map((entry) => entry[3]),
    [2, 3, 4],
    'each write names the version the previous answer gave',
  )
  assert.deepEqual(h.server.listOf(A), [SOL, WIF])
  const list = h.wallets.get(A)
  assert.deepEqual(list.mints, [SOL, WIF])
  assert.equal(list.pending, false)
  assert.deepEqual(list.removed, [])
  assert.equal(list.version, 5)
})

test('a burst of taps travels as one write; nothing runs two at once', async () => {
  const h = harness({ [A]: [NVDA] })
  await h.sync.sync(session(A))
  const results = await Promise.all([h.tap(A, SOL), h.tap(A, WIF), h.tap(A, NVDA)])
  assert.deepEqual(results, [true, true, true])
  const puts = h.server.log.filter((entry) => entry[0] === 'put')
  assert.deepEqual(puts, [['put', A, [SOL, WIF], 2]])
  assert.deepEqual(h.server.listOf(A), [SOL, WIF])
  assert.equal(h.wallets.get(A).pending, false)
  assert.equal(h.wallets.get(A).version, 3)
})

test('a write refused as stale — another device wrote first — is answered by a merge, and nothing is overwritten blind', async () => {
  const h = harness({ [A]: [NVDA] })
  await h.sync.sync(session(A))
  h.server.webAdd(A, JUP) // the web wrote after the phone's read: version moved
  const pushed = await h.tap(A, SOL)
  assert.equal(pushed, true)
  const kinds = h.server.log.map((entry) => entry[0])
  assert.deepEqual(kinds, ['merge', 'put', 'merge'])
  assert.deepEqual(h.server.listOf(A), [NVDA, JUP, SOL], "the web's JUP survived the phone's write")
  assert.deepEqual(h.wallets.get(A).mints, [NVDA, JUP, SOL])
  assert.equal(h.wallets.get(A).pending, false)
})

test('a tap before the first sync answers is merged, not written over the server list', async () => {
  const h = harness({ [A]: [NVDA, BONK] })
  h.device.mints = [WIF]
  const pushed = await h.tap(A, SOL) // no version was ever read
  assert.equal(pushed, true)
  assert.deepEqual(h.server.log, [['merge', A, [WIF, SOL], [], null]], 'the device list rides along, as the one merge')
  assert.deepEqual(h.server.listOf(A), [NVDA, BONK, WIF, SOL])
  assert.deepEqual(h.device.mints, [], 'adopted by the push already')
  const synced = await h.sync.sync(session(A))
  assert.equal(synced.how, 'read', 'nothing is merged twice')
  assert.deepEqual(h.wallets.get(A).mints, [NVDA, BONK, WIF, SOL])
  assert.equal(h.wallets.get(A).pending, false)
})

test('two wallets never share a list; the device list is adopted by the first to sign in only', async () => {
  const h = harness({ [A]: [NVDA], [B]: [] })
  h.device.mints = [SOL]
  await h.sync.sync(session(A))
  assert.deepEqual(h.server.listOf(A), [NVDA, SOL])
  await h.sync.sync(session(B))
  assert.deepEqual(h.server.listOf(B), [])
  assert.deepEqual(h.wallets.get(B).mints, [])
  assert.equal(sameList(h.wallets.get(A).mints, h.wallets.get(B).mints), false)
})

test('what does not fit under the limit stays on the device and is named', async () => {
  const full = Array.from({ length: WATCHLIST_LIMIT }, (_, i) =>
    ('A'.repeat(40) + String(i).padStart(3, 'B')).replace(/0/g, 'z'),
  )
  const h = harness({ [A]: full })
  h.device.mints = [WIF]
  const result = await h.sync.sync(session(A))
  assert.equal(result.ok, true)
  assert.deepEqual(result.notKept, [WIF])
  assert.deepEqual(h.device.mints, [WIF])
  assert.equal(h.wallets.get(A).mints.length, WATCHLIST_LIMIT)
})

test('a failed read is reported, not papered over; a failed push keeps the tap pending for the next sync', async () => {
  const h = harness({ [A]: [NVDA] })
  await h.sync.sync(session(A))
  const broken = harness(
    {},
    {
      read: async () => {
        throw new ApiError('UNAVAILABLE', 'The store did not answer.', 503)
      },
    },
  )
  broken.wallets.set(A, h.wallets.get(A))
  const result = await broken.sync.sync(session(A))
  assert.equal(result.ok, false)
  assert.match(result.reason, /did not answer/)
  assert.deepEqual(broken.wallets.get(A).mints, [NVDA], 'the phone keeps what it had')
})
