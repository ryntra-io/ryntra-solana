/** A switch back waits until the size is this much past the threshold, so a tower never flickers between two. */
const HYSTERESIS = 0.15;

/**
 * The skyline's level of detail for a storey `pixels` tall on screen (CITY-56), keeping the previous level near a
 * threshold. `at` is the quality tier's `lod` (`city/lib/city/quality.ts`, BUDGET): measured by the storey, not the
 * tower, so a close-up of a tall tower still draws its neighbours cheaply.
 */
export function lodFor(pixels: number, previous: number, at: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  const target = pixels >= at[0] ? 0 : pixels >= at[1] ? 1 : pixels >= at[2] ? 2 : 3;
  if (previous < 0 || previous === target) return target;
  if (target < previous) {
    for (let lod = target; lod < previous; lod += 1) if (pixels >= at[lod]! * (1 + HYSTERESIS)) return lod as 0 | 1 | 2;
    return previous as 0 | 1 | 2 | 3;
  }
  for (let lod = target; lod > previous; lod -= 1) if (pixels < at[lod - 1]! * (1 - HYSTERESIS)) return lod as 1 | 2 | 3;
  return previous as 0 | 1 | 2 | 3;
}
