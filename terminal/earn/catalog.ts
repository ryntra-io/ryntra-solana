import { create } from 'zustand';
import type { EarnPoolsAnswer } from '../../lib/earn-pools/model.ts';

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
