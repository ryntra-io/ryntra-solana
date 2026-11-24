/**
 * A liquidity shape of one's own, as Meteora's keynote showed it («Create New Strategy»): a grid of 32
 * columns, 16 under the price and 16 over it, each painted 0 to 8 cells tall. The person starts from one of four shapes
 * — the three goals and «Wave» — paints over it with a finger or the mouse, takes a stroke back or puts it again, and
 * keeps a shape as their own under a name.
 *
 * The grid is the engine's own request (`goal: "custom"`, `columns`): the engine lays a side's 16 columns over the
 * width's steps by the rule both share (`lib/core/liquidity-grid.ts`) and builds the SDK's Custom shape from them.
 *
 * **Switch:** `NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE=open` (exactly) — the ticket offers it; what is served is the server's
 * own `RYNTRA_EARN_PRO_SHAPE`.
 *
 * Pure: no I/O but the person's own browser storage, read and written behind try/catch.
 */

import { GRID_COLUMNS, GRID_LEVELS, GRID_SIDE, GRID_WAVE, gridFault } from '../../../lib/core/liquidity-grid.ts';

export const SHAPE_OPEN = process.env.NEXT_PUBLIC_RYNTRA_EARN_PRO_SHAPE === 'open';

/* The grid's measures are the engine's own (`lib/core/liquidity-grid.ts`): one rule for the ticket and the venue. */
export const SIDE = GRID_SIDE;
export const COLUMNS = GRID_COLUMNS;
export const LEVELS = GRID_LEVELS;

export type Columns = readonly number[];

export const PRESETS = ['even', 'near', 'edges', 'wave'] as const;
export type Preset = (typeof PRESETS)[number];

/** Meteora's Wave — a goal and a starting shape — only where its own switch is open (exactly `open`). */
export const WAVE_OPEN = process.env.NEXT_PUBLIC_RYNTRA_EARN_PRO_WAVE === 'open';

/** The shapes «Start from» offers: Wave only with its switch open. */
export function presetsShown(waveOpen: boolean = WAVE_OPEN): readonly Preset[] {
  return waveOpen ? PRESETS : PRESETS.filter((preset) => preset !== 'wave');
}

/** A side drawn from the price outwards — `at(0)` beside the line — as the whole grid, under the price mirrored. */
function mirrored(at: (distance: number) => number): Columns {
  const side = Array.from({ length: SIDE }, (_, distance) => clampCells(Math.round(at(distance))));
  return [...[...side].reverse(), ...side];
}

/**
 * The four shapes a grid starts from. «Even» stands at half the grid's height so that it can be painted up as well as
 * down; «Near price» and «Catch moves» fall and rise as the SDK's Curve and Bid-Ask do; «Wave» is Meteora's own Wave
 * (SDK 0.1.3) as the engine's grid rule draws it (`GRID_WAVE`): even on the half of each side nearer the price, then
 * four steps up to twice that at the edges — on the middle width the SDK's Wave to the step, in nine ranges.
 */
export function presetColumns(preset: Preset): Columns {
  const last = SIDE - 1;
  if (preset === 'even') return mirrored(() => LEVELS / 2);
  if (preset === 'near') return mirrored((distance) => LEVELS - ((LEVELS - 1) * distance) / last);
  if (preset === 'edges') return mirrored((distance) => 1 + ((LEVELS - 1) * distance) / last);
  return [...GRID_WAVE];
}

/** The shape a goal of the form is drawn in, to start a grid from the goal in force. */
export const GOAL_PRESET: Readonly<Record<'even' | 'near' | 'edges' | 'wave', Preset>> = { even: 'even', near: 'near', edges: 'edges', wave: 'wave' };

export const clampCells = (cells: number): number => Math.max(0, Math.min(LEVELS, Math.round(cells)));

/** Whether a value is a grid: 32 whole numbers from 0 to 8. */
export const isColumns = (value: unknown): value is Columns => gridFault(value) !== 'format';


/** The grid with one column set to `cells`. */
export function paintColumn(columns: Columns, column: number, cells: number): Columns {
  if (column < 0 || column >= COLUMNS) return columns;
  const next = clampCells(cells);
  if (columns[column] === next) return columns;
  return columns.map((value, index) => (index === column ? next : value));
}

