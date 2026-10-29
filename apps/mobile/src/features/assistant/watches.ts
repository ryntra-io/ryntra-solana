import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { assistantApi, searchMarkets, type AssistantWatchesResponse, type MarketRow, type Session } from '@/lib/api'
import type { AssistantWatchCreate, AssistantWatchUpdate } from '@/lib/api/v1/types'
import type { Locale } from '@/lib/i18n'

import { readAgainAfter, watchFailureOf } from './watches-model'

const watchesRoot = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-watches', address] as const
export const watchesKey = (address: string, locale: Locale) => [...watchesRoot(address), locale] as const

/**
 * «Стежу» (1.57.0): the wallet's token watches with what each reads now, the presets in the app's language, the free
 * limit and where alerts may go. What a card reads moves every minute, so the read is taken again each minute while
 * the tab is open. Private to the bearer.
 */
export function useWatches(session: Session | null, locale: Locale, enabled = true) {
  return useQuery({
    queryKey: watchesKey(session?.address ?? '', locale),
    queryFn: ({ signal }) => assistantApi.watches(session!, locale, signal),
    enabled: session !== null && enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 1_500,
  })
}

export type WatchWrite =
  | Readonly<{ kind: 'create'; body: AssistantWatchCreate }>
  | Readonly<{ kind: 'update'; id: string; body: AssistantWatchUpdate }>
  | Readonly<{ kind: 'remove'; id: string }>

/**
 * A watch started, paused, resumed, changed or turned off. Every answer is the whole surface again: it becomes the
 * read, and the other language's read is marked old. A refusal that means the list moved meanwhile reads it again.
 */
export function useWatchWrite(session: Session | null, locale: Locale) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  return useMutation({
    mutationFn: (write: WatchWrite): Promise<AssistantWatchesResponse> => {
      if (write.kind === 'create') return assistantApi.createWatch(session!, write.body, locale)
      if (write.kind === 'update') return assistantApi.updateWatch(session!, write.id, write.body, locale)
      return assistantApi.removeWatch(session!, write.id, locale)
    },
    onSuccess: (read) => {
      void queryClient.invalidateQueries({ queryKey: watchesRoot(address), refetchType: 'none' })
      queryClient.setQueryData(watchesKey(address, locale), read)
    },
    onError: (error) => {
      if (readAgainAfter(watchFailureOf(error))) void queryClient.invalidateQueries({ queryKey: watchesRoot(address) })
    },
  })
}

/**
 * The venue's catalogue searched for a watch's token — by symbol, name or address; a token Jupiter marks as
 * suspicious is not offered (the server would refuse it). Public, so outside the private keys.
 */
export function useTokenSearch(query: string) {
  const text = query.trim()
  return useQuery({
    queryKey: ['assistant-token-search', text.toLowerCase()],
    queryFn: async ({ signal }): Promise<readonly MarketRow[]> => {
      const found = await searchMarkets(text, 8, signal)
      return found.rows.filter((row) => !row.suspicious).slice(0, 6)
    },
    enabled: text.length >= 2,
    staleTime: 60_000,
    retry: 0,
  })
}
