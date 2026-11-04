import { awayReport, mineOf, NO_CONSENT } from '../../../lib/world/away.ts';
import { POINTS, quarterLevelFor } from '../../../lib/world/catalog.ts';
import { dayOf, goalOf, planBuild, tasksOfDay } from '../../../lib/world/rules.ts';
import type { WorldClient } from './client.ts';
import { randomId } from './ids.ts';
import { pickCell, streetOf } from './plot.ts';
import type {
  AwayResponse,
  Building,
  BuildRequest,
  BuildResponse,
  ClaimResponse,
  ConsentResponse,
  DailyTask,
  District,
  DistrictResponse,
  Id,
  MeResponse,
  PointsEntry,
  Quarter,
  QuarterResponse,
  Resident,
  VisitResponse,
  WorldEvent,
  WorldVersion,
} from './types.ts';
import { WorldError } from './types.ts';

/**
 * The world on this device: the answers and refusals of /api/world, with the world's own rules (planBuild, the
 * day's tasks, the points they pay and the levels points reach), kept in localStorage, so the quarter can be built
 * while the city still runs without the server's world. Nothing here touches money; a link to the engine is refused,
 * as it needs a wallet signature.
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type MockOptions = {
  /** Where the world is kept; null keeps it in memory only. */
  storage?: StorageLike | null;
  now?: () => Date;
  newId?: () => string;
  /** A small wait before every answer, so the screens meet the same pauses they will meet on the network. */
  latencyMs?: number;
};

export const MOCK_KEY = 'ryntra.city.world.v2';
/** How many idempotency keys are remembered: enough for every retry a person can make. */
const KEYS_KEPT = 64;
/** How many of this device's own world events are kept. */
const EVENTS_KEPT = 50;
/** How far back «while you were away» reaches, as on the server. */
const AWAY_MS = 7 * 86_400_000;

type Saved = {
  v: 2;
  resident: Resident;
  quarter: Quarter;
  buildings: Building[];
  points: PointsEntry[];
  tasks: DailyTask[];
  events: WorldEvent[];
  done: { key: string; route: string; body: string; answer: unknown }[];
};

/** localStorage when the browser allows it; every read and write is guarded, private windows refuse it. */
export function browserStorage(): StorageLike {
  const store = (): Storage | null => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem: (key) => {
      try {
        return store()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      const s = store();
      if (!s) throw new Error('no storage');
      s.setItem(key, value);
    },
    removeItem: (key) => {
      try {
        store()?.removeItem(key);
      } catch {
        // nothing to remove
      }
    },
  };
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Object keys in one order, so the same request always compares the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parse(raw: string | null): Saved | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<Saved>;
    if (s?.v !== 2 || !s.resident?.id || !s.quarter?.id || !Array.isArray(s.buildings)) return null;
    return { v: 2, resident: s.resident, quarter: s.quarter, buildings: s.buildings, points: s.points ?? [], tasks: s.tasks ?? [], events: s.events ?? [], done: s.done ?? [] };
  } catch {
    return null;
  }
}

