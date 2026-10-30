import { create } from 'zustand';

/**
 * The events' one place:
 * the feed is a panel under the top bar's bell, not a column on the city. `seen` is the newest event the person has
 * been shown; one newer lights a quiet dot on the bell. The first events of a visit fill it without a dot.
 */
type FeedPanel = {
  open: boolean;
  seen: number | null;
  toggle: (newest: number) => void;
  close: () => void;
  /** The visit's first events, taken as seen. */
  settle: (newest: number) => void;
};

export const useFeedPanel = create<FeedPanel>((set, get) => ({
  open: false,
  seen: null,
  toggle: (newest) => set({ open: !get().open, seen: Math.max(get().seen ?? 0, newest) }),
  close: () => set({ open: false }),
  settle: (newest) => {
    if (get().seen === null) set({ seen: newest });
  },
}));

/** Whether the bell has news: an event newer than the newest one shown. */
export function hasNews(seen: number | null, newest: number | null): boolean {
  return seen !== null && newest !== null && newest > seen;
}
