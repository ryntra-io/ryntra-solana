'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { PulseRow } from '@/lib/spot/pulse';
import { PULSE_COLUMNS, ryntraMints, type PulseColumn } from './pulse-view';

/**
 * The Pulse in the browser: the engine's three feeds — `/api/spot/pulse?feed=new|soon|dex&mode=meme` — read
 * now and again every `PULSE_REFRESH_MS` while the page is in view. A failed read keeps what was on screen. The mints
 * of Ryntra's own launches the feeds name stay for «Launched on: Ryntra» in the table's filters.
 */

export const PULSE_REFRESH_MS = 15_000;

export type PulseFeed = Readonly<{ status: 'reading' | 'ready' | 'failed'; rows: readonly PulseRow[]; at: number }>;

type PulseState = { feeds: Readonly<Record<PulseColumn, PulseFeed>>; ryntra: readonly string[] };

const EMPTY: PulseFeed = { status: 'reading', rows: [], at: 0 };

export const usePulse = create<PulseState>(() => ({ feeds: { new: EMPTY, soon: EMPTY, dex: EMPTY }, ryntra: [] }));

const flying = new Set<PulseColumn>();

async function read(column: PulseColumn): Promise<void> {
  if (flying.has(column)) return;
  flying.add(column);
  const had = usePulse.getState().feeds[column];
  try {
    const res = await fetch(`/api/spot/pulse?feed=${column}&mode=meme`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rows?: unknown };
    const rows = Array.isArray(body.rows) ? (body.rows as PulseRow[]) : [];
    usePulse.setState((st) => {
      const feeds = { ...st.feeds, [column]: { status: 'ready', rows, at: Date.now() } as PulseFeed };
      const mints = ryntraMints(PULSE_COLUMNS.flatMap((id) => feeds[id].rows));
      // The same mints keep the same list: the table does not filter again for nothing.
      const same = mints.length === st.ryntra.length && mints.every((mint, i) => mint === st.ryntra[i]);
      return { feeds, ryntra: same ? st.ryntra : mints };
    });
  } catch {
    usePulse.setState((st) => ({ feeds: { ...st.feeds, [column]: had.rows.length ? { ...had, status: 'ready' } : { status: 'failed', rows: [], at: Date.now() } } }));
  } finally {
    flying.delete(column);
  }
}

/** Keeps the three feeds read: now, then every `PULSE_REFRESH_MS` while the page is visible. */
export function usePulseRead(): void {
  useEffect(() => {
    const all = () => {
      for (const column of PULSE_COLUMNS) void read(column);
    };
    const fresh = PULSE_COLUMNS.every((column) => Date.now() - usePulse.getState().feeds[column].at < PULSE_REFRESH_MS / 2);
    if (!fresh) all();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') all();
    }, PULSE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
}
