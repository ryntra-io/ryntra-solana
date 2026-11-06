import { carryFree, carryRect, docked, type Bay, type Rect } from './geometry.ts';
import type { Layout, Recall } from './layout.ts';

/**
 * The windows' places, remembered on this device (CITY-65): every window that has stood on the screen keeps its last
 * place, open or closed, so the swap opens again where the person put it and four windows stuck together come back
 * stuck. A place is remembered with the workspace it was on and carried onto a different one. Storage that is
 * missing, full or refuses just means the first places again.
 *
 * Since CITY-84 a place may be a bay (`bay`): the window opens in it again, as a tab of the frame standing there. The
 * key moved to v2 with the bays, so every window first opens in a bay once; to v3 when a new window opened in the
 * middle instead, so every remembered bay is forgotten once.
 */

export const LAYOUT_KEY = 'ryntra.city.windows.v3';
/** No more places than this are kept; the oldest go first. */
export const MEMORY_LIMIT = 24;
const RAW_LIMIT = 8_000;

export type Memory = Readonly<{
  area: Rect;
  /** Oldest first. */
  places: Readonly<Record<string, Place>>;
}>;

type Place = Readonly<{ rect: Rect; full: boolean; bay?: Bay }>;

type Store = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

const isRect = (value: unknown): value is Rect => {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) && (width as number) > 0 && (height as number) > 0;
};

const ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/i;

/** The remembered places, or null for anything that is not them. A place that is not one is dropped, not trusted. */
export function parseMemory(raw: string | null): Memory | null {
  if (!raw || raw.length > RAW_LIMIT) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { v, area, places } = value as Record<string, unknown>;
  if (v !== 2 || !isRect(area) || !places || typeof places !== 'object' || Array.isArray(places)) return null;
  const kept: Record<string, Place> = {};
  for (const [id, place] of Object.entries(places as Record<string, unknown>).slice(-MEMORY_LIMIT)) {
    if (!ID.test(id) || !place || typeof place !== 'object') continue;
    const { rect, full, bay } = place as Record<string, unknown>;
    if (!isRect(rect)) continue;
    const kept1 = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, full: full === true };
    kept[id] = bay === 'left' || bay === 'right' ? { ...kept1, bay } : kept1;
  }
  return { area: { x: area.x, y: area.y, width: area.width, height: area.height }, places: kept };
}

export function serializeMemory(memory: Memory): string {
  return JSON.stringify({ v: 2, area: memory.area, places: memory.places });
}

/**
 * The open windows' places written over what the device remembered, every older place carried onto the current
 * workspace first. Only one window is remembered on the whole screen.
 */
export function remember(memory: Memory | null, layout: Layout): Memory {
  const places: Record<string, Place> = {};
  for (const [id, place] of Object.entries(memory?.places ?? {})) {
    if (layout.windows.some((w) => w.id === id)) continue;
    places[id] = { ...place, rect: memory ? carryRect(place.rect, memory.area, layout.area) : place.rect, full: layout.full ? false : place.full };
  }
  for (const w of layout.windows) places[w.id] = w.bay ? { rect: w.rect, full: layout.full === w.id, bay: w.bay } : { rect: w.rect, full: layout.full === w.id };
  const ids = Object.keys(places).slice(-MEMORY_LIMIT);
  return { area: layout.area, places: Object.fromEntries(ids.map((id) => [id, places[id]!])) };
}

/**
 * The place this device remembers for a window, carried onto the given workspace: its bay, stuck with the others it
 * stuck to, or floating at its own size.
 */
export function recall(memory: Memory | null, id: string, area: Rect): Recall | null {
  const place = memory?.places[id];
  if (!memory || !place) return null;
  if (place.bay) return { rect: carryRect(place.rect, memory.area, area), full: place.full, bay: place.bay };
  const others = Object.entries(memory.places).filter(([other]) => other !== id && !memory.places[other]!.bay).map(([, p]) => p.rect);
  const stuckThere = docked(place.rect, others, memory.area);
  return { rect: stuckThere ? carryRect(place.rect, memory.area, area) : carryFree(place.rect, memory.area, area), full: place.full, docked: stuckThere };
}

export function readMemory(storage: () => Store | null): Memory | null {
  try {
    return parseMemory(storage()?.getItem(LAYOUT_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeMemory(storage: () => Store | null, memory: Memory): void {
  try {
    storage()?.setItem(LAYOUT_KEY, serializeMemory(memory));
  } catch {
    // Not remembering costs the person one drag next time, nothing more.
  }
}
