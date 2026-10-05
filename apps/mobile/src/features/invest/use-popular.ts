import { useQuery } from '@tanstack/react-query'

import { fetchPopularCompanies } from '@/lib/api'
import { POPULAR_DEFAULT_LIMIT } from '@/lib/api/v1/types'

/**
 * «Популярні компанії» as the server lists them (contract 1.20.0) — the one
 * list and order the web's Home draws, so the phone shows the same companies
 * in the same place. One read for Home and «Автоінвест»'s picker: the server's
 * own count when not asked (12, the web Home's list); Home draws its first
 * eight. Read again every two minutes while a screen shows it; the last answer
 * is kept on the device with its time (`offline-model`), never shown as fresh.
 */
export const POPULAR_QUERY_KEY = ['stocks', 'popular', POPULAR_DEFAULT_LIMIT] as const

export function usePopularCompanies() {
  return useQuery({
    queryKey: POPULAR_QUERY_KEY,
    queryFn: ({ signal }) => fetchPopularCompanies({ limit: POPULAR_DEFAULT_LIMIT }, signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
}
