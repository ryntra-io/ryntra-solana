'use client';

import { useEffect, useState } from 'react';

import { useLang } from '@/city/lib/i18n/lang';
import { offHoursRiskLine, type PoolFacts } from '@/lib/stocks/pool-facts';

/**
 * One pool's stock facts in the browser: read once per mint from the one public door
 * (`GET /api/v1/stocks/pool-facts`) and kept a minute, so the pool page's detail, the Grid's risk line and a limit's
 * share one read. Facts handed in by a server page are taken as they are, with no read at all. A failed read leaves
 * nothing on screen (null), never «not a stock».
 */

export const FACTS_KEEP_MS = 60_000;
/** A failed read is asked again after these pauses, then left. */
export const RETRY_MS: readonly number[] = [15_000, 30_000, 60_000];

const kept = new Map<string, Readonly<{ facts: PoolFacts; at: number }>>();
const flights = new Map<string, Promise<PoolFacts | null>>();

/** The read itself, shared by every caller that asks for one mint at once. */
export function readStockPoolFacts(mint: string): Promise<PoolFacts | null> {
  const held = kept.get(mint);
  if (held && Date.now() - held.at < FACTS_KEEP_MS) return Promise.resolve(held.facts);
  const flying = flights.get(mint);
  if (flying) return flying;
  const flight = fetch(`/api/v1/stocks/pool-facts?mint=${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { facts?: PoolFacts };
      if (!body.facts || body.facts.mint !== mint) return null;
      kept.set(mint, { facts: body.facts, at: Date.now() });
      return body.facts;
    })
    .catch(() => null)
    .finally(() => flights.delete(mint));
  flights.set(mint, flight);
  return flight;
}

/** The facts of a pool's coin: the ones given, else the ones read for `mint`; null until read, or with no mint. */
export function useStockPoolFacts(mint: string | null | undefined, given?: PoolFacts | null): PoolFacts | null {
  const [read, setRead] = useState<PoolFacts | null>(() => (mint ? (kept.get(mint)?.facts ?? null) : null));
  useEffect(() => {
    if (given !== undefined || !mint) return;
    let live = true;
    let timer: number | undefined;
    const attempt = (tries: number) => {
      void readStockPoolFacts(mint).then((facts) => {
        if (!live) return;
        setRead(facts);
        // A read that failed is asked again a few times, further apart each time, while the page stays.
        if (facts === null && tries < RETRY_MS.length) timer = window.setTimeout(() => attempt(tries + 1), RETRY_MS[tries]);
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

/**
 * The risk line for the Grid and a limit on a stock, in the language on screen: «Outside exchange hours the
 * price stands still; at the open it may jump.» while the pool's coin is a stock and its exchange is not open; null
 * otherwise. One line before the signature — the Grid draws it where its other lines stand.
 */
export function useOffHoursRisk(mint: string | null | undefined, given?: PoolFacts | null): string | null {
  const facts = useStockPoolFacts(mint, given);
  const lang = useLang();
  return offHoursRiskLine(facts, lang);
}
