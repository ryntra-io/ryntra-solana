import { create } from 'zustand';
import type { CityLayout, PlacedTower } from '../city/layout.ts';
import { isNamed, type District } from '../market/types.ts';

/**
 * The Map of the Play layer (CITY-81): the city seen from above — every tower a point where it stands, every district
 * named where its towers are — and a tap flies the camera there: a district framed whole, or one of the towers moving
 * most today. It only moves the camera (city/components/city/CameraRig.tsx reads `view`); nothing opens, nothing is
 * bought. The figures are the city's own read.
 */

export const DISTRICT_NAMES: Readonly<Record<District, string>> = {
  core: 'Sol Core',
  heights: 'DeFi Heights',
  strip: 'Meme Strip',
  avenue: 'Stock Avenue',
  docks: 'Launch Docks',
};

/** The names on the Map itself, short enough that five fit on a phone's island. */
export const DISTRICT_SHORT: Readonly<Record<District, string>> = {
  core: 'SOL',
  heights: 'DeFi',
  strip: 'Memes',
  avenue: 'Stocks',
  docks: 'Launch',
};

const ORDER: readonly District[] = ['core', 'heights', 'strip', 'avenue', 'docks'];

/** How many of a district's towers its shot frames: the tallest, so the shot stays a skyline, not a crowd. */
export const DISTRICT_FRAME = 6;
/** How many movers the Map offers. */
export const MOVERS = 3;

export type DistrictView = Readonly<{ id: District; name: string; short: string; x: number; z: number; ids: readonly string[] }>;

/** Each district that has towers: its name, where its towers stand on average, and the towers its shot frames. */
export function districtViews(layout: Pick<CityLayout, 'towers'>): DistrictView[] {
  const out: DistrictView[] = [];
  for (const id of ORDER) {
    const members = layout.towers.filter((t) => t.tower.district === id);
    if (!members.length) continue;
    const framed = [...members].sort((a, b) => b.height - a.height).slice(0, DISTRICT_FRAME);
    // The core rings the spire: its name stands on the spire itself.
    const x = id === 'core' ? 0 : members.reduce((sum, t) => sum + t.x, 0) / members.length;
    const z = id === 'core' ? 0 : members.reduce((sum, t) => sum + t.z, 0) / members.length;
    out.push({ id, name: DISTRICT_NAMES[id], short: DISTRICT_SHORT[id], x, z, ids: framed.map((t) => t.tower.id) });
  }
  return out;
}

/**
 * The towers moving most today among the coins people know, launches aside: the biggest 24-hour moves, either way. Only
 * a coin whose logo the engine has: the Map never shows an empty circle where a coin's face should be.
 */
export function topMovers(layout: Pick<CityLayout, 'towers'>, count = MOVERS): PlacedTower[] {
  return layout.towers
    .filter((t) => isNamed(t.tower) && !!t.tower.icon && t.tower.district !== 'docks' && Number.isFinite(t.tower.change24h))
    .sort((a, b) => Math.abs(b.tower.change24h) - Math.abs(a.tower.change24h))
    .slice(0, count);
}

/** A point of the island on the Map: north (−Z, the Eclipse) up, as the city's opening shot looks at it. */
export function mapPoint(x: number, z: number, radius: number, size: number): { left: number; top: number } {
  const k = size / 2 / radius;
  return { left: size / 2 + x * k, top: size / 2 + z * k };
}

export type Label = Readonly<{ left: number; top: number; width: number; height: number }>;

/**
 * Labels that would cover one another are moved apart, down the map, by as little as it takes; one that would leave
 * the map goes up instead. Centres in, centres out, in the order given.
 */
export function spreadLabels(labels: readonly Label[], size: number, gap = 2): { left: number; top: number }[] {
  const placed: { left: number; top: number; width: number; height: number }[] = [];
  const order = labels.map((l, i) => ({ ...l, i })).sort((a, b) => a.top - b.top);
  const out: { left: number; top: number }[] = labels.map((l) => ({ left: l.left, top: l.top }));
  for (const l of order) {
    let top = l.top;
    const hits = (t: number) => placed.find((p) => Math.abs(p.left - l.left) < (p.width + l.width) / 2 + gap && Math.abs(p.top - t) < (p.height + l.height) / 2 + gap);
    for (let hit = hits(top), guard = 0; hit && guard < labels.length; hit = hits(top), guard++) top = hit.top + (hit.height + l.height) / 2 + gap;
    if (top + l.height / 2 > size) {
      top = l.top;
      for (let hit = hits(top), guard = 0; hit && guard < labels.length; hit = hits(top), guard++) top = hit.top - (hit.height + l.height) / 2 - gap;
    }
    placed.push({ left: l.left, top, width: l.width, height: l.height });
    out[l.i] = { left: l.left, top };
  }
  return out;
}

export type MapView = Readonly<{ ids: readonly string[]; at: number }>;

type MapState = {
  open: boolean;
  /** What the camera frames now, until the city is sent home or the layer is left. */
  view: MapView | null;
  toggle: () => void;
  close: () => void;
  look: (ids: readonly string[]) => void;
  clear: () => void;
};

export const useGameMap = create<MapState>((set, get) => ({
  open: false,
  view: null,
  toggle: () => set({ open: !get().open }),
  close: () => set({ open: false }),
  look: (ids) => set({ view: ids.length ? { ids: [...ids], at: Date.now() } : null }),
  clear: () => set({ view: null }),
}));

/** Back to a fresh page (tests). */
export function resetGameMap(): void {
  useGameMap.setState({ open: false, view: null });
}
