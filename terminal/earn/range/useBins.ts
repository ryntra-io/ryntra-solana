import { useEffect, useState } from 'react';
import { isEarnBinsAnswer, type EarnBinsAnswer, type EarnBinsVenue } from '../../../lib/earn-pools/bins.ts';

/**
 * A pool's bins around its price, read from the engine while its ticket is in front: once at once, then
 * again every twenty seconds while the page is in view. The last good read stays on screen through a read that failed;
 * a pool never read is said as failed, never drawn as an empty one.
 */

export type BinsState = Readonly<{ status: 'reading' }> | Readonly<{ status: 'ready'; value: EarnBinsAnswer }> | Readonly<{ status: 'failed' }>;

const AGAIN_MS = 20_000;
const PATH: Readonly<Record<EarnBinsVenue, string>> = { dlmm: '/api/v1/earn/pools/bins', pro: '/api/v1/earn/pro/bins' };

/** The last good read of each pool, so a ticket opened again draws at once and reads behind. */
const kept = new Map<string, EarnBinsAnswer>();

function binsUrl(venue: EarnBinsVenue, pool: string): string {
  return `${PATH[venue]}?pool=${encodeURIComponent(pool)}`;
}

async function readBins(venue: EarnBinsVenue, pool: string, signal: AbortSignal): Promise<EarnBinsAnswer | null> {
  try {
    const response = await fetch(binsUrl(venue, pool), { headers: { accept: 'application/json' }, signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isEarnBinsAnswer(body) && body.pool === pool ? body : null;
  } catch {
    return null;
  }
}

export function useBins(venue: EarnBinsVenue, pool: string | null): BinsState {
  const key = pool ? `${venue}:${pool}` : null;
  const [state, setState] = useState<Readonly<{ key: string | null; value: BinsState }>>(() => ({ key, value: key && kept.has(key) ? { status: 'ready', value: kept.get(key)! } : { status: 'reading' } }));

  useEffect(() => {
    if (!pool || !key) return;
    const stop = new AbortController();
    const start = kept.get(key);
    setState({ key, value: start ? { status: 'ready', value: start } : { status: 'reading' } });
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      const answer = await readBins(venue, pool, stop.signal);
      if (stop.signal.aborted) return;
      if (answer) {
        kept.set(key, answer);
        setState({ key, value: { status: 'ready', value: answer } });
      } else if (!kept.has(key)) setState({ key, value: { status: 'failed' } });
    };
    void read();
    const timer = setInterval(() => void read(), AGAIN_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      stop.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [venue, pool, key]);

  // Another pool's read is never drawn for this one, not even for the frame before the effect runs.
  return state.key === key ? state.value : { status: 'reading' };
}

const TUNE_KEY = 'ryntra.earn.tune';

/** Whether the range's own controls are open: the person's choice, kept on this device. */
export function useTune(): readonly [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TUNE_KEY) === '1') setOpen(true);
    } catch {
      // A browser that keeps nothing: the choice lasts the visit.
    }
  }, []);
  const set = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(TUNE_KEY, next ? '1' : '0');
    } catch {
      // The same.
    }
  };
  return [open, set];
}
