import { useQuery } from '@tanstack/react-query'

import type { ProTimeframe } from '@/features/pro-chart/bridge'
import { apiRequest, isNotFound } from '@/lib/api'

import {
  parseAccount,
  parseBook,
  parseCandles,
  parseMarkets,
  type FuturesAccount,
  type FuturesBook,
  type FuturesCandles,
  type FuturesMarkets,
} from './futures-model'

/**
 * The phone's reads of «Ф'ючерси» — the same four public routes the web's page reads (`/api/solana/futures/*`, B7).
 * They are cached at the edge for their own few seconds, so the phone asks no more often than that: the list every
 * 15 s, an open market's book every 5 s, its bars as their timeframe allows, the account every 30 s. The bars are the
 * chart's six intervals (C4c: the core's chart, whose switch offers them all — the route serves the same six). A failed refresh
 * keeps the last read on screen; Phoenix's «no such market» is an answer, not retried.
 */

const path = (route: string, query: Readonly<Record<string, string>>) =>
  `/api/solana/futures/${route}?${new URLSearchParams(query).toString()}`

export const fetchFuturesMarkets = async (signal?: AbortSignal): Promise<FuturesMarkets> =>
  parseMarkets(await apiRequest<unknown>('GET', '/api/solana/futures/markets', undefined, { signal }))

export const fetchFuturesBook = async (symbol: string, signal?: AbortSignal): Promise<FuturesBook> =>
  parseBook(await apiRequest<unknown>('GET', path('book', { symbol }), undefined, { signal }), symbol)

export const fetchFuturesCandles = async (
  symbol: string,
  timeframe: ProTimeframe,
  signal?: AbortSignal,
): Promise<FuturesCandles> =>
  parseCandles(
    await apiRequest<unknown>('GET', path('candles', { symbol, tf: timeframe }), undefined, { signal }),
    symbol,
  )

export const fetchFuturesAccount = async (wallet: string, signal?: AbortSignal): Promise<FuturesAccount> =>
  parseAccount(await apiRequest<unknown>('GET', path('account', { wallet }), undefined, { signal }), wallet)

/** Asked again once, unless Phoenix said there is no such market. */
const once = (count: number, error: unknown) => !isNotFound(error) && count < 1

/** How often a timeframe's bars are asked again: as often as the route refreshes them, never under 20 s. */
const BARS_EVERY_MS: Readonly<Record<ProTimeframe, number>> = {
  '1m': 20_000,
  '5m': 20_000,
  '15m': 30_000,
  '1h': 60_000,
  '4h': 120_000,
  '1d': 300_000,
}

/** `enabled`: read only where it is needed — Portfolio asks for the marks only while the account holds a position (C4f). */
export function useFuturesMarkets(enabled = true) {
  return useQuery({
    queryKey: ['futures', 'markets'],
    queryFn: ({ signal }) => fetchFuturesMarkets(signal),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
    enabled,
  })
}

export function useFuturesBook(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['futures', 'book', symbol.toLowerCase()],
    queryFn: ({ signal }) => fetchFuturesBook(symbol, signal),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: once,
    enabled,
  })
}

export function useFuturesCandles(symbol: string, timeframe: ProTimeframe) {
  return useQuery({
    queryKey: ['futures', 'candles', symbol.toLowerCase(), timeframe],
    queryFn: ({ signal }) => fetchFuturesCandles(symbol, timeframe, signal),
    staleTime: BARS_EVERY_MS[timeframe],
    refetchInterval: BARS_EVERY_MS[timeframe],
    retry: once,
  })
}

/** The connected wallet's Phoenix account, by its public address alone; nothing is read without one. */
export function useFuturesAccount(wallet: string | null) {
  return useQuery({
    queryKey: ['futures', 'account', wallet],
    queryFn: ({ signal }) => fetchFuturesAccount(wallet ?? '', signal),
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
    enabled: wallet !== null,
  })
}
