/**
 * The coin's trading desk: its measures, pure. The chart is the main area; beside it a narrow column of the market's trades
 * and the pool's liquidity; on the right the ticket, the whole height; under the chart and the column the bottom panel.
 * Every border between them is dragged by the person, each panel folds, and the browser keeps the choice.
 *
 * Numbers only, so the node test reads them as they are; the screen (`Desk.tsx`) and its store (`desk-store.ts`) use them.
 */

/** The three measures the person can drag: the trades column's width, the ticket's width, the bottom panel's height. */
export type DeskPart = 'tape' | 'ticket' | 'bottom';
export const DESK_PARTS: readonly DeskPart[] = ['tape', 'ticket', 'bottom'];

/** What the person set: a measure each (null — the window's default) and which parts are folded. */
export type DeskMemory = Readonly<{
  tape: number | null;
  ticket: number | null;
  bottom: number | null;
  folded: Readonly<Record<DeskPart, boolean>>;
}>;

export const DESK_EMPTY: DeskMemory = { tape: null, ticket: null, bottom: null, folded: { tape: false, ticket: false, bottom: false } };

/** The strip between two panels, the handle's own size. */
export const DESK_GUTTER = 8;
/** A folded column keeps this much: its name turned on its side and the button that brings it back. */
export const DESK_FOLDED_COL = 40;
/** A folded bottom panel keeps its row of tabs. */
export const DESK_FOLDED_ROW = 44;
/** One arrow key's step on a handle. */
export const DESK_STEP = 16;

/** The chart keeps at least this much beside the columns and over the bottom panel. */
export const CHART_MIN_W = 420;
export const CHART_MIN_H = 300;

/** Each measure's least and most. */
export const DESK_LIMITS: Readonly<Record<DeskPart, Readonly<{ min: number; max: number }>>> = {
  tape: { min: 220, max: 460 },
  ticket: { min: 320, max: 560 },
  bottom: { min: 132, max: 640 },
};

/**
 * The desk's three columns stand side by side from this width of the desk itself; a narrower desk keeps the chart and
 * the ticket, and the market's trades and liquidity become tabs of the bottom panel.
 */
export const DESK_WIDE = 1080;

/**
 * A desk taller than this gives most of the height above it to the bottom panel, up to `BOTTOM_TALL_MAX`: on a 1920×1080
 * window the market's trades show five whole rows, not two (EYES 19.11, вада 12), and the chart keeps the larger part.
 */
export const BOTTOM_TALL_FROM = 740;
export const BOTTOM_TALL_MAX = 320;

/** The defaults follow the room: a 1920 window gives the trades 300 and the ticket 380; a 1440 one 252 and 340. */
export function deskDefault(part: DeskPart, deskWidth: number, deskHeight: number): number {
  const w = Number.isFinite(deskWidth) && deskWidth > 0 ? deskWidth : 1156;
  const h = Number.isFinite(deskHeight) && deskHeight > 0 ? deskHeight : 760;
  switch (part) {
    case 'tape':
      return Math.round(clampTo(w * 0.1 + 136, 236, 320));
    case 'ticket':
      return Math.round(clampTo(w * 0.083 + 244, 330, 400));
    case 'bottom':
      return Math.round(h > BOTTOM_TALL_FROM ? clampTo(h * 0.24 + 20 + (h - BOTTOM_TALL_FROM) * 1.6, 180, BOTTOM_TALL_MAX) : clampTo(h * 0.24 + 20, 180, 260));
  }
}

const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether the desk is wide enough for the trades column beside the chart. */
export const deskWide = (deskWidth: number): boolean => Number.isFinite(deskWidth) && deskWidth >= DESK_WIDE;

/**
 * The most a measure may be on a desk this big: what leaves the chart its least. The two columns share the width, so
 * each one's most counts the other as it stands (folded, it keeps its strip).
 */
