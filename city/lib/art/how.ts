import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether «How the city works» is open (CITY-64). The menu opens it and closes itself; the window lives outside the
 * menu, so it outlasts it, and the HUD's Escape leaves it to the window.
 */
export const howStore = createStore<{ open: boolean; show: () => void; hide: () => void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function useHow<T>(pick: (st: ReturnType<typeof howStore.getState>) => T): T {
  return useStore(howStore, pick);
}
