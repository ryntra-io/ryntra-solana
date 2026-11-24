'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpotMarket } from '@/lib/spot/markets';
import type { PulseRow } from '@/lib/spot/pulse';
import type { RiskFact, TokenFacts } from '@/lib/spot/token-page';
import { passportOf, type CoinPassport, type CurveRead } from './passport-data';

/**
 * The coin's passport, read: the engine's three public reads of one coin, kept fresh while the page is in
 * view, as one model (`passportOf`):
 *
 * - the coin's market (`/api/spot/market`) — the full value, the people who traded, the age, the rights and shares;
 *   a screen that already reads it hands it in (`market`), and the passport does not read it twice;
 * - the token's overview (`/api/spot/token?part=overview`) — the moves by window, the creator and their coins, the
 *   launchpad and the day the coin left its curve;
 * - the facts behind its risk (`part=risk`) — the same facts with whether selling works;
 * - while the coin is on its launch curve, its Pulse row (`/api/spot/pulse?feed=watchlist`) — how far the curve is,
 *   where the engine reads it.
 *
 * Reads only: nothing here signs, sends or asks for a key. A read that fails keeps what is on screen; one that never
 * came leaves its figures unknown, never zero.
 */

const MARKET_MS = 30_000;
const OVERVIEW_MS = 60_000;
const RISK_MS = 120_000;
const CURVE_MS = 20_000;
/** The age is counted again this often, so «38m» does not stand still. */
const CLOCK_MS = 30_000;

export type PassportStatus = 'reading' | 'ready' | 'failed';
type Read<T> = Readonly<{ url: string | null; status: 'reading' | 'ready' | 'failed' | 'none'; value: T | null }>;

async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** One read kept fresh: at once, then every `every` ms while the page is in view; no `url` reads nothing. */
function usePolled<T, A>(url: string | null, every: number, take: (body: A) => T | 'none' | null): Read<T> {
  const [state, setState] = useState<Read<T>>({ url, status: 'reading', value: null });
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    if (!url) return;
    const stop = new AbortController();
    setState((was) => (was.url === url ? was : { url, status: 'reading', value: null }));
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      const body = await readJson<A>(url, stop.signal);
      if (stop.signal.aborted) return;
      const value = body === null ? null : takeRef.current(body);
      setState((was) => {
        if (value === 'none') return { url, status: 'none', value: null };
        /* A read that failed keeps what is on screen. */
        if (value === null) return was.url === url && was.value !== null ? was : { url, status: 'failed', value: null };
        return { url, status: 'ready', value };
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
  return state.url === url ? state : { url, status: url ? 'reading' : 'none', value: null };
}

type NoneAnswer = Readonly<{ none?: Readonly<{ code: string }> }>;

/** The clock the age is counted on, a tick every half minute. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The passport of one coin and whether it is still being read. `market` — the coin's market the screen already reads
 * (`useSpotMarket`): given, even as null while it reads, the passport takes it instead of reading its own.
 */
export function useCoinPassport(mint: string, options: Readonly<{ market?: SpotMarket | null }> = {}): Readonly<{ passport: CoinPassport | null; status: PassportStatus }> {
  const handed = options.market !== undefined;
  const q = encodeURIComponent(mint);
  const own = usePolled<SpotMarket, Readonly<{ market?: SpotMarket | null }>>(handed ? null : `/api/spot/market?mint=${q}`, MARKET_MS, (body) => (body.market === null ? 'none' : body.market && body.market.mint === mint ? body.market : null));
  const overview = usePolled<TokenFacts, Readonly<{ facts?: TokenFacts | null }> & NoneAnswer>(`/api/spot/token?mint=${q}&part=overview`, OVERVIEW_MS, (body) => (body.none ? 'none' : body.facts && body.facts.mint === mint ? body.facts : body.facts === null ? 'none' : null));
  const risk = usePolled<readonly RiskFact[], Readonly<{ facts?: readonly RiskFact[] }> & NoneAnswer>(`/api/spot/token?mint=${q}&part=risk`, RISK_MS, (body) => (body.none ? 'none' : Array.isArray(body.facts) ? body.facts : null));
  /* The curve is read only while the coin is on one: a launchpad named, the day it left not. */
  const onCurve = overview.value !== null && overview.value.launchpad !== null && overview.value.graduatedAt === null;
  const curve = usePolled<CurveRead, Readonly<{ rows?: readonly PulseRow[] }>>(onCurve ? `/api/spot/pulse?feed=watchlist&mints=${q}` : null, CURVE_MS, (body) => {
    const row = body.rows?.find((one) => one.mint === mint);
    return row?.curve ? { progressPct: row.curve.progressPct, complete: row.curve.complete } : Array.isArray(body.rows) ? 'none' : null;
  });
  const now = useClock();
  const market = handed ? (options.market ?? null) : own.value;
  const passport = useMemo(
    () => passportOf({ mint, market, facts: overview.value, risk: risk.value, curve: curve.value, now }),
    [mint, market, overview.value, risk.value, curve.value, now],
  );
  const reads = [handed ? null : own.status, overview.status, risk.status].filter((status) => status !== null);
  const status: PassportStatus = passport ? 'ready' : reads.some((s) => s === 'reading') ? 'reading' : 'failed';
  return { passport, status };
}
