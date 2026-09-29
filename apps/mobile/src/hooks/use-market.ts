import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  fetchCandles,
  fetchMarket,
  fetchStockAsset,
  fetchStockQuote,
  isNotFound,
  TIMEFRAME_TTL_MS,
  type StockSide,
  type Timeframe,
} from '@/lib/api'

/** One market, whole, re-read every twenty seconds while the asset is open — as fresh as the venue's own cache. */
export function useMarket(mint: string, enabled = true) {
  return useQuery({
    queryKey: ['market', mint],
    queryFn: ({ signal }) => fetchMarket(mint, signal),
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: 1,
    enabled: enabled && mint.length > 0,
  })
}

/**
 * Candles for one market and timeframe, asked no more often than the server
 * keeps them fresh. A failed refresh keeps the last read on screen; a 404 is
 * this market's own answer (no chart, for a stated reason) and is not retried.
 */
export function useCandles(mint: string, timeframe: Timeframe) {
  const ttl = Math.max(TIMEFRAME_TTL_MS[timeframe], 60_000)
  return useQuery({
    queryKey: ['candles', mint, timeframe],
    queryFn: ({ signal }) => fetchCandles(mint, timeframe, signal),
    staleTime: ttl,
    refetchInterval: ttl,
    retry: (count, error) => !isNotFound(error) && count < 1,
  })
}

/** The confirmed stock representation behind a market, when there is one; a 404 means the token is not a confirmed stock. */
export function useStockAsset(ticker: string | null) {
  return useQuery({
    queryKey: ['stocks', 'asset', ticker],
    queryFn: ({ signal }) => fetchStockAsset(ticker ?? '', signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
    enabled: ticker !== null,
  })
}

/** The size-aware quote for a side and an amount; the previous quote stays, marked, while the next loads. */
export function useStockQuote(ticker: string | null, side: StockSide, usd: number | null) {
  return useQuery({
    queryKey: ['stocks', 'quote', ticker, side, usd],
    queryFn: ({ signal }) => fetchStockQuote({ ticker: ticker ?? '', side, usd: usd ?? 0 }, signal),
    staleTime: 15_000,
    retry: 0,
    enabled: ticker !== null && usd !== null,
    placeholderData: keepPreviousData,
  })
}
