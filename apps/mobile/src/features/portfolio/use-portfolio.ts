import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { figuresOf } from '@/features/widget/widget-model'
import { redrawPortfolioWidgets } from '@/features/widget/widget-render'
import { setWidgetFailed, setWidgetFigures } from '@/features/widget/widget-store'
import { fetchHoldings, type HoldingsResponse } from '@/lib/api'

import { portfolioView, type PortfolioView } from './portfolio-model'

/**
 * What the wallet holds, by address — the same read and the same cache the
 * Trade surface uses for its Available line, so the two never disagree. Read
 * every minute while a portfolio is open; a failed refresh keeps the last
 * read on screen with its time.
 */
export function useHoldings(address: string | null) {
  return useQuery({
    queryKey: ['trade', 'holdings', address ?? ''],
    queryFn: ({ signal }) => fetchHoldings(address!, signal),
    enabled: address !== null,
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

type Read = HoldingsResponse['data']

/** A read that could not see the token accounts says less than one that could; the fuller read is kept until a full one returns. */
function keepsPrevious(next: Read, kept: Read | null): boolean {
  return (
    kept !== null && kept.owner === next.owner && next.tokenRead === 'UNAVAILABLE' && kept.tokenRead !== 'UNAVAILABLE'
  )
}

/**
 * The holdings folded into the portfolio's rows, groups and totals. When a
 * refresh comes back without the token accounts while an earlier read had
 * them, the earlier read stays on screen, marked with its time — the
 * positions do not vanish because one read of the chain failed.
 */
export function usePortfolio(address: string | null) {
  const query = useHoldings(address)
  const latest = query.data?.data ?? null
  // The best-known read, adjusted during render as React prescribes: a lesser read never replaces a fuller one.
  const [kept, setKept] = useState<Read | null>(null)
  if (latest && latest !== kept && !keepsPrevious(latest, kept)) setKept(latest)
  const shown = latest && keepsPrevious(latest, kept) ? kept : latest
  const view = useMemo((): PortfolioView | null => (shown ? portfolioView(shown) : null), [shown])
  // The home-screen widget shows the same read, with its time (M9).
  useEffect(() => {
    if (!view) return
    const changed = setWidgetFigures(figuresOf(view))
    if (changed) redrawPortfolioWidgets(changed)
  }, [view])
  const heldBack = shown !== latest
  // A refresh the app saw fail, or held back, is labelled on the widget as it is here.
  const failedAt = query.isError ? query.errorUpdatedAt : heldBack ? query.dataUpdatedAt : 0
  useEffect(() => {
    if (!address || failedAt <= 0) return
    const changed = setWidgetFailed(new Date(failedAt).toISOString(), address)
    if (changed) redrawPortfolioWidgets(changed)
  }, [address, failedAt])
  return {
    query,
    view,
    /** True when the latest refresh could not read the token accounts and an earlier, fuller read is shown instead. */
    heldBack,
  }
}
