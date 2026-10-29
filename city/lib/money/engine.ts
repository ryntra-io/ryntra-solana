/**
 * The Money window's line to Ryntra's engine: the same routes the rest of Ryntra calls, on the same origin, unchanged.
 * Every figure and every transaction comes from them; the city asks and shows.
 *
 * - Send — `/api/v1/money/recipient` (who), `/api/v1/research/skr-name` (a `.skr` name), `/api/solana/transfer/plan`
 *   (the exact transfer and its Review), `adopt` (a wallet that added its fee), `settle` (sent once), `recover` (what
 *   happened to a signature);
 * - Top up — `/api/swap/deposit-address` (SOL-W1: an address on another network that pays this wallet USDC);
 * - Bridge — `/api/solana/cross-swap/{quote,plan,submit,status,receipt}` (Solana out to another network);
 * - Activity — `/api/solana/activity` and each lane's receipt; Portfolio — `/api/solana/holdings`.
 */

export type FetchLike = (
  url: string,
  init: Readonly<{ method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; cache?: RequestCache }>,
) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type EngineFailure = Readonly<{
  code: string;
  message: string;
  status: number;
  /** Whatever else the refusal carried: a signature, a fresh quote, a submit boundary. */
  extra: Readonly<Record<string, unknown>>;
}>;

export type EngineAnswer<T> = Readonly<{ ok: true; status: number; value: T }> | Readonly<{ ok: false; failure: EngineFailure }>;

export const TIMEOUT_MS = {
  read: 15_000,
  plan: 25_000,
  /** The settle route itself may take 50 s: it submits, then reads the chain back. */
  settle: 60_000,
} as const;

type Ask = Readonly<{ method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal }>;

/** One request to the engine, bounded. The answer's `data` envelope is opened when there is one. */
export async function ask<T>(fetchImpl: FetchLike, url: string, options: Ask = {}): Promise<EngineAnswer<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, options.timeoutMs ?? TIMEOUT_MS.read);
  const outer = options.signal;
  const relay = () => bound.abort();
  outer?.addEventListener('abort', relay, { once: true });
  const lost = (code: string, message: string): EngineAnswer<T> => ({ ok: false, failure: { code, message, status: 0, extra: {} } });
  try {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: bound.signal,
        cache: 'no-store',
      });
    } catch {
      if (outer?.aborted) return lost('ABORTED', 'Superseded.');
      return timedOut ? lost('TIMEOUT', 'The server did not answer in time.') : lost('NETWORK', 'The request did not complete.');
    }
    let json: unknown = null;
    let readable = true;
    try {
      json = await response.json();
    } catch {
      readable = false;
    }
    const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    if (!response.ok) {
      const error = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, unknown>;
      const { code, message, ...extra } = error;
      return {
        ok: false,
        failure: {
          code: typeof code === 'string' ? code : `HTTP_${response.status}`,
          message: typeof message === 'string' ? message : `HTTP ${response.status}`,
          status: response.status,
          extra,
        },
      };
    }
    // A success whose body was cut off is no answer at all, never an empty success.
    if (!readable) return lost(timedOut ? 'TIMEOUT' : 'NETWORK', 'The answer did not arrive whole.');
    return { ok: true, status: response.status, value: ('data' in body ? body.data : body) as T };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

export const browserFetch: FetchLike = (url, init) => fetch(url, init);

/** The header the `/api/v1` routes read: this client speaks major 1. */
export const V1 = { 'X-Ryntra-API': '1' } as const;
