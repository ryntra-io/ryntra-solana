import type { WorldClient } from './client.ts';
import { randomId } from './ids.ts';
import type {
  AwayResponse,
  BuildRequest,
  BuildResponse,
  ClaimResponse,
  ConsentRequest,
  ConsentResponse,
  District,
  DistrictResponse,
  Id,
  LinkRequest,
  LinkResponse,
  MeResponse,
  QuarterResponse,
  VisitResponse,
  WorldErrorCode,
  WorldVersion,
} from './types.ts';
import { WorldError, isWorldError, type Building, type Quarter } from './types.ts';

/**
 * The world on the server: /api/world on the same origin as /api/v1. The guest's key travels in its HttpOnly
 * cookie, so this client never sees it; every write carries an Idempotency-Key, and a retry sends the same one.
 */

export type HttpOptions = {
  base?: string;
  fetch?: typeof fetch;
  newKey?: () => string;
};

type Refusal = {
  error?: { code?: unknown; reason?: unknown; need?: unknown };
  quarter?: Quarter;
  buildings?: Building[];
};

function refusedBy(status: number, body: Refusal | null): WorldError {
  const e = body?.error;
  const code = (typeof e?.code === 'string' ? e.code : status === 409 ? 'VERSION_CONFLICT' : 'UNAVAILABLE') as WorldErrorCode;
  const need = e?.need && typeof e.need === 'object' ? (e.need as { quarterLevel?: number }) : null;
  const current = body?.quarter && Array.isArray(body.buildings) ? { quarter: body.quarter, buildings: body.buildings } : null;
  return new WorldError(status, code, { reason: typeof e?.reason === 'string' ? (e.reason as WorldError['reason']) : null, need, current });
}

const isQuarter = (q: unknown): q is Quarter => !!q && typeof (q as Quarter).id === 'string' && typeof (q as Quarter).version === 'number' && typeof (q as Quarter).cell === 'object';

const isConsent = (b: Partial<ConsentResponse>): boolean =>
  typeof b.canConsent === 'boolean' && typeof b.consent?.telegram === 'boolean' && typeof b.consent?.push === 'boolean';

/** The answers the screens stand on are checked, so a server that says something else fails loudly, not oddly. */
function sure<T>(ok: boolean, body: unknown): T {
  if (!ok) throw new WorldError(502, 'BAD_ANSWER');
  return body as T;
}

export function createHttpWorld(options: HttpOptions = {}): WorldClient {
  const base = options.base ?? '/api/world';
  const newKey = options.newKey ?? randomId;
  const send = (url: string, init: RequestInit) => (options.fetch ?? fetch)(url, init);

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, key?: string): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = key ?? newKey();
    }
    let res: Response;
    try {
      res = await send(`${base}${path}`, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new WorldError(0, 'OFFLINE');
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw refusedBy(res.status, data as Refusal | null);
    return data;
  }

  const id = (value: string) => encodeURIComponent(value);

  return {
    async claim(key) {
      const b = (await call('POST', '/claim', {}, key)) as Partial<ClaimResponse> | null;
      return sure<ClaimResponse>(!!b && isQuarter(b.quarter) && typeof b.resident?.id === 'string', b);
    },
    async me() {
      try {
        const b = (await call('GET', '/me')) as Partial<MeResponse> | null;
        return sure<MeResponse>(!!b && isQuarter(b.quarter) && typeof b.resident?.id === 'string' && Array.isArray(b.buildings) && Array.isArray(b.tasks) && typeof b.points?.total === 'number', b);
      } catch (e) {
        // No guest key yet, or one the world no longer knows: a newcomer.
        if (isWorldError(e) && (e.code === 'NO_RESIDENT' || e.status === 404)) return null;
        throw e;
      }
    },
    async quarter(quarterId: Id) {
      const b = (await call('GET', `/quarter/${id(quarterId)}`)) as Partial<QuarterResponse> | null;
      return sure<QuarterResponse>(!!b && isQuarter(b.quarter) && Array.isArray(b.buildings), b);
    },
    async district(district: District, cursor?: string | null) {
      const b = (await call('GET', `/district/${id(district)}${cursor ? `?cursor=${id(cursor)}` : ''}`)) as Partial<DistrictResponse> | null;
      return sure<DistrictResponse>(!!b && Array.isArray(b.quarters), b);
    },
    async build(input: BuildRequest, key) {
      const b = (await call('POST', '/build', input, key)) as Partial<BuildResponse> | null;
      return sure<BuildResponse>(!!b && isQuarter(b.quarter) && typeof b.building?.slot === 'number', b);
    },
    async link(input: LinkRequest, key) {
      const b = (await call('POST', '/link', input, key)) as Partial<LinkResponse> | null;
      return sure<LinkResponse>(!!b && isQuarter(b.quarter) && typeof b.building?.slot === 'number', b);
    },
    async away(since: string) {
      const b = (await call('GET', `/away?since=${id(since)}`)) as Partial<AwayResponse> | null;
      return sure<AwayResponse>(!!b && Array.isArray(b.events) && Array.isArray(b.report?.beats), b);
    },
    async consent() {
      const b = (await call('GET', '/consent')) as Partial<ConsentResponse> | null;
      return sure<ConsentResponse>(!!b && isConsent(b), b);
    },
    async setConsent(input: ConsentRequest, key) {
      const b = (await call('POST', '/consent', input, key)) as Partial<ConsentResponse> | null;
      return sure<ConsentResponse>(!!b && isConsent(b), b);
    },
    async visit(quarterId: Id, key) {
      const b = (await call('POST', '/visit', { quarterId }, key)) as Partial<VisitResponse> | null;
      return sure<VisitResponse>(!!b && typeof b.counted === 'boolean', b);
    },
    async version(versionId: Id) {
      const b = (await call('GET', `/version/${id(versionId)}`)) as Partial<WorldVersion> | null;
      return sure<WorldVersion>(!!b && typeof b.id === 'string', b);
    },
  };
}
