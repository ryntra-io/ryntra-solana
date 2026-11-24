/**
 * Where the DLMM Pro pools' tape lives: the database, not a process's memory.
 *
 * A pool's day was counted by every instance of the deployment on its own — each read the node for itself and kept
 * what it read while it lived. Several instances answered several numbers: the day's volume went back to an older
 * count, the pools' table and the pool's own page disagreed, the first visitor waited for a count. Here is one place
 * for all of them:
 *
 * - **A transaction** of a pool is one row: listed by the node (`unread`), read and decoded once (`read`, its
 *   `TapeTxRecords` kept), or not given by the node (`lost`, with how many times). A read row never changes.
 * - **A pool's state** is one row: the day counted (`PoolSummary` — the depth and the numbers `statsOf` gives), where
 *   the node's list of its signatures was read to (`PoolCursor`), and how many times in a row the node did not list it.
 * - **One indexer at a time** per network: a lease taken and freed in the same table (`./indexer.server.ts`).
 *
 * The routes only read: the pools' table and a pool's page answer from the same row, so they say one number.
 *
 * This module is the contract (`ProStore`), the day counted from stored rows (`summaryOf`) and a store in memory with
 * the database's own rules — what the tests run on. The database itself is `./supabase-store.ts` over the functions of
 * `supabase/migrations/20261120150000_pro_pools_store_v1.sql` and, once applied, `20261123120000_pro_pools_flags_v2.sql`
 * (the day counted where the rows are: `summaryOfCount` over the store's `DayCount`). Pure and client-safe.
 */

import type { ProPoolNetwork } from "./model.ts";
import { STATS_HOURS, fillOf, statsOfTally, tallyOf, type DayTally, type ProPoolStats, type TapeDepth, type TapePool, type TapeTxRecords } from "./tape.ts";

/** The database did not answer, or answered what is not its own shape: the caller goes on without it. */
export class ProStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProStoreUnavailable";
  }
}

/** A transaction as the indexer writes it: listed, read (with its records) or not given by the node `misses` times. */
export type StoredTx = Readonly<{
  pool: string;
  signature: string;
  slot: number;
  /** Unix seconds; null where the node gave no time. */
  blockTime: number | null;
  state: "unread" | "read" | "lost";
  misses: number;
  records: TapeTxRecords | null;
}>;

/** A transaction still to read. */
export type PendingTx = Readonly<{
  pool: string;
  signature: string;
  slot: number;
  blockTime: number | null;
  state: "unread" | "lost";
  misses: number;
  /** When the node last did not give it, ms; null — never asked. */
  lostAt: number | null;
}>;

/**
 * The day of a pool as counted: when, from how deep, and the numbers. `newest` — when the pool's newest known
 * transaction landed, unix seconds (null — none known): what the indexer paces its lists of the pool by. Absent in a
 * summary counted before the field was there.
 */
export type PoolSummary = Readonly<{ at: string; depth: TapeDepth; stats: ProPoolStats; newest?: number | null }>;

/**
 * Where the node's list of a pool's signatures was read to: `head` — the newest signature listed (the next list asks
 * for what landed after it); `tail` — the oldest listed, with its time (an older page is asked before it while the day
 * is still open); `end` — the node gives nothing older.
 */
export type PoolCursor = Readonly<{ head: string | null; tail: string | null; tailTime: number | null; end: boolean }>;

export type PoolState = Readonly<{
  pool: string;
  summary: PoolSummary | null;
  cursor: PoolCursor;
  /** When the node last listed the pool, ms. */
  checkedAt: number | null;
  /** Times in a row the node did not list it, and when the last one was. */
  fails: number;
  failedAt: number | null;
  /** How long ago the indexer last wrote the row, ms on the store's own clock. */
  writtenAgo: number;
}>;

/** What the indexer writes of a pool after a step; a null summary keeps the one counted before. */
export type PoolStateWrite = Omit<PoolState, "writtenAgo">;

export type StoreStates = Readonly<{
  pools: ReadonlyMap<string, PoolState>;
  /** The indexer: whether a step runs now, and how long ago the last one began and ended (ms; null — never). */
  step: Readonly<{ running: boolean; startedAgo: number | null; endedAgo: number | null }>;
}>;

