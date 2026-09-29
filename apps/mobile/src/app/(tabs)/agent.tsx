import { useLocalSearchParams } from 'expo-router'

import { RynScreen } from '@/screens/agent'

/** The Agent tab — Ryntra with no context: anything Ryntra reads. `?q=` fills the composer; the person sends it. */
export default function AgentTab() {
  const params = useLocalSearchParams<{ q?: string | string[] }>()
  const q = Array.isArray(params.q) ? params.q[0] : params.q
  return <RynScreen context={null} question={q ? q.slice(0, 2000) : null} />
}
