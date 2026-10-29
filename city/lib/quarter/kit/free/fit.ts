import { PIECES, type Piece } from '../../../../../lib/world/layout.ts';
import { LIGHTS } from '../blueprint.ts';
import { ALL, C, linear, mix, MID, NEAR, planOf, scaled, type BuildingPlan, type Motion, type Part, type Rgb, type Shape, type Style, type Vec3 } from '../parts.ts';
import { CELL, STOREY_H, SIDES, pieceAt, pieceCentre, samePlot } from './grid.ts';

/**
 * A free layout drawn as one list of the kit's parts, in the lot's frame: every piece looks at its neighbours, the way
 * Townscaper's tiles do. Blocks side by side become one house — their walls meet, the roof runs along the row, a
 * house open on both axes gets a flat roof with a lit edge; whatever stands on a block gives it a flat top; a door
 * opens only on a free side; hedges join into a line, a lone one is a bush; paths join into paving. All of it shares
 * the kit's instanced draws, so a full quarter costs no more draw calls than one building.
 */

const LOOK = LIGHTS['light.amber']!;
const WOOD = linear('#3A2618');
const BLOCK_TINTS: readonly Rgb[] = [C.graphite, mix(C.graphite, linear('#3E2420'), 0.6), mix(C.graphite, C.metal, 0.4), mix(C.graphite, C.violet, 0.12)];
/** How far a lone wall stands in from its cell's edge; neighbours close the gap. */
const INSET = 0.07;

type Opts = Partial<Omit<Part, 'shape' | 'style' | 'at' | 'size'>>;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

class Parts {
  readonly list: Part[] = [];
  /** Where the plan's own origin stands in the lot's frame: parts are written relative to it. */
  readonly origin: { x: number; z: number };
  constructor(origin: { x: number; z: number }) {
    this.origin = origin;
  }
  add(shape: Shape, style: Style, at: Vec3, size: Vec3, o: Opts = {}): void {
    this.list.push({
      shape,
      style,
      at: [at[0] - this.origin.x, at[1], at[2] - this.origin.z],
      size,
      turn: [0, 0, 0],
      tint: C.graphite,
      glow: LOOK.window,
      accent: LOOK.accent,
      power: 0.5,
      grain: 1,
      motion: 'none',
      speed: 1,
      phase: 0,
      door: false,
      kerb: false,
      lods: ALL,
      ...o,
    });
  }
  light(shape: Shape, at: Vec3, size: Vec3, color: Rgb, power = 3, o: Opts = {}): void {
    this.add(shape, 'light', at, size, { glow: color, power, lods: NEAR | MID, ...o });
  }
  pool(x: number, y: number, z: number, d: number, color: Rgb, power = 0.5, motion: Motion = 'none'): void {
    this.add('disc', 'pool', [x, y + 0.015, z], [d, 1, d], { glow: color, power, lods: NEAR | MID, motion });
  }
}

/** Turn a direction of the grid into the lot's frame: +gx is +x, +gz is −z. */
const sideVec = (rot: number) => ({ x: SIDES[rot]!.dx, z: -SIDES[rot]!.dz });

/** The neighbours of a piece at its own storey, in the same plot, by side (0 street, 1 right, 2 back, 3 left). */
function around(pieces: readonly Piece[], p: Piece): (Piece | null)[] {
  return SIDES.map((s) => {
    const cell = { gx: p.gx + s.dx, gz: p.gz + s.dz };
    return samePlot(p, cell) ? pieceAt(pieces, cell.gx, cell.gz, p.y) : null;
  });
}

const isHouse = (p: Piece | null) => !!p && (p.kind === 'block' || p.kind === 'glass' || p.kind === 'arch');

