'use client';

import { useEffect, useState } from 'react';

import { isPoolsShelf, type PoolsShelf } from '@/lib/stocks/pools-shelf';

/**
 * A stock's pools in the browser: read once per mint from the one public door (`GET /api/v1/stocks/pools`)
 * and kept a minute, so going back to the coin costs nothing. A shelf handed in by a page (the stand) is taken as it is,
 * with no read at all. A read that failed leaves nothing on screen (null) and is asked again a few times while the page
 * stays — never «no pools».
 */

export const POOLS_KEEP_MS = 60_000;
/** A failed read is asked again after these pauses, then left. */
export const RETRY_MS: readonly number[] = [15_000, 30_000, 60_000];

const kept = new Map<string, Readonly<{ shelf: PoolsShelf; at: number }>>();
const flights = new Map<string, Promise<PoolsShelf | null>>();

/** The read itself, shared by every caller that asks for one mint at once. */
export function readStockPools(mint: string): Promise<PoolsShelf | null> {
  const held = kept.get(mint);
  if (held && Date.now() - held.at < POOLS_KEEP_MS) return Promise.resolve(held.shelf);
  const flying = flights.get(mint);
  if (flying) return flying;
  const flight = fetch(`/api/v1/stocks/pools?mint=${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { shelf?: unknown };
      if (!isPoolsShelf(body.shelf, mint)) return null;
      kept.set(mint, { shelf: body.shelf, at: Date.now() });
      return body.shelf;
    })
    .catch(() => null)
    .finally(() => flights.delete(mint));
  flights.set(mint, flight);
  return flight;
}

/** The pools of a stock: the shelf given, else the one read for `mint`; null until read, after a failed read, or with no mint. */
export function useStockPools(mint: string | null | undefined, given?: PoolsShelf | null): PoolsShelf | null {
  const [read, setRead] = useState<PoolsShelf | null>(() => (mint ? (kept.get(mint)?.shelf ?? null) : null));
  useEffect(() => {
    if (given !== undefined || !mint) return;
    let live = true;
    let timer: number | undefined;
    const attempt = (tries: number) => {
      void readStockPools(mint).then((shelf) => {
        if (!live) return;
        setRead(shelf);
        if (shelf === null && tries < RETRY_MS.length) timer = window.setTimeout(() => attempt(tries + 1), RETRY_MS[tries]);
      });
    };
    attempt(0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [mint, given]);
  if (given !== undefined) return given;
  return read && read.mint === mint ? read : null;
}
