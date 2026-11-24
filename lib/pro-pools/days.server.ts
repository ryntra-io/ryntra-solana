/**
 * The day of every listed DLMM Pro pool at once — what the pools' table shows in its «Volume 24h» and «Fees 24h» —
 * counted by the instance itself. **The spare path**: the table answers from the database (`./answers.server.ts`),
 * and from here only where the database does not answer.
 *
 * One answer for the whole table (`/api/pro/pools/days`) in place of one read per row: every row read on its own spent
 * the node in bursts (a list and up to a hundred transactions per pool, all pools at once), the node refused part of
 * them, and the table stood with holes.
 *
 * - **Kept.** A pool's day is counted at most once per `fresh` (five minutes — a «last 24 hours» figure moves little in
 *   that time) however many people look; between counts it is served as kept, with the moment it was counted. A day
 *   only partly read (a busy pool, the budget spent) is counted again on the next refresh, sooner than `fresh`.
 * - **Refreshed behind the answer.** A refresh starts when some pool is due, at most one at a time and at most every
 *   `gap` — every `retry` while some pool is still counting; it counts the pools a few at a time (`concurrency`) within
 *   `time`. A pool it did not reach is answered «counting» and goes first next time — it never fails the answer. A pool
 *   the node did not answer for keeps its last count; with none it is «counting», and after `tries` failed counts in a
 *   row «unknown» — an honest end, asked again only past `fresh`, never an endless «counting».
 * - **Cheap.** The count reads the day alone (`readProTape(…, "day")`): a quiet pool costs one list of its signatures
 *   and no transaction, a busy one a share of the minute's budget in a refresh's first pass (so the deepest pools do
 *   not leave the rest with nothing); a second pass then gives what is left of the budget and the time to the days
 *   read only in part, the deepest first. A transaction is read once in the life of the process.
 * - **Cold.** Only an instance with no count at all waits for its first refresh, at most `wait`.
 *
 * Reads only: nothing here signs or sends, and no key is held.
 */

import type { EarnProNetwork } from "../earn-pro/gate.ts";
import type { ProPoolRow } from "./model.ts";
import { statsOf, tapePoolOf, type ProDayEntry, type ProDaysAnswer, type TapePool, type TapeView } from "./tape.ts";
import { deepenProDay, readProTape, TapeUnavailable } from "./tape.server.ts";

export type DaysLimits = Readonly<{
  /** How long one pool's count stays, ms. */
  fresh: number;
  /** The least time between two refreshes of the process, ms. */
  gap: number;
  /** The least time between two refreshes while some pool is still counting, ms. */
  retry: number;
  /** Failed counts in a row after which a pool never counted is «unknown». */
  tries: number;
  /** Pools counted at once. */
  concurrency: number;
  /** How long one refresh may spend, ms. */
  time: number;
  /** How long an answer with no count at all waits for the first refresh, ms. */
  wait: number;
  /** The most pools counted, the deepest first. */
  pools: number;
}>;

export const DAYS_LIMITS: DaysLimits = Object.freeze({
  fresh: 5 * 60_000,
  gap: 30_000,
  retry: 10_000,
  tries: 3,
  concurrency: 3,
  time: 20_000,
  wait: 10_000,
  pools: 64,
});

type Counted = Readonly<{ at: number; entry: Extract<ProDayEntry, { state: "ready" }> }>;
/** A pool's failed counts in a row, and when the last one was. */
type Failed = Readonly<{ count: number; at: number }>;

/**
 * Reads one pool's day: the server's reader of the network, or a test's own. `deeper` — the second pass of a refresh:
 * no new list, more of the day from what is left of the minute's budget.
 */
export type DayRead = (pool: TapePool, now: number, deeper?: boolean) => Promise<TapeView>;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** The refresh's own time ran out: not the pool's failure. */
const OUT_OF_TIME = Symbol("out of time");

