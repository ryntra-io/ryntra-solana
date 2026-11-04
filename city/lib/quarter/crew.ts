import { CREW_LIMIT, crewName, crewScore, crewsMode, hqOf, inviteCode, isCrewColour, normalInvite, planGift, weekOf } from '../../../lib/world/crew.ts';
import { dayOf } from '../../../lib/world/rules.ts';
import { mockWorld, world } from './client.ts';
import { randomId } from './ids.ts';
import { refusedBy } from './http.ts';
import { browserStorage, mockResident, moveMockQuarter, type StorageLike } from './mock.ts';
import { pickCell } from './plot.ts';
import type { CrewColour, CrewResponse, CrewsResponse, CrewStreet, CrewWriteResponse, GiftRequest, InviteResponse, LeaveCrewResponse, MyCrew } from './types.ts';
import { WorldError, isWorldError } from './types.ts';

/**
 * Crews, as the city talks to them (CITY-20): one method per route of /api/world/crew (docs/city/WORLD-CONTRACT.md),
 * every write with an idempotency key. Two answer the same way: the server's, and this device's for a look before the
 * migration is applied — the same rules (`lib/world/crew.ts`), only this device's own quarter on its street.
 */
export interface CrewClient {
  /** GET /crew — my crew, or null while I am in none. */
  mine(): Promise<MyCrew | null>;
  /** GET /crews — every crew street, for the terrace. */
  streets(): Promise<CrewStreet[]>;
  /** GET /crew/invite/:code — the street behind an invite, before joining. */
  invite(code: string): Promise<CrewStreet>;
  create(input: { name: string; colour: CrewColour }, key?: string): Promise<CrewWriteResponse>;
  join(code: string, key?: string): Promise<CrewWriteResponse>;
  leave(key?: string): Promise<LeaveCrewResponse>;
  gift(input: GiftRequest, key?: string): Promise<CrewWriteResponse>;
}

/* ------------------------------------------------------------------ server -- */

const isCrew = (c: unknown): c is MyCrew => !!c && typeof (c as MyCrew).id === 'string' && typeof (c as MyCrew).invite === 'string' && Array.isArray((c as MyCrew).people);
const isStreet = (c: unknown): c is CrewStreet => !!c && typeof (c as CrewStreet).id === 'string' && typeof (c as CrewStreet).row === 'number' && typeof (c as CrewStreet).hq?.level === 'number';

export function createHttpCrews(options: { base?: string; fetch?: typeof fetch; newKey?: () => string } = {}): CrewClient {
  const base = options.base ?? '/api/world';
  const newKey = options.newKey ?? randomId;
  async function call(method: 'GET' | 'POST', path: string, body?: unknown, key?: string): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = key ?? newKey();
    }
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(`${base}${path}`, { method, headers, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new WorldError(0, 'OFFLINE');
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw refusedBy(res.status, data as Parameters<typeof refusedBy>[1]);
    return data;
  }
  const sure = <T>(ok: boolean, body: unknown): T => {
    if (!ok) throw new WorldError(502, 'BAD_ANSWER');
    return body as T;
  };
  const written = (b: unknown) => sure<CrewWriteResponse>(!!b && isCrew((b as CrewWriteResponse).crew) && typeof (b as CrewWriteResponse).quarter?.id === 'string', b);
  return {
    async mine() {
      try {
        const b = (await call('GET', '/crew')) as Partial<CrewResponse> | null;
        return sure<CrewResponse>(!!b && (b.crew === null || isCrew(b.crew)), b).crew;
      } catch (e) {
        // No place yet: no crew either.
        if (isWorldError(e) && e.code === 'NO_RESIDENT') return null;
        throw e;
      }
    },
    async streets() {
      const b = (await call('GET', '/crews')) as Partial<CrewsResponse> | null;
      return sure<CrewsResponse>(!!b && Array.isArray(b.crews), b).crews.filter(isStreet);
    },
    async invite(code) {
      const b = (await call('GET', `/crew/invite/${encodeURIComponent(code)}`)) as Partial<InviteResponse> | null;
      return sure<InviteResponse>(!!b && isStreet(b.crew), b).crew;
    },
    create: async (input, key) => written(await call('POST', '/crew', input, key)),
    join: async (code, key) => written(await call('POST', '/crew/join', { code }, key)),
    async leave(key) {
      const b = (await call('POST', '/crew/leave', {}, key)) as Partial<LeaveCrewResponse> | null;
      return sure<LeaveCrewResponse>(!!b && typeof b.quarter?.id === 'string', b);
    },
    gift: async (input, key) => written(await call('POST', '/crew/gift', input, key)),
  };
}

