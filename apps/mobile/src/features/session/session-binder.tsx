import { useQueryClient } from '@tanstack/react-query'
import * as Network from 'expo-network'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import {
  clearWalletList,
  getDeviceList,
  getWalletList,
  setDeviceList,
  setWalletChangeListener,
  setWalletList,
  setWatchlistScope,
} from '@/features/watchlist/watchlist'
import { clearDeviceRecord } from '@/features/notifications/device-store'
import { createWatchlistSync } from '@/features/watchlist/watchlist-sync'
import { walletQuietAt } from '@/features/wallet/wallet-away'
import { mergeWatchlist, readWatchlist, writeWatchlist, type Session } from '@/lib/api'
import { forgetBearers } from '@/lib/session-bearer'

import { keepEnded, keepUntil, timerDelay } from './keep-connected'
import { readKeep, useKeep } from './keep-store'
import { sessionApi } from './session-api'
import { checkSession, nextRefreshAt } from './session-client'
import { clearSession, loadSession, saveSession, useSession } from './session-store'
import { PRIVATE_QUERY_KEY } from './use-account'

/** A foreground return re-checks the session and re-reads the wallet's list no more often than this. */
const RESYNC_AFTER_MS = 60_000

/**
 * Whether the phone has a network at all; unknown counts as yes, the request
 * itself decides. Not Android's «validated» reachability — false on working
 * VPNs and private DNS, it would hold every refresh back.
 */
async function online(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync()
    return state.isConnected !== false
  } catch {
    return true
  }
}

const sync = createWatchlistSync({
  read: (session) => readWatchlist(session),
  write: (session, mints, ifVersion) => writeWatchlist(session, { mints, ifVersion }),
  merge: (session, input) => mergeWatchlist(session, input),
  device: { get: getDeviceList, set: setDeviceList },
  wallet: { get: getWalletList, set: setWalletList },
})

/**
 * Binds the session to what depends on it: the store is read once at start
 * and the server asked whether the session still stands (a session revoked
 * or expired there is dropped here with the wallet's private caches; one
 * near its end is refreshed); the watchlist scope follows the session's
 * wallet; a tap while signed in is pushed; a session start or a return to
 * the foreground re-checks and re-reads the wallet's list.
 */
export function SessionBinder() {
  const { session } = useSession()
  // A change of «Тримати під’єднаним» sets the refresh timer again for the new end.
  const keep = useKeep()
  const queryClient = useQueryClient()
  const address = session?.address ?? null
  const lastRun = useRef<{ address: string; at: number } | null>(null)
  const current = useRef<Session | null>(null)

  useEffect(() => {
    current.current = session
  }, [session])

  useEffect(() => {
    void loadSession()
  }, [])

  useEffect(() => {
    setWatchlistScope(address)
    setWalletChangeListener(
      address
        ? (changedAddress) => {
            const live = current.current
            if (live && live.address === changedAddress) void sync.push(live)
          }
        : null,
    )
  }, [address])

  useEffect(() => {
    if (!session) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    const stopTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    // While the app stays open, the check runs again when the session becomes due for a refresh (ST-2):
    // a session is never left to run out on an open screen. A refresh already due — one the network
    // failed, one that waited for the wallet — is tried again no sooner than the foreground's own pace.
    const schedule = (held: Session | null) => {
      stopTimer()
      if (disposed || AppState.currentState !== 'active') return
      const now = Date.now()
      const at = nextRefreshAt(held, now, keepUntil(readKeep()))
      if (at === null) return
      timer = setTimeout(() => void run(), timerDelay(Math.max(at, now + RESYNC_AFTER_MS, walletQuietAt(now)), now))
    }
    const run = async () => {
      const last = lastRun.current
      if (last && last.address === session.address && Date.now() - last.at < RESYNC_AFTER_MS) {
        schedule(current.current)
        return
      }
      const keep = readKeep()
      // The chosen time ran out: the keep binder ends the session and the wallet; nothing is refreshed past it.
      if (keepEnded(keep, Date.now())) return
      lastRun.current = { address: session.address, at: Date.now() }
      // A refresh replaces the bearer: never while a wallet request is out or just back, never without a network.
      const quiet = walletQuietAt(Date.now()) <= Date.now()
      const check = await checkSession({
        session,
        api: sessionApi,
        save: saveSession,
        keepUntil: keepUntil(keep),
        mayRefresh: quiet && (await online()),
        clear: async () => {
          await clearSession()
          clearWalletList(session.address)
          forgetBearers(session.address)
          // The bearer is dead, so the device cannot be revoked on the server; the phone forgets it and re-registers on the next sign-in.
          clearDeviceRecord(session.address)
          queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_KEY] })
        },
      })
      // A private read that failed on the replaced bearer in the same moment is read again with the new one.
      if (check.status === 'refreshed') {
        void queryClient.invalidateQueries({
          queryKey: [PRIVATE_QUERY_KEY],
          predicate: (query) => query.state.status === 'error',
        })
      }
      if (check.session) void sync.sync(check.session)
      schedule(check.session)
    }
    void run()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run()
      else stopTimer()
    })
    return () => {
      disposed = true
      stopTimer()
      subscription.remove()
    }
  }, [session, queryClient, keep])

  return null
}
