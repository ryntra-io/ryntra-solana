/**
 * The indexer of the DLMM Pro pools' tape: the one reader of the node, writing what it reads into the database
 * (`./store.ts`) for every instance to answer from.
 *
 * One step, safe to run again at any point (every write is an upsert, a read row never changes):
 *
 * 1. **The lease.** Taken in the database for the network; while it is held — or where a step began less than `gapS`
 *    seconds ago — the step does nothing. So one indexer runs at a time whoever starts it (the cron every minute, or
 *    an answer that saw the count grow old), and the node's budget of reads holds for every instance together: a
 *    step reads at most half of `TAPE_LIMITS.readsPerMinute` and steps begin at least `gapS` apart, so no minute —
 *    wherever it starts — holds the reads of more than two steps.
 * 2. **The lists.** For each listed pool, deepest first, the node's list of its signatures from where the last step
 *    stopped (`PoolCursor`): what landed since, and an older page while the day counted is still open. A pool listed
 *    for the first time keeps its last `tapeMin` transactions too, so a quiet pool's page still shows its last trades.
 *    A node that does not list a pool is counted in the pool's row (`fails`) and does not stop the step.
 *    **Sparingly** (`listDue`): the node's key is the whole site's, and most pools are quiet. A pool that traded within
 *    the hour is listed every step; a quieter one every `quietEvery`; one with nothing in a day every `idleEvery`. A
 *    new pool, one that started over, and one whose day is still open are listed at once. The pace is read from the
 *    pool's own row — when it was last listed and when its newest transaction landed (`PoolSummary.newest`).
 * 3. **The reads.** What is listed and not read, within the budget, the day counted before anything older: first the
 *    newest `freshShare` of every pool, then the rest — the deepest pool's whole backlog, then the next one's. Each
 *    transaction through the venue's decoder and `recordsOf`, as ever. One the node does not give is counted in its
 *    row (`misses`) and asked again later. Ahead of all of it go the day's newest `firstShare` of every pool **not
 *    counted yet**, straight from its own list — so a pool is «counting» for a step or two, never while other pools'
 *    backlogs are read; and where the node refuses its transactions `tries` steps in a row, it is «unknown».
 * 4. **The counts.** The day of every pool that changed (or whose count grew old) is counted again from the database's
 *    rows of the last twenty-four hours — by the database itself where it can (`ProStore.day`, then `summaryOfCount`),
 *    else from the records it gives (`summaryOf`) — and written to the pool's row.
 * 5. **The broom.** Transactions older than `keepDays` are let go (the last `tapeMin` of each pool stay).
 *
 * Reads only: nothing here signs or sends, and no key is held.
 */

import type { EarnProNetwork } from "../earn-pro/gate.ts";
import type { ProPoolRow } from "./model.ts";
import { dayStartOf, sidesIn, summaryOf, summaryOfCount, type PendingTx, type PoolCursor, type PoolState, type PoolStateWrite, type PoolSummary, type ProStore, type StoredTx } from "./store.ts";
import { recordsOf, tapePoolOf, type TapePool } from "./tape.ts";
import { TAPE_LIMITS, withTimeout, type TapeListing, type TapeSource } from "./tape.server.ts";

