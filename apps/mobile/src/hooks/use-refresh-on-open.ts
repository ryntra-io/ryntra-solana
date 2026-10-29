import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { readsToRefresh, type QuietRead } from '@/features/markets/refresh'

/** Asks again, quietly, the reads of `current` whose answer is past its fresh time. */
function refreshOld(current: { current: readonly QuietRead[] }) {
  for (const read of readsToRefresh(current.current, Date.now())) void read.refetch()
}

/** Calls `refresh` now and whenever the app comes back to the front, until the returned cleanup. */
function refreshNowAndOnReturn(refresh: () => void) {
  refresh()
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') refresh()
  })
  return () => subscription.remove()
}

/** The latest reads, kept for the listeners without making them depend on every render. */
function useLatest(reads: readonly QuietRead[]) {
  const current = useRef(reads)
  useEffect(() => {
    current.current = reads
  })
  return current
}

/**
 * Reads a screen's price lists again, quietly, when the screen opens: the tab come back to and the app brought back
 * to the front. Between opens each list asks every 60 s by itself (`refetchInterval`); nothing is drawn while it asks.
 */
export function useRefreshOnOpen(reads: readonly QuietRead[]) {
  const current = useLatest(reads)
  useFocusEffect(useCallback(() => refreshNowAndOnReturn(() => refreshOld(current)), [current]))
}

/** The same for a sheet over a screen: when it is shown, and when the app comes back while it is shown (ST-7). */
export function useRefreshWhenShown(shown: boolean, reads: readonly QuietRead[]) {
  const current = useLatest(reads)
  useEffect(() => (shown ? refreshNowAndOnReturn(() => refreshOld(current)) : undefined), [shown, current])
}
