import { moduleList, normalizeModules, type BuildingKind, type Level, type ModuleSet } from './catalog.ts';
import { ALL, C, FAR, linear, MID, mix, NEAR, planOf, scaled, type BuildingPlan, type Motion, type Part, type Rgb, type Shape, type Style, type Vec3 } from './parts.ts';

/**
 * Every building of the kit, drawn from data: kind and level give the shape and the signature (cranes, rings, the
 * drone, the scoreboard), modules give the style (stone or plaza, graphite or glass floors, the roof, the light, the
 * sign). The same input always gives the same building, on every device.
 *
 * Units are the city's: one lot is LOT × LOT, one storey is STOREY tall, the front of a building faces +z.
 */

export const LOT = 5;
export const STOREY = 0.9;

/** What a building says about the engine object behind it: value lights mint, danger turns its light and haze red. */
export type Signal = 'value' | 'danger' | null;

export type BuildOptions = {
  /** Any number; the building's id hashed is a good one. Changes which windows are lit and small details. */
  seed?: number;
  signal?: Signal;
};

type Look = {
  window: Rgb;
  accent: Rgb;
  lamp: Rgb;
  signal: Signal;
  /** Launch light: mint, as the docks are in the city. */
  launch: Rgb;
  random: () => number;
  power: number;
};

/** The light module: the colour of windows, of seams and kerbs, of lamps. Lanterns add wall lights by the door. */
export const LIGHTS: Record<string, { window: Rgb; accent: Rgb; lamp: Rgb }> = {
  'light.amber': { window: mix(C.amber, C.warm, 0.22), accent: C.amber, lamp: mix(C.amber, C.warm, 0.45) },
  'light.lantern': { window: mix(C.warm, C.amber, 0.15), accent: scaled(C.warm, 0.85), lamp: C.warm },
  'light.violet': { window: mix(C.amber, C.warm, 0.5), accent: scaled(C.violet, 1.5), lamp: mix(C.warm, C.violet, 0.25) },
  'light.beacon': { window: mix(C.ice, C.warm, 0.3), accent: C.ice, lamp: C.ice },
};

/**
 * How a storey looks for each floor module, and for the kinds' own storeys when no floor is chosen. Terraces and
 * garden floors add balconies and planters to their storeys.
 */
export const FLOORS: Record<string, { style: Style; tint: Rgb; extra?: 'terrace' | 'garden' }> = {
  'floor.concrete': { style: 'graphite', tint: mix(C.graphite, C.metal, 0.45) },
  'floor.glass': { style: 'glass', tint: scaled(C.graphite, 0.7) },
  'floor.brick': { style: 'ceramic', tint: linear('#3E2420') },
  'floor.terrace': { style: 'graphite', tint: C.graphite, extra: 'terrace' },
  'floor.garden': { style: 'ceramic', tint: scaled(C.pearl, 0.17), extra: 'garden' },
  steel: { style: 'steel', tint: C.steel },
  graphite: { style: 'graphite', tint: C.graphite },
};

const floorOf = (key: string | undefined) => FLOORS[key ?? 'floor.concrete'] ?? FLOORS['floor.concrete']!;

/** Storeys each kind draws at each level, 1 → 5: the form grows with the level, whatever its floors are made of. */
export const STOREYS: Record<BuildingKind, readonly [number, number, number, number, number]> = {
  home: [1, 2, 4, 6, 9],
  coin_tower: [1, 3, 5, 7, 9],
  harbor: [0, 1, 1, 2, 3],
  workshop: [0, 1, 2, 2, 3],
  crew_hq: [0, 1, 2, 3, 4],
  garage: [1, 1, 2, 2, 3],
  oracle: [1, 2, 3, 4, 5],
  showcase: [1, 1, 2, 3, 3],
  billboard: [1, 1, 2, 3, 4],
  decor: [0, 0, 0, 0, 0],
};

/** The look of a kind's storeys when the building has no floor modules (a level 1 building has none). */
const OWN_STOREY: Record<BuildingKind, string> = {
  home: 'floor.concrete',
  coin_tower: 'graphite',
  harbor: 'steel',
  workshop: 'steel',
  crew_hq: 'floor.concrete',
  garage: 'steel',
  oracle: 'floor.glass',
  showcase: 'floor.glass',
  billboard: 'steel',
  decor: 'floor.concrete',
};

/** The building's storeys bottom to top: its floor modules (at most four) share the storeys out evenly. */
function storeysOf(kind: BuildingKind, level: Level, set: ModuleSet): string[] {
  const n = STOREYS[kind][level - 1]!;
  const floors = set.floors;
  return Array.from({ length: n }, (_, i) => (floors.length ? floors[Math.min(floors.length - 1, Math.floor((i * floors.length) / n))]! : OWN_STOREY[kind]));
}

/** mulberry32, the same small generator the city's layout uses. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type PartInput = Partial<Omit<Part, 'shape' | 'style' | 'at' | 'size'>>;

/** Collects parts with the building's look as defaults. */
class Builder {
  readonly parts: Part[] = [];
  /** Added to every part's position: lets a kind draw a block away from the lot's centre with the same helpers. */
  offset: Vec3 = [0, 0, 0];
  readonly look: Look;
  constructor(look: Look) {
    this.look = look;
  }

  add(shape: Shape, style: Style, at: Vec3, size: Vec3, o: PartInput = {}): Part {
    const part: Part = {
      shape,
      style,
      at: [at[0] + this.offset[0], at[1] + this.offset[1], at[2] + this.offset[2]],
      size,
      turn: [0, 0, 0],
      tint: C.graphite,
      glow: this.look.window,
      accent: this.look.accent,
      power: this.look.power,
      grain: 1,
      motion: 'none',
      speed: 1,
      phase: this.look.random() * 6.283,
      door: false,
      kerb: false,
      lods: ALL,
      ...o,
    };
    this.parts.push(part);
    return part;
  }

  /** A light: lamp heads, light strips, beacons. Bright enough to bloom. */
  light(shape: Shape, at: Vec3, size: Vec3, color: Rgb, power = 3, o: PartInput = {}): Part {
    return this.add(shape, 'light', at, size, { glow: color, power, lods: NEAR | MID, ...o });
  }

  /** A pool of light on the ground (additive, drawn after everything solid). */
  pool(x: number, y: number, z: number, diameter: number, color: Rgb, power = 0.6, o: PartInput = {}): Part {
    return this.add('disc', 'pool', [x, y + 0.015, z], [diameter, 1, diameter], { glow: color, power, lods: NEAR | MID, ...o });
  }

  /** A street lamp: post, arm, head and its pool of light. */
  lamp(x: number, y: number, z: number, h = 1.15, color = this.look.lamp, facing = 0): void {
    this.add('cyl', 'metal', [x, y, z], [0.07, h, 0.07], { tint: C.metal, lods: NEAR | MID });
    const ax = Math.sin(facing) * 0.14;
    const az = Math.cos(facing) * 0.14;
    this.add('box', 'metal', [x + ax / 2, y + h - 0.04, z + az / 2], [0.04 + Math.abs(ax), 0.04, 0.04 + Math.abs(az)], { tint: C.metal, lods: NEAR });
    this.light('sphere', [x + ax, y + h - 0.16, z + az], [0.17, 0.17, 0.17], color, 4.2, { motion: 'flicker', speed: 0.3 });
    this.pool(x + ax, y, z + az, 1.9, color, 0.55);
  }

  /** A short glowing bollard. */
  bollard(x: number, y: number, z: number, color = this.look.lamp): void {
    this.add('cyl', 'metal', [x, y, z], [0.09, 0.26, 0.09], { tint: C.metal, lods: NEAR });
    this.light('cyl', [x, y + 0.26, z], [0.1, 0.06, 0.1], color, 3.4, { lods: NEAR });
  }
}

/**
 * The base module. Returns the height the building stands on. `w` and `d` are the footprint of what stands on it.
 */
