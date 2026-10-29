import { create } from 'zustand';
import { basisOf, type Basis, type HistoryTrade } from './mine.ts';
import { proveWallet, type ProofOutcome } from './proof.ts';

/**
 * The «Mine» panel's own state: open or not, and what the engine says the held coins cost. The cost comes from the
 * wallet's trade history (`/api/growth/cards`, the same read the trade cards are made from), which is the person's to
 * show: it is read behind the wallet's proof, and the panel never asks the wallet for one by itself — a tap on «See
 * since you bought» does, with one signed message and no transaction. Until then each coin says its 24-hour move.
 */

/** The engine is asked about this many coins at most, the most valuable first. */
export const MAX_BASIS_COINS = 12;
/** What the history said stays good this long; opening the panel later reads it again. */
const BASIS_TTL_MS = 120_000;

export type BasisStatus =
  /** Not asked yet. */
  | 'none'
  | 'reading'
  /** The wallet has not proved itself to Ryntra in this browser: the history is not readable yet. */
  | 'proof'
  | 'proving'
  | 'ready'
  | 'failed';

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type MineEnv = Readonly<{
  fetch: (url: string) => Promise<Answer>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<ProofOutcome>;
  now: () => number;
}>;

let env: MineEnv = {
  fetch: (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }),
  prove: proveWallet,
  now: () => Date.now(),
};

/** Swap what the panel reaches: for tests, and nothing else. */
export function setMineEnv(next: Partial<MineEnv>): void {
  env = { ...env, ...next };
}

/** One coin of the wallet, as the panel asks about it. */
export type Held = Readonly<{ mint: string; balanceRaw: string }>;

/** The panel's two lists: the coins, and — behind the spot switch — the orders. */
export type MineTab = 'coins' | 'orders';

type MineStore = {
  open: boolean;
  tab: MineTab;
  owner: string | null;
  status: BasisStatus;
  /** What each asked coin's holding cost; null when the engine cannot say for the whole of it. */
  bases: ReadonlyMap<string, Basis | null>;
  /** When the history was read. */
  at: number | null;
  /** The balances the bases were read against: a trade since then asks again. */
  against: string;
  message: string | null;
  toggle: () => void;
  close: () => void;
  setTab: (tab: MineTab) => void;
  /** Open on «My orders», from the trade card. */
  openOrders: () => void;
  /** Read what the held coins cost, if the wallet's proof is already here. Never opens the wallet. */
  readBases: (owner: string, held: readonly Held[], force?: boolean) => Promise<void>;
  /** The one tap that proves the wallet, then reads. */
  prove: (connection: Readonly<{ wallet: string; address: string }>, held: readonly Held[]) => Promise<void>;
  reset: () => void;
};

let ticket = 0;

const keyOf = (held: readonly Held[]) => held.map((coin) => `${coin.mint}:${coin.balanceRaw}`).join(',');

type Read = Readonly<{ kind: 'basis'; basis: Basis | null } | { kind: 'proof' } | { kind: 'failed' }>;

async function readOne(owner: string, coin: Held): Promise<Read> {
  let answer: Answer;
  try {
    answer = await env.fetch(`/api/growth/cards?${new URLSearchParams({ address: owner, mint: coin.mint })}`);
  } catch {
    return { kind: 'failed' };
  }
  if (answer.status === 401) return { kind: 'proof' };
  if (!answer.ok) return { kind: 'failed' };
  let body: { trades?: unknown; complete?: unknown };
  try {
    body = ((await answer.json()) ?? {}) as typeof body;
  } catch {
    return { kind: 'failed' };
  }
  if (!Array.isArray(body.trades)) return { kind: 'failed' };
  return { kind: 'basis', basis: basisOf(body.trades as HistoryTrade[], coin.mint, coin.balanceRaw, body.complete === true) };
}

export const useMine = create<MineStore>((set, get) => ({
  open: false,
  tab: 'coins',
  owner: null,
  status: 'none',
  bases: new Map(),
  at: null,
  against: '',
  message: null,

  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
  openOrders: () => set({ open: true, tab: 'orders' }),

  readBases: async (owner, held, force = false) => {
    const state = get();
    const coins = held.slice(0, MAX_BASIS_COINS);
    const against = keyOf(coins);
    if (!coins.length) {
      set({ owner, status: 'ready', bases: new Map(), at: env.now(), against, message: null });
      return;
    }
    const fresh = state.owner === owner && state.against === against && state.at !== null && env.now() - state.at < BASIS_TTL_MS;
    if (!force && (state.status === 'reading' || state.status === 'proving' || (fresh && state.status === 'ready'))) return;
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, ...(state.owner === owner ? {} : { bases: new Map(), at: null }) });
    const bases = new Map<string, Basis | null>();
    let failed = 0;
    // The first answer says whether the history is readable at all; the rest follow two at a time.
    const first = await readOne(owner, coins[0]!);
    if (my !== ticket) return;
    if (first.kind === 'proof') {
      set({ status: 'proof', bases: new Map(), at: null, against });
      return;
    }
    if (first.kind === 'basis') bases.set(coins[0]!.mint, first.basis);
    else failed += 1;
    for (let i = 1; i < coins.length; i += 2) {
      const pair = coins.slice(i, i + 2);
      const reads = await Promise.all(pair.map((coin) => readOne(owner, coin)));
      if (my !== ticket) return;
      reads.forEach((read, k) => {
        if (read.kind === 'basis') bases.set(pair[k]!.mint, read.basis);
        else failed += 1;
      });
    }
    if (failed === coins.length) {
      set({ status: 'failed', bases: new Map(), at: null, against, message: 'Your trade history is unavailable right now.' });
      return;
    }
    set({ status: 'ready', bases, at: env.now(), against, message: null });
  },

  prove: async (connection, held) => {
    if (get().status === 'proving') return;
    set({ status: 'proving', message: null });
    const proof = await env.prove(connection);
    if (!proof.ok) {
      set({ status: 'proof', message: proof.state === 'declined' ? null : proof.message });
      return;
    }
    await get().readBases(connection.address, held, true);
  },

  reset: () => {
    ticket += 1;
    set({ owner: null, status: 'none', bases: new Map(), at: null, against: '', message: null });
  },
}));
