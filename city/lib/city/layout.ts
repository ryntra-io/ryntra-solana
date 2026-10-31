import type { District, Tower } from '../market/types.ts';

/**
 * The island plan, computed the same way for every visitor: SOL is the spire at the centre, each district
 * is a sector around it. A tower's plot comes from its own mint (CITY-148), never from its place in the list or its
 * height, so a coin that arrives, leaves or grows moves no other tower; a plan grown from the one on screen keeps every
 * tower that stands in both on its plot.
 * Angles are measured from north (-Z, where the Eclipse hangs) clockwise; x = sin(a)·r, z = -cos(a)·r.
 */

export type TowerKind = 0 | 1 | 2 | 3; // 0 prism spire · 1 meme tower · 2 stepped stock tower · 3 launch scaffold

export type PlacedTower = {
  tower: Tower;
  x: number;
  z: number;
  height: number;
  width: number;
  kind: TowerKind;
  seed: number;
  /** The radius of the plot it holds: every tower its district draws fits it, so a wider tower keeps its plot. */
  room: number;
};

export type Filler = { x: number; z: number; width: number; depth: number; height: number; seed: number };
export type Rail = { a: [number, number, number]; b: [number, number, number]; arch: number; seed: number };

export type CityLayout = {
  towers: PlacedTower[];
  fillers: Filler[];
  rails: Rail[];
  islandRadius: number;
};

export const ISLAND_RADIUS = 74;
export const PLAZA_RADIUS = 11;
export const RING_ROADS = [30, 50] as const;
export const SPOKES = 8;
const ROAD_HALF = 1.7;
/** The clear ground between two plots. */
const GAP = 0.8;
/** A tower is drawn at most this much wider than its plot's radius: its corners (√2·FIT/2 < 1) stay inside the plot. */
const FIT = 1.3;

export type Sector = Readonly<{ from: number; to: number; rMin: number; rMax: number; kind: TowerKind }>;

/** A district's plot: room for the widest tower the district draws (`towerWidth` ≤ ROOM·FIT). */
const ROOM: Record<District, number> = { core: 3.4, heights: 3.0, strip: 2.8, avenue: 2.7, docks: 1.9 };

const SECTORS: Record<District, Sector> = {
  core: { from: -180, to: 180, rMin: 15, rMax: 23, kind: 0 },
  heights: { from: -118, to: -32, rMin: 22, rMax: 47, kind: 0 },
  strip: { from: 24, to: 132, rMin: 19, rMax: 64, kind: 1 },
  avenue: { from: -176, to: -120, rMin: 21, rMax: 60, kind: 2 },
  docks: { from: 138, to: 214, rMin: 46, rMax: 66, kind: 3 },
};

/** mulberry32: a small seeded generator, so the city is identical on every device. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The key a tower's plot comes from: 24 bits of the hash of its mint, or the key a world read from a link carries for it.
 * Two towers of a city share a key about once in four thousand cities; between those two the list's order decides.
 */
export const seatOf = (tower: Tower): number => tower.seat ?? hashString(tower.id) >>> 8;

/**
 * Height follows market cap on a log scale, but never more than liquidity can carry:
 * a coin with $700M "cap" and $300k of liquidity is drawn as the $36M coin it trades like.
 */
export function towerHeight(tower: Tower): number {
  if (tower.district === 'docks') {
    const cap = Math.max(tower.mcap, 1_000);
    return clamp(3 + (Math.log10(cap) - 3) * 2.8, 3, 14);
  }
  const carried = tower.id === SOL_MINT ? tower.mcap : Math.min(tower.mcap, Math.max(tower.liquidity, 1) * 120);
  const cap = Math.max(carried, 10_000);
  const base = 5 + (Math.log10(cap) - 4) * 8;
  return clamp(tower.id === SOL_MINT ? base + 6 : base, 5, 72);
}