/**
 * A stroke from one point to the next: every column between the two takes the height on the straight line between
 * them, so a quick drag across the grid leaves no column unpainted.
 */
export function paintStroke(columns: Columns, from: Readonly<{ column: number; cells: number }>, to: Readonly<{ column: number; cells: number }>): Columns {
  const span = Math.abs(to.column - from.column);
  let next = columns;
  for (let step = 0; step <= span; step += 1) {
    const share = span === 0 ? 1 : step / span;
    const column = from.column + Math.sign(to.column - from.column) * step;
    next = paintColumn(next, column, from.cells + (to.cells - from.cells) * share);
  }
  return next;
}

/** The column and the height under a point of the grid, its share across (0…1 left to right) and down (0…1 top to bottom). */
export function cellAt(across: number, down: number): Readonly<{ column: number; cells: number }> {
  const column = Math.max(0, Math.min(COLUMNS - 1, Math.floor(across * COLUMNS)));
  /* A point below the grid's last row clears the column; above its top row, the column is full. */
  const cells = clampCells(Math.ceil((1 - down) * LEVELS));
  return { column, cells };
}

/** A press on a cell: the column takes that height — unless the cell is the column's top, which a press takes off. */
export function pressCells(columns: Columns, at: Readonly<{ column: number; cells: number }>): number {
  return columns[at.column] === at.cells ? at.cells - 1 : at.cells;
}

/* ── strokes taken back and put again ─────────────────────────────────────────────────────────────────────────── */

export type History = Readonly<{ past: readonly Columns[]; present: Columns; future: readonly Columns[] }>;
const KEPT = 40;

export const historyOf = (present: Columns): History => ({ past: [], present, future: [] });

/** A new grid kept: what was is one step back, and nothing stands ahead. */
export function commit(history: History, next: Columns): History {
  if (sameColumns(history.present, next)) return history;
  return { past: [...history.past, history.present].slice(-KEPT), present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export const sameColumns = (a: Columns, b: Columns): boolean => a.length === b.length && a.every((cells, index) => cells === b[index]);

/** A grid as one short word: its 32 heights, a digit each — the Review's key for it. */
export const columnsKey = (columns: Columns): string => columns.join('');

/* ── the person's own shapes ──────────────────────────────────────────────────────────────────────────────────── */

export type SavedShape = Readonly<{ id: string; name: string; columns: Columns }>;

export const SAVED_KEY = 'ryntra.terminal.earn.shapes.v1';
export const MAX_SAVED = 12;
export const MAX_NAME = 24;

/** What the browser kept, read as the person's shapes; anything that is not one is left out. */
export function parseSaved(text: string | null): SavedShape[] {
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const shapes: SavedShape[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, columns } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string' || !isColumns(columns)) continue;
    const trimmed = cleanName(name);
    if (!trimmed) continue;
    seen.add(id);
    shapes.push({ id, name: trimmed, columns: [...columns] });
    if (shapes.length === MAX_SAVED) break;
  }
  return shapes;
}

export const cleanName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** A shape kept under its name, first in the list; one of the same name is replaced, and the oldest beyond twelve let go. */
export function withSaved(saved: readonly SavedShape[], name: string, columns: Columns, id: string): SavedShape[] {
  const clean = cleanName(name);
  if (!clean || !isColumns(columns)) return [...saved];
  const others = saved.filter((shape) => shape.name.toLowerCase() !== clean.toLowerCase());
  return [{ id, name: clean, columns: [...columns] }, ...others].slice(0, MAX_SAVED);
}

export function readSaved(): SavedShape[] {
  try {
    return parseSaved(window.localStorage.getItem(SAVED_KEY));
  } catch {
    return [];
  }
}

export function writeSaved(saved: readonly SavedShape[]): boolean {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

/** The first «My shape N» no kept shape is named. */
export function nextName(saved: readonly SavedShape[], word: (n: string) => string): string {
  for (let n = 1; n <= MAX_SAVED + 1; n += 1) {
    const name = word(String(n));
    if (!saved.some((shape) => shape.name.toLowerCase() === name.toLowerCase())) return name;
  }
  return word(String(saved.length + 1));
}
