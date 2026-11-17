import { useCity } from '../../city/lib/city/store.ts';
import { freshCity, newerCity, nextReadIn, readOnReturn } from '../../city/lib/market/reread.ts';
import type { CitySnapshot } from '../../city/lib/market/types.ts';

/**
 * The market under the terminal: the same read the city lives on (`/api/city`), into the same store (`useCity`), by
 * the city's own rules of when to read again and which answer may replace the one on screen (`city/lib/market/reread.ts`).
 * The store takes the bundled snapshot as the page starts, then a live read, then one every minute, sooner after a stale
 * answer, at once when the tab comes back. The agent's line, the events and the screens read it from that store — a
 * screen through `useMarket()`, which shows the bundled snapshot from the server's page on, before the store has it.
 */

let users = 0;
let stopReading: (() => void) | null = null;

/** Starts reading for the page; the returned stop ends it once its last user is gone. */
export function startMarket(initial: CitySnapshot): () => void {
  users += 1;
  if (!stopReading) stopReading = read(initial);
  return () => {
    users -= 1;
    if (users === 0) {
      stopReading?.();
      stopReading = null;
    }
  };
}

function read(initial: CitySnapshot): () => void {
  const city = useCity.getState();
  if (!city.snapshot.towers.length || newerCity(city.snapshot, initial)) city.setSnapshot(initial);
  let alive = true;
  let reading = false;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shown = () => useCity.getState().snapshot;
  const again = () => {
    clearTimeout(timer);
    // A hidden tab waits: coming back to it reads at once.
    if (alive && !document.hidden) timer = setTimeout(once, nextReadIn(shown(), Date.now(), tries));
  };
  const once = async () => {
    if (reading) return;
    reading = true;
    clearTimeout(timer);
    try {
      const res = await fetch('/api/city', { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as CitySnapshot;
      if (!alive || !Array.isArray(next.towers) || !next.towers.length) return;
      // An edge still holding an older market never takes back the newer one on screen.
      if (newerCity(shown(), next)) useCity.getState().setSnapshot(next);
    } catch {
      // The last read stays; the screens say when the market is not live.
    } finally {
      reading = false;
      // As the city counts: the wait is set from the stale answers before this one, then this one is counted.
      again();
      tries = freshCity(shown(), Date.now()) ? 0 : tries + 1;
    }
  };
  const back = () => {
    if (document.visibilityState !== 'visible') return;
    if (readOnReturn(shown(), Date.now())) void once();
    else if (!reading) again();
  };
  void once();
  document.addEventListener('visibilitychange', back);
  window.addEventListener('online', back);
  window.addEventListener('pageshow', back);
  return () => {
    alive = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', back);
    window.removeEventListener('online', back);
    window.removeEventListener('pageshow', back);
  };
}
