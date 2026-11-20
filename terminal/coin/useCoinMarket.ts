'use client';

import { useEffect, useRef, useState } from 'react';
import { directFetch, namedPools, readTradesDirect } from '@/city/lib/chart/direct';
import type { SpotMarket } from '@/lib/spot/markets';
import { mergeTape, type TokenHolder, type TokenPool, type TokenTrade } from './tape-view';

/**
 * The reads of one coin's desk, all the engine's own and all reads only:
 *
 * - the coin's market (`/api/spot/market`): its price, the day's move, volume, liquidity, capitalisation, holders, the
 *   top holders' and the creator's share, the mint's rights, its site and X — read again every half minute;
 * - its trades (`/api/spot/token?part=trades`): the pool's latest trades, read again every few seconds while the page is
 *   in view, the new ones laid over those on screen;
 * - its holders and its pools (`part=holders`, `part=pools`): read when a tab asks for them.
 *
 * A read that fails keeps what is on screen; one that never came is said as failed, never drawn as an empty list.
 */

const MARKET_MS = 30_000;
const TRADES_MS = 8_000;
const HOLDERS_MS = 60_000;
const POOLS_MS = 120_000;

type Status = 'reading' | 'ready' | 'failed' | 'none';

/** The engine's answer, or its refusal with its status and body (a refusal names the pools it would read). */
async function readJson<T>(url: string, signal: AbortSignal): Promise<Readonly<{ ok: true; body: T } | { ok: false; status: number; body: unknown }>> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    const body = (await response.json().catch(() => null)) as unknown;
    return response.ok ? { ok: true, body: body as T } : { ok: false, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * One read of a coin, kept fresh: at once, then every `every` ms while the page is in view; `on` false reads nothing.
 * `take` turns the engine's answer into what the screen holds, or `none` — the engine said the coin has none of it.
 * `rescue` — the spare way when the engine refused (429/503) with nothing held: the same source read by the browser.
 */
function usePolled<T, A>(
  url: string | null,
  every: number,
  take: (body: A) => T | 'none' | null,
  rescue?: (refusal: unknown, signal: AbortSignal) => Promise<T | null>,
): Readonly<{ status: Status; value: T | null; stale: boolean }> {
  const [state, setState] = useState<Readonly<{ url: string | null; status: Status; value: T | null; stale: boolean }>>({ url, status: 'reading', value: null, stale: false });
  const takeRef = useRef(take);
  takeRef.current = take;
  const rescueRef = useRef(rescue);
  rescueRef.current = rescue;
  useEffect(() => {
    if (!url) return;
    const stop = new AbortController();
    setState((was) => (was.url === url ? was : { url, status: 'reading', value: null, stale: false }));
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      const answer = await readJson<A>(url, stop.signal);
      if (stop.signal.aborted) return;
      // An answer that was no JSON is a failed read, as before.
      let value = answer.ok && answer.body !== null && typeof answer.body === 'object' ? takeRef.current(answer.body) : null;
      if (!answer.ok && (answer.status === 429 || answer.status === 503) && rescueRef.current) {
        value = await rescueRef.current(answer.body, stop.signal);
        if (stop.signal.aborted) return;
      }
      setState((was) => {
        const same = was.url === url ? was : { url, status: 'reading' as Status, value: null, stale: false };
        if (value === 'none') return { url, status: 'none', value: null, stale: false };
        // A read that failed keeps what is on screen, said as stale until the next good one.
        if (value === null) return same.value !== null ? { ...same, stale: true } : { url, status: 'failed', value: null, stale: false };
        return { url, status: 'ready', value, stale: false };
      });
    };
    void read();
    const timer = setInterval(() => void read(), every);
    const back = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', back);
    return () => {
      stop.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [url, every]);
  return state.url === url ? state : { status: 'reading', value: null, stale: false };
}

type NoneAnswer = Readonly<{ none?: Readonly<{ code: string }> }>;

/** The coin's market as the engine reads it from Jupiter: the head's figures, the facts under the ticket, its links. */
export function useSpotMarket(mint: string): SpotMarket | null {
  const read = usePolled<SpotMarket, Readonly<{ market?: SpotMarket }>>(`/api/spot/market?mint=${encodeURIComponent(mint)}`, MARKET_MS, (body) => (body.market && body.market.mint === mint ? body.market : null));
  return read.value;
}

/** `stale` — the last read failed and the trades on screen are the last good ones. */
export type Tape = Readonly<{ status: Status; trades: readonly TokenTrade[]; fresh: ReadonlySet<string>; stale: boolean }>;

const NO_FRESH: ReadonlySet<string> = new Set();

/**
 * The coin's trades as they come: the latest read laid over those on screen, the new ones marked for a moment.
 * `price` — the price on screen: given, a refusal of the engine is followed by the same pools read from this browser,
 * shown only if they agree with it.
 */
export function useTape(mint: string, on = true, price: number | null = null): Tape {
  const priceRef = useRef(price);
  priceRef.current = price;
  const held = useRef<Readonly<{ mint: string; trades: readonly TokenTrade[] }>>({ mint, trades: [] });
  const [tape, setTape] = useState<Readonly<{ mint: string; trades: readonly TokenTrade[]; fresh: ReadonlySet<string> }>>({ mint, trades: [], fresh: NO_FRESH });
  const read = usePolled<readonly TokenTrade[], Readonly<{ trades?: readonly TokenTrade[] } & NoneAnswer>>(
    on ? `/api/spot/token?mint=${encodeURIComponent(mint)}&part=trades` : null,
    TRADES_MS,
    (body) => (body.none ? 'none' : Array.isArray(body.trades) ? body.trades : null),
    // The engine refused with none held — the same pools' trades, read by this browser (no cookie, no referrer).
    (refusal, signal) => readTradesDirect(mint, namedPools(refusal), priceRef.current, { fetch: directFetch, now: () => Date.now(), signal }),
  );
  useEffect(() => {
    if (!read.value) return;
    const before = held.current.mint === mint ? held.current.trades : [];
    const next = mergeTape(before, read.value);
    held.current = { mint, trades: next.trades };
    setTape({ mint, trades: next.trades, fresh: next.fresh });
  }, [read.value, mint]);
  const trades = tape.mint === mint ? tape.trades : [];
  return { status: trades.length ? 'ready' : read.status, trades, fresh: tape.mint === mint ? tape.fresh : NO_FRESH, stale: read.stale };
}

export type HoldersRead = Readonly<{ holders: readonly TokenHolder[]; programPct: number | null; supply: number | null }>;

/** The coin's largest holders, with their share and what each did in the trades read; read while a tab shows them. */
export function useHolders(mint: string, on: boolean): Readonly<{ status: Status; value: HoldersRead | null; stale: boolean }> {
  return usePolled<HoldersRead, HoldersRead & NoneAnswer>(on ? `/api/spot/token?mint=${encodeURIComponent(mint)}&part=holders` : null, HOLDERS_MS, (body) => (body.none ? 'none' : Array.isArray(body.holders) ? { holders: body.holders, programPct: body.programPct ?? null, supply: body.supply ?? null } : null));
}

/** Where the coin trades, the deepest pool first; read while a tab shows them. */
export function usePools(mint: string, on: boolean): Readonly<{ status: Status; value: readonly TokenPool[] | null; stale: boolean }> {
  return usePolled<readonly TokenPool[], Readonly<{ pools?: readonly TokenPool[] }> & NoneAnswer>(on ? `/api/spot/token?mint=${encodeURIComponent(mint)}&part=pools` : null, POOLS_MS, (body) => (body.none ? 'none' : Array.isArray(body.pools) ? body.pools : null));
}

/** A clock for «12s ago»: it ticks every few seconds while something on screen counts from it. */
export function useNow(every = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
