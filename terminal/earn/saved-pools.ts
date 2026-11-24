import { create } from 'zustand';
import { isMint } from '../../city/lib/search/mint.ts';

/**
 * «Saved» pools: the pools a person starred on the pools' table, kept in this browser, as the Market keeps its
 * starred coins (`terminal/market/saved.ts`). The star stands on each row; the table's «Saved» shows them all. Nothing
 * here leaves the browser.
 */

/** Where this browser keeps the list. */
export const SAVED_POOLS_KEY = 'ryntra.terminal.saved-pools.v1';
/** The most pools the list keeps: the newest stars push the oldest out. */
export const SAVED_POOLS_MAX = 200;

/** A kept list as it is read back: pool addresses only, each once, the newest `SAVED_POOLS_MAX`. */
export function parseSavedPools(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isMint))].slice(-SAVED_POOLS_MAX);
}

/** The list after a tap on a pool's star: the pool leaves it, or joins it last. */
export function toggledPool(list: readonly string[], address: string): string[] {
  if (!isMint(address)) return [...list];
  return list.includes(address) ? list.filter((kept) => kept !== address) : [...list, address].slice(-SAVED_POOLS_MAX);
}

type SavedPoolsState = { pools: readonly string[]; read: boolean };

export const useSavedPools = create<SavedPoolsState>(() => ({ pools: [], read: false }));

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the kept list once the page is in a browser; another tab's star is followed as it is written. */
export function startSavedPools(): () => void {
  const read = () => useSavedPools.setState({ pools: parseSavedPools(storage()?.getItem(SAVED_POOLS_KEY)), read: true });
  read();
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_POOLS_KEY) read();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** A tap on a pool's star. */
export function toggleSavedPool(address: string): void {
  const pools = toggledPool(useSavedPools.getState().pools, address);
  useSavedPools.setState({ pools, read: true });
  try {
    storage()?.setItem(SAVED_POOLS_KEY, JSON.stringify(pools));
  } catch {
    // Without storage the star lives while this page is open.
  }
}
