import type { PositionsAnswer } from '../../../../lib/liquidity/catalog/positions.ts';
import type { LiquidityRelay, LiquidityReview, RelayState } from '../../../../lib/liquidity/studio/actions.ts';
import { postJson, type EngineResult, type FetchLike } from '../../trade/engine.ts';
import type { ReviewBody } from './deposit.ts';
import type { HarborPool } from './pools.ts';

/**
 * The Harbor's line to Ryntra's pool engine, on the same origin as the rest of Ryntra: the pools list, what a wallet
 * may do now, its positions, the Review (the engine builds, checks and simulates the exact transactions and seals
 * them in a ticket), the relay of the signed bytes, and the chain's word on signatures whose answer was lost. The
 * Harbor only asks and shows; the engine decides.
 */

export type HarborList = Readonly<{ pools: readonly HarborPool[]; at: string | null }>;

export type CapabilityState = Readonly<{ status: string; until?: string }>;
export type ActionStates = Readonly<{ add: CapabilityState; remove: CapabilityState; claim: CapabilityState; maxDepositUsd: number | null }>;

export type SignatureState = Readonly<{ signature: string; state: RelayState; reason: string | null }>;

export type GetLike = (url: string, init: Readonly<{ method: 'GET'; headers: Record<string, string>; signal: AbortSignal }>) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

export type HarborEngine = Readonly<{
  pools: () => Promise<EngineResult<HarborList>>;
  actions: (owner: string) => Promise<EngineResult<ActionStates>>;
  positions: (owner: string, fresh?: boolean) => Promise<EngineResult<PositionsAnswer>>;
  review: (body: ReviewBody) => Promise<EngineResult<LiquidityReview>>;
  submit: (ticket: string, signed: readonly string[]) => Promise<EngineResult<LiquidityRelay>>;
  status: (signatures: readonly string[]) => Promise<EngineResult<Readonly<{ results: readonly SignatureState[] }>>>;
}>;

const READ_MS = 12_000;
const POSITIONS_MS = 32_000;
const REVIEW_MS = 32_000;
/** The relay answers before its own minute is up; a little more here so its answer is never cut off. */
const SUBMIT_MS = 65_000;

async function getJson<T>(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<T>> {
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

export function createHarborEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): HarborEngine {
  const q = encodeURIComponent;
  return {
    pools: () => getJson<HarborList>(fetchImpl, '/api/city/harbor', READ_MS),
    actions: (owner) => getJson<ActionStates>(fetchImpl, `/api/liquidity/actions?owner=${q(owner)}`, READ_MS),
    positions: (owner, fresh) => getJson<PositionsAnswer>(fetchImpl, `/api/liquidity/positions?owner=${q(owner)}${fresh ? '&fresh=1' : ''}`, POSITIONS_MS),
    review: (body) => postJson<LiquidityReview>(fetchImpl, '/api/liquidity/review', body, REVIEW_MS),
    submit: (ticket, signed) => postJson<LiquidityRelay>(fetchImpl, '/api/liquidity/submit', { ticket, signed }, SUBMIT_MS),
    status: (signatures) => getJson(fetchImpl, `/api/liquidity/status?signatures=${q(signatures.join(','))}`, READ_MS),
  };
}
