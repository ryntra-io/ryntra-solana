import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/**
 * The address's query and fragment (`?tab=mine#history`), as the browser holds them, for the frame and its screens.
 *
 * The router's own hooks name the path; the rest changes without a new page — a press in the rail on the screen
 * already in front, a screen writing its tab back, Back — so it is read from the browser itself: every step of its
 * history (`pushState`, `replaceState`, `popstate`, `hashchange`) tells the ones listening, after the step.
 */

const listeners = new Set<() => void>();
let patched = false;

function tell(): void {
  for (const listener of listeners) listener();
}

/** Once a page: the history's two steps, as they are, then a word to the ones listening. */
function patch(): void {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  for (const step of ['pushState', 'replaceState'] as const) {
    const own = window.history[step];
    window.history[step] = function (this: History, ...args: Parameters<History['pushState']>) {
      const done = own.apply(this, args);
      // After the step, never inside it: the router takes its own steps while it renders.
      queueMicrotask(tell);
      return done;
    } as History['pushState'];
  }
}

function subscribe(listener: () => void): () => void {
  patch();
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
    window.removeEventListener('hashchange', listener);
  };
}

const tailNow = () => `${window.location.search}${window.location.hash}`;

/** The address's query and fragment; empty on the server and in the first paint after it. */
export function useAddressTail(): string {
  return useSyncExternalStore(subscribe, tailNow, () => '');
}

/** One part of the address's query, or null. */
export function partOf(tail: string, key: string): string | null {
  const hashAt = tail.indexOf('#');
  const query = hashAt >= 0 ? tail.slice(0, hashAt) : tail;
  return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query).get(key);
}

/** The address with one part of its query set, or taken away (null); the fragment stays. */
export function withPart(href: string, key: string, value: string | null): string {
  const url = new URL(href);
  // Nothing to change: the address stays as the browser wrote it.
  if (url.searchParams.get(key) === value) return href;
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  return url.href;
}

/**
 * A screen's tab in the address (`?tab=`): the address names the tab as the screen opens and whenever it changes — the
 * rail's items lead to a screen's tabs — and every turn of the screen's own tabs is written back in place, the first
 * tab with no part at all. No step in the history: «Back» leaves the screen as it always did.
 */
export function useTabInAddress<T extends string>(tab: T, setTab: (tab: T) => void, tabs: readonly T[], first: T, key = 'tab'): void {
  // Any change of the address's query or fragment reads the tab again.
  const tail = useAddressTail();
  // The address names a tab the screen has not turned to yet: nothing is written back until it has.
  const arriving = useRef<T | null>(null);
  // Nothing is written back before the browser's address has been read once.
  const read = useRef(false);
  const set = useRef(setTab);
  set.current = setTab;
  const current = useRef(tab);
  current.current = tab;
  const known = useRef(tabs);
  known.current = tabs;
  // Before the paint: the screen opens on the tab its address names, never on the first one for a moment. The browser's
  // own address is read — the router has written it by now — not the one the render saw.
  useLayoutEffect(() => {
    read.current = true;
    const asked = partOf(tailNow(), key);
    const want = asked !== null && (known.current as readonly string[]).includes(asked) ? (asked as T) : first;
    if (want === current.current) return;
    arriving.current = want;
    set.current(want);
  }, [tail, first, key]);
  useEffect(() => {
    if (!read.current) return;
    if (arriving.current !== null) {
      if (arriving.current !== tab) return;
      arriving.current = null;
    }
    const href = withPart(window.location.href, key, tab === first ? null : tab);
    // `null` lets the router take the address in as its own (Next's own advice for `replaceState`).
    if (href !== window.location.href) window.history.replaceState(null, '', href);
  }, [tab, first, key]);
}
