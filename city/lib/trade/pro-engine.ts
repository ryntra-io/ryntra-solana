import type { ProMarket, ProOrder, ProQuoteView, ProRelay, ProReview, ProIntent } from '../../../lib/pro-limits/service.ts';

/**
 * The window's line to the ladders of the engine: the coin's market, a quote, a Review of
 * one action, the relay, and the wallet's orders. It asks and reads; it never builds, signs or sends a transaction —
 * the engine builds, the wallet signs, the relay sends only what its Review showed.
 *
 * Every answer is the engine's own or a refusal with its code: a request that hangs answers `TIMEOUT`, one that never
 * reached the engine `NETWORK`, and neither is read as «no market» or «no orders».
 */

export type LadderFailure = Readonly<{ code: string; message: string }>;
export type LadderResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: LadderFailure }>;

export type Fetch = (url: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }>) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type ReviewAsk =
  | Readonly<{ action: 'place'; owner: string; mint: string; intent: ProIntent; agent: boolean }>
  | Readonly<{ action: 'collect' | 'close'; owner: string; pool: string; nftMint: string }>
  | Readonly<{ action: 'delegate'; owner: string; pool: string; nftMint: string; agent: boolean }>;

export type LadderEngine = Readonly<{
  market: (mint: string) => Promise<LadderResult<ProMarket | null>>;
  quote: (mint: string, intent: ProIntent) => Promise<LadderResult<ProQuoteView>>;
  review: (ask: ReviewAsk) => Promise<LadderResult<ProReview>>;
  submit: (ticket: string, signed: readonly string[]) => Promise<LadderResult<ProRelay>>;
  orders: (owner: string, mint: string | null) => Promise<LadderResult<readonly ProOrder[]>>;
}>;

const READ_MS = 12_000;
const BUILD_MS = 30_000;
const RELAY_MS = 55_000;
const HEADERS = { 'content-type': 'application/json', 'x-ryntra-api': '1' };

async function ask<T>(fetchImpl: Fetch, url: string, method: 'GET' | 'POST', payload: unknown, timeoutMs: number): Promise<LadderResult<T>> {
  const bound = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { method, headers: HEADERS, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}), signal: bound.signal });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = (body?.error && typeof body.error === 'object' ? body.error : {}) as Partial<LadderFailure>;
      return { ok: false, failure: { code: typeof error.code === 'string' ? error.code : `HTTP_${response.status}`, message: typeof error.message === 'string' ? error.message : '' } };
    }
    /* A success whose body was cut off is no answer at all, never an empty one. */
    if (body === null) return { ok: false, failure: { code: 'NETWORK', message: '' } };
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, failure: { code: late ? 'TIMEOUT' : 'NETWORK', message: '' } };
  } finally {
    clearTimeout(timer);
  }
}

const q = encodeURIComponent;

export function createLadderEngine(fetchImpl: Fetch = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as Fetch): LadderEngine {
  return {
    market: async (mint) => {
      const answer = await ask<{ market: ProMarket | null }>(fetchImpl, `/api/v1/ladders/market?mint=${q(mint)}`, 'GET', null, READ_MS);
      return answer.ok ? { ok: true, value: answer.value.market ?? null } : answer;
    },
    quote: (mint, intent) => ask(fetchImpl, '/api/v1/ladders/quote', 'POST', { mint, intent }, READ_MS),
    review: (body) => ask(fetchImpl, '/api/v1/ladders/review', 'POST', body, BUILD_MS),
    submit: (ticket, signed) => ask(fetchImpl, '/api/v1/ladders/submit', 'POST', { ticket, signed }, RELAY_MS),
    orders: async (owner, mint) => {
      const answer = await ask<{ orders: readonly ProOrder[] }>(fetchImpl, `/api/v1/ladders/orders?owner=${q(owner)}${mint ? `&mint=${q(mint)}` : ''}`, 'GET', null, READ_MS);
      return answer.ok ? { ok: true, value: answer.value.orders ?? [] } : answer;
    },
  };
}