/* ------------------------------------------------------------------ device -- */

export const CREW_MOCK_KEY = 'ryntra.city.crew.v1';

type SavedCrew = {
  v: 1;
  residentId: string;
  crew: { id: string; name: string; colour: CrewColour; row: number; invite: string };
  joinedAt: string;
  gifts: { kind: 'module' | 'points'; module: string | null; points: number; units: number; day: string; at: string }[];
  /** Points given in every crew this device was in: given once, never again. */
  given: number;
};

/**
 * This device's crews: one crew with this device's own quarter on its street — the rest of the street stays empty
 * lots, never invented people. Its invite opens only here. Points given are kept, so they are never given twice.
 */
export function createMockCrews(options: { storage?: StorageLike | null; now?: () => Date; newId?: () => string; latencyMs?: number } = {}): CrewClient {
  const storage = options.storage ?? null;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomId;
  const latency = options.latencyMs ?? 0;
  const random = (n: number) => {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  };
  const wait = () => (latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve());
  const GIVEN_KEY = `${CREW_MOCK_KEY}.given`;
  /** Points this device gave in crews it has left. */
  const givenBefore = (): number => {
    try {
      return Math.max(0, Number(storage?.getItem(GIVEN_KEY) ?? 0) || 0);
    } catch {
      return 0;
    }
  };
  const read = (): SavedCrew | null => {
    try {
      const s = JSON.parse(storage?.getItem(CREW_MOCK_KEY) ?? 'null') as SavedCrew | null;
      return s?.v === 1 && s.crew?.id ? s : null;
    } catch {
      return null;
    }
  };
  const write = (s: SavedCrew | null) => {
    try {
      if (s) storage?.setItem(CREW_MOCK_KEY, JSON.stringify(s));
      else storage?.removeItem(CREW_MOCK_KEY);
    } catch {
      // Refused: the crew lives until the page closes.
    }
  };
  const me = () => {
    const r = mockResident(storage);
    if (!r) throw new WorldError(401, 'NO_RESIDENT');
    return r;
  };
  const street = (s: SavedCrew): CrewStreet => ({
    id: s.crew.id,
    name: s.crew.name,
    colour: s.crew.colour,
    street: `arrivals-${s.crew.row + 1}`,
    row: s.crew.row,
    members: 1,
    limit: CREW_LIMIT,
    hq: hqOf(s.gifts.reduce((sum, g) => sum + g.units, 0), s.gifts.filter((g) => g.module).map((g) => g.module!).reverse()),
  });
  const view = (s: SavedCrew): MyCrew => {
    const r = me();
    const at = now();
    const day = dayOf(at);
    const week = weekOf(at);
    return {
      ...street(s),
      invite: s.crew.invite,
      people: [{ quarterId: r.quarter.id, name: null, lot: r.quarter.cell.x, level: r.quarter.level, verified: false, joinedAt: s.joinedAt }],
      score: crewScore({
        week,
        members: [{ residentId: r.residentId, verified: false }],
        actions: [...r.builds.map((b) => ({ residentId: r.residentId, day: b.day, kind: 'build' })), ...s.gifts.map((g) => ({ residentId: r.residentId, day: g.day, kind: 'gift' }))],
      }),
      me: {
        quarterId: r.quarter.id,
        gave: { module: s.gifts.some((g) => g.day === day && g.kind === 'module'), points: s.gifts.some((g) => g.day === day && g.kind === 'points') },
        points: Math.max(0, r.points - s.given),
      },
    };
  };
  const mineSaved = (): SavedCrew | null => {
    const s = read();
    const r = mockResident(storage);
    return s && r && s.residentId === r.residentId ? s : null;
  };

  return {
    async mine() {
      await wait();
      me();
      const s = mineSaved();
      return s ? view(s) : null;
    },
    async streets() {
      await wait();
      const s = mineSaved();
      return s ? [street(s)] : [];
    },
    async invite(code) {
      await wait();
      const s = mineSaved();
      if (!s || normalInvite(code) !== s.crew.invite) throw new WorldError(404, 'NOT_FOUND');
      return street(s);
    },
    async create(input) {
      await wait();
      const r = me();
      if (mineSaved()) throw new WorldError(422, 'CREW_REFUSED', { reason: 'in_crew' });
      if (!isCrewColour(input.colour)) throw new WorldError(400, 'BAD_REQUEST');
      const named = crewName(input.name);
      if (!named.ok) throw new WorldError(422, 'CREW_REFUSED', { reason: 'name' });
      // The street after this device's own: on this device the district is empty, so it is nobody else's.
      const row = r.quarter.cell.z + 1;
      const at = now();
      const s: SavedCrew = { v: 1, residentId: r.residentId, crew: { id: newId(), name: named.name, colour: input.colour, row, invite: inviteCode(random) }, joinedAt: at.toISOString(), gifts: [], given: givenBefore() };
      const quarter = moveMockQuarter(storage, { x: 0, z: row }, at);
      if (!quarter) throw new WorldError(503, 'UNAVAILABLE');
      write(s);
      return { crew: view(s), quarter };
    },
    async join(code) {
      await wait();
      me();
      const s = mineSaved();
      if (s && normalInvite(code) === s.crew.invite) throw new WorldError(422, 'CREW_REFUSED', { reason: 'in_crew' });
      // Another device's crew lives on the server only.
      throw new WorldError(404, 'NOT_FOUND');
    },
    async leave() {
      await wait();
      const r = me();
      const s = mineSaved();
      if (!s) throw new WorldError(422, 'CREW_REFUSED', { reason: 'not_in_crew' });
      const quarter = moveMockQuarter(storage, pickCell(r.quarter.cell.x + 1), now());
      if (!quarter) throw new WorldError(503, 'UNAVAILABLE');
      try {
        storage?.setItem(GIVEN_KEY, String(s.given));
      } catch {
        // Refused: nothing kept, as with the crew itself.
      }
      write(null);
      return { quarter };
    },
    async gift(input) {
      await wait();
      const r = me();
      const s = mineSaved();
      if (!s) throw new WorldError(422, 'CREW_REFUSED', { reason: 'not_in_crew' });
      const current = view(s);
      const planned = planGift({ body: input, quarterLevel: r.quarter.level, points: current.me.points, gave: current.me.gave });
      if (!planned.ok) throw planned.reason === 'shape' ? new WorldError(400, 'BAD_REQUEST') : new WorldError(422, 'CREW_REFUSED', { reason: planned.reason });
      const g = planned.gift;
      const at = now();
      s.gifts.push({ kind: g.kind, module: g.module, points: g.points, units: g.units, day: dayOf(at), at: at.toISOString() });
      s.given += g.points;
      write(s);
      return { crew: view(s), quarter: r.quarter };
    },
  };
}

/* ---------------------------------------------------------------- the one -- */

export const httpCrews: CrewClient = createHttpCrews();
export const mockCrews: CrewClient = createMockCrews({ storage: browserStorage(), latencyMs: 140 });

/**
 * The crews the city uses, or null where there are none. Open (`NEXT_PUBLIC_RYNTRA_CITY_CREWS=open`): the server's.
 * Otherwise only beside the device's world (`?world=device` in development, or the `device` flag), so a crew's street
 * and the quarter on it always come from the same world. A production build with the flag closed shows no crew.
 */
export function crews(): CrewClient | null {
  const mode = crewsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_CREWS);
  if (mode === 'open') return httpCrews;
  if (world() !== mockWorld) return null;
  return mode === 'device' || process.env.NODE_ENV !== 'production' ? mockCrews : null;
}

/** The link that brings a friend to the crew: the city with the code, nothing of a wallet in it. */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/?crew=${code}`;
}

/** The code a link carries, from the city's own address; null when it carries none. */
export function inviteFrom(search: string): string | null {
  return normalInvite(new URLSearchParams(search).get('crew'));
}
