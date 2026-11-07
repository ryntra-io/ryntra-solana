import { useEffect, useState } from 'react';
import type { Tower } from '../market/types.ts';
import { useMine } from '../trade/mine-store.ts';
import { useWallet } from '../trade/wallet.ts';
import { fetchCandles, loading, nextReadMs, settle, TIMEFRAME_KEY, timeframeFrom, type ChartData, type Timeframe } from './candles.ts';
import { entryPrice, knownBasis, readEntryBasis } from './entry.ts';
import { kept } from './kept.ts';
import { fetchMarks } from './marks.ts';
import type { LayerMark } from './layers.ts';
import type { Basis } from '../trade/mine.ts';
import { cityInView } from '../window/out.ts';

/** The tower chart's reads (CITY-5a): the bars, the coin's marks and the wallet's entry, each while the window is open. */

/** The page is seen: its tab, or the chart out in Picture-in-Picture while the tab is behind another (CITY-75). */
const visible = () => cityInView();

/**
 * The interval the person last picked, kept in this browser. The window is drawn only in the browser, so the kept
 * interval is read before the first frame: the chart never opens on the default and then jumps, and never reads bars
 * it is about to drop.
 */
export function useTimeframe(): [Timeframe, (next: Timeframe) => void] {
  const [timeframe, setTimeframe] = useState<Timeframe>(() => timeframeFrom(kept(TIMEFRAME_KEY)));
  const set = (next: Timeframe) => {
    setTimeframe(next);
    try {
      window.localStorage.setItem(TIMEFRAME_KEY, next);
    } catch {
      // Nothing to keep.
    }
  };
  return [timeframe, set];
}

/**
 * One market's bars at one interval, read again at the interval's own cadence while the page is in view. A read that
 * failed is tried again quietly, sooner at first and then less often, never before the engine's `Retry-After`; its last
 * good bars stay on screen, stale, and with none the frame keeps waiting for a few tries before it says anything.
 */
export function useCandles(mint: string, timeframe: Timeframe): ChartData {
  const [data, setData] = useState<ChartData>(() => loading(mint, timeframe, null));
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Failed reads in a row, as the state counts them: the pause before the next try grows with them.
    let misses = 0;
    setData((before) => loading(mint, timeframe, before));
    const read = async () => {
      const answer = await fetchCandles(mint, timeframe, {
        fetch: (url, init) => fetch(url, { ...init, headers: { accept: 'application/json' } }),
        now: () => Date.now(),
        signal: controller.signal,
      });
      if (!live) return;
      misses = answer.status === 'unavailable' ? misses + 1 : 0;
      setData((before) => settle(before.mint === mint && before.timeframe === timeframe ? before : loading(mint, timeframe, null), answer));
      wait(nextReadMs(answer, misses, timeframe));
    };
    // The page out of view reads nothing: it looks again after the same pause.
    const wait = (ms: number) => {
      timer = setTimeout(() => {
        if (!live) return;
        if (visible()) void read();
        else wait(ms);
      }, ms);
    };
    void read();
    return () => {
      live = false;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [mint, timeframe]);
  return data;
}

/** How often an open chart reads the coin's marks again: the engine keeps them about this long. */
const MARKS_MS = 60_000;

/** No marks: one array, so the chart's layers are not rebuilt on every render while there are none. */
const NO_MARKS: readonly LayerMark[] = [];

/** The coin's market marks; none until read, and none when the read failed. */
export function useMarketMarks(mint: string): readonly LayerMark[] {
  const [marks, setMarks] = useState<Readonly<{ mint: string; marks: readonly LayerMark[] }> | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const answer = await fetchMarks(mint, (url) => fetch(url, { headers: { accept: 'application/json' } }));
      if (live && answer.kind === 'ready') setMarks({ mint, marks: answer.marks });
    };
    void read();
    const timer = setInterval(() => {
      if (visible()) void read();
    }, MARKS_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mint]);
  return marks && marks.mint === mint ? marks.marks : NO_MARKS;
}

/**
 * The wallet's average entry in this coin, in dollars, or null: no wallet, the coin not held, no proof of the wallet in
 * this browser, or a holding the engine cannot cost whole. «Mine»'s read is used when it has this very balance; else
 * the chart reads the same record once for this coin. Reading only: the wallet is never asked for anything.
 */
export function useEntry(tower: Pick<Tower, 'id'>): number | null {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const balance = useWallet((st) => st.holdings?.tokens.get(tower.id) ?? null);
  const raw = balance?.spendableRaw ?? null;
  const known = useMine((st) => (owner && raw ? knownBasis(st, owner, tower.id, raw) : undefined));
  const [read, setRead] = useState<Readonly<{ key: string; basis: Basis | null }> | null>(null);
  // One read per wallet, coin and balance: a refresh of the balances that changed nothing reads nothing.
  const key = owner && raw ? `${owner}|${tower.id}|${raw}` : null;
  useEffect(() => {
    if (!key || !owner || !raw || known !== undefined) return;
    let live = true;
    void readEntryBasis(owner, tower.id, raw, (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })).then((answer) => {
      if (live) setRead({ key, basis: answer.kind === 'basis' ? answer.basis : null });
    });
    return () => {
      live = false;
    };
  }, [key, owner, raw, known, tower.id]);
  if (!balance) return null;
  const basis = known !== undefined ? known : read && read.key === key ? read.basis : null;
  return entryPrice(basis, balance.decimals);
}

/** The window's size, followed as it changes; known from the first frame in the browser, so the window opens in place. */
export function useViewport(): Readonly<{ w: number; h: number }> | null {
  const [viewport, setViewport] = useState<Readonly<{ w: number; h: number }> | null>(() =>
    typeof window === 'undefined' ? null : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const read = () =>
      setViewport((before) => (before && before.w === window.innerWidth && before.h === window.innerHeight ? before : { w: window.innerWidth, h: window.innerHeight }));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return viewport;
}
