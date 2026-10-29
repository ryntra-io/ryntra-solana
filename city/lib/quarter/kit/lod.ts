import { FAR, MID, NEAR } from './parts.ts';

/** Level of detail: 0 near (every part), 1 the street (no small details, simpler shapes), 2 the district (blocks only). */
export type Lod = 0 | 1 | 2;

/** A building switches to near detail above this many pixels tall on screen, to mid above the second. */
export const LOD_PIXELS = [110, 34] as const;
/** A switch back waits until the size is this much past the threshold, so a building never flickers between two. */
const HYSTERESIS = 0.15;

/** The LOD mask bit a level of detail draws. */
export const LOD_BITS = [NEAR, MID, FAR] as const;

/**
 * Picks the level of detail for a building `pixels` tall on screen, keeping the previous choice while the size sits
 * near a threshold.
 */
export function chooseLod(pixels: number, previous: Lod | null): Lod {
  const target: Lod = pixels >= LOD_PIXELS[0] ? 0 : pixels >= LOD_PIXELS[1] ? 1 : 2;
  if (previous === null || previous === target) return target;
  const at: readonly number[] = LOD_PIXELS;
  // More detail once the size clears a threshold by the margin; less once it falls below one by the margin.
  if (target < previous) {
    for (let lod = target; lod < previous; lod += 1) if (pixels >= at[lod]! * (1 + HYSTERESIS)) return lod as Lod;
    return previous;
  }
  for (let lod = target; lod > previous; lod -= 1) if (pixels < at[lod - 1]! * (1 - HYSTERESIS)) return lod as Lod;
  return previous;
}

/** How many pixels tall a sphere of `radius` at `distance` is on a perspective view `heightPx` tall. */
export function projectedPixels(radius: number, distance: number, fovDeg: number, heightPx: number): number {
  const d = Math.max(distance, radius, 0.001);
  return ((2 * radius) / d) * (heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)));
}
