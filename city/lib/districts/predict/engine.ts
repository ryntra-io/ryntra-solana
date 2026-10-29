import type { EngineFailure, EngineResult } from '../../trade/engine.ts';
import { pointsOf, RANGE_ASK, type Ask, type Point, type Range } from './chart.ts';
import { readDetail, readSettle, type Detail, type SettleMarket } from './detail.ts';
import { readDiscover, type Discovered, type Market, type Sort } from './markets.ts';

/**
 * The window's line to Ryntra Predictions — the same engine as the web's Predictions — on the same origin, through its own
 * routes only and never another: the public reads (markets by category, one event, a side's history) and, for a
 * proven Solana wallet, the managed account (link, live balance and positions, the deposit address, withdrawals) and
 * its orders (the Review, then the order the person confirms). The window asks and shows; the engine decides.
 */

export type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type FetchLike = (url: string, init: Readonly<{ method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal }>) => Promise<Answer>;

export type Json = Record<string, unknown>;

export type PredictEngine = Readonly<{
  /** A tab's markets: a category (or all), by the day's volume or the soonest close — or a search, which the engine ranks. */
  discover: (category: string | null, by?: Readonly<{ sort?: Sort; q?: string }>) => Promise<EngineResult<Discovered>>;
  event: (eventId: string, card?: Market | null) => Promise<EngineResult<Detail>>;
  settle: (eventId: string) => Promise<EngineResult<Readonly<{ id: string; markets: readonly SettleMarket[] }>>>;
  chart: (outcomeId: string, range: Range | Ask) => Promise<EngineResult<readonly Point[]>>;
  live: () => Promise<EngineResult<Json>>;
  account: () => Promise<EngineResult<Json>>;
  funding: () => Promise<EngineResult<Json>>;
  linkStart: () => Promise<EngineResult<Json>>;
  linkVerify: (message: string, signature: string) => Promise<EngineResult<Json>>;
  quote: (body: QuoteBody) => Promise<EngineResult<Json>>;
  place: (quoteId: string) => Promise<EngineResult<Json>>;
  order: (quoteId: string) => Promise<EngineResult<Json>>;
  withdrawPreview: (body: Readonly<{ amountRaw: string }> | Readonly<{ max: true }>) => Promise<EngineResult<Json>>;
  withdraw: (body: Readonly<{ requestId: string; amountRaw: string; reviewedReceiveRaw: string; reviewedFeeRaw: string | null }>) => Promise<EngineResult<Json>>;
  withdrawal: (requestId: string) => Promise<EngineResult<Json>>;
  /** Collect: the person's own act on winning positions the venue marks payable; the answer is the receipt. */
  redeem: (outcomeIds: readonly string[]) => Promise<EngineResult<Json>>;
}>;

export type QuoteBody = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  side: 'buy' | 'sell';
  spendUsd?: number;
  sellShares?: number;
  locale: 'en';
  mode: 'live';
}>;

const READ_MS = 15_000;
/** A Review and an order wait on the venues: the engine answers within its own half minute. */
const ORDER_MS = 35_000;
const MONEY_MS = 48_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BAD_SHAPE: EngineFailure = { code: 'BAD_SHAPE', message: 'Predictions answered in a shape the window does not read.' };
const NOT_AN_ID: EngineFailure = { code: 'VALIDATION_ERROR', message: 'That is not an id.' };

async function ask(fetchImpl: FetchLike, method: 'GET' | 'POST', url: string, body: unknown, timeoutMs: number): Promise<EngineResult<Json>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST') headers['content-type'] = 'application/json';
    const response = await fetchImpl(url, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}), signal: bound.signal });
    const json = (await response.json().catch(() => null)) as (Json & { error?: { code?: unknown; message?: unknown } }) | null;
    if (!response.ok && response.status !== 202) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      return { ok: false, failure: { code, message: typeof json?.error?.message === 'string' ? json.error.message : 'The request failed.' } };
    }
    // A success whose body was cut off is no answer at all, never an empty success.
    if (!json || typeof json !== 'object') return { ok: false, failure: { code: 'NETWORK', message: 'The answer did not arrive whole.' } };
    return { ok: true, value: json, status: response.status };
  } catch {
    return { ok: false, failure: timedOut ? { code: 'TIMEOUT', message: 'Predictions did not answer in time.' } : { code: 'NETWORK', message: 'The request did not complete.' } };
  } finally {
    clearTimeout(timer);
  }
}

