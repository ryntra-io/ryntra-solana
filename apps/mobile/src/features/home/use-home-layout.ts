import { useSyncExternalStore } from 'react'

import { readPreferenceText, writePreference } from '@/lib/preferences'

import { parseLayout, serializeLayout, type HomeLayout } from './home-blocks'

const STORAGE_KEY = 'home.blocks'

const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// One parsed layout per stored text, so every read between two writes hands back the same object.
let cached: Readonly<{ raw: string | null; layout: HomeLayout }> | null = null
function read(): HomeLayout {
  const raw = readPreferenceText(STORAGE_KEY)
  if (cached && cached.raw === raw) return cached.layout
  cached = { raw, layout: parseLayout(raw) }
  return cached.layout
}

/** The person's arrangement of Home's blocks, kept on the device; Home and Settings redraw on every change. */
export function setHomeLayout(layout: HomeLayout) {
  writePreference(STORAGE_KEY, serializeLayout(layout))
  listeners.forEach((listener) => listener())
}

export function useHomeLayout(): HomeLayout {
  return useSyncExternalStore(subscribe, read, read)
}
