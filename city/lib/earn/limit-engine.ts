import type { LimitReview } from '../../../lib/liquidity/studio/actions.ts';
import type { LimitOrderView } from '../../../lib/liquidity/studio/limit-orders.ts';
import { createHarborEngine, type GetLike, type HarborEngine } from '../districts/harbor/engine.ts';
import { postJson, type EngineResult, type FetchLike } from '../trade/engine.ts';
import type { LimitMarket } from './limit.ts';
import type { LimitStates } from './limit-gate.ts';

/**
 * Sell Higher's line to the server (CITY-97): the markets that passed every check, what one wallet may do, the
 * wallet's orders as the chain holds them, and the city's door in front of the engine's limit-order Review. The relay
 * and the chain's word on a signature are the engine's own routes, as for the Piers. The window asks and shows; the
 * engine builds and decides.
 */

export type LimitBody =
  | Readonly<{ action: 'limit_place'; venue: 'meteora-dlmm'; request: Readonly<{ pool: string; owner: string; side: 'ask' | 'bid'; amount: string; bins: Readonly<{ lower: number; upper: number }> }> }>
  | Readonly<{ action: 'limit_cancel'; venue: 'meteora-dlmm'; request: Readonly<{ order: string; owner: string }> }>
  | Readonly<{ action: 'limit_roll'; venue: 'meteora-dlmm'; request: Readonly<{ order: string; owner: string; bins: Readonly<{ lower: number; upper: number }> }> }>;

export type LimitEngine = Pick<HarborEngine, 'submit' | 'status'> &
  Readonly<{
    markets: () => Promise<EngineResult<Readonly<{ markets: readonly LimitMarket[]; at: string }>>>;
    admit: (owner: string) => Promise<EngineResult<LimitStates>>;
    orders: (owner: string) => Promise<EngineResult<Readonly<{ owner: string; orders: readonly LimitOrderView[]; at: string }>>>;
    review: (body: LimitBody) => Promise<EngineResult<LimitReview>>;
  }>;

const READ_MS = 15_000;
const ORDERS_MS = 32_000;
const REVIEW_MS = 32_000;

async function getJson<T>(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: bound.signal });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: unknown } }) | null;
    if (!response.ok || !json) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      return { ok: false, failure: { code, message: code } };
    }
    return { ok: true, value: json, status: response.status };
  } catch {
    return { ok: false, failure: timedOut ? { code: 'TIMEOUT', message: 'TIMEOUT' } : { code: 'NETWORK', message: 'NETWORK' } };
  } finally {
    clearTimeout(timer);
  }
}

export function createLimitEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): LimitEngine {
  const q = encodeURIComponent;
  const harbor = createHarborEngine(fetchImpl);
  return {
    submit: harbor.submit,
    status: harbor.status,
    markets: () => getJson(fetchImpl, '/api/city/earn/limits', READ_MS),
    admit: (owner) => getJson<LimitStates>(fetchImpl, `/api/city/earn/limits/admit?owner=${q(owner)}`, READ_MS),
    orders: (owner) => getJson(fetchImpl, `/api/city/earn/limits/orders?owner=${q(owner)}`, ORDERS_MS),
    review: (body) => postJson<LimitReview>(fetchImpl, '/api/city/earn/limits/review', body, REVIEW_MS),
  };
}
