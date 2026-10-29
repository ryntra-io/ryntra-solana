/**
 * The one door to the Ryntra API. The app has no financial logic of its own:
 * every figure, quote and receipt comes from `ryntra.io`. The public routes
 * are called as they are; the native contract (v1 — sign-in, session,
 * watchlist) goes through the client the web line publishes, pinned by
 * content in `./api/v1` (see PIN.json) and never edited here.
 */

import type { SiwsVerifyBody } from '@/features/session/siws'

import { bearerOf } from './session-bearer.ts'
import { createRyntraApiClient, RyntraApiError, RyntraRouteError, type RyntraApiClient } from './api/v1/client.ts'
import {
  API_CONTRACT_VERSION,
  type AgentBudgetState,
  type AgentDraftResponse,
  type AgentMessageRequest,
  type AgentGuestRequest,
  type AgentGuestResponse,
  type AgentMessageResponse,
  type AgentSessionListResponse,
  type AgentSessionOpenRequest,
  type AddressEvidenceRead,
  type AgentBriefResponse,
  type AgentCriticResponse,
  type AgentLensRequest,
  type AssistantBriefResponse,
  type AssistantBriefUpdate,
  type AssistantCreditOrderRequest,
  type AssistantMemoryUpdate,
  type AssistantPlanCreate,
  type AssistantPlanRecheck,
  type AssistantPlanStateRequest,
  type AssistantPlanUpdate,
  type AssistantProfileUpdate,
  type AssistantTaskCreate,
  type AssistantTaskUpdate,
  type AssistantVoiceRequest,
  type AssistantWatchCreate,
  type AssistantWatchUpdate,
  type AgentSessionResponse,
  type ApiClient,
  type ApiSession,
  type Capabilities,
  type ChallengeResponse,
  type ExecutionPlanBinding,
  type PayLinkCreateRequest,
  type PayLinkListResponse,
  type PayLinkResponse,
  type PaySubmitRequest,
  type PaySubmitResponse,
  type PayTransactionRequest,
  type PayTransactionResponse,
  type PlanAssetRead,
  type PlanCreateRequest,
  type PlanListResponse,
  type PlanResponse,
  type PlanMemoryResponse,
  type PlanResultsResponse,
  type PlanReview,
  type PlanStatusRequest,
  type PlanUpdateRequest,
  type PlanVersionResponse,
  type PopularCompaniesResponse,
  type RecipientCheckQuery,
  type RecipientCheckResponse,
  type RuleBinding,
  type RuleBudgetRequest,
  type RuleBudgetResponse,
  type RuleCreateRequest,
  type RuleDeleteResponse,
  type RuleListResponse,
  type RuleOccurrenceState,
  type RulePaymentOwnRequest,
  type RuleAssetResponse,
  type RuleResponse,
  type RuleStatus,
  type SeekerCheckResponse,
  type SendReturnedRequest,
  type SendReturnedResponse,
  type SkrNameRead,
  type SwapCheck,
  type TelegramChannelResponse,
  type TransferAdoptResponse,
  type TransferPlanRequest,
  type TransferRecoverResponse,
  type TransferReviewResponse,
  type TransferSettleRequest,
  type TransferSettleResponse,
  type VerifyResponse,
  type WatchlistMergeResponse,
  type WatchlistResponse,
} from './api/v1/types.ts'

export const API_BASE_URL = 'https://ryntra.io'
const REQUEST_TIMEOUT_MS = 12_000

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  /** Only on `UNSUPPORTED_CLIENT`: the app version the server needs. */
  readonly minimumAppVersion: string | null
  /** The rest of the server's error object — a swap refusal's `submitBoundary`, `ownerLock`, `planReview`. */
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: string,
    message: string,
    status: number,
    minimumAppVersion: string | null = null,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.minimumAppVersion = minimumAppVersion
    this.details = details
  }
}

/** True when the failure came from the network or a timeout, not from the server. */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError)
}

/** A 404 from the market or stock routes: the address is not a market Ryntra knows. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** True when the server refused the session: expired, revoked, or another wallet's. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

/** The bearer is dead on the server — absent, expired or revoked — and only a new signature brings one back. */
export function needsSignIn(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'UNAUTHORIZED' || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_REVOKED')
  )
}

type FailureBody = { error?: ({ code?: unknown; message?: unknown } & Record<string, unknown>) | string }

/**
 * The verified session of one wallet: what the server issued after the
 * wallet signed its message. The token is read here, sent as a bearer on
 * private requests, kept in the device's secure store and never logged. It
 * is not the Mobile Wallet Adapter auth token — that one authorizes the
 * wallet to this app and never reaches the API.
 */
export type Session = Readonly<{
  address: string
  token: string
  issuedAt: string
  expiresAt: string
  sessionId: string | null
}>

export type ApiInit = Readonly<{
  signal?: AbortSignal
  /** A private request carries the session's bearer; a public one carries nothing. */
  session?: Session | null
  /** The language a route that speaks reads from `Accept-Language`. */
  acceptLanguage?: 'en' | 'uk'
  /** A route known to answer slowly when its cache is cold waits this long instead of the default. */
  timeoutMs?: number
}>

/**
 * What the phone says it reads beyond what its pinned contract's first reader
 * knew (1.31.0): a token's price condition against the price when its rule
 * was turned on — the reference `enabled`, which the server sends a native
 * client only behind this header (the phone of 1.30.0 would not know it).
 */
export const READS_HEADER: Readonly<Record<string, string>> = { 'X-Ryntra-Reads': 'rule-reference-enabled' }

/** The longest wait a refusal's headers may name that the phone carries on (seconds). */
export const RETRY_AFTER_MAX_SECONDS = 60

/**
 * The wait a refused response names in its headers, in whole seconds (0 … `RETRY_AFTER_MAX_SECONDS`), or null.
 * The server's limit answers 429 with the wait only in headers: `Retry-After` (seconds, or an HTTP date), else
 * `Ratelimit-Reset` (seconds until the window resets; a Unix time in seconds is read as such).
 */
export function retryAfterSecondsOf(
  headers: Readonly<{ get(name: string): string | null }> | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!headers) return null
  const fromRetryAfter = waitOf(headers.get('retry-after'), nowMs, true)
  const seconds = fromRetryAfter ?? waitOf(headers.get('ratelimit-reset'), nowMs, false)
  if (seconds === null) return null
  return Math.min(RETRY_AFTER_MAX_SECONDS, Math.max(0, Math.ceil(seconds)))
}

/** Unix seconds beyond this are a moment, not a delay (2001-09-09). */
const EPOCH_SECONDS_FLOOR = 1_000_000_000

