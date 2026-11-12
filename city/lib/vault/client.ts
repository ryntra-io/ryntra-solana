import type { AttemptResponse, FeedResponse, Guards, VaultErrorCode, VaultId, VaultState } from '../../../lib/vault/contract.ts';
import { randomId } from '../quarter/ids.ts';

/**
 * The vault on the server: `/api/vault` on the same origin. The guest's key travels in its HttpOnly cookie, so this
 * client never sees it; every attempt carries an Idempotency-Key, and a retry of the same attempt sends the same one.
 */
export interface VaultClient {
  state(): Promise<VaultState>;
  attempt(vault: VaultId, text: string, key?: string): Promise<AttemptResponse>;
  feed(vault: VaultId, before?: string | null): Promise<FeedResponse>;
}

export type VaultClientCode = VaultErrorCode | 'OFFLINE' | 'BAD_ANSWER';

export class VaultClientError extends Error {
  readonly status: number;
  readonly code: VaultClientCode;
  readonly retryAfterS: number | null;
  readonly window: 'minute' | 'day' | null;
  /** While the guards rest: until when, and whether a wallet would find them awake. */
  readonly guards: Guards | null;

  constructor(status: number, code: VaultClientCode, message: string, retryAfterS: number | null = null, window: 'minute' | 'day' | null = null, guards: Guards | null = null) {
    super(message);
    this.name = 'VaultClientError';
    this.status = status;
    this.code = code;
    this.retryAfterS = retryAfterS;
    this.window = window;
    this.guards = guards;
  }
}

type Refusal = { error?: { code?: unknown; message?: unknown; retryAfterS?: unknown; window?: unknown; guards?: unknown } };

const isGuards = (value: unknown): value is Guards =>
  !!value && typeof (value as Guards).awake === 'boolean' && typeof (value as Guards).walletsAwake === 'boolean' && ((value as Guards).wakesAt === null || typeof (value as Guards).wakesAt === 'string');

export function createHttpVault({ base = '/api/vault', fetch: get = (...args: Parameters<typeof fetch>) => fetch(...args) }: { base?: string; fetch?: typeof fetch } = {}): VaultClient {
  async function call<T>(path: string, init: RequestInit, valid: (body: unknown) => boolean): Promise<T> {
    let res: Response;
    try {
      res = await get(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
    } catch {
      throw new VaultClientError(0, 'OFFLINE', 'No connection. Nothing was counted.');
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (body as Refusal | null)?.error;
      throw new VaultClientError(
        res.status,
        (typeof e?.code === 'string' ? e.code : 'UNAVAILABLE') as VaultErrorCode,
        typeof e?.message === 'string' ? e.message : 'The vault could not be reached.',
        typeof e?.retryAfterS === 'number' ? e.retryAfterS : null,
        e?.window === 'minute' || e?.window === 'day' ? e.window : null,
        isGuards(e?.guards) ? e.guards : null,
      );
    }
    if (!valid(body)) throw new VaultClientError(502, 'BAD_ANSWER', 'The vault answered in a way the city does not read.');
    return body as T;
  }
  const isState = (b: unknown) => !!b && Array.isArray((b as VaultState).vaults) && typeof (b as VaultState).me === 'object';
  return {
    state: () => call<VaultState>('/state', {}, isState),
    attempt: (vault, text, key = randomId()) =>
      call<AttemptResponse>(
        '/attempt',
        { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ vault, text }) },
        (b) => !!b && typeof (b as AttemptResponse).outcome === 'string' && isState((b as AttemptResponse).state),
      ),
    feed: (vault, before = null) => call<FeedResponse>(`/feed?vault=${encodeURIComponent(vault)}${before ? `&before=${encodeURIComponent(before)}` : ''}`, {}, (b) => !!b && Array.isArray((b as FeedResponse).entries)),
  };
}

export const httpVault: VaultClient = createHttpVault();
