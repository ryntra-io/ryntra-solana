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
import { isOfferedMarket, isSupportedIssuer, withoutRetiredIssuer } from '@/lib/stocks'

/* What the lists offer: a stock token only from an issuer the app supports. */
const offeredMarkets = (data: MarketsResponse): MarketsResponse => ({
  ...data,
  rows: data.rows.filter(isOfferedMarket),
})
const offeredStocks = (data: StockUniverseResponse): StockUniverseResponse => ({
  ...data,
  rows: data.rows.filter((row) => isSupportedIssuer(row.issuer)),
})
/* What a person keeps stays theirs — a token of an unsupported issuer simply names no issuer. */
const keptMarkets = (data: MarketsByMintResponse): MarketsByMintResponse => ({
  ...data,
  rows: data.rows.map(withoutRetiredIssuer),
})

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

/** The venue's catalogue for a typed query; the previous answer stays on screen while the next one loads. */
export function useMarketSearch(query: string) {
  const needle = query.trim()
  return useQuery({
    queryKey: ['markets', 'search', needle.toLowerCase()],
    queryFn: ({ signal }) => searchMarkets(needle, 40, signal),
    select: offeredMarkets,
    staleTime: 60_000,
    retry: 0,
    enabled: needle.length > 0,
    placeholderData: keepPreviousData,
  })
}
