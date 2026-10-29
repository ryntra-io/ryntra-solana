import { create } from 'zustand';
import type { LiquidityReview } from '../../../../lib/liquidity/studio/actions.ts';
import { citySigner } from '../../app-bridge/route.ts';
import { addBody, claimBody, depositTiles, exitBody, startTile, type ReviewBody } from './deposit.ts';
import { createHarborEngine, type ActionStates, type HarborEngine } from './engine.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany } from './flow.ts';
import type { HarborPool } from './pools.ts';
import { harborPositions, type HarborPosition } from './positions.ts';
import { failureWords } from './review.ts';
import type { Holdings } from '../../trade/wallet.ts';

/**
 * The Harbor's state: the pools list, the one pool whose card is open with its amount, the engine's Review of that
 * amount, the wallet's positions, and where an action is. A Review is built as soon as a wallet is here and the engine
 * admits it, so every figure the person signs is on the card before the one amber tap; a tap on a Review too old to
 * sign builds it again and shows it first.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

export type View = 'pools' | 'add' | 'mine';

export type Phase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const BUSY: ReadonlySet<Phase> = new Set(['reviewing', 'wallet', 'sending']);
/**
 * What holds the sheet in place: only a signature in the wallet or bytes on their way. A Review being built is a read,
 * so Close, Back, the tabs and Escape still work; the ticket drops its late answer.
 */
export const LOCKED: ReadonlySet<Phase> = new Set(['wallet', 'sending']);

/** The wallet's coins, only when they were read for the wallet connected now: another wallet's balances are never used. */
export function ownHoldings(connection: Readonly<{ address: string }> | null, holdings: Holdings | null): Holdings | null {
  return connection && holdings?.owner === connection.address ? holdings : null;
}

/** The Review on the card, built for one exact choice. */
export type Reviewed = Readonly<{ key: string; body: ReviewBody; review: LiquidityReview; at: number }>;

export type ListState =
  | Readonly<{ status: 'idle' | 'loading' }>
  | Readonly<{ status: 'ready'; pools: readonly HarborPool[]; at: string | null }>
  | Readonly<{ status: 'error'; message: string }>;

export type PositionsState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; owner: string }>
  | Readonly<{ status: 'ready'; owner: string; positions: readonly HarborPosition[]; at: number }>
  | Readonly<{ status: 'error'; owner: string; message: string }>;

/** What an action is on: the add card, or one position's claim or exit. */
export type Target = Readonly<{ kind: 'add' }> | Readonly<{ kind: 'claim' | 'exit'; position: HarborPosition }>;

/** One line under the figures: a fresh Review to read again, or why nothing happened. */
export type Notice = Readonly<{ tone: 'warn' | 'error'; text: string }>;

export type HarborEnv = Readonly<{
  engine: HarborEngine;
  sign: (connection: Connection) => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** After an action: the wallet's coins are read again, for an RPC that lags. */
  refreshHoldings: (delaysMs?: readonly number[]) => void;
}>;

const browserEnv = (): HarborEnv => ({
  engine: createHarborEngine(),
  sign: (connection) => async (unsigned) => {
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: 'solana:mainnet' });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  refreshHoldings: () => {},
});

let env: HarborEnv | null = null;
const harborEnv = (): HarborEnv => (env ??= browserEnv());

/** Tests and the layer put their own reach here. */
export function setHarborEnv(next: Partial<HarborEnv>): void {
  env = { ...harborEnv(), ...next };
}

type Store = {
  open: boolean;
  view: View;
  list: ListState;
  pool: HarborPool | null;
  tile: number;
  states: Readonly<{ owner: string; value: ActionStates }> | null;
  reviewed: Reviewed | null;
  target: Target | null;
  phase: Phase;
  outcome: ActionOutcome | null;
  /** The Review the last outcome came from, so the card can say what moved. */
  sent: Reviewed | null;
  notice: Notice | null;
  positions: PositionsState;
  show: (view?: View) => void;
  hide: () => void;
  setView: (view: View) => void;
  loadPools: () => Promise<void>;
  choose: (pool: HarborPool, holdings: Holdings | null) => void;
  setTile: (index: number) => void;
  loadStates: (owner: string) => Promise<void>;
  loadPositions: (owner: string, fresh?: boolean) => Promise<void>;
  /** Build the Review of the open card's amount, or of one position's claim or exit. */
  prepare: (connection: Connection, target: Target, holdings: Holdings | null) => Promise<void>;
  /** The one amber tap: sign what the Review shows, or build it again when it is too old to sign. */
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  /** Ask the chain again about an action whose outcome it has not said yet. Reading only. */
  recheck: (owner: string) => Promise<void>;
  /** Back to the card after an outcome. */
  again: () => void;
  /** To the wallet's positions, read again: where a partly landed add is seen, never built a second time. */
  seePositions: (owner: string | null) => void;
  forget: () => void;
};

