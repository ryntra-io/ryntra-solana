import { CELLS_PER_PLOT, GRID_D, GRID_W, MAX_STACK, PIECES, footprint, slotOfCell, type Piece } from '../../../../../lib/world/layout.ts';
import { DEEP, PATH, PLOT, WIDE, type Lot } from '../../plot.ts';

/**
 * The free layout's grid on the lot, in the lot's own frame: x across from the left as seen from the street, z toward
 * the street, y up from the terrace. A plot of the quarter is three cells across; the cells of one plot touch, the
 * path between plots stays a path. `toLocal` and `toWorld` turn the world's points into the lot's frame and back,
 * whichever way the lot faces. Plain numbers only, so the snapping is tested without a canvas.
 */

/** One cell, a third of a plot. */
export const CELL = PLOT / CELLS_PER_PLOT;
/** One storey of the free pieces. */
export const STOREY_H = 0.8;
const STEP = PLOT + PATH;

export type V3 = { x: number; y: number; z: number };

/** The centre of a cell in the lot's frame. */
export function cellCentre(gx: number, gz: number): { x: number; z: number } {
  const col = Math.floor(gx / CELLS_PER_PLOT);
  const row = Math.floor(gz / CELLS_PER_PLOT);
  const i = gx - col * CELLS_PER_PLOT;
  const j = gz - row * CELLS_PER_PLOT;
  return {
    x: (col - (WIDE - 1) / 2) * STEP + (i - 1) * CELL,
    z: ((DEEP - 1) / 2 - row) * STEP - (j - 1) * CELL,
  };
}

/** The centre of a plot (the world's slot) in the lot's frame. */
export function plotOrigin(slot: number): { x: number; z: number } {
  const col = slot % WIDE;
  const row = Math.floor(slot / WIDE);
  return { x: (col - (WIDE - 1) / 2) * STEP, z: ((DEEP - 1) / 2 - row) * STEP };
}

/** The centre of a piece on the ground: its cell, or the middle of its four for a game building. */
export function pieceCentre(p: Pick<Piece, 'gx' | 'gz' | 'kind'>): { x: number; z: number } {
  const a = cellCentre(p.gx, p.gz);
  if (PIECES[p.kind].size === 1) return a;
  const b = cellCentre(p.gx + 1, p.gz + 1);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/** A point of the world in the lot's frame. */
export const toLocal = (lot: Lot, p: V3, ground: number): V3 => ({ x: (p.x - lot.x) * lot.facing, y: p.y - ground, z: (p.z - lot.z) * lot.facing });
/** A direction of the world in the lot's frame. */
export const dirToLocal = (lot: Lot, d: V3): V3 => ({ x: d.x * lot.facing, y: d.y, z: d.z * lot.facing });
/** A point of the lot's frame in the world. */
export const toWorld = (lot: Lot, p: V3, ground: number): V3 => ({ x: lot.x + p.x * lot.facing, y: p.y + ground, z: lot.z + p.z * lot.facing });

/** The cell under a point of the lot's ground, or null on a path between plots or off the lot. */
export function cellAt(x: number, z: number): { gx: number; gz: number } | null {
  const col = Math.round(x / STEP + (WIDE - 1) / 2);
  const row = Math.round((DEEP - 1) / 2 - z / STEP);
  if (col < 0 || col >= WIDE || row < 0 || row >= DEEP) return null;
  const dx = x - (col - (WIDE - 1) / 2) * STEP;
  const dz = ((DEEP - 1) / 2 - row) * STEP - z;
  // A touch a little into the path still counts for the nearest cell: a thumb never misses by a hair.
  const reach = PLOT / 2 + PATH / 4;
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return null;
  const i = Math.min(CELLS_PER_PLOT - 1, Math.max(0, Math.round(dx / CELL) + 1));
  const j = Math.min(CELLS_PER_PLOT - 1, Math.max(0, Math.round(dz / CELL) + 1));
  return { gx: col * CELLS_PER_PLOT + i, gz: row * CELLS_PER_PLOT + j };
}

/** The four sides of a cell in grid steps: +gx is +x, +gz is −z (inward, away from the street). */
export const SIDES = [
  { dx: 0, dz: -1 }, // toward the street (rot 0 faces it)
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
] as const;

/** What a tap or a hover over the lot means: the piece it touched and the place a new piece would take. */
export type Target = {
  /** The piece the ray met first, if any. */
  hit: Piece | null;
  /** Where a new piece goes: the cell and the storey, snapped. Null when nothing can go there. */
  place: { gx: number; gz: number; y: number } | null;
};

/** The piece standing at a cell and storey (a game building fills its whole column). */
export function pieceAt(pieces: readonly Piece[], gx: number, gz: number, y: number): Piece | null {
  for (const p of pieces) {
    const n = PIECES[p.kind].size;
    if (gx < p.gx || gx >= p.gx + n || gz < p.gz || gz >= p.gz + n) continue;
    if (n === 2 || p.y === y) return p;
  }
  return null;
}

/** The storey a new piece on this cell takes: on top of what carries, never on what does not. Null when full. */
export function nextStorey(pieces: readonly Piece[], gx: number, gz: number): number | null {
  for (let y = 0; y < MAX_STACK; y += 1) {
    const here = pieceAt(pieces, gx, gz, y);
    if (!here) return y;
    if (!PIECES[here.kind].carries || PIECES[here.kind].size === 2) return null;
  }
  return null;
}

/** How tall a piece's box is for a tap: a full storey for what carries, a little less for the rest. */
function boxOf(p: Piece): { min: V3; max: V3 } {
  const c = pieceCentre(p);
  const half = (PIECES[p.kind].size * CELL) / 2;
  const tall = PIECES[p.kind].size === 2 ? STOREY_H * 1.4 : PIECES[p.kind].carries ? STOREY_H : p.kind === 'path' ? 0.08 : STOREY_H * 0.9;
  return { min: { x: c.x - half, y: p.y * STOREY_H, z: c.z - half }, max: { x: c.x + half, y: p.y * STOREY_H + tall, z: c.z + half } };
}

/** The slab test: where a ray enters a box, and through which face. */
function enter(o: V3, d: V3, box: { min: V3; max: V3 }): { t: number; axis: 'x' | 'y' | 'z'; sign: number } | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  let axis: 'x' | 'y' | 'z' = 'y';
  let sign = 1;
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < box.min[a] || o[a] > box.max[a]) return null;
      continue;
    }
    const ta = (box.min[a] - o[a]) / d[a];
    const tb = (box.max[a] - o[a]) / d[a];
    const near = Math.min(ta, tb);
    if (near > t0) {
      t0 = near;
      axis = a;
      // The face entered looks back toward the ray.
      sign = d[a] > 0 ? -1 : 1;
    }
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t0 > t1 || t1 < 0) return null;
  return { t: Math.max(0, t0), axis, sign };
}