export function createMockWorld(options: MockOptions = {}): WorldClient {
  const storage = options.storage ?? null;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomId;
  const latency = options.latencyMs ?? 0;
  // The copy in memory answers when the browser refuses storage, so a private window still builds for the visit.
  let memory: Saved | null = null;

  const read = (): Saved | null => {
    if (storage) {
      const stored = parse(storage.getItem(MOCK_KEY));
      if (stored) memory = stored;
    }
    return memory ? copy(memory) : null;
  };
  const write = (state: Saved) => {
    memory = copy(state);
    try {
      storage?.setItem(MOCK_KEY, JSON.stringify(state));
    } catch {
      // Full or refused: the quarter lives in memory until the page closes.
    }
  };
  const wait = () => (latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve());
  const total = (s: Saved) => s.points.reduce((sum, p) => sum + p.delta, 0);
  const today = (s: Saved, day: string) => tasksOfDay(s.tasks.filter((t) => t.day === day), s.resident.id, day);

  /** A write with an Idempotency-Key: the same key and request give back the same answer; another request is refused. */
  const once = <T>(s: Saved | null, route: string, key: string | undefined, body: unknown): { replay: T } | null => {
    if (!s || !key) return null;
    const seen = s.done.find((d) => d.key === key && d.route === route);
    if (!seen) return null;
    if (seen.body !== canonical(body)) throw new WorldError(422, 'IDEMPOTENCY_KEY_REUSED');
    return { replay: copy(seen.answer as T) };
  };
  const remember = (s: Saved, route: string, key: string | undefined, body: unknown, answer: unknown) => {
    if (!key) return;
    s.done = [...s.done.filter((d) => !(d.key === key && d.route === route)), { key, route, body: canonical(body), answer: copy(answer) }].slice(-KEYS_KEPT);
  };
  const event = (s: Saved, kind: WorldEvent['kind'], payload: Record<string, unknown>) => {
    const at = now().toISOString();
    s.events = [...s.events, { id: newId(), at, source: 'world' as const, kind, subject: s.quarter.id, sourceAt: at, payload }].slice(-EVENTS_KEPT);
  };
  const mine = (s: Saved | null, quarterId: Id): Saved => {
    if (!s) throw new WorldError(401, 'NO_RESIDENT');
    if (s.quarter.id !== quarterId) throw new WorldError(404, 'NOT_FOUND');
    return s;
  };
  /** A day's task moves on; when it reaches its goal it pays its points once, and points can lift the quarter's level. */
  const progress = (s: Saved, day: string, kind: DailyTask['kind'], delta: number) => {
    const goal = goalOf(kind);
    if (goal === null || delta <= 0) return;
    let t = s.tasks.find((x) => x.day === day && x.kind === kind);
    if (!t) {
      t = { residentId: s.resident.id, day, kind, progress: 0, goal, doneAt: null };
      s.tasks.push(t);
    }
    t.progress = Math.min(t.goal, t.progress + delta);
    const key = `task_done:${day}:${kind}`;
    if (t.progress >= t.goal && t.doneAt === null) {
      t.doneAt = now().toISOString();
      if (!s.points.some((p) => p.idempotencyKey === key)) {
        s.points.push({ residentId: s.resident.id, delta: POINTS.task_done, reason: 'task_done', sourceRef: kind, idempotencyKey: key, at: t.doneAt });
        const level = quarterLevelFor(total(s));
        if (level > s.quarter.level) s.quarter = { ...s.quarter, level };
      }
    }
  };

  return {
    async claim(key) {
      await wait();
      const existing = read();
      const again = once<ClaimResponse>(existing, 'claim', key, {});
      if (again) return again.replay;
      if (existing) return { resident: existing.resident, quarter: existing.quarter, created: false };
      const at = now().toISOString();
      const residentId = newId();
      const quarterId = newId();
      const resident: Resident = { id: residentId, accountId: null, displayName: null, homeQuarterId: quarterId, createdAt: at };
      const cell = pickCell(seedOf(residentId));
      const quarter: Quarter = { id: quarterId, ownerId: residentId, district: 'arrivals', street: streetOf(cell.z), cell, level: 1, version: 1, updatedAt: at };
      const state: Saved = { v: 2, resident, quarter, buildings: [], points: [], tasks: [], events: [], done: [] };
      event(state, 'claim', { street: quarter.street });
      const answer: ClaimResponse = { resident, quarter, created: true };
      remember(state, 'claim', key, {}, answer);
      write(state);
      return copy(answer);
    },

    async me() {
      await wait();
      const s = read();
      if (!s) return null;
      const day = dayOf(now());
      const me: MeResponse = { resident: s.resident, quarter: s.quarter, buildings: s.buildings, quarters: [s.quarter], points: { total: total(s), recent: s.points.slice(-10).reverse() }, tasks: today(s, day) };
      return me;
    },

    async quarter(id) {
      await wait();
      const s = read();
      if (!s || s.quarter.id !== id) throw new WorldError(404, 'NOT_FOUND');
      const answer: QuarterResponse = { quarter: s.quarter, buildings: s.buildings };
      return answer;
    },

    async district(id: District, cursor?: string | null): Promise<DistrictResponse> {
      await wait();
      const s = read();
      // This device knows only its own quarter: the rest of the district is empty lots, never invented neighbours.
      const own = s && s.quarter.district === id && !cursor ? [{ id: s.quarter.id, ownerId: s.quarter.ownerId, street: s.quarter.street, cell: s.quarter.cell, level: s.quarter.level, buildings: s.buildings.map(({ slot, kind, level }) => ({ slot, kind, level })) }] : [];
      return { district: id, quarters: own, nextCursor: null };
    },

    async build(input: BuildRequest, key) {
      await wait();
      const current = read();
      const again = once<BuildResponse>(current, 'build', key, input);
      if (again) return again.replay;
      const s = mine(current, input.quarterId);
      if (input.version !== s.quarter.version) throw new WorldError(409, 'VERSION_CONFLICT', { current: { quarter: s.quarter, buildings: s.buildings } });
      const planned = planBuild({ quarter: s.quarter, buildings: s.buildings, slot: input.slot, kind: input.kind, modules: input.modules });
      if (!planned.ok) {
        const r = planned.refusal;
        throw new WorldError(r.status, r.code, r.code === 'LOCKED' ? { reason: r.reason, need: r.need ?? null } : {});
      }
      const plan = planned.plan;
      const at = now().toISOString();
      const day = dayOf(now());
      const here = s.buildings.find((b) => b.slot === plan.slot);
      const building: Building = { id: here?.id ?? newId(), quarterId: s.quarter.id, slot: plan.slot, kind: plan.kind, level: plan.level, modules: [...plan.modules], link: here && here.kind === plan.kind ? here.link : null, updatedAt: at };
      s.buildings = [...s.buildings.filter((b) => b.slot !== plan.slot), building].sort((a, b) => a.slot - b.slot);
      s.quarter = { ...s.quarter, version: s.quarter.version + 1, updatedAt: at };
      for (const p of plan.progress) progress(s, day, p.kind, p.delta);
      event(s, 'build', { street: s.quarter.street, slot: building.slot, kind: building.kind, level: building.level });
      const answer: BuildResponse = { quarter: s.quarter, building, tasks: today(s, day), points: { total: total(s) } };
      remember(s, 'build', key, input, answer);
      write(s);
      return copy(answer);
    },

    async link() {
      await wait();
      // Showing an engine object needs the owner's wallet signature; this device has none.
      throw new WorldError(401, 'WALLET_REQUIRED');
    },

    async away(since: string): Promise<AwayResponse> {
      await wait();
      const s = read();
      const until = now().toISOString();
      const floor = new Date(Math.max(Date.parse(since) || 0, now().getTime() - AWAY_MS)).toISOString();
      const events = s ? s.events.filter((e) => e.at > floor).reverse() : [];
      // This device's world holds only its own steps, and one's own steps are not news (the server leaves out the
      // events whose actor is the asker): the report has nothing of the world to tell, only the market's own lines.
      const report = awayReport([], mineOf(s ? [{ quarter: s.quarter, buildings: s.buildings }] : []));
      return { since: floor, until, events: copy(events), report: copy(report) };
    },

    async consent(): Promise<ConsentResponse> {
      await wait();
      // Consent is kept under a Ryntra account; this device's world has none.
      return { consent: { ...NO_CONSENT }, canConsent: false };
    },

    async setConsent(): Promise<ConsentResponse> {
      await wait();
      throw new WorldError(401, 'WALLET_REQUIRED');
    },

    async visit(quarterId: Id): Promise<VisitResponse> {
      await wait();
      const s = read();
      if (!s || s.quarter.id !== quarterId) throw new WorldError(404, 'NOT_FOUND');
      // The only quarter this device knows is its own, and a visit to one's own quarter never counts.
      return { visit: null, counted: false, reason: 'own_quarter' };
    },

    async version(): Promise<WorldVersion> {
      await wait();
      // Frozen cities live on the server only.
      throw new WorldError(404, 'NOT_FOUND');
    },
  };
}

