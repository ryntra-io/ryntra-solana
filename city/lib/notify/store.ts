import { create } from 'zustand';
import { useFeed } from '../feed/store.ts';
import { askDesk, deskState, showDesk, type DeskState } from './desk.ts';
import { decide, spoke, type Decision, type Note } from './gate.ts';
import { kindOf, type Cap, type NoteKind, type Place } from './kinds.ts';
import {
  defaultPrefs,
  flashShown,
  readPrefs,
  routeShown,
  setCap as capOf,
  setQuiet as quietOf,
  setRoute as routeOf,
  writePrefs,
  type Corner,
  type Flash,
  type FeedSide,
  type NotifyPrefs,
  type Quiet,
  type StorageLike,
} from './prefs.ts';

/**
 * The notification centre's state for the page (CITY-87): the person's choices (kept on this device), the banners
 * standing in the city now, and when each kind last spoke. `notify(note)` is the one way the city tells something: it
 * asks the gate (`./gate.ts`), stands a banner, shows a notification on the computer, or does nothing.
 *
 * Whether a market kind shows at all and whether the city flashes at all stay the live feed's switches (CITY-66,
 * `../feed/store.ts`): this store flips them, so the feed, the bell, the scene and the old keys stay one truth.
 */

export type Banner = Readonly<{
  id: number;
  kind: NoteKind;
  title: string;
  line: string | null;
  tower: string | null;
  at: number;
  /** Stays until the person closes it: the liquidation risk. */
  sticky: boolean;
}>;

/** Banners standing at once; the oldest that may go makes room. */
export const MAX_BANNERS = 3;

export type NotifyEnv = Readonly<{
  storage: StorageLike | null;
  now: () => number;
  desk: () => DeskState;
  ask: () => Promise<DeskState>;
  show: (title: string, body: string | null, tag: string, onOpen?: () => void) => boolean;
  /** A tap on a banner or a notification about a tower. */
  open: (tower: string) => void;
  /** A tap on a notification about no tower: the kind's own window (Earn's open Earn). */
  openKind: (kind: NoteKind) => void;
}>;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

let env: NotifyEnv = {
  storage: null,
  now: () => Date.now(),
  desk: deskState,
  ask: askDesk,
  show: showDesk,
  open: () => undefined,
  openKind: () => undefined,
};

/** Swap what the store reaches: the page's tower opener, and tests. */
export function setNotifyEnv(next: Partial<NotifyEnv>): void {
  env = { ...env, ...next };
}

type NotifyStore = {
  prefs: NotifyPrefs;
  ready: boolean;
  banners: readonly Banner[];
  last: Readonly<Partial<Record<NoteKind, number>>>;
  desk: DeskState;
  setRoute: (id: NoteKind, place: Place) => void;
  setCap: (id: NoteKind, cap: Cap) => void;
  setCorner: (corner: Corner) => void;
  setFeedSide: (side: FeedSide) => void;
  setFlash: (flash: Flash) => void;
  setQuiet: (change: Partial<Quiet>) => void;
  setMuted: (on: boolean) => void;
  dismiss: (id: number) => void;
  /** The browser's question «show notifications?», from the person's tap. */
  askDesk: () => Promise<DeskState>;
};

let nextId = 1;

export const useNotify = create<NotifyStore>((set, get) => {
  const keep = (prefs: NotifyPrefs) => {
    if (prefs === get().prefs) return;
    writePrefs(env.storage, prefs);
    set({ prefs });
  };
  return {
    prefs: defaultPrefs(),
    ready: false,
    banners: [],
    last: {},
    desk: 'unsupported',
    setRoute: (id, place) => {
      const spec = kindOf(id);
      if (!spec.places.includes(place)) return;
      if (spec.feed) {
        // A market kind: «off» is the feed's own switch; «in the city» or «on the computer» is kept here — first, so
        // the feed's next step already goes where the person just said.
        if (place !== 'off') keep(routeOf(get().prefs, id, place));
        const feed = useFeed.getState();
        const on = place !== 'off';
        if (feed.settings[spec.feed] !== on) feed.set(spec.feed, on);
        return;
      }
      keep(routeOf(get().prefs, id, place));
    },
    setCap: (id, cap) => keep(capOf(get().prefs, id, cap)),
    setCorner: (corner) => keep({ ...get().prefs, corner }),
    setFeedSide: (feed) => keep({ ...get().prefs, feed }),
    setFlash: (flash) => {
      // Off is the feed's flashing switch (CITY-66): the scene, the banners and the call-outs all ask it.
      if (flash !== 'off') keep({ ...get().prefs, flash });
      const feed = useFeed.getState();
      const on = flash !== 'off';
      if (feed.settings.flashing !== on) feed.set('flashing', on);
    },
    setQuiet: (change) => keep(quietOf(get().prefs, change)),
    setMuted: (muted) => keep({ ...get().prefs, muted }),
    dismiss: (id) => set({ banners: get().banners.filter((banner) => banner.id !== id) }),
    askDesk: async () => {
      const desk = await env.ask();
      set({ desk });
      return desk;
    },
  };
});

