import { useQuery } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { plansApi, type Session } from '@/lib/api'

/**
 * The plans' results as the server projects them (1.9.0) — every operation
 * under a plan, the positions, the plans that made no trade and the summary.
 * Private to the bearer, dropped with it.
 */
export function usePlanResults(session: Session | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'plan-results', session?.address ?? ''],
    queryFn: ({ signal }) => plansApi.allResults(session!, signal),
    enabled: session !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

/**
 * The wallet's memory (1.9.0), read on its own: a memory that cannot be read
 * never hides a result that can — its section is simply not drawn.
 */
export function usePlanMemory(session: Session | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'plan-memory', session?.address ?? ''],
    queryFn: ({ signal }) => plansApi.memory(session!, signal),
    enabled: session !== null,
    staleTime: 60_000,
    retry: 1,
  })
}
