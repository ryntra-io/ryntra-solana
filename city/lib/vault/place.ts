import { ISLAND_RADIUS } from '../city/layout.ts';
import { ARRIVALS, LOT_D, LOT_W } from '../quarter/plot.ts';

/**
 * Where the Vault stands: its own armoured islet on the water south-east of the island, between the Meme Strip's shore
 * and the newcomers' terrace, its door turned to the city's establishing shot. Nothing of the island or the terrace
 * moves for it; the numbers below are checked against both (`place.test.mjs`).
 */

export type Point = { x: number; y: number; z: number };

/** The islet's centre on the water. */
export const VAULT_SPOT = { x: 58, z: 66 } as const;
/** The islet's radius: the tower, its plaza and the guard's step. */
export const ISLET_RADIUS = 7.2;
/** The tower's body: an armoured octagon and its glass core. */
export const TOWER = { radius: 3.3, height: 17, core: 1.25 } as const;
/** The plinth the tower and the guard stand on. */
export const PLINTH_TOP = 0.55;

/** The door faces the city's establishing camera (0, 38, 172), so the guard is seen from the first frame. */
export const FACING = Math.atan2(0 - VAULT_SPOT.x, 172 - VAULT_SPOT.z);

const forward = { x: Math.sin(FACING), z: Math.cos(FACING) };
const right = { x: Math.cos(FACING), z: -Math.sin(FACING) };

/** A point in front of the door: `ahead` along its facing, `side` to its right, at a height. */
export function inFront(ahead: number, side: number, y: number): Point {
  return { x: VAULT_SPOT.x + forward.x * ahead + right.x * side, y, z: VAULT_SPOT.z + forward.z * ahead + right.z * side };
}

/** Where the guard stands, from the door's side: on the plinth, a step out and to the right, facing out. */
export const GUARD_LOCAL = { ahead: TOWER.radius + 1.3, side: 2.8 } as const;
export const GUARD_SPOT = inFront(GUARD_LOCAL.ahead, GUARD_LOCAL.side, PLINTH_TOP);

/** How far the islet is from the island's shore and from the terrace's nearest lot: both must stay open water. */
export function clearances(): { shore: number; terrace: number } {
  const shore = Math.hypot(VAULT_SPOT.x, VAULT_SPOT.z) - ISLAND_RADIUS - ISLET_RADIUS;
  // The terrace's outer edge across, and its north edge: the first street's north lots and the margin beyond them.
  const outer = ARRIVALS.lane + (ARRIVALS.perSide - 1) * (LOT_W + ARRIVALS.gap) + LOT_W + ARRIVALS.margin;
  const north = ARRIVALS.streetZ - ARRIVALS.street - ARRIVALS.walk - LOT_D - ARRIVALS.margin;
  const dx = Math.max(0, VAULT_SPOT.x - ISLET_RADIUS - outer);
  const dz = Math.max(0, north - (VAULT_SPOT.z + ISLET_RADIUS));
  return { shore, terrace: Math.max(dx, dz) };
}

export type View = { eye: Point; target: Point };

/**
 * The camera of the room. On a wide screen the room's panel takes the right, so the camera looks past the vault's right
 * side and the whole tower stands in the left part of the frame. On a phone the panel is a sheet over the lower part,
 * so the camera stands low and looks down past the vault: the door and the guard stand in the band between the top
 * bar and the sheet, and the tower rises out of the frame.
 */
export function roomView(width: number, height: number): View {
  if (width < height) {
    const side = GUARD_LOCAL.side / 2;
    return { eye: inFront(GUARD_LOCAL.ahead + 42, side, 5), target: inFront(GUARD_LOCAL.ahead, side, -6.2) };
  }
  return { eye: inFront(40, 9, 9), target: inFront(0, 9, 9.5) };
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** How long the flight to the door takes: longer from further away, never a jump. */
export function flightMs(from: View, to: View): number {
  const d = Math.hypot(to.eye.x - from.eye.x, to.eye.y - from.eye.y, to.eye.z - from.eye.z);
  return Math.max(1200, Math.min(2400, 900 + d * 9));
}

/** A point of the flight at t in 0…1: eased at both ends and lifted in the middle, a flight over the water. */
export function flightAt(from: View, to: View, t: number): View {
  const k = ease(t);
  const eye = mix(from.eye, to.eye, k);
  eye.y += Math.sin(Math.PI * k) * 10;
  return { eye, target: mix(from.target, to.target, k) };
}
