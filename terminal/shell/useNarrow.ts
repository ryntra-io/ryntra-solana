import { useSyncExternalStore } from 'react';

/** The phone's width, where the frame trades its rail for five tabs (the same line as the frame's sheet: 767 px). */
export const NARROW = '(max-width: 767px)';

function subscribe(change: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether the screen is a phone's; the server and the first paint say no, the next render knows. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}
