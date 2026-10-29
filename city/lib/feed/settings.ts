/**
 * What the home's live event feed shows. Five kinds of events and the flashing, each a switch the person
 * sets; the choice is kept on this device. Everything starts on, except the flashing on a device that asks for reduced
 * motion — there it starts off, and the person may still turn it on.
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
  // The «Arrivals» card — a free quarter of your own in the city. Off on a phone; on a desk it shows until closed, and its close turns this switch off on the device.
  { id: 'arrivals', label: 'Arrivals card' },
];

/** The same switches as the menu's «Settings» shows them: the feed's kinds, the two cards, the flashing. */
export const SETTINGS_GROUPS: readonly (readonly FeedSwitch[])[] = [[...FEED_KINDS], ['hot', 'arrivals'], ['flashing']];

export const SETTINGS_KEY = 'ryntra.city.feed';

export const DEFAULT_SETTINGS: FeedSettings = { gainers: true, losers: true, inflows: true, coins: true, pools: true, flashing: true, hot: true, arrivals: true };

/** The part of `Storage` the settings use, so a test can hand in its own. */
export type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

/**
 * The settings a fresh device starts with: everything on; the flashing off where the device asks for reduced motion,
 * and the «Hot now» and «Arrivals» cards off on a phone, where they would cover half the city.
 */
export function defaultSettings(reducedMotion: boolean, phone = false): FeedSettings {
  return { ...DEFAULT_SETTINGS, flashing: !reducedMotion, hot: !phone, arrivals: !phone };
}

/**
 * The kept choice read back. Every switch the person never touched keeps its default — so reduced motion still decides
 * the flashing until the person sets it — and anything unreadable (no storage, a private window, a broken value) is
 * the defaults.
 */
export function readSettings(storage: StorageLike | null | undefined, reducedMotion: boolean, phone = false): FeedSettings {
  const base = defaultSettings(reducedMotion, phone);
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    return base;
  }
  if (!raw) return base;
  let kept: unknown;
  try {
    kept = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return base;
  const out: Record<FeedSwitch, boolean> = { ...base };
  for (const { id } of SWITCHES) {
    const value = (kept as Record<string, unknown>)[id];
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
  const kept: Partial<Record<FeedSwitch, boolean>> = {};
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
    const raw = storage?.getItem(SETTINGS_KEY);
    const kept: unknown = raw ? JSON.parse(raw) : null;
    if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return touched;
    for (const { id } of SWITCHES) if (typeof (kept as Record<string, unknown>)[id] === 'boolean') touched.add(id);
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