/** The box of a house piece: out to the cell's edge where a house stands next to it, a little in where none does. */
function span(c: { x: number; z: number }, n: (Piece | null)[], inset = INSET) {
  const half = CELL / 2;
  const x0 = c.x - half + (isHouse(n[3]!) ? 0 : inset);
  const x1 = c.x + half - (isHouse(n[1]!) ? 0 : inset);
  // Side 0 is toward the street, which is +z.
  const z1 = c.z + half - (isHouse(n[0]!) ? 0 : inset);
  const z0 = c.z - half + (isHouse(n[2]!) ? 0 : inset);
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

/** What stands on a piece, if anything. */
const above = (pieces: readonly Piece[], p: Piece) => pieceAt(pieces, p.gx, p.gz, p.y + 1);

function roofOf(b: Parts, pieces: readonly Piece[], p: Piece, box: { x: number; z: number; w: number; d: number }, top: number, n: (Piece | null)[], seed: number): void {
  const up = above(pieces, p);
  if (up && PIECES[up.kind].carries) return;
  const alongX = isHouse(n[1]!) || isHouse(n[3]!);
  const alongZ = isHouse(n[0]!) || isHouse(n[2]!);
  if (up || p.kind === 'glass' || (alongX && alongZ)) {
    // A flat top: something stands on it, the house is glass, or it spreads both ways. Its edge is lit.
    b.add('box', 'roof', [box.x, top, box.z], [box.w + 0.04, 0.06, box.d + 0.04], { tint: scaled(C.graphite, 0.7), kerb: true, accent: LOOK.accent, power: 0.7 });
    if (!up && seed > 0.55) b.add('box', 'foliage', [box.x, top + 0.06, box.z], [box.w * 0.5, 0.1, box.d * 0.5], { tint: C.leaf, glow: LOOK.lamp, lods: NEAR | MID });
    return;
  }
  // A pitched roof along the row; a lone house turns it by its own turn.
  const ridgeX = alongX || (!alongZ && p.rot % 2 === 1);
  const rise = 0.42;
  const tint = scaled(C.graphite, 0.62);
  if (ridgeX) b.add('gable', 'roof', [box.x, top, box.z], [box.d + 0.1, rise, box.w + 0.1], { turn: [0, Math.PI / 2, 0], tint, kerb: true, accent: LOOK.accent, power: 0.55 });
  else b.add('gable', 'roof', [box.x, top, box.z], [box.w + 0.1, rise, box.d + 0.1], { tint, kerb: true, accent: LOOK.accent, power: 0.55 });
}

/** A lit door on the piece's front, when nothing stands against it. */
function door(b: Parts, c: { x: number; z: number }, half: number, rot: number, y: number): void {
  const v = sideVec(rot);
  const fx = c.x + v.x * (half + 0.01);
  const fz = c.z + v.z * (half + 0.01);
  const across = v.x === 0;
  b.light('box', [fx, y, fz], across ? [0.22, 0.38, 0.02] : [0.02, 0.38, 0.22], mix(LOOK.lamp, C.warm, 0.4), 2.2, { lods: NEAR | MID });
  b.add('box', 'plain', [fx + v.x * 0.06, y + 0.42, fz + v.z * 0.06], across ? [0.34, 0.03, 0.12] : [0.12, 0.03, 0.34], { tint: scaled(C.graphite, 0.8), lods: NEAR });
  b.pool(fx + v.x * 0.3, y, fz + v.z * 0.3, 0.8, LOOK.lamp, 0.35);
}

function house(b: Parts, pieces: readonly Piece[], p: Piece, seed: number): void {
  const n = around(pieces, p);
  const c = pieceCentre(p);
  const y = p.y * STOREY_H;
  const box = span(c, n);
  const glass = p.kind === 'glass';
  const tint = glass ? scaled(C.graphite, 0.7) : BLOCK_TINTS[Math.floor(seed * BLOCK_TINTS.length)]!;
  // Some windows lit, never all: a warm night, as the kit's own houses.
  const power = glass ? 0.12 + seed * 0.12 : 0.18 + seed * 0.3;
  if (p.kind === 'arch') {
    // An arch: two piers and a lintel; the way through runs along its turn.
    const throughZ = p.rot % 2 === 0;
    const pier = 0.2;
    const lintel = 0.24;
    for (const s of [-1, 1]) {
      const at: Vec3 = throughZ ? [box.x + s * (box.w / 2 - pier / 2), y, box.z] : [box.x, y, box.z + s * (box.d / 2 - pier / 2)];
      b.add('box', 'stone', at, throughZ ? [pier, STOREY_H - lintel, box.d] : [box.w, STOREY_H - lintel, pier], { tint: mix(C.stone, C.graphite, 0.4), kerb: true });
    }
    b.add('box', 'graphite', [box.x, y + STOREY_H - lintel, box.z], [box.w, lintel, box.d], { tint, power, grain: 0.5 });
    b.light('sphere', [box.x, y + STOREY_H - lintel - 0.08, box.z], [0.1, 0.1, 0.1], LOOK.lamp, 3.2, { motion: 'flicker', speed: 0.3 });
    if (p.y === 0) b.pool(box.x, 0, box.z, 0.9, LOOK.lamp, 0.4);
  } else {
    const below = p.y > 0 ? pieceAt(pieces, p.gx, p.gz, p.y - 1) : null;
    // A ledge where a storey sits on another: the stack reads as floors, not one block.
    if (below && isHouse(below)) b.add('box', 'stone', [box.x, y - 0.025, box.z], [box.w + 0.05, 0.05, box.d + 0.05], { tint: scaled(C.graphite, 0.55), lods: NEAR | MID });
    b.add('box', glass ? 'glass' : 'graphite', [box.x, y, box.z], [box.w, STOREY_H, box.d], { tint, power, grain: 1, kerb: glass });
    if (p.y === 0 && !n[p.rot]) door(b, box, (p.rot % 2 === 0 ? box.d : box.w) / 2, p.rot, 0);
  }
  roofOf(b, pieces, p, box, y + STOREY_H, n, seed);
}

function turret(b: Parts, p: Piece, seed: number): void {
  const c = pieceCentre(p);
  const y = p.y * STOREY_H;
  b.add('cyl', 'ceramic', [c.x, y, c.z], [0.5, 0.72, 0.5], { tint: mix(C.graphite, linear('#3E2420'), 0.5), power: 0.6 + seed * 0.3, grain: 0.5 });
  b.add('cone', 'roof', [c.x, y + 0.72, c.z], [0.62, 0.5, 0.62], { tint: scaled(C.graphite, 0.62), kerb: true, accent: LOOK.accent, power: 0.55 });
  b.light('sphere', [c.x, y + 1.24, c.z], [0.07, 0.07, 0.07], C.amber, 4, { motion: 'blink', speed: 0.5, phase: seed * 6 });
}

function path(b: Parts, pieces: readonly Piece[], p: Piece): void {
  const c = pieceCentre(p);
  const stone = mix(C.stone, C.graphite, 0.35);
  b.add('box', 'stone', [c.x, 0, c.z], [0.8, 0.05, 0.8], { tint: stone, grain: 0.1 });
  // Paving reaches each path beside it, so a row of paths reads as one walk.
  around(pieces, p).forEach((q, side) => {
    if (q?.kind !== 'path') return;
    const v = sideVec(side);
    b.add('box', 'stone', [c.x + v.x * 0.45, 0, c.z + v.z * 0.45], v.x === 0 ? [0.8, 0.05, 0.1] : [0.1, 0.05, 0.8], { tint: stone, grain: 0.1, lods: NEAR | MID });
  });
}

function hedge(b: Parts, pieces: readonly Piece[], p: Piece): void {
  const c = pieceCentre(p);
  const n = around(pieces, p);
  const look = { tint: C.leaf, glow: scaled(LOOK.lamp, 0.6), power: 0.4 };
  if (!n.some((q) => q?.kind === 'hedge')) {
    b.add('sphere', 'foliage', [c.x, 0, c.z], [0.62, 0.5, 0.62], look);
    return;
  }
  b.add('box', 'foliage', [c.x, 0, c.z], [0.34, 0.44, 0.34], look);
  n.forEach((q, side) => {
    if (q?.kind !== 'hedge') return;
    const v = sideVec(side);
    b.add('box', 'foliage', [c.x + v.x * 0.25, 0, c.z + v.z * 0.25], v.x === 0 ? [0.34, 0.44, 0.5] : [0.5, 0.44, 0.34], look);
  });
}

function tree(b: Parts, p: Piece, seed: number): void {
  const c = pieceCentre(p);
  const y = p.y * STOREY_H;
  const k = p.y > 0 ? 0.75 : 1;
  b.add('cyl', 'plain', [c.x, y, c.z], [0.08 * k, 0.36 * k, 0.08 * k], { tint: WOOD, lods: NEAR | MID });
  const look = { tint: C.leaf, glow: scaled(LOOK.lamp, 0.5), power: 0.35 };
  if (seed > 0.5) {
    b.add('cone', 'foliage', [c.x, y + 0.24 * k, c.z], [0.6 * k, 0.9 * k, 0.6 * k], look);
  } else {
    b.add('sphere', 'foliage', [c.x, y + 0.28 * k, c.z], [0.66 * k, 0.6 * k, 0.66 * k], look);
    b.add('sphere', 'foliage', [c.x + 0.08, y + 0.62 * k, c.z - 0.05], [0.4 * k, 0.36 * k, 0.4 * k], { ...look, lods: NEAR | MID });
  }
}

function lamp(b: Parts, p: Piece, seed: number): void {
  const c = pieceCentre(p);
  const y = p.y * STOREY_H;
  b.add('cyl', 'metal', [c.x, y, c.z], [0.06, 0.82, 0.06], { tint: C.metal, lods: NEAR | MID });
  b.light('sphere', [c.x, y + 0.8, c.z], [0.16, 0.16, 0.16], LOOK.lamp, 4.2, { motion: 'flicker', speed: 0.3, phase: seed * 6 });
  b.pool(c.x, y, c.z, 1.4, LOOK.lamp, 0.5);
}

function fountain(b: Parts, p: Piece): void {
  const c = pieceCentre(p);
  const stone = mix(C.stone, C.graphite, 0.25);
  b.add('cyl', 'stone', [c.x, 0, c.z], [0.86, 0.2, 0.86], { tint: stone, kerb: true, power: 0.8 });
  b.add('cyl', 'water', [c.x, 0, c.z], [0.74, 0.18, 0.74], { tint: C.water, glow: LOOK.lamp, lods: NEAR | MID });
  b.add('cyl', 'stone', [c.x, 0.18, c.z], [0.14, 0.22, 0.14], { tint: C.stone, lods: NEAR | MID });
  b.light('cyl', [c.x, 0.4, c.z], [0.04, 0.42, 0.04], LOOK.lamp, 3, { motion: 'pulse', speed: 2.4 });
  b.pool(c.x, 0.18, c.z, 0.8, LOOK.lamp, 0.35, 'pulse');
}

function sign(b: Parts, p: Piece): void {
  const c = pieceCentre(p);
  const y = p.y * STOREY_H;
  const v = sideVec(p.rot);
  const across = v.x === 0;
  for (const s of [-1, 1]) b.add('cyl', 'metal', [c.x + (across ? s * 0.3 : 0), y, c.z + (across ? 0 : s * 0.3)], [0.04, 0.66, 0.04], { tint: C.metal, lods: NEAR | MID });
  b.add('box', 'plain', [c.x, y + 0.3, c.z], across ? [0.76, 0.34, 0.05] : [0.05, 0.34, 0.76], { tint: scaled(C.ink, 1.4), kerb: true, accent: LOOK.accent, power: 0.9 });
  // The words go on a plane in front of the board (`FreeLayout`); a lit bar marks the board from afar.
  b.light('box', [c.x + v.x * 0.03, y + 0.66, c.z + v.z * 0.03], across ? [0.76, 0.025, 0.02] : [0.02, 0.025, 0.76], LOOK.accent, 2.4, { lods: ALL });
}

/** The arcade: a low hall with a screen for a front and a neon edge. */
function arcade(b: Parts, p: Piece): void {
  const c = pieceCentre(p);
  const v = sideVec(p.rot);
  const across = v.x === 0;
  const w = 1.72;
  const d = 1.4;
  const [sx, sz] = across ? [w, d] : [d, w];
  b.add('chamfer', 'stone', [c.x, 0, c.z], [sx + 0.16, 0.1, sz + 0.16], { tint: mix(C.stone, C.graphite, 0.3), kerb: true, accent: scaled(C.violet, 1.6) });
  b.add('box', 'graphite', [c.x, 0.1, c.z], [sx, 0.9, sz], { tint: scaled(C.graphite, 0.9), power: 0.4, grain: 0.5 });
  const front = (across ? sz : sx) / 2 + 0.012;
  b.add('quad', 'screen', [c.x + v.x * front, 0.22, c.z + v.z * front], [across ? w * 0.86 : 1, 0.62, 1], {
    turn: [0, p.rot === 0 ? 0 : p.rot === 1 ? Math.PI / 2 : p.rot === 2 ? Math.PI : -Math.PI / 2, 0],
    glow: scaled(C.violet, 1.2),
    accent: LOOK.accent,
    power: 1.1,
    motion: 'ad',
    speed: 0.6,
  });
  b.light('box', [c.x, 1.0, c.z], [sx + 0.02, 0.03, sz + 0.02], scaled(C.violet, 1.8), 2.6, { motion: 'chase', speed: 0.6, lods: ALL });
  b.add('box', 'roof', [c.x, 1.0, c.z], [sx, 0.06, sz], { tint: scaled(C.graphite, 0.6) });
  b.pool(c.x + v.x * (front + 0.4), 0, c.z + v.z * (front + 0.4), 1.4, scaled(C.violet, 1.3), 0.45);
}

/** The vault house: a steel hall with a round vault door and a dome, the guard's house of the Safe. */
function vaultHouse(b: Parts, p: Piece): void {
  const c = pieceCentre(p);
  const v = sideVec(p.rot);
  const s = 1.56;
  b.add('chamfer', 'stone', [c.x, 0, c.z], [s + 0.24, 0.12, s + 0.24], { tint: mix(C.stone, C.graphite, 0.3), kerb: true });
  b.add('chamfer', 'steel', [c.x, 0.12, c.z], [s, 0.96, s], { tint: C.steel, kerb: true, power: 0.5 });
  b.add('dome', 'metal', [c.x, 1.08, c.z], [0.9, 0.4, 0.9], { tint: C.metal });
  const front = s / 2 + 0.03;
  const turn: Vec3 = [Math.PI / 2, 0, 0];
  b.add('cyl', 'metal', [c.x + v.x * front, 0.58, c.z + v.z * front], [0.66, 0.06, 0.66], { tint: scaled(C.metal, 1.3), turn: v.x === 0 ? turn : [0, 0, Math.PI / 2] });
  b.light('torus', [c.x + v.x * (front + 0.04), 0.58, c.z + v.z * (front + 0.04)], [0.72, 1.2, 0.72], C.amber, 2.4, { turn: v.x === 0 ? turn : [0, 0, Math.PI / 2], motion: 'pulse', speed: 0.7, lods: ALL });
  for (const k of [-1, 1]) {
    const ox = v.x === 0 ? k * 0.62 : v.x * (front + 0.3);
    const oz = v.x === 0 ? v.z * (front + 0.3) : k * 0.62;
    b.add('cyl', 'metal', [c.x + ox, 0.12, c.z + oz], [0.09, 0.26, 0.09], { tint: C.metal, lods: NEAR });
    b.light('cyl', [c.x + ox, 0.38, c.z + oz], [0.1, 0.05, 0.1], LOOK.lamp, 3.2, { lods: NEAR });
  }
  b.pool(c.x + v.x * (front + 0.4), 0.12, c.z + v.z * (front + 0.4), 1.3, C.amber, 0.4);
}

/** The mini ring: a lit square of ropes on a plinth, where agents meet. */
function miniRing(b: Parts, p: Piece): void {
  const c = pieceCentre(p);
  const s = 1.64;
  const h = 0.26;
  b.add('chamfer', 'stone', [c.x, 0, c.z], [s + 0.2, h, s + 0.2], { tint: mix(C.stone, C.graphite, 0.3), kerb: true, accent: LOOK.accent });
  b.add('box', 'plain', [c.x, h, c.z], [s, 0.02, s], { tint: scaled(C.ink, 1.6) });
  const r = s / 2 - 0.06;
  for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    b.add('cyl', 'metal', [c.x + ox * r, h, c.z + oz * r], [0.07, 0.56, 0.07], { tint: C.metal });
    b.light('sphere', [c.x + ox * r, h + 0.58, c.z + oz * r], [0.08, 0.08, 0.08], ox * oz > 0 ? C.amber : scaled(C.violet, 1.6), 3.6, { lods: NEAR | MID });
  }
  for (const level of [0.2, 0.36, 0.52]) {
    const color = level === 0.36 ? scaled(C.violet, 1.6) : C.amber;
    for (const k of [-1, 1]) {
      b.light('box', [c.x, h + level, c.z + k * r], [s - 0.12, 0.018, 0.018], color, 2.2, { lods: level === 0.36 ? ALL : NEAR | MID });
      b.light('box', [c.x + k * r, h + level, c.z], [0.018, 0.018, s - 0.12], color, 2.2, { lods: level === 0.36 ? ALL : NEAR | MID });
    }
  }
  b.pool(c.x, h, c.z, 1.6, mix(C.amber, C.violet, 0.4), 0.5, 'pulse');
}

