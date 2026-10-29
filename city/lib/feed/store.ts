import { create } from 'zustand';
import { advance, emptyFeed, type FeedInput, type FeedMemory } from './feed.ts';
import { defaultSettings, readSettings, shownKinds, toggled, touchedIn, writeSettings, type FeedSettings, type FeedSwitch, type StorageLike } from './settings.ts';
import { browserStorage, flashingOn, prefersReducedMotion, resetMotion, setFlashing, useFlashing } from './motion.ts';

export { flashingOn, useFlashing };

/**
 * The feed's state for the page: the person's switches (kept on this device) and the events so far. The switches are
 * read after the first paint, so the server's page and the browser's agree; until then everything is on, and a device
 * asking for reduced motion has the flashing off from its first read. The flashing switch is handed to `./motion.ts`,
 * the one question the city's banners and flashes ask before they flash.
 */

type FeedStore = {
  settings: FeedSettings;
  /** The switches the person set; the rest follow their defaults. */
  touched: ReadonlySet<FeedSwitch>;
  reducedMotion: boolean;
  /** True once the kept switches were read. */
  ready: boolean;
  memory: FeedMemory;
  set: (id: FeedSwitch, on: boolean) => void;
  step: (input: FeedInput) => void;
};

let storage: StorageLike | null = null;

export const useFeed = create<FeedStore>((set, get) => ({
  settings: defaultSettings(false),
  touched: new Set(),
  reducedMotion: false,
  ready: false,
  memory: emptyFeed(),
  set: (id, on) => {
    const settings = toggled(get().settings, id, on);
    const touched = new Set(get().touched).add(id);
    // A device that will not keep it (a private window) still has the choice for this visit.
    writeSettings(storage, settings, touched);
    set({ settings, touched });
  },
  step: (input) => {
    const { memory, settings } = get();
    const next = advance(memory, input, shownKinds(settings));
    if (next !== memory) set({ memory: next });
  },
}));

/** Reads the kept switches and the device's motion setting once; later calls do nothing. */
export function hydrateFeed(env?: Readonly<{ storage: StorageLike | null; reducedMotion: boolean; phone?: boolean }>): void {
  if (useFeed.getState().ready) return;
  const reduced = env ? env.reducedMotion : prefersReducedMotion();
  const phone = env ? env.phone === true : isPhone();
  storage = env ? env.storage : browserStorage();
  useFeed.setState({ settings: readSettings(storage, reduced, phone), touched: touchedIn(storage), reducedMotion: reduced, ready: true });
  if (!env) watchMotion();
}

/** A screen as tall as it is wide or taller — the city's phone layout. */
function isPhone(): boolean {
  try {
    return window.matchMedia?.('(max-aspect-ratio: 1/1)').matches ?? false;
  } catch {
    return false;
  }
}

/** Back to a fresh page (tests). */
export function resetFeed(): void {
  storage = null;
  useFeed.setState({ settings: defaultSettings(false), touched: new Set(), reducedMotion: false, ready: false, memory: emptyFeed() });
  resetMotion();
}

/** A device that changes its motion setting while the page is open: an untouched flashing switch follows it. */
function watchMotion() {
  try {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    query?.addEventListener?.('change', (event) => {
      const st = useFeed.getState();
      useFeed.setState({ reducedMotion: event.matches, ...(st.touched.has('flashing') ? {} : { settings: { ...st.settings, flashing: !event.matches } }) });
    });
  } catch {
    // No motion setting to follow.
  }
}

/* The city's scene asks `./motion.ts`; the switch read or flipped here is told to it. */
useFeed.subscribe((st, before) => {
  if (st.ready && (st.settings.flashing !== before.settings.flashing || !before.ready)) setFlashing(st.settings.flashing);
});
