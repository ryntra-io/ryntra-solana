import { useQuery } from '@tanstack/react-query'
import { useIsFocused } from 'expo-router'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import { useCapabilities } from '@/features/plans/use-plans'
import { useDebounced } from '@/hooks/use-debounced'
import { ApiError, isNotFound } from '@/lib/api'
import type { LaunchPresetId, LaunchTradeSide } from '@/lib/api/v1/types'

import {
  fetchCreatorCabinet,
  fetchLaunchCreator,
  fetchLaunchHealth,
  fetchLaunchJournal,
  fetchLaunchMarket,
  fetchLaunchMarketCard,
  fetchLaunchMarkets,
  fetchLaunchPresets,
  fetchLaunchToken,
  fetchLaunchWallet,
  quoteFirstBuy,
  quoteLaunchTrade,
} from './launch-api'

/** How often a token's market is read again while its page is open — the web's own pace. */
export const MARKET_REFRESH_MS = 20_000

/**
 * Whether Launch is served: `capabilities.launch` present (contract §3y).
 * `null` while the capabilities are being read, or when they could not be —
 * then `failed` with a way to read again; nothing is drawn on a guess.
 */
export function useLaunchOpen(): Readonly<{
  open: boolean | null
  network: string | null
  /** The markets' reads (1.36.0) where the server names them; absent before it — those sections are not drawn. */
  markets: boolean
  /** The flight log's read (1.32.0) where the server names it. */
  journal: boolean
  failed: boolean
  reading: boolean
  retry: () => void
}> {
  const capabilities = useCapabilities()
  const retry = () => void capabilities.refetch()
  if (!capabilities.data)
    return {
      open: null,
      network: null,
      markets: false,
      journal: false,
      failed: capabilities.isError,
      reading: capabilities.isFetching,
      retry,
    }
  const launch = capabilities.data.launch
  const markets = Boolean(launch?.markets && launch.marketCard && launch.health)
  const journal = Boolean(launch?.journal)
  return {
    open: Boolean(launch),
    network: launch?.network ?? null,
    markets,
    journal,
    failed: false,
    reading: false,
    retry,
  }
}

function subscribeAppState(onChange: () => void) {
  const subscription = AppState.addEventListener('change', onChange)
  return () => subscription.remove()
}

/**
 * Whether a page reads again on its own: its screen in front and the app in
 * the foreground. A page under another, or the app in the background, asks
 * nothing; `useReadWhenSeen` reads it again the moment it is seen.
 */
export function usePageLive(): boolean {
  const focused = useIsFocused()
  const active = useSyncExternalStore(subscribeAppState, () => AppState.currentState === 'active')
  return focused && active
}

/** Launch's operator stop seen on a quote: read again every half a minute while it lasts, so the form opens by itself. */
const PAUSED_RECHECK_MS = 30_000

export function useLaunchPresets(enabled = true) {
  return useQuery({
    queryKey: ['launch', 'presets'],
    queryFn: ({ signal }) => fetchLaunchPresets(signal),
    enabled,
    staleTime: 10 * 60_000,
    retry: 1,
  })
}

/**
 * The first buy quoted on the fresh curve as it is typed — also with nothing
 * typed, so a closed stop is known before the form is filled (`LAUNCH_PAUSED`).
 */
export function useFirstBuyQuote(preset: LaunchPresetId | null, amountRaw: bigint | null) {
  const key = useDebounced(amountRaw === null ? null : amountRaw.toString(), 300)
  return useQuery({
    queryKey: ['launch', 'quote', preset ?? '', key ?? ''],
    queryFn: ({ signal }) => quoteFirstBuy(preset!, key!, signal),
    enabled: preset !== null && key !== null,
    staleTime: 15_000,
    retry: (count, error) => !(error instanceof ApiError) && count < 1,
    refetchInterval: (query) =>
      query.state.error instanceof ApiError && query.state.error.code === 'LAUNCH_PAUSED' ? PAUSED_RECHECK_MS : false,
  })
}

