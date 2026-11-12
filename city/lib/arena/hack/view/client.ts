import type { FindingView, HackRole, OrderDetail, OrderView, RunFeed, TakeView } from './contract.ts';

/**
 * Hack on the server, as the city's windows call it (CITY-227): `/api/arena/hack` on the same origin (CITY-226). The
 * wallet's session travels in its HttpOnly cookie, so this client never sees it; every write carries an
 * `Idempotency-Key`, and a retry of the same write sends the same one. A refusal comes back as `HackClientError` with
 * the route's own code; a lost connection, an answer the city does not read, a missing route — codes of their own.
 */

export type OwnerMove = 'pause' | 'resume';
export type Verdict = 'confirm' | 'reject';

export interface HackClient {
  orders(): Promise<{ orders: OrderView[] }>;
  order(id: string): Promise<OrderDetail>;
  finding(id: string): Promise<{ finding: FindingView }>;
  /** The live run of an agent on an order; `null` when there is none (no machine plays runs on this deployment). */
  run(order: string, hunter: string): Promise<{ run: RunFeed | null }>;
  /** `run` — whether the server started the agent's run on the take, and why not (CITY-238). */
  take(order: string, hunter: string, role: HackRole, key: string): Promise<{ take: TakeView; again: boolean; run?: { started: boolean; reason?: string } }>;
  confirm(finding: string, verdict: Verdict, key: string): Promise<{ finding: FindingView }>;
  move(order: string, move: OwnerMove, key: string): Promise<{ order: OrderView }>;
}

/** The route's own codes (`../store/api.ts`), and the client's: no connection, an unread answer, no such route. */
export type HackClientCode = string;

export class HackClientError extends Error {
  readonly status: number;
  readonly code: HackClientCode;
  constructor(status: number, code: HackClientCode, message: string) {
    super(message);
    this.name = 'HackClientError';
    this.status = status;
    this.code = code;
  }
}

type Refusal = { error?: { code?: unknown; message?: unknown } };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isOrder = (v: unknown): v is OrderView => isRecord(v) && typeof v.id === 'string' && typeof v.title === 'string' && isRecord(v.scope) && typeof v.status === 'string';
const isFinding = (v: unknown): v is FindingView => isRecord(v) && typeof v.id === 'string' && typeof v.status === 'string' && typeof v.sealed === 'boolean';
const isTake = (v: unknown): v is TakeView => isRecord(v) && typeof v.hunter === 'string' && (v.role === 'attacker' || v.role === 'defender');
const isRun = (v: unknown): v is RunFeed => isRecord(v) && typeof v.hunter === 'string' && Array.isArray(v.history) && (v.status === 'running' || v.status === 'done');

export function createHttpHack({ base = '/api/arena/hack', fetch: get = (...args: Parameters<typeof fetch>) => fetch(...args) }: { base?: string; fetch?: typeof fetch } = {}): HackClient {
  async function call<T>(path: string, init: RequestInit, valid: (body: unknown) => boolean): Promise<T> {
    let res: Response;
    try {
      res = await get(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
    } catch {
      throw new HackClientError(0, 'OFFLINE', 'No connection. Nothing was changed.');
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (body as Refusal | null)?.error;
      throw new HackClientError(res.status, typeof e?.code === 'string' ? e.code : 'UNAVAILABLE', typeof e?.message === 'string' ? e.message : 'Hack could not be reached.');
    }
    if (!valid(body)) throw new HackClientError(502, 'BAD_ANSWER', 'Hack answered in a way the city does not read.');
    return body as T;
  }
  const write = <T>(path: string, body: unknown, key: string, valid: (b: unknown) => boolean) =>
    call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }, valid);
  const q = encodeURIComponent;

  return {
    orders: () => call('/orders', {}, (b) => isRecord(b) && Array.isArray(b.orders) && b.orders.every(isOrder)),
    order: (id) =>
      call(`/order?id=${q(id)}`, {}, (b) => isRecord(b) && isOrder(b.order) && Array.isArray(b.takes) && b.takes.every(isTake) && Array.isArray(b.findings) && b.findings.every(isFinding)),
    finding: (id) => call(`/finding?id=${q(id)}`, {}, (b) => isRecord(b) && isFinding(b.finding)),
    async run(order, hunter) {
      try {
        return await call<{ run: RunFeed | null }>(`/run?order=${q(order)}&hunter=${q(hunter)}`, {}, (b) => isRecord(b) && (b.run === null || isRun(b.run)));
      } catch (error) {
        // A server without the run's route answers «no such route»: there is no run to show, not a failure.
        if (error instanceof HackClientError && error.status === 404 && error.code === 'NOT_FOUND') return { run: null };
        throw error;
      }
    },
    take: (order, hunter, role, key) => write('/take', { order, hunter, role }, key, (b) => isRecord(b) && isTake(b.take)),
    confirm: (finding, verdict, key) => write('/confirm', { finding, verdict }, key, (b) => isRecord(b) && isFinding(b.finding)),
    move: (order, move, key) => write('/move', { order, move }, key, (b) => isRecord(b) && isOrder(b.order)),
  };
}

export const httpHack: HackClient = createHttpHack();