/** Which read transactions: all, those with a trade, those with an order placed or collected. */
export type TxKind = "any" | "trades" | "orders";

export type RecentQuery = Readonly<{
  kind: TxKind;
  /** Unix seconds: only what landed since (a transaction with no time counts); null — whatever its age. */
  since: number | null;
  limit: number;
  /** Misses after which a transaction counts as refused by the node. */
  tries: number;
}>;

/** Read transactions of a pool, newest first, and how many of the span are still not read (`refused` of them by the node). */
export type RecentTxs = Readonly<{ txs: readonly TapeTxRecords[]; pending: number; refused: number }>;

export type DayQuery = Readonly<{
  /** Unix seconds: the day's start — what landed since counts (a transaction with no time counts too). */
  since: number;
  tries: number;
  /** The pool's fee coin: the side of a collected order whose placing is not kept is told by its payout. */
  collectedIn: TapePool["collectedIn"];
}>;

/**
 * A pool's day counted where its rows are: how many read transactions of the span, whether one created the pool, the
 * oldest and newest time among them (unix seconds; null — none with a time), how many of the span are not read yet
 * (`refused` of them by the node), and the tally of their trades, orders and prices. `truncated` — the count stopped
 * short of the span's transactions.
 */
export type DayCount = Readonly<{
  transactions: number;
  created: boolean;
  oldest: number | null;
  newest: number | null;
  pending: number;
  refused: number;
  truncated: boolean;
  tally: DayTally;
}>;

export type FillsQuery = Readonly<{ collectedIn: TapePool["collectedIn"]; limit: number }>;

/** The newest transactions holding an order collected with a part filled, and the sides of the orders collected in them. */
export type FillsTxs = Readonly<{ txs: readonly TapeTxRecords[]; sides: ReadonlyMap<string, "ask" | "bid"> }>;

export type ProStore = Readonly<{
  /** Takes the network's lease for `ttlS` seconds unless another holds it or a step began less than `gapS` seconds ago. */
  take(network: ProPoolNetwork, holder: string, ttlS: number, gapS: number): Promise<boolean>;
  free(network: ProPoolNetwork, holder: string): Promise<void>;
  /** Every pool's state and the indexer's, in one read. */
  states(network: ProPoolNetwork): Promise<StoreStates>;
  /**
   * Writes transactions, the pools of `reset` emptied first. A listed one is kept unless known; a read or lost one
   * replaces what is not read yet; a read row never changes. False — the lease is not the holder's, nothing written.
   */
  putTxs(network: ProPoolNetwork, holder: string, txs: readonly StoredTx[], reset: readonly string[]): Promise<boolean>;
  putStates(network: ProPoolNetwork, holder: string, states: readonly PoolStateWrite[]): Promise<boolean>;
  recent(network: ProPoolNetwork, pool: string, query: RecentQuery): Promise<RecentTxs>;
  /**
   * A pool's day counted by the store itself, the records left where they are. Null — the store cannot count yet (its
   * function is not there): the caller counts from `recent`, as before.
   */
  day?(network: ProPoolNetwork, pool: string, query: DayQuery): Promise<DayCount | null>;
  /** A pool's filled orders as the store picks them. Null — it cannot yet: the caller reads `recent` orders, as before. */
  fills?(network: ProPoolNetwork, pool: string, query: FillsQuery): Promise<FillsTxs | null>;
  /** Transactions not read yet across the network's pools, newest first. */
  unread(network: ProPoolNetwork, limit: number): Promise<readonly PendingTx[]>;
  /** Lets go of transactions older than `days` (the newest `keep` of each pool stay) and of pools no longer written. */
  purge(network: ProPoolNetwork, holder: string, days: number, keep: number): Promise<number>;
}>;

/* ── the day from stored rows ────────────────────────────────────────────────────────────────────────────────────── */

export const dayStartOf = (now: number): number => Math.floor(now / 1000) - STATS_HOURS * 3600;

const inDay = (blockTime: number | null, dayStart: number): boolean => blockTime === null || blockTime >= dayStart;

/** The sides of the orders whose placing is among the transactions. */
export function sidesIn(txs: readonly TapeTxRecords[], into: Map<string, "ask" | "bid"> = new Map()): Map<string, "ask" | "bid"> {
  for (const tx of txs) for (const order of tx.placed) into.set(order.order, order.side);
  return into;
}

