import { carryFree, carryRect, DEFAULT_SIZE, docked, fitRect, MIN, STEP, stuck, type Bay, type Rect, type Size } from './geometry.ts';
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
 * Before CITY-242 the frame first put a window at most 85 % of the workspace's height, and Spot, Earn and «My tower»
 * asked for other sizes than they ask now (these, with their least). A place remembered exactly where and how large
 * the system first put it was never set by the person — remembered all the same, as every place is — and would keep
 * the old smaller window on every device that ever opened it; it is not recalled, so the window opens at its first
 * place of today. A place the person moved, stretched, stuck to another, put in a bay or on the whole screen stays theirs.
 */
const OLD_FIRST: Readonly<Record<string, Readonly<{ size: Size; min: Size }>>> = {
  spot: { size: { width: 980, height: 640 }, min: { width: 380, height: 480 } },
  earn: { size: { width: 680, height: 740 }, min: { width: 380, height: 480 } },
  berth: { size: { width: 760, height: 640 }, min: { width: 380, height: 520 } },
};

const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Where the system first put a window before CITY-242, the n-th new window of a visit: the frame's old rule, kept as it was. */
function oldFirstRect(size: Size, min: Size, area: Rect, index: number): Rect {
  const width = clampTo(size.width, Math.min(min.width, area.width), Math.round(area.width * 0.8));
  const height = clampTo(size.height, Math.min(min.height, area.height), Math.round(area.height * 0.85));
  const step = index * STEP;
  return fitRect({ x: Math.round(area.x + (area.width - width) / 2 + step), y: Math.round(area.y + (area.height - height) / 2 + step), width, height }, area, min);
}

/** What a window asks the frame for: its first size and its least (`WindowSpec`). */
export type Asked = Readonly<{ size?: Size; min?: Partial<Size> }>;

/**
 * A remembered place that is only one of the system's old first places, never the person's own: where the old rule put
 * the window at the size it asked for then (`OLD_FIRST`, or what it asks for now).
 */
export function oldFirstPlace(id: string, place: Readonly<{ rect: Rect; full: boolean; bay?: Bay }>, area: Rect, asked: Asked | null = null, others: readonly Rect[] = []): boolean {
  // Only a window the old rule placed differently from today's: its size changed (`OLD_FIRST`), or it asks for more
  // height than the old rule's 85 % of this workspace gave it. Any other window's first place is the same now — it is
  // kept, so a chip still opens its window where it stood.
  const asks = asked ? { size: asked.size ?? DEFAULT_SIZE, min: { width: Math.max(1, asked.min?.width ?? MIN.width), height: Math.max(1, asked.min?.height ?? MIN.height) } } : null;
  const old = OLD_FIRST[id] ?? (asks && asks.size.height > Math.round(area.height * 0.85) ? asks : null);
  if (!old || place.full || place.bay) return false;
  // Stuck to another window by the person: theirs.
  if (others.some((other) => stuck(place.rect, other))) return false;
  const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  return [0, 1, 2, 3, 4, 5].some((index) => same(oldFirstRect(old.size, old.min, area, index), place.rect));
}

/**
 * The place this device remembers for a window, carried onto the given workspace: its bay, stuck with the others it
 * stuck to, or floating at its own size. One of the system's old first places is not the person's: none (CITY-242).
 */
export function recall(memory: Memory | null, id: string, area: Rect, asked: Asked | null = null): Recall | null {
  const place = memory?.places[id];
  if (!memory || !place) return null;
  const neighbours = Object.entries(memory.places).filter(([other]) => other !== id && !memory.places[other]!.bay).map(([, p]) => p.rect);
  if (oldFirstPlace(id, place, memory.area, asked, neighbours)) return null;
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