function read<T>(got: EngineResult<Json>, map: (json: Json) => T | null): EngineResult<T> {
  if (!got.ok) return got;
  const value = map(got.value);
  return value === null ? { ok: false, failure: BAD_SHAPE } : { ok: true, value, status: got.status };
}

const defaultFetch: FetchLike = (url, init) => fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init }) as unknown as Promise<Answer>;

export function createPredictEngine(fetchImpl: FetchLike = defaultFetch): PredictEngine {
  const get = (url: string, ms = READ_MS) => ask(fetchImpl, 'GET', url, null, ms);
  const post = (url: string, body: unknown, ms: number) => ask(fetchImpl, 'POST', url, body, ms);
  const q = encodeURIComponent;
  return {
    discover: async (category, by = {}) => {
      if (category !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(category)) return { ok: false, failure: NOT_AN_ID };
      const words = by.q?.trim().slice(0, 80) ?? '';
      if (words) return read(await get(`/api/predictions/discover?q=${q(words)}&limit=30`), readDiscover);
      const sort = by.sort === 'ending' ? 'ending' : 'volume24h';
      return read(await get(`/api/predictions/discover?sort=${sort}&limit=40${category ? `&category=${q(category)}` : ''}`), readDiscover);
    },
    event: async (eventId, card = null) => (ID.test(eventId) ? read(await get(`/api/predictions/events/${q(eventId)}`), (json) => readDetail(json, card)) : { ok: false, failure: NOT_AN_ID }),
    settle: async (eventId) => (ID.test(eventId) ? read(await get(`/api/predictions/events/${q(eventId)}`), readSettle) : { ok: false, failure: NOT_AN_ID }),
    chart: async (outcomeId, range) => {
      if (!ID.test(outcomeId)) return { ok: false, failure: NOT_AN_ID };
      const { resolution, countBack } = typeof range === 'string' ? RANGE_ASK[range] : range;
      return read(await get(`/api/predictions/outcomes/${q(outcomeId)}/chart?resolution=${resolution}&countBack=${countBack}`), pointsOf);
    },
    live: () => get('/api/predictions/live', MONEY_MS),
    account: () => get('/api/predictions/account', MONEY_MS),
    funding: () => get('/api/predictions/funding', MONEY_MS),
    linkStart: () => post('/api/predictions/link/start', {}, READ_MS),
    linkVerify: (message, signature) => post('/api/predictions/link/verify', { message, signature, encoding: 'base64' }, MONEY_MS),
    quote: (body) => post('/api/predictions/quote', body, ORDER_MS),
    place: async (quoteId) => (ID.test(quoteId) ? post('/api/predictions/orders', { quoteId }, ORDER_MS) : { ok: false, failure: NOT_AN_ID }),
    order: async (quoteId) => (ID.test(quoteId) ? get(`/api/predictions/orders/${q(quoteId)}`) : { ok: false, failure: NOT_AN_ID }),
    withdrawPreview: (body) => post('/api/predictions/funding/preview', body, MONEY_MS),
    withdraw: (body) => post('/api/predictions/funding/withdraw', body, MONEY_MS),
    withdrawal: async (requestId) => (UUID.test(requestId) ? post(`/api/predictions/funding/withdrawals/${q(requestId)}`, {}, MONEY_MS) : { ok: false, failure: NOT_AN_ID }),
    redeem: async (outcomeIds) => {
      const ids = [...new Set(outcomeIds)].filter((id) => ID.test(id)).slice(0, 20);
      return ids.length ? post('/api/predictions/redeem', { outcomeIds: ids }, MONEY_MS) : { ok: false, failure: NOT_AN_ID };
    },
  };
}