export function towerWidth(tower: Tower): number {
  const liq = Math.log10(Math.max(tower.liquidity, 1_000));
  switch (tower.district) {
    case 'core':
      return tower.id === SOL_MINT ? 6.2 : clamp(2.6 + (liq - 5) * 0.45, 2.8, 4.4);
    case 'heights':
      return clamp(2.2 + (liq - 5) * 0.4, 2.4, 3.8);
    case 'strip':
      return clamp(1.9 + (liq - 5) * 0.42, 2.0, 3.6);
    case 'avenue':
      return clamp(2.1 + (liq - 5) * 0.35, 2.2, 3.4);
    case 'docks':
      return clamp(1.3 + (liq - 3) * 0.25, 1.3, 2.4);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function onRoad(x: number, z: number, pad = 0): boolean {
  const r = Math.hypot(x, z);
  for (const ring of RING_ROADS) if (Math.abs(r - ring) < ROAD_HALF + pad) return true;
  if (r < PLAZA_RADIUS + pad) return true;
  const angle = Math.atan2(x, -z);
  const step = (Math.PI * 2) / SPOKES;
  const nearest = Math.round(angle / step) * step;
  // distance from the point to the spoke line through the centre at angle `nearest`
  const dist = Math.abs(Math.sin(angle - nearest) * r);
  return dist < ROAD_HALF + pad && Math.cos(angle - nearest) > 0;
}

/**
 * Lays the island out. Every tower takes the first free plot of its own walk through its district's band, the walk
 * seeded by its mint; a full band sends it on to the district's second ring (CITY-86), then to the free plot of the
 * island nearest the district. With `keep` (the plan on screen), a tower that stood there in the same district keeps
 * its plot and the others walk around them: no tower moves for one that arrives, leaves or changes height.
 */
export function layoutCity(towers: readonly Tower[], keep: CityLayout | null = null): CityLayout {
  const placed: PlacedTower[] = [];
  const blocks = new Blocks();
  const free = (x: number, z: number, r: number) => {
    if (Math.hypot(x, z) + r > ISLAND_RADIUS - 2) return false;
    if (onRoad(x, z, r * 0.9)) return false;
    return blocks.clear(x, z, r, GAP);
  };
  const stand = (t: Tower, x: number, z: number, room: number) => {
    const kind = SECTORS[t.district].kind;
    placed.push({ tower: t, x, z, height: towerHeight(t), width: Math.min(towerWidth(t), room * FIT), kind, seed: hashString(t.id), room });
    blocks.push({ x, z, r: room });
  };

  const sol = towers.find((t) => t.id === SOL_MINT);
  if (sol) {
    const width = towerWidth(sol);
    placed.push({ tower: sol, x: 0, z: 0, height: towerHeight(sol), width, kind: 0, seed: hashString(sol.id), room: width });
    blocks.push({ x: 0, z: 0, r: width });
  }

  const members = towers.filter((t) => t.id !== SOL_MINT && t.district in SECTORS);
  const before = new Map(keep?.towers.map((p) => [p.tower.id, p]));
  const walking: Tower[] = [];
  for (const t of members) {
    const was = before.get(t.id);
    if (was && was.tower.district === t.district && free(was.x, was.z, was.room)) stand(t, was.x, was.z, was.room);
    else walking.push(t);
  }

  // The rest in the order of their keys, which no list order or height can change.
  walking.sort((a, b) => seatOf(a) - seatOf(b));
  for (const t of walking) {
    const sector = SECTORS[t.district];
    const room = ROOM[t.district];
    const seat = seatOf(t);
    const spot = tryBand(sector, room, 400, rng(seat), free, true) ?? tryBand(secondRing(sector), room, 240, rng(seat ^ 0x9e3779b9), free, false);
    if (spot) stand(t, spot.x, spot.z, room);
    else {
      const last = scanIsland(sector, room, free);
      stand(t, last.x, last.z, last.room);
    }
  }

  // The list reads as before: SOL first, then district by district, the tallest first.
  const rank = new Map<District, number>(DISTRICT_ORDER.map((d, i) => [d, i]));
  const ordered = placed.slice(sol ? 1 : 0).sort(
    (a, b) => rank.get(a.tower.district)! - rank.get(b.tower.district)! || b.height - a.height || seatOf(a.tower) - seatOf(b.tower),
  );
  const all = sol ? [placed[0]!, ...ordered] : ordered;
  return { towers: all, fillers: layoutFillers(blocks.all), rails: layoutRails(all), islandRadius: ISLAND_RADIUS };
}

type Block = { x: number; z: number; r: number };

/**
 * The plots taken so far, in a coarse grid so a free-plot test reads only the blocks near it: the same answer as testing
 * every block (one farther than the reach cannot touch), at a fraction of the work on a crowded island.
 */
class Blocks {
  static readonly CELL = 8;
  readonly all: Block[] = [];
  private readonly cells = new Map<number, Block[]>();
  private widest = 0;

  push(b: Block) {
    this.all.push(b);
    this.widest = Math.max(this.widest, b.r);
    const k = Blocks.key(Math.floor(b.x / Blocks.CELL), Math.floor(b.z / Blocks.CELL));
    const cell = this.cells.get(k);
    if (cell) cell.push(b);
    else this.cells.set(k, [b]);
  }

  /** No block within its own radius, r and the gap of the point. */
  clear(x: number, z: number, r: number, gap: number): boolean {
    const reach = r + this.widest + gap;
    const x0 = Math.floor((x - reach) / Blocks.CELL);
    const x1 = Math.floor((x + reach) / Blocks.CELL);
    const z0 = Math.floor((z - reach) / Blocks.CELL);
    const z1 = Math.floor((z + reach) / Blocks.CELL);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        const cell = this.cells.get(Blocks.key(cx, cz));
        if (!cell) continue;
        for (const b of cell) if (!(Math.hypot(b.x - x, b.z - z) > b.r + r + gap)) return false;
      }
    }
    return true;
  }

  private static key(cx: number, cz: number) {
    return (cx + 512) * 1024 + (cz + 512);
  }
}

