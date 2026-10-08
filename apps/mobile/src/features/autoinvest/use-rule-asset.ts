import { useQuery } from '@tanstack/react-query'

import type { RuleAssetStatus } from '@/features/autoinvest/floor'
import { ApiError, rulesApi, type RuleAssetRead } from '@/lib/api'

export type RuleAssetState = Readonly<{
  status: RuleAssetStatus
  read: RuleAssetRead | null
  /** Read it again now — «Спробувати ще» where the token could not be read. */
  refetch: () => void
  refetching: boolean
}>

/**
 * What a rule on this token would stand on (`GET /api/v1/rules/asset`,
 * 1.31.0) — read once a sheet opens on a token, and again every two minutes
 * while it stays open, so the floor and the facts of risk said before the
 * button are the server's own. A later read that fails keeps what the last one
 * said: the facts stay dated by their own read. A mint nothing knows is
 * refused outright. Public data: no wallet is read. The web's own
 * (`use-rule-asset.ts`).
 */
export function useRuleAsset(mint: string | null, enabled: boolean): RuleAssetState {
  const query = useQuery({
    queryKey: ['rules', 'asset', mint ?? ''],
    queryFn: ({ signal }) => rulesApi.asset(mint!, signal),
    enabled: enabled && mint !== null,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: (count, error) => !(error instanceof ApiError && error.code === 'ASSET_UNCONFIRMED') && count < 1,
  })
  const refetch = () => void query.refetch()
  const refetching = query.isFetching
  if (!enabled || !mint) return { status: 'idle', read: null, refetch, refetching }
  if (query.data) return { status: 'ready', read: query.data.read, refetch, refetching }
  if (query.isError)
    return {
      status: query.error instanceof ApiError && query.error.code === 'ASSET_UNCONFIRMED' ? 'refused' : 'failed',
      read: null,
      refetch,
      refetching,
    }
  return { status: 'reading', read: null, refetch, refetching }
}
