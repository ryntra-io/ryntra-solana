import type { CollateralReview } from '../../../lib/phoenix/collateral-actions.ts';
import type { CollateralRelay, RelayState } from '../../../lib/phoenix/collateral-model.ts';
import type { CollateralStates } from '../../../lib/phoenix/collateral.server.ts';
import type { FuturesFundingHistory, FuturesOrdersHistory, FuturesTrades, HistoryKind } from '../../../lib/phoenix/history.ts';
import type { TicketMargin } from '../../../lib/phoenix/margin.ts';
import type { FuturesAccount, FuturesBook, FuturesCandles, FuturesFunding, FuturesMarkets, FuturesTimeframe } from '../../../lib/phoenix/market-data.ts';
import type { OrderRelay, OrderRelayState, OrderReview, OrderStates, PerpFill, PerpTif } from '../../../lib/phoenix/orders-model.ts';
import { postJson, type EngineResult, type FetchLike } from '../trade/engine.ts';

/**
 * The Exchange's line to Ryntra's Phoenix engine (B6, B6b, B7, PERP-4, PERP-5), on the same origin as the rest of
 * Ryntra: the routes `app/api/solana/futures/**` and nothing else. The markets, a wallet's account and its history are
 * Phoenix's public reads, as are a market's order book and its bars; the ticket's margin is Phoenix's SDK on the server; the Review builds, checks and simulates
 * the exact transaction and seals it in a ticket; the relay sends the signed bytes once; the status reads the chain.
 * The city only asks and shows: every figure on its screens is one of these answers.
 */

export type { CollateralRelay, CollateralReview, CollateralStates, OrderRelay, OrderReview, OrderStates };

/** The ticket's figures as the route sends them: the SDK's margin with the time Phoenix was read. */
export type TicketFigures = TicketMargin & Readonly<{ observedAt: number }>;

export type History =
  | Readonly<{ kind: 'trades'; value: FuturesTrades }>
  | Readonly<{ kind: 'orders'; value: FuturesOrdersHistory }>
  | Readonly<{ kind: 'funding'; value: FuturesFundingHistory }>;

/** An order as the review route takes it: lots and ticks as digits, never a float. */
export type OrderBody =
  | Readonly<{ kind: 'open'; owner: string; symbol: string; side: 'long' | 'short'; type: 'market' | 'limit'; tif?: PerpTif; size: string; price?: string; slippageBps?: number; tp?: string | null; sl?: string | null; format?: 'v1' }>
  | Readonly<{ kind: 'reduce'; owner: string; symbol: string; size: string; close?: boolean; slippageBps?: number; format?: 'v1' }>
  | Readonly<{ kind: 'protect'; owner: string; symbol: string; tp: string | null; sl: string | null; format?: 'v1' }>
  | Readonly<{ kind: 'cancel'; owner: string; symbol: string; order: string; format?: 'v1' }>
  | Readonly<{ kind: 'cancelAll'; owner: string; symbol: string; format?: 'v1' }>
  | Readonly<{ kind: 'cancelConditional'; owner: string; symbol: string; index: number; format?: 'v1' }>;

/** A collateral move as the review route takes it: micro-dollars of USDC as digits. */
export type CollateralBody = Readonly<{ action: 'deposit' | 'withdraw'; owner: string; amount: string; format?: 'v1' }>;

/** The ticket's question to the SDK's margin calculator; sizes and prices in lots and ticks. */
export type TicketQuery = Readonly<{
  wallet: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  leverage: number;
  slippageBps: number;
  /** Phoenix's taker rate and Ryntra's, bps: the fees the estimate takes out of the same collateral. */
  feeBps: number;
  sizeLots: string | null;
  limitTicks: string | null;
  reduceOnly: boolean;
}>;

export type OrderSignatureState = Readonly<{ signature: string; state: OrderRelayState; reason: string | null; fills?: readonly PerpFill[] | null }>;
export type CollateralSignatureState = Readonly<{ signature: string; state: RelayState; reason: string | null; usdcMoved?: string | null }>;

export type GetLike = (url: string, init: Readonly<{ method: 'GET'; headers: Record<string, string>; signal: AbortSignal }>) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type ExchangeEngine = Readonly<{
  markets: () => Promise<EngineResult<FuturesMarkets>>;
  funding: (symbol: string) => Promise<EngineResult<FuturesFunding>>;
  book: (symbol: string) => Promise<EngineResult<FuturesBook>>;
  candles: (symbol: string, timeframe: FuturesTimeframe) => Promise<EngineResult<FuturesCandles>>;
  account: (wallet: string) => Promise<EngineResult<FuturesAccount>>;
  ticket: (query: TicketQuery) => Promise<EngineResult<TicketFigures>>;
  orderStates: (owner: string) => Promise<EngineResult<OrderStates>>;
  collateralStates: (owner: string) => Promise<EngineResult<CollateralStates>>;
  history: (wallet: string, kind: HistoryKind, symbol: string | null) => Promise<EngineResult<History>>;
  reviewOrder: (body: OrderBody) => Promise<EngineResult<OrderReview>>;
  submitOrder: (ticket: string, signed: readonly string[]) => Promise<EngineResult<OrderRelay>>;
  orderStatus: (owner: string, signature: string) => Promise<EngineResult<Readonly<{ results: readonly OrderSignatureState[] }>>>;
  reviewCollateral: (body: CollateralBody) => Promise<EngineResult<CollateralReview>>;
  submitCollateral: (ticket: string, signed: readonly string[]) => Promise<EngineResult<CollateralRelay>>;
  collateralStatus: (signature: string) => Promise<EngineResult<Readonly<{ results: readonly CollateralSignatureState[] }>>>;
}>;

