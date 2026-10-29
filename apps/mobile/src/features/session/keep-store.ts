import { useSyncExternalStore } from 'react'

import { readPreferenceText, writePreference } from '@/lib/preferences'

import {
  afterFailedConnect,
  keepChoice,
  parseKeepChoice,
  rechoose,
  serializeKeepChoice,
  type KeepChoice,
  type KeepFor,
} from './keep-connected'

/**
 * The phone's «Тримати під’єднаним»: one remembered choice of the device and
 * when its time started. A preference, not private data — a sign-out keeps it,
 * so the next wallet connected here is kept the same way.
 */
const KEY = 'session.keep.v1'

const listeners = new Set<() => void>()
let current: KeepChoice | null = null

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readKeep(): KeepChoice {
  if (!current) current = parseKeepChoice(readPreferenceText(KEY), Date.now())
  return current
}

function write(choice: KeepChoice) {
  current = choice
  writePreference(KEY, serializeKeepChoice(choice))
  notify()
}

/** The person picks how long: another choice starts its time now; the one already chosen changes nothing. */
export function chooseKeep(keep: KeepFor) {
  const now = readKeep()
  const next = rechoose(now, keep, Date.now())
  if (next !== now) write(next)
}

/**
 * A connect: the same choice, its time started again from this moment — set
 * before the account arrives, so the old end never meets a fresh connect.
 * Returns the undo for a connect that does not happen (cancelled or failed):
 * it puts the choice before it back.
 */
export function startKeepClock(): () => void {
  const previous = readKeep()
  const started = keepChoice(previous.keep, Date.now())
  write(started)
  return () => {
    const now = readKeep()
    const back = afterFailedConnect(now, started, previous)
    if (back !== now) write(back)
  }
}

export function useKeep(): KeepChoice {
  return useSyncExternalStore(subscribe, readKeep, readKeep)
}
