import { create } from 'zustand';

/**
 * Whether «How it works» is open over the city (CITY-43). The menu opens it and closes itself; the window lives in the
 * city's one frame (CITY-65), outlasts the menu, and «Back» and Escape close it as any window of the city.
 */
export const useGuides = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

// The stand and the screens for review (`city/components/how/how-shots.mjs`): development builds only.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __guides: useGuides });
