'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { DepthAnswer, DepthCoin, DepthList, DepthWindow } from '@/lib/market-depth/model';
import { DEFAULT_FILTERS, DEFAULT_QUICK, DEFAULT_WINDOW, isQuick, type Filters, type QuickSol } from './depth-view';

/**
 * The Market's depth in the browser: one list over one window at a time, read from the engine
 * (`/api/v1/market/depth`) and read again every `REFRESH_MS` while the page is in view; every list already read stays,
 * so going back to a list shows it at once. The person's own choices — the list, the window, the filters, the quick-buy
 * sum — stay in this browser. Which columns the table shows is the table's own memory (`terminal/ui/column-set.ts`).
 */

export const REFRESH_MS = 30_000;
/** The counts over the lists not on screen are read again this often. */
const AHEAD_MS = 120_000;
const PREFS_KEY = 'ryntra.terminal.market.depth.v1';

export type Read = Readonly<{ status: 'reading' | 'ready' | 'failed'; coins: readonly DepthCoin[]; at: number }>;
type Pick = DepthList | 'saved';

type DepthState = {
  reads: Readonly<Record<string, Read>>;
  list: Pick;
  window: DepthWindow;
  filters: Filters;
  quick: QuickSol;
};

export const useDepth = create<DepthState>(() => ({ reads: {}, list: 'trending', window: DEFAULT_WINDOW, filters: DEFAULT_FILTERS, quick: DEFAULT_QUICK }));

export const readKey = (list: Pick, window: DepthWindow, mints: readonly string[] = []) => (list === 'saved' ? `saved:${[...mints].sort().join(',')}` : `${list}:${window}`);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The person's own choices, as they were left. */
export function startPrefs(): void {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    if (!raw) return;
    const kept = JSON.parse(raw) as Partial<{ window: string; filters: Partial<Filters>; quick: string }>;
    useDepth.setState((st) => ({
      window: kept.window === '5m' || kept.window === '1h' || kept.window === '6h' || kept.window === '24h' ? kept.window : st.window,
      filters: kept.filters && typeof kept.filters === 'object' ? { ...DEFAULT_FILTERS, ...pickFilters(kept.filters) } : st.filters,
      quick: isQuick(kept.quick) ? kept.quick : st.quick,
    }));
  } catch {
    // A kept choice that does not read is not one.
  }
}

function pickFilters(raw: Partial<Filters>): Partial<Filters> {
  const out: Record<string, unknown> = {};
  for (const key of ['mcap', 'liquidity', 'volume', 'holders'] as const) if (raw[key] === null || typeof raw[key] === 'number') out[key] = raw[key];
  if (typeof raw.verified === 'boolean') out.verified = raw.verified;
  if (raw.age && ['any', '1h', '24h', '7d', '30d', 'old'].includes(raw.age)) out.age = raw.age;
  if (raw.change && ['any', 'up', 'down'].includes(raw.change)) out.change = raw.change;
  return out as Partial<Filters>;
}

function keep(): void {
  const { window, filters, quick } = useDepth.getState();
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify({ window, filters, quick }));
  } catch {
    // Without storage the choice lives while the page is open.
  }
}

export const setList = (list: Pick) => useDepth.setState({ list });
export const setWindow = (window: DepthWindow) => (useDepth.setState({ window }), keep());
export const setFilters = (filters: Filters) => (useDepth.setState({ filters }), keep());
export const setQuick = (quick: QuickSol) => (useDepth.setState({ quick }), keep());

const flying = new Set<string>();

async function read(list: Pick, window: DepthWindow, mints: readonly string[]): Promise<void> {
  const key = readKey(list, window, mints);
  if (flying.has(key)) return;
  flying.add(key);
  const had = useDepth.getState().reads[key];
  if (!had) useDepth.setState((st) => ({ reads: { ...st.reads, [key]: { status: 'reading', coins: [], at: 0 } } }));
  const query = list === 'saved' ? `list=saved&mints=${mints.slice(0, 50).join(',')}` : `list=${list}&window=${window}`;
  try {
    const res = await fetch(`/api/v1/market/depth?${query}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as DepthAnswer;
    const coins = Array.isArray(body.coins) ? body.coins : [];
    useDepth.setState((st) => ({ reads: { ...st.reads, [key]: { status: 'ready', coins, at: Date.now() } } }));
  } catch {
    // A failed read keeps what was on screen; with nothing yet, the list says it did not come.
    useDepth.setState((st) => ({ reads: { ...st.reads, [key]: had?.coins.length ? { ...had, status: 'ready' } : { status: 'failed', coins: [], at: Date.now() } } }));
  } finally {
    flying.delete(key);
  }
}

/** Keeps the list on screen read: now, then every `REFRESH_MS` while the page is visible. */
export function useDepthRead(list: Pick, window: DepthWindow, mints: readonly string[]): Read {
  const key = readKey(list, window, mints);
  const mintsKey = mints.join(',');
  useEffect(() => {
    const listMints = mintsKey ? mintsKey.split(',') : [];
    if (list === 'saved' && !listMints.length) return;
    const at = useDepth.getState().reads[key]?.at ?? 0;
    if (Date.now() - at > REFRESH_MS / 2) void read(list, window, listMints);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void read(list, window, listMints);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [key, list, window, mintsKey]);
  const now = useDepth((st) => st.reads[key]);
  // A star toggled in «Saved» changes the read: the rows already on screen stay while the new one comes.
  const kept = useRef<Read | null>(null);
  if (list === 'saved' && now?.status === 'ready') kept.current = now;
  if (now && (now.status === 'ready' || list !== 'saved')) return now;
  if (list === 'saved' && !mints.length) return { status: 'ready', coins: [], at: 0 };
  if (list === 'saved' && kept.current) return { ...kept.current, coins: kept.current.coins.filter((coin) => mints.includes(coin.id)) };
  return now ?? { status: 'reading', coins: [], at: 0 };
}

/** Reads a list ahead, so the count over it is there before it is opened. */
export function useDepthAhead(lists: readonly DepthList[], window: DepthWindow): void {
  const key = lists.join(',');
  useEffect(() => {
    const ahead = key.split(',') as DepthList[];
    let i = 0;
    // One after another, a moment apart: the first list on screen goes first; the counts are read again every
    // `AHEAD_MS` while the page is in view.
    const timer = setInterval(() => {
      const list = ahead[i++ % ahead.length]!;
      const at = useDepth.getState().reads[readKey(list, window)]?.at ?? 0;
      if (Date.now() - at > AHEAD_MS && document.visibilityState === 'visible') void read(list, window, []);
    }, 1_200);
    return () => clearInterval(timer);
  }, [key, window]);
}
