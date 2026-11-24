/**
 * The DLMM Pro pools' store in the database (`./store.ts`): one call to one `public.pro_pool_*` function per question,
 * each gated by the app secret and each one transaction
 * (`supabase/migrations/20261120150000_pro_pools_store_v1.sql`). Every instance and every cron pass reads and writes
 * the same rows. The transport is the server's usual one (`rpcResult`, which adds the secret); a test passes its own.
 *
 * A transport failure, a refusal or an answer that is not the function's own shape is `ProStoreUnavailable` — the
 * routes then answer from the instance's memory, as before the store was there.
 *
 * The day counted in the database and the filled orders it picks (`pro_pool_day`, `pro_pool_fills`,
 * `supabase/migrations/20261123120000_pro_pools_flags_v2.sql`) may not be there yet: a function the database does not
 * know is answered with null — the callers count from `pro_pool_txs_recent` as before — and is not asked again for
 * `MISSING_MS`.
 */

import type { ProPoolNetwork } from "./model.ts";
import { ProStoreUnavailable, type DayCount, type PendingTx, type PoolState, type PoolSummary, type ProStore } from "./store.ts";
import { isTapeDepth, type DayTally, type TapeTxRecords, type TwoRaw } from "./tape.ts";

export type ProStoreRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown>;

/** How long a function the database does not know is left alone before it is asked again, ms. */
export const MISSING_MS = 10 * 60_000;

/** The database does not know the function: PostgREST's «not in the schema cache», Postgres's own «does not exist». */
export const missingFunction = (error: string): boolean => /PGRST202|could not find the function|function .* does not exist/i.test(error);

const isRecord = (value: unknown): value is Answer => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A transaction's records as the function returns them, or null for anything that is not exactly one. */
export function recordsOfRow(value: unknown): TapeTxRecords | null {
  if (!isRecord(value) || !isRecord(value.moment) || typeof value.moment.signature !== "string" || typeof value.moment.slot !== "number") return null;
  if (!Array.isArray(value.trades) || !Array.isArray(value.placed) || !Array.isArray(value.collects)) return null;
  return value as unknown as TapeTxRecords;
}

function summaryOfRow(value: unknown): PoolSummary | null {
  if (!isRecord(value) || typeof value.at !== "string" || !isTapeDepth(value.depth) || !isRecord(value.stats)) return null;
  if (!isRecord(value.stats.volume) || !isRecord(value.stats.fees) || !isRecord(value.stats.trades) || !isRecord(value.stats.orders)) return null;
  return value as unknown as PoolSummary;
}

function stateOfRow(value: unknown): PoolState | null {
  if (!isRecord(value) || typeof value.pool !== "string") return null;
  return {
    pool: value.pool,
    summary: summaryOfRow(value.summary),
    cursor: { head: text(value.head), tail: text(value.tail), tailTime: num(value.tailTime), end: value.end === true },
    checkedAt: num(value.checkedAt),
    fails: num(value.fails) ?? 0,
    failedAt: num(value.failedAt),
    writtenAgo: num(value.writtenAgo) ?? Infinity,
  };
}

const DIGITS = /^\d{1,60}$/;
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const raw = (value: unknown): string | null => (typeof value === "string" && DIGITS.test(value) ? value : null);
const price = (value: unknown): number | null | undefined => (value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : undefined);

function twoOfRow(value: unknown): TwoRaw | null {
  if (!isRecord(value)) return null;
  const xRaw = raw(value.xRaw);
  const yRaw = raw(value.yRaw);
  return xRaw === null || yRaw === null ? null : { xRaw, yRaw };
}

/** A day's tally as `pro_pool_day` gives it, or null for anything that is not exactly one. */
export function tallyOfRow(value: unknown): DayTally | null {
  if (!isRecord(value) || !isRecord(value.fees)) return null;
  const counts = (["trades", "buys", "sells", "wallets", "filling", "placed", "filled", "partial", "unfilled", "unknown"] as const).map((name) => count(value[name]));
  const fees = (["total", "lp", "orders", "protocol", "referral", "partner"] as const).map((name) => twoOfRow((value.fees as Answer)[name]));
  const [coinRaw, quoteRaw] = [raw(value.coinRaw), raw(value.quoteRaw)];
  const [bonusPaid, referralPaid] = [twoOfRow(value.bonusPaid), twoOfRow(value.referralPaid)];
  const [priceFirst, priceLast] = [price(value.priceFirst), price(value.priceLast)];
  if (counts.some((one) => one === null) || fees.some((one) => one === null) || coinRaw === null || quoteRaw === null || !bonusPaid || !referralPaid || priceFirst === undefined || priceLast === undefined) return null;
  const [trades, buys, sells, wallets, filling, placed, filled, partial, unfilled, unknown] = counts as number[];
  const [total, lp, orders, protocol, referral, partner] = fees as TwoRaw[];
  return { trades, buys, sells, wallets, filling, coinRaw, quoteRaw, fees: { total, lp, orders, protocol, referral, partner }, placed, filled, partial, unfilled, unknown, bonusPaid, referralPaid, priceFirst, priceLast };
}

function dayOfAnswer(data: Answer): DayCount | null {
  const tally = tallyOfRow(data.tally);
  const [transactions, pending, refused] = [count(data.transactions), count(data.pending), count(data.refused)];
  const oldest = data.oldest === null ? null : num(data.oldest);
  const newest = data.newest === null ? null : num(data.newest);
  if (!tally || transactions === null || pending === null || refused === null || typeof data.created !== "boolean") return null;
  if ((data.oldest !== null && oldest === null) || (data.newest !== null && newest === null)) return null;
  return { transactions, created: data.created, oldest, newest, pending, refused, truncated: false, tally };
}

