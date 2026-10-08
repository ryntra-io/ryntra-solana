import { useLocalSearchParams, useRouter } from 'expo-router'

import { parseContextParam } from '@/features/agent/context'
import { RynScreen } from '@/screens/agent'

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/**
 * `/ryn?context=` — Ryntra opened from an asset, a plan, Portfolio or a note,
 * with the way back to where the person came from. A context that is not
 * one is no context: the conversation is then the general one.
 */
export default function RynRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ context?: string | string[]; q?: string | string[] }>()
  const context = parseContextParam(first(params.context))
  const q = first(params.q)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  return <RynScreen context={context} onBack={back} question={q ? q.slice(0, 2000) : null} />
}