export function deskMax(part: DeskPart, deskWidth: number, deskHeight: number, other: number): number {
  const limit = DESK_LIMITS[part];
  if (part === 'bottom') return Math.max(limit.min, Math.min(limit.max, deskHeight - DESK_GUTTER - CHART_MIN_H));
  return Math.max(limit.min, Math.min(limit.max, deskWidth - CHART_MIN_W - other - 2 * DESK_GUTTER));
}

/** A measure as it stands: the person's, held between its least and its most; no measure of theirs — the default. */
export function deskClamp(part: DeskPart, kept: number | null, deskWidth: number, deskHeight: number, other: number): number {
  const max = deskMax(part, deskWidth, deskHeight, other);
  const want = kept !== null && Number.isFinite(kept) ? kept : deskDefault(part, deskWidth, deskHeight);
  return Math.round(Math.min(max, Math.max(DESK_LIMITS[part].min, want)));
}

/**
 * The measure under the pointer. A column stands to the right of its handle, so the pointer moving left widens it:
 * the width is from the pointer to the column's far edge. The bottom panel stands under its handle: the height is from
 * the pointer to the desk's foot.
 */
export function deskAtPointer(part: DeskPart, pointer: number, farEdge: number): number {
  return Math.round(farEdge - pointer - DESK_GUTTER / 2);
}

/** One key on a handle: «left» and «up» make the column or the panel bigger, «right» and «down» smaller. */
export function deskByKey(key: string, value: number, min: number, max: number): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.min(max, value + DESK_STEP);
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.max(min, value - DESK_STEP);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return null;
  }
}

/** What the browser kept, read back: anything that is not a measure of ours is dropped, never trusted. */
export function readDeskMemory(raw: string | null): DeskMemory {
  if (!raw) return DESK_EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DESK_EMPTY;
  }
  if (!parsed || typeof parsed !== 'object') return DESK_EMPTY;
  const row = parsed as Record<string, unknown>;
  const measure = (part: DeskPart): number | null => {
    const value = row[part];
    return typeof value === 'number' && Number.isFinite(value) && value >= DESK_LIMITS[part].min && value <= DESK_LIMITS[part].max ? Math.round(value) : null;
  };
  const folds = row.folded && typeof row.folded === 'object' ? (row.folded as Record<string, unknown>) : {};
  return {
    tape: measure('tape'),
    ticket: measure('ticket'),
    bottom: measure('bottom'),
    folded: { tape: folds.tape === true, ticket: folds.ticket === true, bottom: folds.bottom === true },
  };
}

/**
 * The desk's grid as it stands: the columns' widths and the bottom row's height, each folded part at its strip. The
 * trades column is absent on a narrow desk (0).
 */
export function deskGrid(memory: DeskMemory, deskWidth: number, deskHeight: number): Readonly<{ wide: boolean; tape: number; ticket: number; bottom: number }> {
  const wide = deskWide(deskWidth);
  const ticketFolded = memory.folded.ticket;
  const tapeFolded = memory.folded.tape;
  // The ticket is held first, against the column's least; the column then takes what is left beside it. A drag is held
  // against the other part as it stands (Desk.tsx), so it never squeezes it; only a window that narrows makes the column
  // give way before the ticket.
  const ticketGuess = ticketFolded ? DESK_FOLDED_COL : deskClamp('ticket', memory.ticket, deskWidth, deskHeight, wide ? DESK_LIMITS.tape.min : 0);
  const tape = !wide ? 0 : tapeFolded ? DESK_FOLDED_COL : deskClamp('tape', memory.tape, deskWidth, deskHeight, ticketGuess);
  const ticket = ticketFolded ? DESK_FOLDED_COL : deskClamp('ticket', memory.ticket, deskWidth, deskHeight, tape);
  const bottom = memory.folded.bottom ? DESK_FOLDED_ROW : deskClamp('bottom', memory.bottom, deskWidth, deskHeight, 0);
  return { wide, tape, ticket, bottom };
}
