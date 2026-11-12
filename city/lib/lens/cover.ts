/**
 * Whether the Lens's strip stands under a window (CITY-243, a MINOR of CITY-242): the strip hangs 10 px under the top bar,
 * the windows' first places start 15 px under it — a window as wide as Spot or Earn covered the strip all but its top
 * 4 px, a sliver of violet over the window's edge. Under a window that covers most of it the strip steps aside; a
 * window that only touches it (Launch, under the strip) leaves it standing. Pure: the bar and the tests read it alike.
 */

export type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

/** From this share of its area under one window, the strip steps aside. */
export const COVERED_FROM = 0.5;

/** The largest share of `box` that any one of `over` covers, 0 … 1. */
export function coveredShare(box: Box, over: readonly Box[]): number {
  const area = box.width * box.height;
  if (!(area > 0)) return 0;
  let most = 0;
  for (const o of over) {
    const w = Math.min(box.x + box.width, o.x + o.width) - Math.max(box.x, o.x);
    const h = Math.min(box.y + box.height, o.y + o.height) - Math.max(box.y, o.y);
    if (w > 0 && h > 0) most = Math.max(most, (w * h) / area);
  }
  return Math.min(1, most);
}

/** The strip under a window: most of it covered by one. */
export function underWindow(box: Box, over: readonly Box[]): boolean {
  return coveredShare(box, over) >= COVERED_FROM;
}
