/**
 * The side column's measures. Pure numbers, so the node test reads them as they are.
 *
 * The default follows the window: 400 px on a 1440 desk, wider on a wider one, up to `SIDE_WIDE`. Dragged, the width is
 * the person's, held between `SIDE_MIN` and what leaves the screen's own column at least `MAIN_MIN`.
 */

/** The narrowest a ticket still reads: the amount, the four quick sums and the action on one line each. */
export const SIDE_MIN = 340;
/** The widest the person may drag it on any window. */
export const SIDE_MAX = 760;
/** The widest the default grows on a wide window. */
export const SIDE_WIDE = 480;
/** What the screen's own column keeps at least, beside the side column. */
export const MAIN_MIN = 480;
/** The strip between the two, the handle's own width. */
export const GUTTER = 16;
/** One arrow key's step. */
export const STEP = 16;

/** The default width for a window this wide: 400 at 1440, 22 % of the window and 84 px, up to `SIDE_WIDE`. */
export function sideDefault(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return 400;
  return Math.round(Math.min(SIDE_WIDE, Math.max(380, windowWidth * 0.22 + 84)));
}

/** The widest the side may be in a split this wide. */
export function sideMax(splitWidth: number): number {
  if (!Number.isFinite(splitWidth) || splitWidth <= 0) return SIDE_MAX;
  return Math.max(SIDE_MIN, Math.min(SIDE_MAX, splitWidth - GUTTER - MAIN_MIN));
}

/** A width held between the least and the most a split this wide allows; a width that is no number keeps the default. */
export function sideClamp(width: number, splitWidth: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return Math.min(sideDefault(windowWidth), sideMax(splitWidth));
  return Math.round(Math.min(sideMax(splitWidth), Math.max(SIDE_MIN, width)));
}

/** The width under the pointer: the split's right edge less the pointer, less half the strip it holds. */
export function sideAtPointer(pointerX: number, splitRight: number, splitWidth: number, windowWidth: number): number {
  return sideClamp(splitRight - pointerX - GUTTER / 2, splitWidth, windowWidth);
}

/** One key on the handle: the side column stands on the right, so «left» widens it and «right» narrows it. */
export function sideByKey(key: string, width: number, splitWidth: number, windowWidth: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return sideClamp(width + STEP, splitWidth, windowWidth);
    case 'ArrowRight':
      return sideClamp(width - STEP, splitWidth, windowWidth);
    case 'Home':
      return SIDE_MIN;
    case 'End':
      return sideMax(splitWidth);
    default:
      return null;
  }
}

/** What the browser keeps of the side columns: a width and «folded» per column; anything else read back is dropped. */
export type SideMemory = Record<string, { width: number | null; shut: boolean }>;

export function readSideMemory(raw: string | null): SideMemory {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: SideMemory = {};
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !value || typeof value !== 'object') continue;
    const { width, shut } = value as { width?: unknown; shut?: unknown };
    const w = typeof width === 'number' && Number.isFinite(width) ? Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, width))) : null;
    out[id] = { width: w, shut: shut === true };
  }
  return out;
}
