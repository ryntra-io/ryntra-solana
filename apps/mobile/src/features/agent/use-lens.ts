import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { creditsChanged } from '@/features/assistant/use-credits'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { agentApi, type AgentCriticResponse, type Session } from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { contextParam } from './context'
import { briefRequest, criticRequest, type CriticOffer, type LensSubject } from './lens-model'

export { lensPath, lensSubjectOf } from './lens-model'

/** The brief of one subject, for one wallet and language — private to the bearer and dropped with it. */
const briefKey = (address: string, subject: LensSubject, locale: Locale) =>
  [PRIVATE_QUERY_KEY, 'lens-brief', address, contextParam(subject), locale] as const

/** The wallet's budget as every surface of the assistant reads it (`useAgentBudget`): one key, the latest read wins. */
const budgetKey = (address: string) => [PRIVATE_QUERY_KEY, 'agent-budget', address] as const

/**
 * «Стисло» on a subject, read as soon as the screen opens: composed from the reads (`compose: "deterministic"`), so it
 * never reaches a model and never spends a credit. The budget it carries is kept for the critic's price.
 */
export function useLensBrief(session: Session | null, subject: LensSubject, locale: Locale) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: briefKey(session?.address ?? '', subject, locale),
    queryFn: async ({ signal }) => {
      const read = await agentApi.lensBrief(session!, briefRequest(subject, locale), signal)
      queryClient.setQueryData(budgetKey(session!.address), read.budget)
      return read
    },
    enabled: session !== null,
    staleTime: 2 * 60_000,
    retry: 1,
  })
}

/**
 * «Оскаржити це» — the critic on an explicit press, with the model asked for and `acceptCredits` exactly the price the
 * button showed (none where credits are not served or cannot pay it). After it the credits and the budget are read
 * again, whatever the answer took.
 */
export function useLensCritic(session: Session | null, subject: LensSubject, locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation<AgentCriticResponse, unknown, CriticOffer>({
    mutationFn: (offer) => agentApi.lensCritic(session!, criticRequest(subject, locale, offer)),
    onSuccess: (answer) => {
      if (session) queryClient.setQueryData(budgetKey(session.address), answer.budget)
    },
    onSettled: () => {
      if (session) creditsChanged(queryClient, session.address, null)
    },
  })
}
