import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { creditsChanged } from '@/features/assistant/use-credits'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  assistantApi,
  type AssistantPlanCreate,
  type AssistantPlanResponse,
  type AssistantPlansResponse,
  type AssistantPlanUpdate,
  type Session,
} from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { planFailureOf } from './plans-model'

/**
 * Plans with Ryntra (AI-11, 1.61.0) for the proven wallet: the list with its prices, one plan with its critic and
 * «План проти реальності», and the person's words on it. Every write's answer is the plan as it stands — it replaces
 * the read; a paid call (composing, «Перевірити ще раз») carries exactly the price the phone showed and leaves the
 * credits to be read again. Nothing here signs or trades: an approved plan's trade lives on its own page.
 */
const plansRoot = (address: string) => [PRIVATE_QUERY_KEY, 'assistant-plans', address] as const
const plansKey = (address: string, locale: Locale) => [...plansRoot(address), 'list', locale] as const
const planKey = (address: string, locale: Locale, planId: string) =>
  [...plansRoot(address), 'plan', planId, locale] as const

/** The wallet's plans with Ryntra and what composing and checking cost now (`prices`). Private to the bearer. */
export function useAssistantPlans(session: Session | null, locale: Locale, enabled = true) {
  return useQuery({
    queryKey: plansKey(session?.address ?? '', locale),
    queryFn: ({ signal }) => assistantApi.plans(session!, locale, signal),
    enabled: session !== null && enabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1_500,
  })
}

/** One plan as it stands — its versions, critic, journal, Нагляд and reality — with the prices beside it. */
export function useAssistantPlan(session: Session | null, planId: string | null, locale: Locale) {
  return useQuery({
    queryKey: planKey(session?.address ?? '', locale, planId ?? ''),
    queryFn: ({ signal }) => assistantApi.plan(session!, planId!, locale, signal),
    enabled: session !== null && planId !== null,
    staleTime: 15_000,
    retry: (count, error) => count < 1 && planFailureOf(error).kind !== 'notFound',
    retryDelay: 1_500,
  })
}

/** The plan's answer kept as the truth now: its page's read, and its row in every list read. */
function keepPlan(queryClient: QueryClient, address: string, locale: Locale, answer: AssistantPlanResponse) {
  queryClient.setQueryData(planKey(address, locale, answer.plan.id), answer)
  queryClient.setQueriesData<AssistantPlansResponse>({ queryKey: [...plansRoot(address), 'list'] }, (current) => {
    if (!current) return current
    const known = current.plans.some((plan) => plan.id === answer.plan.id)
    return {
      ...current,
      prices: answer.prices,
      plans: known
        ? current.plans.map((plan) => (plan.id === answer.plan.id ? answer.plan : plan))
        : [answer.plan, ...current.plans],
    }
  })
  void queryClient.invalidateQueries({ queryKey: [...plansRoot(address), 'list'] })
}

/**
 * «Скласти з Ryntra»: the token, the idea, the loss limit or the budget, the levels the person knows — `acceptCredits`
 * exactly `prices.plan` as shown. May take up to a minute and a half. A refusal reads the list again, so a changed
 * price is the one shown next.
 */
export function useComposePlan(session: Session | null, locale: Locale) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  return useMutation({
    mutationFn: (request: AssistantPlanCreate) => assistantApi.createPlan(session!, { ...request, locale }),
    onSuccess: (answer) => {
      keepPlan(queryClient, address, locale, answer)
      creditsChanged(queryClient, address, null)
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [...plansRoot(address), 'list'] })
      creditsChanged(queryClient, address, null)
    },
  })
}

export type PlanAction =
  | Readonly<{ kind: 'update'; request: AssistantPlanUpdate }>
  | Readonly<{ kind: 'recheck'; ifVersion: number; acceptCredits: number }>
  | Readonly<{ kind: 'state'; to: 'approved' | 'watching' | 'cancelled'; ifVersion: number }>

/**
 * The person's word on one plan: a change (a new version, free), «Перевірити ще раз» at `prices.recheck`, «Схвалити»,
 * «Схвалити й стежити», «Скасувати план». A version conflict reads the plan again, so the page shows it as it stands.
 */
export function usePlanAction(session: Session | null, planId: string, locale: Locale) {
  const queryClient = useQueryClient()
  const address = session?.address ?? ''
  return useMutation({
    mutationFn: (action: PlanAction) => {
      switch (action.kind) {
        case 'update':
          return assistantApi.updatePlan(session!, planId, { ...action.request, locale })
        case 'recheck':
          return assistantApi.recheckPlan(session!, planId, {
            ifVersion: action.ifVersion,
            acceptCredits: action.acceptCredits,
            locale,
          })
        case 'state':
          return assistantApi.setPlanState(session!, planId, { to: action.to, ifVersion: action.ifVersion, locale })
      }
    },
    onSuccess: (answer, action) => {
      keepPlan(queryClient, address, locale, answer)
      if (action.kind === 'recheck') creditsChanged(queryClient, address, null)
    },
    onError: (error, action) => {
      const failure = planFailureOf(error)
      if (failure.kind === 'conflict' || failure.kind === 'refused') {
        void queryClient.invalidateQueries({ queryKey: planKey(address, locale, planId) })
      }
      if (action.kind === 'recheck') creditsChanged(queryClient, address, null)
    },
  })
}