/**
 * Snap a ray (in the lot's frame) to the grid, as Townscaper does: a top face stacks on the piece, a side face puts the
 * new piece on the neighbouring cell, and the open ground takes it on the cell under the ray. `size` is the size of
 * the piece about to go down: a game building snaps to the corner of its two by two.
 */
export function snap(pieces: readonly Piece[], origin: V3, dir: V3, size: 1 | 2 = 1): Target {
  let best: { t: number; axis: 'x' | 'y' | 'z'; sign: number; piece: Piece } | null = null;
  for (const p of pieces) {
    const hit = enter(origin, dir, boxOf(p));
    if (hit && (!best || hit.t < best.t)) best = { ...hit, piece: p };
  }
  let cell: { gx: number; gz: number } | null = null;
  if (best) {
    const p = best.piece;
    if (best.axis === 'y' && best.sign > 0) {
      // The top: a cell of the piece under the ray (one of four for a game building).
      const t = best.t;
      cell = cellAt(origin.x + dir.x * t, origin.z + dir.z * t) ?? { gx: p.gx, gz: p.gz };
    } else if (best.axis !== 'y') {
      const t = best.t;
      const at = cellAt(origin.x + dir.x * t - (best.axis === 'x' ? best.sign * 0.01 : 0), origin.z + dir.z * t - (best.axis === 'z' ? best.sign * 0.01 : 0)) ?? { gx: p.gx, gz: p.gz };
      // x grows with gx; z shrinks as gz grows.
      cell = best.axis === 'x' ? { gx: at.gx + best.sign, gz: at.gz } : { gx: at.gx, gz: at.gz - best.sign };
      if (!samePlot(at, cell)) cell = null;
    }
  } else if (Math.abs(dir.y) > 1e-9) {
    const t = -origin.y / dir.y;
    if (t > 0) cell = cellAt(origin.x + dir.x * t, origin.z + dir.z * t);
  }
  if (!cell || cell.gx < 0 || cell.gx >= GRID_W || cell.gz < 0 || cell.gz >= GRID_D) return { hit: best?.piece ?? null, place: null };
  if (size === 2) {
    // A two by two goes where it fits in this plot, its corner nearest the cell.
    const gx = Math.min(cell.gx, Math.floor(cell.gx / CELLS_PER_PLOT) * CELLS_PER_PLOT + 1);
    const gz = Math.min(cell.gz, Math.floor(cell.gz / CELLS_PER_PLOT) * CELLS_PER_PLOT + 1);
    const free = footprint({ gx, gz, kind: 'arcade' }).every((c) => nextStorey(pieces, c.gx, c.gz) === 0);
    return { hit: best?.piece ?? null, place: free ? { gx, gz, y: 0 } : null };
  }
  const y = nextStorey(pieces, cell.gx, cell.gz);
  return { hit: best?.piece ?? null, place: y === null ? null : { gx: cell.gx, gz: cell.gz, y } };
}

/** Two cells of the same plot: pieces across a path never join or reach. */
export const samePlot = (a: { gx: number; gz: number }, b: { gx: number; gz: number }): boolean =>
  b.gx >= 0 && b.gx < GRID_W && b.gz >= 0 && b.gz < GRID_D && slotOfCell(a.gx, a.gz) === slotOfCell(b.gx, b.gz);
