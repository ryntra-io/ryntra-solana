import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { paymentBounds, type PaymentBounds } from '@/features/autoinvest/payments'
import { isRuleGoneError, ruleRead } from '@/features/autoinvest/rule-model'
import { useCapabilities } from '@/features/plans/use-plans'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  ApiError,
  isNetworkError,
  rulesApi,
  type AutoinvestRule,
  type RuleBudget,
  type RuleBudgetRequest,
  type RuleCreateRequest,
  type RuleListResponse,
  type RuleStatus,
  type Session,
} from '@/lib/api'

/** Every read of the rules sits under this key, private to the bearer and dropped with it. */
export const RULES_KEY = [PRIVATE_QUERY_KEY, 'rules'] as const
const LIST_KEY = (address: string) => [...RULES_KEY, 'list', address] as const

/** The wallet's rules as the server holds them, with the month's budget. */
export function useRules(session: Session | null) {
  return useQuery({
    queryKey: LIST_KEY(session?.address ?? ''),
    queryFn: ({ signal }) => rulesApi.list(session!, signal),
    enabled: session !== null,
    staleTime: 15_000,
    // A reminder opens on the server's own tick; the rule's card follows within a minute.
    refetchInterval: 60_000,
    retry: 1,
  })
}

/** «З кожної оплати»'s modes and bounds as the server's capabilities state them (1.19.0) — the contract's own until they are read. */
export function usePaymentBounds(): PaymentBounds {
  const capabilities = useCapabilities()
  return paymentBounds(capabilities.data?.rules?.payments)
}

/** Whether a read failed because the rule is not this wallet's — the rule is gone, not unread. */
export function isRuleNotFound(error: unknown): boolean {
  return error instanceof ApiError && isRuleGoneError(error)
}

/**
 * One rule read afresh — what one tap on its reminder may do is decided on
 * this read, never on the note or the last list (a note is not permission).
 */
export function useRule(session: Session | null, ruleId: string | null) {
  const query = useQuery({
    queryKey: [...RULES_KEY, 'one', session?.address ?? '', ruleId ?? ''],
    queryFn: ({ signal }) => rulesApi.get(session!, ruleId!, signal),
    enabled: session !== null && ruleId !== null,
    staleTime: 0,
    // Never kept past its screen: every reminder opened is read from the server, not from an earlier visit.
    gcTime: 0,
    retry: (count, error) => !isRuleNotFound(error) && count < 1,
  })
  // A rule the server no longer holds is gone, whatever an earlier read of it said (a failed refetch keeps old data).
  return { query, ...ruleRead(query) }
}

/** Whether a reminder can reach Telegram too — read only for a signed-in wallet; unknown is said as nothing. */
export function useTelegramChannel(session: Session | null, enabled: boolean) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'telegram', session?.address ?? ''],
    queryFn: ({ signal }) => rulesApi.telegram(session!, signal),
    enabled: enabled && session !== null,
    staleTime: 60_000,
    retry: 0,
  })
}

/** The outcome of a write: the rule as the server now holds it, or the refusal's code (`NETWORK` when it never arrived). */
export type RuleWrite = Readonly<{ ok: true; rule: AutoinvestRule | null }> | Readonly<{ ok: false; code: string }>

/** The outcome of a write to the month's budget: the month as the server now counts it, or the refusal's code. */
export type BudgetWrite = Readonly<{ ok: true; budget: RuleBudget }> | Readonly<{ ok: false; code: string }>

function codeOf(error: unknown): string {
  if (error instanceof ApiError) return error.code
  return isNetworkError(error) ? 'NETWORK' : 'FAILED'
}

/**
 * Turning a rule on, pausing it, turning it on again, deleting it; setting or
 * removing the month's budget. The server is the only truth: the list is
 * re-read after every write (and the inbox, whose reminders read the rule),
 * the answer put in place at once so the card and the bar never show the
 * state before.
 */
export function useRuleWrites(session: Session | null) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''

  const settle = useCallback(
    async (change: ((list: RuleListResponse) => RuleListResponse) | null) => {
      if (change) queryClient.setQueryData<RuleListResponse>(LIST_KEY(address), (list) => (list ? change(list) : list))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RULES_KEY }),
        queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'monitoring'] }),
      ])
    },
    [address, queryClient],
  )

  return useMemo(() => {
    const create = async (request: RuleCreateRequest): Promise<RuleWrite> => {
      if (!session) return { ok: false, code: 'UNAUTHORIZED' }
      try {
        const { rule } = await rulesApi.create(session, request)
        await settle((list) => ({ ...list, rules: [rule, ...list.rules], total: list.total + 1 }))
        return { ok: true, rule }
      } catch (error) {
        return { ok: false, code: codeOf(error) }
      }
    }
    const setStatus = async (ruleId: string, status: RuleStatus): Promise<RuleWrite> => {
      if (!session) return { ok: false, code: 'UNAUTHORIZED' }
      try {
        const { rule } = await rulesApi.setStatus(session, ruleId, status)
        await settle((list) => ({ ...list, rules: list.rules.map((row) => (row.id === rule.id ? rule : row)) }))
        return { ok: true, rule }
      } catch (error) {
        return { ok: false, code: codeOf(error) }
      }
    }
    const remove = async (ruleId: string): Promise<RuleWrite> => {
      if (!session) return { ok: false, code: 'UNAUTHORIZED' }
      try {
        await rulesApi.remove(session, ruleId)
        await settle((list) => ({
          ...list,
          rules: list.rules.filter((row) => row.id !== ruleId),
          total: Math.max(0, list.total - 1),
        }))
        return { ok: true, rule: null }
      } catch (error) {
        return { ok: false, code: codeOf(error) }
      }
    }
    /** The month's ceiling, the person's own: the answer is the month as the server counts it now, for every rule at once. */
    const writeBudget = async (run: () => Promise<{ budget: RuleBudget }>): Promise<BudgetWrite> => {
      if (!session) return { ok: false, code: 'UNAUTHORIZED' }
      try {
        const { budget } = await run()
        await settle((list) => ({ ...list, budget }))
        return { ok: true, budget }
      } catch (error) {
        return { ok: false, code: codeOf(error) }
      }
    }
    const setBudget = (request: RuleBudgetRequest) => writeBudget(() => rulesApi.setBudget(session!, request))
    const clearBudget = () => writeBudget(() => rulesApi.clearBudget(session!))
    /**
     * «Мій рахунок» (1.19.0): the other side of one counted payment is the person's own account — no transfer with it
     * counts from then on, and a waiting event with it leaves what waits. The answer is the list as it stands after it.
     */
    const markOwn = async (ruleId: string, signature: string): Promise<RuleWrite> => {
      if (!session) return { ok: false, code: 'UNAUTHORIZED' }
      try {
        const answer = await rulesApi.markOwn(session, signature)
        await settle(() => answer)
        return { ok: true, rule: answer.rules.find((row) => row.id === ruleId) ?? null }
      } catch (error) {
        return { ok: false, code: codeOf(error) }
      }
    }
    /** After a purchase under a rule: History is how the rule learns it was bought, so the rule and the inbox are read again. */
    const reread = () => settle(null)
    return { create, setStatus, remove, setBudget, clearBudget, markOwn, reread }
  }, [session, settle])
}
