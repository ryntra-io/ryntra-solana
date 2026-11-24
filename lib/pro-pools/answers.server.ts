/**
 * The answers of the DLMM Pro pools' open reads — every pool's day (`/api/pro/pools/days`) and one pool's day, trades
 * and filled orders (`/api/pro/pools/<address>/{stats,trades,fills}`) — read from the database (`./store.ts`).
 *
 * - **One number.** A pool's day is its row's summary, counted by the indexer (`./indexer.server.ts`). The pools'
 *   table and the pool's own page read the same row, so they cannot disagree, and two answers in a row cannot differ
 *   by which instance gave them: no instance counts anything here, and nothing read is kept in the process.
 * - **Only reads.** An answer costs one read of the states, and for a list one more of the pool's newest rows — the
 *   trades by the database's flag, the filled orders as the database picks them (`ProStore.fills`; the newest
 *   transactions with orders where it cannot yet). Where the last step began more than `staleMs` ago and none runs,
 *   the answer says so (`step`) and the route starts one behind it — the cron does the same every minute; the lease
 *   lets one of them through.
 * - **The spare path.** Where the database does not answer, the tables are not there yet, the indexer has never
 *   finished a step, or it does not hold the pool (it indexes the deepest pools — those the table shows), the answer
 *   comes from the instance's own memory exactly as before (`./days.server.ts`, `./tape.server.ts`). A person sees no
 *   difference; `from` is for the route's own bookkeeping, never part of the body.
 *
 * No `next` import: the routes wrap it, the tests run it over a store in memory.
 */

import type { ProPoolNetwork, ProPoolRow } from "./model.ts";
import { ProStoreUnavailable, sidesIn, type PoolState, type ProStore, type StoreStates } from "./store.ts";
import { fillsAnswerOf, headOf, statsAnswerOf, tapePoolOf, tradesAnswerOf, type ProDayEntry, type ProDaysAnswer, type ProFillsAnswer, type ProStatsAnswer, type ProTradesAnswer, type TapeView } from "./tape.ts";

export type TapeRead = "stats" | "trades" | "fills";

export type AnswerLimits = Readonly<{
  /** The most pools in the answer of every pool's day, the deepest first. */
  pools: number;
  /** The node's refusals in a row after which a pool never counted is «unknown». */
  tries: number;
  /** A step is started behind an answer once the last one began this long ago, ms. */
  staleMs: number;
  /** A pool's row is the indexer's own while it was written within this long before the last step, ms. */
  liveMs: number;
  /** Transactions with orders read for a pool's filled orders: their collects, and the placings that name their sides. */
  orders: number;
  /** What the days' answer says of how long a count stays, seconds. */
  fresh: number;
}>;

export const ANSWER_LIMITS: AnswerLimits = Object.freeze({ pools: 64, tries: 3, staleMs: 60_000, liveMs: 10 * 60_000, orders: 1_000, fresh: 60 });

/** How long the edge keeps any of these answers, seconds: fresh, then served stale while it is asked again. */
export const ANSWER_CACHE = Object.freeze({ fresh: 15, stale: 30 });

type Read = Readonly<{ states: StoreStates | null; down: boolean }>;

async function statesOf(store: ProStore | null, network: ProPoolNetwork): Promise<Read> {
  if (!store) return { states: null, down: false };
  try {
    return { states: await store.states(network), down: false };
  } catch {
    return { states: null, down: true };
  }
}

/** The indexer has finished a step: the store's rows are what it counted. */
const ready = (states: StoreStates): boolean => states.step.endedAgo !== null;
const stepDue = (states: StoreStates, limits: AnswerLimits): boolean => !states.step.running && (states.step.startedAgo === null || states.step.startedAgo >= limits.staleMs);
/** The pool is among those the indexer writes: its row is no older than the last step by more than `liveMs`. */
const live = (state: PoolState, states: StoreStates, limits: AnswerLimits): boolean => state.writtenAgo - (states.step.startedAgo ?? 0) < limits.liveMs;

/** One pool's day from its row: counted, still counting, or — after the node's refusals in a row — unknown. */
export function dayEntryOf(pool: string, state: PoolState | undefined, limits: Pick<AnswerLimits, "tries"> = ANSWER_LIMITS): ProDayEntry {
  if (state?.summary) return { pool, state: "ready", at: state.summary.at, depth: state.summary.depth, stats: state.summary.stats };
  return { pool, state: state && state.fails >= limits.tries ? "unknown" : "counting", at: null };
}

