'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One part of the coin's creator read (`/api/spot/creator?part=…`): the creator's tab or the holders'
 * links. Read when the tab is shown, again every few minutes while the page is in view — the engine keeps each answer
 * for minutes, so a second read costs the chain nothing. A read that fails keeps what is on screen; one that never came
 * is said as failed, never drawn as an empty list. `none` — the engine says the coin has none (no creator named).
 */

export type PartStatus = 'reading' | 'ready' | 'failed' | 'none';
export type PartRead<T> = Readonly<{ status: PartStatus; value: T | null; again: () => void }>;

const EVERY_MS = 5 * 60_000;

type State<T> = Readonly<{ key: string; status: PartStatus; value: T | null }>;

export function useCreatorPart<T>(mint: string, part: 'creator' | 'links', on: boolean, take: (body: unknown) => T | null): PartRead<T> {
  const key = `${part}:${mint}`;
  const [state, setState] = useState<State<T>>({ key, status: 'reading', value: null });
  const [turn, setTurn] = useState(0);
  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    if (!on) return;
    const stop = new AbortController();
    setState((was) => (was.key === key ? was : { key, status: 'reading', value: null }));
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      let status: PartStatus = 'failed';
      let value: T | null = null;
      try {
        const response = await fetch(`/api/spot/creator?${new URLSearchParams({ mint, part })}`, { headers: { accept: 'application/json' }, signal: stop.signal });
        const body = (await response.json().catch(() => null)) as unknown;
        if (response.ok && body && typeof body === 'object') {
          if ('none' in body) status = 'none';
          else {
            value = takeRef.current(body);
            status = value === null ? 'failed' : 'ready';
          }
        }
      } catch {
        if (stop.signal.aborted) return;
      }
      if (stop.signal.aborted) return;
      setState((was) => {
        // A read that failed keeps what is on screen.
        if (status === 'failed' && was.key === key && was.value !== null) return was;
        return { key, status, value };
      });
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    return () => {
      stop.abort();
      clearInterval(timer);
    };
  }, [key, mint, part, on, turn]);

  const again = useCallback(() => {
    setState({ key, status: 'reading', value: null });
    setTurn((n) => n + 1);
  }, [key]);
  const shown = state.key === key ? state : { key, status: 'reading' as const, value: null };
  return { status: shown.status, value: shown.value, again };
}