function waitOf(raw: string | null, nowMs: number, dateAllowed: boolean): number | null {
  const value = raw?.trim()
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    return n >= EPOCH_SECONDS_FLOOR ? n - nowMs / 1000 : n
  }
  if (!dateAllowed) return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? (at - nowMs) / 1000 : null
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  init: ApiInit = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS)
  init.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const headers: Record<string, string> = { accept: 'application/json', 'X-Ryntra-API': '1', ...READS_HEADER }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (init.session) headers.authorization = `Bearer ${bearerOf(init.session)}`
    if (init.acceptLanguage) headers['accept-language'] = init.acceptLanguage
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      let failure: FailureBody = {}
      try {
        failure = (await response.json()) as FailureBody
      } catch {
        failure = {}
      }
      const error = typeof failure.error === 'string' ? { code: undefined, message: failure.error } : failure.error
      const code = typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`
      const message = typeof error?.message === 'string' ? error.message : 'The request did not succeed.'
      const { code: _code, message: _message, ...bodyDetails } = error ?? {}
      // A wait the body names is kept as the server said it; else the one its headers name (429 says it only there).
      const headerWait = retryAfterSecondsOf(response.headers)
      const details =
        headerWait !== null &&
        !(typeof bodyDetails.retryAfterSeconds === 'number' && Number.isFinite(bodyDetails.retryAfterSeconds))
          ? { ...bodyDetails, retryAfterSeconds: headerWait }
          : bodyDetails
      throw new ApiError(code, message, response.status, null, details)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function apiGet<T>(path: string, init: ApiInit = {}): Promise<T> {
  return apiRequest<T>('GET', path, undefined, init)
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** A Solana mint address as the API accepts it. */
export function isMint(value: unknown): value is string {
  return typeof value === 'string' && BASE58.test(value)
}

/* ---- Markets (available now, wallet-free) ---- */

export const MARKET_VIEWS = ['all', 'stock', 'crypto', 'meme'] as const
export type MarketView = (typeof MARKET_VIEWS)[number]

export type MarketCategory = 'stock' | 'crypto' | 'meme' | (string & {})

export type MarketIssuer = Readonly<{ label: string; tag: string }>

export type MarketRow = Readonly<{
  mint: string
  symbol: string
  name: string
  icon: string | null
  decimals: number | null
  price: number | null
  change24hPct: number | null
  volume24hUsd: number | null
  liquidityUsd: number | null
  verified: boolean
  suspicious: boolean
  category: MarketCategory | null
  issuer: MarketIssuer | null
}>

export type MarketsResponse = Readonly<{
  rows: readonly MarketRow[]
  /** When the server observed these figures — every row's time. */
  observedAt: string
  /** The server could not refresh in time and served what it had. */
  stale: boolean
  /** A category list the universe never filled — shown, but said. */
  partial?: boolean
  source?: Readonly<{ label: string; tier: string }>
}>

export function fetchMarkets(view: MarketView, limit = 100, signal?: AbortSignal): Promise<MarketsResponse> {
  return apiGet<MarketsResponse>(`/api/spot/markets?view=${view}&limit=${limit}`, { signal })
}

/** The venue's catalogue searched by symbol, name or mint — copies included, labelled unverified. */
export function searchMarkets(query: string, limit = 40, signal?: AbortSignal): Promise<MarketsResponse> {
  return apiGet<MarketsResponse>(`/api/spot/markets?q=${encodeURIComponent(query)}&limit=${limit}`, { signal })
}

export type MarketsByMintResponse = Readonly<{
  rows: readonly MarketRow[]
  /** Mints the venue no longer lists — the watchlist keeps them, the list says so. */
  missing: readonly string[]
  observedAt: string
  stale: boolean
}>

/** Rows for a list of mints, in the order given — the watchlist's read. */
export function fetchMarketsByMints(mints: readonly string[], signal?: AbortSignal): Promise<MarketsByMintResponse> {
  return apiGet<MarketsByMintResponse>(`/api/spot/markets?mints=${mints.join(',')}`, { signal })
}

/* ---- One market ---- */

export type MarketStats = Readonly<{
  priceChangePct: number | null
  volumeUsd: number | null
  buys: number | null
  sells: number | null
  traders: number | null
}>

export type MarketDetail = Readonly<{
  mint: string
  symbol: string
  name: string
  icon: string | null
  decimals: number | null
  tokenProgram: string | null
  price: number | null
  change24hPct: number | null
  change1hPct: number | null
  volume24hUsd: number | null
  liquidityUsd: number | null
  marketCapUsd: number | null
  fdvUsd: number | null
  holders: number | null
  organicScore: number | null
  organicScoreLabel: string | null
  verified: boolean
  tags: readonly string[]
  category: MarketCategory | null
  issuer: MarketIssuer | null
  firstPoolAt: string | null
  audit: Readonly<{
    mintAuthorityDisabled: boolean | null
    freezeAuthorityDisabled: boolean | null
    topHoldersPct: number | null
    devBalancePct: number | null
    suspicious: boolean
  }>
  links: Readonly<{ website: string | null; twitter: string | null; telegram: string | null }>
  stats: Readonly<{ h1: MarketStats; h24: MarketStats }>
  updatedAt: string | null
}>

export type MarketDetailResponse = Readonly<{
  /** Null when the venue does not list the mint. */
  market: MarketDetail | null
  observedAt: string
  stale: boolean
}>

export function fetchMarket(mint: string, signal?: AbortSignal): Promise<MarketDetailResponse> {
  return apiGet<MarketDetailResponse>(`/api/spot/market?mint=${mint}`, { signal })
}

/* ---- Candles ---- */

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

/** How long the server keeps a read of each timeframe fresh; the app asks no more often. */
export const TIMEFRAME_TTL_MS: Readonly<Record<Timeframe, number>> = {
  '1m': 20_000,
  '5m': 45_000,
  '15m': 60_000,
  '1h': 120_000,
  '4h': 300_000,
  '1d': 600_000,
}

export type Candle = Readonly<{
  /** Unix seconds, the bar's open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}>

export type Pool = Readonly<{
  address: string
  name: string
  dex: string | null
  side: 'base' | 'quote'
  reserveUsd: number | null
  volume24hUsd: number | null
}>

export type CandlesResponse = Readonly<{
  timeframe: Timeframe
  /** Oldest first; the last bar may still be forming. */
  candles: readonly Candle[]
  pool: Pool
  observedAt: string
  stale: boolean
  source: Readonly<{ label: string; url: string }>
}>

export function fetchCandles(mint: string, timeframe: Timeframe, signal?: AbortSignal): Promise<CandlesResponse> {
  return apiGet<CandlesResponse>(`/api/spot/candles?mint=${mint}&tf=${timeframe}`, { signal })
}

/* ---- Stocks (the web line's ---- */

export type StockIssuerId = 'xstocks' | 'backpack' | 'ondo' | 'prestocks' | (string & {})

/** The issuer's own trading period for a representation. */
export type SessionPeriod = 'market' | 'extended' | 'overnight' | 'closed' | 'unknown'

export type ReferenceState = 'current' | 'last-available' | 'confirmed-close' | 'stale' | 'unavailable'

export type StockReference = Readonly<{
  state: ReferenceState
  /** Per underlying share, in `currency`; null when unavailable. */
  perShare: number | null
  currency: string
  source: Readonly<{ id: string; label: string }>
  /** When the source observed the figure, when it said. */
  observedAt: string | null
  /** When Ryntra fetched it. */
  fetchedAt: string | null
  note: string | null
}>

export type StockSession = Readonly<{
  period: SessionPeriod
  exchangeOpen: boolean | null
  nextChangeAt: string | null
  exchange: Readonly<{ mic: string; name: string; timezone: string }> | null
  source: string
}>

export type Multiplier = Readonly<{
  /** The multiplier in force now; 1 until the first corporate event. */
  current: number
  pending: number | null
  effectiveAt: string | null
}>

export type MultiplierState = 'active' | 'pending' | 'activation-window'

/** The unit a plan and a Review price the asset in: a listed stock per underlying share, a pre-IPO token per token. */
export type UnitBasis = 'share' | 'token'

export type StockInstrument = Readonly<{
  class: 'listed-equity' | 'pre-ipo' | (string & {})
  unitBasis: UnitBasis
  rights?: string
}>

export type StockRow = Readonly<{
  representation: Readonly<{
    mint: string
    symbol: string
    name: string
    issuer: Readonly<{ id: StockIssuerId; label: string; catalogue: boolean }>
    issuerConfirmation: string
    /** Absent on rows written before the pre-IPO issuers; a missing instrument is a listed share. */
    instrument?: StockInstrument | null
    underlying: Readonly<{ symbol: string; isin: string | null; listingCountry: string | null; name: string | null }>
    /** The company across issuers, where the universe names one — two issuers' private tokens on one company share it. */
    companyKey?: string | null
    exchange: Readonly<{ mic: string; name: string; timezone: string }> | null
    tokenProgram: string | null
    decimals: number | null
    tradingHalted: boolean | null
    sources: readonly string[]
  }>
  market: Readonly<{
    priceUsd: number | null
    change24hPct: number | null
    volume24hUsd: number | null
    liquidityUsd: number | null
    verified: boolean
    observedAt: string | null
    icon: string | null
  }>
  /** Per underlying share, USD — the token price through the multiplier. */
  tokenPerShareUsd: number | null
  multiplier: Multiplier | null
  multiplierState: MultiplierState | null
  reference: StockReference
  session: StockSession
  /** On the list basis: token per share against the reference. An orientation, not a quote. */
  deviationPct: number | null
  /** A private company's token: the issuer's own mark of one token and of the company, dated by Ryntra's fetch. */
  issuerMark?: Readonly<{
    source: Readonly<{ id: string; label: string }>
    perUnit: number | null
    valuationUsd: number | null
    fetchedAt: string
    stale: boolean
  }> | null
  /** The token's market price against the issuer's mark of one token, per cent — never a reason to trade. */
  markPremiumPct?: number | null
  /** The fee the mint withholds on every transfer, from its own config on the chain; null when it has none. */
  transferFee?: Readonly<{
    basisPoints: number
    /** The most withheld on one transfer, raw; `u64::MAX` means no cap. */
    maximumFeeRaw: string
    configUsed: 'NEWER' | 'OLDER'
  }> | null
  /** Where the token stands in its issuer's life for it — whether a purchase is offered now, and an issuer's window with its cut-off; absent on older rows. */
  lifecycle?: StockLifecycle | null
  /**
   * 1.17.0: the company's path from the private token to its listed share, where there is one to say — the private
   * token's swap window among it (`swap`, the IPO and conversion watch); null or absent otherwise.
   */
  companyPath?: CompanyPath | null
}>

/**
 * The lifecycle of a mint as the stock routes state it: `conversion-open` — the issuer opened a window to swap
 * the token before `deadline`, after which it expires worthless (PreStocks' SPACEX, 1.15.0); `expired` — the window
 * closed; `tradable` is whether Ryntra offers a new purchase now.
 */
export type StockLifecycle = Readonly<{
  state: 'active' | 'paused' | 'conversion-open' | 'redeem-only' | 'expired' | 'unknown' | (string & {})
  tradable: boolean
  source?: string
  observedAt?: string | null
  /** The issuer's own notice, when the state comes from a verified event. */
  url?: string | null
  recheckBy?: string | null
  /** The issuer's own cut-off for the window, ISO. */
  deadline?: string | null
  note?: string | null
}>

/** A token of a company's path — the private token, the listed share's token, or one a swap leaves or lands in. */
export type PathToken = Readonly<{ mint: string; symbol: string }>

/**
 * One step of a company's path (1.17.0): `private` → `ipo` → `exchange` → `solana`, each `passed`, `current` or
 * `unannounced`, with its day (`YYYY-MM-DD` — the private token's first pool, the first trading day, the listing, the
 * listed token on Solana; null where none is recorded).
 */
export type CompanyPathStep = Readonly<{
  step: 'private' | 'ipo' | 'exchange' | 'solana' | (string & {})
  state: 'passed' | 'current' | 'unannounced' | (string & {})
  date: string | null
  /** The IPO's offering price per share, USD — the `ipo` step only. */
  priceUsd?: number | null
  /** The exchange and the ticker — the `exchange` step only. */
  exchange?: string | null
  ticker?: string | null
  /** The token at this step — the private token, or the listed share's token on Solana; null on the steps between. */
  token?: PathToken | null
}>

/** Where a fact of the path was read: the source's name, its page, the document's own day and the day Ryntra read it. */
export type PathSource = Readonly<{ label: string; url: string; publishedAt: string | null; readAt: string }>

/**
 * 1.17.0 «Шлях компанії»: the company's way from a private token to its stock on Solana and the step this token
 * stands at (`at`); `swap` is the private token's cut-off once the company has gone public, `swapMonths` the
 * issuer's rule while it has not.
 */
export type CompanyPath = Readonly<{
  at: 'private' | 'solana' | (string & {})
  steps: readonly CompanyPathStep[]
  /** The private token's swap into the listed token, with the issuer's cut-off; `open` judged by the server's clock when it answered. */
  swap: Readonly<{ from: PathToken; into: PathToken | null; deadline: string; open: boolean }> | null
  /** After an IPO, up to this many months to swap the token — while the company is private; null once it has gone public. */
  swapMonths?: number | null
  sources?: readonly PathSource[]
  /** The version of the server's registry the path was read from. */
  version?: string
}>

export type OnchainMint = Readonly<{
  programKind: string
  decimals: number
  supplyRaw: string
  mintAuthority: string | null
  freezeAuthority: string | null
  extensions: readonly string[]
  scaledUi: Readonly<{
    multiplier: number
    newMultiplier: number
    newMultiplierEffectiveAt: string | null
    authority: string
  }> | null
  observedAt: string
  slot: string | null
}>

export type StockReserves = Readonly<{
  symbol: string
  sharesHeld: string
  circulatingSupply: string
  observedAt: string
  custodians: readonly string[]
}>

export type StockAsset = Readonly<{
  row: StockRow
  onchain: OnchainMint | Readonly<{ error: string }>
  chainMultiplier: Multiplier | null
  chainMultiplierState: MultiplierState | null
  issuerMultiplier: Multiplier | null
  multiplierAgreement: 'agree' | 'differ' | 'unknown'
  reserves: StockReserves | null
  pool: Pool | null
  fetchedAt: string
}>

/** One confirmed stock representation in full, by its token symbol or mint. */
export function fetchStockAsset(ticker: string, signal?: AbortSignal): Promise<StockAsset> {
  return apiGet<StockAsset>(`/api/stocks/asset?ticker=${encodeURIComponent(ticker)}`, { signal })
}

export type StockSide = 'BUY' | 'SELL'

/** Example amounts for orientation; the Review in Trade quotes the real amount again. */
export const STOCK_QUOTE_PRESETS_USD = [100, 1000, 10000] as const
export const STOCK_QUOTE_MIN_USD = 1
export const STOCK_QUOTE_MAX_USD = 1_000_000

export type StockQuote = Readonly<{
  mint: string
  symbol: string
  side: StockSide
  /** The USD leg as quoted: paid on a Buy, arriving on a Sell. */
  usd: number
  tokenRaw: string
  /** The token leg in underlying units through the multiplier — a share count only when the multiplier is known. */
  tokenScaled: string
  multiplier: number | null
  executablePerShare: number | null
  reference: StockReference
  deviationPct: number | null
  priceImpactPct: string
  feeBasisPoints: number
  slippageBps: number
  router: string
  observedAt: string
  reviewExpiresAt: string
  source: Readonly<{ label: string }>
}>

/** The size-aware quote: `usd` of a stock token on a side, quote-only, nothing here can be signed. */
export function fetchStockQuote(
  input: Readonly<{ ticker: string; side: StockSide; usd: number }>,
  signal?: AbortSignal,
): Promise<StockQuote> {
  // Cents, as typed: the route takes a decimal sum, and the card says the sum it was quoted for (ST-5 r8).
  const usd = Math.round(input.usd * 100) / 100
  return apiGet<StockQuote>(
    `/api/stocks/quote?ticker=${encodeURIComponent(input.ticker)}&side=${input.side}&usd=${usd}`,
    { signal },
  )
}

/** The stock universe as the list draws it: identity, figures and states, one row per confirmed representation. */
export type StockUniverseRow = Readonly<{
  mint: string
  symbol: string
  /** The company or fund where the issuer names it, else the token's own name. */
  name: string
  issuer: StockIssuerId
  unitBasis?: UnitBasis
  icon: string | null
  halted: boolean
  price: number | null
  change24h: number | null
  reference: number | null
  referenceState: ReferenceState
  referenceAt: string | null
  deviation: number | null
  period: SessionPeriod
  volume: number | null
  liquidity: number | null
  /** `listed-equity` or `pre-ipo` — a private company's token (PreStocks), «Це не акція» (request 26, served since 2026-09-23). */
  kind?: 'listed-equity' | 'pre-ipo' | (string & {})
  /** Whether the issuer offers a new purchase; absent reads as offered. */
  tradable?: boolean
  /** A private company's token against PreStocks' own valuation, per cent; null for a listed stock. */
  markPremium?: number | null
}>

export type StockUniverseResponse = Readonly<{
  rows: readonly StockUniverseRow[]
  fetchedAt: string
}>

export function fetchStockUniverse(signal?: AbortSignal): Promise<StockUniverseResponse> {
  return apiGet<StockUniverseResponse>('/api/stocks/universe?shape=slim', { signal })
}

/** The whole universe: every confirmed representation with its underlying, the issuer's confirmation and its lifecycle. */
export type StockUniverseFull = Readonly<{
  rows: readonly StockRow[]
  /** When the market was read. */
  fetchedAt: string
}>

/**
 * The universe in full — what the companies' shelf is built from (one company,
 * one card, grouped by the underlying the slim rows do not carry). The route
 * builds it in about twenty seconds when its cache is cold, so this read waits
 * longer than the others.
 */
export function fetchStockUniverseFull(signal?: AbortSignal): Promise<StockUniverseFull> {
  return apiGet<StockUniverseFull>('/api/stocks/universe', { signal, timeoutMs: 35_000 })
}

/* ---- Native session and private routes (contract 1.3.0 — the client pinned in./api/v1) ---- */

/**
 * The v1 client for one request: the pinned package over the app's fetch with
 * its timeout, the bearer of exactly the session handed in — or none. Every
 * refusal comes back as this module's `ApiError` with the server's stable
 * code, and a network failure stays a plain error, so `isNetworkError` and
 * `isUnauthorized` read the same for every route in the app.
 */
function v1Client(
  session: Session | null,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
  headers?: Readonly<Record<string, string>>,
): RyntraApiClient {
  return createRyntraApiClient({
    baseUrl: API_BASE_URL,
    ...(headers ? { headers } : {}),
    token: () => (session ? bearerOf(session) : null),
    fetch: async (input, init) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      signal?.addEventListener('abort', () => controller.abort(), { once: true })
      try {
        const headers = new Headers(init?.headers)
        for (const [name, value] of Object.entries(READS_HEADER)) headers.set(name, value)
        return await fetch(input, { ...init, headers, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
    },
  })
}

/** A pinned-client refusal — a v1 route's or a consumed route's — into the app's error; a network failure is rethrown as the plain error it is. */
async function v1<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof RyntraApiError) {
      if (error.code === 'NETWORK') throw new Error(error.message)
      throw new ApiError(error.code, error.message, error.status, error.minimumAppVersion)
    }
    // A route outside /api/v1 (the transfer and the link's own routes) refuses in its own shape — kept whole as details.
    if (error instanceof RyntraRouteError) {
      if (error.code === 'NETWORK') throw new Error(error.message)
      const { code: _code, message: _message, ...details } = error.details ?? {}
      throw new ApiError(error.code, error.message, error.status, null, details)
    }
    throw error
  }
}

/**
 * A model's own citation marker — `\uE200c1\uE202c2\uE201`, ids and their separators only — with the space before it;
 * one that never closes (a server cut it short) ends at the next space or the text's end, so it takes no word with it.
 * Then any character of the private-use area left over.
 */
const MODEL_MARKER = /[ \t]*\uE200[\w\uE202-]{0,200}(?:\uE201|(?=\s|$))/g
const PRIVATE_USE = /[\uE000-\uF8FF]/g

/**
 * The words of a text as a person reads them: the markers a model writes for its sources sit in the private-use
 * area, which every font draws as empty boxes — dropped with the space before them, nothing else touched. A sentence's
 * sources are its own `cites`. Text without them comes back as it was.
 */
export function spokenText(text: string): string {
  if (!/[\uE000-\uF8FF]/.test(text)) return text
  return text.replace(MODEL_MARKER, '').replace(PRIVATE_USE, '')
}

/** Fields matched byte for byte against other routes (a plan's symbol, a trigger): never rewritten. */
const KEPT_AS_SENT: ReadonlySet<string> = new Set(['id', 'label', 'context', 'triggerId', 'href'])

/** Every string of an answer through `spokenText` — the assistant's routes and the notes, whose words a model may write. */
export function spokenWords<T>(value: T): T {
  if (typeof value === 'string') return spokenText(value) as T
  if (Array.isArray(value)) return value.map((item) => spokenWords(item)) as T
  // Plain objects only: bytes, dates and anything with a prototype of its own pass untouched.
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = KEPT_AS_SENT.has(key) ? item : spokenWords(item)
    return out as T
  }
  return value
}

/** `v1` for the assistant's routes: the answer's words as a person reads them (`spokenWords`). */
async function v1Words<T>(work: () => Promise<T>): Promise<T> {
  return spokenWords(await v1(work))
}

/** Who is asking: the contract's `client` on the challenge and the verify — platform, the app's version, its package. */
export type ApiClientIdentity = ApiClient

export type SessionChallenge = ChallengeResponse

/** What a sign-in or a refresh grants, flattened for the device: the bearer beside the session it belongs to. */
export type SessionGrant = Readonly<{
  token: string
  address: string
  issuedAt: string
  expiresAt: string
  sessionId: string
}>

function grantFrom(answer: VerifyResponse): SessionGrant {
  return {
    token: answer.accessToken,
    address: answer.session.address,
    issuedAt: answer.session.issuedAt,
    expiresAt: answer.session.expiresAt,
    sessionId: answer.session.id,
  }
}

export type SessionApi = Readonly<{
  /** The contract version the pinned client implements. */
  version: string
  /** The server-built sign-in input and the exact text the wallet signs. */
  challenge: (address: string, signal?: AbortSignal) => Promise<SessionChallenge>
  /** The signed message and signature for a bearer session. */
  verify: (body: SiwsVerifyBody, signal?: AbortSignal) => Promise<SessionGrant>
  /** The session as the server holds it — or `UNAUTHORIZED` · `SESSION_EXPIRED` · `SESSION_REVOKED`. */
  resolve: (session: Session, signal?: AbortSignal) => Promise<ApiSession>
  /** A fresh bearer for the same wallet while this one is still valid; the old one is revoked as replaced. */
  refresh: (session: Session, signal?: AbortSignal) => Promise<SessionGrant>
  /** Sign out on the server; idempotent. */
  revoke: (session: Session, signal?: AbortSignal) => Promise<void>
}>

/** The session API over the pinned client, for one client identity. Pure until a method is called. */
export function createSessionApi(identity: ApiClientIdentity): SessionApi {
  return {
    version: API_CONTRACT_VERSION,
    challenge: (address, signal) =>
      v1(() => v1Client(null, signal).auth.challenge({ address, locale: 'en', client: identity })),
    verify: async (body, signal) =>
      grantFrom(await v1(() => v1Client(null, signal).auth.verify({ ...body, client: identity }))),
    resolve: async (session, signal) => (await v1(() => v1Client(session, signal).auth.session())).session,
    refresh: async (session, signal) => grantFrom(await v1(() => v1Client(session, signal).auth.refresh())),
    revoke: async (session, signal) => {
      await v1(() => v1Client(session, signal).auth.revoke())
    },
  }
}

/* ---- «Перевірено Seeker» and `.skr` names (contracts 1.66.0 §3bh and 1.65.0 §3bg — M41.2) ---- */

export type { SeekerCheckResponse, SkrNameRead }

/**
 * Whether the wallet the session proved holds a Seeker Genesis Token, read by the server on mainnet. The address is
 * the bearer's own — none is sent. A 503 (`UNAVAILABLE`) is the chain not answering, never `verified: false`.
 */
export function readSeekerCheck(session: Session, signal?: AbortSignal): Promise<SeekerCheckResponse> {
  return v1(() => v1Client(session, signal).auth.seeker())
}

/** A `.skr` name to the address that owns it now — the server reads the chain every time; nothing here keeps it. */
export function readSkrNameOwner(name: string, signal?: AbortSignal): Promise<SkrNameRead> {
  return v1(() => v1Client(null, signal).research.skrName({ name }))
}

/**
 * An address's `.skr` name — the primary one. With the session of exactly that wallet (`self`) the server may answer
 * the first name it holds when it chose none, so the bearer goes along; for anyone else's address, no bearer.
 */
export function readSkrNameOf(address: string, own: Session | null, signal?: AbortSignal): Promise<SkrNameRead> {
  if (own === null || own.address !== address) return v1(() => v1Client(null, signal).research.skrName({ address }))
  const proof = { authorization: `Bearer ${bearerOf(own)}` }
  return v1(() => v1Client(null, signal, REQUEST_TIMEOUT_MS, proof).research.skrName({ address, self: true }))
}

/* ---- Watchlist on the server: the session's wallet only (contract §3) ---- */

export type WatchlistRead = WatchlistResponse
export type WatchlistMerged = WatchlistMergeResponse

/** The wallet's list as the server holds it. */
export function readWatchlist(session: Session, signal?: AbortSignal): Promise<WatchlistRead> {
  return v1(() => v1Client(session, signal).watchlist.get())
}

/** The full list as written; `ifVersion` names the version last read and a stale one is refused `VALIDATION_ERROR`. */
export function writeWatchlist(
  session: Session,
  input: Readonly<{ mints: readonly string[]; ifVersion: number | null }>,
  signal?: AbortSignal,
): Promise<WatchlistRead> {
  return v1(() =>
    v1Client(session, signal).watchlist.put({
      address: session.address,
      mints: input.mints,
      ...(input.ifVersion === null ? {} : { ifVersion: input.ifVersion }),
    }),
  )
}

/**
 * The one merge: the server's order first, the device's additions after, the
 * device's removals honoured; `syncedAt` is the device's mark from its last
 * agreement with the server (`null` on a first sign-in — a genuine local list).
 */
export function mergeWatchlist(
  session: Session,
  input: Readonly<{ mints: readonly string[]; removed: readonly string[]; syncedAt: string | null }>,
  signal?: AbortSignal,
): Promise<WatchlistMerged> {
  return v1(() =>
    v1Client(session, signal).watchlist.merge({
      address: session.address,
      mints: input.mints,
      removed: input.removed,
      syncedAt: input.syncedAt,
    }),
  )
}

/* ---- Trade: the swap routes — the app signs, the server submits (contract §5) ---- */

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export type SwapRouteHop = Readonly<{ label: string; basisPoints: number }>

/** Ryntra's own fee as the provider states it — the rate, and the amount or the dollar figure only when the provider named one. */
export type SwapServiceFee = Readonly<{
  mechanism: string
  state: string
  basisPoints: number
  requestedBasisPoints: number
  asset: string | null
  symbol: string | null
  decimals: number | null
  amountRaw: string | null
  usd: number | null
}>

/** The provider's order as the quote and the order routes both carry it; the order route adds the bytes to sign. */
export type SwapOrderCore = Readonly<{
  requestId: string
  inputMint: string
  outputMint: string
  inAmountRaw: string
  outAmountRaw: string
  minReceivedRaw: string
  slippageBps: number
  /** A signed fraction of a percent, as the provider states it. */
  priceImpactPct: string
  router: string
  platformFee: Readonly<{ basisPoints: number; mint: string }> | null
  totalFeeBasisPoints: number
  ryntraFee?: SwapServiceFee | null
  signatureFeeLamports: string
  priorityFeeLamports: string
  rentFeeLamports: string
  inUsdValue: string | null
  outUsdValue: string | null
  swapUsdValue: string | null
  route: readonly SwapRouteHop[]
  taker: string | null
  observedAt: string
  reviewExpiresAt: string
}>

export type SwapQuoteInput = Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>

/** The read-only quote: the provider's order without a taker, the output asset's review verdict, both mints' decimals. */
export type SwapQuoteResponse = Readonly<{
  order: SwapOrderCore
  verdict: Readonly<{ verdict: string; reasons?: readonly string[] }>
  decimals: Readonly<Record<string, number>>
  expiresAt: string
  /** «Перевірка» as the server counts it for a company bought with USDC or sold into it (1.20.0); null otherwise. */
  check?: SwapCheck | null
}>

export function fetchSwapQuote(input: SwapQuoteInput, signal?: AbortSignal): Promise<SwapQuoteResponse> {
  return apiRequest<SwapQuoteResponse>('POST', '/api/solana/swap/quote', { ...input, access: 'production' }, { signal })
}

export type SwapPolicyFinding = Readonly<{
  rule: string
  outcome: 'PASS' | 'REVIEW' | 'BLOCK'
  detail?: string
  reason?: string
}>
export type SwapPolicyVerdict = Readonly<{
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK'
  findings: readonly SwapPolicyFinding[]
}>

/** The signable Review: exact bytes, their simulation, the policy's verdict, and the issuer-signed bundle `execute` demands back. */
export type SwapOrderResponse = Readonly<{
  order: SwapOrderCore & Readonly<{ transactionBase64: string; lastValidBlockHeight: string }>
  /** The Strategy block: the plan's version judged on this exact order (contract §3b); null without a plan. */
  planReview?: PlanReview | null
  simulation: Readonly<{
    status: 'OK' | 'FAILED'
    ownerEffects: Readonly<{ status: string; outputAmountRaw: string; inputAmountRaw: string }> | null
  }>
  policy: Readonly<{ verdict: SwapPolicyVerdict }>
  decimals: Readonly<Record<string, number>>
  bundle: unknown
  proof: Readonly<{ status: 'SIGNED' | 'UNSIGNED'; digest?: string }>
  preSign: Readonly<{ ready: boolean; code: string; reason: string }>
  expiresAt: string
  /** «Перевірка» on this exact order, the account's reserve included (1.20.0); null unless a company is bought or sold for USDC. */
  check?: SwapCheck | null
}>

/**
 * Where the order starts from; under a plan the binding names the version the
 * person read (`origin.plan`, contract §3b); under an autoinvest reminder, the
 * rule and the occurrence it names (`origin.rule`, 1.12.0 §3j).
 */
export type SwapOrigin = Readonly<{
  surface: 'SPOT'
  side: 'BUY' | 'SELL'
  plan?: ExecutionPlanBinding
  rule?: RuleBinding
}>

/**
 * ST-3: how long the phone waits for the swap routes that do the venue's work. The order route asks Jupiter again on its
 * «too many requests» for up to ten seconds and then simulates the bytes; the execute route hands the signed bytes to
 * Jupiter for up to thirty seconds and reads the chain after. Cut at the default twelve, a slow but ordinary swap read
 * as «no network»: an order the server still made held the wallet, a send that landed waited for a press of
 * «Перевірити транзакцію». The send waits a little past the venue's thirty — no longer, since the screen cannot be left
 * while it waits: an answer that does not come by then is asked of the chain by itself (`checkAfterSend`), on a
 * screen that can be closed. A check is a read and answers in a moment.
 */
export const SWAP_ORDER_TIMEOUT_MS = 25_000
export const SWAP_SEND_TIMEOUT_MS = 35_000
export const SWAP_CHECK_TIMEOUT_MS = 20_000

/**
 * A signable Review for the session's wallet as the taker. Line A's routes
 * answer a browser by its origin and a native client by its bearer (request
 * 13); the bearer travels here so the route can tell the taker is proven.
 */
export function createSwapOrder(
  session: Session,
  input: SwapQuoteInput,
  origin: SwapOrigin | null,
  signal?: AbortSignal,
): Promise<SwapOrderResponse> {
  return apiRequest<SwapOrderResponse>(
    'POST',
    '/api/solana/swap/order',
    { input: { ...input, taker: session.address }, ...(origin ? { origin } : {}) },
    { signal, session, timeoutMs: SWAP_ORDER_TIMEOUT_MS },
  )
}

/** What the server observed after it submitted the signed bytes — or the state it left the signature in. */
export type SwapSettlement = Readonly<{
  state: string
  signature: string
  observation: Readonly<{
    actualInputRaw: string
    actualOutputRaw: string
    /** The network's fee the chain shows for the transaction, in lamports. */
    baseFeeLamports?: string
    priorityFeeLamports?: string
    /** What Ryntra's fee actually took on the chain; null when nothing was read. */
    serviceFeeCollectedRaw?: string | null
  }> | null
  facts: Readonly<{
    reconciliation: Readonly<{ state: string; minimumMet?: boolean; deviations?: readonly string[] }>
    fees?: Readonly<{ serviceFee?: SwapServiceFee | null; baseLamports?: string; priorityLamports?: string }>
  }> | null
  receipt: unknown
  recovery?: string
  reason?: string
}>

export type SwapExecuteInput = Readonly<{
  bundle: unknown
  proof: unknown
  signedTransactionBase64: string
  reviewedTransactionBase64: string
}>

/** The one submission: the reviewed bundle back unchanged with the wallet's signed bytes; the server submits and observes. */
export function executeSwap(session: Session, input: SwapExecuteInput, signal?: AbortSignal): Promise<SwapSettlement> {
  return apiRequest<SwapSettlement>('POST', '/api/solana/swap/execute', input, {
    signal,
    session,
    timeoutMs: SWAP_SEND_TIMEOUT_MS,
  })
}

export type SwapRecoveryInput = Readonly<{ signature: string; owner: string; requestId?: string }>

/** The state the server observed for one signature; it never resubmits. */
export function recoverSwap(session: Session, input: SwapRecoveryInput, signal?: AbortSignal): Promise<SwapSettlement> {
  return apiRequest<SwapSettlement>('POST', '/api/solana/swap/recover', input, {
    signal,
    session,
    timeoutMs: SWAP_CHECK_TIMEOUT_MS,
  })
}

/** Release an open Review nobody signed, so the wallet may ask for another; refused while its blockhash still lives. */
export function cancelSwapReview(
  session: Session,
  input: Readonly<{ owner: string; requestId: string }>,
  signal?: AbortSignal,
): Promise<Readonly<{ state: string }>> {
  return apiRequest<Readonly<{ state: string }>>('POST', '/api/solana/swap/cancel-review', input, { signal, session })
}

/* ---- Holdings by address (public, no signature) ---- */

/** What the venue's catalogue knows of a held mint — the price with its source, the name, the category, the day's move. */
export type HoldingCatalog = Readonly<{
  mint: string
  symbol: string | null
  name: string | null
  usdPrice: string | null
  isVerified?: boolean | null
  isSuspicious?: boolean | null
  icon?: string | null
  category?: string | null
  dayChangePct?: number | null
}>

export type Holding = Readonly<{
  kind: 'NATIVE_SOL' | 'TOKEN' | (string & {})
  mint: string | null
  amountRaw: string
  spendableRaw: string
  decimals: number
  symbol: string | null
  name: string | null
  catalog: HoldingCatalog | null
  /**
   * 1.15.0: the mint's Scaled UI Amount multiplier in force — the wallet shows `amountRaw × uiMultiplier`, and the
   * catalogue's `usdPrice` is per that shown unit (PreStocks' SPACEX is ×5); absent or null where the mint carries
   * none or was not read.
   */
  uiMultiplier?: number | null
}>

/**
 * `COMPLETE` — both token programs answered, so an empty list means the
 * wallet holds nothing; `PARTIAL` — one answered; `UNAVAILABLE` — neither
 * did. A surface never says "nothing here" on anything but `COMPLETE`.
 */
export type HoldingsCoverage = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'

export type HoldingsResponse = Readonly<{
  data: Readonly<{
    owner: string
    lamports: string
    holdings: readonly Holding[]
    /** Token accounts with a balance, not counting native SOL. */
    held?: number
    tokenRead?: HoldingsCoverage
    observedAt: string
    /** Whether the venue's catalogue answered for the prices; `ABSENT` when it did not. */
    catalog?:
      Readonly<{ status: 'PRESENT'; missing?: readonly string[] }> | Readonly<{ status: 'ABSENT'; reason?: string }>
  }>
}>

/** What one address holds, read by address; a wallet is not proven by it. */
export function fetchHoldings(owner: string, signal?: AbortSignal): Promise<HoldingsResponse> {
  return apiRequest<HoldingsResponse>('POST', '/api/solana/holdings', { owner }, { signal })
}

/* ---- Activity by address (public rows; the wallet's reward rows only over its bearer) ---- */

export type ActionLane = 'SEND' | 'SWAP' | 'BRIDGE' | 'RECEIVE' | 'CROSS_SWAP' | (string & {})
export type ActionOutcome = 'IN_FLIGHT' | 'DONE' | 'FAILED' | 'NEEDS_YOU' | (string & {})

/** One leg of value in raw base units; decimals and symbol are nullable — the record does not always know them. */
export type ActionMovement = Readonly<{
  mint: string | null
  amountRaw: string
  decimals: number | null
  symbol: string | null
}>

export type ActionFee = Readonly<{
  collected: boolean
  basisPoints: number | null
  amountRaw: string | null
  decimals: number | null
  symbol: string | null
  usd: number | null
  /** The fee asset — a mint on Solana — when the record names it. */
  asset?: string | null
  state?: string | null
}>

export type ActionOrigin = Readonly<{
  /** 1.34.0: `LAUNCH` — a buy or a sale of a Ryntra launch on its curve or in its graduated pool. */
  surface: 'SPOT' | 'LAUNCH' | (string & {})
  side: 'BUY' | 'SELL'
  /** 1.34.0, `LAUNCH` only: the launched token and where the trade ran. */
  token?: string
  venue?: 'curve' | 'pool'
  plan?: Readonly<{ planId: string; version: number; reviewId?: string }> | null
  /** 1.12.0: the autoinvest reminder a purchase was made under — how History knows a rule's purchase. */
  rule?: RuleBinding | null
}>

/** One operation of a wallet as the server's ledger states it — the durable source History reads. */
export type WalletAction = Readonly<{
  actionId: string
  lane: ActionLane
  outcome: ActionOutcome
  out: ActionMovement | null
  in: ActionMovement | null
  destination: 'SOLANA' | 'BASE' | 'ETHEREUM' | 'ROBINHOOD' | (string & {}) | null
  signature: string | null
  sourceTx?: string | null
  destinationTx?: string | null
  fee?: ActionFee | null
  origin?: ActionOrigin | null
  /** The provider's own dollar figure for this exact fill, never a price read later. */
  statedUsd?: number | null
  startedAt: string
  updatedAt: string
}>

export type ActivityResponse = Readonly<{
  data: Readonly<{
    actions: readonly WalletAction[]
    /** Null for a read without proof — not the same as an empty list. */
    rewards: readonly RewardRow[] | null
    /** False when a row existed and could not be read: the list may be incomplete. */
    complete: boolean
    coverage: string
  }>
}>

/** The wallet's operations, newest first; the bearer adds its reward rows and changes nothing else. */
export function fetchActivity(owner: string, session: Session | null, signal?: AbortSignal): Promise<ActivityResponse> {
  return apiRequest<ActivityResponse>(
    'POST',
    '/api/solana/activity',
    { owner, network: 'mainnet' },
    { signal, session },
  )
}

/* ---- Rewards: what this wallet has earned, behind its bearer (contract 1.1.0, §3a) ---- */

export type RewardRowKind = 'CASHBACK' | 'REFERRAL_L1' | 'REFERRAL_L2' | 'CLAIM' | (string & {})

export type RewardRow = Readonly<{
  kind: RewardRowKind
  /** Ready to print, sign and currency included; an em-dash for a reward without a figure yet. */
  display: string
  amount: string
  valued: boolean
  /** The pair it came from when the source names one; never an address. */
  detail: string | null
  at: string
}>

export type PointsView = Readonly<{
  points: string
  level: number
  levelFrom: string
  nextLevelAt: string | null
  rank: number | null
  ranked: number
  volume: string
  trades: number
  activeDays: number
  policyVersion?: string
  excluded?: boolean
}>

export type RewardsResponse = Readonly<{
  ok: true
  address: string
  /** Decimal dollars as text ("12.34", "<0.01", "0.00"); never micro-units, never a float. */
  available: string
  pending: string
  lifetime: string
  cashback: string
  referralL1: string
  referralL2: string
  sourceAmounts?: Readonly<Record<string, string>>
  claimable: boolean
  claimBlockedReason: string | null
  pendingReasons?: readonly string[]
  referrals: Readonly<{ level1: number; level2: number }>
  rows: readonly RewardRow[]
  referral: Readonly<{ code: string; link: string }> | null
  claim: Readonly<{ state: string; text: string; signature: string | null }> | null
  /** Who this wallet is attached to, masked, or null. */
  invitedBy: string | null
  /** Ryntra Points — null when the ledger could not be read, shown as unavailable, never as zero. */
  points: PointsView | null
  /** Whether accrual has begun on this deployment at all. */
  started: boolean
}>

/** The confirmed state of this wallet's rewards; another wallet's bearer is refused. */
export function fetchRewards(session: Session, locale: 'en' | 'uk', signal?: AbortSignal): Promise<RewardsResponse> {
  return apiGet<RewardsResponse>(`/api/rewards?address=${encodeURIComponent(session.address)}&locale=${locale}`, {
    signal,
    session,
  })
}

/* ---- Trading plans: the session's wallet only, over the pinned client (contract §3a–§3c) ---- */

export type {
  EvidenceCondition,
  EvidenceMetricDefinition,
  EvidenceMetricId,
  ExecutionPlanBinding,
  PlanAsset,
  PlanAssetKind,
  PlanAssetRead,
  PlanCheck,
  PlanCheckId,
  PlanCostPart,
  PlanJournalEntry,
  PlanMemoryCitation,
  PlanMemoryFact,
  PlanMemoryResponse,
  PlanNoTradeOutcome,
  PlanNoTradeReason,
  PlanningPrice,
  PlanPosition,
  PlanPositionRow,
  PlanResult,
  PlanResultsResponse,
  PlanResultsSummary,
  PlanReview,
  PlanRules,
  PlanSizing,
  PlanStatus,
  PlanVersion,
  PlanVersionSummary,
  TradingPlan,
} from './api/v1/types.ts'

export type PlansApi = Readonly<{
  list: (session: Session, signal?: AbortSignal) => Promise<PlanListResponse>
  create: (session: Session, request: PlanCreateRequest, signal?: AbortSignal) => Promise<PlanResponse>
  get: (session: Session, planId: string, signal?: AbortSignal) => Promise<PlanResponse>
  update: (session: Session, planId: string, request: PlanUpdateRequest, signal?: AbortSignal) => Promise<PlanResponse>
  setStatus: (
    session: Session,
    planId: string,
    request: PlanStatusRequest,
    signal?: AbortSignal,
  ) => Promise<PlanResponse>
  version: (session: Session, planId: string, version: number, signal?: AbortSignal) => Promise<PlanVersionResponse>
  results: (session: Session, planId: string, signal?: AbortSignal) => Promise<PlanResultsResponse>
  /** 1.9.0: every plan's results at once — the operations, the positions, the plans that made no trade, the summary. */
  allResults: (session: Session, signal?: AbortSignal) => Promise<PlanResultsResponse>
  /** 1.9.0: the wallet's memory — facts over its own records, each citing the record it stands on. */
  memory: (session: Session, signal?: AbortSignal) => Promise<PlanMemoryResponse>
  /** Public (1.7.0): any mint resolved the way a create resolves it — the asset a plan would carry, the planning price now or null. */
  asset: (mint: string, signal?: AbortSignal) => Promise<PlanAssetRead>
}>

/** The wallet's plans as the server holds them; every refusal is the contract's own code (`PLAN_INVALID` names the field). */
export const plansApi: PlansApi = {
  list: (session, signal) => v1(() => v1Client(session, signal).plans.list()),
  create: (session, request, signal) => v1(() => v1Client(session, signal).plans.create(request)),
  get: (session, planId, signal) => v1(() => v1Client(session, signal).plans.get(planId)),
  update: (session, planId, request, signal) => v1(() => v1Client(session, signal).plans.update(planId, request)),
  setStatus: (session, planId, request, signal) => v1(() => v1Client(session, signal).plans.setStatus(planId, request)),
  version: (session, planId, version, signal) => v1(() => v1Client(session, signal).plans.version(planId, version)),
  results: (session, planId, signal) => v1(() => v1Client(session, signal).plans.results(planId)),
  allResults: (session, signal) => v1(() => v1Client(session, signal).plans.allResults()),
  memory: (session, signal) => v1(() => v1Client(session, signal).plans.memory()),
  asset: (mint, signal) => v1(() => v1Client(null, signal).plans.asset(mint)),
}

/* ---- «Автоінвест»: the session's wallet only, over the pinned client (contract §3j–§3k, 1.12.0–1.13.0; §3n «Умова ціни», 1.18.0) ---- */

export type {
  AutoinvestRule,
  RuleBinding,
  RuleBudget,
  RuleBudgetRequest,
  RuleBudgetResponse,
  RuleConditionCheck,
  RuleConditionVerdict,
  RuleCreateRequest,
  RuleDip,
  RuleKind,
  RuleListResponse,
  RuleOccurrence,
  RuleOccurrenceState,
  RulePaymentDirection,
  RulePaymentEvent,
  RulePaymentMode,
  RulePayments,
  RulePaymentsRequest,
  RulePriceCondition,
  RulePriceConditionState,
  RulePriceReference,
  RuleAssetClass,
  RuleAssetRead,
  RuleAssetResponse,
  RuleFloorCheck,
  RuleFloorVerdict,
  RuleSchedule,
  RuleStatus,
} from './api/v1/types.ts'

export type RulesApi = Readonly<{
  /** The wallet's rules, newest first, with the month's budget. */
  list: (session: Session, signal?: AbortSignal) => Promise<RuleListResponse>
  /** One rule read afresh — what one tap on its reminder is allowed to do is decided on this read. */
  get: (session: Session, ruleId: string, signal?: AbortSignal) => Promise<RuleResponse>
  /** «Регулярно» with a schedule, or (1.13.0) «Якщо впаде» with a fall — the server takes the reference point from the price now. */
  create: (session: Session, request: RuleCreateRequest, signal?: AbortSignal) => Promise<RuleResponse>
  setStatus: (session: Session, ruleId: string, status: RuleStatus, signal?: AbortSignal) => Promise<RuleResponse>
  remove: (session: Session, ruleId: string, signal?: AbortSignal) => Promise<RuleDeleteResponse>
  /** Whether a reminder can also reach Telegram (1.11.0): the channel the wallet connected on ryntra.io. */
  telegram: (session: Session, signal?: AbortSignal) => Promise<TelegramChannelResponse>
  /** 1.13.0: the month's ceiling for every rule — set by the person alone, never raised by Ryntra; removed, the month is still counted. */
  setBudget: (session: Session, request: RuleBudgetRequest, signal?: AbortSignal) => Promise<RuleBudgetResponse>
  clearBudget: (session: Session, signal?: AbortSignal) => Promise<RuleBudgetResponse>
  /**
   * 1.19.0: «Мій рахунок» — the other side of one counted payment is the
   * person's own account: no transfer to or from it counts for any «З кожної
   * оплати» rule of the wallet from then on. The answer is the rule list;
   * an unknown signature is `RULE_NOT_FOUND`. The pinned client has no method
   * for it, so it goes through the app's own request, bearer and header alike.
   */
  markOwn: (session: Session, signature: string, signal?: AbortSignal) => Promise<RuleListResponse>
  /**
   * 1.31.0: what a rule on a token would stand on, before it is written — the
   * asset and its class, the price now, the floor and, for a meme or a new
   * token, the facts of its risk; `refusal` why no rule can name it. Public.
   */
  asset: (mint: string, signal?: AbortSignal) => Promise<RuleAssetResponse>
}>

/** A rule only schedules a reminder: nothing here buys, and every purchase is the wallet's own signature on a fresh Review. */
export const rulesApi: RulesApi = {
  list: (session, signal) => v1(() => v1Client(session, signal).rules.list()),
  get: (session, ruleId, signal) => v1(() => v1Client(session, signal).rules.get(ruleId)),
  create: (session, request, signal) => v1(() => v1Client(session, signal).rules.create(request)),
  setStatus: (session, ruleId, status, signal) =>
    v1(() => v1Client(session, signal).rules.setStatus(ruleId, { status })),
  remove: (session, ruleId, signal) => v1(() => v1Client(session, signal).rules.remove(ruleId)),
  telegram: (session, signal) => v1(() => v1Client(session, signal).notifications.telegram()),
  setBudget: (session, request, signal) => v1(() => v1Client(session, signal).rules.budget.set(request)),
  clearBudget: (session, signal) => v1(() => v1Client(session, signal).rules.budget.clear()),
  markOwn: (session, signature, signal) =>
    apiRequest<RuleListResponse>('POST', '/api/v1/rules/payments/own', { signature } satisfies RulePaymentOwnRequest, {
      signal,
      session,
    }),
  asset: (mint, signal) => v1(() => v1Client(null, signal).rules.asset(mint)),
}

/**
 * «Популярні компанії» as the server lists them (contract 1.20.0) — the listed
 * companies by the day's trading, the same list and order the web's Home and
 * the column beside a company's page draw. Public. The route reads the stock
 * universe, which takes about twenty seconds when its cache is cold, so this
 * read waits as long as the universe's own.
 */
export function fetchPopularCompanies(
  options: Readonly<{ limit?: number; exclude?: string }> = {},
  signal?: AbortSignal,
): Promise<PopularCompaniesResponse> {
  return v1(() => v1Client(null, signal, 35_000).stocks.popular(options))
}

/** What the deployment offers — read for the evidence metrics' own words and units (a plan's market rules). Public. */
export function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return v1(() => v1Client(null, signal).capabilities())
}

/* ---- Ryntra, the agent: the session's wallet only, over the pinned client (contract §3f, 1.8.0) ---- */

export type {
  AgentBudgetState,
  AgentCard,
  AgentContext,
  AgentDraftCard,
  AgentDraftResponse,
  AgentFigure,
  AgentGuestResponse,
  AgentHandoff,
  AgentMessageResponse,
  AgentMoveMark,
  AgentSession,
  AgentSessionResponse,
  AgentSessionSummary,
  AgentState,
  AssistantBrief,
  AssistantBriefLine,
  AssistantBriefPart,
  AssistantBriefResponse,
  AgentSuggestion,
  AgentTurn,
} from './api/v1/types.ts'

/** An answer may take the route's whole minute when a model composes it (two bounded phases); the phone waits a little longer. */
const AGENT_MESSAGE_TIMEOUT_MS = 65_000
const AGENT_READ_TIMEOUT_MS = 20_000

export type AgentApi = Readonly<{
  /** Opens or resumes the wallet's conversation for a context: the kept turns, the budget, the suggested questions. */
  open: (session: Session, request: AgentSessionOpenRequest, signal?: AbortSignal) => Promise<AgentSessionResponse>
  /** One conversation read again by its id — another wallet's is `AGENT_SESSION_NOT_FOUND`. */
  read: (session: Session, sessionId: string, signal?: AbortSignal) => Promise<AgentSessionResponse>
  /** The person's words and Ryntra's answer; nothing here signs, submits or saves. */
  message: (session: Session, request: AgentMessageRequest, signal?: AbortSignal) => Promise<AgentMessageResponse>
  /** A draft a turn prepared, read back while it lives (a week). */
  draft: (session: Session, draftId: string, signal?: AbortSignal) => Promise<AgentDraftResponse>
  budget: (session: Session, signal?: AbortSignal) => Promise<AgentBudgetState>
  /** The wallet's conversations with a question in them, the most recent first (1.43.0). */
  sessions: (session: Session, signal?: AbortSignal) => Promise<AgentSessionListResponse>
  /** A market question without a wallet (1.43.0): public, no bearer; the server stores nothing but the meter. */
  guest: (request: AgentGuestRequest, signal?: AbortSignal) => Promise<AgentGuestResponse>
  /** The wallet's morning brief and its settings (1.46.0): the newest, or the one of a note's `day`, in `locale`. */
  brief: (
    session: Session,
    locale: 'en' | 'uk',
    day?: string | null,
    signal?: AbortSignal,
  ) => Promise<AssistantBriefResponse>
  /** The brief's settings written; the answer is the same read, its words in `locale`. */
  saveBrief: (
    session: Session,
    update: AssistantBriefUpdate,
    locale: 'en' | 'uk',
    signal?: AbortSignal,
  ) => Promise<AssistantBriefResponse>
  /** «Спитати Ryntra» on a subject (1.10.0): the overview; `deterministic` never reaches a model and never spends. */
  lensBrief: (session: Session, request: AgentLensRequest, signal?: AbortSignal) => Promise<AgentBriefResponse>
  /** «Спитати Ryntra» on a subject: the critic — what argues against it. */
  lensCritic: (session: Session, request: AgentLensRequest, signal?: AbortSignal) => Promise<AgentCriticResponse>
}>

export const agentApi: AgentApi = {
  open: (session, request, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).agent.openSession(request)),
  read: (session, sessionId, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).agent.session(sessionId)),
  message: (session, request, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_MESSAGE_TIMEOUT_MS).agent.message(request)),
  draft: (session, draftId, signal) => v1Words(() => v1Client(session, signal).agent.draft(draftId)),
  budget: (session, signal) => v1Words(() => v1Client(session, signal).agent.budget()),
  sessions: (session, signal) => v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).agent.sessions()),
  guest: (request, signal) => v1Words(() => v1Client(null, signal, AGENT_MESSAGE_TIMEOUT_MS).agent.guest(request)),
  brief: (session, locale, day, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.brief(locale, day ?? undefined)),
  saveBrief: (session, update, locale, signal) =>
    v1Words(() => v1Client(session, signal).assistant.setBrief(update, locale)),
  lensBrief: (session, request, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_MESSAGE_TIMEOUT_MS).agent.brief(request)),
  lensCritic: (session, request, signal) =>
    v1Words(() => v1Client(session, signal, AGENT_MESSAGE_TIMEOUT_MS).agent.critic(request)),
}

/* ---- The assistant's own surfaces (AI-13, request 68): the same routes the web calls, over the pinned client ---- */

export type {
  AgentBriefResponse,
  AgentCriticResponse,
  AgentLensRequest,
  AssistantCreditEntry,
  AssistantCreditOrder,
  AssistantCreditOrderResponse,
  AssistantCreditOrdersResponse,
  AssistantCreditPackage,
  AssistantCreditPurchase,
  AssistantCredits,
  AssistantCreditsResponse,
  AssistantMemoryNote,
  AssistantMemoryResponse,
  AssistantMemoryUpdate,
  AssistantPlan,
  AssistantPlanCreate,
  AssistantPlanFinding,
  AssistantPlanLevel,
  AssistantPlanRecheck,
  AssistantPlanResponse,
  AssistantPlansResponse,
  AssistantPlanState,
  AssistantPlanStateRequest,
  AssistantPlanTrade,
  AssistantPlanUpdate,
  AssistantProfile,
  AssistantProfileResponse,
  AssistantProfileUpdate,
  AssistantTask,
  AssistantTaskAsk,
  AssistantTaskCreate,
  AssistantTaskEvery,
  AssistantTasksResponse,
  AssistantTaskUpdate,
  AssistantVoiceRequest,
  AssistantVoiceResponse,
  AssistantWatch,
  AssistantWatchCreate,
  AssistantWatchesResponse,
  AssistantWatchPreset,
  AssistantWatchRule,
  AssistantWatchUpdate,
  TelegramChannelResponse,
  TelegramConnectResponse,
} from './api/v1/types.ts'

/** A plan or a critic the strong model composes may take the route's whole minute; the phone waits a little longer. */
const ASSISTANT_COMPOSE_TIMEOUT_MS = 95_000
/** A recording of up to two minutes goes up as base64 and comes back as words. */
const ASSISTANT_VOICE_TIMEOUT_MS = 60_000

/**
 * The assistant's surfaces for the proven wallet: credits and their purchase, «Стежу», «Знайомство», what Ryntra
 * remembers, «Доручення», trade plans with the critic, voice heard on the server. Every paid call carries exactly the
 * price the phone showed (`acceptCredits`); nothing here signs, sends, trades or reads a key — a credits order is paid
 * through `lib/pay` with the wallet's own signature, as a payment link is.
 */
export const assistantApi = {
  credits: (session: Session, signal?: AbortSignal) => v1Words(() => v1Client(session, signal).assistant.credits.get()),
  welcome: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.credits.welcome()),
  orders: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.credits.orders()),
  order: (session: Session, orderId: string, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.credits.order(orderId)),
  openOrder: (session: Session, request: AssistantCreditOrderRequest, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, 20_000).assistant.credits.openOrder(request)),
  watches: (session: Session, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.watches.list(locale)),
  createWatch: (session: Session, request: AssistantWatchCreate, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.watches.create(request, locale)),
  updateWatch: (
    session: Session,
    watchId: string,
    request: AssistantWatchUpdate,
    locale: 'en' | 'uk',
    signal?: AbortSignal,
  ) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.watches.update(watchId, request, locale)),
  removeWatch: (session: Session, watchId: string, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.watches.remove(watchId, locale)),
  profile: (session: Session, signal?: AbortSignal) => v1Words(() => v1Client(session, signal).assistant.profile()),
  setProfile: (session: Session, request: AssistantProfileUpdate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.setProfile(request)),
  memory: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.memory.get()),
  setMemory: (session: Session, request: AssistantMemoryUpdate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.memory.update(request)),
  forget: (session: Session, noteId: string, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.memory.forget(noteId)),
  forgetAll: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.memory.forgetAll()),
  tasks: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.tasks.list()),
  createTask: (session: Session, request: AssistantTaskCreate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.tasks.create(request)),
  updateTask: (session: Session, taskId: string, request: AssistantTaskUpdate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.tasks.update(taskId, request)),
  removeTask: (session: Session, taskId: string, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).assistant.tasks.remove(taskId)),
  plans: (session: Session, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.plans.list(locale)),
  plan: (session: Session, planId: string, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.plans.get(planId, locale)),
  createPlan: (session: Session, request: AssistantPlanCreate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, ASSISTANT_COMPOSE_TIMEOUT_MS).assistant.plans.create(request)),
  updatePlan: (session: Session, planId: string, request: AssistantPlanUpdate, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, ASSISTANT_COMPOSE_TIMEOUT_MS).assistant.plans.update(planId, request)),
  recheckPlan: (session: Session, planId: string, request: AssistantPlanRecheck, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, ASSISTANT_COMPOSE_TIMEOUT_MS).assistant.plans.recheck(planId, request)),
  setPlanState: (session: Session, planId: string, request: AssistantPlanStateRequest, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, AGENT_READ_TIMEOUT_MS).assistant.plans.setState(planId, request)),
  voice: (session: Session, request: AssistantVoiceRequest, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal, ASSISTANT_VOICE_TIMEOUT_MS).assistant.voice(request)),
  /** The wallet's Telegram channel (1.11.0) read, a connect link made for this wallet, or the channel let go. */
  telegram: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).notifications.telegram()),
  connectTelegram: (session: Session, locale: 'en' | 'uk', signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).notifications.connectTelegram({ locale })),
  disconnectTelegram: (session: Session, signal?: AbortSignal) =>
    v1Words(() => v1Client(session, signal).notifications.disconnectTelegram()),
} as const

/** How a followed wallet's trades are told (SOL-R4, 1.63.0): every trade, only its sales, or none. */
export type WalletWatchAlerts = 'all' | 'sells' | 'off'

/** One wallet the person follows, as `/api/wallet-watch` lists it (outside v1, its own shape). */
export type WalletFollowRow = Readonly<{
  address: string
  name: string | null
  alerts: WalletWatchAlerts
  since: string
  /** Followed as a token's creator: the token. */
  via: Readonly<{ mint: string; symbol: string }> | null
}>

export type WalletFollows = Readonly<{ ok: true; address: string; wallets: readonly WalletFollowRow[] }>

/**
 * The wallets the person follows (SOL-R4) — read, one's notes' mode changed, or one let go. The route lives outside
 * `/api/v1` and reads the bearer for exactly the person's own address; the phone has no list of followed wallets, so
 * these are reached only from a `wallet-watch` note.
 */
export function readWalletFollows(session: Session, signal?: AbortSignal): Promise<WalletFollows> {
  return apiRequest<WalletFollows>(
    'GET',
    `/api/wallet-watch?address=${encodeURIComponent(session.address)}`,
    undefined,
    {
      signal,
      session,
      timeoutMs: 20_000,
    },
  )
}

export function setWalletWatchAlerts(
  session: Session,
  wallet: string,
  alerts: WalletWatchAlerts,
  locale: 'en' | 'uk',
  signal?: AbortSignal,
): Promise<WalletFollows> {
  return apiRequest<WalletFollows>(
    'PATCH',
    '/api/wallet-watch',
    { address: session.address, wallet, alerts, locale },
    { signal, session, timeoutMs: 20_000 },
  )
}

/** The followed wallet let go — no more of its notes. */
export function stopWalletWatch(
  session: Session,
  wallet: string,
  locale: 'en' | 'uk',
  signal?: AbortSignal,
): Promise<WalletFollows> {
  return apiRequest<WalletFollows>(
    'DELETE',
    `/api/wallet-watch?address=${encodeURIComponent(session.address)}&wallet=${encodeURIComponent(wallet)}&locale=${locale}`,
    undefined,
    { signal, session, timeoutMs: 20_000 },
  )
}

/* ---- Monitoring: the owner's surface (released 2026-09-20; its own shape, read over the bearer) ---- */

export type MonitorStatus = 'watching' | 'needs_attention' | 'paused' | 'unavailable' | (string & {})

/** One monitored plan as the surface draws it; the target is a web link — the phone matches the label to its plans. */
export type MonitoringCard = Readonly<{
  monitorId: string
  /** The plan's asset symbol. */
  label: string
  status: MonitorStatus
  title: string
  reason: string
  href: string
  cta: string
  paper: boolean
  lastCheckedAt: string | null
  lastTriggeredAt: string | null
}>

/** One durable note of the inbox — written once per server event, read or unread, in the language the tick wrote it. */
export type MonitoringNote = Readonly<{
  id: string
  monitorId: string
  title: string
  reason: string
  /** The monitored plan's label — the asset symbol, or the event title of a paper plan. */
  context: string
  href: string
  cta: string
  paper: boolean
  unread: boolean
  createdAt: string
  /** The language the note's own words are in (request 20). */
  locale?: 'en' | 'uk'
  /** The occurrence's identity — for a rule's reminder `autoinvest:<rule>:<due>@<symbol>` (1.12.0). */
  triggerId?: string
  /**
   * What the note is about: a plan, or (1.12.0) an autoinvest rule's reminder, or (1.13.0) the month's budget spent,
   * or (1.15.0, `issuer-event`) a token the wallet holds whose issuer opened a window to swap it — `id` its mint.
   */
  subject?: Readonly<{ kind: string; id: string }>
  /** The note's words in both languages, where the server keeps both. */
  text?: Readonly<Record<'en' | 'uk', Readonly<{ title: string; reason: string }>>>
  /** 1.13.0: on a rule's reminder, what became of it as the rule reads it now; absent elsewhere. */
  ruleState?: RuleOccurrenceState
}>

/** A local wall-clock window in which nothing is pushed; `HH:MM` on a 24-hour clock in an IANA timezone. */
export type QuietHours = Readonly<{ start: string; end: string; timezone: string }>

/** Where the wallet's notes go: the inbox always; Telegram and the phone as the person chooses; quiet hours for both. */
export type MonitoringPreferences = Readonly<{ telegram: boolean; push: boolean; quietHours: QuietHours | null }>

export type MonitoringSurface = Readonly<{
  attention: readonly MonitoringCard[]
  watching: readonly MonitoringCard[]
  recent: readonly MonitoringNote[]
  unread: number
  preferences: MonitoringPreferences
}>

/** What needs attention and what is watched for the session's wallet, in the app's language. */
export function fetchMonitoring(
  session: Session,
  locale: 'en' | 'uk',
  signal?: AbortSignal,
): Promise<MonitoringSurface> {
  // A «Доручення»'s note carries the model's words (its headline and sentences): read as a person reads them.
  return apiRequest<MonitoringSurface>('GET', '/api/monitoring', undefined, {
    signal,
    session,
    acceptLanguage: locale,
  }).then((surface) => spokenWords(surface))
}

/** Mark one note read on the server; a note that is not this wallet's answers `VALIDATION_ERROR` (No such note). Idempotent. */
export function markMonitoringRead(session: Session, noteId: string, signal?: AbortSignal): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('POST', '/api/monitoring', { read: noteId }, { signal, session })
}

/** A partial write of the preferences: a field left out keeps its value; `quietHours: null` clears the window. */
export type MonitoringPreferencesPatch = Readonly<{
  telegram?: boolean
  push?: boolean
  quietHours?: QuietHours | null
}>

export function updateMonitoringPreferences(
  session: Session,
  patch: MonitoringPreferencesPatch,
  signal?: AbortSignal,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('POST', '/api/monitoring', patch, { signal, session })
}

/* ---- The device registry: this phone as a place notes may be pushed to (contract §notifications, 1.1.0 schema; the routes live since 2026-09-20) ---- */

export const NOTIFICATION_CATEGORIES = ['plan', 'operation', 'market', 'system'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/** The registration as the contract's strict schema reads it — nothing else may travel in the body. */
export type DeviceRegistration = Readonly<{
  platform: 'android'
  /** The push provider's opaque token; sent, kept on the device, never logged or shown. */
  token: string
  appVersion: string
  locale: 'en' | 'uk'
  categories: readonly NotificationCategory[]
  quietHours: QuietHours | null
}>

export type DeviceRegistered = Readonly<{
  deviceId: string
  address: string
  platform: 'android'
  categories: readonly NotificationCategory[]
  quietHours: QuietHours | null
  registeredAt: string
}>

/** A registered device as the list answers it — the token is never returned. */
export type RegisteredDevice = Readonly<{
  deviceId: string
  platform: 'android'
  appVersion: string
  locale: 'en' | 'uk'
  registeredAt: string
}>

/**
 * Register this phone for the session's wallet, or refresh its record: the
 * server keys the device by its token, so the same token registered again
 * keeps its `deviceId` and takes the whole new body (categories and quiet
 * hours included — a refresh must say them all).
 */
export function registerDevice(
  session: Session,
  registration: DeviceRegistration,
  signal?: AbortSignal,
): Promise<DeviceRegistered> {
  return apiRequest<DeviceRegistered>('POST', '/api/v1/notifications/devices', registration, { signal, session })
}

export function listDevices(session: Session, signal?: AbortSignal): Promise<{ devices: readonly RegisteredDevice[] }> {
  return apiRequest<{ devices: readonly RegisteredDevice[] }>('GET', '/api/v1/notifications/devices', undefined, {
    signal,
    session,
  })
}

/** Stop pushing to a device of this wallet; idempotent; another wallet's device answers `VALIDATION_ERROR`. */
export function revokeDevice(session: Session, deviceId: string, signal?: AbortSignal): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    'DELETE',
    `/api/v1/notifications/devices/${encodeURIComponent(deviceId)}`,
    undefined,
    {
      signal,
      session,
    },
  )
}

/* ---- «Гроші»: Send, a payment link, the recipient check (contract 1.22.0, §3r) ---- */

export type {
  AddressEvidenceRead,
  PayLink,
  PayLinkExpiration,
  PayLinkStatus,
  RecipientCheckResponse,
  RecipientProblem,
  SendReturnedResponse,
  TransferCheck,
  TransferInput,
  TransferRecovery,
  TransferReview,
  TransferSettleResult,
} from './api/v1/types.ts'
export { PAY_LINK_EXPIRATIONS } from './api/v1/types.ts'

/** A settle observes the chain before it answers; it may take most of a minute. */
const SETTLE_TIMEOUT_MS = 60_000

/** What was typed, pasted or scanned into «Кому» — an address, a Solana Pay request or a Ryntra link — and the one decision. Public. */
export function checkRecipient(query: RecipientCheckQuery, signal?: AbortSignal): Promise<RecipientCheckResponse> {
  return v1(() => v1Client(null, signal).money.recipient(query))
}

/** What the security source keeps about one plain address — one line beside the recipient check, as on the web. Public. */
export function readAddressEvidence(address: string, signal?: AbortSignal): Promise<AddressEvidenceRead> {
  return v1(() => v1Client(null, signal, 20_000).research.addressEvidence(address))
}

/** The exact transfer and its Review, with «Перевірка» counted by the server (`check`). No session: the review proof binds it. */
export function planTransfer(request: TransferPlanRequest, signal?: AbortSignal): Promise<TransferReviewResponse> {
  return v1(() => v1Client(null, signal, 25_000).transfer.plan(request))
}

/** What the wallet returned, read against the Review: `settle`, `adopt` or `stop`, and the signature when it signed. */
export function readReturned(request: SendReturnedRequest, signal?: AbortSignal): Promise<SendReturnedResponse> {
  return v1(() => v1Client(null, signal).money.returned(request))
}

/** A wallet that added only its fee and guard instructions: the Review re-read and re-signed for those bytes. */
export function adoptTransfer(request: TransferSettleRequest, signal?: AbortSignal): Promise<TransferAdoptResponse> {
  return v1(() => v1Client(null, signal, 25_000).transfer.adopt(request))
}

/** Submit once and observe: 200 with the receipt, or the open outcome — never sent again. */
export function settleTransfer(request: TransferSettleRequest, signal?: AbortSignal): Promise<TransferSettleResponse> {
  return v1(() => v1Client(null, signal, SETTLE_TIMEOUT_MS).transfer.settle(request))
}

/** One signature read again, over the session's bearer; the outcome is `primary` and `independent`, never `attempt.state`. */
export function recoverTransfer(
  session: Session,
  signature: string,
  signal?: AbortSignal,
): Promise<TransferRecoverResponse> {
  return v1(() => v1Client(session, signal, 25_000).transfer.recover({ network: 'mainnet', signature }))
}

/** A payment link for the session's own wallet — the recipient is never a field. */
export function createPayLink(
  session: Session,
  request: PayLinkCreateRequest,
  signal?: AbortSignal,
): Promise<PayLinkResponse> {
  return v1(() => v1Client(session, signal, 20_000).pay.create(request))
}

/** The session's own links, newest first. */
export function listPayLinks(session: Session, signal?: AbortSignal): Promise<PayLinkListResponse> {
  return v1(() => v1Client(session, signal).pay.list())
}

/** One link as its page reads it — the chain observed when the last read is older than eight seconds. Public. */
export function readPayLink(id: string, signal?: AbortSignal): Promise<PayLinkResponse> {
  return v1(() => v1Client(null, signal).pay.get(id))
}

/** The unsigned transfer that pays a Ryntra link, its reference inside, pinned for three minutes; the payer is the session's wallet. */
export function payLinkTransaction(
  session: Session,
  id: string,
  request: PayTransactionRequest,
  signal?: AbortSignal,
): Promise<PayTransactionResponse> {
  return v1(() => v1Client(session, signal, 25_000).pay.transaction(id, request))
}

/** The signed payment of a link, sent once. */
export function submitPayLink(
  session: Session,
  id: string,
  request: PaySubmitRequest,
  signal?: AbortSignal,
): Promise<PaySubmitResponse> {
  return v1(() => v1Client(session, signal, SETTLE_TIMEOUT_MS).pay.submit(id, request))
}
