import { create } from 'zustand';
import { DESK_EMPTY, readDeskMemory, type DeskMemory, type DeskPart } from './desk-rules.ts';

/**
 * What the person set on the coin's desk: the trades column's and the ticket's widths, the bottom panel's
 * height, which parts are folded. Kept in this browser for every coin alike; read once after hydration, so the server
 * and the first paint stand on the defaults.
 */

export const DESK_KEY = 'ryntra.coin.desk.v1';

type DeskState = Readonly<{ memory: DeskMemory; read: boolean }>;

export const useDesk = create<DeskState>(() => ({ memory: DESK_EMPTY, read: false }));

export function hydrateDesk(): void {
  if (useDesk.getState().read) return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DESK_KEY);
  } catch {
    raw = null;
  }
  useDesk.setState({ memory: readDeskMemory(raw), read: true });
}

function keep(memory: DeskMemory): void {
  useDesk.setState({ memory });
  try {
    window.localStorage.setItem(DESK_KEY, JSON.stringify(memory));
  } catch {
    /* Storage blocked: the desk holds for this visit. */
  }
}

/** The person dragged a measure; null gives it back to the window's default. */
export function setDeskMeasure(part: DeskPart, value: number | null): void {
  const memory = useDesk.getState().memory;
  keep({ ...memory, [part]: value === null ? null : Math.round(value) });
}

export function setDeskFolded(part: DeskPart, folded: boolean): void {
  const memory = useDesk.getState().memory;
  keep({ ...memory, folded: { ...memory.folded, [part]: folded } });
}
