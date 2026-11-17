import type { EarnProPiersResponse, EarnProPositionsResponse, EarnProReviewRequest, EarnProReviewResponse, EarnProStatusResponse, EarnProSubmitResponse } from '../../../lib/api/v1/contract.ts';
import type { LiquidityRelay } from '../../../lib/liquidity/studio/actions.ts';
import type { GetLike, SignatureState } from '../districts/harbor/engine.ts';
import { postJson, type EngineResult, type FetchLike } from '../trade/engine.ts';

/**
 * The Pro piers' line to the server: the five routes of `/api/v1/earn/pro` — the piers, a wallet's
 * positions, the Review of one action, the relay of its signed transactions, the chain's word on a signature. The
 * window only asks and shows; the engine builds and decides.
 *
 * The engine names its refusals `EARN_PRO_…`; here they lose the prefix, so the window's flow — the Harbor's own
 * (`districts/harbor/flow.ts`) — reads `TICKET_EXPIRED` and the rest as it does for every pier.
 */

export type ProEngine = Readonly<{
  piers: () => Promise<EngineResult<EarnProPiersResponse>>;
  positions: (owner: string) => Promise<EngineResult<EarnProPositionsResponse>>;
  review: (body: EarnProReviewRequest) => Promise<EngineResult<EarnProReviewResponse>>;
  submit: (ticket: string, signed: readonly string[]) => Promise<EngineResult<LiquidityRelay>>;
  status: (signatures: readonly string[]) => Promise<EngineResult<Readonly<{ results: readonly SignatureState[] }>>>;
}>;

const READ_MS = 20_000;
const REVIEW_MS = 32_000;
const SUBMIT_MS = 65_000;
const API = { 'x-ryntra-api': '1' };

const plain = <T>(answer: EngineResult<T>): EngineResult<T> => (answer.ok ? answer : { ok: false, failure: { ...answer.failure, code: answer.failure.code.replace(/^EARN_PRO_/, '') } });

async function getJson<T>(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', ...API }, signal: bound.signal });
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

export function createProEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): ProEngine {
  return {
    piers: async () => plain(await getJson<EarnProPiersResponse>(fetchImpl, '/api/v1/earn/pro/piers', READ_MS)),
    positions: async (owner) => plain(await getJson<EarnProPositionsResponse>(fetchImpl, `/api/v1/earn/pro/positions?owner=${encodeURIComponent(owner)}`, READ_MS)),
    review: async (body) => plain(await postJson<EarnProReviewResponse>(fetchImpl, '/api/v1/earn/pro/review', body, REVIEW_MS)),
    submit: async (ticket, signed) => {
      const answer = plain(await postJson<EarnProSubmitResponse>(fetchImpl, '/api/v1/earn/pro/submit', { ticket, signed }, SUBMIT_MS));
      return answer.ok ? { ok: true, status: answer.status, value: { results: answer.value.results, settled: answer.value.settled } } : answer;
    },
    status: async (signatures) => {
      const answer = plain(await postJson<EarnProStatusResponse>(fetchImpl, '/api/v1/earn/pro/status', { signatures }, READ_MS));
      if (!answer.ok) return answer;
      return { ok: true, status: answer.status, value: { results: signatures.map((signature, index) => ({ signature, state: answer.value.states[index]?.state ?? 'UNKNOWN', reason: answer.value.states[index]?.reason ?? null })) } };
    },
  };
}
