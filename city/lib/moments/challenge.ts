import type { CitySnapshot, District, Tower } from '../market/types.ts';
import type { RunForm } from '../run/course.ts';
import { GHOST_STRIDE, TICK } from '../run/sim.ts';
import { ByteReader, ByteWriter, deflate, fromBase64Url, inflate, toBase64Url } from './bytes.ts';
import { readGhost, writeGhost } from './ghost-code.ts';
import { readWorld, writeWorld } from './world-code.ts';

/**
 * A challenge to a friend in one link: the time to beat, the form, the course's day, the world it was run in and the
 * run itself as a ghost. It all rides after `#c=`, which browsers never send to a server: the page stays the same
 * cached page for everyone and the run stays on the two devices.
 *
 * The first six bytes are plain (version, form, what follows, day, time), so the challenge card can say
 * "Beat 31.4 s" on the first paint; the world and the ghost follow deflated and are read a moment later.
 *
 * Today the world rides inside the link: the challenger's frozen city of the day (`city/lib/run/world.ts`). The server
 * already answers `GET /api/world/version/:id`; once it also hands the run a version of the day, the link carries that
 * version's id instead (a third of the length) and opening it reads that version; nothing else changes.
 */

export const CHALLENGE_PARAM = 'c';
const VERSION = 1;
const EPOCH = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;
/** The first day a Skyline Run course existed; an older day in a link is not ours. */
const FIRST_DAY = '2026-10-01';
const HEAD_BYTES = 6;
const HEAD_CHARS = 8;
const W_NONE = 0;
const W_EMBEDDED = 1;
const W_VERSION = 2;

export type WorldRef = { kind: 'embedded'; world: CitySnapshot } | { kind: 'version'; id: string };

export type ChallengeHead = { beat: number; form: RunForm; day: string };

export type ChallengeLink = ChallengeHead & { world: WorldRef | null; ghost: Float32Array | null };

export type OpenedChallenge = ChallengeHead & {
  /** The challenger's city, or null when the link has none (an old link) or its version cannot be fetched. */
  world: CitySnapshot | null;
  /** False when this device lays the challenger's city out differently (its city code changed since). */
  exact: boolean;
  ghost: Float32Array | null;
  /** The server's world version the link points to, if it points to one. */
  version: string | null;
};

const dayNumber = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - EPOCH) / DAY_MS);
const dayOf = (n: number) => new Date(EPOCH + n * DAY_MS).toISOString().slice(0, 10);

function head(c: ChallengeHead, world: number, ghost: boolean): Uint8Array {
  const centis = Math.round(c.beat * 100);
  if (!(centis > 0 && centis < 60_000)) throw new RangeError('no time to beat');
  const day = dayNumber(c.day);
  if (!(day >= 0 && day < 0x10000)) throw new RangeError('no day');
  return new ByteWriter()
    .u8(VERSION)
    .u8((c.form === 'roofs' ? 1 : 0) | (world << 1) | (ghost ? 8 : 0))
    .u16(day)
    .u16(centis)
    .done();
}

/** The link's payload: the plain head, then the deflated world and ghost. */
export async function encodeChallenge(c: ChallengeLink): Promise<string> {
  const kind = c.world ? (c.world.kind === 'embedded' ? W_EMBEDDED : W_VERSION) : W_NONE;
  const top = head(c, kind, !!c.ghost);
  if (kind === W_NONE && !c.ghost) return toBase64Url(top);
  const body = new ByteWriter();
  if (c.world?.kind === 'embedded') writeWorld(body, c.world.world);
  else if (c.world?.kind === 'version') body.text(c.world.id);
  if (c.ghost) writeGhost(body, c.ghost);
  const packed = await deflate(body.done());
  const all = new Uint8Array(top.length + packed.length);
  all.set(top);
  all.set(packed, top.length);
  return toBase64Url(all);
}

export async function challengeUrl(origin: string, c: ChallengeLink): Promise<string> {
  return `${origin.replace(/\/+$/, '')}/#${CHALLENGE_PARAM}=${await encodeChallenge(c)}`;
}

/** The payload from an address's hash (`#c=…`), or null. */
export function challengePayload(hash: string): string | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const value = new URLSearchParams(text).get(CHALLENGE_PARAM);
  return value && /^[A-Za-z0-9_-]{8,24000}$/.test(value) ? value : null;
}

type Head = ChallengeHead & { world: number; ghost: boolean };

