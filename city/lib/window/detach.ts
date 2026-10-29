import type { Size } from './geometry.ts';

/**
 * A window of the city on another screen (CITY-75: «a chart onto the second monitor»): the
 * chart, the Exchange — every window whose spec says how to open it again — leaves the city for a window of the
 * browser of its own and comes back with one tap or when that window is closed.
 *
 * Two ways out. In Chrome and Edge, Document Picture-in-Picture: the same React contents move into a window that floats
 * over everything, the styles copied, the wallet and every store the city's own. Elsewhere (Firefox, Safari) a browser
 * window opened on the city's route that draws only that one window, without the 3D city, with the same wallet through
 * the same adapter; the two pages talk over a `BroadcastChannel`. What is out and at what size is remembered on the
 * device. Not on a phone, and not inside the Ryntra app: there is no second screen to move a window to.
 *
 * This file is the rules alone — what can go out and how, the route, the messages, the memory — with no browser in it.
 */

export type Via = 'pip' | 'tab';
export type Out = Readonly<{ via: Via; size: Size }>;

/** The route of the second way: one window of the city, nothing else on the page. */
export const DETACH_ROUTE = '/window';
/** The channel the city and its windows on another screen speak over. */
export const DETACH_CHANNEL = 'ryntra.city.windows.v1';
/** What is out, and every window's size out there, on this device. */
export const DETACH_KEY = 'ryntra.city.windows.out.v1';

/** A window on another screen is never smaller than this, nor larger than the screen it opens on. */
export const OUT_MIN: Size = { width: 360, height: 300 };
export const OUT_DEFAULT: Size = { width: 720, height: 560 };
const RAW_LIMIT = 4_000;
const SIZE_LIMIT = 24;

const ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/i;
const PARAM_KEY = /^[a-z][a-z0-9]{0,15}$/i;
/** A mint, a market's symbol: letters, digits and a few joints, never a path or a script. */
const PARAM_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
const PARAMS_LIMIT = 4;

export type Params = Readonly<Record<string, string>>;

/** Only the parameters a route may carry: short keys, plain values, a few of them. Anything else is dropped. */
export function cleanParams(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const kept: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(kept).length >= PARAMS_LIMIT) break;
    if (key === 'id' || !PARAM_KEY.test(key) || typeof v !== 'string' || !PARAM_VALUE.test(v)) continue;
    kept[key] = v;
  }
  return kept;
}

export const sameParams = (a: Params, b: Params): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/**
 * How a window goes out here, or null when it stays in the city: never on a phone or inside the Ryntra app; Document
 * Picture-in-Picture where the browser has it and it is free (one per page — a second window goes the other way);
 * a browser window otherwise.
 */
export function chooseVia(env: Readonly<{ desk: boolean; app: boolean; pip: boolean; pipBusy: boolean; popup: boolean }>): Via | null {
  if (!env.desk || env.app) return null;
  if (env.pip && !env.pipBusy) return 'pip';
  return env.popup ? 'tab' : null;
}

/** The address of a window on its own: `/window?id=chart&tower=<mint>`. */
export function detachUrl(id: string, params: Params): string {
  if (!ID.test(id)) throw new Error(`not a window id: ${id}`);
  const query = new URLSearchParams({ id, ...cleanParams(params) });
  return `${DETACH_ROUTE}?${query.toString()}`;
}

/** This tab is a window the city opened: kept in the tab's own session, so its own reload stays the window. */
export const OUT_MARK = 'ryntra.city.window.tab.v1';

/**
 * Whether a page on the route was opened by the city: a page of this very site opened it, or this tab already was such
 * a window. A typed address, a bookmark or a link from anywhere else is not a window of the city — it goes to the city.
 */
export function cameFromCity(env: Readonly<{ openerOrigin: string | null; origin: string; marked: boolean }>): boolean {
  return env.marked || (env.openerOrigin !== null && env.openerOrigin === env.origin);
}

/** The window a route asks for, among the ones that can go out; null for anything else. */
export function parseDetachUrl(search: string, known: readonly string[]): Readonly<{ id: string; params: Params }> | null {
  const query = new URLSearchParams(search);
  const id = query.get('id');
  if (!id || !ID.test(id) || !known.includes(id)) return null;
  const params = cleanParams(Object.fromEntries(query.entries()));
  // A tower's chart without its tower shows nothing: not a window.
  if (id === 'chart' && !params.tower) return null;
  return { id, params };
}

/** A size the screen can hold: never under the least, never over what the screen gives. */
export function fitSize(size: Size, screen: Size): Size {
  const width = Math.round(Math.min(Math.max(size.width, OUT_MIN.width), Math.max(OUT_MIN.width, screen.width)));
  const height = Math.round(Math.min(Math.max(size.height, OUT_MIN.height), Math.max(OUT_MIN.height, screen.height)));
  return { width, height };
}

