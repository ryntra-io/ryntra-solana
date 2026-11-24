'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { DepthAnswer, DepthCoin, DepthKind, DepthWindow } from '@/lib/market-depth/model';
import { noteDayMoves } from './day-move';
import { AGES, DEFAULT_FILTERS, DEFAULT_QUICK, DEFAULT_WINDOW, VENUES, isQuick, withTwin, type Filters, type KindTab, type QuickSol, type Range, type ShownList } from './depth-view';

/**
 * The Market's depth in the browser (by kind of asset): one kind's list over one window at a time, read from the engine
 * (`/api/v1/market/depth`) and read again every `REFRESH_MS` while the page is in view; every list already read stays,
 * so going back to a list shows it at once. The person's own choices — the list, the window, the filters, the quick-buy
 * sum — stay in this browser. Which columns the table shows is the table's own memory (`terminal/ui/column-set.ts`).
 */

export const REFRESH_MS = 30_000;
/** The counts over the lists not on screen are read again this often. */
const AHEAD_MS = 120_000;
/* v2: the filters of decision 109 — «Hide risky» on, «Verified only» off; a v1 choice is not read back. */
const PREFS_KEY = 'ryntra.terminal.market.depth.v2';

export type Read = Readonly<{ status: 'reading' | 'ready' | 'failed'; coins: readonly DepthCoin[]; at: number }>;
/** What a read is of: one kind's list («meme/trending»), or the starred coins. */
export type Target = 'saved' | `${DepthKind}/${ShownList}`;
export const targetOf = (tab: KindTab, list: ShownList): Target => (tab === 'saved' ? 'saved' : `${tab}/${list}`);

type DepthState = {
  reads: Readonly<Record<string, Read>>;
  /** The tab: a kind of asset, or «Saved». */
  tab: KindTab;
  /** The list's view: trending, rising, falling, most trades. */
  list: ShownList;
  window: DepthWindow;
  filters: Filters;
  quick: QuickSol;
};

export const useDepth = create<DepthState>(() => ({ reads: {}, tab: 'all', list: 'trending', window: DEFAULT_WINDOW, filters: DEFAULT_FILTERS, quick: DEFAULT_QUICK }));

export const readKey = (target: Target, window: DepthWindow, mints: readonly string[] = []) => (target === 'saved' ? `saved:${[...mints].sort().join(',')}` : `${target}:${window}`);

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

const bound = (value: unknown): number | null | undefined => (value === null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);

function pickRange(raw: unknown): Range | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const min = bound((raw as Range).min);
  const max = bound((raw as Range).max);
  return min === undefined || max === undefined ? undefined : { min, max };
}