/** The order the districts are laid in: the spire's ring first, the launch docks last. */
const DISTRICT_ORDER = ['core', 'heights', 'avenue', 'strip', 'docks'] as const satisfies readonly District[];

/** A district's own band (read-only), for the plan's tests. */
export function districtSector(district: District): Sector {
  return { ...SECTORS[district] };
}

/** The district's second ring: outside its band, or inside it where the band already meets the island's edge. */
export function secondRing(sector: Sector): Sector {
  const depth = sector.rMax - sector.rMin;
  const edge = ISLAND_RADIUS - 4;
  if (sector.rMax + 4 < edge) return { ...sector, rMin: sector.rMax + 1.5, rMax: Math.min(edge, sector.rMax + 1.5 + depth * 0.7) };
  return { ...sector, rMin: Math.max(PLAZA_RADIUS + 3, sector.rMin - 1.5 - depth * 0.7), rMax: sector.rMin - 1.5 };
}

type Spot = { x: number; z: number };
type Free = (x: number, z: number, r: number) => boolean;

function tryBand(sector: Sector, w: number, tries: number, random: () => number, free: Free, spreading: boolean): Spot | null {
  for (let i = 0; i < tries; i += 1) {
    const spread = spreading ? Math.min(1, i / 160) : 1;
    const r = sector.rMin + (sector.rMax - sector.rMin) * Math.min(1, spread * 0.85 + random() * 0.35);
    const a = toRad(sector.from + (sector.to - sector.from) * random());
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (free(x, z, w)) return { x, z };
  }
  return null;
}

/** Every plot of the island the last resort looks at, ring by ring from the plaza out: laid once. */
let plots: readonly Spot[] | null = null;
function islandPlots(): readonly Spot[] {
  if (plots) return plots;
  const out: Spot[] = [];
  for (let r = PLAZA_RADIUS + 3; r < ISLAND_RADIUS - 2; r += 1.2) {
    const step = Math.min(6, (180 / Math.PI) * (1.2 / r));
    for (let deg = 0; deg < 360; deg += step) out.push({ x: Math.sin(toRad(deg)) * r, z: -Math.cos(toRad(deg)) * r });
  }
  plots = out;
  return out;
}

/** The island's plots nearest a point first, ties in plot order. */
function nearest(home: Spot): readonly Spot[] {
  const all = islandPlots();
  return all
    .map((p, i) => ({ p, i, d: Math.hypot(p.x - home.x, p.z - home.z) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ p }) => p);
}
/** The plots by distance from each district's centre: the districts never change, so they are sorted once. */
const byDistance = new WeakMap<Sector, readonly Spot[]>();

