import { create } from 'zustand';
import { keepLens, readLens, type LensId, type LensStorage } from './lens.ts';
import { readStockMints } from './stocks.ts';

/**
 * The Lens's state (CITY-86): the chip the viewer picked, kept in this browser, and the engine's listed companies, read
 * once the first time «Stocks» is picked. `ready` is false until the kept chip is read, so the server's page and the
 * first paint agree.
 */
type LensState = {
  lens: LensId;
  ready: boolean;
  stocks: ReadonlySet<string>;
  stocksRead: 'none' | 'reading' | 'done';
  /** When a chip was last picked (ms): the camera frames its towers from here. */
  at: number;
  pick: (lens: LensId) => void;
  hydrate: () => void;
};

const storage = (): LensStorage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const useLens = create<LensState>((set, get) => ({
  lens: 'all',
  ready: false,
  stocks: new Set(),
  stocksRead: 'none',
  at: 0,
  pick: (lens) => {
    // The picked chip tapped again frames its towers once more: `at` moves, the levels stay.
    set({ lens, at: Date.now() });
    keepLens(storage(), lens);
    if (lens === 'stocks') readStocks();
  },
  hydrate: () => {
    if (get().ready) return;
    const lens = readLens(storage());
    set({ lens, ready: true, at: Date.now() });
    if (lens === 'stocks') readStocks();
  },
}));

function readStocks() {
  if (useLens.getState().stocksRead !== 'none' || typeof fetch !== 'function') return;
  useLens.setState({ stocksRead: 'reading' });
  void readStockMints((url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })).then((mints) =>
    useLens.setState({ stocks: new Set(mints), stocksRead: 'done' }),
  );
}

// Development hook: the screenshot script picks a chip without a click.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __lens: useLens });
