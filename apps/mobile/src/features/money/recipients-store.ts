import { useMemo, useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { addRecent, parseRecents, type RecentRecipient } from './recipients'

/** The phone's «Нещодавні», per wallet — a convenience on this device, never sent anywhere. */
const storage = createMMKV({ id: 'ryntra.money.recents' })
const listeners = new Set<() => void>()

const key = (wallet: string) => `recents:${wallet}`

export function rememberRecipient(wallet: string, address: string, at: string) {
  storage.set(key(wallet), JSON.stringify(addRecent(parseRecents(storage.getString(key(wallet))), address, at)))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The wallet's recent recipients, live. */
export function useRecentRecipients(wallet: string | null): readonly RecentRecipient[] {
  const stored = useSyncExternalStore(
    subscribe,
    () => (wallet ? (storage.getString(key(wallet)) ?? null) : null),
    () => null,
  )
  return useMemo(() => parseRecents(stored), [stored])
}
