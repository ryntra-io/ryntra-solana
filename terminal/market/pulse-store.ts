'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { PulseRow } from '@/lib/spot/pulse';
import { COLUMN_FILTER_NONE, PULSE_COLUMNS, readColumnFilter, ryntraMints, type ColumnFilter, type PulseColumn } from './pulse-view';

/**
 * The Pulse in the browser: the engine's three feeds — `/api/spot/pulse?feed=new|soon|dex&mode=meme` — read
 * now and again every `PULSE_REFRESH_MS` while the page is in view. A failed read keeps what was on screen and says so
 * (`missed`): «live» stands only while a feed really answers, and a feed that never answered is a failure, not a quiet
 * market. The mints of Ryntra's own launches the feeds name stay for «Launched on: Ryntra» in the
 * table's filters.
 */

export const PULSE_REFRESH_MS = 15_000;

/**
 * One feed as the screen holds it: `at` — when it last answered; `missed` — its last read did not answer (the rows kept on
 * screen are from before). `failed` — it has not answered once since the page opened.
 */
export type PulseFeed = Readonly<{ status: 'reading' | 'ready' | 'failed'; rows: readonly PulseRow[]; at: number; missed: boolean }>;

type PulseState = { feeds: Readonly<Record<PulseColumn, PulseFeed>>; ryntra: readonly string[]; filters: Readonly<Record<PulseColumn, ColumnFilter>> };

const EMPTY: PulseFeed = { status: 'reading', rows: [], at: 0, missed: false };

const NO_FILTERS: Readonly<Record<PulseColumn, ColumnFilter>> = { new: COLUMN_FILTER_NONE, soon: COLUMN_FILTER_NONE, dex: COLUMN_FILTER_NONE };

export const usePulse = create<PulseState>(() => ({ feeds: { new: EMPTY, soon: EMPTY, dex: EMPTY }, ryntra: [], filters: NO_FILTERS }));

/** Each column's own filter, kept on the device: the person sets it once. */
export const PULSE_FILTERS_KEY = 'ryntra.terminal.pulse.filters';

let filtersRead = false;

/** The columns' filters as the device keeps them, read once after the first paint (the server knows none). */
export function startPulseFilters(): void {
  if (filtersRead) return;
  filtersRead = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PULSE_FILTERS_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return;
    usePulse.setState({ filters: { new: readColumnFilter(raw.new), soon: readColumnFilter(raw.soon), dex: readColumnFilter(raw.dex) } });
  } catch {
    // Storage blocked or a value that is not ours: the columns stand unfiltered.
  }
}

/** A column's filter, set now and kept on the device. */
export function setColumnFilter(column: PulseColumn, filter: ColumnFilter): void {
  const filters = { ...usePulse.getState().filters, [column]: filter };
  usePulse.setState({ filters });
  try {
    window.localStorage.setItem(PULSE_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Storage blocked: the filter holds for this visit.
  }
}

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
      const feeds = { ...st.feeds, [column]: { status: 'ready', rows, at: Date.now(), missed: false } as PulseFeed };
      const mints = ryntraMints(PULSE_COLUMNS.flatMap((id) => feeds[id].rows));
      // The same mints keep the same list: the table does not filter again for nothing.
      const same = mints.length === st.ryntra.length && mints.every((mint, i) => mint === st.ryntra[i]);
      return { feeds, ryntra: same ? st.ryntra : mints };
    });
  } catch {
    // The rows already on screen stay, marked as missed; a feed that never answered says it failed — never «nothing here».
    usePulse.setState((st) => ({ feeds: { ...st.feeds, [column]: had.status === 'ready' ? { ...had, missed: true } : { status: 'failed', rows: [], at: 0, missed: true } } }));
  } finally {
    flying.delete(column);
  }
}

/** «Try again»: the feeds that did not answer are read now. */
export function readPulseAgain(): void {
  const { feeds } = usePulse.getState();
  for (const column of PULSE_COLUMNS) {
    if (feeds[column].status !== 'failed' && !feeds[column].missed) continue;
    // A feed that never answered shows its bones again while it is read: the press is seen.
    if (feeds[column].status === 'failed') usePulse.setState((st) => ({ feeds: { ...st.feeds, [column]: { ...st.feeds[column], status: 'reading' } } }));
    void read(column);
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