/**
 * A pool's day counted from its stored rows.
 *
 * Every read transaction of the day counts, wherever it stands among those not read yet: what traded in a transaction
 * read did trade inside the day, so the count is a true floor — and it only grows as more is read, since a read row
 * never changes. It falls only as old trades leave the day (or a coin's dollar price moves). The day is `whole` once
 * the node's list reaches back past its start (or the pool's creation is read) and nothing of it is left unread.
 *
 * Unlike a tape read in one run (`depthOf`), `depth.from` here is the oldest transaction counted, and transactions not
 * read yet may lie after it — `whole` is false then, and `stop` says why: `budget` — still to read, `node` — the node
 * refused what is left, or its list ends before the day's start.
 *
 * Null where nothing of an open day is read while some of it is still to read or to list: a pool not counted is never
 * a day of zeros.
 */
export function summaryOf(
  pool: TapePool,
  input: Readonly<{
    txs: readonly TapeTxRecords[];
    sides: ReadonlyMap<string, "ask" | "bid">;
    pending: number;
    refused: number;
    truncated: boolean;
    cursor: PoolCursor;
    checkedAt: number | null;
    /** When the newest transaction known otherwise landed — listed and not read yet, or older than the day. */
    newest?: number | null;
  }>,
  now: number,
): PoolSummary | null {
  const dayStart = dayStartOf(now);
  const txs = input.txs.filter((tx) => inDay(tx.moment.blockTime, dayStart));
  const created = input.txs.some((tx) => tx.created);
  return summaryOfCount(pool, { ...countOf(txs, input.sides, pool), created, pending: input.pending, refused: input.refused, truncated: input.truncated }, input, now);
}

/** The span's read transactions counted the way the database counts its rows (`public.pro_pool_day`). */
export function countOf(txs: readonly TapeTxRecords[], sides: ReadonlyMap<string, "ask" | "bid">, pool: Pick<TapePool, "coin" | "collectedIn">): Omit<DayCount, "pending" | "refused" | "truncated"> {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const tx of txs) {
    const at = tx.moment.blockTime;
    if (at === null) continue;
    if (oldest === null || at < oldest) oldest = at;
    if (newest === null || at > newest) newest = at;
  }
  return { transactions: txs.length, created: txs.some((tx) => tx.created), oldest, newest, tally: tallyOf(txs, sides, pool) };
}

/** A pool's day from its span counted — by the store (`ProStore.day`) or from its records (`summaryOf`). The rules of `summaryOf`. */
export function summaryOfCount(
  pool: TapePool,
  count: DayCount,
  input: Readonly<{ cursor: PoolCursor; checkedAt: number | null; newest?: number | null }>,
  now: number,
): PoolSummary | null {
  const dayStart = dayStartOf(now);
  const reached = input.cursor.tailTime !== null && input.cursor.tailTime < dayStart;
  const whole = (reached || count.created) && count.pending === 0 && !count.truncated;
  /* Not counted only while something is still to read or to list; a list that ended with nothing landed in the day is an empty day. */
  if (count.transactions === 0 && !whole && (count.pending > 0 || !input.cursor.end)) return null;
  const stop: TapeDepth["stop"] = whole
    ? reached
      ? "window"
      : "start"
    : count.pending > 0
      ? count.refused >= count.pending
        ? "node"
        : "budget"
      : count.truncated || !input.cursor.end
        ? "budget"
        : "node";
  const known = input.newest ?? null;
  const newest = count.newest === null ? known : known === null || count.newest > known ? count.newest : known;
  const depth: TapeDepth = {
    from: count.oldest === null ? null : new Date(count.oldest * 1000).toISOString(),
    checked: input.checkedAt === null ? null : new Date(input.checkedAt).toISOString(),
    transactions: count.transactions,
    whole,
    stop,
  };
  return { at: new Date(now).toISOString(), depth, stats: statsOfTally(pool, depth, count.tally, now), newest };
}

/* ── a store in memory ───────────────────────────────────────────────────────────────────────────────────────────── */

