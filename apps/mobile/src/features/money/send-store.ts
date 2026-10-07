import { useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { parsePendingSend, type PendingSend } from './money-model'

/**
 * The one fact a closed app must not destroy: a transfer is already signed.
 * Written the moment the signature is known — before the settle is asked —
 * and forgotten only on an answer that cannot change. One record per wallet:
 * a signature belongs to whoever signed it. Not private cache, so a sign-out
 * leaves it where it is (the same rule as Trade's attempt).
 */
const storage = createMMKV({ id: 'ryntra.money' })
const listeners = new Set<() => void>()

function key(wallet: string): string {
  return `send-pending:${wallet}`
}

function notify() {
  for (const listener of listeners) listener()
}

export function rememberPendingSend(pending: PendingSend) {
  storage.set(key(pending.wallet), JSON.stringify(pending))
  notify()
}

export function readPendingSend(wallet: string): PendingSend | null {
  return parsePendingSend(storage.getString(key(wallet)))
}

export function forgetPendingSend(wallet: string) {
  storage.remove(key(wallet))
  notify()
}

export const pendingSendStore = { get: readPendingSend, set: rememberPendingSend, clear: forgetPendingSend } as const

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The wallet's signed transfer with no outcome yet, live — parsed from the stored text, so any write reaches the screen. */
export function usePendingSend(wallet: string | null): PendingSend | null {
  const stored = useSyncExternalStore(
    subscribe,
    () => (wallet ? (storage.getString(key(wallet)) ?? null) : null),
    () => null,
  )
  return parsePendingSend(stored)
}