/**
 * This device's resident, as the device's crews read it (`crew-mock.ts`): who, which quarter, how many points, and the
 * builds the device's world kept. Null before a claim.
 */
export function mockResident(storage: StorageLike | null): { residentId: Id; quarter: Quarter; points: number; builds: { day: string }[] } | null {
  const s = parse(storage?.getItem(MOCK_KEY) ?? null);
  if (!s) return null;
  return {
    residentId: s.resident.id,
    quarter: copy(s.quarter),
    points: s.points.reduce((sum, p) => sum + p.delta, 0),
    builds: s.events.filter((e) => e.kind === 'build').map((e) => ({ day: e.at.slice(0, 10) })),
  };
}

/** Moves this device's quarter to a lot of Arrivals, as a crew's street does on the server: its street, cell and version. */
export function moveMockQuarter(storage: StorageLike | null, cell: { x: number; z: number }, at: Date): Quarter | null {
  const s = parse(storage?.getItem(MOCK_KEY) ?? null);
  if (!s || !storage) return null;
  s.quarter = { ...s.quarter, street: streetOf(cell.z), cell: { ...cell }, version: s.quarter.version + 1, updatedAt: at.toISOString() };
  try {
    storage.setItem(MOCK_KEY, JSON.stringify(s));
  } catch {
    return null;
  }
  return copy(s.quarter);
}
