import { hashString, layoutCity, type CityLayout } from '../city/layout.ts';
import type { CitySnapshot, District, Tower } from '../market/types.ts';
import { ByteReader, ByteWriter } from './bytes.ts';

/**
 * The frozen city of the day, small enough for a link, so a friend runs the very same skyline.
 *
 * The plan of the city depends only on each tower's district, market cap and liquidity (its height and width) and
 * on their order, so that is what travels, with the crown's light (the day's move) and the traders behind the
 * window lights. A verified coin carries the first six letters of its mint; the friend's device finds the coin in
 * its own reads and names it only if it can verify it itself — a link can never make the city name a coin.
 * Everything else (names, logos, prices) comes from the friend's own data or stays blank: the run shows no card.
 *
 * Before a link is made the city is laid out again from what the link carries; if one tower or one low building
 * would stand anywhere else (two towers a hair apart in height can swap places), the amounts travel as float64.
 * The link also carries a fingerprint of the plan, so a device whose city code has changed since knows the worlds
 * differ.
 */

const DISTRICTS: readonly District[] = ['core', 'heights', 'strip', 'avenue', 'docks'];
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PREFIX = 6;
const MAX_TOWERS = 400;
const F_VERIFIED = 8;
const F_SOL = 16;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** 0: market cap and liquidity as float32, 1: as float64 — for the rare city where float32 moves a tower. */
type Precision = 0 | 1;

function writeAmount(w: ByteWriter, v: number, precision: Precision) {
  const n = Number.isFinite(v) && v > 0 ? v : 0;
  if (precision === 0) w.f32(n);
  else w.f64(n);
}

function readAmount(r: ByteReader, precision: Precision): number {
  const v = precision === 0 ? r.f32() : r.f64();
  if (!Number.isFinite(v) || v < 0 || v > 1e15) throw new RangeError('not a city');
  return v;
}

/** The crown's light needs only which side of ±5 % the day is on; tenths, cut toward zero, keep that side exactly. */
const toTenths = (change: number) => Math.max(-32767, Math.min(32767, Math.trunc((Number.isFinite(change) ? change : 0) * 10)));
/** Window lights saturate near four thousand traders an hour; a logarithm in one byte is far finer than the eye. */
const toTraders = (n: number) => Math.min(255, Math.max(0, Math.round(Math.log10(Math.max(0, n) + 1) * 40)));
const fromTraders = (q: number) => Math.round(10 ** (q / 40) - 1);

function writeTowers(w: ByteWriter, snapshot: CitySnapshot, precision: Precision) {
  const towers = snapshot.towers;
  if (towers.length > MAX_TOWERS) throw new RangeError('too many towers');
  w.u8(precision).varint(towers.length).u32(Math.max(0, Math.floor(new Date(snapshot.fetchedAt).getTime() / 1000) || 0)).u8(snapshot.source === 'live' ? 1 : 0);
  for (const t of towers) {
    const district = DISTRICTS.indexOf(t.district);
    if (district < 0) throw new RangeError('unknown district');
    const sol = t.id === SOL_MINT;
    const named = t.verified && !sol && t.id.length >= 32 && BASE58.test(t.id.slice(0, PREFIX));
    w.u8(district | (named ? F_VERIFIED : 0) | (sol ? F_SOL : 0));
    if (named) w.bytes(new TextEncoder().encode(t.id.slice(0, PREFIX)));
    writeAmount(w, t.mcap, precision);
    writeAmount(w, t.liquidity, precision);
    w.i16(toTenths(t.change24h));
    w.u8(toTraders(t.traders1h));
  }
}

const blank = (id: string, district: District): Tower => ({
  id,
  symbol: '',
  name: '',
  icon: null,
  district,
  price: 0,
  mcap: 0,
  liquidity: 0,
  holders: 0,
  change5m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 0,
  organic: 0,
  verified: false,
  launchedAt: null,
});

function readTowers(r: ByteReader): CitySnapshot {
  const precision = r.u8();
  if (precision > 1) throw new RangeError('not a city');
  const count = r.varint();
  if (count < 1 || count > MAX_TOWERS) throw new RangeError('not a city');
  const fetchedAt = new Date(r.u32() * 1000).toISOString();
  const source = r.u8() === 1 ? 'live' : 'snapshot';
  const towers: Tower[] = [];
  let anonymous = 0;
  let sol = false;
  for (let i = 0; i < count; i += 1) {
    const flags = r.u8();
    const district = DISTRICTS[flags & 7];
    if (!district || flags > 31) throw new RangeError('not a city');
    const isSol = (flags & F_SOL) !== 0;
    if (isSol && sol) throw new RangeError('not a city');
    sol ||= isSol;
    let id: string;
    if (isSol) id = SOL_MINT;
    else if (flags & F_VERIFIED) {
      const prefix = new TextDecoder().decode(r.take(PREFIX));
      if (!BASE58.test(prefix)) throw new RangeError('not a city');
      id = `~${prefix}`;
    } else id = `~#${anonymous++}`;
    const tower = blank(id, district);
    tower.mcap = readAmount(r, precision as Precision);
    tower.liquidity = readAmount(r, precision as Precision);
    tower.change24h = r.i16() / 10;
    tower.traders1h = fromTraders(r.u8());
    if (isSol) {
      tower.verified = true;
      tower.symbol = 'SOL';
      tower.name = 'Wrapped SOL';
    }
    towers.push(tower);
  }
  return { towers, fetchedAt, source };
}