/**
 * Pieces of a layout, fitted to their neighbours, as one plan of the kit. `pieces` is everything on the lot (the
 * neighbours a piece looks at); `only` picks the ones to draw; `origin` is the point of the lot's frame the plan
 * stands on — a plot's centre, so the kit spreads the plot's pieces about it from afar as it does its building.
 */
export function planLayout(pieces: readonly Piece[], options: { seed?: string; only?: (p: Piece) => boolean; origin?: { x: number; z: number } } = {}): BuildingPlan {
  const b = new Parts(options.origin ?? { x: 0, z: 0 });
  const seed = options.seed ?? '';
  for (const p of pieces) {
    if (options.only && !options.only(p)) continue;
    const s = hash(`${seed}:${p.gx}:${p.gz}:${p.y}`);
    switch (p.kind) {
      case 'block':
      case 'glass':
      case 'arch':
        house(b, pieces, p, s);
        break;
      case 'turret':
        turret(b, p, s);
        break;
      case 'path':
        path(b, pieces, p);
        break;
      case 'hedge':
        hedge(b, pieces, p);
        break;
      case 'tree':
        tree(b, p, s);
        break;
      case 'lamp':
        lamp(b, p, s);
        break;
      case 'fountain':
        fountain(b, p);
        break;
      case 'sign':
        sign(b, p);
        break;
      case 'arcade':
        arcade(b, p);
        break;
      case 'vault_house':
        vaultHouse(b, p);
        break;
      case 'mini_ring':
        miniRing(b, p);
        break;
    }
  }
  return planOf(b.list);
}

/** Where a sign's words stand: just in front of its board, facing out, in the lot's frame. */
export function signFace(p: Piece): { x: number; y: number; z: number; turn: number } {
  const c = pieceCentre(p);
  const v = sideVec(p.rot);
  const off = 0.035;
  return { x: c.x + v.x * off, y: p.y * STOREY_H + 0.47, z: c.z + v.z * off, turn: [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.rot]! };
}
