import { useSyncExternalStore } from 'react';

/**
 * The page inside the Ryntra app (CITY-6a): the app's WebView marks its user agent `RyntraApp/<version>`
 * (docs/city/APP-BRIDGE.md). There the page hides what only a browser needs — posting to X from a browser tab, an
 * install prompt — and the app's bridge (CITY-6b) does the rest. Read on the client only: the server's page and the
 * first paint are the browser's, and the app's view follows right after.
 */
export function isRyntraApp(userAgent: string | null | undefined): boolean {
  return /(?:^|[\s;(])RyntraApp\/\S+/.test(String(userAgent ?? ''));
}

const never = () => () => {};
const inApp = () => isRyntraApp(navigator.userAgent);
const onServer = () => false;

/** True inside the Ryntra app; false in a browser and on the server. */
export function useRyntraApp(): boolean {
  return useSyncExternalStore(never, inApp, onServer);
}

/**
 * In the app the page never asks to be installed: the browser's home-screen prompt (the event before its install
 * bar) is swallowed. The manifest stays in the page — React owns the head — and a WebView offers no install of its
 * own. Returns the undo. A browser keeps its prompt.
 */
export function quietInstall(win: Window = window): () => void {
  if (!isRyntraApp(win.navigator.userAgent)) return () => {};
  const swallow = (event: Event) => event.preventDefault();
  win.addEventListener('beforeinstallprompt', swallow);
  return () => win.removeEventListener('beforeinstallprompt', swallow);
}