/**
 * Gives each coin of a decoded city its identity from the device's own reads: a verified coin there whose mint starts
 * with the link's six letters. A coin the device cannot find stays an anonymous tower — same place, same height.
 */
export function resolveWorld(world: CitySnapshot, known: readonly Tower[]): CitySnapshot {
  const byPrefix = new Map<string, Tower>();
  for (const k of known) if (k.verified && k.id !== SOL_MINT && !k.id.startsWith('~')) byPrefix.set(k.id.slice(0, PREFIX), k);
  const sol = known.find((k) => k.id === SOL_MINT);
  const used = new Set<string>();
  const towers = world.towers.map((t) => {
    if (t.id === SOL_MINT) return sol ? { ...t, symbol: sol.symbol, name: sol.name, icon: sol.icon } : t;
    const prefix = t.id.startsWith('~') && !t.id.startsWith('~#') ? t.id.slice(1) : t.verified ? t.id.slice(0, PREFIX) : null;
    const k = prefix ? byPrefix.get(prefix) : undefined;
    if (!k || used.has(k.id)) return t.id.startsWith('~') ? { ...t, verified: false } : t;
    used.add(k.id);
    return { ...t, id: k.id, symbol: k.symbol, name: k.name, icon: k.icon, verified: true };
  });
  return { ...world, towers };
}

/** A fingerprint of the plan: where every tower stands and how tall, and how many low buildings and rails. */
export function layoutPrint(layout: CityLayout): number {
  let text = `${layout.fillers.length}|${layout.rails.length}|`;
  for (const t of layout.towers) text += `${Math.round(t.x * 1000)},${Math.round(t.z * 1000)},${Math.round(t.height * 100)},${Math.round(t.width * 1000)}|`;
  return hashString(text);
}

/** The same plan: every tower of the list in the same spot and size, the low buildings and the rails the same. */
function samePlan(a: CityLayout, aTowers: readonly Tower[], b: CityLayout, bTowers: readonly Tower[]): boolean {
  if (a.towers.length !== b.towers.length || a.fillers.length !== b.fillers.length || a.rails.length !== b.rails.length) return false;
  // The codec keeps the order of the towers, so the same tower has the same place in both lists.
  const aIndex = new Map(aTowers.map((t, i) => [t, i]));
  const bIndex = new Map(bTowers.map((t, i) => [t, i]));
  for (let i = 0; i < a.towers.length; i += 1) {
    const p = a.towers[i]!;
    const q = b.towers[i]!;
    if (aIndex.get(p.tower) !== bIndex.get(q.tower) || p.x !== q.x || p.z !== q.z || p.kind !== q.kind) return false;
    if (Math.abs(p.height - q.height) > 0.01 || Math.abs(p.width - q.width) > 0.005) return false;
  }
  for (let i = 0; i < a.fillers.length; i += 1) {
    const f = a.fillers[i]!;
    const g = b.fillers[i]!;
    if (f.x !== g.x || f.z !== g.z || f.height !== g.height) return false;
  }
  return a.rails.every((rail, i) => rail.seed === b.rails[i]!.seed);
}

/** Writes the city as exactly as its plan needs: the smallest precision that lays out to the same city. */
export function writeWorld(w: ByteWriter, snapshot: CitySnapshot) {
  const original = layoutCity(snapshot.towers);
  for (const precision of [0, 1] as const) {
    const part = new ByteWriter();
    writeTowers(part, snapshot, precision);
    const bytes = part.done();
    const decoded = resolveWorld(readTowers(new ByteReader(bytes)), snapshot.towers);
    const plan = layoutCity(decoded.towers);
    if (precision === 0 && !samePlan(original, snapshot.towers, plan, decoded.towers)) continue;
    w.bytes(bytes).u32(layoutPrint(plan));
    return;
  }
}

/** Reads a city from a link; `exact` is false when this device lays it out differently from the challenger's. */
export function readWorld(r: ByteReader, known: readonly Tower[]): { world: CitySnapshot; exact: boolean } {
  const world = resolveWorld(readTowers(r), known);
  const print = r.u32();
  return { world, exact: layoutPrint(layoutCity(world.towers)) === print };
}