let ticket = 0;

/** The Review's key: the same choice for the same wallet. */
export function keyOf(owner: string, target: Target, pool: HarborPool | null, tile: number): string {
  return target.kind === 'add' ? `add:${owner}:${pool?.address ?? ''}:${tile}` : `${target.kind}:${owner}:${target.position.address}`;
}

function bodyOf(owner: string, target: Target, pool: HarborPool | null, tile: number, holdings: Holdings | null, ceiling: number | null): ReviewBody | null {
  if (target.kind === 'claim') return claimBody(target.position.venue, target.position.address, owner);
  if (target.kind === 'exit') return exitBody(target.position.venue, target.position.address, owner);
  if (!pool) return null;
  const chosen = depositTiles(pool, holdings, ceiling)[tile];
  if (!chosen?.split || !chosen.fits || chosen.overCeiling) return null;
  return addBody(pool, owner, chosen.split);
}

export const useHarbor = create<Store>((set, get) => ({
  open: false,
  view: 'pools',
  list: { status: 'idle' },
  pool: null,
  tile: 0,
  states: null,
  reviewed: null,
  target: null,
  phase: 'idle',
  outcome: null,
  sent: null,
  notice: null,
  positions: { status: 'idle' },
  show: (view = 'pools') => {
    set({ open: true, view, notice: null });
    if (get().list.status !== 'ready' && get().list.status !== 'loading') void get().loadPools();
  },
  hide: () => {
    if (LOCKED.has(get().phase)) return;
    ticket += 1;
    set({ open: false, view: 'pools', pool: null, reviewed: null, target: null, phase: 'idle', outcome: null, notice: null });
  },
  setView: (view) => {
    if (LOCKED.has(get().phase)) return;
    ticket += 1;
    set({ view, reviewed: null, target: null, phase: 'idle', outcome: null, notice: null, ...(view === 'pools' ? { pool: null } : {}) });
  },
  loadPools: async () => {
    set({ list: { status: 'loading' } });
    const answer = await harborEnv().engine.pools();
    if (answer.ok && Array.isArray(answer.value.pools)) set({ list: { status: 'ready', pools: answer.value.pools, at: answer.value.at ?? null } });
    else set({ list: { status: 'error', message: 'The pools did not load. Try again in a moment.' } });
  },
  choose: (pool, holdings) => {
    if (BUSY.has(get().phase)) return;
    ticket += 1;
    const ceiling = get().states?.value.maxDepositUsd ?? null;
    set({ view: 'add', pool, tile: startTile(depositTiles(pool, holdings, ceiling)), reviewed: null, target: { kind: 'add' }, phase: 'idle', outcome: null, notice: null });
  },
  setTile: (index) => {
    if (BUSY.has(get().phase)) return;
    ticket += 1;
    set({ tile: index, reviewed: null, phase: 'idle', notice: null });
  },
  loadStates: async (owner) => {
    const answer = await harborEnv().engine.actions(owner);
    if (answer.ok) set({ states: { owner, value: answer.value } });
  },
  loadPositions: async (owner, fresh) => {
    const before = get().positions;
    // A read of the same wallet keeps the rows on screen while it runs.
    if (!(before.status === 'ready' && before.owner === owner)) set({ positions: { status: 'loading', owner } });
    const answer = await harborEnv().engine.positions(owner, fresh);
    const rows = answer.ok ? harborPositions(answer.value, owner) : null;
    if (rows) set({ positions: { status: 'ready', owner, positions: rows, at: harborEnv().now() } });
    else if (!(before.status === 'ready' && before.owner === owner)) set({ positions: { status: 'error', owner, message: answer.ok ? 'The positions did not read.' : failureWords(answer.failure.code) } });
  },
  prepare: async (connection, target, holdings) => {
    const st = get();
    if (BUSY.has(st.phase)) return;
    const ceiling = st.states?.owner === connection.address ? st.states.value.maxDepositUsd : null;
    const body = bodyOf(connection.address, target, st.pool, st.tile, ownHoldings(connection, holdings), ceiling);
    if (!body) return;
    const key = keyOf(connection.address, target, st.pool, st.tile);
    const mine = ++ticket;
    set({ target, phase: 'reviewing', notice: null, outcome: null, reviewed: st.reviewed?.key === key ? st.reviewed : null });
    const answer = await harborEnv().engine.review(body);
    if (mine !== ticket) return;
    if (!answer.ok) {
      set({ phase: 'idle', reviewed: null, notice: { tone: 'error', text: failureWords(answer.failure.code) } });
      return;
    }
    set({ phase: 'idle', reviewed: { key, body, review: answer.value, at: harborEnv().now() } });
  },
  confirm: async (connection, holdings) => {
    const st = get();
    const target = st.target;
    if (!target || BUSY.has(st.phase)) return;
    const key = keyOf(connection.address, target, st.pool, st.tile);
    const reviewed = st.reviewed?.key === key ? st.reviewed : null;
    const e = harborEnv();
    if (!reviewed || !reviewFresh(reviewed.review, reviewed.at, e.now())) {
      await get().prepare(connection, target, holdings);
      if (get().reviewed) set({ notice: { tone: 'warn', text: 'Fresh figures from the engine. Tap again to sign.' } });
      return;
    }
    const mine = ++ticket;
    set({ phase: 'wallet', notice: null });
    const sign = e.sign(connection);
    const outcome = await signAndSend(reviewed.review, reviewed.at, {
      ...e,
      sign: async (unsigned) => {
        const signed = await sign(unsigned);
        if (signed.ok && mine === ticket) set({ phase: 'sending' });
        return signed;
      },
    });
    if (mine !== ticket) return;
    if (outcome.kind === 'aged') {
      set({ phase: 'idle', reviewed: null });
      await get().prepare(connection, target, holdings);
      if (get().reviewed) set({ notice: { tone: 'warn', text: 'The figures aged while the wallet was open. Nothing was sent. Tap again.' } });
      return;
    }
    if (outcome.kind === 'refused') {
      set({ phase: 'idle', notice: { tone: 'error', text: failureWords(outcome.code) }, ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }) });
      return;
    }
    set({ phase: outcome.kind, outcome, sent: reviewed, reviewed: null });
    if (outcome.kind === 'done' || outcome.kind === 'partial') {
      e.refreshHoldings([2_500, 8_000]);
      void get().loadPositions(connection.address, true);
    }
  },
  recheck: async (owner) => {
    const outcome = get().outcome;
    if (outcome?.kind !== 'unknown' || BUSY.has(get().phase)) return;
    const mine = ++ticket;
    set({ phase: 'sending', notice: null });
    const e = harborEnv();
    const relay = await follow({ results: outcome.signatures.map((signature) => ({ signature, state: 'UNKNOWN' as const, reason: null })), settled: false }, { ...e, sign: async () => ({ ok: false }), followMs: 20_000 });
    if (mine !== ticket) return;
    const next = outcomeOf(relay);
    set({ phase: next.kind === 'aged' || next.kind === 'refused' ? 'idle' : next.kind, outcome: next });
    if (next.kind === 'done' || next.kind === 'partial') {
      e.refreshHoldings([2_500]);
      void get().loadPositions(owner, true);
    }
  },
  again: () => {
    if (BUSY.has(get().phase)) return;
    const target = get().target;
    // A partly landed add already opened a position: a new Review of the whole amount could open a second one.
    if (get().outcome?.kind === 'partial' && target?.kind === 'add') {
      const positions = get().positions;
      return get().seePositions(positions.status === 'idle' ? null : positions.owner);
    }
    ticket += 1;
    set({ phase: 'idle', outcome: null, reviewed: null, notice: null, ...(target?.kind === 'add' ? {} : { target: null }) });
  },
  seePositions: (owner) => {
    if (BUSY.has(get().phase)) return;
    ticket += 1;
    set({ view: 'mine', pool: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null });
    if (owner) void get().loadPositions(owner, true);
  },
  forget: () => {
    // An action already in the wallet or on its way keeps its answer; only what was read for the last wallet goes.
    if (BUSY.has(get().phase)) {
      set({ states: null, positions: { status: 'idle' } });
      return;
    }
    ticket += 1;
    set({ states: null, positions: { status: 'idle' }, reviewed: null, phase: 'idle', outcome: null, notice: null });
  },
}));
