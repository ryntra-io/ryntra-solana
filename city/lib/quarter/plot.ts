import { ARRIVALS as WORLD_ARRIVALS, QUARTER_SLOTS, openSlots, quarterLevelForSlot } from '../../../lib/world/catalog.ts';
import type { Cell } from './types.ts';

/**
 * Where quarters stand and how a quarter is cut into plots. The world numbers both; drawing them is the city's.
 *
 * Arrivals, the newcomers' district, is a terrace on the water south of the island, joined to it by a bridge that
 * continues the south spoke and runs on as the district's avenue. Its streets run east–west, one under another
 * southward: a quarter's cell.z is its street (arrivals-1 is the first, nearest the island) and cell.x its lot on
 * that street, 0 to 23. Lots pair up across the street, nearest the bridge first: even numbers on the north side,
 * odd ones facing them on the south side, west of the avenue and then east of it, and so on outward.
 *
 * A quarter is a lot of 3 × 4 plots, as many as the world's slots. Every lot faces its street, and its plots open
 * from the street inward: slots 0–2 are the front row (open from level 1), 3–5 the next, and so on. In a row, the
 * lowest slot is on the left as seen from the street.
 */

export const SLOTS = QUARTER_SLOTS;
/** Plots across a lot, along its street. */
export const WIDE = 3;
/** Rows of plots, from the street inward. */
export const DEEP = Math.ceil(SLOTS / WIDE);
/** One plot, the path between plots and the kerb around them, in world units (a tower is 2–6 wide). */
export const PLOT = 3;
export const PATH = 0.6;
export const KERB = 0.5;
const STEP = PLOT + PATH;
export const LOT_W = WIDE * PLOT + (WIDE - 1) * PATH + 2 * KERB;
export const LOT_D = DEEP * PLOT + (DEEP - 1) * PATH + 2 * KERB;

export const ARRIVALS = {
  /** The first street's centre line. */
  streetZ: 116,
  /** Half the street's width, and the pavement between the street and the lots. */
  street: 2.6,
  walk: 1,
  /** Half the width of the avenue the bridge becomes, through the middle of every street. */
  lane: 3.6,
  /** The path between neighbouring lots, and between the back rows of two streets. */
  gap: 1.6,
  /** Lots on one side of the street, on one side of the avenue. */
  perSide: WORLD_ARRIVALS.streetLength / 4,
  /** Terrace beyond the outer lots. */
  margin: 2.4,
  /** Where the bridge leaves the island. */
  shore: 74,
} as const;

/** From one street's centre line to the next. */
export const STREET_PITCH = 2 * (ARRIVALS.street + ARRIVALS.walk + LOT_D) + ARRIVALS.gap;

export type Lot = {
  x: number;
  z: number;
  /** +1 when the lot's front faces south (north of its street), −1 when it faces north. */
  facing: 1 | -1;
};

/** The lot a cell names. A number past the end of a street keeps going outward along the same plan. */
export function lotOf(cell: Cell): Lot {
  const { lane, gap, street, walk, streetZ } = ARRIVALS;
  const index = Math.max(0, Math.floor(cell.x) || 0);
  const row = Math.max(0, Math.floor(cell.z) || 0);
  const pair = Math.floor(index / 2);
  const north = index % 2 === 0;
  const west = pair % 2 === 0;
  const k = Math.floor(pair / 2);
  return {
    x: (west ? -1 : 1) * (lane + LOT_W / 2 + k * (LOT_W + gap)),
    z: streetZ + row * STREET_PITCH + (north ? -1 : 1) * (street + walk + LOT_D / 2),
    facing: north ? 1 : -1,
  };
}

/**
 * The cell of the lot under a point of the ground, among the first `streets` streets, or null on a street, the avenue,
 * a path or past the terrace: the inverse of `lotOf`, for a mouse that hovers over a neighbour's quarter.
 */
export function lotAt(x: number, z: number, streets: number): Cell | null {
  const { lane, gap, street, walk, streetZ, perSide } = ARRIVALS;
  if (!Number.isFinite(x) || !Number.isFinite(z) || streets < 1) return null;
  // `|| 0` turns a rounded −0 into 0.
  const row = Math.round((z - streetZ) / STREET_PITCH) || 0;
  if (row < 0 || row >= streets) return null;
  const zc = streetZ + row * STREET_PITCH;
  const north = z < zc;
  if (Math.abs(z - (zc + (north ? -1 : 1) * (street + walk + LOT_D / 2))) > LOT_D / 2) return null;
  const ax = Math.abs(x) - lane;
  if (ax < 0) return null;
  const k = Math.floor(ax / (LOT_W + gap));
  if (k >= perSide || ax - k * (LOT_W + gap) > LOT_W) return null;
  const pair = 2 * k + (x < 0 ? 0 : 1);
  return { x: 2 * pair + (north ? 0 : 1), z: row };
}