/** A browser window's features: a popup of the size, at the right edge of the screen, where a second screen usually is. */
export function popupFeatures(size: Size, screen: Readonly<{ left: number; top: number; width: number; height: number }>): string {
  const fit = fitSize(size, screen);
  const left = Math.round(screen.left + Math.max(0, screen.width - fit.width - 24));
  const top = Math.round(screen.top + Math.max(0, (screen.height - fit.height) / 3));
  return `popup=yes,width=${fit.width},height=${fit.height},left=${left},top=${top}`;
}

// ---------- The memory ----------

export type OutMemory = Readonly<{
  /** The windows that were out when the person last saw them. */
  out: readonly string[];
  /** Every window's last size out there, oldest first. */
  sizes: Readonly<Record<string, Size>>;
}>;

export const EMPTY_OUT: OutMemory = { out: [], sizes: {} };

const isSize = (value: unknown): value is Size => {
  if (!value || typeof value !== 'object') return false;
  const { width, height } = value as Record<string, unknown>;
  return [width, height].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 20_000);
};

/** The remembered layout out there, or the empty one for anything that is not it. */
export function parseOutMemory(raw: string | null): OutMemory {
  if (!raw || raw.length > RAW_LIMIT) return EMPTY_OUT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_OUT;
  }
  if (!value || typeof value !== 'object') return EMPTY_OUT;
  const { v, out, sizes } = value as Record<string, unknown>;
  if (v !== 1 || !Array.isArray(out) || !sizes || typeof sizes !== 'object' || Array.isArray(sizes)) return EMPTY_OUT;
  const kept: Record<string, Size> = {};
  for (const [id, size] of Object.entries(sizes as Record<string, unknown>).slice(-SIZE_LIMIT)) {
    if (ID.test(id) && isSize(size)) kept[id] = { width: Math.round(size.width), height: Math.round(size.height) };
  }
  const ids = [...new Set(out.filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, SIZE_LIMIT);
  return { out: ids, sizes: kept };
}

export function serializeOutMemory(memory: OutMemory): string {
  return JSON.stringify({ v: 1, out: memory.out, sizes: memory.sizes });
}

/** A window gone out, or come back: whether it is out, and its size out there when one is known. */
export function rememberOut(memory: OutMemory, id: string, out: boolean, size?: Size | null): OutMemory {
  const ids = memory.out.filter((other) => other !== id);
  const sizes: Record<string, Size> = { ...memory.sizes };
  if (size && isSize(size)) {
    delete sizes[id];
    sizes[id] = { width: Math.round(size.width), height: Math.round(size.height) };
  }
  const keys = Object.keys(sizes).slice(-SIZE_LIMIT);
  return { out: out ? [...ids, id] : ids, sizes: Object.fromEntries(keys.map((k) => [k, sizes[k]!])) };
}

export const wasOut = (memory: OutMemory, id: string): boolean => memory.out.includes(id);
export const outSize = (memory: OutMemory, id: string, fallback: Size = OUT_DEFAULT): Size => memory.sizes[id] ?? fallback;

type Storage = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

export function readOutMemory(storage: () => Storage | null): OutMemory {
  try {
    return parseOutMemory(storage()?.getItem(DETACH_KEY) ?? null);
  } catch {
    return EMPTY_OUT;
  }
}

export function writeOutMemory(storage: () => Storage | null, memory: OutMemory): void {
  try {
    storage()?.setItem(DETACH_KEY, serializeOutMemory(memory));
  } catch {
    // Not remembering means the window opens in the city next time, nothing more.
  }
}

// ---------- The messages between the city and a window on its own ----------

export type Message =
  /** The city has (re)loaded: every window on its own says it is there. */
  | Readonly<{ t: 'hello' }>
  /** A window on its own is open, showing this. */
  | Readonly<{ t: 'here'; id: string; params: Params }>
  /** A window on its own was closed by the person, at this size: its contents come back to the city. */
  | Readonly<{ t: 'gone'; id: string; size: Size | null }>
  /** The city takes the window back: the window on its own closes. */
  | Readonly<{ t: 'return'; id: string }>
  /** What the window shows changed in the city (another tower picked): the window on its own follows. */
  | Readonly<{ t: 'follow'; id: string; params: Params }>;

/** A message from another page of this site, or null for anything that is not one. */
export function parseMessage(data: unknown): Message | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.t === 'hello') return { t: 'hello' };
  if (typeof m.id !== 'string' || !ID.test(m.id)) return null;
  const id = m.id;
  switch (m.t) {
    case 'here':
    case 'follow':
      return { t: m.t, id, params: cleanParams(m.params) };
    case 'gone':
      return { t: 'gone', id, size: isSize(m.size) ? { width: Math.round(m.size.width), height: Math.round(m.size.height) } : null };
    case 'return':
      return { t: 'return', id };
    default:
      return null;
  }
}
