import { useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import type { Prepared } from './trade-flow'
import { parseTradeAttempt, type TradeAttempt } from './trade-model'

/**
 * The one attempt per wallet on this device, kept until the server has
 * settled it: a signature that exists is recovered after the app closes,
 * never re-signed. It is not private cache — it is the record that stops a
 * duplicate — so a sign-out leaves it where it is; the wallet that comes
 * back finds its own.
 */
const storage = createMMKV({ id: 'ryntra.trade' })
const listeners = new Set<() => void>()

function key(taker: string): string {
  return `attempt:${taker}`
}

function notify() {
  for (const listener of listeners) listener()
}

export function getAttempt(taker: string): TradeAttempt | null {
  return parseTradeAttempt(storage.getString(key(taker)))
}

export function setAttempt(attempt: TradeAttempt) {
  storage.set(key(attempt.taker), JSON.stringify(attempt))
  notify()
}

export function clearAttempt(taker: string) {
  storage.remove(key(taker))
  notify()
}

export const attemptStore = { get: getAttempt, set: setAttempt, clear: clearAttempt } as const

/* ---- the open Review: exact bytes a person may be reading, kept for their window so a restart shows them again ---- */

function reviewKey(taker: string): string {
  return `review:${taker}`
}

export function saveReview(taker: string, prepared: Prepared) {
  storage.set(reviewKey(taker), JSON.stringify(prepared))
}

export function clearReview(taker: string) {
  storage.remove(reviewKey(taker))
}

/** The Review the app closed on, if its window is still open; anything else is gone. */
export function loadReview(taker: string, now = Date.now()): Prepared | null {
  const stored = storage.getString(reviewKey(taker))
  if (!stored) return null
  try {
    const value = JSON.parse(stored) as Prepared
    const expires = Date.parse(value?.order?.expiresAt ?? '')
    if (!Number.isFinite(expires) || expires <= now || typeof value.order?.order?.transactionBase64 !== 'string') {
      storage.remove(reviewKey(taker))
      return null
    }
    return value
  } catch {
    storage.remove(reviewKey(taker))
    return null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The stored text of a wallet's attempt — the store's snapshot: a string React compares by value, so any write is seen. */
export function storedAttempt(taker: string | null): string | null {
  return taker ? (storage.getString(key(taker)) ?? null) : null
}

/**
 * The wallet's open attempt, live: null when nothing of this wallet is out.
 * The snapshot is the stored text itself, and the attempt is parsed from it:
 * a signature recorded during the session — one whose send could not be
 * confirmed — reaches the screen at once, and its one action is the check.
 * (A snapshot that only counted writes let the compiler keep the first
 * render's read by the wallet alone, so the screen went on offering a new
 * purchase that the store refused.)
 */
export function useAttempt(taker: string | null): TradeAttempt | null {
  const stored = useSyncExternalStore(
    subscribe,
    () => storedAttempt(taker),
    () => null,
  )
  const attempt = parseTradeAttempt(stored ?? undefined)
  return attempt && attempt.state !== 'SETTLED' ? attempt : null
}