export type IndexerLimits = Readonly<{
  /** Pools indexed, the deepest first — as many as the pools' table shows the day of. */
  pools: number;
  /** Signatures in one call of the list (the node's most is 1 000). */
  page: number;
  /** Pages asked at most to join what landed since the last step with what is known; past that the pool starts over. */
  bridgePages: number;
  /** Older pages asked in one step while a pool's day is still open. */
  olderPages: number;
  /** A pool whose newest transaction landed within this many seconds is listed every step. */
  activeS: number;
  /** How often a pool quieter than that is listed, ms; and one with no transaction in a day. */
  quietEvery: number;
  idleEvery: number;
  /** The newest transactions of a pool kept whatever their age. */
  tapeMin: number;
  /** Of a pool's unread, how many are read before any pool's backlog. */
  freshShare: number;
  /** Of a pool not counted yet, how many of the day's newest are read before anything else. */
  firstShare: number;
  /** Transactions one step reads from the node at most: half the minute's budget (the module's header). */
  readsPerStep: number;
  /** Calls to the node at once. */
  concurrency: number;
  /** Misses after which a transaction is the node's refusal: asked again only after a while, longer each time. */
  tries: number;
  lostRetry: number;
  /** How long one call to the node may take, ms. */
  timeout: number;
  /** How long a step may take, ms, and how much of it is left for counting. */
  time: number;
  countTime: number;
  /** The lease: how long it holds if the step dies, and the least time between two steps' beginnings, seconds. */
  leaseS: number;
  gapS: number;
  /** Unread transactions looked at in one step. */
  pending: number;
  /** Transactions of one pool's day counted at most where the server counts them itself; past that the day is a floor. */
  kept: number;
  /** A pool that did not change is counted again after this long, ms: old trades leave the day, prices move. */
  recount: number;
  /** Days a transaction is kept. */
  keepDays: number;
  /** Rows in one write. */
  batch: number;
}>;

export const INDEXER_LIMITS: IndexerLimits = Object.freeze({
  pools: 64,
  page: 1_000,
  bridgePages: 10,
  olderPages: 2,
  activeS: 3_600,
  quietEvery: 10 * 60_000,
  idleEvery: 30 * 60_000,
  tapeMin: 100,
  freshShare: 20,
  firstShare: 3,
  readsPerStep: Math.floor(TAPE_LIMITS.readsPerMinute / 2),
  concurrency: 6,
  tries: 3,
  lostRetry: 120_000,
  timeout: 10_000,
  time: 45_000,
  countTime: 12_000,
  leaseS: 90,
  gapS: 50,
  pending: 5_000,
  kept: 5_000,
  recount: 120_000,
  keepDays: 3,
  batch: 60,
});

export type StepReport = Readonly<{
  /** Whether the step ran; where not, why: the lease is another's, the store or the pools' list did not answer. */
  ran: boolean;
  reason?: "lease" | "store" | "pools";
  /** The lease was taken: this step was the one indexer of its moment. */
  leased: boolean;
  pools: number;
  /** Calls of the node's list of signatures, and the pools it did not list. */
  lists: number;
  unlisted: number;
  /** Transactions the lists brought. */
  listed: number;
  read: number;
  lost: number;
  counted: number;
  purged: number;
  ms: number;
}>;

/**
 * A step in one line of the function's log — that the indexer runs, how long, and what it asked of the node: lists of
 * signatures (`lists`) and transactions (`reads`). Counts only: no address, no signature, nothing of the environment.
 */
export function stepLine(network: string, report: StepReport): string {
  const said = report.ran ? "ran" : `skipped:${report.reason ?? "unknown"}`;
  return `pro-pools step ${said} network=${network} lease=${report.leased ? "taken" : "no"} ms=${report.ms} pools=${report.pools} lists=${report.lists} unlisted=${report.unlisted} listed=${report.listed} reads=${report.read + report.lost} lost=${report.lost} counted=${report.counted} purged=${report.purged}`;
}

/** The lease went to another indexer mid-step: this one stops writing. */
class LeaseLost extends Error {}

type Work = {
  row: ProPoolRow;
  pool: TapePool;
  cursor: PoolCursor;
  checkedAt: number | null;
  fails: number;
  failedAt: number | null;
  listed: Map<string, StoredTx>;
  reset: boolean;
  changed: boolean;
  was: PoolSummary | null;
  summary: PoolSummary | null;
  /** When the pool's newest known transaction landed, unix seconds. */
  newest: number | null;
  /** In this step: the node listed the pool; it did not; it did not give a transaction of the pool. */
  listedNow: boolean;
  listFailed: boolean;
  refused: boolean;
};

const DAY_S = 86_400;

