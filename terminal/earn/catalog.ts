import { create } from 'zustand';
import type { EarnPoolPeriods, EarnPoolsAnswer } from '../../lib/earn-pools/model.ts';

/**
 * The chooser's read: `GET /api/v1/earn/pools` (the engine's catalogue of Meteora pools and Jupiter Lend's
 * rates). One read at a time; a fresh answer is not asked again within a minute; a failed read keeps the last answer on
 * screen and is said as failed only when there was none.
 */

export type CatalogRead = Readonly<{ status: 'idle' | 'reading' | 'ready' | 'failed'; value: EarnPoolsAnswer | null; at: number }>;

type CatalogState = CatalogRead & { load: (force?: boolean) => Promise<void> };

const FRESH_MS = 60_000;
const READ_MS = 15_000;
let inflight: Promise<void> | null = null;

function answerOf(body: unknown): EarnPoolsAnswer | null {
  if (typeof body !== 'object' || body === null) return null;
  const node = body as Partial<EarnPoolsAnswer>;
  if (!Array.isArray(node.pools) || !Array.isArray(node.lend) || typeof node.sources !== 'object' || node.sources === null) return null;
  return node as EarnPoolsAnswer;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  status: 'idle',
  value: null,
  at: 0,
  load: async (force = false) => {
    const now = Date.now();
    if (!force && get().status === 'ready' && now - get().at < FRESH_MS) return;
    if (inflight) return inflight;
    if (!get().value) set({ status: 'reading' });
    inflight = (async () => {
      const body = await fetch('/api/v1/earn/pools', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_MS) })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const value = answerOf(body);
      if (value) set({ status: 'ready', value, at: Date.now() });
      else set({ status: get().value ? 'ready' : 'failed' });
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
}));

/**
 * The pools by window (`GET /api/earn/pools/periods`): read only once a person picks a window other than the
 * day, then kept a minute like the pools. A failed read leaves the shorter windows empty — the day stays as it was.
 */
export type PeriodsRead = Readonly<{ status: 'idle' | 'reading' | 'ready' | 'failed'; value: ReadonlyMap<string, EarnPoolPeriods['periods']>; at: number }>;

type PeriodsState = PeriodsRead & { load: () => Promise<void> };

let periodsInflight: Promise<void> | null = null;

/** The answer as a map by pool; null when the body is not that shape. */
export function periodsOf(body: unknown): Map<string, EarnPoolPeriods['periods']> | null {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { pools?: unknown }).pools)) return null;
  const out = new Map<string, EarnPoolPeriods['periods']>();
  for (const entry of (body as { pools: unknown[] }).pools) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { address, periods } = entry as Partial<EarnPoolPeriods>;
    if (typeof address === 'string' && typeof periods === 'object' && periods !== null) out.set(address, periods);
  }
  return out;
}

export const usePeriods = create<PeriodsState>((set, get) => ({
  status: 'idle',
  value: new Map(),
  at: 0,
  load: async () => {
    if (get().status === 'ready' && Date.now() - get().at < FRESH_MS) return;
    if (periodsInflight) return periodsInflight;
    if (!get().value.size) set({ status: 'reading' });
    periodsInflight = (async () => {
      const body = await fetch('/api/earn/pools/periods', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_MS) })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const value = periodsOf(body);
      if (value) set({ status: 'ready', value, at: Date.now() });
      else set({ status: get().value.size ? 'ready' : 'failed' });
    })().finally(() => {
      periodsInflight = null;
    });
    return periodsInflight;
  },
}));