/**
 * Where a street's lamp posts stand: on both pavements, in the path between two lots and at the street's two ends,
 * never on a lot. The avenue keeps the lamps the terrace draws.
 */
export function streetLamps(row: number): { x: number; z: number }[] {
  const { lane, gap, street, walk, streetZ, perSide } = ARRIVALS;
  const zc = streetZ + Math.max(0, Math.floor(row) || 0) * STREET_PITCH;
  const out: { x: number; z: number }[] = [];
  for (const side of [-1, 1]) {
    for (let k = 1; k <= perSide; k += 1) {
      const x = side * (lane + k * (LOT_W + gap) - gap / 2);
      for (const kerb of [-1, 1]) out.push({ x, z: zc + kerb * (street + walk * 0.5) });
    }
  }
  return out;
}

/** Every lot of a street, in the world's order. */
export const streetCells = (z: number): Cell[] => Array.from({ length: WORLD_ARRIVALS.streetLength }, (_, x) => ({ x, z }));

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** The terrace: every street up to this visitor's, and their lot too when it stands further out. */
export function terraceBounds(extra: Lot | null = null, extraStreet = 0): Bounds {
  const lots = Array.from({ length: Math.max(1, extraStreet + 1) }, (_, z) => streetCells(z).map(lotOf)).flat();
  if (extra) lots.push(extra);
  const hx = LOT_W / 2 + ARRIVALS.margin;
  const hz = LOT_D / 2 + ARRIVALS.margin;
  return {
    minX: Math.min(...lots.map((l) => l.x)) - hx,
    maxX: Math.max(...lots.map((l) => l.x)) + hx,
    minZ: Math.min(...lots.map((l) => l.z)) - hz,
    maxZ: Math.max(...lots.map((l) => l.z)) + hz,
  };
}

/** Where a slot sits in its lot: its column from the left and its row from the street, as seen from the street. */
export const slotPlace = (slot: number) => ({ col: slot % WIDE, row: Math.floor(slot / WIDE) });

/** The centre of a plot, in world units. */
export function slotCentre(lot: Lot, slot: number): { x: number; z: number } {
  const { col, row } = slotPlace(slot);
  return {
    x: lot.x + (col - (WIDE - 1) / 2) * STEP * lot.facing,
    z: lot.z + ((DEEP - 1) / 2 - row) * STEP * lot.facing,
  };
}

/**
 * The plot under a point of the ground, or null outside the lot. A tap on the path between plots counts for the
 * nearest one, so a thumb never misses.
 */
export function slotAt(lot: Lot, x: number, z: number): number | null {
  const lx = (x - lot.x) * lot.facing;
  const lz = (z - lot.z) * lot.facing;
  const col = Math.round(lx / STEP + (WIDE - 1) / 2);
  const row = Math.round((DEEP - 1) / 2 - lz / STEP);
  if (col < 0 || col >= WIDE || row < 0 || row >= DEEP) return null;
  const reach = PLOT / 2 + PATH / 2 + 1e-6;
  if (Math.abs(lx - (col - (WIDE - 1) / 2) * STEP) > reach || Math.abs(lz - ((DEEP - 1) / 2 - row) * STEP) > reach) return null;
  // `|| 0` turns a rounded −0 into 0.
  const slot = row * WIDE + col || 0;
  return slot < SLOTS ? slot : null;
}

/** The middle plot of the front row: where a first home looks best, and where the hint points. */
export const FIRST_SLOT = 1;

/** How many plots a quarter of this level has open: the world's rule, three at first and one more a level. */
export const openPlots = (quarterLevel: number): number => openSlots(quarterLevel);

/** The quarter level that opens a plot. */
export const plotLevel = (slot: number): number => quarterLevelForSlot(slot);

/** A lot for this device on the newcomers' first street, by the bridge on its north side, so the city stands behind. */
export function pickCell(seed: number): Cell {
  return { x: (Math.abs(Math.floor(seed)) % 2) * 2, z: 0 };
}

/** The world's name of a street of the newcomers' district, from its row. */
export const streetOf = (z: number): string => `arrivals-${Math.max(0, Math.floor(z) || 0) + 1}`;

/** «arrivals-3» reads as «Street 3». */
export function streetName(street: string): string {
  const n = /^[a-z]+-(\d+)$/.exec(street)?.[1];
  return n ? `Street ${n}` : street;
}

/** A lot's number on its street, from 1. */
export const lotNumber = (cell: Cell): number => Math.max(0, Math.floor(cell.x) || 0) + 1;
