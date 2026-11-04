import { create } from 'zustand';

/**
 * Whether the bots window is open and on which tab — the one light piece of the bots in the city, so the Deck's
 * «Agents» tray opens it without pulling the hub in (the hub, its drafts and its paper runs load with the window). Also
 * the count of paper bots running, for the drones over the person's quarter: read once from this browser and kept by
 * the window's store whenever the hangar changes.
 */

export const BOT_TABS = ['launch', 'hangar', 'strategies', 'history'] as const;
export type BotTab = (typeof BOT_TABS)[number];
export const isBotTab = (value: unknown): value is BotTab => typeof value === 'string' && (BOT_TABS as readonly string[]).includes(value);

/** Where the hangar's paper bots are kept in this browser; the window's store writes it, the drones count it. */
export const PAPER_KEY = 'ryntra.city.bots.paper.v1';

/** The paper bots running in a kept hangar: not stopped, and their last span still open. Anything broken counts none. */
export function runningIn(raw: string | null): number {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return 0;
    return list.filter((bot) => {
      if (!bot || typeof bot !== 'object') return false;
      const { stoppedAt, spans } = bot as { stoppedAt?: unknown; spans?: unknown };
      if (stoppedAt !== null || !Array.isArray(spans) || spans.length === 0) return false;
      const last: unknown = spans[spans.length - 1];
      return Array.isArray(last) && last[1] === null;
    }).length;
  } catch {
    return 0;
  }
}

type BotsWindow = {
  open: boolean;
  tab: BotTab;
  /** Paper bots running now: the drones' count. */
  running: number;
  counted: boolean;
  show: (tab?: BotTab) => void;
  setTab: (tab: BotTab) => void;
  close: () => void;
  /** Reads the kept hangar once, so the drones fly before the window is ever opened. */
  count: () => void;
};

export const useBotsWindow = create<BotsWindow>((set, get) => ({
  open: false,
  tab: 'launch',
  running: 0,
  counted: false,
  show: (tab) => set({ open: true, ...(isBotTab(tab) ? { tab } : {}) }),
  setTab: (tab) => (isBotTab(tab) ? set({ tab }) : undefined),
  close: () => set({ open: false }),
  count: () => {
    if (get().counted) return;
    let raw: string | null = null;
    try {
      raw = typeof window !== 'undefined' ? window.localStorage.getItem(PAPER_KEY) : null;
    } catch {
      raw = null;
    }
    set({ counted: true, running: runningIn(raw) });
  },
}));

/**
 * Opens the bots window on a tab — `launch`, `hangar`, `strategies` or `history`; without one, where it was. The
 * Deck's «Agents» tray («Bots») and the old addresses of the bots (`/?open=agents`) call this.
 */
export function openBots(tab?: BotTab): void {
  useBotsWindow.getState().show(tab);
}

export function closeBots(): void {
  useBotsWindow.getState().close();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __openBots: openBots, __botsWindow: useBotsWindow });
