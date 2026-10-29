import type * as THREE from 'three';
import type { PlacedTower } from './layout.ts';

/**
 * Picks the tower under a ray by testing each tower as an upright cylinder. Ninety towers are cheaper to test
 * this way than through instanced-mesh raycasting, and the hit area matches what the eye sees.
 */
export function pickTower(ray: THREE.Ray, towers: readonly PlacedTower[]): PlacedTower | null {
  let best: PlacedTower | null = null;
  let bestT = Infinity;
  const { origin: o, direction: d } = ray;
  for (const t of towers) {
    const r = t.width * 1.05 + 0.6; // a little extra so thin towers are easy to tap on a phone
    const ox = o.x - t.x;
    const oz = o.z - t.z;
    const a = d.x * d.x + d.z * d.z;
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (a < 1e-9 || disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (const hit of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
      if (hit <= 0) continue;
      const y = o.y + d.y * hit;
      if (y >= 0 && y <= t.height + t.width * 2.2) {
        if (hit < bestT) {
          bestT = hit;
          best = t;
        }
        break;
      }
    }
  }
  return best;
}