/** Where a kind goes now, as the window shows it (a market kind the feed hides is «off»). */
export function routeNow(id: NoteKind, prefs: NotifyPrefs = useNotify.getState().prefs): Place {
  const feed = useFeed.getState().settings;
  return routeShown(prefs, id, (kind) => {
    const spec = kindOf(kind);
    return spec.feed ? feed[spec.feed] : true;
  });
}

/** The flashes as the window shows them: off, small or cinema. */
export function flashNow(): Flash {
  return flashShown(useNotify.getState().prefs, useFeed.getState().settings.flashing);
}

/** The one way the city tells something. Returns what the gate decided. */
export function notify(note: Note): Decision {
  const st = useNotify.getState();
  const now = env.now();
  const desk = env.desk();
  const decision = decide(note, routeNow(note.kind, st.prefs), st.prefs, { now, last: st.last[note.kind] ?? null, desk: desk === 'granted' });
  if (!spoke(decision)) return decision;
  const sticky = kindOf(note.kind).locked;
  let banners = st.banners;
  if (decision.banner) {
    const banner: Banner = { id: nextId++, kind: note.kind, title: note.title, line: note.line ?? null, tower: note.tower ?? null, at: now, sticky };
    banners = [...banners.filter((b) => !(sticky && b.sticky && b.kind === note.kind && b.title === note.title)), banner];
    while (banners.length > MAX_BANNERS) {
      const drop = banners.findIndex((b) => !b.sticky);
      banners = banners.filter((_, i) => i !== (drop === -1 ? 0 : drop));
    }
  }
  if (decision.desk) {
    const tower = note.tower ?? null;
    env.show(note.title, note.line ?? null, `ryntra-${note.kind}`, tower ? () => env.open(tower) : () => env.openKind(note.kind));
  }
  useNotify.setState({ banners, last: { ...st.last, [note.kind]: now }, desk });
  return decision;
}

/** Reads the kept centre and the browser's permission once; later calls do nothing. Tests hand in their own world. */
export function hydrateNotify(given?: Partial<NotifyEnv>): void {
  if (useNotify.getState().ready && !given) return;
  if (given) setNotifyEnv(given);
  else env = { ...env, storage: browserStorage() };
  useNotify.setState({ prefs: readPrefs(env.storage), desk: env.desk(), ready: true });
}

/** Back to a fresh page (tests). */
export function resetNotify(): void {
  nextId = 1;
  env = { storage: null, now: () => Date.now(), desk: deskState, ask: askDesk, show: showDesk, open: () => undefined, openKind: () => undefined };
  useNotify.setState({ prefs: defaultPrefs(), ready: false, banners: [], last: {}, desk: 'unsupported' });
}

/*
 * The city's call-outs for styles that need no prop: `html[data-city-flash-size='off' | 'small' | 'cinema']`. Off — the
 * flashing switched off — takes the moment's slab away altogether (`hud.module.css`), not only its motion.
 */
function markFlash(): void {
  if (typeof document === 'undefined' || !useNotify.getState().ready) return;
  document.documentElement.dataset.cityFlashSize = flashNow();
}
if (typeof document !== 'undefined') {
  useNotify.subscribe((st, before) => {
    if (st.prefs.flash !== before.prefs.flash || st.ready !== before.ready) markFlash();
  });
  useFeed.subscribe((st, before) => {
    if (st.settings.flashing !== before.settings.flashing) markFlash();
  });
}
