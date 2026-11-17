import { create } from 'zustand';
import { readSideMemory, type SideMemory } from './split-rules.ts';

/**
 * The side columns' state: the width the person dragged and whether they folded it, per column (`Split`'s `id`), kept
 * in the browser; and on a phone whether the sheet stands open. Read once after hydration — the server and the first
 * paint have the default width, unfolded.
 */

export const SIDE_KEY = 'ryntra.terminal.side.v1';

type SideState = { memory: SideMemory; read: boolean; sheet: Record<string, boolean> };

export const useSide = create<SideState>(() => ({ memory: {}, read: false, sheet: {} }));

export function hydrateSide(): void {
  if (useSide.getState().read) return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SIDE_KEY);
  } catch {
    raw = null;
  }
  useSide.setState({ memory: readSideMemory(raw), read: true });
}

function keep(memory: SideMemory): void {
  try {
    window.localStorage.setItem(SIDE_KEY, JSON.stringify(memory));
  } catch {
    /* Storage blocked: the width holds for this visit. */
  }
}

function change(id: string, next: Partial<SideMemory[string]>): void {
  const memory = useSide.getState().memory;
  const was = memory[id] ?? { width: null, shut: false };
  const updated = { ...memory, [id]: { ...was, ...next } };
  useSide.setState({ memory: updated });
  keep(updated);
}

/** The person dragged the column to this width; `null` gives it back to the window's default. */
export function setSideWidth(id: string, width: number | null): void {
  change(id, { width });
}

export function setSideShut(id: string, shut: boolean): void {
  change(id, { shut });
}

/** On a phone: the sheet open or folded to its bar. A screen opens it when the person picks a row. */
export function setSheetOpen(id: string, open: boolean): void {
  useSide.setState((st) => ({ sheet: { ...st.sheet, [id]: open } }));
}

/** Opens a column's phone sheet — and unfolds it on a desk, where the person folded it. */
export function openSide(id = 'ticket'): void {
  setSheetOpen(id, true);
  if (useSide.getState().memory[id]?.shut) setSideShut(id, false);
}
