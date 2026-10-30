import { askOnceMore, SWAP_TIMEOUT_MS } from '../../../lib/solana/swap-press.ts';
import { wordsNow } from '../i18n/dict.ts';
import { LINE } from './words.ts';
import type {
  SwapExecuteResponse,
  SwapOrderResponse,
  SwapOriginRequest,
  SwapQuoteResponse,
  SwapRecoverResponse,
} from '../../../packages/ryntra-api-client/src/types.ts';

/**
 * The city's line to Ryntra's swap engine: the same four routes the rest of Ryntra uses, on the same origin. The
 * engine prices the swap with its fee policy, builds and checks the exact transaction, sends the signed bytes once and
 * reads the outcome from the chain. The city only asks and shows; it never changes what the engine answers.
 *
 * - `quote` — a price for any amount, no wallet needed;
 * - `order` — the exact transaction for the connected wallet to sign, with the engine's own checks over it;
 * - `execute` — the signed bytes, sent once; never repeated;
 * - `recover` — what happened to a signature, read from the chain.
 */

export type QuoteBody = SwapQuoteResponse;
/** The order also says how long its bytes may still be signed after they arrive. */
export type OrderBody = SwapOrderResponse & Readonly<{ signableMs?: number }>;
export type ExecuteBody = SwapExecuteResponse;
export type RecoverBody = SwapRecoverResponse;

export type EngineFailure = Readonly<{
  code: string;
  message: string;
  /** The engine refused before it claimed the signature: the network never saw those bytes. */
  submitBoundary?: 'NOT_CROSSED';
  /** The wallet already has an open swap; a signature here must be read back, never signed again. */
  ownerLock?: Readonly<{ state: string; requestId: string; signature: string | null }> | null;
  /** The limits lane names the signature it relayed when its answer after the relay was not clear. */
  signature?: string;
}>;

export type EngineResult<T> = Readonly<{ ok: true; value: T; status: number }> | Readonly<{ ok: false; failure: EngineFailure }>;

export type FetchLike = (
  url: string,
  init: Readonly<{ method: string; headers: Record<string, string>; body: string; signal: AbortSignal }>,
) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type QuoteRequest = Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>;
export type OrderRequest = Readonly<{ inputMint: string; outputMint: string; amountRaw: string; taker: string }>;

export type Engine = Readonly<{
  quote: (input: QuoteRequest) => Promise<EngineResult<QuoteBody>>;
  order: (input: OrderRequest, origin?: SwapOriginRequest) => Promise<EngineResult<OrderBody>>;
  execute: (body: Readonly<{ bundle: unknown; proof: unknown; signedTransactionBase64: string; reviewedTransactionBase64: string }>) => Promise<EngineResult<ExecuteBody>>;
  recover: (body: Readonly<{ owner: string; signature: string; requestId?: string }>) => Promise<EngineResult<RecoverBody>>;
}>;

export type Timers = Readonly<{ set: (run: () => void, ms: number) => unknown; clear: (timer: unknown) => void }>;

const DEFAULT_TIMERS: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** One request, bounded: a hung request answers TIMEOUT instead of holding the card forever. */
export async function postJson<T>(fetchImpl: FetchLike, url: string, payload: unknown, timeoutMs: number, timers: Timers = DEFAULT_TIMERS): Promise<EngineResult<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = timers.set(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  const lost = (fallback: string): EngineResult<T> => ({
    ok: false,
    failure: timedOut ? { code: 'TIMEOUT', message: wordsNow(LINE).serverLate } : { code: 'NETWORK', message: fallback },
  });
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: bound.signal });
  } catch {
    timers.clear(timer);
    return lost(wordsNow(LINE).notComplete);
  }
  let json: unknown;
  let readable = true;
  try {
    json = await response.json();
  } catch {
    readable = false;
  }
  timers.clear(timer);
  // A success whose body was cut off is no answer at all, never an empty success.
  if (!readable && (response.ok || response.status === 202)) return lost(wordsNow(LINE).notWhole);
  const value = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  if (!response.ok && response.status !== 202) {
    const error = (value.error && typeof value.error === 'object' ? value.error : {}) as Partial<EngineFailure>;
    return {
      ok: false,
      failure: {
        code: typeof error.code === 'string' ? error.code : `HTTP_${response.status}`,
        message: typeof error.message === 'string' ? error.message : wordsNow(LINE).failed,
        ...(error.submitBoundary === 'NOT_CROSSED' ? { submitBoundary: 'NOT_CROSSED' as const } : {}),
        ...(typeof error.signature === 'string' ? { signature: error.signature } : {}),
        ownerLock: error.ownerLock ?? null,
      },
    };
  }
  return { ok: true, value: value as T, status: response.status };
}

/** A price or an order, asked once more by itself when the first ask never arrived. Never an execute. */
async function askTwice<T>(ask: () => Promise<EngineResult<T>>, wait: (ms: number) => Promise<void>): Promise<EngineResult<T>> {
  const first = await ask();
  if (first.ok || !askOnceMore(first.failure.code)) return first;
  await wait(400);
  return ask();
}

export function createEngine(
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  options: Readonly<{ timers?: Timers; wait?: (ms: number) => Promise<void> }> = {},
): Engine {
  const timers = options.timers ?? DEFAULT_TIMERS;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    quote: (input) => askTwice(() => postJson<QuoteBody>(fetchImpl, '/api/solana/swap/quote', input, SWAP_TIMEOUT_MS.quote, timers), wait),
    order: (input, origin) =>
      askTwice(() => postJson<OrderBody>(fetchImpl, '/api/solana/swap/order', origin ? { input, origin } : { input }, SWAP_TIMEOUT_MS.order, timers), wait),
    execute: (body) => postJson<ExecuteBody>(fetchImpl, '/api/solana/swap/execute', body, SWAP_TIMEOUT_MS.execute, timers),
    recover: (body) => postJson<RecoverBody>(fetchImpl, '/api/solana/swap/recover', body, SWAP_TIMEOUT_MS.recover, timers),
  };
}
