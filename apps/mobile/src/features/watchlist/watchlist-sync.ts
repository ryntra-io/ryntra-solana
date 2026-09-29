/**
 * Keeping a wallet's watchlist the same on the phone and on the web. The
 * server is the truth for a signed-in wallet. The first sync after a sign-in
 * is the contract's one merge: the device (guest) list goes to the server
 * with no mark, the server answers the union in its own order, the phone
 * keeps that answer as the wallet's list and the device list is emptied
 * (what did not fit under the limit stays on the device and the screen says
 * so). Afterwards a tap on the phone is pushed as the full list naming the
 * version it read, one write after another; a write the server refuses
 * because another device wrote first — or a list that never read a version —
 * is answered by a merge that carries the phone's removals and its mark, so
 * a mint removed on the web stays removed, a mint removed on the phone does
 * not come back, and nothing is ever overwritten blind. A return to the
 * foreground re-reads the server's list — or merges, when a change made
 * offline is still waiting. Every exchange with the server runs one after
 * another, never two at once.
 */

import { ApiError, type Session } from '../../lib/api.ts'

import {
  cleanMints,
  walletListAfterWrite,
  walletListFromServer,
  type ServerList,
  type WalletList,
} from './watchlist-model.ts'

type ListAnswer = Readonly<{ mints: readonly string[]; version: number; updatedAt: string | null }>
type MergeAnswer = Readonly<{
  mints: readonly string[]
  notKept: readonly string[]
  droppedByServer: readonly string[]
  version: number
  syncedAt: string
}>

export type WatchlistSyncDeps = Readonly<{
  read: (session: Session) => Promise<ListAnswer>
  write: (session: Session, mints: readonly string[], ifVersion: number | null) => Promise<ListAnswer>
  merge: (
    session: Session,
    input: Readonly<{ mints: readonly string[]; removed: readonly string[]; syncedAt: string | null }>,
  ) => Promise<MergeAnswer>
  device: Readonly<{ get: () => readonly string[]; set: (mints: readonly string[]) => void }>
  wallet: Readonly<{ get: (address: string) => WalletList | null; set: (address: string, list: WalletList) => void }>
  now?: () => string
}>

export type WatchlistSyncResult =
  | Readonly<{
      ok: true
      how: 'adopted' | 'merged' | 'read'
      /** Device mints that became the wallet's on this sync. */
      adopted: number
      /** Mints that did not fit under the limit; they stay on the device. */
      notKept: readonly string[]
      /** Phone additions the server had removed on the web after the phone's mark — not re-added. */
      droppedByServer: readonly string[]
      mints: readonly string[]
    }>
  | Readonly<{ ok: false; reason: string }>

export function createWatchlistSync(deps: WatchlistSyncDeps) {
  const now = deps.now ?? (() => new Date().toISOString())
  let queue: Promise<unknown> = Promise.resolve()

  /** One exchange after another: a sync and a push never run at the same time. */
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }

  /**
   * The server's answer onto the wallet's list, unless a tap changed the
   * phone's list while the server was answering (`basis` is the phone's list
   * when the exchange started) — then the phone keeps its own list and takes
   * the version and the mark; that tap is already queued behind this one.
   */
  function settle(address: string, basis: readonly string[], answer: ServerList) {
    const latest = deps.wallet.get(address)
    deps.wallet.set(
      address,
      latest ? walletListAfterWrite(latest, basis, answer, now()) : walletListFromServer(answer, now()),
    )
  }

  function ofList(answer: ListAnswer): ServerList {
    return { mints: answer.mints, version: answer.version, mark: answer.updatedAt }
  }

  function ofMerge(answer: MergeAnswer): ServerList {
    return { mints: answer.mints, version: answer.version, mark: answer.syncedAt }
  }

  /**
   * The one merge after sign-in: the device (guest) list — and any tap made
   * before the first answer — is a genuine local list, nothing in it is
   * stale; the server's order comes first. The device list is emptied;
   * what did not fit under the limit stays there.
   */
  async function adopt(session: Session, current: WalletList | null): Promise<WatchlistSyncResult> {
    const address = session.address
    const device = deps.device.get()
    const local = current?.mints ?? []
    const answer = await deps.merge(session, {
      mints: cleanMints([...device, ...local]),
      removed: current?.removed ?? [],
      syncedAt: null,
    })
    settle(address, local, ofMerge(answer))
    deps.device.set(answer.notKept.filter((mint) => device.includes(mint)))
    return {
      ok: true,
      how: 'adopted',
      adopted: device.filter((mint) => answer.mints.includes(mint)).length,
      notKept: answer.notKept,
      droppedByServer: answer.droppedByServer,
      mints: answer.mints,
    }
  }

  /**
   * The phone's list to the server after a tap: what the phone holds when
   * the turn comes (taps in a burst travel as one write), as a plain write
   * naming the version read; a merge when there is no version to name or
   * the write was refused as stale. A tap an earlier write already carried
   * costs nothing.
   */
  function push(session: Session): Promise<boolean> {
    return enqueue(async () => {
      const list = deps.wallet.get(session.address)
      if (!list || !list.pending) return true
      if (list.version === null) {
        await adopt(session, list)
        return true
      }
      try {
        const answer = await deps.write(session, list.mints, list.version)
        settle(session.address, list.mints, ofList(answer))
        return true
      } catch (error) {
        // Another device wrote first: read again and merge, as the contract says. Anything else waits for the next sync.
        if (!(error instanceof ApiError && error.code === 'VALIDATION_ERROR')) throw error
      }
      const answer = await deps.merge(session, { mints: list.mints, removed: list.removed, syncedAt: list.mark })
      settle(session.address, list.mints, ofMerge(answer))
      return true
    }).catch(() => false)
  }

  function sync(session: Session): Promise<WatchlistSyncResult> {
    const address = session.address
    return enqueue(async (): Promise<WatchlistSyncResult> => {
      try {
        const current = deps.wallet.get(address)
        if (!current || current.version === null) return await adopt(session, current)
        if (current.pending) {
          const answer = await deps.merge(session, {
            mints: current.mints,
            removed: current.removed,
            syncedAt: current.mark,
          })
          settle(address, current.mints, ofMerge(answer))
          return {
            ok: true,
            how: 'merged',
            adopted: 0,
            notKept: answer.notKept,
            droppedByServer: answer.droppedByServer,
            mints: answer.mints,
          }
        }
        const answer = await deps.read(session)
        settle(address, current.mints, ofList(answer))
        return { ok: true, how: 'read', adopted: 0, notKept: [], droppedByServer: [], mints: answer.mints }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'The watchlist did not sync.' }
      }
    })
  }

  return { push, sync }
}

export type WatchlistSync = ReturnType<typeof createWatchlistSync>