/** A keeper of the pools' days over a reader, with its own memory and clock. */
export function createDaysKeeper(readDay: DayRead, limits: DaysLimits = DAYS_LIMITS, clock: () => number = Date.now) {
  const counted = new Map<string, Counted>();
  const failed = new Map<string, Failed>();
  let running: Promise<void> | null = null;
  let startedAt = -Infinity;

  /** Never counted, and failed `tries` times in a row: «unknown» until it is asked again. */
  const unknown = (address: string): boolean => !counted.has(address) && (failed.get(address)?.count ?? 0) >= limits.tries;
  const counting = (address: string): boolean => !counted.has(address) && !unknown(address);

  /** A pool to count again: still counting, past `fresh`, a day only partly read past `gap`, or «unknown» past `fresh`. */
  const due = (row: ProPoolRow, now: number): boolean => {
    const kept = counted.get(row.address);
    if (!kept) return unknown(row.address) ? now - failed.get(row.address)!.at >= limits.fresh : true;
    const age = now - kept.at;
    return age >= limits.fresh || (!kept.entry.stats.whole && age >= limits.gap);
  };

  async function refresh(rows: readonly ProPoolRow[]): Promise<void> {
    const start = clock();
    const deadline = start + limits.time;
    /*
     * Never counted first — the fewest failures, then the longest unasked, so the line moves on with every refresh and
     * a pool that keeps failing does not stand at its head — then a day only partly read, then the oldest count, then
     * the «unknown» ones asked again.
     */
    const rank = (row: ProPoolRow) => {
      const kept = counted.get(row.address);
      return kept ? (kept.entry.stats.whole ? 2 : 1) : unknown(row.address) ? 3 : 0;
    };
    const since = (row: ProPoolRow) => counted.get(row.address)?.at ?? failed.get(row.address)?.at ?? -Infinity;
    const todo = rows
      .filter((row) => due(row, start))
      .map((row, at) => ({ row, at }))
      .sort((a, b) => rank(a.row) - rank(b.row) || (failed.get(a.row.address)?.count ?? 0) - (failed.get(b.row.address)?.count ?? 0) || since(a.row) - since(b.row) || a.at - b.at)
      .map(({ row }) => row);
    /** One pool's day, counted; past the refresh's time the answer stops waiting — the reader still keeps what it reads. */
    const count = async (row: ProPoolRow, deeper: boolean): Promise<void> => {
      const now = clock();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const view = await Promise.race([
          readDay(tapePoolOf(row), now, deeper),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(OUT_OF_TIME), Math.max(0, deadline - now));
          }),
        ]);
        counted.set(row.address, { at: now, entry: { pool: row.address, state: "ready", at: new Date(now).toISOString(), depth: view.depth, stats: statsOf(view, now) } });
        failed.delete(row.address);
      } catch (error) {
        /*
         * The node did not answer: the last count stands, and the failures are counted. Our own time or budget is not
         * the pool's failure — it stays «counting» and goes first next time.
         */
        const ours = error === OUT_OF_TIME || (error instanceof TapeUnavailable && error.reason === "budget");
        if (!ours && !deeper) failed.set(row.address, { count: (failed.get(row.address)?.count ?? 0) + 1, at: now });
      } finally {
        clearTimeout(timer);
      }
    };
    /* First pass: every due pool, a share of the budget each, so the line reaches them all. */
    let next = 0;
    const worker = async () => {
      while (next < todo.length && clock() < deadline) await count(todo[next++]!, false);
    };
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, todo.length) }, worker));
    /* Second pass: what is left of the time and of the minute's budget goes deeper into the days read only in part, the deepest pool first. */
    for (const row of rows) {
      if (clock() >= deadline) break;
      const kept = counted.get(row.address);
      if (kept && kept.at >= start && !kept.entry.stats.whole) await count(row, true);
    }
    /* Pools no longer listed are let go. */
    const listed = new Set(rows.map((row) => row.address));
    for (const address of counted.keys()) if (!listed.has(address)) counted.delete(address);
    for (const address of failed.keys()) if (!listed.has(address)) failed.delete(address);
  }

  /**
   * Every listed pool's day as kept, the deepest `pools` of them; and the refresh started for those due, if any — the
   * route keeps it alive past the answer. Only where nothing at all is counted does the answer wait, at most `wait`.
   */
  async function read(rows: readonly ProPoolRow[], now: number = clock()): Promise<Readonly<{ days: readonly ProDayEntry[]; refresh: Promise<void> | null }>> {
    const listed = rows.slice(0, limits.pools);
    const wait = listed.some((row) => counting(row.address)) ? limits.retry : limits.gap;
    if (running === null && now - startedAt >= wait && listed.some((row) => due(row, now))) {
      startedAt = now;
      running = refresh(listed).finally(() => {
        running = null;
      });
    }
    const refreshing = running;
    if (refreshing && listed.length > 0 && listed.every((row) => !counted.has(row.address))) await Promise.race([refreshing, sleep(limits.wait)]);
    const days = listed.map((row): ProDayEntry => counted.get(row.address)?.entry ?? { pool: row.address, state: unknown(row.address) ? "unknown" : "counting", at: null });
    return { days, refresh: refreshing };
  }

  return { read, size: () => counted.size };
}

export type DaysKeeper = ReturnType<typeof createDaysKeeper>;

const keepers = new Map<EarnProNetwork, DaysKeeper>();

/** Every listed pool's day on a network, from the process's one keeper of that network. */
export async function readProDays(network: EarnProNetwork, rows: readonly ProPoolRow[], now: number = Date.now()): Promise<Readonly<{ answer: ProDaysAnswer; refresh: Promise<void> | null }>> {
  let keeper = keepers.get(network);
  if (!keeper) {
    keeper = createDaysKeeper((pool, at, deeper) => (deeper ? deepenProDay(network, pool, at) : readProTape(network, pool, at, "day")));
    keepers.set(network, keeper);
  }
  const { days, refresh } = await keeper.read(rows, now);
  return { answer: { network, at: new Date(Date.now()).toISOString(), fresh: DAYS_LIMITS.fresh / 1000, days }, refresh };
}
