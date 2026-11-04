import { create } from 'zustand';
import { useCity } from '../city/store.ts';
import { useGameMap } from '../game/map.ts';
import { launchEngine, useLaunch } from './district.ts';
import { dueMarketReads, dueNightReads, nightCandidates, nightOpen, nightShow, nightStartOf, nightSwitch, sameLineup, withCaps, type KeptCap, type KeptStart, type NightShow } from './night.ts';

/**
 * Launch Night in the browser (CITY-146): the night's show worked out from the Launch district's towers and the flows
 * of the night's launches, read a few at a time — the flows the feed already holds are taken as they are. A development build stands it in with `?night=open`
 * beside the Launch stand-in (`?launch=stub`).
 *
 * The stage moves on by itself every few seconds, by hand only where the device asks for less motion. While the show
 * plays, the camera frames the launch on the stage through the Map's view (`useGameMap.look`), the way
 * the Map flies to a district: nothing opens and nothing is bought until the person taps Buy.
 */

export const NIGHT_SWITCH = nightSwitch(process.env.NEXT_PUBLIC_RYNTRA_CITY_LAUNCH_NIGHT);
/** The show is worked out again this often, so the ages on the stage and the night's edge stay true. */
export const NIGHT_TICK_MS = 30_000;
/**
 * A tower counts as standing in the city this long after the city last drew it: a new read of the market lays the city
 * out first without the launches and then with them, and that moment between is no reason to end the show.
 */
export const NIGHT_PLACED_MS = 15_000;
/** One launch holds the stage this long before the camera flies on. */
export const NIGHT_STEP_MS = 6_500;

type NightState = {
  /** `off` — closed here or no Launch; `waiting` — open, no show yet (too few confirmed launches); `ready` — a show. */
  status: 'off' | 'waiting' | 'ready';
  show: NightShow | null;
  /** The development stand-in: every screen says so. */
  stub: boolean;
  /** The show plays over the city. */
  playing: boolean;
  /** The launch on the stage: its index in `show.entries`. */
  index: number;
  /** When the stage last moved, by hand or by the clock (ms). */
  movedAt: number;
  play: () => void;
  stop: () => void;
  go: (index: number) => void;
  step: (by: 1 | -1) => void;
};

/** The Map's view the show set, so stopping it lets go of its own view only. */
let framed: readonly string[] | null = null;

function frame(token: string | null) {
  const map = useGameMap.getState();
  if (!token) {
    if (framed && map.view && map.view.ids.length === framed.length && map.view.ids.every((id, i) => id === framed![i])) map.clear();
    framed = null;
    return;
  }
  framed = [token];
  map.look(framed);
}

export const useNight = create<NightState>((set, get) => ({
  status: 'off',
  show: null,
  stub: false,
  playing: false,
  index: 0,
  movedAt: 0,
  play: () => {
    const show = get().show;
    if (!show) return;
    set({ playing: true, index: 0, movedAt: Date.now() });
    frame(show.entries[0]!.token);
  },
  stop: () => {
    if (!get().playing) return;
    set({ playing: false });
    frame(null);
  },
  go: (index) => {
    const show = get().show;
    if (!show || !get().playing) return;
    const next = ((index % show.entries.length) + show.entries.length) % show.entries.length;
    set({ index: next, movedAt: Date.now() });
    frame(show.entries[next]!.token);
  },
  step: (by) => get().go(get().index + by),
}));

/** Whether the show stands ready in the city now. */
export const nightReady = (state: Pick<NightState, 'status' | 'show'>) => state.status === 'ready' && state.show !== null;

/* The development stand: `?night=open` opens the switch in a development build only, never in a production bundle. */
const standAsked = (): boolean => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('night') === 'open';