function base(b: Builder, set: ModuleSet, w: number, d: number): number {
  const stone = mix(C.stone, C.graphite, 0.25);
  if (set.base === 'base.basalt') {
    // Basalt: a wide lit plaza, the finest base.
    const basalt = mix(C.stone, C.ink, 0.4);
    b.add('chamfer', 'stone', [0, 0, 0], [Math.min(LOT - 0.1, w + 1.3), 0.12, Math.min(LOT - 0.1, d + 1.3)], { tint: basalt, kerb: true, accent: b.look.accent, power: 0.9 });
    b.add('box', 'stone', [0, 0.12, 0], [w + 0.24, 0.08, d + 0.24], { tint: scaled(basalt, 1.5), lods: NEAR | MID });
    const px = Math.min(LOT - 0.1, w + 1.3) / 2 - 0.22;
    const pz = Math.min(LOT - 0.1, d + 1.3) / 2 - 0.22;
    for (const [sx, sz] of [[-1, 1], [1, 1]] as const) b.bollard(sx * px, 0.12, sz * pz);
    b.pool(0, 0.12, d / 2 + 0.45, Math.min(2.2, w), b.look.lamp, 0.35);
    return 0.2;
  }
  if (set.base === 'base.steel') {
    const dw = Math.min(LOT - 0.2, w + 0.6);
    const dd = Math.min(LOT - 0.2, d + 0.6);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.add('cyl', 'metal', [sx * (dw / 2 - 0.2), 0, sz * (dd / 2 - 0.2)], [0.18, 0.34, 0.18], { tint: C.metal, lods: NEAR | MID });
    }
    b.add('box', 'steel', [0, 0.32, 0], [dw, 0.16, dd], { tint: C.steel, kerb: true, accent: b.look.accent, power: 1 });
    return 0.48;
  }
  if (set.base === 'base.timber') {
    // Timber: a plank deck, the light along its edge.
    b.add('box', 'steel', [0, 0, 0], [w + 0.4, 0.2, d + 0.4], { tint: WOOD, kerb: true, accent: b.look.lamp, power: 0.8 });
    return 0.2;
  }
  // Stone, or brick.
  const brick = set.base === 'base.brick';
  b.add('chamfer', brick ? 'ceramic' : 'stone', [0, 0, 0], [w + 0.36, 0.2, d + 0.36], { tint: brick ? BRICK : stone, kerb: true, accent: b.look.accent, power: 0.9, grain: 0.1 });
  return 0.2;
}

const WOOD = linear('#3A2618');
const BRICK = linear('#3E2420');

type StackOptions = {
  w: number;
  d: number;
  y: number;
  /** Storey height. */
  h?: number;
  shape?: 'chamfer' | 'prism';
  grain?: number;
  door?: boolean;
  /** How much narrower storey i is than the ground storey (1 = same). */
  shrink?: (i: number) => number;
  /** Surface of the ground storey, when it differs from its module (a shop front). */
  ground?: Style;
};

type StackTop = { y: number; w: number; d: number };

/** The floors module: storeys bottom to top, ledges between them, one plain block per setback for the far view. */
function stack(b: Builder, floors: readonly string[], o: StackOptions): StackTop {
  const h = o.h ?? STOREY;
  const shrink = o.shrink ?? (() => 1);
  const shape = o.shape ?? 'chamfer';
  let y = o.y;
  let w = o.w;
  let d = o.d;
  let group = { from: y, k: shrink(0), floor: floors[0] };
  const closeGroup = (to: number) => {
    const f = floorOf(group.floor);
    const gw = o.w * group.k;
    const gd = o.d * group.k;
    b.add(shape === 'prism' ? 'prism' : 'box', f.style === 'glass' ? 'glass' : f.style, [0, group.from, 0], [gw, to - group.from, gd], { tint: f.tint, grain: o.grain ?? 1, lods: FAR });
  };
  floors.forEach((id, i) => {
    const k = shrink(i);
    if (k !== group.k) {
      closeGroup(y);
      group = { from: y, k, floor: id };
    }
    w = o.w * k;
    d = o.d * k;
    const f = floorOf(id);
    const style = i === 0 && o.ground ? o.ground : f.style;
    b.add(shape, style, [0, y, 0], [w, h, d], { tint: f.tint, grain: o.grain ?? 1, door: i === 0 && (o.door ?? true), lods: NEAR | MID });
    if (f.extra === 'terrace' && i > 0) {
      // A terrace: a deck out over the street with a lit rail.
      b.add('box', 'plain', [0, y, d / 2 + 0.2], [w * 0.7, 0.06, 0.4], { tint: scaled(C.graphite, 0.9), lods: NEAR | MID });
      b.light('box', [0, y + 0.3, d / 2 + 0.39], [w * 0.7, 0.02, 0.02], b.look.accent, 2.2, { lods: NEAR });
    } else if (f.extra === 'garden') {
      // A garden floor: planters along the front, lit from inside the leaves.
      b.add('box', 'foliage', [0, y, d / 2 + 0.12], [w * 0.86, 0.26, 0.24], { tint: C.leaf, glow: b.look.lamp, lods: NEAR | MID });
    }
    y += h;
    if (i < floors.length - 1) {
      const next = shrink(i + 1);
      // A ledge between storeys; where the next storey steps back, the ledge is a lit terrace edge.
      b.add(shape === 'prism' ? 'prism' : 'box', 'stone', [0, y - 0.035, 0], [w + 0.08, 0.07, d + 0.08], { tint: scaled(C.graphite, 0.55), kerb: next < k, lods: NEAR | MID });
    }
  });
  if (floors.length) closeGroup(y);
  return { y, w, d };
}

/** A door's light: a canopy over it and its glow on the ground. */
function doorway(b: Builder, y: number, front: number, x = 0): void {
  b.add('box', 'plain', [x, y + 0.66, front + 0.12], [0.62, 0.05, 0.26], { tint: scaled(C.graphite, 0.8), lods: NEAR });
  b.light('box', [x, y + 0.655, front + 0.2], [0.5, 0.012, 0.1], b.look.lamp, 2.6, { lods: NEAR });
  b.pool(x, y, front + 0.45, 1.3, b.look.lamp, 0.42);
}

/** Lanterns: with the lantern light module, a warm light either side of the door. */
function lanterns(b: Builder, set: ModuleSet, w: number, front: number, y: number): void {
  if (set.light !== 'light.lantern') return;
  for (const sx of [-1, 1]) b.light('box', [sx * Math.min(0.5, w * 0.3), y + 0.42, front + 0.05], [0.09, 0.16, 0.09], b.look.lamp, 3.6, { motion: 'flicker', speed: 0.3 });
}

/**
 * The roof on top of a stack: a roof module, or the kind's own roof when it has none — `gable`, `pad`, `sawtooth`,
 * `crown`.
 */
