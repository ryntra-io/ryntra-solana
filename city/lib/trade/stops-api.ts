import type { StopExpiry } from '../../../lib/stops/model.ts';
import type { Side } from './tiles.ts';
import type { Stop, StopCoin } from './stops.ts';

/**
 * The city's line to the engine's stops (CITY-149): the same `/api/v1/stops` routes every Ryntra client calls, on the
 * same origin, under the wallet's proof. A read takes the proof the wallet already gave; a new stop, a cancel and a
 * sale's «done» take the wallet's own signature (Sign In With Solana) — the card asks for it first (`proof.ts`). The
 * engine keeps the stop, watches it with the swap engine's quote and tells the person when it is reached; the city
 * opens the sale and the wallet signs it. Nothing here signs a transaction.
 */

export type EngineStopView = Readonly<{
  id: string;
  side: Side;
  base: StopCoin & Readonly<{ name: string }>;
  quote: StopCoin;
  amountRaw: string;
  price: string;
  thresholdRaw: string;
  createdAt: number;
  expiresAt: number | null;
  state: 'watching' | 'reached' | 'done' | 'cancelled' | 'expired';
  reachedAt: number | null;
}>;

export type StopsFailure = Readonly<{ code: string; status: number }>;
export type StopsResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: StopsFailure }>;

export type StopCreateBody = Readonly<{
  side: Side;
  base: StopCoin & Readonly<{ name: string }>;
  quote: StopCoin;
  amountRaw: string;
  price: string;
  expiry: StopExpiry;
  locale: 'en' | 'uk';
}>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type StopsFetch = (url: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string; credentials: 'include'; cache: 'no-store' }>) => Promise<Answer>;

export type StopsApi = Readonly<{
  list: () => Promise<StopsResult<readonly EngineStopView[]>>;
  create: (body: StopCreateBody) => Promise<StopsResult<EngineStopView>>;
  cancel: (id: string) => Promise<StopsResult<EngineStopView>>;
  finish: (id: string) => Promise<StopsResult<EngineStopView>>;
}>;

const HEADERS = { 'X-Ryntra-API': '1', accept: 'application/json' } as const;

async function call<T>(fetchImpl: StopsFetch, url: string, method: string, body: unknown, pick: (json: Record<string, unknown>) => T | null): Promise<StopsResult<T>> {
  let answer: Answer;
  try {
    answer = await fetchImpl(url, {
      method,
      headers: body === undefined ? { ...HEADERS } : { ...HEADERS, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, failure: { code: 'NETWORK', status: 0 } };
  }
  const json = (await answer.json().catch(() => null)) as Record<string, unknown> | null;
  if (!answer.ok) {
    const error = json && typeof json.error === 'object' && json.error ? (json.error as { code?: unknown }) : null;
    return { ok: false, failure: { code: typeof error?.code === 'string' ? error.code : 'FAILED', status: answer.status } };
  }
  const value = json ? pick(json) : null;
  return value === null ? { ok: false, failure: { code: 'UNREADABLE', status: answer.status } } : { ok: true, value };
}

const isView = (value: unknown): value is EngineStopView => {
  const v = value as Record<string, unknown> | null;
  return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.state === 'string' && typeof v.amountRaw === 'string' && typeof v.thresholdRaw === 'string' && !!v.base && !!v.quote;
};

export function createStopsApi(fetchImpl: StopsFetch = (url, init) => fetch(url, init)): StopsApi {
  return {
    list: () => call(fetchImpl, '/api/v1/stops', 'GET', undefined, (json) => (Array.isArray(json.stops) ? json.stops.filter(isView) : null)),
    create: (body) => call(fetchImpl, '/api/v1/stops', 'POST', body, (json) => (isView(json.stop) ? json.stop : null)),
    cancel: (id) => call(fetchImpl, `/api/v1/stops/${encodeURIComponent(id)}`, 'DELETE', undefined, (json) => (isView(json.stop) ? json.stop : null)),
    finish: (id) => call(fetchImpl, `/api/v1/stops/${encodeURIComponent(id)}`, 'PATCH', { state: 'done' }, (json) => (isView(json.stop) ? json.stop : null)),
  };
}

/** The engine's stop as the city keeps it: the same shape as a stop of the device, its state as the engine says. */
export function stopOfView(view: EngineStopView, owner: string): Stop {
  return {
    id: view.id,
    owner,
    side: view.side,
    base: view.base,
    quote: { mint: view.quote.mint, symbol: view.quote.symbol, decimals: view.quote.decimals },
    amountRaw: view.amountRaw,
    price: view.price,
    thresholdRaw: view.thresholdRaw,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    // The engine's «expired» is the device's own reading of a watched stop past its time (`stopView`).
    state: view.state === 'expired' ? 'watching' : view.state,
    reachedAt: view.reachedAt,
  };
}
