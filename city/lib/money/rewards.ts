import { create } from 'zustand';
import { scoutsOf, type ScoutsView } from '../scouts/view.ts';
import { proveWallet, type ProofOutcome } from '../trade/proof.ts';

/**
 * The portfolio's «Rewards» block (CITY-206): points, level and rank, what friends brought, cashback, and the
 * assistant's credits — read from the Growth line's own engine (`/api/rewards`) and the credits engine
 * (`/api/v1/assistant/credits`), never written here. Both answer only for a wallet that proved itself to Ryntra: how
 * much somebody earned is not public. So the block never opens the wallet by itself — it reads when the proof is
 * already in the browser, and one tap signs one message (no transaction) when it is not.
 */

export type PointsFigures = Readonly<{ points: string; level: number; rank: number | null; ranked: number }>;
export type CreditFigures = Readonly<{ balance: number; freeLeft: number }>;

export type RewardsView = Readonly<{
  points: PointsFigures | null;
  scouts: ScoutsView | null;
  credits: CreditFigures | null;
}>;

export type RewardsStatus = 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed';

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type RewardsEnv = Readonly<{
  fetch: (url: string) => Promise<Answer>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<ProofOutcome>;
  now: () => number;
}>;

let env: RewardsEnv = {
  fetch: (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }),
  prove: proveWallet,
  now: () => Date.now(),
};

/** Swap what the block reaches: for tests, and nothing else. */
export function setRewardsEnv(next: Partial<RewardsEnv>): void {
  env = { ...env, ...next };
}

const TTL_MS = 60_000;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The Points figures of a `/api/rewards` answer; null when the ledger was not read — unavailable, never zero. */
export function pointsOf(body: unknown): PointsFigures | null {
  const points = record(record(body).points);
  if (typeof points.points !== 'string' || typeof points.level !== 'number') return null;
  return {
    points: points.points,
    level: points.level,
    rank: typeof points.rank === 'number' ? points.rank : null,
    ranked: typeof points.ranked === 'number' ? points.ranked : 0,
  };
}

/** The credits that can be spent now: the balance, and the day's free ones left. */
export function creditsOf(body: unknown): CreditFigures | null {
  const answer = record(body);
  const free = record(answer.free);
  if (typeof answer.balance !== 'number' || typeof free.left !== 'number') return null;
  return { balance: answer.balance, freeLeft: free.left };
}

type Store = {
  owner: string | null;
  status: RewardsStatus;
  view: RewardsView | null;
  at: number | null;
  message: string | null;
  read: (owner: string, force?: boolean) => Promise<void>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<void>;
  reset: () => void;
};

let ticket = 0;

export const useRewards = create<Store>((set, get) => ({
  owner: null,
  status: 'none',
  view: null,
  at: null,
  message: null,

  read: async (owner, force = false) => {
    const state = get();
    if (state.owner === owner && !force) {
      if (state.status === 'reading' || state.status === 'proving') return;
      if (state.status === 'ready' && state.at !== null && env.now() - state.at < TTL_MS) return;
    }
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, ...(state.owner === owner ? {} : { view: null, at: null }) });
    let rewards: Answer;
    let credits: Answer | null;
    try {
      [rewards, credits] = await Promise.all([
        env.fetch(`/api/rewards?${new URLSearchParams({ address: owner, locale: 'en' })}`),
        env.fetch('/api/v1/assistant/credits').catch(() => null),
      ]);
    } catch {
      if (my === ticket) set({ status: 'failed' });
      return;
    }
    if (my !== ticket) return;
    if (rewards.status === 401) {
      set({ status: 'proof', view: null, at: null });
      return;
    }
    let body: unknown = null;
    let creditsBody: unknown = null;
    try {
      body = rewards.ok ? await rewards.json() : null;
    } catch {
      body = null;
    }
    try {
      creditsBody = credits && credits.ok ? await credits.json() : null;
    } catch {
      creditsBody = null;
    }
    if (my !== ticket) return;
    if (!body) {
      set({ status: 'failed' });
      return;
    }
    set({ status: 'ready', view: { points: pointsOf(body), scouts: scoutsOf(body), credits: creditsOf(creditsBody) }, at: env.now() });
  },

  prove: async (connection) => {
    if (get().status === 'proving') return;
    const my = ++ticket;
    set({ owner: connection.address, status: 'proving', message: null });
    const proof = await env.prove(connection);
    if (my !== ticket) return;
    if (!proof.ok) {
      set({ status: 'proof', message: proof.state === 'declined' ? null : proof.message });
      return;
    }
    await get().read(connection.address, true);
  },

  reset: () => {
    ticket += 1;
    set({ owner: null, status: 'none', view: null, at: null, message: null });
  },
}));