/**
 * Whether a pool's list is asked of the node in a step that begins at `now` — the node's key is spent on the pools that
 * trade, not on the many that do not:
 *
 * - at once: a pool with no row, one not listed or not counted yet (until the node has refused it `tries` times in a
 *   row), one whose day is still open (older pages, a backlog — a pool that started over is such), and one counted
 *   before `newest` was kept;
 * - every step: a pool whose newest transaction landed within `activeS`;
 * - every `quietEvery`: a quieter pool, and one the node keeps refusing to list;
 * - every `idleEvery`: a pool with no transaction in a day.
 *
 * The interval runs from the last time the node was asked for the pool, answered or not.
 */
export function listDue(state: Pick<PoolState, "summary" | "cursor" | "checkedAt" | "fails" | "failedAt"> | undefined, now: number, limits: Pick<IndexerLimits, "activeS" | "quietEvery" | "idleEvery" | "tries">): boolean {
  if (!state) return true;
  const asked = Math.max(state.checkedAt ?? -Infinity, state.failedAt ?? -Infinity);
  const { summary } = state;
  if (!summary || state.cursor.head === null) return state.fails < limits.tries || now - asked >= limits.quietEvery;
  /* A day open for want of lists or reads; one open because the node refuses what is left gains nothing from a list. */
  if ((!summary.depth.whole && summary.depth.stop !== "node") || summary.newest === undefined) return true;
  const quiet = summary.newest === null ? Infinity : now / 1000 - summary.newest;
  if (quiet < limits.activeS) return true;
  return now - asked >= (quiet < DAY_S ? limits.quietEvery : limits.idleEvery);
}

const landed = (listing: TapeListing): boolean => listing.err === null;
const unreadOf = (pool: string, listing: TapeListing): StoredTx => ({ pool, signature: listing.signature, slot: listing.slot, blockTime: listing.blockTime ?? null, state: "unread", misses: 0, records: null });

