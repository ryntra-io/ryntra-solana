/**
 * Where the trade card stands on a computer: a window the person can drag by its head and stretch by any corner.
 * It always stays whole on the screen, and its place and size are remembered in this browser. On a phone the card is
 * the bottom sheet and none of this applies.
 */

export type Frame = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Viewport = Readonly<{ width: number; height: number }>;
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** From this screen width the card is a window; below it, the bottom sheet. */
export const WINDOWED_FROM = 900;
/** Small enough to keep the city in view, big enough for four tiles, the field and the figures. */
export const FRAME_MIN = { width: 420, height: 420 } as const;
export const FRAME_MAX = { width: 760, height: 980 } as const;
/** The window never comes closer than this to the screen's edge. */
export const EDGE = 8;

export const FRAME_KEY = 'ryntra.city.trade-window.v1';

const RIGHT = 16;
const BOTTOM = 24;
/** Room the city's top bar keeps over a window that grows upward. */
export const TOP_ROOM = 76;
const WIDTH = 520;
const HEIGHT = 560;

export function windowed(viewport: Viewport): boolean {
  return viewport.width >= WINDOWED_FROM;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** How big the window may be on this screen: never larger than the screen leaves room for. */
function bounds(viewport: Viewport) {
  const maxWidth = Math.max(0, Math.min(FRAME_MAX.width, viewport.width - 2 * EDGE));
  const maxHeight = Math.max(0, Math.min(FRAME_MAX.height, viewport.height - 2 * EDGE));
  return { minWidth: Math.min(FRAME_MIN.width, maxWidth), maxWidth, minHeight: Math.min(FRAME_MIN.height, maxHeight), maxHeight };
}

/** The window as it first opens: on the right, the city keeps the centre. */
export function defaultFrame(viewport: Viewport): Frame {
  const b = bounds(viewport);
  const width = clamp(WIDTH, b.minWidth, b.maxWidth);
  const height = clamp(Math.min(HEIGHT, viewport.height - BOTTOM - TOP_ROOM), b.minHeight, b.maxHeight);
  return fitFrame({ x: viewport.width - RIGHT - width, y: viewport.height - BOTTOM - height, width, height }, viewport);
}

/** The same window, sized within the limits and moved back whole onto the screen. */
export function fitFrame(frame: Frame, viewport: Viewport): Frame {
  const b = bounds(viewport);
  const width = clamp(Math.round(frame.width), b.minWidth, b.maxWidth);
  const height = clamp(Math.round(frame.height), b.minHeight, b.maxHeight);
  const x = clamp(Math.round(frame.x), EDGE, Math.max(EDGE, viewport.width - EDGE - width));
  const y = clamp(Math.round(frame.y), EDGE, Math.max(EDGE, viewport.height - EDGE - height));
  return { x, y, width, height };
}

/**
 * How the window stands on the screen: its bottom edge where the frame puts it, its height the card's own — never
 * less than the frame, never more than the room above that edge (below the city's top bar). A taller card grows
 * upward; one taller still scrolls inside, its action pinned at the bottom. Nothing moves the bottom edge, so the
 * card never jumps.
 */
export type Standing = Readonly<{ left: number; bottom: number; width: number; minHeight: number; maxHeight: number }>;

export function standingOf(frame: Frame, viewport: Viewport): Standing {
  const edge = frame.y + frame.height;
  return {
    left: frame.x,
    bottom: Math.max(0, viewport.height - edge),
    width: frame.width,
    minHeight: frame.height,
    maxHeight: Math.max(frame.height, edge - Math.min(TOP_ROOM, frame.y)),
  };
}

/** Dragged by the head: the size stays, the window stops at the screen's edge. */
export function moveFrame(start: Frame, dx: number, dy: number, viewport: Viewport): Frame {
  return fitFrame({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
}

/**
 * Stretched by a corner: the two edges across from it stay where they were. The window opens against the screen's
 * bottom-right, so the top-left corner is the one that grows it; no corner ever pushes it off the screen.
 */
export function resizeFrame(start: Frame, corner: Corner, dx: number, dy: number, viewport: Viewport): Frame {
  const b = bounds(viewport);
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const fromTop = corner === 'nw' || corner === 'ne';
  const fromLeft = corner === 'nw' || corner === 'sw';
  const height = fromTop
    ? clamp(start.height - dy, b.minHeight, Math.min(b.maxHeight, bottom - EDGE))
    : clamp(start.height + dy, b.minHeight, Math.min(b.maxHeight, viewport.height - EDGE - start.y));
  const width = fromLeft
    ? clamp(start.width - dx, b.minWidth, Math.min(b.maxWidth, right - EDGE))
    : clamp(start.width + dx, b.minWidth, Math.min(b.maxWidth, viewport.width - EDGE - start.x));
  return fitFrame({ x: fromLeft ? right - width : start.x, y: fromTop ? bottom - height : start.y, width, height }, viewport);
}

/** A remembered window, or null for anything that is not one. */
export function parseFrame(raw: string | null): Frame | null {
  if (!raw || raw.length > 200) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

type Store = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

/** The window this browser remembers; storage that is missing or refuses just means the first place again. */
export function readFrame(storage: () => Store | null): Frame | null {
  try {
    return parseFrame(storage()?.getItem(FRAME_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeFrame(storage: () => Store | null, frame: Frame): void {
  try {
    storage()?.setItem(FRAME_KEY, JSON.stringify(frame));
  } catch {
    // Not remembering costs the person one drag next time, nothing more.
  }
}
