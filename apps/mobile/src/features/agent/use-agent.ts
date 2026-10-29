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

/** `pick` is a conversation the person chose from the list or opened anew; `latest` is the server's own for the context. */
const conversationKey = (address: string, context: string, locale: Locale, pick: string | null) =>
  [PRIVATE_QUERY_KEY, 'agent', address, context, locale, pick ?? 'latest'] as const

const sessionsKey = (address: string) => [PRIVATE_QUERY_KEY, 'agent-sessions', address] as const

const askKey = (address: string, context: string) => ['agent-ask', address, context] as const

/** The budget is the wallet's, not a conversation's: one figure every conversation reads and every answer updates. */
const budgetKey = (address: string) => [PRIVATE_QUERY_KEY, 'agent-budget', address] as const

/**
 * The wallet's conversation with Ryntra for one context — opened, or resumed as
 * the server keeps it: the turns, the budget, the suggested questions. It is
 * private to the bearer and dropped with it; the server is its only store.
 */
export function useConversation(
  session: Session | null,
  context: AgentContext | null,
  locale: Locale,
  pick: string | null = null,
) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  return useQuery({
    queryKey: conversationKey(session?.address ?? '', key, locale, pick),
    queryFn: async ({ signal }) => {
      const opened = await agentApi.open(session!, { context, locale, ...(pick ? { sessionId: pick } : {}) }, signal)
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

/**
 * A question as the phone sends it: `acceptCredits` the price the line under the field showed (0 while it said
 * «free»); `typed` only for words the person wrote in the field — only those may be kept in Ryntra's memory.
 */
type Asked = Readonly<{ sessionId: string; text: string; acceptCredits?: number; typed?: boolean }>
type Answered = Readonly<{ exchange: AgentMessageResponse }> | Readonly<{ landed: AgentSessionResponse }>

/**
 * Ask Ryntra. The answer joins the conversation the phone holds; a send lost on
 * the network is looked for on the server before anything is said, so a
 * question is never asked twice by the phone. Nothing here signs, submits
 * or saves.
 */
export function useAsk(session: Session | null, context: AgentContext | null, locale: Locale, pick: string | null = null) {
  const queryClient = useQueryClient()
  const key = contextKey(context)
  const address = session?.address ?? ''
  const cacheKey = conversationKey(address, key, locale, pick)
  return useMutation({
    mutationKey: askKey(address, key),
    mutationFn: async ({ sessionId, text, acceptCredits, typed }: Asked): Promise<Answered> => {
      const sentAt = Date.now()
      try {
        return {
          exchange: await agentApi.message(session!, {
            sessionId,
            text,
            locale,
            ...(acceptCredits !== undefined ? { acceptCredits } : {}),
            ...(typed ? { typed: true } : {}),
          }),
        }
      } catch (error) {
        if (agentFailureOf(error) === 'network') {
          // The server may have answered after the phone stopped waiting: read the conversation before saying anything.
          const read = await agentApi.read(session!, sessionId).catch(() => null)
          if (read && exchangeLanded(read.session, text, sentAt)) return { landed: read }
        }
        throw error
      }
    },
    onSuccess: (answered, { sessionId }) => {
      // A paid answer moved the balance: the credits read anywhere are read again.
      void queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'assistant-credits', address] })
      // Into the conversation the question was asked in — found by its id among the wallet's kept conversations, never
      // whichever one the screen shows now (ST-8 critic: «Нова розмова» pressed while Ryntra read).
      queryClient.setQueriesData<AgentSessionResponse>(
        {
          queryKey: [PRIVATE_QUERY_KEY, 'agent', address],
          // Only that conversation is touched: the others keep their own time and any invalidation.
          predicate: (query) => (query.state.data as AgentSessionResponse | undefined)?.session.id === sessionId,
        },
        (current) => {
        if (!current || current.session.id !== sessionId) return current
        if ('landed' in answered) return answered.landed
        return { ...current, session: withExchange(current.session, answered.exchange), budget: answered.exchange.budget }
        },
      )
      queryClient.setQueryData(
        budgetKey(address),
        'landed' in answered ? answered.landed.budget : answered.exchange.budget,
      )
      // The list names a conversation by its first question and orders by the last: read it again when next opened.
      void queryClient.invalidateQueries({ queryKey: sessionsKey(address) })
    },
    onError: (error) => {
      // A conversation that is not this wallet's any more is opened again; the words stay in the composer.
      if (agentFailureOf(error) === 'gone') void queryClient.invalidateQueries({ queryKey: cacheKey })
    },
  })
}

/**
 * The question in flight for this context and the conversation it was asked in, even after the screen was left and
 * came back — or null. The screen shows it only over that conversation.
 */
export function usePendingQuestion(session: Session | null, context: AgentContext | null): Asked | null {
  const pending = useMutationState<Asked | undefined>({
    filters: { mutationKey: askKey(session?.address ?? '', contextKey(context)), status: 'pending' },
    select: (mutation) => mutation.state.variables as Asked | undefined,
  })
  return pending[pending.length - 1] ?? null
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

/**
 * The wallet's conversations with a question in them, the most recent first (1.43.0) — read when the list is opened;
 * each is kept 90 days after its last turn, then neither listed nor resumed.
 */
export function useConversations(session: Session | null, enabled: boolean) {
  return useQuery({
    queryKey: sessionsKey(session?.address ?? ''),
    queryFn: ({ signal }) => agentApi.sessions(session!, signal),
    enabled: session !== null && enabled,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * «Нова розмова»: a new conversation for the context (`fresh: true`); an empty one already open is reused by the
 * server, so the button pressed twice leaves no empty conversations. The answer is kept under its own id — the
 * screen then shows it as the chosen one.
 */
export function useFreshConversation(session: Session | null, locale: Locale) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (context: AgentContext | null) => agentApi.open(session!, { context, locale, fresh: true }),
    onSuccess: (opened, context) => {
      const address = session?.address ?? ''
      queryClient.setQueryData(conversationKey(address, contextKey(context), locale, opened.session.id), opened)
      queryClient.setQueryData(budgetKey(address), opened.budget)
    },
  })
}
