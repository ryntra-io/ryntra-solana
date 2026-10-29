import { create } from 'zustand';

/**
 * The skyline kit's state (CITY-56):
 *  · ready — the kit's towers are on the screen; the procedural towers and capsule walkers step aside then;
 *  · lit — the city's reflection is captured (or this tier has none), so glass and water look as they will stay;
 *  · fallback — the kit failed or is too slow: the procedural towers stand instead.
 * The canvas is held out until the city is in its final form (ready and lit) or the fallback stands, then fades in
 * once.
 */
export const useSkyline = create<{
  ready: boolean;
  lit: boolean;
  fallback: boolean;
  setReady: (ready: boolean) => void;
  setLit: (lit: boolean) => void;
  setFallback: (fallback: boolean) => void;
}>((set) => ({
  ready: false,
  lit: false,
  fallback: false,
  setReady: (ready) => set({ ready }),
  setLit: (lit) => set({ lit }),
  setFallback: (fallback) => set({ fallback }),
}));
