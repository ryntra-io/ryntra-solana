import { useQueryClient } from '@tanstack/react-query'
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
import { mergeWatchlist, readWatchlist, writeWatchlist, type Session } from '@/lib/api'

import { sessionApi } from './session-api'
import { checkSession } from './session-client'
import { clearSession, loadSession, saveSession, useSession } from './session-store'
import { PRIVATE_QUERY_KEY } from './use-account'

/** A foreground return re-checks the session and re-reads the wallet's list no more often than this. */
const RESYNC_AFTER_MS = 60_000

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
    const run = async () => {
      const last = lastRun.current
      if (last && last.address === session.address && Date.now() - last.at < RESYNC_AFTER_MS) return
      lastRun.current = { address: session.address, at: Date.now() }
      const check = await checkSession({
        session,
        api: sessionApi,
        save: saveSession,
        clear: async () => {
          await clearSession()
          clearWalletList(session.address)
          // The bearer is dead, so the device cannot be revoked on the server; the phone forgets it and re-registers on the next sign-in.
          clearDeviceRecord(session.address)
          queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_KEY] })
        },
      })
      if (check.session) void sync.sync(check.session)
    }
    void run()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run()
    })
    return () => subscription.remove()
  }, [session, queryClient])

  return null
}