export type DaysDeps = Readonly<{
  network: ProPoolNetwork;
  /** Null where the deployment has no database. */
  store: ProStore | null;
  /** The network's pools, deepest first; throws where the chain did not answer. */
  pools: () => Promise<readonly ProPoolRow[]>;
  /** The spare path: every pool's day from the instance's memory, and the refresh it started behind the answer. */
  memory: (rows: readonly ProPoolRow[]) => Promise<Readonly<{ answer: ProDaysAnswer; refresh: Promise<void> | null }>>;
  now?: number;
  limits?: AnswerLimits;
}>;

type Told = Readonly<{
  from: "store" | "memory";
  /** Start a step of the indexer behind the answer. */
  step: boolean;
  /** The database did not answer this time. */
  down: boolean;
}>;

export type DaysResult = Told & Readonly<{ answer: ProDaysAnswer; refresh: Promise<void> | null }>;

/** Every listed pool's day. Null — nothing to answer with: the chain did not list the pools and the store holds none. */
export async function daysAnswer(deps: DaysDeps): Promise<DaysResult | null> {
  const limits = deps.limits ?? ANSWER_LIMITS;
  const now = deps.now ?? Date.now();
  const [read, rows] = await Promise.all([statesOf(deps.store, deps.network), deps.pools().catch(() => null)]);
  const { states } = read;
  if (states && ready(states)) {
    /* The pools as listed now; where the chain did not list them, the pools the indexer holds. */
    const listed = rows ? rows.slice(0, limits.pools).map((row) => row.address) : [...states.pools.values()].filter((state) => live(state, states, limits)).map((state) => state.pool);
    if (rows || listed.length > 0) {
      const days = listed.map((pool) => dayEntryOf(pool, states.pools.get(pool), limits));
      return { answer: { network: deps.network, at: new Date(now).toISOString(), fresh: limits.fresh, days }, refresh: null, from: "store", step: stepDue(states, limits), down: false };
    }
  }
  if (!rows) return null;
  const { answer, refresh } = await deps.memory(rows);
  return { answer, refresh, from: "memory", step: states !== null && stepDue(states, limits), down: read.down };
}

export type TapeDeps = Readonly<{
  network: ProPoolNetwork;
  store: ProStore | null;
  row: ProPoolRow;
  kind: TapeRead;
  /** Rows of a list answer. */
  limit: number;
  /** The spare path: the pool's tape from the instance's memory; throws where the node did not answer. */
  memory: () => Promise<TapeView>;
  now?: number;
  limits?: AnswerLimits;
}>;

export type TapeResult = Told & Readonly<{ body: ProStatsAnswer | ProTradesAnswer | ProFillsAnswer }>;

/** One pool's day, newest trades or filled orders. Null — neither the store nor the node answered for it. */
export async function tapeAnswer(deps: TapeDeps): Promise<TapeResult | null> {
  const limits = deps.limits ?? ANSWER_LIMITS;
  const now = deps.now ?? Date.now();
  const { network, store, row, kind } = deps;
  const read = await statesOf(store, network);
  const { states } = read;
  let down = read.down;
  const state = states?.pools.get(row.address);
  if (store && states && ready(states) && state?.summary && live(state, states, limits)) {
    const head = { pool: tapePoolOf(row), depth: state.summary.depth };
    const told = { from: "store", step: stepDue(states, limits), down: false } as const;
    try {
      if (kind === "stats") return { ...told, body: { ...headOf(head, network, now), stats: state.summary.stats } };
      if (kind === "trades") {
        const { txs } = await store.recent(network, row.address, { kind: "trades", since: null, limit: deps.limit, tries: limits.tries });
        return { ...told, body: tradesAnswerOf({ ...head, txs, sides: new Map() }, network, now, deps.limit) };
      }
      /* The filled orders as the database picks them; where it cannot yet, its newest transactions with orders. */
      const picked = store.fills ? await store.fills(network, row.address, { collectedIn: head.pool.collectedIn, limit: deps.limit }) : null;
      if (picked) return { ...told, body: fillsAnswerOf({ ...head, txs: picked.txs, sides: picked.sides }, network, now, deps.limit) };
      const { txs } = await store.recent(network, row.address, { kind: "orders", since: null, limit: limits.orders, tries: limits.tries });
      return { ...told, body: fillsAnswerOf({ ...head, txs, sides: sidesIn(txs) }, network, now, deps.limit) };
    } catch (error) {
      if (!(error instanceof ProStoreUnavailable)) throw error;
      down = true;
    }
  }
  const view = await deps.memory().catch(() => undefined);
  if (view === undefined) return null;
  const body = kind === "stats" ? statsAnswerOf(view, network, now) : kind === "trades" ? tradesAnswerOf(view, network, now, deps.limit) : fillsAnswerOf(view, network, now, deps.limit);
  return { body, from: "memory", step: !!states && stepDue(states, limits), down };
}