function readHead(payload: string, today = new Date()): Head | null {
  const bytes = fromBase64Url(payload.slice(0, HEAD_CHARS));
  if (!bytes || bytes.length < HEAD_BYTES) return null;
  const r = new ByteReader(bytes);
  if (r.u8() !== VERSION) return null;
  const flags = r.u8();
  const world = (flags >> 1) & 3;
  const day = dayOf(r.u16());
  const beat = r.u16() / 100;
  const latest = new Date(today.getTime() + DAY_MS).toISOString().slice(0, 10);
  if (flags > 15 || world > W_VERSION || day < FIRST_DAY || day > latest || !(beat > 0 && beat < 600)) return null;
  return { beat, form: flags & 1 ? 'roofs' : 'flight', day, world, ghost: (flags & 8) !== 0 };
}

/** What the challenge card needs at once: the time, the form and the day. Synchronous, from the plain head. */
export function readChallengeHead(payload: string, today = new Date()): ChallengeHead | null {
  const h = readHead(payload, today);
  return h ? { beat: h.beat, form: h.form, day: h.day } : null;
}

export type OpenOptions = {
  /** Towers this device already knows (its live read and its bundled city), to name the challenger's coins. */
  known: readonly Tower[];
  /** The world client's read of a server world version; absent until the server keeps worlds. */
  fetchVersion?: (id: string) => Promise<CitySnapshot | null>;
  today?: Date;
};

/** The whole challenge. A part that does not read cleanly is left out, never guessed: the time to beat stays. */
export async function openChallenge(payload: string, options: OpenOptions): Promise<OpenedChallenge | null> {
  const h = readHead(payload, options.today);
  if (!h) return null;
  const opened: OpenedChallenge = { beat: h.beat, form: h.form, day: h.day, world: null, exact: false, ghost: null, version: null };
  if (h.world === W_NONE && !h.ghost) return opened;
  const all = fromBase64Url(payload);
  if (!all || all.length <= HEAD_BYTES) return opened;
  let r: ByteReader;
  try {
    r = new ByteReader(await inflate(all.subarray(HEAD_BYTES)));
  } catch {
    return opened;
  }
  try {
    if (h.world === W_EMBEDDED) {
      const read = readWorld(r, options.known);
      opened.world = read.world;
      opened.exact = read.exact;
    } else if (h.world === W_VERSION) {
      const id = r.text(64);
      if (/^[A-Za-z0-9-]{1,64}$/.test(id)) opened.version = id;
    }
  } catch {
    // A city that does not read leaves the ghost unread too: it belongs to that city.
    return opened;
  }
  if (h.ghost) {
    try {
      const ghost = readGhost(r);
      // The ghost must be the run whose time the link names, to a tenth of a second.
      if (Math.abs((ghost.length / GHOST_STRIDE) * TICK - h.beat) <= 0.1) opened.ghost = ghost;
    } catch {
      // no ghost
    }
  }
  if (opened.version && options.fetchVersion) {
    try {
      const world = await options.fetchVersion(opened.version);
      if (world?.towers?.length) {
        opened.world = world;
        opened.exact = true;
      }
    } catch {
      // The run then uses this device's frozen city, and the ghost still flies its line.
    }
  }
  return opened;
}

const DISTRICTS = new Set<District>(['core', 'heights', 'strip', 'avenue', 'docks']);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function asTower(t: unknown): Tower | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.symbol !== 'string' || !DISTRICTS.has(o.district as District)) return null;
  const nums = ['price', 'mcap', 'liquidity', 'holders', 'change5m', 'change1h', 'change24h', 'volume24h', 'traders1h', 'organic'] as const;
  if (!nums.every((k) => isNum(o[k])) || typeof o.verified !== 'boolean') return null;
  return {
    id: o.id,
    symbol: o.symbol.slice(0, 12),
    name: typeof o.name === 'string' ? o.name.slice(0, 40) : o.symbol,
    icon: typeof o.icon === 'string' ? o.icon : null,
    district: o.district as District,
    price: o.price as number,
    mcap: o.mcap as number,
    liquidity: o.liquidity as number,
    holders: o.holders as number,
    change5m: o.change5m as number,
    change1h: o.change1h as number,
    change24h: o.change24h as number,
    volume24h: o.volume24h as number,
    traders1h: o.traders1h as number,
    organic: o.organic as number,
    verified: o.verified,
    launchedAt: typeof o.launchedAt === 'string' ? o.launchedAt : null,
  };
}

/**
 * The server's frozen city of a day (`WorldVersion` of the world contract, whose towers the contract leaves untyped)
 * as the city the run is played in — or null if any tower is not a tower, so a half-read world never runs.
 */
export function worldFromVersion(v: unknown): CitySnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.towers) || !o.towers.length || o.towers.length > 400 || typeof o.createdAt !== 'string' || Number.isNaN(Date.parse(o.createdAt))) return null;
  const towers = o.towers.map(asTower);
  if (towers.some((t) => !t)) return null;
  return { towers: towers as Tower[], fetchedAt: new Date(o.createdAt).toISOString(), source: 'live' };
}
