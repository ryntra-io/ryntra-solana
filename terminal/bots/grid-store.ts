import { create } from 'zustand';

import { PRO_LIMITS_CHAINS, proLimitsWindow, type ProLimitsNetwork } from '../../lib/pro-limits/gate.ts';
import type { ProMarket, ProOrder, ProReview } from '../../lib/pro-limits/service.ts';
import { approveAll, placeAsks, placedOf, stopAsks, takeAsks, type GridAsk, type GridEngine, type GridPhase, type GridSign } from '../../lib/grid/flow.ts';
import { classicView, gridRefill, gridView, readRecord, takenOf, withPlaced, withStopped, withTaken, type GridCoin, type GridRecord, type GridVenue, type Taken } from '../../lib/grid/grid.ts';
import { gridPlan, gridPrices, gridStep, onLevels, type GridIntent, type GridShape } from '../../lib/grid/plan.ts';
import { citySigner } from '../../city/lib/app-bridge/route.ts';
import { createLadderEngine } from '../../city/lib/trade/pro-engine.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import { fetchLadderStatus, LADDER_NET, type LadderPoolInfo } from '../../city/lib/bots/ladder.ts';
import type { LadderOrderRead } from '../../lib/bots/ladder/orders.ts';
import { DEFAULT_TERMS, ladderCosts } from '../../lib/bots/ladder/costs.ts';
import { classicGrid } from '../../lib/grid/classic.ts';

/**
 * The grid's screen state: the coin's DLMM Pro market, the person's grids (this browser's memory of which
 * orders make one), the chain's read of their orders, and the one action under way.
 *
 * - The window's switch (`NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS`) names the network; closed, nothing here asks the engine
 *   anything and the screen draws the grid without a button that could sign.
 * - Every action is the lane's: Reviews, the wallet's one approval, the relay (`lib/grid/flow.ts`).
 */

export const GRID_NET: ProLimitsNetwork | null = proLimitsWindow(process.env.NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS);
/** The classic venue's network: the «Order ladder»'s, where the deployment names it. */
export const CLASSIC_NET = LADDER_NET;
/**
 * MET: the grid's first coin — its MET/SOL pool is Meteora DLMM Pro's, with the maker's bonus, so the Pro
 * venue is in front from the first look (decision 108: examples name SOL, JUP and MET).
 */
export const MET_MINT = 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL';

/** The network a grid of a venue lives on. */
export const netOf = (venue: GridVenue) => (venue === 'pro' ? GRID_NET : CLASSIC_NET);

export type GridAction = 'place' | 'take' | 'again' | 'stop';
export type NoteKind = 'placed' | 'taken' | 'again' | 'stopped' | 'walletNo' | 'refused' | 'unknown' | 'partly' | 'unreachable' | 'overCap' | 'lowBalance' | 'costsChanged' | 'moved' | 'checking';
/** A no is warm on screen; a yes is plain. */
export const WARN_NOTES: ReadonlySet<NoteKind> = new Set(['walletNo', 'refused', 'unknown', 'partly', 'unreachable', 'overCap', 'lowBalance', 'costsChanged', 'moved']);

type Read<T> = Readonly<{ status: 'loading' | 'ready' | 'failed'; value: T | null; code: string | null }>;

type State = Readonly<{
  markets: Readonly<Record<string, Read<ProMarket | null>>>;
  /** The coin's classic DLMM pool, where it has no DLMM Pro one. */
  classic: Readonly<Record<string, Read<LadderPoolInfo | null>>>;
  /** The classic orders' reads, by order account. */
  reads: Readonly<Record<string, LadderOrderRead>>;
  grids: readonly GridRecord[];
  /** The wallet's DLMM Pro orders of one coin, read from the chain, by `owner:mint`. */
  orders: Readonly<Record<string, Read<readonly ProOrder[]>>>;
  busy: Readonly<{ id: string; action: GridAction; phase: GridPhase }> | null;
  note: Readonly<{ id: string; kind: NoteKind }> | null;
}>;

