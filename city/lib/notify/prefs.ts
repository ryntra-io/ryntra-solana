import { CAPS, KINDS, kindOf, PLACES, type Cap, type NoteKind, type Place } from './kinds.ts';

/**
 * The person's notification centre, kept on this device (CITY-87): where each kind goes and how often, where the
 * banners stand, which side the live feed opens on, how big a flash is, the quiet hours and «Mute all». Everything
 * starts where the kinds say (`./kinds.ts`); a value this version cannot read is its start again, never an error.
 *
 * Two choices stay where they were made before this centre (CITY-66), so a choice kept on a device still reads: whether
 * a market kind shows at all, and whether the city flashes at all — the feed's switches (`../feed/settings.ts`). Here
 * a market kind keeps only «in the city» or «on the computer», and the flash only its size.
 *
 * The liquidation risk is never off (decision 88): a kept «off» for it reads as its start, `setRoute` refuses it, and
 * neither «Mute all» nor the quiet hours nor a cap hold it (`./gate.ts`).
 */

/** Where the banners stand: one of four corners, or at the top in the middle. */
export const CORNERS = ['top-left', 'top', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Corner = (typeof CORNERS)[number];

/** Which side the live feed's panel opens on, or no feed in the top bar at all. */
export const FEED_SIDES = ['left', 'right', 'hidden'] as const;
export type FeedSide = (typeof FEED_SIDES)[number];

/** The size of the city's flashes, when the city flashes at all: a small call-out, or the full-width slab. */
export const FLASH_SIZES = ['small', 'cinema'] as const;
export type FlashSize = (typeof FLASH_SIZES)[number];
/** The three steps the window shows: off is the feed's own flashing switch. */
export type Flash = 'off' | FlashSize;

/** A local wall-clock window, `HH:MM` to `HH:MM`, that may cross midnight. */
export type Quiet = Readonly<{ on: boolean; from: string; to: string }>;

export type NotifyPrefs = Readonly<{
  routes: Readonly<Record<NoteKind, Place>>;
  caps: Readonly<Record<NoteKind, Cap>>;
  corner: Corner;
  feed: FeedSide;
  flash: FlashSize;
  quiet: Quiet;
  muted: boolean;
}>;

export const NOTIFY_KEY = 'ryntra.city.notify';
export const NOTIFY_VERSION = 1;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultPrefs(): NotifyPrefs {
  return {
    routes: Object.fromEntries(KINDS.map((kind) => [kind.id, kind.start])) as Record<NoteKind, Place>,
    caps: Object.fromEntries(KINDS.map((kind) => [kind.id, kind.cap])) as Record<NoteKind, Cap>,
    corner: 'top-right',
    feed: 'right',
    flash: 'cinema',
    quiet: { on: false, from: '23:00', to: '08:00' },
    muted: false,
  };
}

/** The part of `Storage` the centre uses, so a test can hand in its own. */
export type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => ((list as readonly unknown[]).includes(value) ? (value as T) : fallback);

/** A kept value read against this version: every field this version cannot read is its start. */
export function sanitizePrefs(raw: unknown): NotifyPrefs {
  const base = defaultPrefs();
  const kept = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const routes = kept.routes && typeof kept.routes === 'object' ? (kept.routes as Record<string, unknown>) : {};
  const caps = kept.caps && typeof kept.caps === 'object' ? (kept.caps as Record<string, unknown>) : {};
  const quiet = kept.quiet && typeof kept.quiet === 'object' ? (kept.quiet as Record<string, unknown>) : {};
  return {
    // A place the kind cannot go — «off» for the liquidation risk among them — is the kind's start.
    routes: Object.fromEntries(KINDS.map((kind) => [kind.id, oneOf(kind.places, routes[kind.id], kind.start)])) as Record<NoteKind, Place>,
    caps: Object.fromEntries(KINDS.map((kind) => [kind.id, kind.locked ? 'all' : oneOf(CAPS, caps[kind.id], kind.cap)])) as Record<NoteKind, Cap>,
    corner: oneOf(CORNERS, kept.corner, base.corner),
    feed: oneOf(FEED_SIDES, kept.feed, base.feed),
    flash: oneOf(FLASH_SIZES, kept.flash, base.flash),
    quiet: {
      on: typeof quiet.on === 'boolean' ? quiet.on : base.quiet.on,
      from: typeof quiet.from === 'string' && CLOCK.test(quiet.from) ? quiet.from : base.quiet.from,
      to: typeof quiet.to === 'string' && CLOCK.test(quiet.to) ? quiet.to : base.quiet.to,
    },
    muted: typeof kept.muted === 'boolean' ? kept.muted : base.muted,
  };
}

/** The kept centre; anything unreadable — no storage, a private window, a broken value — is the start. */
export function readPrefs(storage: StorageLike | null | undefined): NotifyPrefs {
  try {
    const raw = storage?.getItem(NOTIFY_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

/** Kept on this device. False when the device would not keep it: the choice then lasts for this visit. */
export function writePrefs(storage: StorageLike | null | undefined, prefs: NotifyPrefs): boolean {
  if (!storage) return false;
  try {
    storage.setItem(NOTIFY_KEY, JSON.stringify({ v: NOTIFY_VERSION, ...prefs }));
    return true;
  } catch {
    return false;
  }
}

/** One kind sent somewhere else. A place the kind cannot go changes nothing — the liquidation risk is never off. */
export function setRoute(prefs: NotifyPrefs, id: NoteKind, place: Place): NotifyPrefs {
  if (!(PLACES as readonly string[]).includes(place) || !kindOf(id).places.includes(place)) return prefs;
  return prefs.routes[id] === place ? prefs : { ...prefs, routes: { ...prefs.routes, [id]: place } };
}

/** One kind's cap. A locked kind speaks every time. */
export function setCap(prefs: NotifyPrefs, id: NoteKind, cap: Cap): NotifyPrefs {
  if (kindOf(id).locked || !(CAPS as readonly string[]).includes(cap)) return prefs;
  return prefs.caps[id] === cap ? prefs : { ...prefs, caps: { ...prefs.caps, [id]: cap } };
}

/** The quiet hours changed; a clock that is not `HH:MM` keeps the one before. */
export function setQuiet(prefs: NotifyPrefs, change: Partial<Quiet>): NotifyPrefs {
  const quiet = {
    on: typeof change.on === 'boolean' ? change.on : prefs.quiet.on,
    from: typeof change.from === 'string' && CLOCK.test(change.from) ? change.from : prefs.quiet.from,
    to: typeof change.to === 'string' && CLOCK.test(change.to) ? change.to : prefs.quiet.to,
  };
  return { ...prefs, quiet };
}

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Whether `at` falls in the quiet hours, by this device's clock. A window from a time to the same time is none. */
export function inQuiet(quiet: Quiet, at: Date): boolean {
  if (!quiet.on) return false;
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  if (from === to) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Where a kind goes as the window shows it. A market kind the feed does not show is «off» whatever this centre keeps;
 * one it shows goes where this centre says, never «off» (that is the feed's switch).
 */
export function routeShown(prefs: NotifyPrefs, id: NoteKind, feedShows: (kind: NoteKind) => boolean): Place {
  const spec = kindOf(id);
  if (spec.feed === null) return prefs.routes[id];
  if (!feedShows(id)) return 'off';
  return prefs.routes[id] === 'off' ? 'city' : prefs.routes[id];
}

/** The three steps of the flashes as the window shows them: off is the feed's switch; on, the size kept here. */
export function flashShown(prefs: NotifyPrefs, flashing: boolean): Flash {
  return flashing ? prefs.flash : 'off';
}