/** A token's read; `settleMs` — read again at that pace until the chain answers, for a launch whose answer was lost. */
export function useLaunchToken(mint: string | null, settleMs?: number) {
  return useQuery({
    queryKey: ['launch', 'token', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchToken(mint!, signal),
    enabled: mint !== null,
    staleTime: 30_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
    refetchInterval: settleMs ? (query) => (query.state.data ? false : settleMs) : false,
  })
}

/** A token's market from the chain, read again every twenty seconds while the page is open. */
export function useLaunchMarket(mint: string | null) {
  return useQuery({
    queryKey: ['launch', 'market', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchMarket(mint!, signal),
    enabled: mint !== null,
    staleTime: 10_000,
    refetchInterval: MARKET_REFRESH_MS,
    retry: 1,
  })
}

/** The creator's other launches — read after the market, never before it. */
export function useLaunchCreator(mint: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['launch', 'creator', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchCreator(mint!, signal),
    enabled: mint !== null && enabled,
    staleTime: 60_000,
    retry: 1,
  })
}

/** What a wallet holds of the token and of its pair currency — for «Макс» and a sale's shares. */
export function useLaunchWallet(mint: string | null, address: string | null) {
  return useQuery({
    queryKey: ['launch', 'wallet', mint ?? '', address ?? ''],
    queryFn: ({ signal }) => fetchLaunchWallet(mint!, address!, signal),
    enabled: mint !== null && address !== null,
    staleTime: 15_000,
    retry: 1,
  })
}

/** A trade counted as the amount is typed. */
/**
 * A trade quoted as it is typed. `askedRaw` is the amount the quote in view was asked for (the typed one once the typing
 * settles), so the panel tells its own answer from an older one by the request — never by the answer's amount, which on
 * a curve near its threshold is less than the amount asked (`amountLeftRaw`).
 */
export function useTradeQuote(mint: string, side: LaunchTradeSide, amountRaw: bigint | null, slippageBps: number) {
  const key = useDebounced(amountRaw !== null && amountRaw > 0n ? amountRaw.toString() : null, 350)
  const quote = useQuery({
    queryKey: ['launch', 'trade-quote', mint, side, key ?? '', slippageBps],
    queryFn: ({ signal }) => quoteLaunchTrade(mint, { side, amountRaw: key!, slippageBps }, signal),
    enabled: key !== null,
    staleTime: 10_000,
    retry: (count, error) => !(error instanceof ApiError) && count < 1,
  })
  return { quote, askedRaw: key }
}

/** «Мої лаунчі»: the wallet's launches and what they earned it — public data, read by the connected wallet's address. */
export function useCreatorCabinet(address: string | null) {
  return useQuery({
    queryKey: ['launch', 'cabinet', address ?? ''],
    queryFn: ({ signal }) => fetchCreatorCabinet(address!, signal),
    enabled: address !== null,
    staleTime: 15_000,
    retry: 1,
  })
}

/** How often «Лаунчі на Ryntra» is read again while it is in view — sooner while some market was not read yet, so its row fills in. */
export const MARKETS_REFRESH_MS = 60_000
export const MARKETS_FILL_MS = 8_000

/**
 * «Лаунчі на Ryntra»: public, read again every minute — every eight seconds
 * while a market was not read in time — and only while `live`.
 */
export function useLaunchMarkets(enabled = true, live = true) {
  return useQuery({
    queryKey: ['launch', 'markets'],
    queryFn: ({ signal }) => fetchLaunchMarkets(signal),
    enabled,
    staleTime: 15_000,
    retry: 1,
    refetchInterval: (query) =>
      !live ? false : query.state.data && !query.state.data.complete ? MARKETS_FILL_MS : MARKETS_REFRESH_MS,
  })
}

/** One market's row and its addresses. */
export function useLaunchMarketCard(mint: string | null) {
  return useQuery({
    queryKey: ['launch', 'market-card', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchMarketCard(mint!, signal),
    enabled: mint !== null,
    staleTime: 60_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
  })
}

/** A read older than this was answered from the server's last good one while it reads the chain again: asked once more soon. */
const HEALTH_OLD_MS = 60_000
const HEALTH_AGAIN_MS = 20_000
const HEALTH_REFRESH_MS = 60_000

/**
 * A market's health — read after the market, again every minute while the
 * page is seen, and once more twenty seconds after an answer that was an
 * older read standing in while the server reads the chain again — once per
 * read, never in a loop.
 */
export function useLaunchHealth(mint: string | null, live = true) {
  const query = useQuery({
    queryKey: ['launch', 'health', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchHealth(mint!, signal),
    enabled: mint !== null,
    staleTime: 15_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
    refetchInterval: live ? HEALTH_REFRESH_MS : false,
  })
  const followed = useRef<string | null>(null)
  const { data, dataUpdatedAt, refetch } = query
  useEffect(() => {
    if (!data || !live || followed.current === data.observedAt) return
    if (dataUpdatedAt - Date.parse(data.observedAt) <= HEALTH_OLD_MS) return
    const observedAt = data.observedAt
    // Marked followed only once the follow-up is sent: a timer cleared before it fires leaves it to the next run.
    const timer = setTimeout(() => {
      followed.current = observedAt
      void refetch()
    }, HEALTH_AGAIN_MS)
    return () => clearTimeout(timer)
  }, [data, dataUpdatedAt, live, refetch])
  useReadWhenSeen(live && mint !== null, refetch)
  return query
}

const JOURNAL_REFRESH_MS = 60_000

/**
 * A launch's flight log — read after the market, again every minute while
 * the page is seen and at once when it is seen again; the page also reads it
 * when the trades or the way to the DEX change.
 */
export function useLaunchJournal(mint: string | null, live = true) {
  const query = useQuery({
    queryKey: ['launch', 'journal', mint ?? ''],
    queryFn: ({ signal }) => fetchLaunchJournal(mint!, signal),
    enabled: mint !== null,
    staleTime: 15_000,
    retry: (count, error) => !isNotFound(error) && count < 1,
    refetchInterval: live ? JOURNAL_REFRESH_MS : false,
  })
  useReadWhenSeen(live && mint !== null, query.refetch)
  return query
}

/** A page seen again — its screen back in front, the app back in the foreground — reads at once, not a minute later. */
export function useReadWhenSeen(live: boolean, refetch: () => unknown) {
  const was = useRef(live)
  useEffect(() => {
    if (live && !was.current) void refetch()
    was.current = live
  }, [live, refetch])
}
