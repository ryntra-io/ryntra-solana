/**
 * Who takes a finger on the tower chart (CITY-215). On a phone the chart stands inside the window's sheet, and a chart
 * that keeps every drag leaves the amount and Market · Limit · Stop under it out of reach. So a finger that goes up or
 * down over the candles scrolls the window; one that goes sideways moves the candles, two fingers pinch them, and a
 * finger held still first is the crosshair's. Pure: the hook in `use-gesture.ts` reads the touches and asks here.
 */

/** A finger has to travel this far (across plus up) before its way is known: the core chart's own tap distance, so the
 *  window's decision always comes on or before the chart's and the chart never claims a drag the window scrolls. */
export const GESTURE_SLOP_PX = 5;

/** A finger that stays put this long belongs to the chart: the core chart's crosshair comes at 500 ms of a still touch. */
export const HOLD_MS = 450;

export type Way = 'undecided' | 'chart' | 'scroll';

export type Touch = Readonly<{ x: number; y: number; t: number }>;

/**
 * The way of one gesture from where its finger went down, where it is now and how many fingers are on the glass.
 * Two fingers are a pinch; a finger held first is the crosshair's; then up or down is the window's, across is the chart's.
 * Exactly diagonal goes to the chart: its candles are what the finger is on.
 */
export function wayOf(start: Touch, now: Touch, fingers: number): Way {
  if (fingers !== 1) return 'chart';
  const dx = Math.abs(now.x - start.x);
  const dy = Math.abs(now.y - start.y);
  if (dx + dy < GESTURE_SLOP_PX) return now.t - start.t >= HOLD_MS ? 'chart' : 'undecided';
  if (now.t - start.t >= HOLD_MS) return 'chart';
  return dy > dx ? 'scroll' : 'chart';
}

/** Whether a finger that came down here keeps the whole gesture to the chart: a handle that drags on its own (a line
 *  the person moves, any part of the chart that takes every touch) or the chart's drawing tools, open. */
export type Owner = Readonly<{ handle: boolean; drawing: boolean }>;

export const chartOwns = (owner: Owner): boolean => owner.handle || owner.drawing;
