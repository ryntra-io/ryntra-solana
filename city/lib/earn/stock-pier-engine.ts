import type { LiquidityReview } from '../../../lib/liquidity/studio/actions.ts';
import { createHarborEngine, type GetLike, type HarborEngine } from '../districts/harbor/engine.ts';
import { postJson, type EngineResult, type FetchLike } from '../trade/engine.ts';
import type { StockPierStates } from './stock-pier-gate.ts';
import { readStockPierList, type StockBuildBody, type StockPierList } from './stock-pier.ts';

/**
 * The Stock Pier's line to the server (CITY-98): the verified pairs (`/api/city/earn/stock-piers`), what one wallet may
 * do (`/admit`), the city's door in front of the engine's Review (`/review`), and the Harbor's own line for the engine's
 * relay and the chain's word on a signature. The window only asks and shows; the engine builds and decides.
 */

/** A Review from the Stock Pier's door: the engine's own, and whether it builds the pier or moors beside it. */
export type StockReview = LiquidityReview & Readonly<{ stockPier?: Readonly<{ builds: boolean; pool: string }> }>;

export type ExitBody = Readonly<{
  action: 'claim' | 'remove';
  venue: 'meteora-damm2';
  request: Readonly<Record<string, unknown>>;
}>;

export type StockPierEngine = HarborEngine &
  Readonly<{
    list: () => Promise<EngineResult<StockPierList>>;
    admit: (owner: string) => Promise<EngineResult<StockPierStates>>;
    /** The city's door in front of the engine's Review. */
    door: (body: StockBuildBody | ExitBody) => Promise<EngineResult<StockReview>>;
  }>;

const READ_MS = 20_000;
const REVIEW_MS = 32_000;

async function getJson(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<unknown>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: bound.signal,
    });
    const json = (await response.json().catch(() => null)) as {
      error?: { code?: unknown };
    } | null;
    if (!response.ok || !json) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      return { ok: false, failure: { code, message: code } };
    }
    return { ok: true, value: json, status: response.status };
  } catch {
    return {
      ok: false,
      failure: timedOut ? { code: 'TIMEOUT', message: 'TIMEOUT' } : { code: 'NETWORK', message: 'NETWORK' },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createStockPierEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): StockPierEngine {
  const harbor = createHarborEngine(fetchImpl);
  return {
    ...harbor,
    list: async () => {
      const read = await getJson(fetchImpl, '/api/city/earn/stock-piers', READ_MS);
      if (!read.ok) return read;
      const list = readStockPierList(read.value);
      return list ? { ok: true, value: list, status: read.status } : { ok: false, failure: { code: 'MALFORMED', message: 'MALFORMED' } };
    },
    admit: async (owner) => {
      const read = await getJson(fetchImpl, `/api/city/earn/stock-piers/admit?owner=${encodeURIComponent(owner)}`, READ_MS);
      return read as EngineResult<StockPierStates>;
    },
    door: (body) => postJson<StockReview>(fetchImpl, '/api/city/earn/stock-piers/review', body, REVIEW_MS),
  };
}
