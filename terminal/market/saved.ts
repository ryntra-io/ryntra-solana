import { create } from 'zustand';
import { isMint } from '../../city/lib/search/mint.ts';

/**
 * «Saved»: the coins a person starred, kept in this browser. The star stands on a coin's own screen; the Market's
 * «Saved» tab lists them. Nothing here leaves the browser.
 */

/** Where this browser keeps the list. */
export const SAVED_KEY = 'ryntra.terminal.saved.v1';
/** The most coins the list keeps: the newest stars push the oldest out. */
export const SAVED_MAX = 200;

/** A kept list as it is read back: mints only, each once, the newest `SAVED_MAX`. */
export function parseSaved(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isMint))].slice(-SAVED_MAX);
}

/** The list after a tap on a coin's star: the coin leaves it, or joins it last. */
export function toggled(list: readonly string[], mint: string): string[] {
  if (!isMint(mint)) return [...list];
  return list.includes(mint) ? list.filter((kept) => kept !== mint) : [...list, mint].slice(-SAVED_MAX);
}

type SavedState = { mints: readonly string[]; read: boolean };

export const useSaved = create<SavedState>(() => ({ mints: [], read: false }));

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the kept list once the page is in a browser; another tab's star is followed as it is written. */
export function startSaved(): () => void {
  const read = () => useSaved.setState({ mints: parseSaved(storage()?.getItem(SAVED_KEY)), read: true });
  read();
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_KEY) read();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** A tap on a coin's star. */
export function toggleSaved(mint: string): void {
  const mints = toggled(useSaved.getState().mints, mint);
  useSaved.setState({ mints, read: true });
  try {
    storage()?.setItem(SAVED_KEY, JSON.stringify(mints));
  } catch {
    // Without storage the star lives while this page is open.
  }
}