function pickFilters(raw: Partial<Filters>): Partial<Filters> {
  const out: Record<string, unknown> = {};
  for (const key of ['liquidity', 'mcap'] as const) {
    const range = pickRange(raw[key]);
    if (range) out[key] = range;
  }
  for (const key of ['volume', 'holders'] as const) if (bound(raw[key]) !== undefined) out[key] = raw[key];
  for (const key of ['verified', 'hideRisky'] as const) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if ((AGES as readonly unknown[]).includes(raw.age)) out.age = raw.age;
  if ((VENUES as readonly unknown[]).includes(raw.venue)) out.venue = raw.venue;
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

export const setTab = (tab: KindTab) => useDepth.setState({ tab });
export const setList = (list: ShownList) => useDepth.setState({ list });
export const setWindow = (window: DepthWindow) => (useDepth.setState({ window }), keep());
export const setFilters = (filters: Filters) => (useDepth.setState({ filters }), keep());
export const setQuick = (quick: QuickSol) => (useDepth.setState({ quick }), keep());

const flying = new Map<string, Promise<void>>();

/** One read of a list at a time: a second ask while it flies waits for the same answer. */
function read(target: Target, window: DepthWindow, mints: readonly string[]): Promise<void> {
  const key = readKey(target, window, mints);
  const flown = flying.get(key);
  if (flown) return flown;
  const once = readOnce(key, target, window, mints).finally(() => flying.delete(key));
  flying.set(key, once);
  return once;
}

async function readOnce(key: string, target: Target, window: DepthWindow, mints: readonly string[]): Promise<void> {
  const had = useDepth.getState().reads[key];
  if (!had) useDepth.setState((st) => ({ reads: { ...st.reads, [key]: { status: 'reading', coins: [], at: 0 } } }));
  const [kind, list] = target.split('/');
  const query = target === 'saved' ? `list=saved&mints=${mints.slice(0, 50).join(',')}` : `list=${list}&kind=${kind}&window=${window}`;
  try {
    const res = await fetch(`/api/v1/market/depth?${query}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as DepthAnswer;
    // A ticker in a known coin's letters from another script is a twin, said and hidden as one.
    const coins = Array.isArray(body.coins) ? body.coins.map(withTwin) : [];
    // Each coin's day, noted as of the read: every screen says the newest.
    const readAt = typeof body.readAt === 'string' ? Date.parse(body.readAt) : Number.NaN;
    noteDayMoves(
      coins.map((coin) => ({ mint: coin.id, change: coin.stats['24h']?.change ?? null })),
      Number.isFinite(readAt) ? Math.min(readAt, Date.now()) : Date.now(),
    );
    useDepth.setState((st) => ({ reads: { ...st.reads, [key]: { status: 'ready', coins, at: Date.now() } } }));
  } catch {
    // A failed read keeps what was on screen; with nothing yet, the list says it did not come.
    useDepth.setState((st) => ({ reads: { ...st.reads, [key]: had?.coins.length ? { ...had, status: 'ready' } : { status: 'failed', coins: [], at: Date.now() } } }));
  }
}

/**
 * «Try again»: the lists that did not answer are read now — the one on screen and, for «All», the two
 * it is made of. A list that never answered shows its bones while it is read, so the press is seen.
 */
export function readDepthAgain(targets: readonly Target[], window: DepthWindow, mints: readonly string[] = []): void {
  for (const target of targets) {
    const key = readKey(target, window, mints);
    if (useDepth.getState().reads[key]?.status === 'failed') useDepth.setState((st) => ({ reads: { ...st.reads, [key]: { status: 'reading', coins: [], at: 0 } } }));
    void read(target, window, mints);
  }
}

/** Keeps the list on screen read: now, then every `REFRESH_MS` while the page is visible. */
export function useDepthRead(list: Target, window: DepthWindow, mints: readonly string[]): Read {
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

/**
 * Reads lists ahead — each kind's view on screen — so the count over a tab is there before it is opened. A view or a
 * window just picked has every kind's list asked at once (QA 19.11: on «Rising» the counts came one by one, seconds
 * apart, and stood missing meanwhile); after that they are read again one at a time.
 */
export function useDepthAhead(lists: readonly Target[], window: DepthWindow): void {
  const key = lists.join(',');
  useEffect(() => {
    const ahead = key.split(',') as Target[];
    for (const list of ahead) {
      const had = useDepth.getState().reads[readKey(list, window)];
      if (!had || had.status === 'failed') void read(list, window, []);
    }
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

/** The engine's shelf of verified stocks and private companies: the lists the agent's line also knows coins from. */
export const SHELF_TARGETS: readonly Target[] = [targetOf('stock', 'trending'), targetOf('preipo', 'trending')];

/** The shelf's coins as last read (any window), each once. */
export function shelfNow(reads: DepthState['reads'] = useDepth.getState().reads): DepthCoin[] {
  const seen = new Set<string>();
  const out: DepthCoin[] = [];
  for (const [key, value] of Object.entries(reads)) {
    if (!SHELF_TARGETS.some((target) => key.startsWith(`${target}:`)) || value.status !== 'ready') continue;
    for (const coin of value.coins) {
      if (seen.has(coin.id)) continue;
      seen.add(coin.id);
      out.push(coin);
    }
  }
  return out;
}

/**
 * The shelf read now unless a fresh read stands (release 20.11: a share out of the market's top was «not on the
 * market» to the agent's line). Resolves once both lists have answered or failed; never throws.
 */
export async function readShelf(): Promise<void> {
  await Promise.all(
    SHELF_TARGETS.map((target) => {
      const had = useDepth.getState().reads[readKey(target, DEFAULT_WINDOW)];
      return had?.status === 'ready' && Date.now() - had.at < AHEAD_MS ? null : read(target, DEFAULT_WINDOW, []);
    }),
  );
}