type Row = { pool: string; signature: string; slot: number; blockTime: number | null; state: StoredTx["state"]; misses: number; lostAt: number | null; records: TapeTxRecords | null; seenAt: number };
type Lease = { holder: string | null; until: number | null; startedAt: number | null; endedAt: number | null };

/** The side of each order placed among a pool's rows: its oldest placing's, as the database picks it. */
function sidesOf(rows: readonly Row[]): Map<string, "ask" | "bid"> {
  const sides = new Map<string, "ask" | "bid">();
  for (const row of [...rows].sort(newestFirst).reverse()) for (const order of row.records?.placed ?? []) if (!sides.has(order.order)) sides.set(order.order, order.side);
  return sides;
}

const kindOf = (records: TapeTxRecords, kind: TxKind): boolean => (kind === "any" ? true : kind === "trades" ? records.trades.length > 0 : records.placed.length > 0 || records.collects.length > 0);
const newestFirst = (a: Pick<Row, "slot" | "signature">, b: Pick<Row, "slot" | "signature">): number => b.slot - a.slot || (a.signature < b.signature ? 1 : a.signature > b.signature ? -1 : 0);

/** What of a pool's filled orders counts: a collect that filled whole or a part. */
const fillsAny = (records: TapeTxRecords, sides: ReadonlyMap<string, "ask" | "bid">, pool: Pick<TapePool, "coin" | "collectedIn">): boolean =>
  records.collects.some((collect) => {
    const state = fillOf(collect, pool, sides.get(collect.order)).state;
    return state === "filled" || state === "partial";
  });

/**
 * The store in memory, by the database's own rules — the functions of the migrations, statement for statement. One
 * process only: the tests' store, never a deployment's. `{ v1: true }` — the store before `pro_pool_day` and
 * `pro_pool_fills` were there: it answers them with null, and the callers go the old way.
 */
