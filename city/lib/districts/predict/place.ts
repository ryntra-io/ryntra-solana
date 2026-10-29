import { ISLAND_RADIUS } from '../../city/layout.ts';
import { ARRIVALS, LOT_D, LOT_W } from '../../quarter/plot.ts';
import { ISLET_RADIUS as VAULT_RADIUS, VAULT_SPOT } from '../../vault/place.ts';

/**
 * Where the Predictions billboard stands: on its own islet on the water south-west of the island, left of the bridge
 * across from the Vault, its face turned to the city's establishing shot. Nothing of the island, the newcomers' terrace or
 * the Vault moves for it; the numbers below are checked against all three (`place.test.mjs`).
 */

export const BOARD_SPOT = { x: -38, z: 78 } as const;
/** The islet under the pylon. */
export const BOARD_ISLET = 4.2;
/** The board's face, in world units, and the height of its centre over the water. */
export const BOARD = { width: 17, height: 9.6, y: 15.5, pylon: 0.45 } as const;

/** The face looks at the city's establishing camera (0, 38, 172). */
export const BOARD_FACING = Math.atan2(0 - BOARD_SPOT.x, 172 - BOARD_SPOT.z);

/** How far the islet is from the island's shore, from the terrace's nearest lot, and from the Vault's islet. */
export function clearances(): { shore: number; terrace: number; vault: number } {
  const reach = Math.max(BOARD_ISLET, BOARD.width / 2);
  const shore = Math.hypot(BOARD_SPOT.x, BOARD_SPOT.z) - ISLAND_RADIUS - reach;
  const outer = ARRIVALS.lane + (ARRIVALS.perSide - 1) * (LOT_W + ARRIVALS.gap) + LOT_W + ARRIVALS.margin;
  const north = ARRIVALS.streetZ - ARRIVALS.street - ARRIVALS.walk - LOT_D - ARRIVALS.margin;
  const dx = Math.max(0, Math.abs(BOARD_SPOT.x) - reach - outer);
  const dz = Math.max(0, north - (BOARD_SPOT.z + reach));
  const vault = Math.hypot(BOARD_SPOT.x - VAULT_SPOT.x, BOARD_SPOT.z - VAULT_SPOT.z) - reach - VAULT_RADIUS;
  return { shore, terrace: Math.max(dx, dz), vault };
}
