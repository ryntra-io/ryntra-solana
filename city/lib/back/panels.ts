import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * The small panels that keep their own «open» (the search in the top bar, the wallet's menu, the Deck's Trade tray):
 * while one is open it stands here with its close, so «Back» closes it like any window (CITY-150, the operator's pass on
 * the Seeker of 29.10: «Back» on an open search left the app). The panel's own state stays the truth; this follows it.
 */
type BackPanels = Readonly<{
  /** The panels open now, in the order they opened (bottom first). */
  open: readonly string[];
  closers: Readonly<Record<string, () => void>>;
}>;

export const useBackPanels = create<BackPanels>(() => ({ open: [], closers: {} }));

/** A panel opened: it stands on «Back» until `release`. */
export function holdPanel(id: string, close: () => void): () => void {
  useBackPanels.setState((st) => ({ open: [...st.open.filter((one) => one !== id), id], closers: { ...st.closers, [id]: close } }));
  return () =>
    useBackPanels.setState((st) => {
      if (st.closers[id] !== close) return st;
      const closers = { ...st.closers };
      delete closers[id];
      return { open: st.open.filter((one) => one !== id), closers };
    });
}

/** Closes a panel as its own close does; true when one was there to close. */
export function closePanel(id: string): boolean {
  const close = useBackPanels.getState().closers[id];
  if (!close) return false;
  close();
  return true;
}

/** In a component: while `open`, the panel stands on «Back» and `close` shuts it. */
export function useBackPanel(id: string, open: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    return holdPanel(id, () => latest.current());
  }, [id, open]);
}
