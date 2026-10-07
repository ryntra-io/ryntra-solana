import { useQuery } from '@tanstack/react-query'

import { useCapabilities } from '@/features/plans/use-plans'
import { useDebounced } from '@/hooks/use-debounced'
import { ApiError, isNotFound } from '@/lib/api'
import type { LaunchPresetId, LaunchTradeSide } from '@/lib/api/v1/types'

import {
  fetchCreatorCabinet,
  fetchLaunchCreator,
  fetchLaunchMarket,
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
  failed: boolean
  reading: boolean
  retry: () => void
}> {
  const capabilities = useCapabilities()
  const retry = () => void capabilities.refetch()
  if (!capabilities.data)
    return { open: null, network: null, failed: capabilities.isError, reading: capabilities.isFetching, retry }
  const launch = capabilities.data.launch
  return { open: Boolean(launch), network: launch?.network ?? null, failed: false, reading: false, retry }
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
export function useTradeQuote(mint: string, side: LaunchTradeSide, amountRaw: bigint | null, slippageBps: number) {
  const key = useDebounced(amountRaw !== null && amountRaw > 0n ? amountRaw.toString() : null, 350)
  return useQuery({
    queryKey: ['launch', 'trade-quote', mint, side, key ?? '', slippageBps],
    queryFn: ({ signal }) => quoteLaunchTrade(mint, { side, amountRaw: key!, slippageBps }, signal),
    enabled: key !== null,
    staleTime: 10_000,
    retry: (count, error) => !(error instanceof ApiError) && count < 1,
  })
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