/** Where a wallet's orders of one coin are kept. */
export const ordersKey = (owner: string, mint: string) => `${owner}:${mint}`;

export type GridEnv = Readonly<{ engine: GridEngine; sign: GridSign; now: () => number; store: Pick<Storage, 'getItem' | 'setItem'> | null; network: ProLimitsNetwork | null; fetch?: (url: string, init?: RequestInit) => Promise<Response> }>;

let env: GridEnv | null = null;
const browserEnv = (): GridEnv => ({
  engine: createLadderEngine(),
  sign: async (unsigned) => {
    const connection = useWallet.getState().connection;
    if (!connection || GRID_NET === null) return null;
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [...unsigned], chain: PRO_LIMITS_CHAINS[GRID_NET] });
    return signed.ok ? signed.signedWireBase64 : null;
  },
  now: () => Date.now(),
  store: typeof window === 'undefined' ? null : safeStorage(),
  network: GRID_NET,
});
const classicFetch = () => gridEnv().fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const gridEnv = (): GridEnv => (env ??= browserEnv());
/** For a test: the engine, the signer, the clock, the storage and the network. */
export function setGridEnv(next: GridEnv | null): void {
  env = next;
}

const KEY = 'ryntra.grids.v1';

function load(): GridRecord[] {
  try {
    const raw = gridEnv().store?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.map(readRecord).filter((one): one is GridRecord => one !== null) : [];
  } catch {
    return [];
  }
}

function keep(grids: readonly GridRecord[]): void {
  try {
    gridEnv().store?.setItem(KEY, JSON.stringify(grids));
  } catch {
    // A browser that keeps nothing: the grids live for this visit; the orders stand on the chain either way.
  }
}

/** The note for a failure's code. */
export function noteOf(code: string): NoteKind {
  if (code === 'WALLET_DECLINED') return 'walletNo';
  if (code === 'UNKNOWN') return 'unknown';
  if (code === 'PRO_LIMIT_CAP') return 'overCap';
  if (code === 'PRO_LIMIT_BALANCE_LOW') return 'lowBalance';
  if (code === 'OFF_LEVELS') return 'moved';
  if (code === 'NETWORK' || code === 'TIMEOUT' || code === 'UNAVAILABLE') return 'unreachable';
  return 'refused';
}

/**
 * The check before the wallet: every ladder the lane built lands on the grid's levels — as many prices as asked, each
 * within half a step of a level. A price moved since the screen was drawn, or a pool's spacing that merged levels, is
 * said and nothing is signed.
 */
export function onGrid(levels: readonly number[], step: number) {
  return (reviews: readonly ProReview[], asks: readonly GridAsk[]): string | null => {
    for (const [index, review] of reviews.entries()) {
      const ask = asks[index];
      if (!review.quote || ask?.action !== 'place') continue;
      if (!onLevels(review.quote.rungs.map((rung) => rung.price), levels, ask.intent.rungs, step)) return 'OFF_LEVELS';
    }
    return null;
  };
}

/** The lane answers at most this many orders of a wallet and coin: a read that full may leave some out. */
const ORDERS_SHOWN = 12;

export type PlaceInput = Readonly<{ owner: string; market: ProMarket; coin: GridCoin; shape: GridShape; amount: number; intents: Readonly<{ buy: GridIntent | null; sell: GridIntent | null }> }>;

export type ClassicInput = Readonly<{ owner: string; wallet: string; pool: LadderPoolInfo; coin: GridCoin; quote: GridCoin; shape: GridShape; amount: number }>;

type Actions = Readonly<{
  /** A coin's venue read once, for its mark in the coin list: DLMM Pro first, the classic pool only where Pro has none. */
  knowVenue: (mint: string) => Promise<void>;
  loadClassic: (mint: string) => Promise<void>;
  readClassic: (owner: string) => Promise<void>;
  placeClassic: (input: ClassicInput) => Promise<boolean>;
  againClassic: (id: string, wallet: string) => Promise<void>;
  stopClassic: (id: string, wallet: string) => Promise<void>;
  hydrate: () => void;
  loadMarket: (mint: string) => Promise<ProMarket | null>;
  readOrders: (owner: string, mint: string) => Promise<void>;
  place: (input: PlaceInput) => Promise<boolean>;
  take: (id: string) => Promise<void>;
  again: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  say: (note: State['note']) => void;
}>;

