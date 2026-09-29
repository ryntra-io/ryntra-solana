import { useRouter } from 'expo-router'

import { MarketsScreen } from '@/screens/markets'

/**
 * `/lists?tab=watchlist|stock|crypto|meme` — M2's four lists with their sorts,
 * «Акції» and «Тренди» of Markets' «Для досвідчених» (canon v5.3 В28): a stack
 * screen over Markets, back to where it was opened from.
 */
export default function ListsRoute() {
  const router = useRouter()
  return <MarketsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/markets'))} />
}
