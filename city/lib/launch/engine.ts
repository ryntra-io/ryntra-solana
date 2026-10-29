import type {
  LaunchBuildRequest,
  LaunchBuildResponse,
  LaunchCrewsResponse,
  LaunchMarketResponse,
  LaunchMarketsResponse,
  LaunchMetadataRequest,
  LaunchMetadataResponse,
  LaunchPresetsResponse,
  LaunchSubmitRequest,
  LaunchSubmitResponse,
  LaunchSurvivalResponse,
} from '../../../lib/api/v1/contract.ts';

/**
 * The city's line to Ryntra's Launch engine: the same `/api/v1/launch` routes every Ryntra client calls, on the same
 * origin. The city never builds, signs or counts anything itself — it hands the engine what the creator typed, hands the
 * wallet the bytes the engine built, and shows what the engine answers.
 */

export type Network = 'solana:devnet' | 'solana:mainnet';

/** An engine answer: its data, or the contract's error code and the engine's own words. */
export type Answer<T> = Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; code: string; message: string }>;

export interface LaunchEngine {
  presets(): Promise<Answer<LaunchPresetsResponse>>;
  metadata(body: LaunchMetadataRequest): Promise<Answer<LaunchMetadataResponse>>;
  build(body: LaunchBuildRequest): Promise<Answer<LaunchBuildResponse>>;
  submit(body: LaunchSubmitRequest): Promise<Answer<LaunchSubmitResponse>>;
  markets(): Promise<Answer<LaunchMarketsResponse>>;
  survival(): Promise<Answer<LaunchSurvivalResponse>>;
  crews(): Promise<Answer<LaunchCrewsResponse>>;
  market(token: string): Promise<Answer<LaunchMarketResponse>>;
}

/**
 * The contract the city reads: since 1.50.0 a busy hour is `LAUNCH_BUSY` and since 1.73.0 a changed pair currency is
 * `LAUNCH_QUOTE_PAUSED`, rather than a pause.
 */
export const API_HEADERS = { 'content-type': 'application/json', 'X-Ryntra-API': '1', 'X-Ryntra-API-Version': '1.73.0' } as const;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The engine over HTTP. A network failure or an answer that is not the engine's reads as `UNAVAILABLE`, never as data. */
export function httpEngine(fetcher: typeof fetch = (input, init) => fetch(input, init)): LaunchEngine {
  async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
    try {
      const response = await fetcher(path, { cache: 'no-store', ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
      const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
      if (!response.ok || !body) {
        const code = typeof body?.error?.code === 'string' ? body.error.code : 'UNAVAILABLE';
        const message = typeof body?.error?.message === 'string' ? body.error.message : '';
        return { ok: false, code, message };
      }
      return { ok: true, data: body as T };
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '' };
    }
  }
  const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    presets: () => call('/api/v1/launch/presets'),
    metadata: (body) => post('/api/v1/launch/metadata', body),
    build: (body) => post('/api/v1/launch/build', body),
    submit: (body) => post('/api/v1/launch/submit', body),
    markets: () => call('/api/v1/launch/markets'),
    survival: () => call('/api/v1/launch/survival'),
    crews: () => call('/api/v1/launch/crews'),
    market: (token) => (BASE58.test(token) ? call(`/api/v1/launch/${token}/market`) : Promise.resolve({ ok: false, code: 'VALIDATION_ERROR', message: '' })),
  };
}
