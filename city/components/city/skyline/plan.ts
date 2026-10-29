import type { PlacedTower } from '../../../lib/city/layout.ts';

/**
 * How a coin's tower is put together from the kit's modules (CITY-56). Pure and seeded: the same tower is the same
 * building on every device. The market decides the tower exactly as before — the top of its crown is `height`
 * (market cap within what liquidity carries), its plan fits `width`, its district picks the style — and this only
 * decides the architecture: plan shape, podium, floors, mechanical floors, setbacks with terraces and a crown.
 *
 * A placement is one instance: a module (by name in public/city/models/city-kit.glb), where it stands (y, world units
 * from the ground), how tall it is drawn (h), how wide (scale: the plan's radius) and which floors it covers (floor0,
 * floors: the shader counts windows and rooms from them).
 *
 * Levels of detail: 0 close (every floor a module: fins, slab edges, balconies), 1 street (each run of floors one
 * stretched glass prism, the shader draws slabs and mullions), 2 district (one capped block per setback), 3 skyline
 * (one block for the body). Every level carries the crown, so the silhouette never pops.
 */

/** One floor in the kit's own units: a plan has radius 1 and a floor is this tall (blender/city_kit.py). */
export const KIT_FLOOR = 0.15;
/** A storey in the city, before each tower rounds it so its floors fit its height exactly. */
export const STOREY = 0.44;
/** Floors of the podium. */
export const PODIUM = 3;

export type Style = 'spire' | 'strip' | 'avenue' | 'docks';
export type Shape = 'chamfer' | 'round' | 'notch' | 'square' | 'rrect';
export type Lod = 0 | 1 | 2 | 3;
export const LODS: readonly Lod[] = [0, 1, 2, 3];

export type Placement = { mesh: string; y: number; h: number; scale: number; floor0: number; floors: number };

export type TowerPlan = {
  style: Style;
  shape: Shape;
  crown: string;
  /** This tower's storey: `height` divided by a whole number of floors. */
  storey: number;
  /** Where the crown starts (the roof of the shaft); the crown always ends at the market's height. */
  roof: number;
  lods: [Placement[], Placement[], Placement[], Placement[]];
};

/** Module heights in floors, as built (from the models' bounds). */
export type ModuleFloors = Readonly<Record<string, number>>;

const STYLE_BY_KIND: readonly Style[] = ['spire', 'strip', 'avenue', 'docks'];

/** A small seeded generator (mulberry32), one per tower. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickShape(style: Style, r: number): Shape {
  if (style === 'spire') return r < 0.42 ? 'chamfer' : r < 0.72 ? 'notch' : 'round';
  if (style === 'strip') return r < 0.6 ? 'rrect' : 'round';
  return 'square';
}

/** The crown for a tower this many floors tall: masts only where the tower is tall enough to carry one. */
function pickCrown(style: Style, shape: Shape, floors: number, r: number): string {
  if (style === 'docks') return 'crane';
  if (style === 'avenue') return floors >= 30 ? 'crown.deco.square' : 'crown.flat.square';
  if (style === 'strip') {
    if (floors < 22) return `crown.flat.${shape}`;
    return r < 0.55 ? `crown.pergola.${shape}` : `crown.band.${shape}`;
  }
  if (floors < 26) return `crown.flat.${shape}`;
  if (shape === 'round') return r < 0.5 && floors < 70 ? 'crown.lantern.round' : 'crown.taper.round';
  if (floors >= 70 && r < 0.6) return `crown.taper.${shape}`;
  return r < 0.5 ? `crown.slant.${shape}` : `crown.taper.${shape}`;
}

/** Setbacks as (share of the shaft where the plan steps in, the plan's size above it). */
function setbacksFor(style: Style, shape: Shape, floors: number, r: number): [number, number][] {
  if (style === 'avenue') return floors >= 24 ? [[0.58, 0.84], [0.8, 0.7], [0.93, 0.58]] : floors >= 12 ? [[0.7, 0.84]] : [];
  if (style === 'spire') return shape !== 'round' && floors >= 40 && r < 0.7 ? [[0.68 + r * 0.12, 0.86]] : [];
  if (style === 'strip') return floors >= 50 && r < 0.4 ? [[0.8, 0.88]] : [];
  return [];
}

type FloorKind = 'glass' | 'mech' | 'open';

const floorModule = (style: Style, shape: Shape, kind: FloorKind) =>
  kind === 'open'
    ? 'floor.scaffold.0'
    : kind === 'mech'
      ? `floor.mech.${shape}`
      : style === 'strip'
        ? `floor.balcony.${shape}`
        : style === 'avenue'
          ? 'floor.pier.square'
          : `floor.curtain.${shape}`;

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The plan of one tower. `kit` gives every module's height in floors (the loader reads it from the models), so the
 * crown's height is known and the shaft fills the rest; the crown is drawn to end exactly at the market's height.
 */