function roof(b: Builder, id: string | null, top: StackTop): number {
  const { y, w, d } = top;
  const look = b.look;
  if (id === null) return y;
  switch (id) {
    case 'gable': {
      const rise = Math.min(0.85, w * 0.36);
      b.add('gable', 'roof', [0, y, 0], [w + 0.18, rise, d + 0.18], { tint: scaled(C.graphite, 0.7), accent: look.accent, kerb: true, power: 0.6 });
      b.add('box', 'stone', [w * 0.24, y + rise * 0.3, -d * 0.18], [0.24, rise * 0.85, 0.24], { tint: C.stone, lods: NEAR | MID });
      b.light('box', [w * 0.24, y + rise * 1.15, -d * 0.18], [0.16, 0.03, 0.16], look.lamp, 2.2, { motion: 'pulse', speed: 0.8, lods: NEAR });
      return y + rise;
    }
    case 'roof.spire': {
      b.add('chamfer', 'graphite', [0, y, 0], [w * 0.6, 0.36, d * 0.6], { tint: C.graphite, kerb: true, lods: NEAR | MID });
      const tall = 1.2 + w * 0.3;
      b.add('cone', 'metal', [0, y + 0.36, 0], [0.24, tall, 0.24], { tint: C.metal });
      b.light('sphere', [0, y + 0.3 + tall, 0], [0.16, 0.16, 0.16], look.lamp, 5, { motion: 'blink', speed: 0.5, lods: ALL });
      return y + 0.36 + tall;
    }
    case 'pad': {
      const r = Math.min(w, d) * 0.86;
      b.add('chamfer', 'roof', [0, y, 0], [w + 0.08, 0.1, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      b.add('cyl', 'roof', [0, y + 0.1, 0], [r, 0.05, r], { tint: scaled(C.graphite, 0.9), lods: NEAR | MID });
      b.light('torus', [0, y + 0.16, 0], [r * 0.92, 1, r * 0.92], look.accent, 2.6, { motion: 'pulse', speed: 1.4 });
      b.light('box', [0, y + 0.155, 0], [r * 0.32, 0.01, 0.05], look.accent, 2, { lods: NEAR });
      return y + 0.2;
    }
    case 'sawtooth': {
      b.add('box', 'roof', [0, y, 0], [w + 0.06, 0.08, d + 0.06], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      const teeth = Math.max(2, Math.round(d / 0.85));
      const step = d / teeth;
      for (let i = 0; i < teeth; i += 1) {
        const z = -d / 2 + step * (i + 0.5);
        b.add('wedge', 'roof', [0, y + 0.08, z], [w, 0.5, step], { tint: scaled(C.steel, 0.8), lods: i === teeth - 1 ? ALL : NEAR | MID });
        b.light('quad', [0, y + 0.13, z + step / 2 + 0.006], [w * 0.92, 0.34, 1], mix(look.window, C.amber, 0.5), 0.45, { lods: NEAR | MID });
      }
      return y + 0.58;
    }
    case 'roof.garden': {
      b.add('chamfer', 'roof', [0, y, 0], [w + 0.08, 0.12, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      b.add('box', 'foliage', [0, y + 0.12, -d / 2 + 0.24], [w * 0.86, 0.22, 0.32], { tint: C.leaf, glow: look.lamp, lods: NEAR | MID });
      b.add('box', 'foliage', [-w / 2 + 0.24, y + 0.12, 0.1], [0.32, 0.22, d * 0.6], { tint: C.leaf, glow: look.lamp, lods: NEAR });
      const trees = Math.max(2, Math.round(w * 0.9));
      for (let i = 0; i < trees; i += 1) {
        const tx = -w / 2 + 0.55 + (i / Math.max(1, trees - 1)) * (w - 1.1) * 0.9 + (look.random() - 0.5) * 0.15;
        const tz = -d / 2 + 0.55 + look.random() * (d * 0.45);
        const s = 0.55 + look.random() * 0.3;
        b.add('cyl', 'plain', [tx, y + 0.12, tz], [0.07, 0.36, 0.07], { tint: C.stone, lods: NEAR });
        b.add('sphere', 'foliage', [tx, y + 0.38, tz], [s, s * 0.9, s], { tint: C.leaf, glow: look.lamp, lods: i === 0 ? ALL : NEAR | MID });
      }
      // String lights over the terrace.
      b.light('box', [0, y + 0.82, d / 2 - 0.12], [w * 0.88, 0.022, 0.022], look.lamp, 2.4, { motion: 'chase', speed: 0.6, lods: NEAR });
      b.light('box', [w / 2 - 0.12, y + 0.82, 0], [0.022, 0.022, d * 0.88], look.lamp, 2.4, { motion: 'chase', speed: 0.6, lods: NEAR });
      return y + 1.1;
    }
    case 'roof.dome': {
      const r = Math.min(w, d) * 0.82;
      b.add('chamfer', 'roof', [0, y, 0], [w + 0.08, 0.1, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      b.add('cyl', 'stone', [0, y + 0.1, 0], [r, 0.22, r], { tint: C.stone, kerb: true, lods: NEAR | MID });
      b.add('dome', 'glass', [0, y + 0.32, 0], [r * 0.96, r * 0.5, r * 0.96], { tint: scaled(C.graphite, 0.6), power: 0.8 });
      b.light('sphere', [0, y + 0.3 + r * 0.5, 0], [0.12, 0.12, 0.12], look.lamp, 4, { motion: 'pulse', speed: 1 });
      return y + 0.42 + r * 0.5;
    }
    case 'crown': {
      const core = Math.max(0.5, w * 0.36);
      b.add('prism', 'graphite', [0, y, 0], [w * 0.62, 0.3, d * 0.62], { tint: C.graphite, kerb: true, grain: 0.5, lods: NEAR | MID });
      const color = look.signal === 'value' ? scaled(C.mint, 3) : look.signal === 'danger' ? scaled(C.flare, 3) : scaled(C.amber, 2.6);
      b.light('sphere', [0, y + 0.22, 0], [core, core, core], color, 1, { motion: 'pulse', speed: 2.4, lods: ALL });
      b.light('torus', [0, y + 0.3 + core * 0.55, 0], [core * 2.1, 1, core * 2.1], scaled(C.violet, 2.4), 1, { motion: 'spin', speed: 0.4 });
      return y + 0.22 + core;
    }
    case 'roof.antenna': {
      b.add('chamfer', 'roof', [0, y, 0], [w + 0.08, 0.12, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      // A cluster of masts and a dish, each mast with a light that blinks in its own time.
      const masts: [number, number, number][] = [[-w * 0.25, -d * 0.2, 1.6], [w * 0.1, -d * 0.28, 1.1], [w * 0.28, d * 0.05, 0.8]];
      masts.forEach(([x, z, h], i) => {
        b.add('cyl', 'metal', [x, y + 0.12, z], [0.05, h, 0.05], { tint: C.metal, lods: i === 0 ? ALL : NEAR | MID });
        b.light('sphere', [x, y + 0.08 + h, z], [0.09, 0.09, 0.09], look.lamp, 5, { motion: 'blink', speed: 0.5 + i * 0.13, phase: i * 1.7 });
      });
      b.add('dome', 'metal', [-w * 0.18, y + 0.3, d * 0.2], [0.5, 0.18, 0.5], { tint: scaled(C.ice, 0.22), turn: [-0.9, 0.5, 0], lods: NEAR });
      return y + 0.12;
    }
    case 'roof.flat':
    default: {
      b.add('chamfer', 'roof', [0, y, 0], [w + 0.08, 0.12, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
      if (w >= 1.8) {
        b.add('box', 'metal', [w * 0.2, y + 0.12, -d * 0.18], [0.5, 0.28, 0.38], { tint: C.steel, lods: NEAR });
        b.add('cyl', 'steel', [-w * 0.22, y + 0.12, -d * 0.2], [0.42, 0.42, 0.42], { tint: C.steel, lods: NEAR });
      }
      return y + 0.12;
    }
  }
}

/**
 * A sign on the front face: the sign module (`sign.plain`, `sign.neon`), or a kind's own — `banner`, `marquee`,
 * `screen`. `front` is the face's z, `y` the foot of the facade, `top` its top, `x` where a name plate hangs.
 */
function sign(b: Builder, id: string | null, w: number, front: number, y: number, top: number, x = 0): void {
  const look = b.look;
  switch (id) {
    case 'sign.plain': {
      // A name plate: a dark board with a warm line of light.
      const pw = Math.min(1.1, w * 0.42);
      b.add('box', 'plain', [x, y + 0.72, front + 0.03], [pw, 0.2, 0.06], { tint: C.ink, lods: NEAR | MID });
      b.light('box', [x, y + 0.8, front + 0.062], [pw * 0.8, 0.04, 0.01], look.lamp, 2.4, { lods: NEAR | MID });
      return;
    }
    case 'sign.neon': {
      const h = Math.min(1.3, (top - y) * 0.6);
      const sy = Math.max(y + 0.9, top - h - 0.25);
      b.add('box', 'metal', [w / 2 - 0.32, sy - 0.04, front + 0.05], [0.44, h + 0.08, 0.06], { tint: C.metal, lods: NEAR | MID });
      b.add('quad', 'screen', [w / 2 - 0.32, sy, front + 0.085], [0.38, h, 1], { glow: look.accent, power: 2.6, motion: 'flicker', speed: 1, lods: NEAR | MID });
      return;
    }
    case 'banner': {
      const h = Math.min(1.6, (top - y) * 0.55);
      for (const sx of w > 3.6 ? [-1, 1] : [-1]) {
        const x = sx * (w / 2 - 0.42);
        b.add('box', 'metal', [x, top - 0.12, front + 0.06], [0.66, 0.04, 0.04], { tint: C.metal, lods: NEAR });
        b.add('quad', 'cloth', [x, top - 0.14 - h, front + 0.05], [0.56, h, 1], { tint: scaled(C.violet, 0.5), accent: C.warm, motion: 'wave', speed: 1.2, lods: NEAR | MID });
      }
      return;
    }
    case 'marquee': {
      const mw = Math.min(w - 0.4, 2.2);
      b.add('box', 'plain', [0, y + 0.74, front + 0.07], [mw, 0.24, 0.14], { tint: scaled(C.graphite, 0.8), lods: NEAR | MID });
      b.light('box', [0, y + 0.79, front + 0.145], [mw * 0.94, 0.14, 0.01], look.lamp, 2.8, { motion: 'chase', speed: 1.2 });
      return;
    }
    case 'screen': {
      const sw = Math.min(w - 0.5, 1.9);
      const sh = Math.min(1.05, sw * 0.55);
      const sy = Math.max(y + 1.0, top - sh - 0.3);
      b.add('box', 'plain', [0, sy - 0.05, front + 0.03], [sw + 0.12, sh + 0.1, 0.06], { tint: C.ink, lods: NEAR | MID | FAR });
      b.add('quad', 'screen', [0, sy, front + 0.064], [sw, sh, 1], { glow: look.accent, power: 1.6, motion: 'ticker', speed: 0.5 });
      return;
    }
    default:
      return;
  }
}

/** Windows lit at night: more on bigger buildings, a little different on every building. */
function windowPower(level: Level, random: () => number): number {
  return Math.min(0.85, 0.3 + level * 0.09 + (random() - 0.5) * 0.12);
}

// ---------- The ten kinds ----------

const pick = <T>(level: Level, values: readonly [T, T, T, T, T]): T => values[level - 1]!;

function home(b: Builder, level: Level, set: ModuleSet): void {
  const [w, d] = pick(level, [[2.0, 1.8], [2.4, 2.2], [2.8, 2.6], [3.0, 3.0], [3.4, 3.4]] as const);
  const y0 = base(b, set, w, d);
  const shrink = level === 5 ? (i: number) => (i >= 6 ? 0.74 : i >= 3 ? 0.88 : 1) : level === 4 ? (i: number) => (i >= 4 ? 0.82 : 1) : undefined;
  const st = storeysOf('home', level, set);
  const top = stack(b, st, { w, d, y: y0, shrink });
  doorway(b, y0, d / 2);
  // Balconies with a lit rail on every other storey from the third level up, where no terrace already is.
  if (level >= 3) {
    for (let i = 1; i < st.length; i += 2) {
      if (floorOf(st[i]).extra) continue;
      const k = shrink ? shrink(i) : 1;
      const bw = w * k * 0.56;
      const by = y0 + i * STOREY;
      const front = (d * k) / 2;
      b.add('box', 'plain', [0, by, front + 0.16], [bw, 0.06, 0.32], { tint: scaled(C.graphite, 0.9), lods: NEAR });
      b.light('box', [0, by + 0.3, front + 0.31], [bw, 0.02, 0.02], b.look.accent, 2.2, { lods: NEAR });
    }
  }
  roof(b, set.roof ?? (level <= 2 ? 'gable' : 'roof.flat'), top);
  sign(b, set.sign, w, d / 2, y0, top.y, -w * 0.28);
  lanterns(b, set, w, d / 2, y0);
  if (level <= 2) b.lamp(w / 2 + 0.45, 0, d / 2 + 0.35, 1.0);
  else b.lamp(w / 2 + 0.55, 0, d / 2 + 0.5, 1.25);
  // The trophy shelf: your coins as small glowing towers by the door.
  if (level >= 3) {
    const n = level - 2;
    const sx = -w / 2 - 0.1;
    b.add('box', 'stone', [sx, 0, d / 2 + 0.5], [0.3 + n * 0.26, 0.22, 0.34], { tint: C.stone, kerb: true, lods: NEAR | MID });
    for (let i = 0; i < n; i += 1) {
      const tx = sx - ((n - 1) * 0.26) / 2 + i * 0.26;
      const th = 0.28 + i * 0.14;
      b.add('prism', 'graphite', [tx, 0.22, d / 2 + 0.5], [0.15, th, 0.15], { tint: C.graphite, grain: 0.3, power: 0.8, lods: NEAR });
      b.light('sphere', [tx, 0.22 + th, d / 2 + 0.5], [0.09, 0.09, 0.09], scaled(C.amber, 2.6), 1, { motion: 'pulse', speed: 2.4, lods: NEAR });
    }
  }
}

function coinTower(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const launching = level <= 2;
  const accent = look.signal ? look.accent : launching ? look.launch : look.accent;
  const width = pick(level, [1.0, 1.6, 2.0, 2.2, 2.4]);
  const segment = pick(level, [0.9, 1.3, 1.4, 1.4, 1.4]);
  const y0 = base(b, set, launching ? 2.8 : width + 0.4, launching ? 2.8 : width + 0.4);
  if (level === 1) {
    // The launch pad: a ring on the deck, a scaffold and the coin's core glowing inside it.
    b.light('torus', [0, y0 + 0.02, 0], [2.6, 1.4, 2.6], accent, 2.4, { motion: 'pulse', speed: 2 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.add('box', 'metal', [sx * 0.72, y0, sz * 0.72], [0.08, 2.5, 0.08], { tint: C.metal, lods: NEAR | MID | FAR });
    }
    for (const fy of [1.25, 2.45]) {
      for (const [x, z, sw, sd] of [[0, -0.72, 1.52, 0.06], [0, 0.72, 1.52, 0.06], [-0.72, 0, 0.06, 1.52], [0.72, 0, 0.06, 1.52]] as const) {
        b.add('box', 'metal', [x, y0 + fy, z], [sw, 0.06, sd], { tint: C.metal, lods: NEAR });
      }
    }
    stack(b, storeysOf('coin_tower', level, set), { w: width, d: width, y: y0, h: segment, shape: 'prism', grain: 0.5, door: false });
    b.light('sphere', [0, y0 + 1.25, 0], [0.55, 0.55, 0.55], accent, 2.6, { motion: 'pulse', speed: 2.4, lods: ALL });
    b.pool(0, y0, 0, 3, accent, 0.4);
    return;
  }
  const top = stack(b, storeysOf('coin_tower', level, set), { w: width, d: width, y: y0, h: segment, shape: 'prism', grain: 0.5, door: false });
  // Light seams climb the tower's edges.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    b.light('box', [Math.sin(a) * width * 0.47, y0, Math.cos(a) * width * 0.47], [0.03, top.y - y0, 0.03], accent, 1.6, { turn: [0, a, 0], lods: NEAR | MID });
  }
  if (level === 2) {
    // Still in the docks: the top is open steel, lit mint like the city's launches.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      b.add('box', 'metal', [sx * 0.55, top.y, sz * 0.55], [0.06, 1.1, 0.06], { tint: C.metal, lods: NEAR | MID });
    }
    b.add('box', 'metal', [0, top.y + 1.06, 0], [1.2, 0.06, 1.2], { tint: C.metal, lods: NEAR | MID });
    b.light('sphere', [0, top.y + 0.35, 0], [0.5, 0.5, 0.5], accent, 2.4, { motion: 'pulse', speed: 2.4, lods: ALL });
    b.lamp(1.3, y0, 1.3, 1.0, look.lamp, Math.PI * 1.25);
    return;
  }
  roof(b, set.roof ?? 'crown', { y: top.y, w: width, d: width });
  // Survival rings: day 7, day 30, day 90.
  const rings = level === 3 ? 0 : level === 4 ? 2 : 3;
  for (let i = 0; i < rings; i += 1) {
    const ry = y0 + (top.y - y0) * (rings === 2 ? [0.45, 0.75][i]! : [0.32, 0.58, 0.84][i]!);
    b.light('torus', [0, ry, 0], [width * 1.6, 1.3, width * 1.6], scaled(C.warm, 2.2), 1, { motion: 'pulse', speed: 0.8, phase: i * 1.3 });
  }
  b.lamp(width / 2 + 0.9, y0, width / 2 + 0.9, 1.2, look.lamp, Math.PI * 1.25);
  b.lamp(-width / 2 - 0.9, y0, width / 2 + 0.9, 1.2, look.lamp, Math.PI * 0.75);
  if (level === 5) {
    // The landmark: a wall with the crew's names on the plaza, and four light pylons.
    b.add('box', 'stone', [0, y0, width / 2 + 0.95], [2.0, 0.5, 0.2], { tint: C.stone, kerb: true, lods: NEAR | MID });
    b.add('quad', 'screen', [0, y0 + 0.08, width / 2 + 1.052], [1.84, 0.34, 1], { glow: scaled(C.warm, 0.9), power: 1.4, motion: 'board', speed: 0.2, lods: NEAR | MID });
    for (const [sx, sz] of [[-1, -1], [1, -1]] as const) {
      b.light('box', [sx * (width / 2 + 0.95), y0, sz * (width / 2 + 0.95)], [0.12, 1.1, 0.12], look.accent, 2.4, { motion: 'pulse', speed: 0.6 });
    }
  }
}

function harbor(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const flow = look.signal === 'value' ? scaled(C.mint, 1) : look.signal === 'danger' ? C.flare : look.lamp;
  // The lot: a quay at the back, a basin of water at the front. The base module is what the quay is built of.
  const quayLook: Record<string, { style: Style; tint: Rgb }> = {
    'base.timber': { style: 'steel', tint: WOOD },
    'base.brick': { style: 'ceramic', tint: BRICK },
    'base.steel': { style: 'steel', tint: C.steel },
    'base.basalt': { style: 'stone', tint: mix(C.stone, C.ink, 0.4) },
  };
  const q = quayLook[set.base] ?? { style: 'stone' as Style, tint: mix(C.stone, C.graphite, 0.25) };
  const quay = 0.3;
  b.add('box', q.style, [0, 0, -1.1], [4.4, quay, 2.2], { tint: q.tint, kerb: true, accent: look.accent, power: 0.9, grain: 0.1 });
  b.add('box', q.style, [0, 0, 2.12], [4.4, 0.2, 0.16], { tint: q.tint, kerb: true, grain: 0.1, lods: NEAR | MID });
  for (const sx of [-1, 1]) b.add('box', q.style, [sx * 2.12, 0, 1.06], [0.16, 0.2, 2.12], { tint: q.tint, grain: 0.1, lods: NEAR | MID });
  b.add('box', 'water', [0, 0, 1.06], [4.1, 0.1, 2.06], { tint: C.water, glow: look.lamp });
  // A pier into the water with two bollards and a lamp at its end.
  b.add('box', 'steel', [-1.05, 0.2, 0.95], [0.7, 0.1, 1.9], { tint: C.steel, lods: NEAR | MID | FAR });
  for (const z of [0.6, 1.6]) b.add('cyl', 'metal', [-1.05, 0, z], [0.14, 0.22, 0.14], { tint: C.metal, lods: NEAR });
  for (const x of [-0.2, 0.9]) b.add('cyl', 'metal', [x, quay, 0.12], [0.13, 0.18, 0.13], { tint: C.metal, lods: NEAR });
  b.lamp(-1.3, 0.3, 1.75, 1.0, look.lamp, Math.PI / 2);
  // Boats moored in the basin: one at first, two once the dock is busy.
  {
    const boats = level >= 4 ? 2 : 1;
    for (let i = 0; i < boats; i += 1) {
      const bx = [0.15, 1.35][i]!;
      const bz = 1.15;
      b.add('box', 'plain', [bx, 0.06, bz], [0.5, 0.18, 1.3], { tint: scaled(C.pearl, 0.16), lods: NEAR | MID | FAR });
      b.add('wedge', 'plain', [bx, 0.06, bz + 0.65 + 0.15], [0.5, 0.18, 0.3], { tint: scaled(C.pearl, 0.16), turn: [0, Math.PI, 0], lods: NEAR | MID });
      b.add('box', 'graphite', [bx, 0.24, bz - 0.15], [0.36, 0.28, 0.5], { tint: C.graphite, power: 0.9, lods: NEAR | MID });
      b.light('box', [bx, 0.24, bz + 0.65], [0.08, 0.04, 0.08], look.lamp, 4, { motion: 'pulse', speed: 0.7, phase: i * 2, lods: NEAR });
      b.pool(bx, 0.1, bz, 1.2, look.lamp, 0.22);
    }
  }
  // Fees as light running along the quay.
  if (level >= 2) b.light('box', [0, quay, 0.04], [4.2, 0.035, 0.05], flow, 2.4, { motion: 'flow', speed: 0.6 });
  if (level >= 4) b.light('box', [-1.05, 0.3, 0.95], [0.035, 0.03, 1.8], flow, 2.4, { motion: 'flow', speed: 0.5, turn: [0, Math.PI / 2, 0] });
  if (look.signal === 'danger') {
    // Out of range: a red haze over the water.
    b.pool(0.4, 0.1, 1.1, 3.6, C.flare, 0.5, { motion: 'pulse', speed: 1 });
  } else {
    b.pool(0.6, 0.1, 1.2, 2.6, flow, 0.18);
  }
  // The warehouse at the back of the quay, left of the containers.
  const st = storeysOf('harbor', level, set);
  if (st.length) {
    const ww = pick(level, [0, 1.6, 1.8, 2.6, 3.0]);
    b.offset = [-0.55, 0, -1.2];
    const top = stack(b, st, { w: ww, d: 1.4, y: quay, door: true });
    doorway(b, quay, 0.7);
    roof(b, set.roof ?? (level >= 4 ? 'sawtooth' : 'roof.flat'), top);
    sign(b, set.sign, ww, 0.7, quay, top.y, -ww * 0.28);
    lanterns(b, set, ww, 0.7, quay);
    b.offset = [0, 0, 0];
  }
  // Containers stacked on the quay.
  const containers = pick(level, [0, 0, 2, 4, 6]);
  const tints = [scaled(C.violet, 0.22), scaled(C.amber, 0.24), C.steel, scaled(C.pearl, 0.2)];
  for (let i = 0; i < containers; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    b.add('box', 'steel', [1.95 - col * 0.42, quay + row * 0.4, -1.6], [0.95, 0.4, 0.38], {
      tint: tints[(i + Math.floor(look.random() * 4)) % 4]!,
      turn: [0, Math.PI / 2, 0],
      lods: NEAR | MID,
    });
  }
  // Cranes over the water.
  const cranes = pick(level, [0, 0, 1, 2, 2]);
  for (let i = 0; i < cranes; i += 1) {
    const x = [1.4, 0.25][i]!;
    const h = 3.3 + i * 0.3;
    b.add('box', 'metal', [x, quay, -0.25], [0.16, h, 0.16], { tint: C.metal });
    b.add('box', 'metal', [x, quay + h, 0.55], [0.12, 0.12, 2.5], { tint: C.metal });
    b.add('box', 'metal', [x, quay + h, -0.95], [0.12, 0.12, 0.8], { tint: C.metal, lods: NEAR | MID });
    b.add('box', 'stone', [x, quay + h - 0.08, -1.2], [0.3, 0.22, 0.3], { tint: C.stone, lods: NEAR });
    b.add('box', 'graphite', [x, quay + h - 0.34, -0.25], [0.32, 0.26, 0.32], { tint: C.graphite, power: 1, lods: NEAR });
    b.add('box', 'metal', [x, quay + h - 1.5, 1.6], [0.02, 1.5, 0.02], { tint: C.metal, lods: NEAR });
    b.add('box', 'steel', [x, quay + h - 1.65, 1.6], [0.36, 0.16, 0.3], { tint: scaled(C.amber, 0.3), lods: NEAR });
    b.light('sphere', [x, quay + h + 0.12, 1.75], [0.11, 0.11, 0.11], look.lamp, 5, { motion: 'blink', speed: 0.45, phase: i * 2 });
  }
  // The lighthouse at the mouth of the basin.
  if (level === 5) {
    b.add('cyl', 'ceramic', [-1.95, 0.1, 1.95], [0.42, 2.4, 0.42], { tint: scaled(C.pearl, 0.15), power: 0.4 });
    b.light('cyl', [-1.95, 2.5, 1.95], [0.44, 0.3, 0.44], look.lamp, 4, { motion: 'pulse', speed: 1.2, lods: ALL });
    b.add('cone', 'roof', [-1.95, 2.8, 1.95], [0.5, 0.36, 0.5], { tint: C.graphite });
    b.pool(-1.95, 0.1, 1.95, 2.2, look.lamp, 0.4);
  }
}

/** A roll-up door with a light strip above it, on a front face at `front`. */
function rollDoor(b: Builder, x: number, y: number, front: number, width: number): void {
  b.add('box', 'steel', [x, y, front + 0.015], [width, 0.74, 0.03], { tint: scaled(C.steel, 1.4), lods: NEAR | MID });
  b.light('box', [x, y + 0.8, front + 0.04], [width + 0.1, 0.035, 0.05], b.look.lamp, 2.6, { lods: NEAR | MID });
  b.pool(x, y, front + 0.55, width * 1.3, b.look.lamp, 0.45);
}

function workshop(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  if (level === 1) {
    // A workbench under an awning: a strategy starts on paper.
    const y0 = base(b, set, 2.0, 1.4);
    for (const x of [-0.95, 0.95]) b.add('cyl', 'metal', [x, y0, 0.55], [0.07, 1.3, 0.07], { tint: C.metal, lods: NEAR | MID });
    b.add('box', 'cloth', [0, y0 + 1.36, -0.05], [2.2, 0.04, 1.45], { tint: scaled(C.amber, 0.32), accent: look.accent, turn: [-0.22, 0, 0] });
    b.add('box', 'plain', [0, y0, -0.15], [1.3, 0.48, 0.55], { tint: C.steel });
    b.add('box', 'steel', [0, y0 + 0.48, -0.42], [1.3, 0.62, 0.06], { tint: scaled(C.steel, 0.8), lods: NEAR });
    b.add('quad', 'screen', [-0.25, y0 + 0.5, -0.05], [0.42, 0.26, 1], { glow: look.accent, power: 1.6, motion: 'ticker', speed: 0.4, turn: [-0.7, 0, 0], lods: NEAR | MID });
    b.light('sphere', [0.35, y0 + 1.05, -0.1], [0.14, 0.14, 0.14], look.lamp, 4.5, { motion: 'flicker', speed: 0.4 });
    b.pool(0.2, y0, 0.1, 2.2, look.lamp, 0.5);
    for (let i = 0; i < 3; i += 1) b.add('box', 'metal', [0.45 + i * 0.14, y0 + 0.48, -0.36], [0.04, 0.22 + i * 0.06, 0.04], { tint: C.metal, lods: NEAR });
    return;
  }
  const [w, d] = pick(level, [[0, 0], [2.4, 2.0], [3.0, 2.4], [3.4, 2.6], [4.0, 2.8]] as const);
  const y0 = base(b, set, w, d);
  const top = stack(b, storeysOf('workshop', level, set), { w, d, y: y0, door: false });
  rollDoor(b, level >= 4 ? -w * 0.2 : 0, y0, d / 2, Math.min(1.3, w * 0.45));
  if (level >= 4) rollDoor(b, w * 0.28, y0, d / 2, 0.9);
  const roofTop = roof(b, set.roof ?? (level >= 3 ? 'sawtooth' : 'roof.flat'), top);
  // The plate goes above the doors; at the top level the strategy's table runs on a screen higher up.
  sign(b, set.sign, w, d / 2, y0 + 0.3, top.y, level >= 4 ? w * 0.28 : 0);
  if (level === 5) sign(b, 'screen', w, d / 2, y0 + STOREY, top.y);
  if (level >= 3) b.add('cyl', 'metal', [-w * 0.32, roofTop, d * 0.1], [0.28, 0.45, 0.28], { tint: C.steel, lods: NEAR });
  // Chimneys with a glowing collar: the workshop is busy.
  const chimneys = level === 4 ? 1 : level === 5 ? 2 : 0;
  for (let i = 0; i < chimneys; i += 1) {
    const x = w / 2 - 0.4 - i * 0.7;
    const h = 2.2 + i * 0.4 + (top.y - y0);
    b.add('cyl', 'stone', [x, y0, -d / 2 + 0.35], [0.36, h, 0.36], { tint: C.stone });
    b.light('torus', [x, y0 + h - 0.12, -d / 2 + 0.35], [0.42, 1.6, 0.42], look.lamp, 3, { motion: 'pulse', speed: 0.7, phase: i });
  }
  // A conveyor of light along the front.
  if (level >= 4) b.light('box', [0, y0 + 0.02, d / 2 + 0.35], [w * 0.9, 0.03, 0.06], look.lamp, 2, { motion: 'flow', speed: 0.8, lods: NEAR });
  b.lamp(-w / 2 - 0.35, 0, d / 2 + 0.35, 1.1);
}

function crewHq(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const flagColor = look.signal === 'danger' ? scaled(C.flare, 0.5) : scaled(C.violet, 0.75);
  const flag = (x: number, y: number, z: number, mast: number, size: number) => {
    b.add('cyl', 'metal', [x, y, z], [0.06, mast, 0.06], { tint: C.metal });
    b.add('quad', 'cloth', [x + (size * 1.6) / 2 + 0.03, y + mast - size - 0.05, z], [size * 1.6, size, 1], { tint: flagColor, accent: C.warm, motion: 'wave', speed: 1.6, lods: NEAR | MID });
    b.light('sphere', [x, y + mast + 0.05, z], [0.09, 0.09, 0.09], look.lamp, 4, { motion: 'blink', speed: 0.4, lods: NEAR });
  };
  if (level === 1) {
    // A tent with a flag and a fire: the crew starts here.
    const y0 = base(b, set, 2.0, 2.0);
    b.add('pyramid', 'cloth', [0, y0, 0], [1.9, 1.45, 1.9], { tint: scaled(C.violet, 0.35), accent: look.accent });
    b.light('quad', [0, y0, 0.96], [0.42, 0.62, 1], look.lamp, 1.6, { lods: NEAR | MID });
    flag(1.1, y0, 0.75, 2.4, 0.4);
    b.light('sphere', [-0.85, y0, 1.0], [0.24, 0.24, 0.24], scaled(C.amber, 1.2), 3.2, { motion: 'flicker', speed: 1.4 });
    b.pool(-0.85, y0, 1.0, 1.6, look.lamp, 0.55, { motion: 'flicker', speed: 1.4 });
    return;
  }
  const [w, d] = pick(level, [[0, 0], [2.2, 2.0], [2.8, 2.4], [3.2, 2.8], [4.4, 2.6]] as const);
  const y0 = base(b, set, w, d);
  const top = stack(b, storeysOf('crew_hq', level, set), { w, d, y: y0 });
  doorway(b, y0, d / 2);
  if (level === 5) {
    // The street-wide HQ: a tower over its middle carries the crew's flag.
    const tower = stack(b, ['floor.glass', 'floor.glass'], { w: 1.4, d: 1.4, y: top.y, door: false });
    b.add('chamfer', 'roof', [0, top.y, 0], [w + 0.08, 0.1, d + 0.08], { tint: scaled(C.graphite, 0.6), kerb: true, lods: NEAR | MID });
    const tTop = roof(b, set.roof ?? 'roof.flat', tower);
    flag(0.45, tTop, 0, 1.8, 0.5);
  } else {
    const roofTop = roof(b, set.roof ?? (level === 2 ? 'gable' : 'roof.flat'), top);
    if (level === 2) flag(w / 2 + 0.4, 0, d / 2 + 0.3, 2.6, 0.4);
    else if (level === 3) flag(w / 2 - 0.35, roofTop, -d / 2 + 0.35, 1.5, 0.4);
  }
  if (level === 4) flag(-w / 2 - 0.45, set.base === 'base.basalt' ? 0.12 : 0, d / 2 + 0.45, 3.8, 0.6);
  // The crew's banners hang from the third level on; the sign module adds a plate by the door.
  if (level >= 3) sign(b, 'banner', w, d / 2, y0, top.y);
  sign(b, set.sign, w, d / 2, y0, top.y, w * 0.3);
  lanterns(b, set, w, d / 2, y0);
  b.lamp(Math.min(w / 2 + 0.4, LOT / 2 - 0.2), 0, d / 2 + 0.55, 1.15);
}

/** The agent: a small drone, parked or hovering. */
function drone(b: Builder, x: number, y: number, z: number, hover: boolean): void {
  const phase = b.look.random() * 6.283;
  const motion: Motion = hover ? 'hover' : 'none';
  b.add('sphere', 'metal', [x, y, z], [0.72, 0.24, 0.72], { tint: scaled(C.ice, 0.3), motion, phase, speed: 1 });
  b.add('box', 'metal', [x, y + 0.1, z], [1.3, 0.04, 0.08], { tint: C.metal, motion, phase, speed: 1, lods: NEAR | MID });
  b.add('box', 'metal', [x, y + 0.1, z], [0.08, 0.04, 1.3], { tint: C.metal, motion, phase, speed: 1, lods: NEAR | MID });
  b.light('torus', [x, y + 0.12, z], [1.15, 0.9, 1.15], b.look.accent, 3, { motion, phase, speed: 1 });
  b.light('sphere', [x, y + 0.04, z + 0.33], [0.1, 0.1, 0.1], C.ice, 5, { motion, phase, speed: 1, lods: NEAR });
}

function garage(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const [w, d] = pick(level, [[1.8, 2.0], [2.4, 2.2], [3.0, 2.2], [3.4, 2.6], [3.6, 2.8]] as const);
  const y0 = base(b, set, w, d);
  const top = stack(b, storeysOf('garage', level, set), { w, d, y: y0, door: false });
  const bays = level >= 3 ? 2 : 1;
  for (let i = 0; i < bays; i += 1) rollDoor(b, bays === 1 ? 0 : (i - 0.5) * w * 0.48, y0, d / 2, Math.min(1.1, w * (bays === 1 ? 0.6 : 0.36)));
  // The drone pad is the garage's own roof; a roof module takes its place and the drone takes to the air.
  const roofTop = roof(b, set.roof ?? (level >= 2 ? 'pad' : 'roof.flat'), top);
  if (level === 1) {
    // The agent before it has a budget: a small robot by the door.
    b.add('sphere', 'metal', [w / 2 + 0.4, 0, d / 2 + 0.45], [0.36, 0.42, 0.36], { tint: scaled(C.ice, 0.2), lods: NEAR | MID });
    b.light('box', [w / 2 + 0.4, 0.25, d / 2 + 0.63], [0.18, 0.04, 0.01], look.accent, 4, { motion: 'pulse', speed: 1.5, lods: NEAR });
  } else if (!set.roof && level < 4) {
    drone(b, 0, roofTop + 0.02, 0, false);
  } else {
    drone(b, 0, roofTop + 1.4, 0, true);
  }
  sign(b, set.sign, w, d / 2, y0 + 0.3, top.y, bays === 1 ? 0 : w * 0.24);
  if (level >= 3 && set.roof !== 'roof.antenna') {
    // An antenna mast: the agent's link.
    b.add('cyl', 'metal', [w / 2 - 0.25, roofTop, -d / 2 + 0.25], [0.05, 1.5, 0.05], { tint: C.metal });
    b.light('sphere', [w / 2 - 0.25, roofTop + 1.5, -d / 2 + 0.25], [0.1, 0.1, 0.1], look.lamp, 5, { motion: 'blink', speed: 0.6 });
  }
  if (level === 5) {
    // The control tower with its glass cab.
    const cx = -w / 2 + 0.45;
    const cz = -d / 2 + 0.45;
    b.add('cyl', 'graphite', [cx, top.y, cz], [0.62, 1.2, 0.62], { tint: C.graphite, power: 0.7 });
    b.add('cyl', 'glass', [cx, top.y + 1.2, cz], [0.82, 0.48, 0.82], { tint: scaled(C.graphite, 0.6), power: 0.9 });
    b.add('cyl', 'roof', [cx, top.y + 1.68, cz], [0.9, 0.08, 0.9], { tint: C.graphite, kerb: true, lods: NEAR | MID });
    b.light('box', [0, top.y + 0.14, d / 2 + 0.02], [w * 0.9, 0.04, 0.04], look.accent, 2.4, { motion: 'chase', speed: 1.6, lods: NEAR });
  }
  b.light('box', [-w / 2 + 0.2, y0 + 0.75, d / 2 + 0.02], [0.14, 0.05, 0.04], look.lamp, 3.2, { lods: NEAR });
}

function oracle(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const streak = look.signal === 'value' ? scaled(C.mint, 1.1) : look.signal === 'danger' ? C.flare : scaled(C.amber, 1.1);
  const board = (y: number, z: number, w: number, h: number) => {
    b.add('box', 'plain', [0, y - 0.06, z - 0.04], [w + 0.14, h + 0.12, 0.08], { tint: C.ink, lods: ALL });
    b.add('quad', 'screen', [0, y, z + 0.004], [w, h, 1], { glow: streak, accent: look.accent, power: 1.6, motion: 'board', speed: 0.35 });
  };
  if (level === 1) {
    // A stand with a small board: the prediction streak starts.
    const y0 = base(b, set, 1.2, 1.0);
    b.add('box', 'metal', [0, y0, 0], [0.12, 1.2, 0.12], { tint: C.metal });
    board(y0 + 1.1, 0.06, 0.86, 0.5);
    b.lamp(0.75, y0, 0.45, 0.9, look.lamp, Math.PI);
    return;
  }
  const width = pick(level, [0, 1.0, 1.1, 1.2, 1.3]);
  const y0 = base(b, set, width + 0.6, width + 0.6);
  const top = stack(b, storeysOf('oracle', level, set), { w: width, d: width, y: y0, shape: 'prism', grain: 0.5, door: level <= 2 });
  const span = top.y - y0;
  const bw = pick(level, [0, 1.2, 1.6, 1.8, 2.2]);
  const bh = pick(level, [0, 0.7, 0.9, 1.0, 1.1]);
  board(top.y - bh - 0.15, width / 2 + 0.1, bw, bh);
  const roofTop = roof(b, set.roof ?? (level >= 3 ? 'crown' : null), top);
  if (!set.roof && level < 3) b.light('sphere', [0, top.y, 0], [0.32, 0.32, 0.32], scaled(C.violet, 2.2), 1, { motion: 'pulse', speed: 1.2 });
  if (level >= 4) b.light('torus', [0, y0 + span * 0.45, 0], [width * 2.2, 1.2, width * 2.2], scaled(C.violet, 2.4), 1, { motion: 'spin', speed: 0.5, turn: [0.18, 0, 0] });
  if (level === 5) {
    b.light('torus', [0, y0 + span * 0.7, 0], [width * 1.8, 1.2, width * 1.8], scaled(C.warm, 2), 1, { motion: 'spin', speed: -0.7, turn: [-0.25, 0, 0.15] });
    const orb = scaled(look.signal === 'value' ? C.mint : C.violet, 2.6);
    b.light('sphere', [0, roofTop + 0.9, 0], [0.7, 0.7, 0.7], orb, 1, { motion: 'hover', speed: 0.8, lods: ALL });
    b.light('torus', [0, roofTop + 1.25, 0], [1.3, 1, 1.3], scaled(C.warm, 2), 1, { motion: 'hover', speed: 0.8 });
  }
  b.lamp(width / 2 + 0.7, y0, width / 2 + 0.6, 1.1, look.lamp, Math.PI * 1.25);
}

function showcase(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const [w, d] = pick(level, [[2.0, 1.8], [2.6, 2.2], [3.0, 2.4], [3.2, 2.8], [3.6, 3.0]] as const);
  const y0 = base(b, set, w, d);
  const shrink = level === 4 ? (i: number) => (i >= 2 ? 0.78 : 1) : undefined;
  const top = stack(b, storeysOf('showcase', level, set), { w, d, y: y0, ground: 'shop', shrink, door: false });
  doorway(b, y0, d / 2, -w * 0.32);
  // An awning over the display window.
  if (level <= 3) {
    b.add('box', 'cloth', [w * 0.08, y0 + 0.82, d / 2 + 0.26], [w * 0.7, 0.04, 0.55], { tint: scaled(C.amber, 0.38), accent: scaled(C.warm, 0.7), turn: [0.32, 0, 0], lods: NEAR | MID });
  }
  roof(b, set.roof ?? 'roof.flat', top);
  // The shop's own signs: a marquee over the window, a screen counting visitors higher up. The module adds its own.
  if (level >= 2 && level <= 3) sign(b, 'marquee', w, d / 2, y0 + 0.3, top.y);
  if (level >= 4) sign(b, 'screen', w, d / 2, y0, top.y);
  sign(b, set.sign, w, d / 2, y0 + (level >= 2 && level <= 3 ? 0.56 : 0), top.y, -w * 0.3);
  // Planters and uplights on the pavement.
  if (level >= 2) {
    for (const sx of [-1, 1]) b.add('box', 'foliage', [sx * (w / 2 + 0.05), 0, d / 2 + 0.55], [0.5, 0.36, 0.4], { tint: C.leaf, glow: look.lamp, lods: NEAR });
  }
  if (level === 5) {
    for (const sx of [-1, 1]) {
      b.light('cyl', [sx * (w / 2 + 0.45), 0.2, d / 2 + 0.55], [0.18, 0.08, 0.18], look.lamp, 4, { lods: NEAR });
      b.pool(sx * (w / 2 + 0.45), 0.2, d / 2 + 0.55, 1.4, look.lamp, 0.6);
    }
  }
  b.pool(w * 0.1, y0, d / 2 + 0.45, Math.min(w * 0.9, 2.4), look.window, 0.4);
}

function billboard(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const tag = (x: number, y: number, z: number) => b.light('quad', [x, y, z], [0.34, 0.07, 1], scaled(C.amber, 1.2), 2.2, { lods: NEAR });
  const face = (y: number, z: number, w: number, h: number, back = false) => {
    b.add('box', 'plain', [0, y - 0.06, z - (back ? -0.06 : 0.06)], [w + 0.14, h + 0.12, 0.1], { tint: C.ink, lods: ALL });
    const turn: Vec3 = back ? [0, Math.PI, 0] : [0, 0, 0];
    const fz = back ? z - 0.115 : z + 0.005;
    b.add('quad', 'screen', [0, y, fz], [w, h, 1], { glow: scaled(C.warm, 0.9), accent: look.accent, power: 1.5, motion: 'ad', speed: 0.3, turn });
    if (!back) tag(-w / 2 + 0.22, y + 0.06, fz + 0.004);
  };
  if (level === 1) {
    const y0 = base(b, set, 1.1, 0.6);
    b.add('box', 'metal', [0, y0, -0.08], [0.1, 1.3, 0.1], { tint: C.metal });
    face(y0 + 1.15, 0, 1.05, 0.62);
    b.light('box', [0, y0 + 1.87, 0.12], [0.5, 0.04, 0.07], look.lamp, 3, { lods: NEAR | MID });
    return;
  }
  const y0 = base(b, set, 2.4, 0.8);
  const st = storeysOf('billboard', level, set);
  const mast = 1.0 + st.length * 0.8;
  const [fw, fh] = pick(level, [[0, 0], [2.2, 1.1], [2.8, 1.4], [3.2, 1.6], [3.4, 2.2]] as const);
  if (level === 5) {
    // The mega screen: a slab tower that is mostly screen.
    const h = mast + fh + 0.4;
    b.add('chamfer', floorOf(st[0]).style === 'steel' ? 'graphite' : floorOf(st[0]).style, [0, y0, -0.2], [fw + 0.4, h, 0.7], { tint: C.graphite, grain: 0.5, power: 0.5 });
    b.add('quad', 'screen', [0, y0 + h - fh - 0.25, 0.155], [fw, fh, 1], { glow: scaled(C.warm, 0.9), accent: look.accent, power: 1.6, motion: 'ad', speed: 0.3 });
    tag(-fw / 2 + 0.22, y0 + h - fh - 0.19, 0.16);
    for (const sx of [-1, 1]) b.light('box', [sx * (fw / 2 + 0.2), y0, 0.16], [0.04, h, 0.04], look.accent, 2.4, { motion: 'chase', speed: 0.5 });
    b.light('box', [0, y0 + h, -0.2], [fw + 0.44, 0.05, 0.74], look.accent, 2.2, { lods: NEAR | MID });
    b.pool(0, y0, 0.9, 3, look.lamp, 0.35);
    return;
  }
  if (level === 4) {
    // A lattice tower with a board on each side.
    b.add('box', 'steel', [0, y0, 0], [0.45, mast, 0.45], { tint: C.steel });
    for (let i = 0; i < Math.floor(mast / 0.8); i += 1) {
      b.add('box', 'metal', [0, y0 + 0.4 + i * 0.8, 0.24], [0.04, 0.9, 0.04], { tint: C.metal, turn: [0, 0, i % 2 ? 0.55 : -0.55], lods: NEAR });
    }
    face(y0 + mast, 0.12, fw, fh);
    face(y0 + mast, -0.12, fw, fh, true);
  } else {
    for (const sx of [-1, 1]) b.add('box', 'metal', [sx * fw * 0.32, y0, -0.1], [0.1, mast, 0.1], { tint: C.metal });
    face(y0 + mast, 0, fw, fh);
    if (level === 3) b.add('box', 'metal', [0, y0 + mast - 0.1, 0.2], [fw, 0.04, 0.32], { tint: C.metal, lods: NEAR });
  }
  // Lamps that light the board from above.
  const lamps = level === 2 ? 2 : 3;
  for (let i = 0; i < lamps; i += 1) {
    const x = (i / (lamps - 1) - 0.5) * fw * 0.7;
    b.add('box', 'metal', [x, y0 + mast + fh + 0.02, 0.15], [0.03, 0.03, 0.3], { tint: C.metal, lods: NEAR });
    b.light('box', [x, y0 + mast + fh - 0.02, 0.32], [0.2, 0.05, 0.08], look.lamp, 3.4, { lods: NEAR | MID });
  }
  b.pool(0, y0, 0.7, fw, look.lamp, 0.3);
}

function decor(b: Builder, level: Level, set: ModuleSet): void {
  const look = b.look;
  const stone = mix(C.stone, C.graphite, 0.25);
  const outer = set.base === 'base.basalt' ? 0.12 : 0;
  if (level === 1) {
    b.add('chamfer', 'stone', [0, 0, 0], [2.2, 0.12, 1.2], { tint: stone, kerb: true, power: 0.9 });
    b.lamp(-0.6, 0.12, 0, 1.2, look.lamp, Math.PI / 2);
    b.add('box', 'plain', [0.35, 0.36, 0], [0.95, 0.06, 0.34], { tint: scaled(C.steel, 1.2), lods: NEAR | MID });
    for (const sx of [-1, 1]) b.add('box', 'metal', [0.35 + sx * 0.38, 0.12, 0], [0.06, 0.24, 0.3], { tint: C.metal, lods: NEAR });
    return;
  }
  if (level === 2) {
    const y0 = base(b, set, 1.8, 1.0);
    for (const sx of [-1, 1]) b.lamp(sx * 0.92, y0, -0.15, 1.3, look.lamp, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    b.add('box', 'stone', [0, 0.2, -0.1], [0.9, 0.36, 0.45], { tint: C.stone, kerb: true, lods: NEAR | MID | FAR });
    b.add('box', 'foliage', [0, 0.56, -0.1], [0.82, 0.18, 0.38], { tint: C.leaf, glow: look.lamp, lods: NEAR | MID });
    for (const sx of [-1, 1]) b.bollard(sx * 0.6, 0.2, 0.55);
    return;
  }
  if (level === 3) {
    // A fountain: a basin, a column and a jet of light.
    b.add('cyl', 'stone', [0, 0, 0], [2.6, 0.3, 2.6], { tint: stone, kerb: true, power: 0.9 });
    b.add('cyl', 'water', [0, 0, 0], [2.3, 0.26, 2.3], { tint: C.water, glow: look.lamp, lods: NEAR | MID });
    b.add('cyl', 'stone', [0, 0.26, 0], [0.4, 0.5, 0.4], { tint: C.stone });
    b.light('cyl', [0, 0.76, 0], [0.07, 1.1, 0.07], look.lamp, 3.2, { motion: 'pulse', speed: 2.4 });
    b.light('sphere', [0, 1.7, 0], [0.32, 0.32, 0.32], look.lamp, 2.2, { motion: 'pulse', speed: 2.4, phase: 1.5 });
    b.pool(0, 0.26, 0, 2.2, look.lamp, 0.4, { motion: 'pulse', speed: 2.4 });
    for (const sx of [-1, 1]) b.lamp(sx * 1.75, 0, 0.9, 1.2, look.lamp, Math.PI);
    return;
  }
  if (level === 4) {
    // A light arch over the street with lamps on each side.
    base(b, set, 3.2, 1.0);
    for (const sx of [-1, 1]) b.add('chamfer', 'stone', [sx * 1.45, 0.2, 0], [0.32, 2.3, 0.32], { tint: C.stone, kerb: true });
    const segments = 9;
    const r = 1.45;
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI;
      const a1 = ((i + 1) / segments) * Math.PI;
      const am = (a0 + a1) / 2;
      const len = 2 * r * Math.sin((a1 - a0) / 2) + 0.02;
      b.light('box', [-Math.cos(am) * r, 2.5 + Math.sin(am) * r - 0.04, 0], [len, 0.08, 0.08], i % 2 ? look.accent : look.lamp, 2.8, {
        turn: [0, 0, Math.PI / 2 - am],
        motion: 'chase',
        speed: 0.8,
        lods: ALL,
      });
    }
    // Lamps stand on the plaza's outer ring, or on the street beside a plain plinth.
    for (const sx of [-1, 1]) b.lamp(sx * 2.1, outer, 0.45, 1.1, look.lamp, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    b.pool(0, 0.2, 0, 3, look.lamp, 0.4);
    return;
  }
  // The Eclipse: a black disc in a violet corona with its diamond point, the city's mark in your street.
  const y0 = base(b, set, 2.8, 1.4);
  b.add('chamfer', 'stone', [0, y0, 0], [1.6, 0.7, 0.9], { tint: C.stone, kerb: true });
  const ring = 3.1;
  const cy = y0 + 0.7 + ring / 2 + 0.1;
  b.add('cyl', 'plain', [0, cy, -0.06], [ring * 0.86, 0.1, ring * 0.86], { tint: C.ink, turn: [Math.PI / 2, 0, 0] });
  b.light('torus', [0, cy, 0], [ring, 2.4, ring], scaled(C.violet, 2.6), 1, { turn: [Math.PI / 2, 0, 0], motion: 'pulse', speed: 0.9, lods: ALL });
  b.light('torus', [0, cy, -0.03], [ring * 1.14, 0.7, ring * 1.14], scaled(mix(C.violet, C.warm, 0.4), 1.4), 1, { turn: [Math.PI / 2, 0, 0], motion: 'pulse', speed: 0.9, phase: 0.6 });
  const rim = ring * 0.45;
  b.light('sphere', [Math.cos(0.78) * rim, cy + Math.sin(0.78) * rim - 0.15, 0.04], [0.3, 0.3, 0.3], scaled(C.warm, 6), 1, { motion: 'pulse', speed: 0.5 });
  for (const sx of [-1, 1]) b.lamp(sx * 1.85, outer, 0.9, 1.15, look.lamp, Math.PI);
  b.pool(0, 0.2, 0.4, 3.2, scaled(C.violet, 1.2), 0.5);
}

const KINDS: Record<BuildingKind, (b: Builder, level: Level, set: ModuleSet) => void> = {
  home,
  coin_tower: coinTower,
  harbor,
  workshop,
  crew_hq: crewHq,
  garage,
  oracle,
  showcase,
  billboard,
  decor,
};

/**
 * The parts of one building. Any module list is accepted: what does not fit is dropped and the level's defaults fill
 * the gaps (normalizeModules), so a bad record never breaks the street.
 */
export function planBuilding(kind: BuildingKind, level: Level, modules: readonly string[] = [], options: BuildOptions = {}): BuildingPlan {
  const set = normalizeModules(kind, level, modules);
  const signal = options.signal ?? null;
  const random = rng(hash(`${kind}|${level}|${moduleList(set).join(',')}`) ^ Math.floor((options.seed ?? 0) * 2654435761));
  const light = LIGHTS[set.light] ?? LIGHTS['light.amber']!;
  const look: Look = {
    window: light.window,
    accent: signal === 'value' ? scaled(C.mint, 1.2) : signal === 'danger' ? C.flare : light.accent,
    lamp: light.lamp,
    launch: scaled(C.mint, 1.2),
    signal,
    random,
    power: 0,
  };
  look.power = windowPower(level, random);
  const b = new Builder(look);
  KINDS[kind](b, level, set);
  return planOf(b.parts);
}