/* The show's store for the development stand's shots (`night-shots.mjs`); never in a production bundle. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __night: useNight });

let started = false;

/** Start the night once for the page: the switch, then the flows of the night's launches and the show from them. */
export function startNight(): () => void {
  if (started || typeof window === 'undefined') return () => undefined;
  const switchOpen = NIGHT_SWITCH || standAsked();
  if (!switchOpen) {
    useNight.setState({ status: 'off' });
    return () => undefined;
  }
  started = true;
  let stopped = false;
  const kept = new Map<string, KeptStart>();
  const caps = new Map<string, KeptCap>();
  const asking = new Set<string>();
  const askingCaps = new Set<string>();
  /** When each tower last stood in the city's layout. */
  const seen = new Map<string, number>();

  const work = () => {
    if (stopped) return;
    const district = useLaunch.getState();
    const stub = district.stub;
    const open = district.status === 'ready' && nightOpen(district.network, switchOpen);
    if (!open) {
      if (useNight.getState().status !== 'off') useNight.setState({ status: 'off', show: null });
      useNight.getState().stop();
      return;
    }
    const now = Date.now();
    /* Only the engine's own list — a launch of this browser the engine does not carry yet waits for it — and only the
       towers the city draws now: the camera never flies to a launch that has no tower. */
    for (const entry of useCity.getState().layout.towers) seen.set(entry.tower.id, now);
    for (const [token, at] of seen) if (now - at > NIGHT_PLACED_MS) seen.delete(token);
    const towers = district.feed.filter((tower) => seen.has(tower.token));
    const candidates = withCaps(nightCandidates(towers, now), caps);
    const listed = new Set(candidates.map((tower) => tower.token));
    for (const map of [kept, caps]) for (const token of [...map.keys()]) if (!listed.has(token)) map.delete(token);
    const starts = new Map([...kept].flatMap(([token, entry]) => (entry.start ? [[token, entry.start] as const] : [])));
    const show = nightShow({ towers: candidates, starts, network: district.network, now });
    const state = useNight.getState();
    if (!show) {
      useNight.setState({ status: 'waiting', show: null, stub });
      state.stop();
    } else if (!sameLineup(state.show, show)) {
      /* The lineup changed: the stage keeps the launch it shows when it is still on, else it starts again. */
      const on = state.show?.entries[state.index]?.token;
      const index = Math.max(0, show.entries.findIndex((entry) => entry.token === on));
      useNight.setState({ status: 'ready', show, stub, index, ...(index !== state.index ? { movedAt: Date.now() } : {}) });
      if (state.playing) frame(show.entries[index]!.token);
    } else {
      useNight.setState({ status: 'ready', show, stub });
    }
    read(candidates, starts, now);
  };

  const read = (candidates: ReturnType<typeof nightCandidates>, starts: Parameters<typeof dueMarketReads>[1], now: number) => {
    const engine = launchEngine();
    for (const token of dueMarketReads(candidates, starts, caps, askingCaps, now)) {
      askingCaps.add(token);
      void Promise.resolve()
        .then(() => engine.market(token))
        .catch(() => ({ ok: false as const, code: 'UNAVAILABLE', message: '' }))
        .then((answer) => {
          askingCaps.delete(token);
          if (stopped) return;
          /* A read that fails keeps the last cap it read, with its own time. */
          const before = caps.get(token);
          caps.set(token, answer.ok ? { at: Date.now(), ok: true, usd: answer.data.marketCap.usd } : { at: Date.now(), ok: false, usd: before?.usd ?? null });
          work();
        });
    }
    for (const token of dueNightReads(candidates, kept, asking, now)) {
      asking.add(token);
      void Promise.resolve()
        .then(() => engine.flow(token))
        .catch(() => ({ ok: false as const, code: 'UNAVAILABLE', message: '' }))
        .then((answer) => {
          asking.delete(token);
          if (stopped) return;
          /* A read that fails keeps what the chain already said. */
          const before = kept.get(token);
          const start = answer.ok ? nightStartOf(answer.data) : (before?.start ?? null);
          const misses = start?.createdAt ? 0 : (before?.misses ?? 0) + 1;
          kept.set(token, { at: Date.now(), ok: answer.ok, start, misses });
          work();
        });
    }
  };

  const unsubscribe = useLaunch.subscribe((state, before) => {
    if (state.feed !== before.feed || state.status !== before.status || state.network !== before.network) work();
  });
  /* The city's layout decides which launches have a tower to fly to. */
  let laidOut: ReturnType<typeof setTimeout> | null = null;
  const unsubscribeCity = useCity.subscribe((state, before) => {
    if (state.layout === before.layout || laidOut) return;
    /* Once the district has laid its launches into the new city too. */
    laidOut = setTimeout(() => {
      laidOut = null;
      work();
    }, 300);
  });
  /* A hidden page reads nothing; it works the show out again when it is seen. */
  const tick = setInterval(() => {
    if (document.visibilityState !== 'hidden') work();
  }, NIGHT_TICK_MS);
  /* The stage moves on by itself while the show plays and the page is seen. */
  const clock = setInterval(() => {
    const night = useNight.getState();
    if (!night.playing || document.visibilityState === 'hidden' || Date.now() - night.movedAt < NIGHT_STEP_MS) return;
    /* Asked for less motion: the stage moves only by hand. */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    night.step(1);
  }, 500);
  work();
  return () => {
    stopped = true;
    started = false;
    unsubscribe();
    unsubscribeCity();
    if (laidOut) clearTimeout(laidOut);
    clearInterval(tick);
    clearInterval(clock);
    useNight.getState().stop();
  };
}
