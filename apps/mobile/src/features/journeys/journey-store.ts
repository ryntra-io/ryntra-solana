import { useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import {
  appendJourney,
  parseJourneys,
  sanitizeJourney,
  serializeJourneys,
  type Journey,
  type JourneyName,
} from './journeys'

/**
 * The device's ring of journeys — on this phone only, readable in the
 * development gallery, cleared there. It is not private cache: it carries
 * no address, no session and no record id (the sanitizer sees to that), so
 * a sign-out leaves it, and the next wallet's steps join the same ring.
 */
const storage = createMMKV({ id: 'ryntra.journeys' })
const KEY = 'ring'
const listeners = new Set<() => void>()
let cached: readonly Journey[] | null = null

function read(): readonly Journey[] {
  if (cached === null) cached = parseJourneys(storage.getString(KEY))
  return cached
}

function write(list: readonly Journey[]) {
  cached = list
  storage.set(KEY, serializeJourneys(list))
  for (const listener of listeners) listener()
}

/** Record one step. A field that is not a word from the closed shape never reaches the store. */
export function recordJourney(name: JourneyName, fields: Omit<Journey, 'at' | 'name'> = {}) {
  const entry = sanitizeJourney({ ...fields, name, at: new Date().toISOString() })
  if (!entry) return
  write(appendJourney(read(), entry))
}

export function readJourneys(): readonly Journey[] {
  return read()
}

export function clearJourneys() {
  write([])
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The ring, live — for the gallery's reader. */
export function useJourneys(): readonly Journey[] {
  return useSyncExternalStore(subscribe, read, read)
}
