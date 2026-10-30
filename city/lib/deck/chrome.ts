import { create } from 'zustand';
import { CHROME_KEY, SHOWN, readChrome, writeChrome, type Chrome } from './items.ts';

/**
 * What of the frame is shown — the top bar and the Deck — each hidden by its own arrow and kept on this device. Read
 * after mount (`hydrate`), so the server's page and the first paint agree; a private window keeps it for the visit.
 */
type ChromeState = Chrome & {
  hydrate: () => void;
  toggle: (part: keyof Chrome) => void;
};

export const useChrome = create<ChromeState>((set, get) => ({
  ...SHOWN,
  hydrate: () => {
    try {
      set(readChrome(localStorage.getItem(CHROME_KEY)));
    } catch {
      // Storage refused: both stay shown.
    }
  },
  toggle: (part) => {
    const next = { top: get().top, bottom: get().bottom, [part]: !get()[part] };
    set(next);
    try {
      const kept = writeChrome(next);
      if (kept) localStorage.setItem(CHROME_KEY, kept);
      else localStorage.removeItem(CHROME_KEY);
    } catch {
      // A private window: the choice holds for this visit.
    }
  },
}));