function pendingOfRow(value: unknown): PendingTx | null {
  if (!isRecord(value) || typeof value.pool !== "string" || typeof value.signature !== "string" || typeof value.slot !== "number") return null;
  if (value.state !== "unread" && value.state !== "lost") return null;
  return { pool: value.pool, signature: value.signature, slot: value.slot, blockTime: num(value.blockTime), state: value.state, misses: num(value.misses) ?? 0, lostAt: num(value.lostAt) };
}

export function createSupabaseProStore(rpc: ProStoreRpc, clock: () => number = Date.now): ProStore {
  /** Functions the database did not know, and until when they are not asked. */
  const missing = new Map<string, number>();
  async function call(fn: string, network: ProPoolNetwork, args: Answer): Promise<Answer> {
    const answer = await rpc(fn, { p_network: network, ...args });
    if (!answer.ok) throw new ProStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new ProStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new ProStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }
  /** A call to a function that may not be there yet: null where the database does not know it. */
  async function callNew(fn: string, network: ProPoolNetwork, args: Answer): Promise<Answer | null> {
    if ((missing.get(fn) ?? 0) > clock()) return null;
    const answer = await rpc(fn, { p_network: network, ...args });
    if (!answer.ok && missingFunction(answer.error)) {
      missing.set(fn, clock() + MISSING_MS);
      return null;
    }
    missing.delete(fn);
    if (!answer.ok) throw new ProStoreUnavailable(`${fn}: ${answer.error}`);
    if (!isRecord(answer.data)) throw new ProStoreUnavailable(`${fn}: no answer`);
    if (answer.data.ok !== true) throw new ProStoreUnavailable(`${fn}: ${String(answer.data.error ?? "refused")}`);
    return answer.data;
  }
  const flag = (data: Answer, name: string, fn: string): boolean => {
    if (typeof data[name] !== "boolean") throw new ProStoreUnavailable(`${fn}: unreadable`);
    return data[name];
  };

  return {
    async take(network, holder, ttlS, gapS) {
      return flag(await call("pro_pool_lease_take", network, { p_holder: holder, p_ttl_seconds: ttlS, p_gap_seconds: gapS }), "taken", "pro_pool_lease_take");
    },

    async free(network, holder) {
      await call("pro_pool_lease_free", network, { p_holder: holder });
    },

    async states(network) {
      const data = await call("pro_pool_states", network, {});
      if (!Array.isArray(data.pools)) throw new ProStoreUnavailable("pro_pool_states: unreadable");
      const pools = new Map<string, PoolState>();
      for (const row of data.pools) {
        const state = stateOfRow(row);
        if (state) pools.set(state.pool, state);
      }
      const step = isRecord(data.step) ? data.step : {};
      return { pools, step: { running: step.running === true, startedAgo: num(step.startedAgo), endedAgo: num(step.endedAgo) } };
    },

    async putTxs(network, holder, txs, reset) {
      return flag(await call("pro_pool_txs_put", network, { p_holder: holder, p_txs: txs, p_reset: reset.length > 0 ? reset : null }), "written", "pro_pool_txs_put");
    },

    async putStates(network, holder, states) {
      const rows = states.map((state) => ({ pool: state.pool, summary: state.summary, head: state.cursor.head, tail: state.cursor.tail, tailTime: state.cursor.tailTime, end: state.cursor.end, checkedAt: state.checkedAt, fails: state.fails, failedAt: state.failedAt }));
      return flag(await call("pro_pool_state_put", network, { p_holder: holder, p_states: rows }), "written", "pro_pool_state_put");
    },

    async recent(network, pool, query) {
      const data = await call("pro_pool_txs_recent", network, {
        p_pool: pool,
        p_kind: query.kind,
        p_since: query.since === null ? null : new Date(query.since * 1000).toISOString(),
        p_limit: query.limit,
        p_tries: query.tries,
      });
      const pending = num(data.pending);
      const refused = num(data.refused);
      if (!Array.isArray(data.txs) || pending === null || refused === null) throw new ProStoreUnavailable("pro_pool_txs_recent: unreadable");
      return { txs: data.txs.map(recordsOfRow).filter((records): records is TapeTxRecords => records !== null), pending, refused };
    },

    async day(network, pool, query) {
      const data = await callNew("pro_pool_day", network, { p_pool: pool, p_since: new Date(query.since * 1000).toISOString(), p_tries: query.tries, p_collected_in: query.collectedIn });
      if (data === null) return null;
      const day = dayOfAnswer(data);
      if (!day) throw new ProStoreUnavailable("pro_pool_day: unreadable");
      return day;
    },

    async fills(network, pool, query) {
      const data = await callNew("pro_pool_fills", network, { p_pool: pool, p_collected_in: query.collectedIn, p_limit: query.limit });
      if (data === null) return null;
      if (!Array.isArray(data.txs) || !isRecord(data.sides)) throw new ProStoreUnavailable("pro_pool_fills: unreadable");
      const sides = new Map<string, "ask" | "bid">();
      for (const [order, side] of Object.entries(data.sides)) if (side === "ask" || side === "bid") sides.set(order, side);
      return { txs: data.txs.map(recordsOfRow).filter((records): records is TapeTxRecords => records !== null), sides };
    },

    async unread(network, limit) {
      const data = await call("pro_pool_txs_unread", network, { p_limit: limit });
      if (!Array.isArray(data.txs)) throw new ProStoreUnavailable("pro_pool_txs_unread: unreadable");
      return data.txs.map(pendingOfRow).filter((tx): tx is PendingTx => tx !== null);
    },

    async purge(network, holder, days, keep) {
      const data = await call("pro_pool_purge", network, { p_holder: holder, p_days: days, p_keep: keep });
      return num(data.txs) ?? 0;
    },
  };
}
