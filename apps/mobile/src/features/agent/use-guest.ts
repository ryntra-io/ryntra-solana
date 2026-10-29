import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'

import { agentApi, type AgentContext, type AgentGuestResponse } from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { EMPTY_GUEST_THREAD, guestContextOf, laterMeter, withGuestExchange, type GuestMeter, type GuestThread } from './agent-model'
import { contextKey } from './context'

/**
 * The guest's conversation lives on this phone only, as the web keeps it in the page: the server stores nothing but
 * the day's meter. Kept while the app runs (leaving the screen and coming back keeps it); «Нова розмова» empties it.
 */
const guestKey = (context: string) => ['agent-guest', context] as const
const guestAskKey = (context: string) => ['agent-guest-ask', context] as const
/** The guest's day on the server is one meter, not one per context. */
const guestMeterKey = ['agent-guest-meter'] as const

/** The guest's meter as the latest guest answer in any context carried it. */
export function useGuestMeter() {
  return useQuery<GuestMeter>({
    queryKey: guestMeterKey,
    queryFn: () => ({ day: null, model: null }),
    // Held on the phone, never read from anywhere: no refetch (the network's return refetches active queries) empties it.
    staleTime: 'static',
    gcTime: 24 * 60 * 60_000,
  })
}

export function useGuestThread(context: AgentContext | null) {
  return useQuery<GuestThread>({
    queryKey: guestKey(contextKey(context)),
    queryFn: () => EMPTY_GUEST_THREAD,
    staleTime: 'static',
    gcTime: 60 * 60_000,
  })
}

/**
 * A market question without a wallet (`POST /api/v1/assistant/guest`): an asset or a page as its context, never
 * someone's own. A question about one's own portfolio is answered with the way to connect a wallet — by the server.
 */
export function useGuestAsk(context: AgentContext | null, locale: Locale) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  return useMutation({
    mutationKey: guestAskKey(key),
    mutationFn: (text: string): Promise<AgentGuestResponse> =>
      agentApi.guest({ text, locale, context: guestContextOf(context) }),
    onSuccess: (answered) => {
      queryClient.setQueryData<GuestThread>(guestKey(key), (current) =>
        withGuestExchange(current ?? EMPTY_GUEST_THREAD, answered),
      )
      queryClient.setQueryData<GuestMeter>(guestMeterKey, (current) => laterMeter(current, answered))
    },
  })
}

/** The guest's question in flight for this context, even after the screen was left and came back — or null. */
export function usePendingGuestQuestion(context: AgentContext | null): string | null {
  const pending = useMutationState<string | undefined>({
    filters: { mutationKey: guestAskKey(contextKey(context)), status: 'pending' },
    select: (mutation) => mutation.state.variables as string | undefined,
  })
  return pending[pending.length - 1] ?? null
}

/** «Нова розмова» for a guest: the thread on this phone emptied; the meter stays as it was read. */
export function useClearGuest(context: AgentContext | null) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  return () =>
    queryClient.setQueryData<GuestThread>(guestKey(key), (current) => ({
      ...(current ?? EMPTY_GUEST_THREAD),
      turns: [],
    }))
}
