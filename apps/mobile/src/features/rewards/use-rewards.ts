import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { fetchRewards, type Session } from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { rewardsView, type RewardsView } from './rewards-model'

/**
 * What this wallet has earned — private to its bearer, dropped with it. The
 * server answers in the language asked for, so the sentence about Claim
 * reads in the app's own.
 */
export function useRewards(session: Session | null, locale: Locale) {
  const query = useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'rewards', session?.address ?? '', locale],
    queryFn: ({ signal }) => fetchRewards(session!, locale, signal),
    enabled: session !== null,
    staleTime: 30_000,
    refetchInterval: 120_000,
    retry: 1,
  })
  const view = useMemo((): RewardsView | null => (query.data ? rewardsView(query.data, locale) : null), [query.data, locale])
  return { query, view }
}
