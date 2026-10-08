import { useCallback, useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { parseHidden, toggleHidden } from './hidden-model'

/** «Сховати на цьому телефоні» — the tokens hidden on this phone, kept on it alone. */
const storage = createMMKV({ id: 'ryntra.launch-hidden' })
const KEY = 'mints'

let list = parseHidden(storage.getString(KEY))
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => list

/** Whether this token is hidden on the phone, and the toggle that hides it or shows it again. */
export function useHiddenLaunch(mint: string) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const toggle = useCallback(() => {
    list = toggleHidden(list, mint)
    storage.set(KEY, JSON.stringify(list))
    for (const listener of listeners) listener()
  }, [mint])
  return { hidden: current.includes(mint), toggle }
}
