import { createMMKV } from 'react-native-mmkv'

/** Small remembered choices — the last Markets view, the last chart timeframe — never data. */
const storage = createMMKV({ id: 'ryntra.preferences' })

export function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = storage.getString(key)
  return (allowed as readonly string[]).includes(stored ?? '') ? (stored as T) : fallback
}

export function writePreference(key: string, value: string) {
  storage.set(key, value)
}

/** A remembered choice stored as text of its own shape (a layout), read and checked by its owner. */
export function readPreferenceText(key: string): string | null {
  return storage.getString(key) ?? null
}
