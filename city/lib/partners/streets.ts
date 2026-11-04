import { PLAZA_RADIUS, RING_ROADS, SPOKES } from '../city/layout.ts';

/**
 * The partner's network as lit streets (CITY-127): from the plaza to every tower the people they brought trade, along
 * the city's own roads — out along the nearest avenue (one of the `SPOKES`), round the ring road inside the tower
 * (`RING_ROADS`), then in to the tower — so it reads as the city's streets lighting up, not lines through the towers.
 * Seen only by the partner, and only when they choose to show it. Pure: points in, segments out.
 */

export type Spot = Readonly<{ x: number; z: number }>;

export type Segment = Readonly<{ from: Spot; to: Spot; length: number }>;

const STEP = (Math.PI * 2) / SPOKES;
/** An arc is drawn in chords no longer than this, on a fixed grid of angles, so two streets share their chords. */
const CHORD = Math.PI / 36;

/** The layout's own polar plan: angles from north (−Z) clockwise; x = sin(a)·r, z = −cos(a)·r. */
const at = (r: number, a: number): Spot => ({ x: Math.sin(a) * r, z: -Math.cos(a) * r });

/** The points of one tower's street, plaza to tower. */
export function streetPoints(tower: Spot): readonly Spot[] {
  const r = Math.hypot(tower.x, tower.z);
  const a = Math.atan2(tower.x, -tower.z);
  const spoke = Math.round(a / STEP) * STEP;
  const ring = [...RING_ROADS].reverse().find((radius) => radius <= r) ?? null;
  const points: Spot[] = [at(PLAZA_RADIUS, spoke)];
  if (ring === null) {
    points.push(at(Math.max(PLAZA_RADIUS, r), spoke));
  } else {
    points.push(at(ring, spoke));
    // Round the ring on the grid of chords, from the avenue towards the tower's angle.
    const dir = Math.sign(a - spoke);
    let angle = spoke;
    for (;;) {
      const next = dir > 0 ? (Math.floor(angle / CHORD + 1e-9) + 1) * CHORD : (Math.ceil(angle / CHORD - 1e-9) - 1) * CHORD;
      if (dir === 0 || (dir > 0 ? next >= a : next <= a)) break;
      angle = next;
      points.push(at(ring, angle));
    }
    points.push(at(ring, a));
  }
  points.push({ x: tower.x, z: tower.z });
  return points;
}

const round = (n: number) => (Math.abs(n) < 5e-3 ? '0.00' : n.toFixed(2));

/** Every tower's street as segments; a stretch two streets share is drawn once. */
export function streetsTo(towers: readonly Spot[]): readonly Segment[] {
  const out: Segment[] = [];
  const seen = new Set<string>();
  for (const tower of towers) {
    const points = streetPoints(tower);
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1]!;
      const to = points[i]!;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      if (length < 0.05) continue;
      const ends = [`${round(from.x)}:${round(from.z)}`, `${round(to.x)}:${round(to.z)}`].sort().join('|');
      if (seen.has(ends)) continue;
      seen.add(ends);
      out.push({ from, to, length });
    }
  }
  return out;
}
