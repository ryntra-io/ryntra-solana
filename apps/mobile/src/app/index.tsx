import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'

import { CityScreen } from '@/screens/city'

/** How often the route looks again for the navigator before it drops the link's word, and how many times at most. */
const READY_WAIT_MS = 50
const READY_TRIES = 200

/**
 * The app's one place: Ryntra City. `at` — the site's address a link named (`/c/<mint>` from `https://ryntra.io/c/<mint>`,
 * `/?open=agent`, `/?early=<mint>`) — moves the city there; once read, the word is dropped, so the same link opens it
 * again.
 *
 * A link that opens the app cold is read before the navigator has mounted, and navigating then throws — the app closed
 * on the link (CITY-235). The word is dropped once the navigator is ready; the city has already opened on the link.
 */
export default function CityRoute() {
  const router = useRouter()
  const navigation = useNavigationContainerRef()
  const { at } = useLocalSearchParams<{ at?: string }>()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const onAtSeen = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const drop = (left: number) => {
      timer.current = null
      try {
        if (navigation.isReady()) {
          router.setParams({ at: '' })
          return
        }
      } catch {
        // Not ready after all: looked at again below.
      }
      if (left > 0) timer.current = setTimeout(() => drop(left - 1), READY_WAIT_MS)
    }
    drop(READY_TRIES)
  }, [navigation, router])
  return <CityScreen at={at || null} onAtSeen={onAtSeen} />
}
