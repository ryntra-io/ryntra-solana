/**
 * Detail by size on screen: a character close up is drawn with every plate and finger (hero), on the street with
 * simpler hands and no small trim (standard), across a district in a few blocks (crowd), and on the far plane as a
 * picture of itself facing the camera (impostor). The switch waits past each threshold, so it never flickers.
 */

import type { Quality } from '../city/quality.ts';

export const DETAILS = ['hero', 'standard', 'crowd', 'impostor'] as const;
export type Detail = 0 | 1 | 2 | 3;

/** Hero from this many pixels tall on screen, standard from the second, crowd from the third, impostor below. */
export const DETAIL_PIXELS = [300, 110, 36] as const;
const HYSTERESIS = 0.15;

export type CharacterBudget = Readonly<{
  /** Pixels tall for hero, standard and crowd, as `DETAIL_PIXELS`. */
  pixels: readonly [number, number, number];
  /** The richest level this rung draws. */
  best: Detail;
  /** A contact shadow (one more draw of the body and four blur passes) where a scene asks for one. */
  contact: boolean;
}>;

/**
 * What a character spends on each tier of the city's quality ladder (CITY-6a, `city/lib/city/quality.ts`): high as
 * built; mid keeps the hero for a figure that fills the screen and goes crowd a little sooner; low never draws the hero
 * (58k triangles) and drops to the crowd and the picture sooner. The frame-rate monitor moves the tier; characters follow.
 */
export const CHARACTER_BUDGET: Readonly<Record<Quality, CharacterBudget>> = Object.freeze({
  high: { pixels: DETAIL_PIXELS, best: 0, contact: true },
  mid: { pixels: [420, 140, 48], best: 0, contact: false },
  low: { pixels: [Number.POSITIVE_INFINITY, 170, 64], best: 1, contact: false },
});

export function chooseDetail(pixels: number, previous: Detail | null, at: readonly number[] = DETAIL_PIXELS): Detail {
  const target: Detail = pixels >= at[0]! ? 0 : pixels >= at[1]! ? 1 : pixels >= at[2]! ? 2 : 3;
  if (previous === null || previous === target) return target;
  if (target < previous) {
    for (let d = target; d < previous; d += 1) if (pixels >= at[d]! * (1 + HYSTERESIS)) return d as Detail;
    return previous;
  }
  for (let d = target; d > previous; d -= 1) if (pixels < at[d - 1]! * (1 - HYSTERESIS)) return d as Detail;
  return previous;
}

/** How many pixels tall something `height` units tall is at `distance` on a perspective view `viewport` pixels tall. */
export function projectedHeight(height: number, distance: number, fovDeg: number, viewport: number): number {
  return (height / Math.max(distance, 0.001)) * (viewport / (2 * Math.tan((fovDeg * Math.PI) / 360)));
}
