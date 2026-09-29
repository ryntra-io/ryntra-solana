import { useCallback, useMemo } from 'react'

import { lastCheckedAt, unreadCount } from '@/features/monitoring/monitoring-model'
import { groupPlans } from '@/features/plans/plan-model'
import { useMonitoring, usePlans } from '@/features/plans/use-plans'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { useAttempt } from '@/features/trade/trade-store'
import { useWatchlist } from '@/features/watchlist/watchlist'
import { useMarkets, useWatchlistMarkets } from '@/hooks/use-markets'
import { useNow } from '@/hooks/use-now'
import { isNetworkError } from '@/lib/api'
import { useLocale } from '@/lib/i18n'

import {
  accountState,
  attentionItems,
  briefLines,
  freshestAt,
  movePeriod,
  plansBlock,
  showTrending,
  trending,
  watchlistMoves,
  type AttentionItem,
  type BriefLine,
} from './home-model'
import { setAmountsHidden, useAmountsHidden, useLastLook } from './last-look'

const WATCH_ROWS = 5
const TRENDING_PER_CLASS = 3

/** How one block stands: gated behind the wallet or the session, being read for the first time, failed with nothing to show, or ready. */
export type BlockState = 'gated' | 'loading' | 'error' | 'ready'

/**
 * Home's view model — composed from the reads the other tabs already make
 * and the caches they share (the holdings Trade reads, the monitoring the
 * plans read, the watchlist's rows Markets reads); nothing is asked twice
 * and nothing new is asked. One block that cannot be read never holds the
 * others: each carries its own state.
 */
export function useHome() {
  const account = useAccount()
  const locale = useLocale()
  const now = useNow(30_000)
  const state = accountState(account.address, account.session)
  const hidden = useAmountsHidden()
  const look = useLastLook(account.address)

  const attempt = useAttempt(account.address)
  const monitoring = useMonitoring(account.session, locale)
  const plans = usePlans(account.session)
  const holdings = usePortfolio(account.address)
  const watchlist = useWatchlist()
  const watched = useWatchlistMarkets(watchlist.mints)

  const surface = monitoring.data ?? null
  const planList = plans.data?.plans ?? null
  const activeCount = planList ? groupPlans(planList).active.length : 0
  // Trending is for a person with nothing of their own to watch — and never flashed before the plans are known.
  const plansKnown = state !== 'signed-in' || planList !== null || plans.isError
  const trendingOn = plansKnown && showTrending(state, activeCount)
  const all = useMarkets('all', trendingOn)

  const attention: readonly AttentionItem[] = useMemo(
    () => attentionItems({ attempt, surface, plans: planList, now }),
    [attempt, surface, planList, now],
  )
  const attentionState: BlockState =
    state !== 'signed-in'
      ? 'gated'
      : monitoring.isPending && plans.isPending
        ? 'loading'
        : monitoring.isError && plans.isError && !surface && !planList
          ? 'error'
          : 'ready'

  const portfolioState: BlockState =
    state === 'guest'
      ? 'gated'
      : holdings.query.isPending
        ? 'loading'
        : holdings.query.isError && !holdings.view
          ? 'error'
          : 'ready'

  const plansState: BlockState =
    state !== 'signed-in' ? 'gated' : plans.isPending ? 'loading' : plans.isError && !planList ? 'error' : 'ready'
  const plansView = useMemo(() => (planList ? plansBlock(planList) : null), [planList])

  // An empty list asks nothing; the rows the previous list left as a placeholder are not this list's.
  const watchedData = watchlist.mints.length > 0 ? watched.data : undefined
  const watchedRows = watchedData?.rows
  const watchRows = useMemo(() => watchedRows ?? [], [watchedRows])
  const moves = useMemo(() => watchlistMoves(watchRows, look, WATCH_ROWS), [watchRows, look])
  const allMoves = useMemo(() => watchlistMoves(watchRows, look, watchRows.length), [watchRows, look])
  const watchState: BlockState =
    watchlist.mints.length === 0
      ? 'ready'
      : watched.isPending
        ? 'loading'
        : watched.isError && !watched.data
          ? 'error'
          : 'ready'

  const picks = useMemo(() => trending(all.data?.rows ?? [], TRENDING_PER_CLASS), [all.data?.rows])
  const trendingState: BlockState = all.isPending ? 'loading' : all.isError && !all.data ? 'error' : 'ready'

  const brief: readonly BriefLine[] = useMemo(
    () => briefLines({ look, surface, plans: planList, portfolio: holdings.view, moves: allMoves, now }),
    [look, surface, planList, holdings.view, allMoves, now],
  )

  const asOf = freshestAt(
    lastCheckedAt(surface),
    holdings.view?.observedAt,
    watchedData?.observedAt,
    trendingOn ? all.data?.observedAt : null,
  )
  const queries = [monitoring, plans, holdings.query, watched, all]
  const offline = queries.some((query) => query.isError && isNetworkError(query.error))
  const refreshing = queries.some((query) => query.isFetching && !query.isPending)

  const refresh = useCallback(async () => {
    await Promise.all(
      [monitoring, plans, holdings.query, watched, all]
        .filter((query) => query.fetchStatus !== 'fetching' && (query.data !== undefined || query.isError))
        .map((query) => query.refetch()),
    )
  }, [monitoring, plans, holdings.query, watched, all])

  return {
    account,
    state,
    locale,
    now,
    hidden,
    setHidden: setAmountsHidden,
    look,
    period: movePeriod(look),
    attention,
    attentionState,
    surface,
    unread: unreadCount(surface),
    lastChecked: lastCheckedAt(surface),
    monitoring,
    portfolio: holdings.view,
    portfolioState,
    holdings: holdings.query,
    heldBack: holdings.heldBack,
    plans: plansView,
    plansState,
    plansQuery: plans,
    watch: {
      state: watchState,
      moves,
      total: watchlist.mints.length,
      onDevice: watchlist.onDevice,
      rows: watchRows,
      missing: watchedData?.missing.length ?? 0,
      stale: watchedData?.stale ?? false,
      query: watched,
    },
    trending: { on: trendingOn, state: trendingState, picks, query: all },
    brief,
    asOf,
    offline,
    refreshing,
    refresh,
  }
}

export type HomeView = ReturnType<typeof useHome>