export function createMemoryProStore(clock: () => number = Date.now, options: Readonly<{ v1?: boolean }> = {}): ProStore {
  /** The transactions of each pool, by network and pool, then by signature. */
  const txs = new Map<string, Map<string, Row>>();
  const rowsOf = (network: string, pool: string): Map<string, Row> => {
    const at = `${network}:${pool}`;
    let own = txs.get(at);
    if (!own) txs.set(at, (own = new Map()));
    return own;
  };
  const everyRow = (network: string): Row[] => [...txs.entries()].filter(([at]) => at.startsWith(`${network}:`)).flatMap(([, own]) => [...own.values()]);
  const states = new Map<string, PoolStateWrite & { writtenAt: number }>();
  const leases = new Map<string, Lease>();
  const key = (network: string, pool: string, signature = "") => `${network}:${pool}:${signature}`;
  const held = (network: string, holder: string): boolean => {
    const lease = leases.get(network);
    return !!lease && lease.holder === holder && lease.until !== null && lease.until > clock();
  };
  const copy = <T,>(value: T): T => (value === null ? value : (JSON.parse(JSON.stringify(value)) as T));

  return {
    async take(network, holder, ttlS, gapS) {
      const now = clock();
      const lease = leases.get(network) ?? { holder: null, until: null, startedAt: null, endedAt: null };
      leases.set(network, lease);
      if (lease.until !== null && lease.until > now) return false;
      if (lease.startedAt !== null && lease.startedAt > now - gapS * 1000) return false;
      lease.holder = holder;
      lease.until = now + ttlS * 1000;
      lease.startedAt = now;
      return true;
    },

    async free(network, holder) {
      const lease = leases.get(network);
      if (!lease || lease.holder !== holder) return;
      lease.holder = null;
      lease.until = clock();
      lease.endedAt = clock();
    },

    async states(network) {
      const now = clock();
      const lease = leases.get(network);
      const pools = new Map<string, PoolState>();
      for (const [at, state] of states) {
        if (!at.startsWith(`${network}:`)) continue;
        const { writtenAt, ...rest } = state;
        pools.set(state.pool, { ...copy(rest), writtenAgo: now - writtenAt });
      }
      return {
        pools,
        step: {
          running: !!lease && lease.until !== null && lease.until > now,
          startedAgo: lease?.startedAt == null ? null : now - lease.startedAt,
          endedAgo: lease?.endedAt == null ? null : now - lease.endedAt,
        },
      };
    },

    async putTxs(network, holder, rows, reset) {
      if (!held(network, holder)) return false;
      const now = clock();
      for (const pool of reset) rowsOf(network, pool).clear();
      for (const tx of rows) {
        const own = rowsOf(network, tx.pool);
        const was = own.get(tx.signature);
        if (was) {
          if (was.state === "read" || tx.state === "unread") continue;
          was.state = tx.state;
          was.misses = tx.misses;
          was.lostAt = tx.state === "lost" ? now : null;
          was.records = tx.state === "read" ? copy(tx.records) : null;
          continue;
        }
        own.set(tx.signature, { pool: tx.pool, signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, state: tx.state, misses: tx.misses, lostAt: tx.state === "lost" ? now : null, records: tx.state === "read" ? copy(tx.records) : null, seenAt: now });
      }
      return true;
    },

    async putStates(network, holder, rows) {
      if (!held(network, holder)) return false;
      for (const row of rows) {
        const was = states.get(key(network, row.pool));
        states.set(key(network, row.pool), { ...copy(row), summary: copy(row.summary) ?? was?.summary ?? null, writtenAt: clock() });
      }
      return true;
    },

    async recent(network, pool, query) {
      const span = [...rowsOf(network, pool).values()].filter((row) => query.since === null || row.blockTime === null || row.blockTime >= query.since);
      const read = span.filter((row) => row.state === "read" && row.records !== null && kindOf(row.records, query.kind)).sort(newestFirst).slice(0, query.limit);
      const pending = span.filter((row) => row.state !== "read");
      return { txs: read.map((row) => copy(row.records!)), pending: pending.length, refused: pending.filter((row) => row.misses >= query.tries).length };
    },

    async day(network, pool, query) {
      if (options.v1) return null;
      const own = [...rowsOf(network, pool).values()];
      const span = own.filter((row) => row.blockTime === null || row.blockTime >= query.since);
      const txs = span.filter((row) => row.state === "read" && row.records !== null).sort(newestFirst).map((row) => copy(row.records!));
      const pending = span.filter((row) => row.state !== "read");
      const coin = { coin: "x" as const, collectedIn: query.collectedIn };
      return { ...countOf(txs, sidesOf(own), coin), pending: pending.length, refused: pending.filter((row) => row.misses >= query.tries).length, truncated: false };
    },

    async fills(network, pool, query) {
      if (options.v1) return null;
      const own = [...rowsOf(network, pool).values()];
      const sides = sidesOf(own);
      const coin = { coin: "x" as const, collectedIn: query.collectedIn };
      const txs = own
        .filter((row) => row.state === "read" && row.records !== null && fillsAny(row.records, sides, coin))
        .sort(newestFirst)
        .slice(0, query.limit)
        .map((row) => copy(row.records!));
      const collected = new Set(txs.flatMap((tx) => tx.collects.map((collect) => collect.order)));
      return { txs, sides: new Map([...sides].filter(([order]) => collected.has(order))) };
    },

    async unread(network, limit) {
      return everyRow(network)
        .filter((row) => row.state !== "read")
        .sort(newestFirst)
        .slice(0, limit)
        .map((row) => ({ pool: row.pool, signature: row.signature, slot: row.slot, blockTime: row.blockTime, state: row.state as "unread" | "lost", misses: row.misses, lostAt: row.lostAt }));
    },

    async purge(network, holder, days, keep) {
      if (!held(network, holder)) return 0;
      const before = clock() - Math.max(days, 2) * 86_400_000;
      let gone = 0;
      for (const [at, own] of txs) {
        if (!at.startsWith(`${network}:`)) continue;
        const old = [...own.values()].filter((row) => (row.blockTime === null ? row.seenAt : row.blockTime * 1000) < before);
        if (old.length === 0) continue;
        const edge = keep > 0 ? [...own.values()].sort(newestFirst)[keep - 1]?.slot : undefined;
        for (const row of old) {
          if (keep === 0 || (edge !== undefined && row.slot < edge)) {
            own.delete(row.signature);
            gone += 1;
          }
        }
      }
      for (const [at, state] of states) if (at.startsWith(`${network}:`) && state.writtenAt < before) states.delete(at);
      return gone;
    },
  };
}
