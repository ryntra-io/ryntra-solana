import type { Tower } from '../market/types.ts';

/**
 * The small line beside a mover: the price over the event's window, drawn only from what was read — the price now, and
 * the prices 5 minutes, 1 hour and 24 hours ago that Jupiter's changes imply, plus every price the city read since the
 * page opened. Nothing between the points is invented: the line joins real reads with straight segments.
 */

export type Point = readonly [t: number, price: number];

export const HOUR = 3_600_000;
export const WINDOW_MS = { '1h': HOUR, '24h': 24 * HOUR } as const;
export type Window = keyof typeof WINDOW_MS;

/** The prices of the city's own reads, kept this long per tower. */
export const HISTORY_MS = 25 * HOUR;
export const HISTORY_MAX = 240;

/**
 * The price a change implies at its start: now ÷ (1 + change). None for a change that is not a number, −100% and below, or
 * exactly zero — the city's read writes zero where Jupiter gave no figure, and a flat stretch nobody read is not drawn.
 */
function before(price: number, change: number): number | null {
  if (!Number.isFinite(change) || change <= -100 || change === 0) return null;
  const p = price / (1 + change / 100);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** The points of a tower's line over a window, oldest first. Null when there are fewer than two. */
export function sparkPoints(tower: Pick<Tower, 'price' | 'change5m' | 'change1h' | 'change24h'>, window: Window, readAt: number, history: readonly Point[] = []): Point[] | null {
  const price = tower.price;
  if (!Number.isFinite(price) || price <= 0) return null;
  const from = readAt - WINDOW_MS[window];
  const anchors: [number, number | null][] = [
    [readAt - 5 * 60_000, before(price, tower.change5m)],
    [readAt - HOUR, before(price, tower.change1h)],
  ];
  if (window === '24h') anchors.push([readAt - 24 * HOUR, before(price, tower.change24h)]);
  const points = new Map<number, number>();
  for (const [t, p] of anchors) if (p !== null) points.set(t, p);
  for (const [t, p] of history) if (t >= from && t < readAt && Number.isFinite(p) && p > 0) points.set(t, p);
  points.set(readAt, price);
  const sorted = [...points.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => [t, p] as const);
  return sorted.length >= 2 ? sorted : null;
}

/**
 * The points as an SVG polyline in a box of `width` × `height`, time along x and price up y, with a pixel of room at the
 * edges for the stroke. A flat line sits in the middle.
 */
export function sparkPath(points: readonly Point[], width: number, height: number, pad = 1.5): string {
  if (points.length < 2) return '';
  const t0 = points[0]![0];
  const t1 = points[points.length - 1]![0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, p] of points) {
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  const span = t1 - t0 || 1;
  const range = hi - lo;
  const x = (t: number) => pad + ((t - t0) / span) * (width - 2 * pad);
  const y = (p: number) => (range === 0 ? height / 2 : pad + (1 - (p - lo) / range) * (height - 2 * pad));
  return points.map(([t, p]) => `${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
}

/** The city's own reads of one tower, with the new read added and the old ones let go. */
export function remember(history: readonly Point[] | undefined, readAt: number, price: number): readonly Point[] {
  const kept = (history ?? []).filter(([t]) => readAt - t <= HISTORY_MS && t !== readAt);
  if (!Number.isFinite(price) || price <= 0) return kept;
  return [...kept, [readAt, price] as const].slice(-HISTORY_MAX);
}
