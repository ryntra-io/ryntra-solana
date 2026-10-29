import type { District, Tower } from '../market/types.ts';

/**
 * The island plan, computed the same way for every visitor: SOL is the spire at the centre, each district
 * is a sector around it, bigger coins stand closer to the centre so the skyline peaks at the Sol Spire.
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

type Sector = { from: number; to: number; rMin: number; rMax: number; kind: TowerKind };

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

export function layoutCity(towers: readonly Tower[]): CityLayout {
  const placed: PlacedTower[] = [];
  const blocks: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => {
    if (Math.hypot(x, z) + r > ISLAND_RADIUS - 2) return false;
    if (onRoad(x, z, r * 0.9)) return false;
    return blocks.every((b) => Math.hypot(b.x - x, b.z - z) > b.r + r + 1.6);
  };

  const sol = towers.find((t) => t.id === SOL_MINT);
  if (sol) {
    const width = towerWidth(sol);
    placed.push({ tower: sol, x: 0, z: 0, height: towerHeight(sol), width, kind: 0, seed: hashString(sol.id) });
    blocks.push({ x: 0, z: 0, r: width });
  }

  for (const district of ['core', 'heights', 'avenue', 'strip', 'docks'] as const) {
    const sector = SECTORS[district];
    const members = towers
      .filter((t) => t.district === district && t.id !== SOL_MINT)
      .map((t) => ({ t, h: towerHeight(t), w: towerWidth(t) }))
      .sort((a, b) => b.h - a.h);
    const random = rng(hashString(district));
    for (const { t, h, w } of members) {
      // Try rings from the inside out; the tallest coins take the inner slots.
      let spot: { x: number; z: number } | null = null;
      for (let tries = 0; tries < 400 && !spot; tries += 1) {
        const spread = Math.min(1, tries / 160);
        const r = sector.rMin + (sector.rMax - sector.rMin) * Math.min(1, spread * 0.85 + random() * 0.35);
        const a = toRad(sector.from + (sector.to - sector.from) * random());
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r;
        if (free(x, z, w)) spot = { x, z };
      }
      if (!spot) continue;
      placed.push({ tower: t, x: spot.x, z: spot.z, height: h, width: w, kind: sector.kind, seed: hashString(t.id) });
      blocks.push({ x: spot.x, z: spot.z, r: w });
    }
  }

  return { towers: placed, fillers: layoutFillers(blocks), rails: layoutRails(placed), islandRadius: ISLAND_RADIUS };
}

function layoutFillers(blocks: { x: number; z: number; r: number }[]): Filler[] {
  const random = rng(7);
  const fillers: Filler[] = [];
  const cell = 3.3;
  for (let gx = -ISLAND_RADIUS; gx <= ISLAND_RADIUS; gx += cell) {
    for (let gz = -ISLAND_RADIUS; gz <= ISLAND_RADIUS; gz += cell) {
      const x = gx + (random() - 0.5) * 0.9;
      const z = gz + (random() - 0.5) * 0.9;
      const r = Math.hypot(x, z);
      if (r > ISLAND_RADIUS - 3 || r < PLAZA_RADIUS + 3) continue;
      if (onRoad(x, z, 1.1)) continue;
      if (blocks.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 2.2)) continue;
      if (random() < 0.12) continue; // small parks and courtyards
      const width = 1.5 + random() * 1.1;
      const depth = 1.5 + random() * 1.1;
      const falloff = 1 - r / (ISLAND_RADIUS + 10);
      let height = (2 + 9 * falloff) * (0.45 + random() * 0.9);
      if (random() < 0.05) height *= 1.9;
      fillers.push({ x, z, width, depth, height: Math.max(1.2, height), seed: Math.floor(random() * 1e9) });
    }
  }
  return fillers;
}

function layoutRails(towers: PlacedTower[]): Rail[] {
  const random = rng(11);
  const rails: Rail[] = [];
  const sol = towers[0];
  const anchor = (t: PlacedTower, f: number): [number, number, number] => [t.x, t.height * f, t.z];
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
      if (!nearest || nearest.d > 22 || random() < 0.45) continue;
      const lo = Math.min(t.height, nearest.o.height);
      rails.push({ a: [t.x, lo * (0.35 + random() * 0.3), t.z], b: [nearest.o.x, lo * (0.35 + random() * 0.3), nearest.o.z], arch: 1 + random() * 3, seed: Math.floor(random() * 1e9) });
    }
  }
  return rails;
}
