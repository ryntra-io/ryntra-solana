import { useQuery, type QueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { assistantApi, type AssistantCredits, type AssistantCreditsResponse, type Session } from '@/lib/api'

/**
 * The assistant's credits as every surface of it reads them (1.52.0): the service's own units (1 000 = 1 USDC), never a
 * token, never paid out. One read under one key — the credits tab, the price beside a paid action, the badge on the
 * way in — and every paid answer that names the credits after it writes them here.
 */
export const creditsKey = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-credits', address] as const

/** The agent's budget, which carries the credits a question is paid in (`budget.credits`). */
const budgetKey = (address: string) => [PRIVATE_QUERY_KEY, 'agent-budget', address] as const

/** The wallet's credits with their history and what is sold — private to the bearer, read when a surface needs them. */
export function useCredits(session: Session | null, enabled = true) {
  return useQuery({
    queryKey: creditsKey(session?.address ?? ''),
    queryFn: ({ signal }) => assistantApi.credits(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * An answer that names the credits after it (a voice, a plan, an order) is the truth now: kept, and the reads that
 * hold an older figure — the history, the question's price — are read again.
 */
export function creditsChanged(queryClient: QueryClient, address: string, credits: AssistantCredits | null | undefined) {
  if (credits) {
    queryClient.setQueryData<AssistantCreditsResponse>(creditsKey(address), (current) =>
      current ? { ...current, credits } : current,
    )
  }
  void queryClient.invalidateQueries({ queryKey: creditsKey(address) })
  void queryClient.invalidateQueries({ queryKey: budgetKey(address) })
}
