import { create } from 'zustand';
import type { PageId } from './pages.ts';

/**
 * Which of the city's pages stand open as windows (CITY-157), and the anchor one of them was opened on
 * (`#android` of the Privacy Policy, `#launch` of the Terms). A page opened again comes to the front with its new
 * anchor; the frame (CITY-65) keeps where each one stood.
 */
type Pages = {
  open: readonly PageId[];
  /** The last anchor asked for, with a stamp so the same anchor asked twice scrolls twice. */
  anchor: Readonly<{ id: PageId; hash: string; at: number }> | null;
  show: (id: PageId, hash?: string) => void;
  close: (id: PageId) => void;
  closeAll: () => void;
};

let stamp = 0;

export const usePages = create<Pages>((set) => ({
  open: [],
  anchor: null,
  show: (id, hash = '') =>
    set((st) => ({
      open: st.open.includes(id) ? st.open : [...st.open, id],
      anchor: hash ? { id, hash: hash.replace(/^#/, ''), at: ++stamp } : st.anchor,
    })),
  close: (id) => set((st) => ({ open: st.open.filter((open) => open !== id), anchor: st.anchor?.id === id ? null : st.anchor })),
  closeAll: () => set({ open: [], anchor: null }),
}));

/** Opens one of the city's pages as a window (from the menu, from another page's link). */
export function openPage(id: PageId, hash?: string): void {
  usePages.getState().show(id, hash);
}

// The stand and the screens for review (`shots.mjs`): development builds only.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __pages: usePages });
