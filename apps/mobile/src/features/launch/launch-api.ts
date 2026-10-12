/**
 * Launch's routes (contract §3t, §3v, §3x, §3y, §3ad): one set for the web and the
 * phone, no bearer and no cookie — the creator's own signature inside a
 * transaction is the proof. Served only where `capabilities.launch` is
 * present; every build and send answers `LAUNCH_PAUSED` while Launch's stop
 * is closed, the reads answer always.
 */

import { apiGet, apiRequest } from '@/lib/api'
import type {
  LaunchBuildRequest,
  LaunchBuildResponse,
  LaunchClaimBuildResponse,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchCreatorResponse,
  LaunchJournalResponse,
  LaunchMarketCardResponse,
  LaunchMarketHealthResponse,
  LaunchMarketResponse,
  LaunchMarketsResponse,
  LaunchMetadataRequest,
  LaunchMetadataResponse,
  LaunchPresetId,
  LaunchPresetsResponse,
  LaunchQuoteResponse,
  LaunchSubmitRequest,
  LaunchSubmitResponse,
  LaunchTokenResponse,
  LaunchTradeBuildResponse,
  LaunchTradeQuoteResponse,
  LaunchTradeSide,
  LaunchTradeSubmitResponse,
  LaunchWalletResponse,
} from '@/lib/api/v1/types'

import type { ClaimApi, CreateApi, TradeApi } from './launch-flow'

/** A send waits on the network's confirmation; the server answers within its own window, the phone a little longer. */
const SEND_TIMEOUT_MS = 75_000
/** A market read walks the chain on a cold cache. */
const MARKET_TIMEOUT_MS = 30_000

const at = (mint: string) => `/api/v1/launch/${encodeURIComponent(mint)}`

export function fetchLaunchPresets(signal?: AbortSignal): Promise<LaunchPresetsResponse> {
  return apiGet('/api/v1/launch/presets', { signal })
}

export function quoteFirstBuy(
  preset: LaunchPresetId,
  amountRaw: string,
  signal?: AbortSignal,
): Promise<LaunchQuoteResponse> {
  return apiRequest('POST', '/api/v1/launch/quote', { preset, amountRaw }, { signal })
}

export function fetchLaunchToken(mint: string, signal?: AbortSignal): Promise<LaunchTokenResponse> {
  return apiGet(at(mint), { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

export function fetchLaunchMarket(mint: string, signal?: AbortSignal): Promise<LaunchMarketResponse> {
  return apiGet(`${at(mint)}/market`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

export function fetchLaunchCreator(mint: string, signal?: AbortSignal): Promise<LaunchCreatorResponse> {
  return apiGet(`${at(mint)}/creator`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

export function fetchLaunchWallet(mint: string, address: string, signal?: AbortSignal): Promise<LaunchWalletResponse> {
  return apiGet(`${at(mint)}/wallet/${encodeURIComponent(address)}`, { signal })
}

export function quoteLaunchTrade(
  mint: string,
  request: Readonly<{ side: LaunchTradeSide; amountRaw: string; slippageBps: number }>,
  signal?: AbortSignal,
): Promise<LaunchTradeQuoteResponse> {
  return apiRequest('POST', `${at(mint)}/trade/quote`, request, { signal })
}

/** «Лаунчі на Ryntra» (1.36.0): every market launched on Ryntra on this network — public, no wallet. */
export function fetchLaunchMarkets(signal?: AbortSignal): Promise<LaunchMarketsResponse> {
  return apiGet('/api/v1/launch/markets', { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

/** One market's row and the addresses it lives at (1.36.0). */
export function fetchLaunchMarketCard(mint: string, signal?: AbortSignal): Promise<LaunchMarketCardResponse> {
  return apiGet(`/api/v1/launch/markets/${encodeURIComponent(mint)}`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

/** A market's health by fixed definitions, and the rules that keep it (1.36.0). */
export function fetchLaunchHealth(mint: string, signal?: AbortSignal): Promise<LaunchMarketHealthResponse> {
  return apiGet(`${at(mint)}/health`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

/** A launch's flight log, the newest first (1.32.0; each entry's mark and the log's `total` since 1.36.0). */
export function fetchLaunchJournal(mint: string, signal?: AbortSignal): Promise<LaunchJournalResponse> {
  return apiGet(`${at(mint)}/journal`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

export function fetchCreatorCabinet(address: string, signal?: AbortSignal): Promise<LaunchCreatorCabinetResponse> {
  return apiGet(`/api/v1/launch/creators/${encodeURIComponent(address)}`, { signal, timeoutMs: MARKET_TIMEOUT_MS })
}

/** The launch's own calls, for `launchToken`. */
export const createApi: CreateApi = {
  metadata: (request: LaunchMetadataRequest) =>
    apiRequest<LaunchMetadataResponse>('POST', '/api/v1/launch/metadata', request, { timeoutMs: 30_000 }),
  build: (request: LaunchBuildRequest) =>
    apiRequest<LaunchBuildResponse>('POST', '/api/v1/launch/build', request, { timeoutMs: 30_000 }),
  submit: (request: LaunchSubmitRequest) =>
    apiRequest<LaunchSubmitResponse>('POST', '/api/v1/launch/submit', request, { timeoutMs: SEND_TIMEOUT_MS }),
  token: (mint: string) => fetchLaunchToken(mint),
}

/** A trade's calls on one token, for `tradeLaunch`. */
export function tradeApi(mint: string): TradeApi {
  return {
    build: (request) =>
      apiRequest<LaunchTradeBuildResponse>('POST', `${at(mint)}/trade/build`, request, { timeoutMs: 30_000 }),
    submit: (request) =>
      apiRequest<LaunchTradeSubmitResponse>('POST', `${at(mint)}/trade/submit`, request, {
        timeoutMs: SEND_TIMEOUT_MS,
      }),
  }
}

/** A claim's calls on one token, for `claimFees`. */
export function claimApi(mint: string): ClaimApi {
  return {
    build: (request) =>
      apiRequest<LaunchClaimBuildResponse>('POST', `${at(mint)}/claim/build`, request, { timeoutMs: 30_000 }),
    submit: (request) =>
      apiRequest<LaunchClaimSubmitResponse>('POST', `${at(mint)}/claim/submit`, request, {
        timeoutMs: SEND_TIMEOUT_MS,
      }),
  }
}
