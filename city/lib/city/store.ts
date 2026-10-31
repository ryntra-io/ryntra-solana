import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { flashingOn } from '../feed/motion.ts';
import type { CitySnapshot } from '../market/types.ts';
import { layoutCity, type CityLayout } from './layout.ts';
import type { Quality } from './quality.ts';

export type { Quality };

export type FxKind = 'pump' | 'flare' | 'launch';

/** A moment the city plays: fireworks for a pump, a Solar Flare for a drop, a light column for a launch. */
export type CityEvent = {
  id: number;
  kind: FxKind;
  towerId: string;
  symbol: string;
  /** The real figure and its window, e.g. "+18.4% · 24H" — events never claim more than the data says. */
  value: string;
  title: string;
  at: number;
};

type CityState = {
  snapshot: CitySnapshot;
  layout: CityLayout;
  /**
   * The layout is the snapshot's own plan, as every device lays it out (a run's course is built on it). Otherwise it
   * grew from the city on screen: every tower that stood there keeps its plot (CITY-148).
   */
  exact: boolean;
  selectedId: string | null;
  entered: boolean;
  sound: boolean;
  quality: Quality;
  /** The latest events, newest first. Consumers remember the last id they handled. */
  feed: CityEvent[];
  /** Camera trauma 0–1; the scene decays it. */
  trauma: number;
  /** When the user last touched the camera (ms); the attract orbit waits after that. */
  touchedAt: number;
  /** When the logo last asked for the overview (ms): the camera flies back to the establishing shot. */
  homeAt: number;
  /** The next city; `exact` lays it out on its own instead of growing it from the one on screen. */
  setSnapshot: (snapshot: CitySnapshot, exact?: boolean) => void;
  select: (id: string | null) => void;
  enter: () => void;
  setSound: (on: boolean) => void;
  setQuality: (quality: Quality) => void;
  play: (event: Omit<CityEvent, 'id' | 'at'>) => void;
  shake: (amount: number) => void;
  touch: () => void;
  /** Back to the overview: nothing picked, the camera on the establishing shot. */
  home: () => void;
};

let nextId = 1;

export const useCity = create<CityState>((set) => ({
  snapshot: { towers: [], fetchedAt: new Date(0).toISOString(), source: 'snapshot' },
  layout: layoutCity([]),
  exact: true,
  selectedId: null,
  entered: false,
  sound: false,
  quality: 'high',
  feed: [],
  trauma: 0,
  touchedAt: 0,
  homeAt: 0,
  setSnapshot: (snapshot, exact = false) => set((state) => ({ snapshot, exact, layout: layoutCity(snapshot.towers, exact ? null : state.layout) })),
  select: (selectedId) => set({ selectedId, touchedAt: Date.now() }),
  enter: () => set({ entered: true }),
  setSound: (sound) => set({ sound }),
  setQuality: (quality) => set({ quality }),
  play: (event) => set((state) => ({ feed: [{ ...event, id: nextId++, at: Date.now() }, ...state.feed].slice(0, 8) })),
  // «Flashing effects» off in the feed's «Show on home» holds the camera still for every caller (CITY-66).
  shake: (amount) => set((state) => (flashingOn() ? { trauma: Math.min(1, state.trauma + amount) } : {})),
  touch: () => set({ touchedAt: Date.now() }),
  home: () => set({ selectedId: null, homeAt: Date.now() }),
}));

// Development hook: lets the screenshot scripts and the console play moments on demand.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __city: useCity });

/** Calls `handle` once for every event played after mount, oldest first. */
export function useCityEvents(handle: (event: CityEvent) => void) {
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    let last = useCity.getState().feed[0]?.id ?? 0;
    return useCity.subscribe((state) => {
      const fresh = state.feed.filter((e) => e.id > last).reverse();
      if (!fresh.length) return;
      last = fresh[fresh.length - 1]!.id;
      for (const event of fresh) handler.current(event);
    });
  }, []);
}
