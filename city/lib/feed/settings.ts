/**
 * What the home's live event feed shows. Five kinds of events and the flashing, each a switch the person
 * sets; the choice is kept on this device. Everything starts on, except the flashing on a device that asks for reduced
 * motion — there it starts off, and the person may still turn it on — and the «Arrivals» card, which starts off on
 * every device since the game left the first screen (CITY-81).
 */

export type FeedKind = 'gainers' | 'losers' | 'inflows' | 'coins' | 'pools';

export const FEED_KINDS: readonly FeedKind[] = ['gainers', 'losers', 'inflows', 'coins', 'pools'];

export type FeedSettings = Readonly<Record<FeedKind, boolean> & { flashing: boolean; hot: boolean; arrivals: boolean }>;

export type FeedSwitch = FeedKind | 'flashing' | 'hot' | 'arrivals';

/** The switches of «Show on home», in the order the panel lists them, with their names on screen. */
export const SWITCHES: readonly Readonly<{ id: FeedSwitch; label: string }>[] = [
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  // «Volume» on screen: the engine has 24-hour volume, not a net inflow. The id stays, so a kept choice still reads.
  { id: 'inflows', label: 'Volume' },
  { id: 'coins', label: 'New coins' },
  { id: 'pools', label: 'New pools' },
  { id: 'flashing', label: 'Flashing effects' },
  // The «Hot now» card above the dock.
  { id: 'hot', label: 'Hot now card' },
  // The «Arrivals» card — a free quarter of your own in the city. Off on every device (CITY-81); turned on, it stands in the Play layer until closed.
  { id: 'arrivals', label: 'Arrivals card' },
];

/** The same switches as the menu's «Settings» shows them: the feed's kinds, the two cards, the flashing. */
export const SETTINGS_GROUPS: readonly (readonly FeedSwitch[])[] = [[...FEED_KINDS], ['hot', 'arrivals'], ['flashing']];

export const SETTINGS_KEY = 'ryntra.city.feed';

/**
 * The kept value's version. 2 (CITY-81): «Arrivals» starts off everywhere, so a choice kept before (a desk that never
 * closed the card, or one that turned it on) is dropped once and the switch follows its new default.
 */
export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: FeedSettings = { gainers: true, losers: true, inflows: true, coins: true, pools: true, flashing: true, hot: true, arrivals: false };

/** The part of `Storage` the settings use, so a test can hand in its own. */
export type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

/**
 * The settings a fresh device starts with: everything on but «Arrivals»; the flashing off where the device asks for
 * reduced motion, and the «Hot now» card off on a phone, where it would cover half the city.
 */
export function defaultSettings(reducedMotion: boolean, phone = false): FeedSettings {
  return { ...DEFAULT_SETTINGS, flashing: !reducedMotion, hot: !phone };
}

/** The kept value, as an object, at this version: one kept before version 2 loses its «Arrivals». Null: nothing kept. */
function keptValue(storage: StorageLike | null | undefined): Record<string, unknown> | null {
  const raw = storage?.getItem(SETTINGS_KEY);
  if (!raw) return null;
  const kept: unknown = JSON.parse(raw);
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return null;
  const out = { ...(kept as Record<string, unknown>) };
  if (out.v !== SETTINGS_VERSION) delete out.arrivals;
  return out;
}

/**
 * Once per device: a value kept before this version is written back at this version, without the switches whose
 * default changed. True when it was rewritten.
 */
export function migrateSettings(storage: StorageLike | null | undefined): boolean {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!storage || !raw) return false;
    const kept: unknown = JSON.parse(raw);
    if (!kept || typeof kept !== 'object' || Array.isArray(kept) || (kept as Record<string, unknown>).v === SETTINGS_VERSION) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...keptValue(storage), v: SETTINGS_VERSION }));
    return true;
  } catch {
    // Nothing readable or nothing kept: the reads below fall back on their own.
    return false;
  }
}

/**
 * The kept choice read back. Every switch the person never touched keeps its default — so reduced motion still decides
 * the flashing until the person sets it — and anything unreadable (no storage, a private window, a broken value) is
 * the defaults.
 */
export function readSettings(storage: StorageLike | null | undefined, reducedMotion: boolean, phone = false): FeedSettings {
  const base = defaultSettings(reducedMotion, phone);
  let kept: Record<string, unknown> | null;
  try {
    kept = keptValue(storage);
  } catch {
    return base;
  }
  if (!kept) return base;
  const out: Record<FeedSwitch, boolean> = { ...base };
  for (const { id } of SWITCHES) {
    const value = kept[id];
    if (typeof value === 'boolean') out[id] = value;
  }
  return out;
}

/**
 * Keeps only what the person set (`touched`), so a switch left alone follows its default on the next visit. False when
 * the device would not keep it: the choice then lasts for this visit.
 */
export function writeSettings(storage: StorageLike | null | undefined, settings: FeedSettings, touched: ReadonlySet<FeedSwitch>): boolean {
  if (!storage) return false;
  const kept: Partial<Record<FeedSwitch, boolean>> & { v: number } = { v: SETTINGS_VERSION };
  for (const { id } of SWITCHES) if (touched.has(id)) kept[id] = settings[id];
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

/** The switches a kept value names: the ones the person set before. */
export function touchedIn(storage: StorageLike | null | undefined): Set<FeedSwitch> {
  const touched = new Set<FeedSwitch>();
  try {
    const kept = keptValue(storage);
    if (!kept) return touched;
    for (const { id } of SWITCHES) if (typeof kept[id] === 'boolean') touched.add(id);
  } catch {
    // Nothing readable: nothing was set.
  }
  return touched;
}

/** One switch flipped. */
export function toggled(settings: FeedSettings, id: FeedSwitch, on: boolean): FeedSettings {
  return { ...settings, [id]: on };
}

/** The kinds the feed shows now. */
export function shownKinds(settings: FeedSettings): ReadonlySet<FeedKind> {
  return new Set(FEED_KINDS.filter((kind) => settings[kind]));
}
