import type {
  AgentResponse,
  Archetype,
  BoardResponse,
  GarageResponse,
  MineResponse,
  ModelsResponse,
  QuoteResponse,
  RingErrorCode,
  RingFormat,
} from '../../../lib/ring/contract.ts';
import type { AgentView } from '../../../lib/ring/contract.ts';
import { randomId } from '../quarter/ids.ts';

/**
 * The Ring on the server: `/api/ring` on the same origin. The session travels in its HttpOnly cookie, so this client
 * never sees it; every write carries an Idempotency-Key, and a retry of the same write sends the same one.
 */
export type Draft = { archetype: Archetype; model: string; scenario: string };

export interface RingClient {
  models(): Promise<ModelsResponse>;
  quote(id: string): Promise<QuoteResponse>;
  garage(quarterId: string, slot: number): Promise<GarageResponse>;
  /** The asker's agents and their garage in the Arena (CITY-217). */
  mine(): Promise<MineResponse>;
  /** A format's board, best first (CITY-217). */
  board(format: RingFormat): Promise<BoardResponse>;
  create(quarterId: string, slot: number, draft: Draft, key?: string): Promise<AgentResponse>;
  change(agent: string, version: number, draft: Draft, key?: string): Promise<AgentResponse>;
  off(agent: string, version: number, key?: string): Promise<AgentResponse>;
}

export type RingClientCode = RingErrorCode | 'OFFLINE' | 'BAD_ANSWER';

export class RingClientError extends Error {
  readonly status: number;
  readonly code: RingClientCode;
  /** The agent as it is now, when a write was refused for a version that moved or an agent switched off. */
  readonly current: AgentView | null;

  constructor(status: number, code: RingClientCode, message: string, current: AgentView | null = null) {
    super(message);
    this.name = 'RingClientError';
    this.status = status;
    this.code = code;
    this.current = current;
  }
}

type Refusal = { error?: { code?: unknown; message?: unknown; current?: unknown } };

const isAgent = (value: unknown): value is AgentView => !!value && typeof (value as AgentView).id === 'string' && !!(value as AgentView).brain && Array.isArray((value as AgentView).ratings);

export function createHttpRing({ base = '/api/ring', fetch: get = (...args: Parameters<typeof fetch>) => fetch(...args) }: { base?: string; fetch?: typeof fetch } = {}): RingClient {
  async function call<T>(path: string, init: RequestInit, valid: (body: unknown) => boolean): Promise<T> {
    let res: Response;
    try {
      res = await get(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
    } catch {
      throw new RingClientError(0, 'OFFLINE', 'No connection. Nothing was changed.');
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (body as Refusal | null)?.error;
      throw new RingClientError(
        res.status,
        (typeof e?.code === 'string' ? e.code : 'UNAVAILABLE') as RingErrorCode,
        typeof e?.message === 'string' ? e.message : 'The Ring could not be reached.',
        isAgent(e?.current) ? e.current : null,
      );
    }
    if (!valid(body)) throw new RingClientError(502, 'BAD_ANSWER', 'The Ring answered in a way the city does not read.');
    return body as T;
  }
  const write = (path: string, body: unknown, key: string) =>
    call<AgentResponse>(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }, (b) => isAgent((b as AgentResponse | null)?.agent));
  return {
    models: () => call<ModelsResponse>('/models', {}, (b) => !!b && Array.isArray((b as ModelsResponse).models)),
    quote: (id) => call<QuoteResponse>(`/model?id=${encodeURIComponent(id)}`, {}, (b) => !!b && typeof (b as QuoteResponse).quote?.provider === 'string'),
    garage: (quarterId, slot) =>
      call<GarageResponse>(`/garage?quarter=${encodeURIComponent(quarterId)}&slot=${slot}`, {}, (b) => !!b && 'agent' in (b as object) && ((b as GarageResponse).agent === null || isAgent((b as GarageResponse).agent))),
    mine: () => call<MineResponse>('/mine', {}, (b) => !!b && typeof (b as MineResponse).signedIn === 'boolean' && Array.isArray((b as MineResponse).agents) && (b as MineResponse).agents.every(isAgent)),
    board: (format) => call<BoardResponse>(`/board?format=${encodeURIComponent(format)}`, {}, (b) => !!b && Array.isArray((b as BoardResponse).rows)),
    create: (quarterId, slot, draft, key = randomId()) => write('/create', { quarter: quarterId, slot, ...draft }, key),
    change: (agent, version, draft, key = randomId()) => write('/change', { agent, version, ...draft }, key),
    off: (agent, version, key = randomId()) => write('/off', { agent, version }, key),
  };
}

export const httpRing: RingClient = createHttpRing();
