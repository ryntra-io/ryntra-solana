import { useCallback, useEffect, useRef, useState } from 'react';
import { holdsOf, type Holds } from './watch-view';

/** What a wallet holds is read again this often while its page is in front. */
const AGAIN_MS = 60_000;

export type HoldsRead = Readonly<{ status: 'reading' | 'ready' | 'failed'; holds: Holds | null; again: () => void }>;

/**
 * What any wallet holds across Solana, by its address alone: the portfolio's own read (`/api/v1/portfolio?owner=`,
 * public data of a public address), the biggest first. A read that falls keeps the last one on screen. Reads only.
 */
export function useHolds(owner: string | null): HoldsRead {
  const [kept, setKept] = useState<Readonly<{ owner: string; holds: Holds | null; failed: boolean }> | null>(null);
  const round = useRef(0);

  const read = useCallback(async () => {
    if (!owner) return;
    const mine = ++round.current;
    let holds: Holds | null = null;
    try {
      const answer = await fetch(`/api/v1/portfolio?${new URLSearchParams({ owner })}`, { cache: 'no-store', headers: { accept: 'application/json', 'X-Ryntra-API': '1' } });
      holds = answer.ok ? holdsOf(await answer.json(), owner) : null;
    } catch {
      holds = null;
    }
    if (mine !== round.current) return;
    setKept((was) => (holds ? { owner, holds, failed: false } : was?.owner === owner && was.holds ? { ...was, failed: true } : { owner, holds: null, failed: true }));
  }, [owner]);

  useEffect(() => {
    round.current += 1;
    if (!owner) return;
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read();
    }, AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [owner, read]);

  const mine = kept?.owner === owner ? kept : null;
  return { status: !mine ? 'reading' : mine.holds ? 'ready' : 'failed', holds: mine?.holds ?? null, again: () => void read() };
}
