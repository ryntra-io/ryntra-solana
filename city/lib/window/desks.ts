import { BAYS, bayRect, carryFree, type Bay, type Rect } from './geometry.ts';
import type { Layout, Recall } from './layout.ts';
import { cleanParams, type Params } from './detach.ts';

/**
 * The layouts of the windows (CITY-84, helm §4): four of Ryntra's own — «Trader», «Futures», «Predictions», «Money» —
 * and four of the person's, each a tap away. A layout says which windows stand where: in a bay, as a tab of another,
 * or at a place of their own. The person's four are kept on this device under the connected wallet (a guest's under
 * «guest») and the one in use saves itself with every change the person makes, so a layout is never «saved» by hand.
 * Nothing here opens a window or touches the page: the store places the windows and each window's owner opens it.
 */

export const PRESETS = ['trader', 'futures', 'predict', 'money'] as const;
export type Preset = (typeof PRESETS)[number];
/** The person's own layouts: four, numbered from 0 here and from 1 on the screen. */
export const SLOTS = 4;
export type Slot = 0 | 1 | 2 | 3;
/** The layout in use: one of Ryntra's, or one of the person's. */
export type DeskKey = Preset | Slot;

/** One window of a preset: the bay it stands in, and whether the preset stands without it. */
export type PresetWindow = Readonly<{ id: string; bay: Bay; optional?: boolean }>;

/**
 * Ryntra's four (design A of the helm research), as the city's windows stand together: the trader's card — the coin's
 * chart beside its ticket (the tower's own chart stands in the card's place, CITY-78) — with the wallet's holdings
 * beside it; the futures beside the chart; predictions beside the futures where they are open (helm §3: «щоб стояти
 * поруч із ф'ючерсами»); money on its own.
 */
export const PRESET_WINDOWS: Readonly<Record<Preset, readonly PresetWindow[]>> = {
  trader: [
    { id: 'money', bay: 'left', optional: true },
    { id: 'spot', bay: 'right' },
  ],
  futures: [
    { id: 'chart', bay: 'left', optional: true },
    { id: 'exchange', bay: 'right' },
  ],
  predict: [
    { id: 'exchange', bay: 'left', optional: true },
    { id: 'predict', bay: 'right' },
  ],
  money: [{ id: 'money', bay: 'right' }],
};

/** A preset is offered where every window it cannot do without can open: nothing shut is shown (helm §6–7). */
export function presetReady(preset: Preset, can: (id: string) => boolean): boolean {
  return PRESET_WINDOWS[preset].every((w) => w.optional || can(w.id));
}

/** One window a layout places: where, and what its owner needs to open the same thing (a tower, a market). */
export type Planned = Readonly<{ id: string; recall: Recall; params?: Params }>;

/** A preset's windows on this workspace: each in its bay, those that cannot open here left out. */
export function presetPlan(preset: Preset, area: Rect, can: (id: string) => boolean): Planned[] {
  return PRESET_WINDOWS[preset].filter((w) => can(w.id)).map((w) => ({ id: w.id, recall: { rect: bayRect(area, w.bay), full: false, bay: w.bay } }));
}

/** One window of a layout of the person's: its bay or place, the frame it shares (by number), what it was showing. */
export type ShotWindow = Readonly<{ id: string; bay: Bay | null; rect: Rect; tab: number; params?: Params }>;
/** A layout of the person's, as it stood: on which workspace, the bays' widths, the windows bottom to top. */
export type Shot = Readonly<{ area: Rect; bays: Readonly<Partial<Record<Bay, number>>>; windows: readonly ShotWindow[] }>;

/** The windows on the screen as a layout to keep; null when none is on the screen. */
export function shotOf(layout: Layout, params: (id: string) => Params | undefined): Shot | null {
  const shown = layout.windows;
  if (!shown.length) return null;
  const tabs = new Map<number, number>();
  const windows = shown.map((w) => {
    if (!tabs.has(w.stack)) tabs.set(w.stack, tabs.size);
    const p = params(w.id);
    const own = { id: w.id, bay: w.bay, rect: w.rect, tab: tabs.get(w.stack)! };
    return p && Object.keys(p).length ? { ...own, params: p } : own;
  });
  return { area: layout.area, bays: layout.bays, windows };
}

