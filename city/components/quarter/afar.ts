import type { KitAfar } from './kit/kitMaterial';

/** The terrace's surface above the water (Arrivals stands on it). */
export const TERRACE_TOP = 0.12;

/**
 * In the city's view a building of the terrace grows by SPREAD about its plot (no more: it would cross the path into
 * its neighbour) and stands LIFT taller again, so a home reads from the skyline, not as a speck.
 */
export const SPREAD = 0.2;
export const LIFT = 0.9;

/**
 * How the terrace is seen right now, shared by its one kit and its lights: `afar` is 1 in the city's view and eases
 * to 0 while a quarter is built, so the plots and their buildings are true to size up close. Eased once a frame by
 * the quarter's scene; nothing else writes it.
 */
export const AFAR: KitAfar = { afar: { value: 1 }, spread: { value: SPREAD }, lift: { value: LIFT }, base: { value: TERRACE_TOP } };

/** How much wider a building stands on its plot now. */
export const spreadNow = (): number => 1 + AFAR.spread.value * AFAR.afar.value;

/** How tall a building of `height` stands on the terrace now, over its top: for a box around it or a sign over it. */
export const liftedHeight = (height: number): number => height * spreadNow() * (1 + AFAR.lift.value * AFAR.afar.value);
