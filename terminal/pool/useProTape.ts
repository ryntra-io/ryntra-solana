'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isProDaysAnswer, isProFillsAnswer, isProStatsAnswer, isProTradesAnswer, type ProFillsAnswer, type ProStatsAnswer, type ProTradesAnswer } from '../../lib/pro-pools/tape.ts';
import { dayOf, daysOf, type ProDay } from './pro-tape.ts';
import { readQueue } from './read-queue.ts';
import type { Read } from './usePro.ts';

/**
 * A DLMM Pro pool's day, trades and filled limit orders from the engine's open reads (`/api/pro/pools/…`).
 *
 * The pools' table reads every pool's day in one answer (`/api/pro/pools/days`), kept a minute and asked again sooner
 * while some pool is still counting: the cells fill together, never row by row. One pool's own page reads its day alone
 * (`/api/pro/pools/<address>/stats`). A pool whose day is not known is no figure: its cell stays empty, never a zero.
 */

const DAY_MS = 60_000;
const LIST_MS = 20_000;
/** While some pool of the table is still counting, the days are asked again this soon. */
const COUNTING_MS = 6_000;
/** Reads of a pool's day in flight at once. */
const AT_ONCE = 4;
/** The pause before a day the engine refused for being busy is asked once more. */
const RETRY_MS = 1_500;
/** The most pools a list shows the day of — as many as the engine counts. */
export const DAY_ROWS = 64;

type Kept = Readonly<{ at: number; answer: ProStatsAnswer | null }>;
const kept = new Map<string, Kept>();
const listeners = new Set<() => void>();
let version = 0;

function told(): void {
  version += 1;
  for (const listen of listeners) listen();
}

async function getJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** One pool's day in line, one quiet second ask after a busy refusal (`./read-queue.ts`). */
const days = readQueue({
  atOnce: AT_ONCE,
  retryMs: RETRY_MS,
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  read: async (address) => {
    const response = await fetch(`/api/pro/pools/${encodeURIComponent(address)}/stats`, { headers: { accept: 'application/json' } });
    return { status: response.status, body: response.ok ? await response.json().catch(() => null) : null };
  },
  done: (address, body) => {
    const was = kept.get(address);
    // A read that failed keeps the last good answer on screen; a pool never read stays without a figure.
    kept.set(address, { at: Date.now(), answer: isProStatsAnswer(body) ? body : (was?.answer ?? null) });
    told();
  },
});

/** Asks for the day of one pool, unless read in the last minute. */
function askDay(address: string): void {
  const known = kept.get(address);
  if (!(known && Date.now() - known.at < DAY_MS) && !days.busy(address)) days.ask([address]);
}

/** Every pool's day as the table holds it: when last asked, the days, whether some pool was still counting. */
let table: Readonly<{ at: number; days: ReadonlyMap<string, ProDay>; counting: boolean }> = { at: 0, days: new Map(), counting: false };
let tableAsking = false;

/** Asks for every pool's day at once, unless asked within the minute (a few seconds while some pool is counting). */
async function askTable(): Promise<void> {
  if (tableAsking || Date.now() - table.at < (table.counting ? COUNTING_MS : DAY_MS)) return;
  tableAsking = true;
  try {
    const body = await getJson('/api/pro/pools/days');
    // An answer that did not come keeps the days on screen and is asked again soon, as while some pool is counting.
    table = isProDaysAnswer(body) ? { at: Date.now(), ...daysOf(body, table.days) } : { at: Date.now(), days: table.days, counting: true };
    told();
  } finally {
    tableAsking = false;
  }
}

const subscribe = (listen: () => void) => {
  listeners.add(listen);
  return () => listeners.delete(listen);
};
const snapshot = () => version;

/** The day of a pool kept on this page, or null while it is not read. */
export function dayAt(address: string): Readonly<{ answer: ProStatsAnswer; day: ProDay }> | null {
  const answer = kept.get(address)?.answer ?? null;
  return answer ? { answer, day: dayOf(answer.stats) } : null;
}

/** Runs `ask` now, every `everyMs` and when the page comes into view, while `key` names something; `ask` decides whether it is due. */
function useAsking(key: string, ask: () => void, everyMs: number): void {
  useEffect(() => {
    if (!key) return;
    const tick = () => {
      if (document.visibilityState === 'visible') ask();
    };
    tick();
    const timer = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
    // `key` names what is asked; `ask` is made from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, everyMs]);
}

/** The days of the pools a list shows, all from one answer, read again every minute while the page is in view. */
export function useProDays(addresses: readonly string[]): ReadonlyMap<string, ProDay> {
  const seen = useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = addresses.join(',');
  useAsking(key, () => void askTable(), COUNTING_MS);
  return useMemo(() => {
    const out = new Map<string, ProDay>();
    for (const address of key ? key.split(',') : []) {
      const day = table.days.get(address);
      if (day) out.set(address, day);
    }
    return out;
    // `seen` is the store's turn: a new answer makes the map again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seen]);
}

/** One pool's day: its answer and the screen's figures, or null while it is not read (or never answered). */
export function useProDay(address: string | null): Readonly<{ answer: ProStatsAnswer; day: ProDay }> | null {
  const seen = useSyncExternalStore(subscribe, snapshot, snapshot);
  useAsking(address ?? '', () => {
    if (address) askDay(address);
  }, DAY_MS);
  // `seen` is the store's turn: a new answer reads the day again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (address ? dayAt(address) : null), [address, seen]);
}

type ListAnswer<K extends 'trades' | 'fills'> = K extends 'trades' ? ProTradesAnswer : ProFillsAnswer;
const listKept = new Map<string, ProTradesAnswer | ProFillsAnswer>();

/**
 * A pool's newest trades or filled limit orders, read while `on` and again every twenty seconds while the page is in
 * view. The last good answer stays through a read that failed; a list never read is said as failed, never as empty.
 */
export function useProList<K extends 'trades' | 'fills'>(address: string, kind: K, on: boolean): Readonly<{ read: Read<ListAnswer<K>>; again: () => void }> {
  const id = `${kind}:${address}`;
  const [turn, setTurn] = useState(0);
  const again = useCallback(() => {
    setState((was) => (was.read.status === 'failed' ? { id: was.id, read: { status: 'reading' } } : was));
    setTurn((n) => n + 1);
  }, []);
  const [state, setState] = useState<Readonly<{ id: string; read: Read<ListAnswer<K>> }>>(() => {
    const was = listKept.get(id) as ListAnswer<K> | undefined;
    return { id, read: was ? { status: 'ready', value: was } : { status: 'reading' } };
  });
  useEffect(() => {
    if (!on) return;
    let live = true;
    const ask = async () => {
      if (document.visibilityState !== 'visible') return;
      const body = await getJson(`/api/pro/pools/${encodeURIComponent(address)}/${kind}?limit=50`);
      if (!live) return;
      const good = kind === 'trades' ? isProTradesAnswer(body) : isProFillsAnswer(body);
      if (good) {
        listKept.set(id, body as ListAnswer<K>);
        setState({ id, read: { status: 'ready', value: body as ListAnswer<K> } });
      } else if (!listKept.has(id)) setState({ id, read: { status: 'failed' } });
    };
    void ask();
    const timer = setInterval(() => void ask(), LIST_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [address, kind, id, on, turn]);
  if (state.id !== id) {
    const was = listKept.get(id) as ListAnswer<K> | undefined;
    return { read: was ? { status: 'ready', value: was } : { status: 'reading' }, again };
  }
  return { read: state.read, again };
}
