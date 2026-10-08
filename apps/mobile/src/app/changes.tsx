import { useRouter } from 'expo-router'

import { useSharedCopy } from '@/lib/i18n'
import { HomeScreen } from '@/screens/home'

/** `/changes` — «Що змінилося», Home one tap deeper: M10's command centre as a screen of its own. */
export default function ChangesRoute() {
  const router = useRouter()
  const shared = useSharedCopy()
  return (
    <HomeScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      backLabel={shared.back}
    />
  )
}
