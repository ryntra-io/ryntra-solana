/**
 * Where the tower chart's window stands on a desk (CITY-5a): in the tower card's place, beside the tower and under
 * the top bar, dragged by its head and stretched by its corner, never off the screen and never smaller than a readable
 * chart.
 * On a phone, or a window too small for a floating chart, it is a full-screen sheet instead. Pure.
 */

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
export type Viewport = Readonly<{ w: number; h: number }>;

/** The smallest window that still reads as a chart: the interval row, the candles, the facts and Buy. */
export const MIN_W = 480;
export const MIN_H = 480;
/** The top bar's band, kept clear by default. */
export const TOP = 72;
/** The side margin, the city's gutter. */
export const GUTTER = 16;
/** The bottom margin, the tower card's own. */
export const BOTTOM = 14;
/** The tallest a window opens: a chart taller than this only spreads the candles. */
export const MAX_H = 640;
/** Of a window dragged out, at least this much stays on screen to grab it back. */
export const GRAB = 64;

/** A phone, or a desk too small for a floating chart: the chart is a full-screen sheet. */
export function isSheet(viewport: Viewport): boolean {
  return viewport.w < 760 || viewport.h < TOP + MIN_H + BOTTOM + 34;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The first place: where the tower card stood — on the right, standing on the bottom margin — grown up towards the top
 * bar, so the card turns into the chart and the tower stays in view.
 */
export function defaultBox(viewport: Viewport): Box {
  const w = clamp(Math.round(viewport.w * 0.5), MIN_W, 820);
  const h = clamp(viewport.h - TOP - BOTTOM, MIN_H, MAX_H);
  return fitBox({ x: viewport.w - GUTTER - w, y: viewport.h - BOTTOM - h, w, h }, viewport);
}

/** A box made to fit the screen: no larger than it, no smaller than the minimum, its head always reachable. */
export function fitBox(box: Box, viewport: Viewport): Box {
  const w = clamp(Math.round(box.w), MIN_W, viewport.w - 2 * GUTTER);
  const h = clamp(Math.round(box.h), MIN_H, viewport.h - BOTTOM - 12);
  const x = clamp(Math.round(box.x), GRAB - w, viewport.w - GRAB);
  const y = clamp(Math.round(box.y), 12, viewport.h - GRAB);
  return { x, y, w, h };
}

/** The window dragged by its head. */
export const moved = (box: Box, dx: number, dy: number, viewport: Viewport): Box => fitBox({ ...box, x: box.x + dx, y: box.y + dy }, viewport);

/** The window stretched by its corner: the top left stays where it is. */
export const resized = (box: Box, dw: number, dh: number, viewport: Viewport): Box => fitBox({ ...box, w: box.w + dw, h: box.h + dh }, viewport);

/** Where this browser keeps the window's place. */
export const BOX_KEY = 'ryntra.city.chart.box.v1';

/**
 * Where the window stands on its first frame: the kept place fitted to this screen, or the card's place. The window
 * opens there at once, so it never moves or changes size after it appears.
 */
export function startBox(viewport: Viewport, kept: string | null): Box {
  const box = parseBox(kept);
  return box ? fitBox(box, viewport) : defaultBox(viewport);
}

/** A kept place, if it is one: four finite numbers. */
export function parseBox(raw: string | null): Box | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const { x, y, w, h } = value ?? {};
    return [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: x as number, y: y as number, w: w as number, h: h as number } : null;
  } catch {
    return null;
  }
}
