/**
 * Motion constants that JavaScript needs.
 *
 * CSS timings live in the `--motion-*` tokens in `landing.css`. A few cadences
 * are driven from JS instead — an interval cannot read a CSS variable — and
 * those belong here rather than inline in a component, so "restrained motion"
 * stays a property of one reviewable place.
 *
 * Keep the two in step: ambient JS cadences should sit in the same order of
 * magnitude as `--motion-ambient-*`, an order slower than interaction timings.
 */

/** How long each scanner row stays selected before the sweep advances. */
export const SWEEP_INTERVAL_MS = 2600;

/**
 * How long one readiness check takes before the next one reports.
 *
 * Faster than the row sweep on purpose: seven checks at the sweep cadence would
 * take eighteen seconds to fill, which is a loading bar rather than a
 * demonstration. This is the shortest interval at which a reader can still see
 * each row land separately — the whole point of the block is that the checks
 * report one by one instead of arriving as a single score.
 */
export const SCAN_STEP_MS = 460;

/**
 * Pointer-parallax amplitudes for the hero, in degrees and pixels.
 *
 * These are motion distances like any other, so they belong in the system
 * rather than inline in the render loop. They live here instead of in CSS
 * because the values are multiplied by a live pointer offset each frame.
 */
export const HERO_PARALLAX = {
  /** Plane rotation at the pointer's extreme, in degrees. */
  planeYawDeg: 5,
  planePitchDeg: 3.2,
  /** Layer travel at the pointer's extreme, in pixels. */
  riskX: 18,
  riskY: 12,
  ticketX: 30,
  ticketY: 18,
} as const;
