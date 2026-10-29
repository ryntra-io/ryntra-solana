"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Whether the page has hydrated (SOL-P1): false while the server draws and while React hydrates what it drew, true from
 * then on. A figure that depends on the reader's clock or time zone — an age to a tenth of a second, a date, a time of
 * day — is drawn in its final form only once this is true, so the server's draw and the browser's first draw are the
 * same and React never throws one away.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
