import { create } from 'zustand';
import { citySigner } from '../../../city/lib/app-bridge/route.ts';
import { createHarborEngine, type GetLike, type HarborEngine } from '../../../city/lib/districts/harbor/engine.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany } from '../../../city/lib/districts/harbor/flow.ts';
import { useEarn } from '../../../city/lib/earn/open.ts';
import { PIER_RESERVE_LAMPORTS, type PierGoal, type PierStyle } from '../../../city/lib/earn/pier.ts';
import { postJson, type EngineResult, type FetchLike } from '../../../city/lib/trade/engine.ts';
import type { Holdings } from '../../../city/lib/trade/wallet.ts';
import type { DlmmStockRead, DlmmStockReview } from '../../../lib/earn-dlmm/stocks.ts';
import { DEFAULT_STOCK_GOAL, DEFAULT_STOCK_STYLE, NO_TYPED, stockAddBody, stockChoice, stockFigures, typedAfter, type Lead, type StockAddBody, type Typed } from './model.ts';

/**
 * The state of a position put into a stock's DLMM pool with two coins, on the pool's own page: the pool
 * as the server reads it for this wallet (`/api/city/earn/dlmm-stocks`), the two amounts, the goal and the width, the
 * engine's Review of exactly what is on the form (built while the person reads it, through the stock door
 * `/api/city/earn/dlmm-stocks/review`), and where the action is. One approval of the wallet signs the Review's bytes;
 * the engine's own relay (`/api/liquidity/submit`) sends them once each; an answer that never came back is asked of the
 * chain — never sent again. Bytes that aged while the wallet was open are not sent: a fresh Review is built and shown.
 */

export type StockPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const STOCK_BUSY: ReadonlySet<StockPhase> = new Set(['reviewing', 'wallet', 'sending']);
export const STOCK_LOCKED: ReadonlySet<StockPhase> = new Set(['wallet', 'sending']);

export type StockRead =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; pool: string; owner: string | null }>
  | Readonly<{ status: 'ready'; pool: string; owner: string | null; value: DlmmStockRead }>
  /** The pool is no stock's, or the server serves none: the page keeps its own «soon». */
  | Readonly<{ status: 'none'; pool: string; owner: string | null }>
  | Readonly<{ status: 'error'; pool: string; owner: string | null }>;

export type StockReviewed = Readonly<{ key: string; body: StockAddBody; review: DlmmStockReview; at: number }>;
export type StockNotice = Readonly<{ tone: 'warn' | 'error'; code: string }>;

export type StockEngine = Pick<HarborEngine, 'submit' | 'status'> &
  Readonly<{
    read: (pool: string, owner: string | null) => Promise<EngineResult<DlmmStockRead>>;
    review: (body: StockAddBody) => Promise<EngineResult<DlmmStockReview>>;
  }>;

const READ_MS = 12_000;
const REVIEW_MS = 32_000;

async function getJson<T>(fetchImpl: GetLike, url: string, timeoutMs: number): Promise<EngineResult<T>> {
  const bound = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bound.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: bound.signal });
    const json = (await response.json().catch(() => null)) as (T & { error?: { code?: unknown } }) | null;
    if (!response.ok || !json) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      return { ok: false, failure: { code, message: code } };
    }
    return { ok: true, value: json, status: response.status };
  } catch {
    return { ok: false, failure: timedOut ? { code: 'TIMEOUT', message: 'TIMEOUT' } : { code: 'NETWORK', message: 'NETWORK' } };
  } finally {
    clearTimeout(timer);
  }
}

export function createStockEngine(
  fetchImpl: FetchLike & GetLike = ((url: string, init: RequestInit) => fetch(url, { cache: 'no-store', ...init })) as unknown as FetchLike & GetLike,
): StockEngine {
  const q = encodeURIComponent;
  const harbor = createHarborEngine(fetchImpl);
  return {
    submit: harbor.submit,
    status: harbor.status,
    read: (pool, owner) => getJson<DlmmStockRead>(fetchImpl, `/api/city/earn/dlmm-stocks?pool=${q(pool)}${owner ? `&owner=${q(owner)}` : ''}`, READ_MS),
    review: (body) => postJson<DlmmStockReview>(fetchImpl, '/api/city/earn/dlmm-stocks/review', body, REVIEW_MS),
  };
}

