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

/**
 * Whether a window of the city's frame came since the last look (CITY-239): an id that was not there before. The bell's
 * panel folds then, as it does for the windows the home names itself (`hidden`): Earn, Bots, the agent's card and the
 * Ring are windows of the frame only, and a card opened by a sentence comes with no tap that would fold the panel — on
 * a phone its sheet rose over the open events. A window that closes, or the same windows in another order, is no news.
 */
export function windowCame(before: readonly string[], now: readonly string[]): boolean {
  return now.some((id) => !before.includes(id));
}

/**
 * Whether the open panel under the bell is what Escape closes now (CITY-239) — the rule its own listener goes by
 * (`LiveFeed`): no modal window over the city, and the focus on nothing, on the bell or inside the panel. The HUD asks
 * the same question before its own Escape, so one press closes the panel and nothing under it, as «Back» does.
 */
export function feedTakesEscape(open: boolean, doc: Pick<Document, 'querySelector' | 'activeElement' | 'body'>): boolean {
  if (!open || doc.querySelector('[aria-modal="true"]')) return false;
  const focus = doc.activeElement;
  return !focus || focus === doc.body || focus.closest('[data-feed-bell], #city-feed') !== null;
}
