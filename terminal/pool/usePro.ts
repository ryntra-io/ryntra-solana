'use client';

import { useCallback, useEffect, useState } from 'react';
import { isProPoolAnswer, isProPoolsAnswer, type ProPoolRow } from '../../lib/pro-pools/model.ts';

/**
 * Meteora DLMM Pro's pools from the engine (`/api/pro/pools`): the list, kept for the page and read again
 * every minute while it is in view; one pool, read again every twenty seconds. The last good read stays on screen
 * through a read that failed; a pool never read is said as failed, never drawn as an empty one.
 */

export type Read<T> = Readonly<{ status: 'reading' }> | Readonly<{ status: 'ready'; value: T }> | Readonly<{ status: 'failed' }> | Readonly<{ status: 'none' }>;

const LIST_MS = 60_000;
const ONE_MS = 20_000;

let listKept: readonly ProPoolRow[] | null = null;
const oneKept = new Map<string, ProPoolRow>();

async function getJson(url: string, signal: AbortSignal): Promise<Readonly<{ status: number; body: unknown }> | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return null;
  }
}

/** Every DLMM Pro pool, deepest first. `again` asks at once. */
export function useProPools(): Readonly<{ read: Read<readonly ProPoolRow[]>; again: () => void }> {
  const [read, setRead] = useState<Read<readonly ProPoolRow[]>>(() => (listKept ? { status: 'ready', value: listKept } : { status: 'reading' }));
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const stop = new AbortController();
    const ask = async () => {
      if (document.visibilityState !== 'visible') return;
      const got = await getJson('/api/pro/pools', stop.signal);
      if (stop.signal.aborted) return;
      if (got && isProPoolsAnswer(got.body)) {
        listKept = got.body.pools;
        setRead({ status: 'ready', value: got.body.pools });
      } else if (!listKept) setRead({ status: 'failed' });
    };
    void ask();
    const timer = setInterval(() => void ask(), LIST_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      stop.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [turn]);
  const again = useCallback(() => {
    setRead((was) => (was.status === 'failed' ? { status: 'reading' } : was));
    setTurn((n) => n + 1);
  }, []);
  return { read, again };
}

/**
 * One DLMM Pro pool by its address: `none` — the engine says there is no such pool. `on` false — the page knows the
 * address as another of Meteora's pools: nothing is asked.
 */
export function useProPool(address: string, on: boolean = true): Read<ProPoolRow> {
  const [state, setState] = useState<Readonly<{ address: string; read: Read<ProPoolRow> }>>(() => {
    const kept = oneKept.get(address) ?? listKept?.find((row) => row.address === address);
    return { address, read: kept ? { status: 'ready', value: kept } : { status: 'reading' } };
  });
  useEffect(() => {
    if (!on) return;
    const stop = new AbortController();
    const kept = oneKept.get(address) ?? listKept?.find((row) => row.address === address);
    setState({ address, read: kept ? { status: 'ready', value: kept } : { status: 'reading' } });
    const ask = async () => {
      if (document.visibilityState !== 'visible') return;
      const got = await getJson(`/api/pro/pools/${encodeURIComponent(address)}`, stop.signal);
      if (stop.signal.aborted) return;
      if (got && isProPoolAnswer(got.body)) {
        oneKept.set(address, got.body.pool);
        setState({ address, read: { status: 'ready', value: got.body.pool } });
      } else if (!oneKept.has(address)) {
        const none = got !== null && (got.status === 404 || got.status === 400);
        setState({ address, read: none ? { status: 'none' } : { status: 'failed' } });
        // No DLMM Pro pool at the address (the page reads it as another of Meteora's pools): it is not asked again.
        if (none) {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', ask);
        }
      }
    };
    const timer = setInterval(() => void ask(), ONE_MS);
    document.addEventListener('visibilitychange', ask);
    void ask();
    return () => {
      stop.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [address, on]);
  return state.address === address ? state.read : { status: 'reading' };
}
