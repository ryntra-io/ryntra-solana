import { create } from 'zustand';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { proveWallet, type ProofOutcome } from '../../city/lib/trade/proof.ts';
import { rewardsOf, type RewardsRead, type RewardsStatus } from './view.ts';

/**
 * «Rewards»' one read: what the Growth line's engine says about this wallet (`/api/rewards`). The engine answers only
 * for a wallet that proved itself to Ryntra — how much somebody earned is not public — so the screen never opens the
 * wallet by itself: it reads when the proof is already in the browser (the header's sign-in leaves one), and one tap
 * signs one message, no transaction, when it is not. Nothing here writes, binds or pays.
 */

/** What the engine said stays good this long; coming back later reads it again. */
const TTL_MS = 60_000;

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

/** Swap what the screen reaches: for tests, and nothing else. */
export function setRewardsEnv(next: Partial<RewardsEnv>): void {
  env = { ...env, ...next };
}

type Store = {
  owner: string | null;
  status: RewardsStatus;
  view: RewardsRead | null;
  at: number | null;
  /** Why the last signature did not go, in the wallet's words; null for a person's own «no». */
  message: string | null;
  /** Read the wallet's rewards, if its proof is already here. Never opens the wallet. */
  read: (owner: string, lang: Lang, force?: boolean) => Promise<void>;
  /** The one tap that proves the wallet, then reads. */
  prove: (connection: Readonly<{ wallet: string; address: string }>, lang: Lang) => Promise<void>;
  /** Another wallet, or none: the last one's figures go. */
  reset: () => void;
};

let ticket = 0;

export const useRewardsRead = create<Store>((set, get) => ({
  owner: null,
  status: 'none',
  view: null,
  at: null,
  message: null,

  read: async (owner, lang, force = false) => {
    const state = get();
    if (state.owner === owner && !force) {
      if (state.status === 'reading' || state.status === 'proving') return;
      if (state.status === 'ready' && state.at !== null && env.now() - state.at < TTL_MS) return;
    }
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, ...(state.owner === owner ? {} : { view: null, at: null }) });
    let answer: Answer;
    try {
      answer = await env.fetch(`/api/rewards?${new URLSearchParams({ address: owner, locale: lang })}`);
    } catch {
      if (my === ticket) set({ status: 'failed' });
      return;
    }
    if (my !== ticket) return;
    if (answer.status === 401) {
      set({ status: 'proof', view: null, at: null });
      return;
    }
    let view: RewardsRead | null = null;
    if (answer.ok) {
      try {
        view = rewardsOf(await answer.json());
      } catch {
        view = null;
      }
    }
    if (my !== ticket) return;
    // A failed read keeps what was shown: the figures do not vanish on a hiccup.
    if (!view) set({ status: 'failed' });
    else set({ status: 'ready', view, at: env.now() });
  },

  prove: async (connection, lang) => {
    if (get().status === 'proving') return;
    const my = ++ticket;
    set({ owner: connection.address, status: 'proving', message: null });
    const proof = await env.prove(connection);
    // Another wallet (or none) came while this one was signing: its answer is not this screen's any more.
    if (my !== ticket) return;
    if (!proof.ok) {
      set({ status: 'proof', message: proof.state === 'declined' ? null : proof.message });
      return;
    }
    await get().read(connection.address, lang, true);
  },

  reset: () => {
    ticket += 1;
    set({ owner: null, status: 'none', view: null, at: null, message: null });
  },
}));