/**
 * The coin list's venue reads (`knowVenue`): at most this many a minute, and none for a minute after a read that
 * failed — the venues' routes count a person's reads (the classic one 30 a minute), and the form's own reads of the
 * coin in front must never be the ones refused.
 */
const MARKS_A_MINUTE = 12;
const MARK_WINDOW_MS = 60_000;
const markedAt: number[] = [];
let markHeldUntil = 0;
/** Whether one more list read fits the budget now; counted when it does. */
function markAllowed(now: number): boolean {
  while (markedAt.length && now - markedAt[0]! >= MARK_WINDOW_MS) markedAt.shift();
  if (now < markHeldUntil || markedAt.length >= MARKS_A_MINUTE) return false;
  markedAt.push(now);
  return true;
}
const markRefused = (now: number) => {
  markHeldUntil = now + MARK_WINDOW_MS;
};

let hydrated = false;
/** Each read of orders is numbered: an answer older than the newest asked never overwrites a fresher one. */
const asked = new Map<string, number>();
/** When each read of orders last answered, and when each grid last acted: a step waits for a read newer than its grid's last action. */
const readAt = new Map<string, number>();
const actedAt = new Map<string, number>();
let classicAsked = 0;

export const useGrid = create<State & Actions>((set, get) => {
  const save = (grids: readonly GridRecord[]) => {
    keep(grids);
    set({ grids });
  };
  const replace = (next: GridRecord) => save(get().grids.map((one) => (one.id === next.id ? next : one)));
  const recordOf = (id: string) => get().grids.find((one) => one.id === id) ?? null;
  /** One action at a time: the wallet is asked for one approval at once. */
  const free = () => get().busy === null && gridEnv().network !== null;
  /**
   * A grid's orders as the chain last told them — only a read that answered after the grid's last action and that is
   * not full; null otherwise, and no step is taken on it.
   */
  const readOf = (record: GridRecord): readonly ProOrder[] | null => {
    const key = ordersKey(record.owner, record.coin.mint);
    const read = get().orders[key];
    if (!read || read.status !== 'ready' || !read.value) return null;
    if ((readAt.get(key) ?? 0) <= (actedAt.get(record.id) ?? -1)) return null;
    return read.value.length >= ORDERS_SHOWN ? null : read.value;
  };
  const acted = (id: string) => actedAt.set(id, gridEnv().now());

  /** Runs one action's approval and says how it ended. */
  const run = async (id: string, action: GridAction, asks: Parameters<typeof approveAll>[2], check?: Parameters<typeof approveAll>[4]) => {
    set({ busy: { id, action, phase: 'reviewing' }, note: null });
    const done = await approveAll(gridEnv().engine, gridEnv().sign, asks, (phase) => set({ busy: { id, action, phase } }), check);
    set({ busy: null });
    return done;
  };
  const ended = (id: string, done: Awaited<ReturnType<typeof approveAll>>, yes: NoteKind) => {
    const kind: NoteKind = done.failure ? (done.landed.length ? 'partly' : noteOf(done.failure.code)) : yes;
    set({ note: { id, kind } });
  };
  /** What each landed take or close brought, from its Review's own word. */
  const takenFrom = (record: GridRecord, done: Awaited<ReturnType<typeof approveAll>>, live: readonly ProOrder[]): Taken[] =>
    done.landed.flatMap(({ ask, review }) => {
      if (ask.action === 'place') return [];
      const order = live.find((one) => one.nftMint === ask.nftMint);
      return order ? [takenOf(order, review.receives, record.coin.mint)] : [];
    });

  return {
    markets: {},
    classic: {},
    reads: {},
    grids: [],
    orders: {},
    busy: null,
    note: null,

    hydrate: () => {
      if (hydrated) return;
      hydrated = true;
      set({ grids: load() });
    },

    loadMarket: async (mint) => {
      if (gridEnv().network === null) return null;
      const known = get().markets[mint];
      /* A read again after one that failed is a read under way, not a «no»: what was read before stays. */
      if (!known || known.status === 'failed') set({ markets: { ...get().markets, [mint]: { status: 'loading', value: known?.value ?? null, code: null } } });
      const answer = await gridEnv().engine.market(mint);
      /* A read that failed keeps what was read before: a pool is never shown as none because the engine was late. */
      const was = get().markets[mint];
      set({ markets: { ...get().markets, [mint]: answer.ok ? { status: 'ready', value: answer.value, code: null } : { status: 'failed', value: was?.value ?? null, code: answer.failure.code } } });
      return answer.ok ? answer.value : null;
    },

    readOrders: async (owner, mint) => {
      if (gridEnv().network === null) return;
      const key = ordersKey(owner, mint);
      const n = (asked.get(key) ?? 0) + 1;
      asked.set(key, n);
      if (!get().orders[key]) set({ orders: { ...get().orders, [key]: { status: 'loading', value: null, code: null } } });
      const answer = await gridEnv().engine.orders(owner, mint);
      if (asked.get(key) !== n) return;
      const was = get().orders[key];
      if (answer.ok) readAt.set(key, gridEnv().now() + 1);
      /* A read that failed keeps what was shown, marked stale: no step is taken on it. */
      set({ orders: { ...get().orders, [key]: answer.ok ? { status: 'ready', value: answer.value, code: null } : { status: 'failed', value: was?.value ?? null, code: answer.failure.code } } });
    },

    place: async (input) => {
      const network = gridEnv().network;
      if (!free() || network === null) return false;
      const asks = placeAsks(input.owner, input.coin.mint, input.intents);
      if (!asks.length) return false;
      const id = `grid-${gridEnv().now().toString(36)}-${input.market.pool.slice(0, 6)}`;
      const done = await run('new', 'place', asks, onGrid(gridPrices(input.shape), gridStep(input.shape)));
      const placed = placedOf(done);
      if (placed.length) {
        const record: GridRecord = {
          v: 1,
          id,
          network,
          venue: 'pro',
          owner: input.owner,
          pool: input.market.pool,
          coin: input.coin,
          quote: { mint: input.market.quote.mint, symbol: input.market.quote.symbol, decimals: input.market.quote.decimals },
          shape: input.shape,
          amount: input.amount,
          createdAt: gridEnv().now(),
          stoppedAt: null,
          orders: [],
          free: { coinRaw: '0', quoteRaw: '0' },
          filledTaken: 0,
          basis: { coinRaw: '0', quoteRaw: '0' },
          profitRaw: '0',
          bonusTaken: {},
        };
        save([withPlaced(record, placed, false, input.market.price), ...get().grids]);
        acted(id);
      }
      ended('new', done, 'placed');
      void get().readOrders(input.owner, input.coin.mint);
      return placed.length > 0 && !done.failure;
    },

    take: async (id) => {
      const record = recordOf(id);
      const orders = record ? readOf(record) : null;
      if (record && free() && !orders) return void set({ note: { id, kind: 'checking' } });
      if (!free() || !record || !orders) return;
      const view = gridView(record, orders);
      const asks = takeAsks(record.owner, view.live);
      if (!asks.length) return;
      const done = await run(record.id, 'take', asks);
      const taken = takenFrom(record, done, view.live);
      if (taken.length) replace(withTaken(recordOf(id) ?? record, taken));
      acted(id);
      ended(record.id, done, 'taken');
      await get().readOrders(record.owner, record.coin.mint);
    },

    again: async (id) => {
      const record = recordOf(id);
      const orders = record ? readOf(record) : null;
      if (record && free() && !orders) return void set({ note: { id, kind: 'checking' } });
      if (!free() || !record || !orders) return;
      /* Busy from the tap: a second tap while the price is read again starts nothing. */
      set({ busy: { id, action: 'again', phase: 'reviewing' }, note: null });
      /* The price is read again now: a ladder is placed at distances from it. */
      const market = await get().loadMarket(record.coin.mint);
      set({ busy: null });
      if (!market || !(market.price > 0)) {
        set({ note: { id, kind: 'unreachable' } });
        return;
      }
      const view = gridView(record, orders);
      const asks = placeAsks(record.owner, record.coin.mint, gridRefill(record, view, market.price));
      if (!asks.length) return;
      const done = await run(record.id, 'again', asks, onGrid(gridPrices(record.shape), gridStep(record.shape)));
      const placed = placedOf(done);
      if (placed.length) replace(withPlaced(recordOf(id) ?? record, placed, true));
      acted(id);
      ended(record.id, done, 'again');
      await get().readOrders(record.owner, record.coin.mint);
    },

    stop: async (id) => {
      const record = recordOf(id);
      const orders = record ? readOf(record) : null;
      /* Never stopped on a read that has not answered: its orders may still rest. */
      if (record && free() && !orders) return void set({ note: { id, kind: 'checking' } });
      if (!free() || !record || !orders) return;
      const view = gridView(record, orders);
      const asks = stopAsks(record.owner, view.live);
      if (!asks.length) {
        replace(withStopped(record, [], gridEnv().now()));
        return;
      }
      const done = await run(record.id, 'stop', asks);
      const taken = takenFrom(record, done, view.live);
      const now = recordOf(id) ?? record;
      /* Stopped only when every order closed; what closed otherwise came back to the wallet, free, and the rest stands. */
      replace(taken.length === view.live.length && !done.unsure.length ? withStopped(now, taken, gridEnv().now()) : withTaken(now, taken));
      acted(id);
      ended(record.id, done, 'stopped');
      await get().readOrders(record.owner, record.coin.mint);
    },

    say: (note) => set({ note }),

    knowVenue: async (mint) => {
      /* Read once: a coin already asked keeps its answer (the form's own reads keep it fresh for the coin in front).
         Within the list's budget: the venues' routes count a person's reads, and the form's own come first. */
      if (gridEnv().network !== null) {
        const known = get().markets[mint];
        if (!known) {
          if (!markAllowed(gridEnv().now())) return;
          if (await get().loadMarket(mint)) return;
        } else if (known.value || known.status === 'loading') return;
        const read = get().markets[mint];
        if (read?.status === 'failed' && read.code !== 'CAPABILITY_UNAVAILABLE') return void markRefused(gridEnv().now());
      }
      if (CLASSIC_NET === null || get().classic[mint] || !markAllowed(gridEnv().now())) return;
      await get().loadClassic(mint);
      if (get().classic[mint]?.status === 'failed') markRefused(gridEnv().now());
    },

    loadClassic: async (mint) => {
      if (CLASSIC_NET === null) return;
      const known = get().classic[mint];
      if (!known || known.status === 'failed') set({ classic: { ...get().classic, [mint]: { status: 'loading', value: known?.value ?? null, code: null } } });
      const status = await fetchLadderStatus(mint, CLASSIC_NET, classicFetch());
      const was = get().classic[mint];
      set({ classic: { ...get().classic, [mint]: status ? { status: 'ready', value: status.pool && status.pool.takesLimitOrders ? status.pool : null, code: null } : { status: 'failed', value: was?.value ?? null, code: 'UNAVAILABLE' } } });
    },

    readClassic: async (owner) => {
      if (CLASSIC_NET === null) return;
      const orders = get().grids.filter((one) => one.venue === 'dlmm' && one.owner === owner && one.network === CLASSIC_NET && one.stoppedAt === null).flatMap((one) => one.orders.map((order) => order.nftMint)).slice(0, 24);
      if (!orders.length) return;
      const n = (classicAsked += 1);
      try {
        const response = await classicFetch()('/api/bots/ladder/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network: CLASSIC_NET, owner, orders }), cache: 'no-store' });
        if (!response.ok) return;
        const body = (await response.json()) as { orders?: LadderOrderRead[] };
        if (!Array.isArray(body.orders) || n !== classicAsked) return;
        set({ reads: { ...get().reads, ...Object.fromEntries(body.orders.map((read) => [read.limitOrder, read])) } });
      } catch {
        // A read that failed keeps what was read before.
      }
    },

    placeClassic: async (input) => {
      const network = CLASSIC_NET;
      if (get().busy !== null || network === null) return false;
      const placed = await placeClassicGrid('new', input, network);
      if (!placed) return false;
      const record: GridRecord = {
        v: 1,
        id: `grid-${gridEnv().now().toString(36)}-${input.pool.facts.pool.slice(0, 6)}`,
        network,
        venue: 'dlmm',
        owner: input.owner,
        pool: input.pool.facts.pool,
        coin: input.coin,
        quote: input.quote,
        shape: input.shape,
        amount: input.amount,
        createdAt: gridEnv().now(),
        stoppedAt: null,
        orders: placed,
        free: { coinRaw: '0', quoteRaw: '0' },
        filledTaken: 0,
        basis: { coinRaw: '0', quoteRaw: '0' },
        profitRaw: '0',
        bonusTaken: {},
      };
      save([record, ...get().grids]);
      void get().readClassic(input.owner);
      return true;
    },

    againClassic: async (id, wallet) => {
      const record = recordOf(id);
      if (!record || get().busy !== null || CLASSIC_NET === null) return;
      const network = CLASSIC_NET;
      set({ busy: { id, action: 'again', phase: 'reviewing' }, note: null });
      /* The pool read again, and the new grid built and checked before anything is taken back: a grid that cannot stand
         again around today's price is said now, and its orders stay where they are. */
      await get().loadClassic(record.coin.mint);
      set({ busy: null });
      /* Only a read that answered now: a pool kept from before is not today's price. */
      const read = get().classic[record.coin.mint];
      const pool = read?.status === 'ready' ? read.value : null;
      const input = pool ? { owner: record.owner, wallet, pool, coin: record.coin, quote: record.quote, shape: record.shape, amount: record.amount } : null;
      if (!input || !classicReady(input)) {
        set({ note: { id, kind: pool ? 'moved' : 'unreachable' } });
        return;
      }
      const view = classicView(record, get().reads);
      /* First the grid's orders back to the wallet, whole; then the grid again around the price. */
      if (!(await cancelClassic(record, wallet, 'again'))) return;
      const taken = { ...(recordOf(id) ?? record), orders: [], filledTaken: record.filledTaken + view.waiting };
      replace(taken);
      const placed = await placeClassicGrid(id, input, network);
      /* Not placed again: the grid stands with nothing resting and its money in the wallet; «Place again» stays. */
      if (placed) {
        replace({ ...taken, orders: placed });
        if (get().note?.id === id && get().note?.kind === 'placed') set({ note: { id, kind: 'again' } });
      }
      void get().readClassic(record.owner);
    },

    stopClassic: async (id, wallet) => {
      const record = recordOf(id);
      if (!record || get().busy !== null) return;
      const view = classicView(record, get().reads);
      if (!(await cancelClassic(record, wallet, 'stop'))) return;
      replace({ ...(recordOf(id) ?? record), stoppedAt: gridEnv().now(), filledTaken: record.filledTaken + view.waiting });
      set({ note: { id, kind: 'stopped' } });
    },
  };

  /** Whether a classic grid can be placed as it is asked, on its pool now. */
  function classicReady(input: ClassicInput): boolean {
    const price = input.pool.activePrice;
    const plan = gridPlan(input.shape, input.amount, { price, coinDecimals: input.pool.facts.baseDecimals, quoteDecimals: input.pool.facts.quoteDecimals });
    const grid = plan.issue ? null : classicGrid(plan, price, input.pool.facts);
    return Boolean(grid && !grid.issue && grid.legs.length);
  }

  /** The classic grid's legs placed in one approval: the orders that landed, or null — and the note says why. */
  async function placeClassicGrid(id: string, input: ClassicInput, network: 'devnet' | 'mainnet'): Promise<GridRecord['orders'] | null> {
    const price = input.pool.activePrice;
    const plan = gridPlan(input.shape, input.amount, { price, coinDecimals: input.pool.facts.baseDecimals, quoteDecimals: input.pool.facts.quoteDecimals });
    const grid = plan.issue ? null : classicGrid(plan, price, input.pool.facts);
    if (!grid || grid.issue || !grid.legs.length) {
      set({ note: { id, kind: 'refused' } });
      return null;
    }
    const costs = ladderCosts(grid.plans, { existingArrays: new Set(input.pool.existingArrays), bitmapExtension: input.pool.bitmapExtension }, input.pool.terms ?? DEFAULT_TERMS);
    const action: GridAction = id === 'new' ? 'place' : 'again';
    set({ busy: { id, action, phase: 'wallet' }, note: null });
    const { placeLadder } = await import('../../city/lib/bots/ladder-sign.ts');
    const result = await placeLadder({ wallet: input.wallet, owner: input.owner, pool: input.pool.facts.pool, legs: grid.legs, shown: costs, network }, { fetch: gridEnv().fetch, onSigned: () => set({ busy: { id, action, phase: 'sending' } }) });
    set({ busy: null });
    if (result.kind === 'placed' || result.kind === 'unsure') {
      const failed = new Set(result.legs.filter((leg) => leg.state === 'failed').map((leg) => leg.limitOrder));
      set({ note: { id, kind: result.kind === 'unsure' ? 'unknown' : failed.size ? 'partly' : 'placed' } });
      const kept = result.review.transactions.filter((tx) => !failed.has(tx.limitOrder)).map((tx) => ({ nftMint: tx.limitOrder, action: tx.side === 'buy' ? ('buy' as const) : ('sell' as const) }));
      return kept.length ? kept : null;
    }
    set({ note: { id, kind: result.kind === 'walletNo' ? 'walletNo' : result.kind === 'unreachable' ? 'unreachable' : result.kind === 'costsChanged' ? 'costsChanged' : 'refused' } });
    return null;
  }

  /** Every open order of a classic grid taken back in one approval; whether they were. */
  async function cancelClassic(record: GridRecord, wallet: string, action: GridAction): Promise<boolean> {
    const orders = record.orders.map((order) => order.nftMint).filter((order) => get().reads[order]?.state !== 'closed');
    if (!orders.length) return true;
    set({ busy: { id: record.id, action, phase: 'wallet' }, note: null });
    const { cancelLadderOrders } = await import('../../city/lib/bots/ladder-sign.ts');
    const result = await cancelLadderOrders({ wallet, owner: record.owner, orders, network: record.network }, { fetch: gridEnv().fetch });
    set({ busy: null });
    /* Taken back only when the chain confirmed every order: otherwise the grid keeps them and the next read says. */
    if (result.kind === 'cancelled' && result.legs.every((leg) => leg.state === 'confirmed')) return true;
    set({ note: { id: record.id, kind: result.kind === 'cancelled' ? 'partly' : result.kind === 'unsure' ? 'unknown' : result.kind === 'walletNo' ? 'walletNo' : result.kind === 'unreachable' ? 'unreachable' : 'refused' } });
    void get().readClassic(record.owner);
    return false;
  }

});

/** For a test: the store's first read of the grids again. */
export function resetGridStore(): void {
  hydrated = false;
  markedAt.length = 0;
  markHeldUntil = 0;
  useGrid.setState({ markets: {}, classic: {}, reads: {}, grids: [], orders: {}, busy: null, note: null });
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __grid: useGrid });
