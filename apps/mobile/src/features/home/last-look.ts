import { useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { scopeFor } from '@/features/watchlist/watchlist-model'
import { readPreference, writePreference } from '@/lib/preferences'

import { lastLookOf, parseLastLook, serializeLastLook, type LastLook } from './home-model'

/**
 * The device's own memory of Home: when the person last left it and what
 * the watchlist's prices were then, one snapshot per watchlist scope (the
 * device's list for a guest, the wallet's list otherwise). Public figures
 * and a clock reading — not private cache, so a sign-out leaves it; the
 * wallet that comes back finds its own. Whether Home hides its amounts is a
 * preference of the device, like the theme.
 */
const storage = createMMKV({ id: 'ryntra.home' })
const listeners = new Set<() => void>()

function key(address: string | null): string {
  return `look:${scopeFor(address)}`
}

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The parsed snapshot per key, kept while its bytes are unchanged, so a read during render is stable.
const parsed = new Map<string, { raw: string | undefined; look: LastLook | null }>()

/** The snapshot left on the previous visit, or null when the person never left Home on this scope. */
export function readLastLook(address: string | null): LastLook | null {
  const at = key(address)
  const raw = storage.getString(at)
  const cached = parsed.get(at)
  if (cached && cached.raw === raw) return cached.look
  const look = parseLastLook(raw)
  parsed.set(at, { raw, look })
  return look
}

/** Leaving Home: what the rows showed, with the device's clock. The screens that read the look are told. */
export function writeLastLook(
  address: string | null,
  rows: readonly Readonly<{ mint: string; price: number | null }>[],
  now = Date.now(),
) {
  storage.set(key(address), serializeLastLook(lastLookOf(new Date(now).toISOString(), rows)))
  notify()
}

/** The last look for the scope, live: a new snapshot written on leaving Home re-renders what compares against it. */
export function useLastLook(address: string | null): LastLook | null {
  const read = () => readLastLook(address)
  return useSyncExternalStore(subscribe, read, read)
}

/* ---- the amounts ---- */

const AMOUNTS_KEY = 'home.amounts'
const AMOUNTS = ['shown', 'hidden'] as const
type Amounts = (typeof AMOUNTS)[number]

export function amountsHidden(): boolean {
  return readPreference<Amounts>(AMOUNTS_KEY, AMOUNTS, 'shown') === 'hidden'
}

export function setAmountsHidden(hidden: boolean) {
  writePreference(AMOUNTS_KEY, hidden ? 'hidden' : 'shown')
  notify()
}

/** Whether Home's money figures are hidden, live. */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, amountsHidden, amountsHidden)
}
