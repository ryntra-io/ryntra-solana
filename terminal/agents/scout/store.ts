'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import type { ScoutCheck } from '@/lib/scout/journal';
import type { ScoutChecks, ScoutView } from '@/lib/scout/view';
import { DEFAULT_BUDGET, type PaperBudget } from './view';

/**
 * The Scout in the browser: its view (`GET /api/v1/scout`), read now and every `VIEW_REFRESH_MS` while the page is in
 * view; the checks the market's «New» column asks for, gathered from every card into one read and read again every
 * `CHECKS_REFRESH_MS`; and the person's own paper budget, kept on the device. A failed read keeps what was on screen.
 */

export const VIEW_REFRESH_MS = 30_000;
export const CHECKS_REFRESH_MS = 60_000;
export const SCOUT_ROUTE = '/api/v1/scout';
export const BUDGET_KEY = 'ryntra.scout.paper.v1';

type ViewState = Readonly<{ status: 'reading' | 'ready' | 'failed'; view: ScoutView | null }>;

type ScoutState = {
  view: ViewState;
  /** Whether the Scout runs on this deployment, as the checks' read says; null — not read yet. */
  on: boolean | null;
  checks: Readonly<Record<string, ScoutCheck>>;
  budget: PaperBudget;
  /** The person started the Scout on paper on this device. */
  started: boolean;
};

export const useScout = create<ScoutState>(() => ({ view: { status: 'reading', view: null }, on: null, checks: {}, budget: DEFAULT_BUDGET, started: false }));

/* ------------------------------------------------------------ the view */

let viewFlying = false;

export async function readView(): Promise<void> {
  if (viewFlying) return;
  viewFlying = true;
  const had = useScout.getState().view;
  try {
    const res = await fetch(SCOUT_ROUTE, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const view = (await res.json()) as ScoutView;
    if (!view || !Array.isArray(view.open) || !Array.isArray(view.closed)) throw new Error('shape');
    useScout.setState({ view: { status: 'ready', view } });
  } catch {
    useScout.setState({ view: had.view ? { ...had, status: 'ready' } : { status: 'failed', view: null } });
  } finally {
    viewFlying = false;
  }
}

/** Keeps the view read while the page is visible. */
export function useScoutView(): void {
  useEffect(() => {
    void readView();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void readView();
    }, VIEW_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
}

/* ------------------------------------------------------------ the checks of «New» */

const wanted = new Map<string, number>();
let batch: number | null = null;
let checksTimer: number | null = null;

async function readChecks(): Promise<void> {
  batch = null;
  const mints = [...wanted.keys()].slice(0, 60);
  if (!mints.length) return;
  try {
    const res = await fetch(`${SCOUT_ROUTE}?part=checks&mints=${encodeURIComponent(mints.join(','))}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = (await res.json()) as ScoutChecks;
    if (!body || typeof body.checks !== 'object') return;
    useScout.setState((st) => ({ on: body.on === true, checks: { ...st.checks, ...body.checks } }));
  } catch {
    // A failed read keeps the lines on screen.
  }
}

/** A card of «New» asks for its coin's check: gathered with the other cards' into one read. */
export function useScoutCheck(mint: string): ScoutCheck | null {
  useEffect(() => {
    wanted.set(mint, (wanted.get(mint) ?? 0) + 1);
    if (batch === null) batch = window.setTimeout(() => void readChecks(), 400);
    if (checksTimer === null) {
      checksTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void readChecks();
      }, CHECKS_REFRESH_MS);
    }
    return () => {
      const left = (wanted.get(mint) ?? 1) - 1;
      if (left > 0) wanted.set(mint, left);
      else wanted.delete(mint);
      if (wanted.size === 0 && checksTimer !== null) {
        window.clearInterval(checksTimer);
        checksTimer = null;
      }
    };
  }, [mint]);
  return useScout((st) => st.checks[mint] ?? null);
}

/* ------------------------------------------------------------ the person's paper budget */

let budgetRead = false;

/** The budget the device keeps, read once after the first paint (the server knows none). */
export function startBudget(): void {
  if (budgetRead) return;
  budgetRead = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(BUDGET_KEY) ?? 'null') as { perDay?: unknown; perTrade?: unknown; started?: unknown } | null;
    if (!raw || typeof raw !== 'object') return;
    const lamports = (value: unknown) => (typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) > 0n ? BigInt(value) : null);
    const perDay = lamports(raw.perDay);
    const perTrade = lamports(raw.perTrade);
    if (perDay && perTrade) useScout.setState({ budget: { perDayLamports: perDay, perTradeLamports: perTrade }, started: raw.started === true });
  } catch {
    // Storage blocked or a value that is not ours: the reference budget stands.
  }
}

/** The person's numbers, kept on the device; `started` — the Scout works on paper for them. */
export function setBudget(budget: PaperBudget, started: boolean): void {
  useScout.setState({ budget, started });
  try {
    window.localStorage.setItem(BUDGET_KEY, JSON.stringify({ perDay: budget.perDayLamports.toString(), perTrade: budget.perTradeLamports.toString(), started }));
  } catch {
    // Storage blocked: the numbers hold for this visit.
  }
}
