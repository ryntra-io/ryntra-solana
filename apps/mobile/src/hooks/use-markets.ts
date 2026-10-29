import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  fetchMarkets,
  fetchMarketsByMints,
  fetchStockUniverse,
  searchMarkets,
  type MarketsByMintResponse,
  type MarketsResponse,
  type MarketView,
  type StockUniverseResponse,
} from '@/lib/api'
import { coinName } from '@/features/invest/shelf'
import { isOfferedMarket, isSupportedIssuer, withoutRetiredIssuer } from '@/lib/stocks'

/* What the lists offer: a stock token only from an issuer the app supports; a coin by the name a person knows it by
   («Solana», not the venue's «Wrapped SOL») — one name for one thing, as the asset's own page says it. */
const offeredMarkets = (data: MarketsResponse): MarketsResponse => ({
  ...data,
  rows: data.rows.filter(isOfferedMarket).map((row) => ({ ...row, name: coinName(row) })),
})
const offeredStocks = (data: StockUniverseResponse): StockUniverseResponse => ({
  ...data,
  rows: data.rows.filter((row) => isSupportedIssuer(row.issuer)),
})
/* What a person keeps stays theirs — a token of an unsupported issuer simply names no issuer. */
const keptMarkets = (data: MarketsByMintResponse): MarketsByMintResponse => ({
  ...data,
  rows: data.rows.map(withoutRetiredIssuer).map((row) => ({ ...row, name: coinName(row) })),
})

/** How long the search waits before asking a failed query once more — short, the person is waiting on it. */
const SEARCH_ASK_AGAIN_MS = 700

/** The live market list for a view — cached briefly, refreshed in the background, never invented. */
export function useMarkets(view: MarketView, enabled = true) {
  return useQuery({
    queryKey: ['markets', view],
    queryFn: ({ signal }) => fetchMarkets(view, 100, signal),
    select: offeredMarkets,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled,
  })
}

/** The confirmed stock representations with their figures and states — the Stocks list and the search's company names. */
export function useStockUniverse(enabled = true) {
  return useQuery({
    queryKey: ['stocks', 'universe'],
    queryFn: ({ signal }) => fetchStockUniverse(signal),
    select: offeredStocks,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled,
  })
}

/** The watchlist's rows, in the watchlist's order; an empty list asks nothing. */
export function useWatchlistMarkets(mints: readonly string[]) {
  return useQuery({
    queryKey: ['markets', 'mints', mints.join(',')],
    queryFn: ({ signal }) => fetchMarketsByMints(mints, signal),
    select: keptMarkets,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled: mints.length > 0,
    placeholderData: keepPreviousData,
  })
}

/**
 * The venue's catalogue for a typed query; the previous answer is kept while the next one loads — as the previous
 * query's, never this one's: while `isPlaceholderData` holds, a screen shows no count for it and keeps only its rows
 * that hold the typed words (`catalogueMatches`, ST-5 r6: «bonk» under the rows for «b»). The first
 * search after Search opens can meet a cold route: one quick second ask keeps the query pending («Шукаємо…») rather
 * than showing a part of the answer under «Catalogue search unavailable» (ST-5: «tesla» → 2, a moment later 21).
 * The answer's prices are read again quietly every 60 s while it is on screen, as the lists' (ST-7).
 */
export function useMarketSearch(query: string) {
  const needle = query.trim()
  return useQuery({
    queryKey: ['markets', 'search', needle.toLowerCase()],
    queryFn: ({ signal }) => searchMarkets(needle, 40, signal),
    select: offeredMarkets,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: SEARCH_ASK_AGAIN_MS,
    enabled: needle.length > 0,
    placeholderData: keepPreviousData,
  })
}
