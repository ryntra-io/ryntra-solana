import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  agentApi,
  isNotFound,
  type AgentContext,
  type AgentMessageResponse,
  type AgentSessionResponse,
  type Session,
} from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { agentFailureOf, exchangeLanded, withExchange } from './agent-model'
import { contextKey } from './context'

const conversationKey = (address: string, context: string, locale: Locale) =>
  [PRIVATE_QUERY_KEY, 'agent', address, context, locale] as const

const askKey = (address: string, context: string) => ['agent-ask', address, context] as const

/** The budget is the wallet's, not a conversation's: one figure every conversation reads and every answer updates. */
const budgetKey = (address: string) => [PRIVATE_QUERY_KEY, 'agent-budget', address] as const

/**
 * The wallet's conversation with Ryntra for one context — opened, or resumed as
 * the server keeps it: the turns, the budget, the suggested questions. It is
 * private to the bearer and dropped with it; the server is its only store.
 */
export function useConversation(session: Session | null, context: AgentContext | null, locale: Locale) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  return useQuery({
    queryKey: conversationKey(session?.address ?? '', key, locale),
    queryFn: async ({ signal }) => {
      const opened = await agentApi.open(session!, { context, locale }, signal)
      queryClient.setQueryData(budgetKey(session!.address), opened.budget)
      return opened
    },
    enabled: session !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/** The wallet's model allowance as it stands — the latest any conversation read; asked of the server when none has. */
export function useAgentBudget(session: Session | null) {
  return useQuery({
    queryKey: budgetKey(session?.address ?? ''),
    queryFn: ({ signal }) => agentApi.budget(session!, signal),
    enabled: session !== null,
    staleTime: 60_000,
    retry: 1,
  })
}

type Asked = Readonly<{ sessionId: string; text: string }>
type Answered = Readonly<{ exchange: AgentMessageResponse }> | Readonly<{ landed: AgentSessionResponse }>

/**
 * Ask Ryntra. The answer joins the conversation the phone holds; a send lost on
 * the network is looked for on the server before anything is said, so a
 * question is never asked twice by the phone. Nothing here signs, submits
 * or saves.
 */
export function useAsk(session: Session | null, context: AgentContext | null, locale: Locale) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  const address = session?.address ?? ''
  const cacheKey = conversationKey(address, key, locale)
  return useMutation({
    mutationKey: askKey(address, key),
    mutationFn: async ({ sessionId, text }: Asked): Promise<Answered> => {
      const sentAt = Date.now()
      try {
        return { exchange: await agentApi.message(session!, { sessionId, text, locale }) }
      } catch (error) {
        if (agentFailureOf(error) === 'network') {
          // The server may have answered after the phone stopped waiting: read the conversation before saying anything.
          const read = await agentApi.read(session!, sessionId).catch(() => null)
          if (read && exchangeLanded(read.session, text, sentAt)) return { landed: read }
        }
        throw error
      }
    },
    onSuccess: (answered) => {
      queryClient.setQueryData<AgentSessionResponse>(cacheKey, (current) => {
        if ('landed' in answered) return answered.landed
        if (!current) return current
        return { ...current, session: withExchange(current.session, answered.exchange), budget: answered.exchange.budget }
      })
      queryClient.setQueryData(
        budgetKey(address),
        'landed' in answered ? answered.landed.budget : answered.exchange.budget,
      )
    },
    onError: (error) => {
      // A conversation that is not this wallet's any more is opened again; the words stay in the composer.
      if (agentFailureOf(error) === 'gone') void queryClient.invalidateQueries({ queryKey: cacheKey })
    },
  })
}

/** The question in flight for this conversation, even after the screen was left and came back — or null. */
export function usePendingQuestion(session: Session | null, context: AgentContext | null): string | null {
  const pending = useMutationState<Asked | undefined>({
    filters: { mutationKey: askKey(session?.address ?? '', contextKey(context)), status: 'pending' },
    select: (mutation) => mutation.state.variables as Asked | undefined,
  })
  return pending[pending.length - 1]?.text ?? null
}

/** A draft Ryntra prepared, read back by the wallet it was prepared for while it lives. */
export function useAgentDraft(session: Session | null, draftId: string | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'agent-draft', session?.address ?? '', draftId ?? ''],
    queryFn: ({ signal }) => agentApi.draft(session!, draftId!, signal),
    enabled: session !== null && draftId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) => !isNotFound(error) && count < 1,
  })
}
