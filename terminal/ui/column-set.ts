/**
 * Which columns a table shows: density is not a mode of the terminal, it is a quiet choice on the table itself.
 * Two sets — the main columns and all of them. The browser remembers the choice per table; with nothing remembered a
 * wide window (1680 px and more) starts with all, and so does a person who had kept the old «Pro» look on.
 * Pure rules here; the hook and the control are in `./Columns.tsx`.
 */

export type ColumnSet = 'main' | 'all';

/** A window this wide has room for every column. */
export const WIDE_PX = 1680;

/** The old «Pro» switch's place in the browser's memory: read once, never written. */
export const OLD_PRO_KEY = 'ryntra.terminal.pro.v1';

export const columnsKey = (table: string): string => `ryntra.terminal.columns.${table}.v1`;

/** The set a table starts with: what the person chose, else all on a wide window or after «Pro», else the main ones. */
export function startSet(kept: string | null, width: number, oldPro: string | null): ColumnSet {
  if (kept === 'main' || kept === 'all') return kept;
  return width >= WIDE_PX || oldPro === '1' ? 'all' : 'main';
}
