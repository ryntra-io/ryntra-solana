/**
 * Where the Money window stands on a computer: dragged by its head, stretched by any corner, always whole on the
 * screen, remembered in this browser. It opens on the left, so the trade card — which opens on the right — and the
 * city's centre stay in view. On a phone the window is the bottom sheet and none of this applies.
 */

export type Frame = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Viewport = Readonly<{ width: number; height: number }>;
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** From this screen width the window floats; below it, the bottom sheet. */
export const WINDOWED_FROM = 900;
export const FRAME_MIN = { width: 400, height: 460 } as const;
export const FRAME_MAX = { width: 680, height: 960 } as const;
/** The window never comes closer than this to the screen's edge. */
export const EDGE = 8;

export const FRAME_KEY = 'ryntra.city.money-window.v1';

const LEFT = 16;
/** Room for the top bar above the window as it first opens. */
const TOP = 76;
const BOTTOM = 24;
const WIDTH = 480;
const HEIGHT = 720;

export function windowed(viewport: Viewport): boolean {
  return viewport.width >= WINDOWED_FROM;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function bounds(viewport: Viewport) {
  const maxWidth = Math.max(0, Math.min(FRAME_MAX.width, viewport.width - 2 * EDGE));
  const maxHeight = Math.max(0, Math.min(FRAME_MAX.height, viewport.height - 2 * EDGE));
  return { minWidth: Math.min(FRAME_MIN.width, maxWidth), maxWidth, minHeight: Math.min(FRAME_MIN.height, maxHeight), maxHeight };
}

/** The window as it first opens: on the left, under the top bar. */
export function defaultFrame(viewport: Viewport): Frame {
  const b = bounds(viewport);
  const width = clamp(WIDTH, b.minWidth, b.maxWidth);
  const height = clamp(Math.min(HEIGHT, viewport.height - TOP - BOTTOM), b.minHeight, b.maxHeight);
  return fitFrame({ x: LEFT, y: Math.max(TOP, viewport.height - BOTTOM - height), width, height }, viewport);
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

export function moveFrame(start: Frame, dx: number, dy: number, viewport: Viewport): Frame {
  return fitFrame({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
}

/** Stretched by a corner: the two edges across from it stay where they were. */
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
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

type Store = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

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
    // Not remembering costs one drag next time.
  }
}

/** A drag down the phone sheet's handle past this closes it. */
export const SHEET_CLOSE_PX = 90;
