import type { LiquidityReview } from '../../../lib/liquidity/studio/actions.ts';
import { createHarborEngine, type GetLike, type HarborEngine } from '../districts/harbor/engine.ts';
import type { ReviewBody } from '../districts/harbor/deposit.ts';
import { postJson, type EngineResult, type FetchLike } from '../trade/engine.ts';
import type { PierStates } from './pier-gate.ts';
import { HISTORY_BARS, HISTORY_TIMEFRAME } from './pier-history.ts';

/**
 * The SOL Pier's line to the server (CITY-93): the Harbor's own engine line for the relay and the chain's word on a
 * signature, with the city's door in front of the Review (`/api/city/earn/piers/review`), what one wallet may do
 * (`/api/city/earn/piers/admit`), and the engine's candle read for the «Past 30 days» picture. The window only asks and
 * shows; the engine builds and decides.
 */

export type PierEngine = HarborEngine &
  Readonly<{
    admit: (owner: string) => Promise<EngineResult<PierStates>>;
    candles: (mint: string) => Promise<EngineResult<unknown>>;
  }>;

const READ_MS = 12_000;
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

export function createPierEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): PierEngine {
  const q = encodeURIComponent;
  const harbor = createHarborEngine(fetchImpl);
  return {
    ...harbor,
    review: (body: ReviewBody) => postJson<LiquidityReview>(fetchImpl, '/api/city/earn/piers/review', body, REVIEW_MS),
    admit: (owner) => getJson<PierStates>(fetchImpl, `/api/city/earn/piers/admit?owner=${q(owner)}`, READ_MS),
    candles: (mint) => getJson<unknown>(fetchImpl, `/api/spot/candles?mint=${q(mint)}&tf=${HISTORY_TIMEFRAME}&limit=${HISTORY_BARS}`, READ_MS),
  };
}