/**
 * The layout in use, kept up with what is on the screen (CITY-84): the windows on the screen as they stand, and every
 * window it had that is not on the screen now — folded into the tray, closed by its owner for a run or a clip — kept as
 * it was, unless the person closed it themselves (`closed`). Null when nothing would be left; the caller then keeps
 * what it had.
 */
export function mergeShot(before: Shot | null, now: Shot | null, closed: ReadonlySet<string> = new Set()): Shot | null {
  const area = now?.area ?? before?.area;
  if (!area) return null;
  const current = now?.windows ?? [];
  const here = new Set(current.map((w) => w.id));
  const offset = current.reduce((most, w) => Math.max(most, w.tab + 1), 0);
  const kept = (before?.windows ?? [])
    .filter((w) => !here.has(w.id) && !closed.has(w.id))
    .map((w) => ({ ...w, rect: w.bay || !before ? w.rect : carryFree(w.rect, before.area, area), tab: Math.min(WINDOW_LIMIT - 1, w.tab + offset) }));
  const windows = [...kept, ...current].slice(-WINDOW_LIMIT);
  if (!windows.length) return null;
  return { area, bays: now?.bays ?? before?.bays ?? {}, windows };
}

/**
 * A layout of the person's on this workspace, bottom to top: the bays where they were, a floating window carried at
 * its size, and every window after the first of its frame a tab of that first one.
 */
export function shotPlan(shot: Shot, area: Rect): Planned[] {
  const first = new Map<number, string>();
  return shot.windows.map((w) => {
    const host = first.get(w.tab) ?? null;
    if (!host) first.set(w.tab, w.id);
    const rect = w.bay ? bayRect(area, w.bay, shot.bays[w.bay]) : carryFree(w.rect, shot.area, area);
    const recall: Recall = { rect, full: false, bay: w.bay, tab: host };
    return w.params ? { id: w.id, recall, params: w.params } : { id: w.id, recall };
  });
}

// ---------- Kept on the device, per wallet ----------

export const DESKS_KEY = 'ryntra.city.layouts.v1';
/** Wallets whose layouts this device keeps; the one used longest ago goes first. */
export const OWNER_LIMIT = 8;
/** A guest's layouts, before a wallet is connected. */
export const GUEST = 'guest';
const RAW_LIMIT = 48_000;
const WINDOW_LIMIT = 12;
const ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/i;
const OWNER = /^(guest|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export type OwnDesks = Readonly<{ slots: readonly (Shot | null)[]; active: DeskKey | null }>;
/** Every wallet's layouts on this device, the one used longest ago first. */
export type DeskMemory = Readonly<{ owners: Readonly<Record<string, OwnDesks>> }>;

export const NO_DESKS: OwnDesks = { slots: [null, null, null, null], active: null };

type Store = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

const isRect = (value: unknown): value is Rect => {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) && (width as number) > 0 && (height as number) > 0;
};
const rectOf = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
const isBay = (value: unknown): value is Bay => value === 'left' || value === 'right';

export function isDeskKey(value: unknown): value is DeskKey {
  return (typeof value === 'string' && (PRESETS as readonly string[]).includes(value)) || (Number.isInteger(value) && (value as number) >= 0 && (value as number) < SLOTS);
}

