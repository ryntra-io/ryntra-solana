import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { agentApi, type AssistantBriefResponse, type Session } from '@/lib/api'
import type { AssistantBriefUpdate } from '@/lib/api/v1/types'
import type { Locale } from '@/lib/i18n'

const briefsKey = (address: string, locale: Locale) => [PRIVATE_QUERY_KEY, 'assistant-brief', address, locale] as const
const briefKey = (address: string, locale: Locale, day: string | null) =>
  [...briefsKey(address, locale), day ?? 'latest'] as const

/**
 * The wallet's morning brief (1.46.0): «Сьогодні на ринку» for everyone and only what changed in the wallet's own
 * tokens, positions and plans; its settings beside it. `day` is a note's own brief (`?brief=2026-10-18`) — that day's,
 * never today's in its place; null is the newest. Free every day. Private to the bearer.
 */
export function useBrief(session: Session | null, locale: Locale, day: string | null = null, enabled = true) {
  return useQuery({
    queryKey: briefKey(session?.address ?? '', locale, day),
    queryFn: ({ signal }) => agentApi.brief(session!, locale, day, signal),
    enabled: session !== null && enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 1_500,
  })
}

/**
 * The brief's settings written — on or off, its time — with its words in the app's language. The answer carries the
 * settings every read of the brief shares; each read keeps its own day's brief.
 */
export function useSaveBrief(session: Session | null, locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (update: AssistantBriefUpdate) => agentApi.saveBrief(session!, update, locale),
    onSuccess: (saved) => {
      queryClient.setQueriesData<AssistantBriefResponse>(
        { queryKey: briefsKey(session?.address ?? '', locale) },
        (current) =>
          current
            ? { ...current, settings: saved.settings, next: saved.next, channels: saved.channels }
            : current,
      )
    },
  })
}

/** The times a brief may come, as the web offers them: every half hour from 05:00 to 12:00. */
export const BRIEF_TIMES: readonly string[] = Array.from({ length: 15 }, (_, index) => {
  const minutes = 5 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