/**
 * The last resort: the free plot of the island nearest the district's centre, then the same with a plot a size
 * smaller (the tower is drawn at the width it found room for). Deterministic, so the city stays the same on every device.
 */
function scanIsland(sector: Sector, room: number, free: Free): Spot & { room: number } {
  const mid = toRad((sector.from + sector.to) / 2);
  const home = { x: Math.sin(mid) * sector.rMin, z: -Math.cos(mid) * sector.rMin };
  const order = byDistance.get(sector) ?? byDistance.set(sector, nearest(home)).get(sector)!;
  for (let r = room; r >= 0.7; r *= 0.8) {
    for (const p of order) if (free(p.x, p.z, r)) return { ...p, room: r };
  }
  return { ...home, room };
}

function layoutFillers(blocks: { x: number; z: number; r: number }[]): Filler[] {
  const random = rng(7);
  const fillers: Filler[] = [];
  const cell = 3.3;
  for (let gx = -ISLAND_RADIUS; gx <= ISLAND_RADIUS; gx += cell) {
    for (let gz = -ISLAND_RADIUS; gz <= ISLAND_RADIUS; gz += cell) {
      // Every cell draws its numbers whether it builds or not, so a tower that arrives or leaves changes only the
      // low buildings on its own plot (CITY-148).
      const [jx, jz, park, w, d, h, tall, seed] = [random(), random(), random(), random(), random(), random(), random(), random()];
      const x = gx + (jx - 0.5) * 0.9;
      const z = gz + (jz - 0.5) * 0.9;
      const r = Math.hypot(x, z);
      if (r > ISLAND_RADIUS - 3 || r < PLAZA_RADIUS + 3) continue;
      if (onRoad(x, z, 1.1)) continue;
      if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 2.2)) continue;
      if (park < 0.12) continue; // small parks and courtyards
      const width = 1.5 + w * 1.1;
      const depth = 1.5 + d * 1.1;
      const falloff = 1 - r / (ISLAND_RADIUS + 10);
      let height = (2 + 9 * falloff) * (0.45 + h * 0.9);
      if (tall < 0.05) height *= 1.9;
      fillers.push({ x, z, width, depth, height: Math.max(1.2, height), seed: Math.floor(seed * 1e9) });
    }
  }
  return fillers;
}

function layoutRails(towers: PlacedTower[]): Rail[] {
  const rails: Rail[] = [];
  const sol = towers[0];
  const anchor = (t: PlacedTower, f: number): [number, number, number] => [t.x, t.height * f, t.z];
  // Each rail draws from the two towers it ties, so a rail stays as it was while its towers stand (CITY-148).
  const between = (a: PlacedTower, b: PlacedTower) => rng(Math.imul(seatOf(a.tower), 0x9e3779b1) ^ seatOf(b.tower));
  const byDistrict = new Map<District, PlacedTower[]>();
  for (const t of towers.slice(1)) {
    const list = byDistrict.get(t.tower.district) ?? [];
    list.push(t);
    byDistrict.set(t.tower.district, list);
  }
  if (sol) {
    for (const [district, list] of byDistrict) {
      const leaders = list.slice(0, district === 'core' ? list.length : 3);
      for (const t of leaders) {
        const random = between(sol, t);
        rails.push({ a: anchor(sol, 0.55 + random() * 0.2), b: anchor(t, 0.7 + random() * 0.15), arch: 3 + random() * 6, seed: Math.floor(random() * 1e9) });
      }
    }
  }
  // Neighbours inside each district are tied together by lower rails.
  for (const list of byDistrict.values()) {
    for (const t of list) {
      const nearest = list
        .filter((o) => o !== t)
        .map((o) => ({ o, d: Math.hypot(o.x - t.x, o.z - t.z) }))
        .sort((p, q) => p.d - q.d)[0];
      if (!nearest || nearest.d > 22) continue;
      const random = between(t, nearest.o);
      if (random() < 0.45) continue;
      const lo = Math.min(t.height, nearest.o.height);
      rails.push({ a: [t.x, lo * (0.35 + random() * 0.3), t.z], b: [nearest.o.x, lo * (0.35 + random() * 0.3), nearest.o.z], arch: 1 + random() * 3, seed: Math.floor(random() * 1e9) });
    }
  }
  return rails;
}
