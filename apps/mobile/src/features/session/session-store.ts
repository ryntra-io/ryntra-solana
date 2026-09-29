import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

import { useNow } from '@/hooks/use-now'
import type { Session } from '@/lib/api'

import { parseStoredSession, sessionAlive } from './session-model'

/**
 * The session lives in the device's secure store (Android Keystore-backed),
 * one entry, read once at start and mirrored in memory for the screens. The
 * token never appears in a log, a screen or a route param; the API client
 * reads it from here and nowhere else.
 */
const KEY = 'ryntra.session'

let current: Session | null = null
let ready = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => current
const readySnapshot = () => ready

/** Read the stored session once at start; an expired or malformed entry is dropped. */
export async function loadSession(): Promise<Session | null> {
  try {
    const stored = await SecureStore.getItemAsync(KEY)
    current = parseStoredSession(stored, Date.now())
    if (stored && !current) await SecureStore.deleteItemAsync(KEY)
  } catch {
    current = null
  } finally {
    ready = true
    notify()
  }
  return current
}

export function getSession(): Session | null {
  return sessionAlive(current, Date.now()) ? current : null
}

export async function saveSession(session: Session): Promise<void> {
  current = session
  notify()
  await SecureStore.setItemAsync(KEY, JSON.stringify(session))
}

export async function clearSession(): Promise<void> {
  current = null
  notify()
  try {
    await SecureStore.deleteItemAsync(KEY)
  } catch {
    // Nothing to delete, or the store refused: the memory copy is gone either way.
  }
}

/** The live session for the screens: null before the store is read and when there is none. */
export function useSession(): { session: Session | null; ready: boolean } {
  const session = useSyncExternalStore(subscribe, snapshot, snapshot)
  const isReady = useSyncExternalStore(subscribe, readySnapshot, readySnapshot)
  const now = useNow(30_000)
  return { session: sessionAlive(session, now) ? session : null, ready: isReady }
}
