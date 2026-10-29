/**
 * Where the Exchange's window stands on a desk: dragged by its head, resized by its corner, kept inside the screen
 * below the top bar and above the dock, and remembered on this device (a convenience — a lost box is the default).
 */

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
export type Screen = Readonly<{ width: number; height: number }>;

/** The top bar's room above the window, and the dock's below it. */
export const TOP = 76;
export const BOTTOM = 104;
export const MARGIN = 16;
export const MIN_W = 720;
export const MIN_H = 480;
export const MAX_W = 1120;

/** The live feed's control row under the top bar (CITY-66), which the window's first place leaves free. */
export const FEED_ROW = 48;

/** The first place: on the left, where the city's cards are not (the tower card and the hot card stand on the right). */
export function defaultBox(screen: Screen): Box {
  const w = Math.min(860, Math.max(MIN_W, screen.width - 580));
  const h = Math.max(MIN_H, screen.height - TOP - FEED_ROW - BOTTOM);
  return clampBox({ x: 24, y: TOP + FEED_ROW, w, h }, screen);
}

/** A box kept on the screen: never smaller than the window can be read at, never past the screen's edges. */
export function clampBox(box: Box, screen: Screen): Box {
  const w = Math.round(Math.min(Math.max(box.w, Math.min(MIN_W, screen.width - 2 * MARGIN)), Math.min(MAX_W, screen.width - 2 * MARGIN)));
  const h = Math.round(Math.min(Math.max(box.h, Math.min(MIN_H, screen.height - TOP - MARGIN)), screen.height - TOP - MARGIN));
  const x = Math.round(Math.min(Math.max(box.x, MARGIN), Math.max(MARGIN, screen.width - w - MARGIN)));
  const y = Math.round(Math.min(Math.max(box.y, TOP), Math.max(TOP, screen.height - h - MARGIN)));
  return { x, y, w, h };
}

/** A box from storage, or null when it is not one. */
export function readBox(text: string | null): Box | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<Box>;
    const numbers = [value.x, value.y, value.w, value.h];
    if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return { x: value.x!, y: value.y!, w: value.w!, h: value.h! };
  } catch {
    return null;
  }
}

/** Whether the screen is a desk's: wide and tall enough for the window and its two columns. */
export const deskScreen = (screen: Screen): boolean => screen.width >= 900 && screen.height >= 560;
