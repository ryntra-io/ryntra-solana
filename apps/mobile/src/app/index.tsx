import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback } from 'react'

import { CityScreen } from '@/screens/city'

/**
 * The app's one place: Ryntra City. `at` — the site's path a link named (`/c/<mint>`, from `https://ryntra.io/c/<mint>`)
 * — moves the city there; once read, the word is dropped, so the same link opens it again.
 */
export default function CityRoute() {
  const router = useRouter()
  const { at } = useLocalSearchParams<{ at?: string }>()
  const onAtSeen = useCallback(() => router.setParams({ at: '' }), [router])
  return <CityScreen at={at || null} onAtSeen={onAtSeen} />
}
