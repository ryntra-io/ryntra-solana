import { useLocalSearchParams } from 'expo-router'

import { LaunchTokenScreen } from '@/screens/launch/token'

/** `/launch/<mint>` — a launched token's page: its market from the chain, buying and selling, the facts. */
export default function LaunchTokenRoute() {
  const { mint } = useLocalSearchParams<{ mint: string }>()
  return <LaunchTokenScreen mint={typeof mint === 'string' ? mint : ''} />
}
