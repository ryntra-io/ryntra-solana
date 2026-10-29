import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { figuresOf } from '@/features/widget/widget-model'
import { redrawPortfolioWidgets } from '@/features/widget/widget-render'
import { setWidgetFailed, setWidgetFigures } from '@/features/widget/widget-store'
import { fetchHoldings, type HoldingsResponse } from '@/lib/api'
import { useNow } from '@/hooks/use-now'
import { useLocale } from '@/lib/i18n'

import {
  nextUnpricedRun,
  portfolioView,
  readHasPrices,
  waitingForPrices,
  type PortfolioView,
  type UnpricedRun,
} from './portfolio-model'

/**
 * What the wallet holds, by address — the same read and the same cache the
 * Trade surface uses for its Available line, so the two never disagree. Read
 * every minute while a portfolio is open; a failed refresh keeps the last
 * read on screen with its time.
 */
export function useHoldings(address: string | null) {
  const client = useQueryClient()
  const key = ['trade', 'holdings', address ?? '']
  return useQuery({
    queryKey: key,
    // After a restart the run lives only in the read restored from the device: the next read continues it.
    queryFn: async ({ signal }): Promise<HoldingsRead> =>
      withRun(await fetchHoldings(address!, signal), client.getQueryData<HoldingsRead>(key)?.unpriced),
    enabled: address !== null,
    staleTime: 20_000,
    // A read that came back before the prices did is asked again in seconds, not in a minute — while the wait lasts.
    refetchInterval: (query) =>
      query.state.data && waitingForPrices(runOf(query.state.data), Date.now(), false) ? 4_000 : 60_000,
    retry: 1,
  })
}

type Read = HoldingsResponse['data']

/** A holdings answer with the run of reads without prices it belongs to, on the phone's clock — carried with the read itself. */
export type HoldingsRead = HoldingsResponse & Readonly<{ unpriced?: UnpricedRun }>

/** The latest run of reads without prices, per wallet — only the query's own function reads or writes it. */
const unpricedRuns = new Map<string, UnpricedRun>()

function withRun(response: HoldingsResponse, cached: UnpricedRun | undefined): HoldingsRead {
  const read = response.data
  const run = nextUnpricedRun(unpricedRuns.get(read.owner) ?? cached, Date.now(), readHasPrices(read))
  if (run === undefined) unpricedRuns.delete(read.owner)
  else unpricedRuns.set(read.owner, run)
  return run === undefined ? response : { ...response, unpriced: run }
}

function runOf(response: HoldingsRead): Readonly<{ priced: boolean; since: number | undefined }> {
  return { priced: readHasPrices(response.data), since: response.unpriced?.since ?? 0 }
}

/** A read that could not see the token accounts says less than one that could; the fuller read is kept until a full one returns. */
function keepsPrevious(next: Read, kept: Read | null, holding: boolean): boolean {
  if (kept === null || kept.owner !== next.owner) return false
  // Nor does a read without the prices replace one that had them — while the wait for them lasts.
  if (holding && !readHasPrices(next) && readHasPrices(kept)) return true
  return next.tokenRead === 'UNAVAILABLE' && kept.tokenRead !== 'UNAVAILABLE'
}

/**
 * The holdings folded into the portfolio's rows, groups and totals. When a
 * refresh comes back without the token accounts while an earlier read had
 * them, the earlier read stays on screen, marked with its time — the
 * positions do not vanish because one read of the chain failed. A read that
 * came before the venue's prices is waited out for `PRICES_WAIT_MS` on the
 * phone's clock: an earlier priced read stays meanwhile, or, without one,
 * the total is said as being read — unless a refresh of this run failed.
 * Past the wait its gaps are said as they are.
 */
export function usePortfolio(address: string | null) {
  const locale = useLocale()
  const query = useHoldings(address)
  const response = query.data ?? null
  const latest = response?.data ?? null
  // The clock, re-read every few seconds: the wait ends within a few seconds of its thirty.
  const now = useNow(5_000)
  const run = response ? runOf(response) : null
  // A read restored from the device carries the run it was read in; one from before runs were kept counts as long over.
  const timeLeft = run !== null && waitingForPrices(run, now, false)
  // A refresh that failed in this run ends the «being read» state for the run — no flicker back to it on a retry.
  const runKey = run && !run.priced ? `${latest!.owner}:${run.since}` : null
  const [failedRun, setFailedRun] = useState<string | null>(null)
  if (runKey !== null && failedRun !== runKey && (query.isError || query.failureCount > 0)) setFailedRun(runKey)
  // The best-known read, adjusted during render as React prescribes: a lesser read never replaces a fuller one.
  const [kept, setKept] = useState<Read | null>(null)
  if (latest && latest !== kept && !keepsPrevious(latest, kept, timeLeft)) setKept(latest)
  const shown = latest && keepsPrevious(latest, kept, timeLeft) ? kept : latest
  const beingRead = timeLeft && failedRun !== runKey
  const view = useMemo((): PortfolioView | null => {
    if (!shown) return null
    const folded = portfolioView(shown, locale)
    // Past the wait, a read without prices is said as it is — a dash and «N without a price» — never a skeleton for good.
    return !folded.pricesRead && !beingRead ? { ...folded, pricesRead: true } : folded
  }, [shown, locale, beingRead])
  // The home-screen widget shows the same read, with its time (M9) — never a read without its prices.
  useEffect(() => {
    if (!view || !shown || !readHasPrices(shown)) return
    const changed = setWidgetFigures(figuresOf(view))
    if (changed) redrawPortfolioWidgets(changed)
  }, [view, shown])
  // Held back for a failed read of the token accounts — a read that only came before its prices is not a failure.
  const heldBack = shown !== latest && latest?.tokenRead === 'UNAVAILABLE'
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