export type Connection = Readonly<{ wallet: string; address: string }>;

export type StockEnv = Readonly<{
  engine: StockEngine;
  sign: (connection: Connection) => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}>;

let env: StockEnv | null = null;
const browserEnv = (): StockEnv => ({
  engine: createStockEngine(),
  sign: (connection) => async (unsigned) => {
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: 'solana:mainnet' });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const stockEnv = (): StockEnv => (env ??= browserEnv());

/** Tests and the stand put their own reach here. */
export function setStockEnv(next: Partial<StockEnv>): void {
  env = { ...stockEnv(), ...next };
}

type Store = {
  read: StockRead;
  goal: PierGoal;
  style: PierStyle;
  typed: Typed;
  reviewed: StockReviewed | null;
  /** What the last Review of this pool kept aside in SOL: the position's deposit, the pool's space and the network. */
  reserve: Readonly<{ pool: string; value: bigint }> | null;
  phase: StockPhase;
  outcome: ActionOutcome | null;
  sent: StockReviewed | null;
  notice: StockNotice | null;
  load: (pool: string, owner: string | null) => Promise<void>;
  setGoal: (goal: PierGoal) => void;
  setStyle: (style: PierStyle) => void;
  setTyped: (lead: Lead, text: string) => void;
  prepare: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  recheck: () => Promise<void>;
  again: () => void;
};

/** The pool read now, for the wallet asked — null while it is not. */
export function readyRead(read: StockRead): DlmmStockRead | null {
  return read.status === 'ready' ? read.value : null;
}

let ticket = 0;

export const useDlmmStock = create<Store>((set, get) => {
  /** What the form asks now, or null when it cannot be asked. */
  const asked = (owner: string, holdings: Holdings | null): Readonly<{ key: string; body: StockAddBody }> | null => {
    const st = get();
    const read = readyRead(st.read);
    if (!read || read.add !== 'on' || read.paused) return null;
    const reserve = st.reserve?.pool === read.pool ? st.reserve.value : PIER_RESERVE_LAMPORTS;
    const choice = stockChoice(read, owner, st.typed, holdings, st.goal, st.style, reserve);
    if (!choice.key) return null;
    return { key: choice.key, body: stockAddBody(read, owner, choice, st.goal, st.style) };
  };
  const edited = () => {
    ticket += 1;
    return { reviewed: null, notice: null, phase: get().phase === 'reviewing' ? ('idle' as const) : get().phase };
  };

  return {
    read: { status: 'idle' },
    goal: DEFAULT_STOCK_GOAL,
    style: DEFAULT_STOCK_STYLE,
    typed: NO_TYPED,
    reviewed: null,
    reserve: null,
    phase: 'idle',
    outcome: null,
    sent: null,
    notice: null,

    load: async (pool, owner) => {
      const now = get().read;
      if (STOCK_LOCKED.has(get().phase)) return;
      if ((now.status === 'loading' || now.status === 'ready') && now.pool === pool && now.owner === owner) return;
      // Another pool starts from an empty form; the same pool with another wallet keeps what was typed.
      const samePool = now.status !== 'idle' && now.pool === pool;
      set({ read: { status: 'loading', pool, owner }, ...(samePool ? {} : { typed: NO_TYPED, reserve: null }), reviewed: null, outcome: null, sent: null, notice: null, phase: 'idle' });
      const answer = await stockEnv().engine.read(pool, owner);
      const current = get().read;
      if (current.status !== 'loading' || current.pool !== pool || current.owner !== owner) return;
      if (answer.ok) return set({ read: { status: 'ready', pool, owner, value: answer.value } });
      // A pool that is not a stock's, or a server that serves none (the switch off, Earn closed): the page keeps its «soon».
      const none = answer.failure.code === 'DLMM_STOCK_PAIR' || answer.failure.code === 'POOL_NOT_FOUND' || answer.failure.code === 'EARN_CLOSED' || answer.failure.code === 'HTTP_404';
      set({ read: none ? { status: 'none', pool, owner } : { status: 'error', pool, owner } });
    },
    setGoal: (goal) => {
      if (STOCK_LOCKED.has(get().phase) || goal === get().goal) return;
      set({ goal, ...edited() });
    },
    setStyle: (style) => {
      if (STOCK_LOCKED.has(get().phase) || style === get().style) return;
      set({ style, ...edited() });
    },
    setTyped: (lead, text) => {
      if (STOCK_LOCKED.has(get().phase)) return;
      const read = readyRead(get().read);
      const typed = read ? typedAfter(read, lead, text) : { ...get().typed, [lead]: text, lead };
      set({ typed, ...edited() });
    },

    prepare: async (connection, holdings) => {
      if (STOCK_BUSY.has(get().phase)) return;
      const want = asked(connection.address, holdings);
      if (!want) return;
      const mine = ++ticket;
      set({ phase: 'reviewing', notice: null, outcome: null });
      const answer = await stockEnv().engine.review(want.body);
      if (mine !== ticket) return;
      if (!answer.ok) return set({ phase: 'idle', reviewed: null, notice: { tone: 'error', code: answer.failure.code } });
      const read = readyRead(get().read);
      const reserve = read ? stockFigures(answer.value, read).reserve : null;
      set({ phase: 'idle', reviewed: { key: want.key, body: want.body, review: answer.value, at: stockEnv().now() }, ...(read && reserve !== null && reserve > 0n ? { reserve: { pool: read.pool, value: reserve } } : {}) });
      // The Review's own reserve can make the amount on screen more than the wallet holds: then it is not offered for signing.
      if (asked(connection.address, holdings)?.key !== want.key) set({ reviewed: null });
    },

    confirm: async (connection, holdings) => {
      const st = get();
      if (STOCK_BUSY.has(st.phase)) return;
      const want = asked(connection.address, holdings);
      const reviewed = want && st.reviewed?.key === want.key ? st.reviewed : null;
      const e = stockEnv();
      if (!reviewed || !reviewFresh(reviewed.review, reviewed.at, e.now())) {
        await get().prepare(connection, holdings);
        if (get().reviewed) set({ notice: { tone: 'warn', code: 'FRESH' } });
        return;
      }
      const mine = ++ticket;
      set({ phase: 'wallet', notice: null });
      const sign = e.sign(connection);
      const outcome = await signAndSend(reviewed.review, reviewed.at, {
        engine: e.engine,
        now: e.now,
        sleep: e.sleep,
        sign: async (unsigned) => {
          const signed = await sign(unsigned);
          if (signed.ok && mine === ticket) set({ phase: 'sending' });
          return signed;
        },
      });
      if (mine !== ticket) return;
      if (outcome.kind === 'aged') {
        set({ phase: 'idle', reviewed: null });
        await get().prepare(connection, holdings);
        if (get().reviewed) set({ notice: { tone: 'warn', code: 'FRESH' } });
        return;
      }
      if (outcome.kind === 'refused') return set({ phase: 'idle', notice: { tone: 'error', code: outcome.code }, ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }) });
      set({ phase: outcome.kind, outcome, sent: reviewed, reviewed: null });
    },

    recheck: async () => {
      const outcome = get().outcome;
      if (outcome?.kind !== 'unknown' || STOCK_BUSY.has(get().phase)) return;
      const mine = ++ticket;
      set({ phase: 'sending' });
      const e = stockEnv();
      const relay = await follow(
        { results: outcome.signatures.map((signature) => ({ signature, state: 'UNKNOWN' as const, reason: null })), settled: false },
        { engine: e.engine, now: e.now, sleep: e.sleep, sign: async () => ({ ok: false }), followMs: 20_000 },
      );
      if (mine !== ticket) return;
      const next = outcomeOf(relay);
      set({ outcome: next, phase: next.kind === 'aged' || next.kind === 'refused' ? 'idle' : next.kind });
    },

    again: () => {
      if (STOCK_BUSY.has(get().phase)) return;
      ticket += 1;
      // A position that landed is in Earn → My positions; the form starts empty, never the same amount twice by a tap.
      const landed = get().outcome?.kind === 'done' || get().outcome?.kind === 'partial';
      set({ phase: 'idle', outcome: null, sent: null, reviewed: null, notice: null, ...(landed ? { typed: NO_TYPED } : {}) });
    },
  };
});

// While the wallet is open or the bytes travel, the page's tabs hold — as they do for every action of Earn.
useDlmmStock.subscribe((now, before) => {
  if (STOCK_LOCKED.has(now.phase) !== STOCK_LOCKED.has(before.phase)) useEarn.getState().setBusy(STOCK_LOCKED.has(now.phase));
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __dlmmStock: useDlmmStock });
