import * as Network from 'expo-network'
import { useSyncExternalStore } from 'react'

import { offlineFrom } from './offline-model'

/**
 * Whether the phone has a network, live. The first screen that asks starts
 * the listening; until the phone answers the app counts itself online, so a
 * screen never says «no network» on a guess.
 */
let offline = false
let listening = false
let pending: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

/** A handover between Wi-Fi and mobile data drops the network for a moment; only a loss that lasts is said. */
const OFFLINE_AFTER_MS = 2000

function apply(next: boolean) {
  if (next === offline) return
  offline = next
  for (const listener of listeners) listener()
}

function set(next: boolean) {
  if (pending) clearTimeout(pending)
  pending = null
  if (!next) apply(false)
  else
    pending = setTimeout(() => {
      pending = null
      apply(true)
    }, OFFLINE_AFTER_MS)
}

function listen() {
  if (listening) return
  listening = true
  Network.addNetworkStateListener((state) => set(offlineFrom(state)))
  Network.getNetworkStateAsync()
    .then((state) => set(offlineFrom(state)))
    .catch(() => undefined)
}

function subscribe(listener: () => void): () => void {
  listen()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isOffline(): boolean {
  return offline
}

/** True while the phone has no network. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, isOffline)
}