const READ_MS = 12_000;
const TICKET_MS = 15_000;
const REVIEW_MS = 32_000;
/** The relay answers before its own minute is up; a little more here so its answer is never cut off. */
const SUBMIT_MS = 65_000;

const BASE = '/api/solana/futures';

/** One read, bounded: a hung read answers TIMEOUT instead of holding the window. */
export async function getJson<T>(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: bound.signal });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: unknown; message?: unknown } }) | null;
    if (!response.ok || !json) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      return { ok: false, failure: { code, message: typeof json?.error?.message === 'string' ? json.error.message : 'The request failed.' } };
    }
    return { ok: true, value: json, status: response.status };
  } catch {
    return { ok: false, failure: timedOut ? { code: 'TIMEOUT', message: 'The server did not answer in time.' } : { code: 'NETWORK', message: 'The request did not complete.' } };
  } finally {
    clearTimeout(timer);
  }
}

/** The ticket's route address: the question field by field, as the route validates it. */
export function ticketUrl(query: TicketQuery): string {
  const params = new URLSearchParams({
    wallet: query.wallet,
    symbol: query.symbol,
    side: query.side,
    type: query.type,
    leverage: String(Math.max(1, Math.floor(query.leverage))),
    slippageBps: String(query.slippageBps),
    feeBps: String(Math.max(0, Math.min(100, query.feeBps))),
  });
  if (query.sizeLots) params.set('size', query.sizeLots);
  if (query.limitTicks) params.set('price', query.limitTicks);
  if (query.reduceOnly) params.set('reduceOnly', '1');
  return `${BASE}/ticket?${params.toString()}`;
}

export function createExchangeEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): ExchangeEngine {
  const q = encodeURIComponent;
  const history = async (wallet: string, kind: HistoryKind, symbol: string | null): Promise<EngineResult<History>> => {
    const read = await getJson<History['value']>(fetchImpl, `${BASE}/history?wallet=${q(wallet)}&kind=${kind}${symbol ? `&symbol=${q(symbol)}` : ''}`, READ_MS);
    return read.ok ? { ok: true, status: read.status, value: { kind, value: read.value } as History } : read;
  };
  return {
    markets: () => getJson(fetchImpl, `${BASE}/markets`, READ_MS),
    funding: (symbol) => getJson(fetchImpl, `${BASE}/funding?symbol=${q(symbol)}`, READ_MS),
    book: (symbol) => getJson(fetchImpl, `${BASE}/book?symbol=${q(symbol)}`, READ_MS),
    candles: (symbol, timeframe) => getJson(fetchImpl, `${BASE}/candles?symbol=${q(symbol)}&tf=${q(timeframe)}`, READ_MS),
    account: (wallet) => getJson(fetchImpl, `${BASE}/account?wallet=${q(wallet)}`, READ_MS),
    ticket: (query) => getJson(fetchImpl, ticketUrl(query), TICKET_MS),
    orderStates: (owner) => getJson(fetchImpl, `${BASE}/orders?owner=${q(owner)}`, READ_MS),
    collateralStates: (owner) => getJson(fetchImpl, `${BASE}/collateral?owner=${q(owner)}`, READ_MS),
    history,
    reviewOrder: (body) => postJson<OrderReview>(fetchImpl, `${BASE}/orders/review`, body, REVIEW_MS),
    submitOrder: (ticket, signed) => postJson<OrderRelay>(fetchImpl, `${BASE}/orders/submit`, { ticket, signed }, SUBMIT_MS),
    orderStatus: (owner, signature) => getJson(fetchImpl, `${BASE}/orders/status?owner=${q(owner)}&signatures=${q(signature)}`, READ_MS),
    reviewCollateral: (body) => postJson<CollateralReview>(fetchImpl, `${BASE}/collateral/review`, body, REVIEW_MS),
    submitCollateral: (ticket, signed) => postJson<CollateralRelay>(fetchImpl, `${BASE}/collateral/submit`, { ticket, signed }, SUBMIT_MS),
    collateralStatus: (signature) => getJson(fetchImpl, `${BASE}/collateral/status?signatures=${q(signature)}`, READ_MS),
  };
}