/** A kept layout, or null for anything that is not one. A window that is not one is dropped, not trusted. */
export function parseShot(value: unknown): Shot | null {
  if (!value || typeof value !== 'object') return null;
  const { area, bays, windows } = value as Record<string, unknown>;
  if (!isRect(area) || !Array.isArray(windows)) return null;
  const widths: Partial<Record<Bay, number>> = {};
  if (bays && typeof bays === 'object') {
    for (const bay of BAYS) {
      const w = (bays as Record<string, unknown>)[bay];
      if (typeof w === 'number' && Number.isFinite(w) && w > 0) widths[bay] = w;
    }
  }
  const seen = new Set<string>();
  const kept: ShotWindow[] = [];
  for (const raw of windows.slice(0, WINDOW_LIMIT)) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, bay, rect, tab, params } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id) || !isRect(rect) || !Number.isInteger(tab) || (tab as number) < 0 || (tab as number) >= WINDOW_LIMIT) continue;
    seen.add(id);
    const own: ShotWindow = { id, bay: isBay(bay) ? bay : null, rect: rectOf(rect), tab: tab as number };
    const p = cleanParams(params);
    kept.push(Object.keys(p).length ? { ...own, params: p } : own);
  }
  return kept.length ? { area: rectOf(area), bays: widths, windows: kept } : null;
}

/** Every wallet's layouts as the device kept them; anything broken is left out, never trusted. */
export function parseDesks(raw: string | null): DeskMemory {
  const none: DeskMemory = { owners: {} };
  if (!raw || raw.length > RAW_LIMIT) return none;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!value || typeof value !== 'object') return none;
  const { v, owners } = value as Record<string, unknown>;
  if (v !== 1 || !owners || typeof owners !== 'object' || Array.isArray(owners)) return none;
  const kept: Record<string, OwnDesks> = {};
  for (const [owner, own] of Object.entries(owners as Record<string, unknown>).slice(-OWNER_LIMIT)) {
    if (!OWNER.test(owner) || !own || typeof own !== 'object') continue;
    const { slots, active } = own as Record<string, unknown>;
    const list = Array.isArray(slots) ? slots : [];
    kept[owner] = { slots: Array.from({ length: SLOTS }, (_, i) => parseShot(list[i])), active: isDeskKey(active) ? active : null };
  }
  return { owners: kept };
}

export function serializeDesks(memory: DeskMemory): string {
  return JSON.stringify({ v: 1, owners: memory.owners });
}

/** One wallet's layouts: none kept yet means four empty places. */
export function desksOf(memory: DeskMemory, owner: string): OwnDesks {
  return memory.owners[owner] ?? NO_DESKS;
}

/** One wallet's layouts written over what the device kept, that wallet now the newest; the oldest beyond the limit go. */
export function withDesks(memory: DeskMemory, owner: string, own: OwnDesks): DeskMemory {
  if (!OWNER.test(owner)) return memory;
  const owners = Object.entries(memory.owners).filter(([o]) => o !== owner);
  owners.push([owner, own]);
  return { owners: Object.fromEntries(owners.slice(-OWNER_LIMIT)) };
}

/** A layout of the person's kept in place `slot` (null clears it), or a layout put in use. */
export function keepShot(own: OwnDesks, slot: Slot, shot: Shot | null): OwnDesks {
  return { ...own, slots: own.slots.map((s, i) => (i === slot ? shot : s)) };
}

export function readDesks(storage: () => Store | null): DeskMemory {
  try {
    return parseDesks(storage()?.getItem(DESKS_KEY) ?? null);
  } catch {
    return { owners: {} };
  }
}

/**
 * Written for every wallet at once, never larger than a read accepts: the wallets used longest ago go first, so one
 * wallet's layouts never cost another's.
 */
export function writeDesks(storage: () => Store | null, memory: DeskMemory): void {
  try {
    let owners = Object.entries(memory.owners);
    let raw = serializeDesks(memory);
    while (raw.length > RAW_LIMIT && owners.length > 1) {
      owners = owners.slice(1);
      raw = serializeDesks({ owners: Object.fromEntries(owners) });
    }
    if (raw.length > RAW_LIMIT) return;
    storage()?.setItem(DESKS_KEY, raw);
  } catch {
    // Not kept costs the person one arrangement next time, nothing more.
  }
}

/** The key a wallet's layouts are kept under: its address, or «guest» without one. */
export function ownerOf(address: string | null | undefined): string {
  return address && OWNER.test(address) ? address : GUEST;
}
