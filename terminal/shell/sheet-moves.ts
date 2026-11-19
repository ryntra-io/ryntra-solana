/**
 * How the phone's menu sheet goes, as pure rules the sheet and its tests share:
 * - a pull down on its head, or on its list scrolled to the top, takes it away once it is long enough or quick enough;
 * - it stands on an entry of the page's history of its own (the same address), so the phone's «Back» closes it rather
 *   than leaving the page; the rest of the entry's state — Next.js's own — is kept as it is.
 */

/** A pull this long takes the sheet away, however slow. */
export const PULL_AWAY_PX = 96;
/** A shorter pull takes it away when flicked: at least this far, at least this fast (px a millisecond). */
export const FLICK_PX = 24;
export const FLICK_SPEED = 0.5;
/** A finger moves this far before the sheet follows it: a tap stays a tap. */
export const PULL_SLOP_PX = 6;

/** Whether a pull down by `dy` px that took `ms` takes the sheet away; otherwise it settles back. */
export function pullCloses(dy: number, ms: number): boolean {
  if (!(dy > 0)) return false;
  if (dy >= PULL_AWAY_PX) return true;
  return dy >= FLICK_PX && dy / Math.max(ms, 1) >= FLICK_SPEED;
}

/** The key of the sheet's mark in a history entry's state. */
export const SHEET_KEY = '__ryntraMenu';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The entry the sheet stands on: the page's own state with the sheet's mark beside it. */
export function sheetEntry(state: unknown): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), [SHEET_KEY]: true };
}

/** An entry's state without the sheet's mark: the page's own state as it was. */
export function withoutSheet(state: unknown): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(isRecord(state) ? state : {}) };
  delete rest[SHEET_KEY];
  return rest;
}

/** Whether a history entry's state is the sheet's own. */
export function isSheetEntry(state: unknown): boolean {
  return isRecord(state) && state[SHEET_KEY] === true;
}
