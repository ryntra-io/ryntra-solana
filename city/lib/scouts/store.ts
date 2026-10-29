import { create } from 'zustand';
import { proveWallet, type ProofOutcome } from '../trade/proof.ts';
import { scoutsOf, type ScoutsView } from './view.ts';

/**
 * The «Scouts» window's own state: open or not, and what the Growth engine says about the wallet's link, friends and
 * shares. The engine answers only for a wallet that has proved itself to Ryntra (`/api/rewards`: how much somebody
 * earned is not public), so the window never asks the wallet by itself — opening it reads when the proof is already
 * here, and one tap on «Sign in» signs one message, no transaction. Nothing here pays: payouts open with the Growth
 * line's release (Ріст 20), not in the city.
 */

/** What the engine said stays good this long; opening the window later reads it again. */
const TTL_MS = 60_000;

export type ScoutsStatus = 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed';

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type ScoutsEnv = Readonly<{
  fetch: (url: string) => Promise<Answer>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<ProofOutcome>;
  now: () => number;
}>;

let env: ScoutsEnv = {
  fetch: (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }),
  prove: proveWallet,
  now: () => Date.now(),
};

/** Swap what the window reaches: for tests, and nothing else. */
export function setScoutsEnv(next: Partial<ScoutsEnv>): void {
  env = { ...env, ...next };
}

type Scouts = {
  open: boolean;
  owner: string | null;
  status: ScoutsStatus;
  view: ScoutsView | null;
  at: number | null;
  message: string | null;
  show: () => void;
  close: () => void;
  /** Read the wallet's scouts, if its proof is already here. Never opens the wallet. */
  read: (owner: string, force?: boolean) => Promise<void>;
  /** The one tap that proves the wallet, then reads. */
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<void>;
  /** Another wallet, or none: the last one's figures and flags go. */
  reset: () => void;
};

let ticket = 0;

export const useScouts = create<Scouts>((set, get) => ({
  open: false,
  owner: null,
  status: 'none',
  view: null,
  at: null,
  message: null,

  show: () => set({ open: true }),
  close: () => set({ open: false }),

  read: async (owner, force = false) => {
    const state = get();
    if (state.owner === owner && !force) {
      if (state.status === 'reading' || state.status === 'proving') return;
      if (state.status === 'ready' && state.at !== null && env.now() - state.at < TTL_MS) return;
    }
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, ...(state.owner === owner ? {} : { view: null, at: null }) });
    let answer: Answer;
    try {
      answer = await env.fetch(`/api/rewards?${new URLSearchParams({ address: owner, locale: 'en' })}`);
    } catch {
      if (my === ticket) set({ status: 'failed' });
      return;
    }
    if (my !== ticket) return;
    if (answer.status === 401) {
      set({ status: 'proof', view: null, at: null });
      return;
    }
    let view: ScoutsView | null = null;
    if (answer.ok) {
      try {
        view = scoutsOf(await answer.json());
      } catch {
        view = null;
      }
    }
    if (my !== ticket) return;
    // A failed read keeps what was shown, marked as not fresh: the figures do not vanish on a hiccup.
    if (!view) set({ status: 'failed' });
    else set({ status: 'ready', view, at: env.now() });
  },

  prove: async (connection) => {
    if (get().status === 'proving') return;
    const my = ++ticket;
    set({ owner: connection.address, status: 'proving', message: null });
    const proof = await env.prove(connection);
    // Another wallet (or none) came while this one was signing: its answer is not this window's any more.
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

/** Open «Scouts» from anywhere: the menu, «Mine». */
export function openScouts(): void {
  useScouts.getState().show();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __scouts: useScouts });