/** Runs `job` over the items, a few at a time, in their order. */
async function pooled<T>(items: readonly T[], concurrency: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await job(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Whether a transaction not read may be asked of the node now: never refused for good, only waited with longer each time. */
export function readable(tx: PendingTx, now: number, limits: Pick<IndexerLimits, "tries" | "lostRetry">): boolean {
  if (tx.misses < limits.tries) return true;
  const wait = Math.min(limits.lostRetry * 2 ** (tx.misses - limits.tries), 3_600_000);
  return tx.lostAt === null || now - tx.lostAt >= wait;
}

/**
 * The order of a step's reads, at most `most` in all: the newest `share` of every pool first, in the pools' order;
 * then what is left — the first pool's whole backlog, then the next one's. All of it for what landed since `dayStart`
 * (unix seconds) before any of it for what is older. `pending` is newest first.
 */
export function planReads(pending: readonly PendingTx[], order: readonly string[], share: number, most: number, dayStart: number): readonly PendingTx[] {
  const plan = (txs: readonly PendingTx[]): PendingTx[] => {
    const byPool = new Map<string, PendingTx[]>();
    for (const tx of txs) byPool.set(tx.pool, [...(byPool.get(tx.pool) ?? []), tx]);
    const fresh: PendingTx[] = [];
    const deep: PendingTx[] = [];
    for (const pool of order) {
      const own = byPool.get(pool) ?? [];
      fresh.push(...own.slice(0, share));
      deep.push(...own.slice(share));
    }
    return [...fresh, ...deep];
  };
  const today = (tx: PendingTx): boolean => tx.blockTime === null || tx.blockTime >= dayStart;
  return [...plan(pending.filter(today)), ...plan(pending.filter((tx) => !today(tx)))].slice(0, most);
}

export type IndexerDeps = Readonly<{
  network: EarnProNetwork;
  store: ProStore;
  source: TapeSource;
  /** The network's pools, deepest first; throws where the chain did not answer. */
  pools: () => Promise<readonly ProPoolRow[]>;
  limits?: IndexerLimits;
  clock?: () => number;
  holder?: string;
}>;

const holderId = (): string => `idx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** One step of the indexer (the module's header). Never throws: what went wrong is in the report. */
export async function indexerStep(deps: IndexerDeps): Promise<StepReport> {
  const { network, store, source } = deps;
  const limits = deps.limits ?? INDEXER_LIMITS;
  const clock = deps.clock ?? Date.now;
  const holder = deps.holder ?? holderId();
  const start = clock();
  const deadline = start + limits.time;
  const report = { ran: false as boolean, reason: undefined as StepReport["reason"], leased: false as boolean, pools: 0, lists: 0, unlisted: 0, listed: 0, read: 0, lost: 0, counted: 0, purged: 0 };
  const done = (): StepReport => ({ ...report, ms: clock() - start });

  try {
    if (!(await store.take(network, holder, limits.leaseS, limits.gapS))) return { ...done(), reason: "lease" };
  } catch {
    return { ...done(), reason: "store" };
  }
  report.leased = true;

  try {
    let rows: readonly ProPoolRow[];
    try {
      rows = (await deps.pools()).slice(0, limits.pools);
    } catch {
      return { ...done(), reason: "pools" };
    }
    const states = await store.states(network);
    const works = rows.map((row) => workOf(row, states.pools.get(row.address)));
    const byAddress = new Map(works.map((work) => [work.pool.address, work]));
    report.pools = works.length;

    /* 2. The lists — of the pools whose list is due. */
    const due = works.filter((work) => listDue(states.pools.get(work.pool.address), start, limits));
    await pooled(due, limits.concurrency, async (work) => {
      if (clock() >= deadline) return;
      await listPool(work);
    });
    const listed = works.flatMap((work) => [...work.listed.values()]);
    const reset = works.filter((work) => work.reset).map((work) => work.pool.address);
    report.listed = listed.length;
    report.unlisted = works.filter((work) => work.listFailed).length;
    for (let at = 0; at < listed.length || (at === 0 && reset.length > 0); at += 1_000) await write(listed.slice(at, at + 1_000), at === 0 ? reset : []);

    /*
     * 3. The reads. A pool not counted yet goes first, straight from its own list: the store gives what is unread
     * newest first across every pool, so a pool whose only transactions are the day's oldest would wait behind every
     * other pool's backlog — and stand «counting» all that while.
     */
    const dayStart = dayStartOf(start);
    const everyUnread = await store.unread(network, limits.pending);
    const unread = everyUnread.filter((tx) => byAddress.has(tx.pool));
    const known = new Map(unread.map((tx) => [`${tx.pool}:${tx.signature}`, tx]));
    /* Where the store gave all that is unread, a listed transaction not among it is read already. */
    const cut = everyUnread.length >= limits.pending;
    const first: PendingTx[] = works
      .filter((work) => work.was === null)
      .flatMap((work) =>
        [...work.listed.values()]
          .filter((tx) => (tx.blockTime === null || tx.blockTime >= dayStart) && (cut || known.has(`${tx.pool}:${tx.signature}`)))
          .slice(0, limits.firstShare)
          .map((tx): PendingTx => known.get(`${tx.pool}:${tx.signature}`) ?? { pool: tx.pool, signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, state: "unread", misses: 0, lostAt: null }),
      );
    const taken = new Set(first.map((tx) => `${tx.pool}:${tx.signature}`));
    const pending = unread.filter((tx) => !taken.has(`${tx.pool}:${tx.signature}`) && readable(tx, start, limits));
    const plan = [...first, ...planReads(pending, works.map((work) => work.pool.address), limits.freshShare, limits.readsPerStep, dayStart)].slice(0, limits.readsPerStep);
    const readUntil = deadline - limits.countTime;
    for (let at = 0; at < plan.length && clock() < readUntil; at += limits.batch) {
      const results: StoredTx[] = [];
      await pooled(plan.slice(at, at + limits.batch), limits.concurrency, async (tx) => {
        if (clock() >= readUntil) return;
        results.push(await readTx(tx, byAddress.get(tx.pool)!));
      });
      await write(results, []);
    }

    /* 4. The counts: the pools that changed first, then those whose count grew old. */
    const stale = works.filter((work) => work.changed || work.was === null || start - Date.parse(work.was.at) >= limits.recount).sort((a, b) => Number(b.changed) - Number(a.changed));
    await pooled(stale, limits.concurrency, (work) => (clock() < deadline ? count(work) : Promise.resolve()));
    works.forEach(settle);
    const writes: PoolStateWrite[] = works.map((work) => ({ pool: work.pool.address, summary: work.summary, cursor: work.cursor, checkedAt: work.checkedAt, fails: work.fails, failedAt: work.failedAt }));
    if (!(await store.putStates(network, holder, writes))) throw new LeaseLost();

    /* 5. The broom. */
    report.purged = await store.purge(network, holder, limits.keepDays, limits.tapeMin);
    report.ran = true;
    return done();
  } catch (error) {
    /* What was written stands and the next step goes on from it. */
    return { ...done(), reason: error instanceof LeaseLost ? "lease" : "store" };
  } finally {
    await store.free(network, holder).catch(() => undefined);
  }

  function workOf(row: ProPoolRow, state: PoolState | undefined): Work {
    return {
      row,
      pool: tapePoolOf(row),
      cursor: state?.cursor ?? { head: null, tail: null, tailTime: null, end: false },
      checkedAt: state?.checkedAt ?? null,
      fails: state?.fails ?? 0,
      failedAt: state?.failedAt ?? null,
      listed: new Map(),
      reset: false,
      changed: false,
      was: state?.summary ?? null,
      summary: null,
      newest: state?.summary?.newest ?? null,
      listedNow: false,
      listFailed: false,
      refused: false,
    };
  }

  /**
   * The node's refusals in a row, after the step: a list it did not give; or, for a pool never counted, transactions
   * it did not give — so that such a pool ends «unknown» after `tries` steps and never stands «counting» for good. A
   * pool listed and counted starts again from none; a pool the step's own budget or time did not reach keeps its count.
   */
  function settle(work: Work): void {
    const counted = work.summary !== null || work.was !== null;
    if (work.listFailed || (!counted && work.refused)) {
      work.fails += 1;
      work.failedAt = start;
    } else if (work.listedNow && counted) work.fails = 0;
  }

  async function write(txs: readonly StoredTx[], reset: readonly string[]): Promise<void> {
    if (txs.length === 0 && reset.length === 0) return;
    if (!(await store.putTxs(network, holder, txs, reset))) throw new LeaseLost();
  }

  /** The node's list of a pool from its cursor on; a node that does not answer is counted in the pool's row. */
  async function listPool(work: Work): Promise<void> {
    const address = work.pool.address;
    const dayStart = dayStartOf(start);
    const list = (options: Readonly<{ before?: string; until?: string }>) => {
      report.lists += 1;
      return withTimeout(source.list(address, { limit: limits.page, ...options }), limits.timeout);
    };
    const keep = (listing: TapeListing) => {
      if (!landed(listing)) return;
      work.listed.set(listing.signature, unreadOf(address, listing));
      if (listing.blockTime !== null && (work.newest === null || listing.blockTime > work.newest)) work.newest = listing.blockTime;
    };
    const inDay = (listing: TapeListing) => listing.blockTime === null || listing.blockTime >= dayStart;
    /** A run listed from now back, joined to nothing known: the day's part of it, and its newest `tapeMin`. */
    const begin = (run: readonly TapeListing[], end: boolean) => {
      const last = run.at(-1)!;
      work.cursor = { head: run[0]!.signature, tail: last.signature, tailTime: last.blockTime ?? null, end };
      run.filter(landed).forEach((listing, index) => {
        if (index < limits.tapeMin || inDay(listing)) keep(listing);
      });
    };
    try {
      /* A pool never listed — and one listed but not counted yet, whose newest transactions are then read at once. */
      if (work.cursor.head === null || (work.was === null && work.fails < limits.tries)) {
        const head = await list({});
        if (head.length === 0) throw new Error("The node lists nothing of the pool.");
        begin(head, head.length < limits.page);
      } else {
        const run = [...(await list({ until: work.cursor.head }))];
        let joined = run.length < limits.page;
        let pages = 1;
        for (; !joined && pages < limits.bridgePages && clock() < deadline; pages += 1) {
          const more = await list({ before: run.at(-1)!.signature, until: work.cursor.head });
          run.push(...more);
          joined = more.length < limits.page;
        }
        if (run.length > 0 && joined) {
          work.cursor = { ...work.cursor, head: run[0]!.signature };
          run.forEach(keep);
        } else if (run.length > 0 && pages >= limits.bridgePages) {
          /* More landed than a step may join to what is known: the pool starts over from now, as a new one. */
          work.reset = true;
          begin(run, false);
        }
        /* Out of the step's time before it joined: nothing is kept, and the next step lists from the same place. */
      }
      /* An older page while the day is still open. */
      for (let page = 0; page < limits.olderPages && clock() < deadline; page += 1) {
        const { tail, tailTime, end } = work.cursor;
        if (end || tail === null || (tailTime !== null && tailTime < dayStart)) break;
        const older = await list({ before: tail });
        const last = older.at(-1);
        work.cursor = { ...work.cursor, ...(last ? { tail: last.signature, tailTime: last.blockTime ?? null } : {}), end: older.length < limits.page };
        older.filter(inDay).forEach(keep);
      }
      work.checkedAt = start;
      work.listedNow = true;
    } catch {
      work.listFailed = true;
    }
    if (work.listed.size > 0 || work.reset) work.changed = true;
  }

  /** One transaction read from the node and decoded; one the node does not give is a miss, counted. */
  async function readTx(tx: PendingTx, work: Work): Promise<StoredTx> {
    work.changed = true;
    const moment = { signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime };
    try {
      const events = await withTimeout(source.events(tx.signature), limits.timeout);
      if (events !== null) {
        report.read += 1;
        return { pool: tx.pool, ...moment, state: "read", misses: tx.misses, records: recordsOf(moment, events, work.pool) };
      }
    } catch {
      /* Counted below. */
    }
    report.lost += 1;
    work.refused = true;
    return { pool: tx.pool, ...moment, state: "lost", misses: tx.misses + 1, records: null };
  }

  /**
   * A pool's day counted from the database's rows of the last twenty-four hours: by the database itself
   * (`ProStore.day`), the records left where they are; where it cannot count yet, from the records it gives, as before.
   */
  async function count(work: Work): Promise<void> {
    const now = clock();
    const address = work.pool.address;
    const since = dayStartOf(now);
    const counted = store.day ? await store.day(network, address, { since, tries: limits.tries, collectedIn: work.pool.collectedIn }) : null;
    if (counted) {
      work.summary = summaryOfCount(work.pool, counted, { cursor: work.cursor, checkedAt: work.checkedAt, newest: work.newest }, now);
    } else {
      const day = await store.recent(network, address, { kind: "any", since, limit: limits.kept, tries: limits.tries });
      const sides = sidesIn(day.txs);
      /* The side of an order collected today may be in its placing, days ago. */
      if (day.txs.some((tx) => tx.collects.some((collect) => !sides.has(collect.order)))) {
        const orders = await store.recent(network, address, { kind: "orders", since: null, limit: limits.kept, tries: limits.tries });
        const older = sidesIn(orders.txs);
        for (const [order, side] of older) if (!sides.has(order)) sides.set(order, side);
      }
      work.summary = summaryOf(work.pool, { txs: day.txs, sides, pending: day.pending, refused: day.refused, truncated: day.txs.length >= limits.kept, cursor: work.cursor, checkedAt: work.checkedAt, newest: work.newest }, now);
    }
    if (work.summary) report.counted += 1;
  }
}
