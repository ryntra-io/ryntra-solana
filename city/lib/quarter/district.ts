import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { world, type WorldClient } from './client.ts';
import type { Cell, QuarterSketch } from './types.ts';

/**
 * The newcomers' terrace as the world has it: every claimed quarter of Arrivals, read a page at a time from
 * `GET /api/world/district/arrivals` (docs/city/WORLD-CONTRACT.md), kept for a few minutes and read again rarely. The
 * terrace shows only what lives: the streets with at least one claimed quarter, and one free street after the last
 * of them, where the next newcomer lands.
 */

/** Past this many streets a cell is not believed: a bad row never stretches the terrace across the sea. */
export const MAX_STREETS = 256;

export type ArrivalStreets = {
  /** Streets with at least one claimed quarter, nearest the island first. */
  occupied: number[];
  /** The one free street after the last occupied one. */
  free: number;
  /** How many streets the terrace draws, from the first to the free one. */
  count: number;
};

/** A cell's street, as a row from 0; null for one that is not a street of the terrace. */
const rowOf = (cell: Cell): number | null => {
  const z = Math.floor(cell.z);
  return Number.isFinite(z) && z >= 0 && z < MAX_STREETS ? z : null;
};

/** The streets the terrace shows for these claimed quarters: the occupied ones and one free street after them. */
export function arrivalStreets(cells: readonly Cell[]): ArrivalStreets {
  const rows = new Set<number>();
  for (const c of cells) {
    const row = rowOf(c);
    if (row !== null) rows.add(row);
  }
  const occupied = [...rows].sort((a, b) => a - b);
  const free = occupied.length ? occupied[occupied.length - 1]! + 1 : 0;
  return { occupied, free, count: free + 1 };
}

export type ArrivalsState = {
  /** Every claimed quarter read, one per id. */
  quarters: QuarterSketch[];
  status: 'unread' | 'reading' | 'read' | 'offline';
  /** When the last full read finished (ms, `now`); 0 before the first. */
  readAt: number;
  /** Reads the district again unless the last read is fresh; `force` reads it now. */
  read: (force?: boolean) => Promise<void>;
};

export type ArrivalsOptions = {
  client?: () => WorldClient;
  now?: () => number;
  /** How long a read stays fresh. */
  ttlMs?: number;
  /** At most this many pages a read; the rest waits for the next one. */
  maxPages?: number;
};

export function createArrivalsStore(options: ArrivalsOptions = {}) {
  const client = options.client ?? world;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxPages = options.maxPages ?? 40;
  let reading: Promise<void> | null = null;

  return createStore<ArrivalsState>()((set, get) => ({
    quarters: [],
    status: 'unread',
    readAt: 0,
    read(force = false) {
      if (reading) return reading;
      const { readAt, status } = get();
      if (!force && status === 'read' && now() - readAt < ttlMs) return Promise.resolve();
      if (get().status === 'unread') set({ status: 'reading' });
      reading = (async () => {
        try {
          const byId = new Map<string, QuarterSketch>();
          let cursor: string | null = null;
          for (let page = 0; page < maxPages; page += 1) {
            const res = await client().district('arrivals', cursor);
            for (const q of res.quarters) byId.set(q.id, q);
            if (!res.nextCursor || res.nextCursor === cursor) break;
            cursor = res.nextCursor;
          }
          set({ quarters: [...byId.values()], status: 'read', readAt: now() });
        } catch {
          // What was read stays on the terrace; the next read tries again.
          set({ status: get().quarters.length ? 'read' : 'offline', readAt: now() });
        } finally {
          reading = null;
        }
      })();
      return reading;
    },
  }));
}

export type ArrivalsStore = ReturnType<typeof createArrivalsStore>;

export const arrivalsStore: ArrivalsStore = createArrivalsStore();

export function useArrivals<T>(pick: (state: ArrivalsState) => T): T {
  return useStore(arrivalsStore, pick);
}

// Development hook: lets the screenshot scripts stage a lived-in terrace.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __arrivals: arrivalsStore });
