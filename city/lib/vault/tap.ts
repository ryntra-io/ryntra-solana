import * as THREE from 'three';
import { GUARD_SPOT, PLINTH_TOP, TOWER, VAULT_SPOT } from './place.ts';

/**
 * A tap on the Vault in the city (CITY-241): from the city as from Play, the tower opens the same room as «Arena →
 * Vault» (`enter.ts`). The city's own tap (`CameraRig`) asks here, as it asks the Hall's signs, whether the ray meets
 * the tower nearer than the tower it would pick — so a coin's tower standing in front of the Vault keeps its tap. The
 * tower is met as its own body and a finger's slack around it — and the guard beside its door, seen from the first
 * frame — never the whole islet, and only while it stands in the city's view (`VaultTower` says so: not while a quarter
 * is built).
 */

/** The top of what a tap can hit: the tower, its cap and its lamp. */
export const VAULT_TOP = PLINTH_TOP + TOWER.height + 4;
/** Half the side of the box a tap meets: the octagon's armour and a little slack for a finger. */
const REACH = TOWER.radius + 0.6;

/** The guard: a figure about five units tall on the plinth, and a finger's slack around it. */
const GUARD = { reach: 1.4, height: 5 } as const;

const boxes = [
  new THREE.Box3(new THREE.Vector3(VAULT_SPOT.x - REACH, 0, VAULT_SPOT.z - REACH), new THREE.Vector3(VAULT_SPOT.x + REACH, VAULT_TOP, VAULT_SPOT.z + REACH)),
  new THREE.Box3(
    new THREE.Vector3(GUARD_SPOT.x - GUARD.reach, PLINTH_TOP, GUARD_SPOT.z - GUARD.reach),
    new THREE.Vector3(GUARD_SPOT.x + GUARD.reach, PLINTH_TOP + GUARD.height, GUARD_SPOT.z + GUARD.reach),
  ),
];
const hit = new THREE.Vector3();
let standing = false;

/** The Vault's tower says it stands in the city's view (its flag open, no quarter being built), and that it is gone. */
export function placeVault(on: boolean): void {
  standing = on;
}

/** The Vault under a ray, and how far it stands across the ground from the ray's start; null when it is not met. */
export function vaultUnder(ray: THREE.Ray): Readonly<{ distance: number }> | null {
  if (!standing) return null;
  let best: number | null = null;
  for (const box of boxes) {
    if (!ray.intersectBox(box, hit)) continue;
    const distance = Math.hypot(hit.x - ray.origin.x, hit.z - ray.origin.z);
    if (best === null || distance < best) best = distance;
  }
  return best === null ? null : { distance: best };
}
