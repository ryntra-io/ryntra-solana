import { useSyncExternalStore } from 'react'

import { readPreference, writePreference } from '@/lib/preferences'

import { DEFAULT_DENSITY, DENSITIES, SPACE, type Density, type Space } from './density'

const STORAGE_KEY = 'look.density'

const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDensity(): Density {
  return readPreference<Density>(STORAGE_KEY, DENSITIES, DEFAULT_DENSITY)
}

/** The choice persists on the device; every surface that reads it redraws at once. */
export function setDensity(density: Density) {
  writePreference(STORAGE_KEY, density)
  listeners.forEach((listener) => listener())
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, getDensity, getDensity)
}

/** The spacing of the chosen density. */
export function useSpace(): Space {
  return SPACE[useDensity()]
}
