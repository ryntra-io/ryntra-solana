import type { PlacedTower } from '../city/layout.ts';

/** Eye and target, as the camera's `setLookAt` takes them. */
export type LensShot = readonly [number, number, number, number, number, number];

/**
 * The frame for a lens's towers: from the side the camera already stands on, far enough back that the whole set and its
 * tallest tower stand in the frame, a little above the roofs so the sunk towers between read as haze, not as walls. A
 * phone held upright stands further back: its frame is narrow.
 */
export function lensShot(towers: readonly PlacedTower[], from: readonly [number, number, number], portrait: boolean): LensShot | null {
  if (!towers.length) return null;
  const cx = towers.reduce((sum, t) => sum + t.x, 0) / towers.length;
  const cz = towers.reduce((sum, t) => sum + t.z, 0) / towers.length;
  const spread = Math.max(...towers.map((t) => Math.hypot(t.x - cx, t.z - cz) + t.width));
  const top = Math.max(...towers.map((t) => t.height));
  let dx = from[0] - cx;
  let dz = from[2] - cz;
  const len = Math.hypot(dx, dz);
  if (len < 1) [dx, dz] = [0, 1];
  else [dx, dz] = [dx / len, dz / len];
  const distance = Math.min(260, Math.max(56, spread * 2.1 + top * 0.9) * (portrait ? 1.45 : 1));
  const lookY = Math.max(4, top * 0.45);
  // Short towers (the new launches in the docks) are seen from higher up, over the sunk skyline and onto their rings.
  const steep = 0.3 + 0.45 * Math.min(1, Math.max(0, (30 - top) / 20));
  return [cx + dx * distance, lookY + distance * steep, cz + dz * distance, cx, lookY, cz];
}
