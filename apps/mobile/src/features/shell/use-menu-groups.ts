import { useCallback, useSyncExternalStore } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { groupOpen, parseOpenGroups, type NavGroupId, type OpenGroups } from './menu'

/** Which groups of the menu the person opened or shut — kept on this phone, as the web keeps them in a cookie. */
const storage = createMMKV({ id: 'ryntra.menu-groups' })
const KEY = 'open'

let open: OpenGroups = parseOpenGroups(storage.getString(KEY))
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => open

/** Whether each group is open, and the arrow's press that opens or shuts it — remembered for the next visit. */
export function useMenuGroups() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const isOpen = useCallback((group: NavGroupId) => groupOpen(group, current), [current])
  const toggle = useCallback((group: NavGroupId) => {
    open = { ...open, [group]: !groupOpen(group, open) }
    storage.set(KEY, JSON.stringify(open))
    for (const listener of listeners) listener()
  }, [])
  return { isOpen, toggle }
}
