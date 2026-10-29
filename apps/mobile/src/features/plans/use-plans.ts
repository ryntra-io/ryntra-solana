import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import {
  fetchCapabilities,
  fetchMonitoring,
  isNotFound,
  plansApi,
  type MonitoringSurface,
  type PlanRules,
  type Session,
  type TradingPlan,
} from '@/lib/api'
import type { Locale } from '@/lib/i18n'

const PLANS_KEY = (address: string) => [PRIVATE_QUERY_KEY, 'plans', address] as const

/** The wallet's plans as the server holds them — private to the bearer, dropped with it. */
export function usePlans(session: Session | null) {
  return useQuery({
    queryKey: PLANS_KEY(session?.address ?? ''),
    queryFn: ({ signal }) => plansApi.list(session!, signal),
    enabled: session !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

/** One plan, whole, read on its own so its journal and executions are the latest. */
export function usePlan(session: Session | null, planId: string | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'plan', session?.address ?? '', planId ?? ''],
    queryFn: ({ signal }) => plansApi.get(session!, planId!, signal),
    enabled: session !== null && planId !== null,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  })
}

/** A version as it stood, for reading only. */
export function usePlanVersion(session: Session | null, planId: string | null, version: number | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'plan-version', session?.address ?? '', planId ?? '', version ?? 0],
    queryFn: ({ signal }) => plansApi.version(session!, planId!, version!, signal),
    enabled: session !== null && planId !== null && version !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
}

/**
 * The monitoring surface for the wallet: what needs attention and what is
 * watched, in the app's language. Read here for the plans; M7 adds the
 * inbox, the preferences and the device.
 */
export function useMonitoring(session: Session | null, locale: Locale) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'monitoring', session?.address ?? '', locale],
    queryFn: ({ signal }) => fetchMonitoring(session!, locale, signal),
    enabled: session !== null,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

/** Every write to a plan re-reads the plans and the monitoring — the server is the only truth of both. */
function useInvalidatePlans() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'plans'] }),
      queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'plan'] }),
      queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_KEY, 'monitoring'] }),
    ])
  }
}

export function useCreatePlan(session: Session | null) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: (input: Readonly<{ mint: string; rules: PlanRules; activate: boolean }>) =>
      plansApi.create(session!, { asset: { mint: input.mint }, rules: input.rules, activate: input.activate }),
    onSuccess: () => void invalidate(),
  })
}

export function useUpdatePlan(session: Session | null) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: (input: Readonly<{ planId: string; rules: PlanRules; ifVersion: number; reason: string | null }>) =>
      plansApi.update(session!, input.planId, { rules: input.rules, ifVersion: input.ifVersion, reason: input.reason }),
    onSuccess: () => void invalidate(),
  })
}

export function useSetPlanStatus(session: Session | null) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: (
      input: Readonly<{ planId: string; status: 'active' | 'cancelled'; ifVersion: number; reason: string | null }>,
    ) =>
      plansApi.setStatus(session!, input.planId, {
        status: input.status,
        ifVersion: input.ifVersion,
        reason: input.reason,
      }),
    onSuccess: () => void invalidate(),
  })
}

/** The surface's attention and watching cards, or null while it is not read. */
export function useSurface(session: Session | null, locale: Locale): MonitoringSurface | null {
  const monitoring = useMonitoring(session, locale)
  return useMemo(() => monitoring.data ?? null, [monitoring.data])
}

export type PlansById = ReadonlyMap<string, TradingPlan>

/** Any mint resolved the way a plan's create resolves it — the asset, the planning price now, the liquidity. Public. */
export function usePlanAsset(mint: string | null) {
  return useQuery({
    queryKey: ['plans', 'asset', mint ?? ''],
    queryFn: ({ signal }) => plansApi.asset(mint!, signal),
    enabled: mint !== null,
    staleTime: 30_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
  })
}

/** What the deployment offers — here, the evidence metrics' own words and units. Public, read rarely. */
export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: 60 * 60_000,
    retry: 1,
  })
}