export function planTower(t: PlacedTower, kit: ModuleFloors): TowerPlan {
  const style = STYLE_BY_KIND[t.kind] ?? 'spire';
  const r = random(t.seed);
  const sol = t.tower.id === SOL_MINT;
  const shape: Shape = sol ? 'round' : pickShape(style, r());
  const total = Math.max(6, Math.round(t.height / STOREY));
  const storey = t.height / total;
  let crown = sol ? 'crown.taper.round' : pickCrown(style, shape, total, r());
  const floorsOf = (name: string) => kit[`${name}.0`] ?? 1;
  // A tower too short for its crown (a crane on a small launch) gets a plain roof.
  if (Math.round(total - PODIUM - floorsOf(crown)) < 2) crown = `crown.flat.${shape}`;
  const shaft = Math.max(2, Math.round(total - PODIUM - floorsOf(crown)));
  const roof = (PODIUM + shaft) * storey;
  const crownH = Math.max(storey * 0.4, t.height - roof);

  const W = t.width;
  const lods: TowerPlan['lods'] = [[], [], [], []];
  lods[0].push({ mesh: `base.${shape}.0`, y: 0, h: PODIUM * storey, scale: W, floor0: 0, floors: 1 });
  lods[1].push({ mesh: `base.${shape}.1`, y: 0, h: PODIUM * storey, scale: W, floor0: 0, floors: 1 });

  // Every floor of the shaft: its kind and its plan's size (the setbacks step it in).
  const steps = setbacksFor(style, shape, shaft, r());
  const cuts = steps.map(([at]) => Math.max(1, Math.min(shaft - 1, Math.round(shaft * at))));
  const sizes = [1, ...steps.map(([, k]) => k)];
  const mechEvery = style === 'spire' ? 22 + Math.floor(r() * 8) : 0;
  const openFrom = style === 'docks' ? Math.round(shaft * 0.62) : Infinity;
  const floors: { kind: FloorKind; k: number; span: number }[] = [];
  for (let f = 0, span = 0; f < shaft; f += 1) {
    while (span < cuts.length && f >= cuts[span]!) span += 1;
    const mech = mechEvery > 0 && f > 6 && f < shaft - 4 && (f + 1) % mechEvery === 0;
    floors.push({ kind: f >= openFrom ? 'open' : mech ? 'mech' : 'glass', k: sizes[span]!, span });
  }

  floors.forEach((fl, f) => {
    lods[0].push({ mesh: floorModule(style, shape, fl.kind), y: (PODIUM + f) * storey, h: storey, scale: W * fl.k, floor0: PODIUM + f, floors: 1 });
  });
  // Street level: runs of the same kind and size become one stretched prism; steel stays floor by floor.
  for (let f = 0; f < shaft; ) {
    const fl = floors[f]!;
    let end = f + 1;
    while (end < shaft && floors[end]!.kind === fl.kind && floors[end]!.k === fl.k) end += 1;
    const y = (PODIUM + f) * storey;
    if (fl.kind === 'open') {
      for (let g = f; g < end; g += 1) lods[1].push({ mesh: 'floor.scaffold.1', y: (PODIUM + g) * storey, h: storey, scale: W * fl.k, floor0: PODIUM + g, floors: 1 });
    } else {
      lods[1].push({ mesh: `section.${fl.kind === 'mech' ? 'louvre' : 'glass'}.${shape}`, y, h: (end - f) * storey, scale: W * fl.k, floor0: PODIUM + f, floors: end - f });
    }
    f = end;
  }
  // Terraces where the plan steps in: on the roof of the floors below, at their size.
  cuts.forEach((cut, i) => {
    const y = (PODIUM + cut) * storey;
    lods[0].push({ mesh: `terrace.${shape}.0`, y, h: storey, scale: W * sizes[i]!, floor0: 0, floors: 1 });
    lods[1].push({ mesh: `terrace.${shape}.1`, y, h: storey, scale: W * sizes[i]!, floor0: 0, floors: 1 });
  });

  // Far levels: one capped block per setback span, then one block for the whole body.
  const bounds = [0, ...cuts, shaft];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const a = i === 0 ? 0 : PODIUM + bounds[i]!;
    const b = PODIUM + bounds[i + 1]!;
    lods[2].push({ mesh: `block.${shape}`, y: a * storey, h: (b - a) * storey, scale: W * sizes[i]!, floor0: a, floors: b - a });
  }
  lods[3].push({ mesh: `block.${shape}`, y: 0, h: roof, scale: W * (cuts.length > 1 ? 0.9 : 1), floor0: 0, floors: PODIUM + shaft });

  // The crown, on every level, ending exactly at the market's height.
  const k = sizes[sizes.length - 1]! * (crown === 'crane' ? 1.25 : 1);
  lods[0].push({ mesh: `${crown}.0`, y: roof, h: crownH, scale: W * k, floor0: PODIUM + shaft, floors: 1 });
  for (const lod of [1, 2, 3] as const) lods[lod].push({ mesh: `${crown}.1`, y: roof, h: crownH, scale: W * k, floor0: PODIUM + shaft, floors: 1 });
  return { style, shape, crown, storey, roof, lods };
}

/** The highest point a plan draws: the top of its tallest placement. */
export function planTop(plan: TowerPlan, lod: Lod = 0): number {
  return Math.max(...plan.lods[lod].map((p) => p.y + p.h));
}

/** Every module name a set of plans asks for, so the loader can say what the models lack. */
export function modulesOf(plans: readonly TowerPlan[]): string[] {
  return [...new Set(plans.flatMap((p) => p.lods.flat().map((x) => x.mesh)))].sort();
}
