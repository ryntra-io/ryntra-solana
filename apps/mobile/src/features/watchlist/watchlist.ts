import { useCallback, useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import {
  DEVICE_SCOPE,
  parseWalletList,
  parseWatchlist,
  scopeFor,
  toggleInWallet,
  toggleMint,
  WATCHLIST_LIMIT,
  type WalletList,
  type WatchlistScope,
  type WatchlistToggle,
} from './watchlist-model'

/**
 * The watchlists on the device: the guest's list under `mints`, and one
 * wallet list per wallet under `wallet:<address>` — the mirror of the
 * server's list with what the phone changed since — for as long as that
 * wallet's session lives. The active scope follows the session (set by the
 * session binder); every screen reads the active list and re-renders when a
 * star is tapped anywhere. A wallet's list is private cache and is dropped
 * when the wallet signs out or is switched.
 */
const storage = createMMKV({ id: 'ryntra.watchlist' })
const DEVICE_KEY = 'mints'

type Snapshot = Readonly<{
  scope: WatchlistScope
  mints: readonly string[]
  syncedAt: string | null
  pending: boolean
}>

let scope: WatchlistScope = DEVICE_SCOPE
let snapshot: Snapshot = read(scope)
const listeners = new Set<() => void>()
/** Called with the wallet's list after a tap while a wallet scope is active — the sync layer pushes it. */
let onWalletChange: ((address: string, list: WalletList) => void) | null = null

function walletOf(target: WatchlistScope): string {
  return target.slice('wallet:'.length)
}

function readWallet(target: WatchlistScope): WalletList | null {
  return parseWalletList(storage.getString(target))
}

function read(target: WatchlistScope): Snapshot {
  if (target === DEVICE_SCOPE) {
    return { scope: target, mints: parseWatchlist(storage.getString(DEVICE_KEY)), syncedAt: null, pending: false }
  }
  const list = readWallet(target)
  return { scope: target, mints: list?.mints ?? [], syncedAt: list?.syncedAt ?? null, pending: list?.pending ?? false }
}

function refresh() {
  snapshot = read(scope)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => snapshot

/* ---- the session binder's side ---- */

/** Point every screen at the wallet's list (a session) or the device's (none). */
export function setWatchlistScope(address: string | null) {
  const next = scopeFor(address)
  if (next === scope) return
  scope = next
  refresh()
}

export function setWalletChangeListener(listener: typeof onWalletChange) {
  onWalletChange = listener
}

export function getDeviceList(): readonly string[] {
  return parseWatchlist(storage.getString(DEVICE_KEY))
}

/** After the merge the device keeps only what did not fit under the limit — usually nothing. */
export function setDeviceList(mints: readonly string[]) {
  storage.set(DEVICE_KEY, JSON.stringify(mints))
  if (scope === DEVICE_SCOPE) refresh()
}

/** The wallet's list as this device holds it, or null before its first sync since sign-in. */
export function getWalletList(address: string): WalletList | null {
  return readWallet(scopeFor(address))
}

export function setWalletList(address: string, list: WalletList) {
  const target = scopeFor(address)
  storage.set(target, JSON.stringify(list))
  if (target === scope) refresh()
}

/** Private cache out: the wallet's list with its version, mark and pending changes. */
export function clearWalletList(address: string) {
  const target = scopeFor(address)
  storage.remove(target)
  if (target === scope) refresh()
}

/* ---- the screens' side ---- */

export function getWatchlist(): readonly string[] {
  return snapshot.mints
}

export function toggleWatchlist(mint: string): WatchlistToggle {
  if (scope === DEVICE_SCOPE) {
    const result = toggleMint(snapshot.mints, mint)
    if (result.mints !== snapshot.mints) setDeviceList(result.mints)
    return result
  }
  const current = readWallet(scope) ?? {
    mints: [],
    removed: [],
    version: null,
    mark: null,
    syncedAt: null,
    pending: false,
  }
  const { list, toggle } = toggleInWallet(current, mint)
  if (list !== current) {
    const address = walletOf(scope)
    setWalletList(address, list)
    onWalletChange?.(address, list)
  }
  return toggle
}

/** The active list, live. `onDevice` says whether it is the guest's list or a wallet's; `pending` that a tap has not reached the server. */
export function useWatchlist() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const has = useCallback((mint: string) => current.mints.includes(mint), [current.mints])
  return {
    mints: current.mints,
    has,
    toggle: toggleWatchlist,
    limit: WATCHLIST_LIMIT,
    onDevice: current.scope === DEVICE_SCOPE,
    syncedAt: current.syncedAt,
    pending: current.pending,
  }
}
