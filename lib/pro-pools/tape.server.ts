/**
 * The reader behind a DLMM Pro pool's tape (`./tape.ts`): the pool's transactions listed by the node, each
 * read once and decoded by the venue, kept in the process.
 *
 * - **List.** `getSignaturesForAddress` of the pool's own account, newest first: every swap, order and position of the
 *   pool names it, a router's swap through it too. The head is listed again from the newest signature known; an older
 *   page only once everything listed is read and the tape still needs older. A failed transaction is passed over.
 * - **Read.** Each signature once, `getTransaction` through the venue (`events.read`, which reads a transaction of any
 *   version and its inner instructions — the events are there, not in the log), newest first, a few at a time. Only
 *   through earning's one door to the venue (`lib/earn-pro/venue.server.ts`), which asks the gate first.
 * - **Keep.** A landed transaction never changes, so a read one is kept for the life of the process, as long as the
 *   tape needs it: the day counted (`STATS_HOURS`) and at least `tapeMin` transactions, so a quiet pool still shows its
 *   last trades. Older ones are let go.
 *
 * **Budgets**, so that nobody's curiosity spends the node: a pool is read again at most every `fresh` milliseconds
 * however many ask; one read reads at most `readsPerRefresh` transactions, within `time`; the whole process at most
 * `readsPerMinute`; at most `pools` pools are kept, the least recently asked let go first. A busy pool's day is
 * therefore reached over several reads, and until then the tape says how deep it is (`TapeDepth`) rather than
 * counting a part as the whole.
 *
 * **Two scopes.** A `tape` read (the pool's page: its trades and fills) needs the day and at least `tapeMin`
 * transactions; a `day` read (the day of many pools at once, `./days.server.ts`) needs only what landed inside the day,
 * so a quiet pool costs one list and no transaction at all. Each scope is fresh on its own; a `tape` read is a `day`
 * read too. What a read let go of is decided by the `tape` scope either way, so a day read never drops a pool's tape.
 *
 * **The node silent is a refusal, never zeros:** a list the node does not give, or nothing read at all of a day that is
 * not known to be empty, throws `TapeUnavailable` — unless the pool's last list is younger than `stale`, which is then
 * served as it stands, its `checked` saying when.
 *
 * **The spare path.** What every instance knows of the pools lives in the database now (`./store.ts`, filled by
 * `./indexer.server.ts`), and the routes answer from it. This reader stays for where the database does not answer or
 * does not hold a pool: an instance then reads the node for itself and keeps what it read while it lives, as before.
 *
 * Reads only: nothing here signs or sends, and no key is held.
 */

import { PublicKey } from "@solana/web3.js";

import type { EarnProNetwork } from "../earn-pro/gate.ts";
import { earnProConnection, earnProVenue } from "../earn-pro/venue.server.ts";
import { depthOf, recordsOf, STATS_HOURS, type TapeEvent, type TapeListed, type TapePool, type TapeTxRecords, type TapeView } from "./tape.ts";

/** A signature as the node's list gives it. */
export type TapeListing = Readonly<{ signature: string; slot: number; blockTime: number | null; err: unknown }>;

/** Where the tape reads from: the node's list of the pool's signatures, and the program's events of one of them. */
export type TapeSource = Readonly<{
  list(address: string, options: Readonly<{ limit: number; before?: string; until?: string }>): Promise<readonly TapeListing[]>;
  /** The program's events of one landed transaction; null — the node does not keep it. */
  events(signature: string): Promise<readonly TapeEvent[] | null>;
}>;

export type TapeLimits = Readonly<{
  /** How long a pool's read stays fresh, ms. */
  fresh: number;
  /** Signatures in one call of the list (the node's most is 1 000). */
  page: number;
  /** Transactions one read of a pool reads at most. */
  readsPerRefresh: number;
  /**
   * Transactions one `day` read of a pool reads at most: a refresh of every pool's day shares the minute's budget, so
   * the first busy pools do not spend it all and leave the rest with nothing read.
   */
  dayReads: number;
  /** Of the minute's budget, what a deeper read leaves for the next refresh's first share of every pool. */
  reserve: number;
  /** Transactions read at once. */
  concurrency: number;
  /** Transactions the whole process reads in a minute at most. */
  readsPerMinute: number;
  /** Transactions read past the day's start, so that a quiet pool still shows its last trades. */
  tapeMin: number;
  /** Transactions kept for one pool. */
  keptPerPool: number;
  /** Pools kept. */
  pools: number;
  /** Order sides kept for one pool. */
  sides: number;
  /** How long a pool's last list may be served when the node does not list it now, ms. */
  stale: number;
  /** How long one call to the node may take, ms. */
  timeout: number;
  /** How long one read of a pool may spend reading transactions, ms. */
  time: number;
  /**
   * A transaction the node did not give is asked again this many times, then left as the node's gap — and asked once
   * more after `stale`, so that a burst the node refused does not leave a gap for the life of the process.
   */
  tries: number;
}>;

export const TAPE_LIMITS: TapeLimits = Object.freeze({
  fresh: 15_000,
  page: 1_000,
  readsPerRefresh: 120,
  dayReads: 20,
  concurrency: 6,
  readsPerMinute: 300,
  tapeMin: 100,
  keptPerPool: 5_000,
  pools: 96,
  sides: 5_000,
  stale: 120_000,
  timeout: 10_000,
  time: 15_000,
  tries: 3,
  reserve: 100,
});

/** The node did not answer for the pool: the route says so with a code, never with zeros. */
export class TapeUnavailable extends Error {
  /** `node` — the node did not answer; `budget` — our own budget left nothing to read yet, the node refused nothing. */
  readonly reason: "node" | "budget";
  constructor(message: string, reason: "node" | "budget" = "node") {
    super(message);
    this.name = "TapeUnavailable";
    this.reason = reason;
  }
}

type Item = {
  signature: string;
  slot: number;
  blockTime: number | null;
  state: "read" | "unread" | "lost";
  records: TapeTxRecords | null;
  /** Times the node failed to give it or gave nothing. */
  misses: number;
  /** When it last failed; null — never. */
  lostAt: number | null;
};

type Entry = {
  pool: TapePool;
  items: Item[];
  /** The list reached the oldest signature the node gives for the pool. */
  end: boolean;
  checkedAt: number | null;
  /** When each scope was last read; a `tape` read is a `day` read too. */
  refreshed: Record<TapeScope, number | null>;
  sides: Map<string, "ask" | "bid">;
  running: Promise<void> | null;
};

/** What a read must reach: `tape` — the day and the last trades of a quiet pool; `day` — the day alone. */
export type TapeScope = "tape" | "day";

/** A promise that fails where it does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The node did not answer in time.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const listedOf = (listing: TapeListing): Item => ({ signature: listing.signature, slot: listing.slot, blockTime: listing.blockTime ?? null, state: "unread", records: null, misses: 0, lostAt: null });

/**
 * A reader over a source, with its own memory: the server keeps one per network (`readProTape`); a test hands in a
 * source of recorded transactions and a clock of its own.
 */
export function createTapeReader(source: TapeSource, limits: TapeLimits = TAPE_LIMITS, clock: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  /** When each read of the last minute happened: the process's budget. */
  const spent: number[] = [];

  /** Reads of the node granted now, out of `want`, leaving `keep` of the minute's budget untouched. */
  function allowance(want: number, now: number, keep = 0): number {
    while (spent.length > 0 && now - spent[0]! >= 60_000) spent.shift();
    const allowed = Math.max(0, Math.min(want, limits.readsPerMinute - keep - spent.length));
    for (let index = 0; index < allowed; index += 1) spent.push(now);
    return allowed;
  }

  /** Whether a read of the scope needs the transaction at `index` of the list; what is kept is always the tape's. */
  const needed = (item: Item, index: number, windowStart: number, scope: TapeScope = "tape"): boolean =>
    (scope === "tape" && index < limits.tapeMin) || item.blockTime === null || item.blockTime >= windowStart;

  function remember(entry: Entry, records: TapeTxRecords): void {
    for (const order of records.placed) {
      entry.sides.delete(order.order);
      entry.sides.set(order.order, order.side);
    }
    while (entry.sides.size > limits.sides) {
      const oldest = entry.sides.keys().next().value;
      if (oldest === undefined) break;
      entry.sides.delete(oldest);
    }
  }

  /** Reads the items within `deadline`; a refused one is marked as refused at the read's moment `now`. */
  async function readItems(entry: Entry, items: readonly Item[], deadline: number, now: number): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < items.length && clock() < deadline) {
        const item = items[next++]!;
        try {
          const events = await withTimeout(source.events(item.signature), limits.timeout);
          if (events === null) {
            item.misses += 1;
            item.lostAt = now;
            item.state = "lost";
            continue;
          }
          const records = recordsOf({ signature: item.signature, slot: item.slot, blockTime: item.blockTime }, events, entry.pool);
          item.records = records;
          item.state = "read";
          remember(entry, records);
        } catch {
          item.misses += 1;
          item.lostAt = now;
          item.state = "lost";
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, items.length) }, worker));
  }

  async function refresh(entry: Entry, now: number, scope: TapeScope): Promise<void> {
    const address = entry.pool.address;
    const windowStart = Math.floor(now / 1000) - STATS_HOURS * 3600;
    const newest = entry.items[0]?.signature;
    let head: readonly TapeListing[];
    try {
      head = await withTimeout(source.list(address, { limit: limits.page, ...(newest ? { until: newest } : {}) }), limits.timeout);
    } catch {
      if (entry.checkedAt !== null && now - entry.checkedAt < limits.stale) return;
      throw new TapeUnavailable("The node did not list the pool's transactions.", "node");
    }
    /* A full page after the newest known: more landed than one page holds, and the gap would never be read — start over from now. */
    if (newest && head.length >= limits.page) {
      entry.items = [];
      entry.end = false;
    }
    const known = new Set(entry.items.map((item) => item.signature));
    entry.items = [...head.filter((listing) => listing.err === null && !known.has(listing.signature)).map(listedOf), ...entry.items];
    if (!newest && head.length < limits.page) entry.end = true;
    entry.checkedAt = now;

    /* An older page, once everything the tape needs of what is listed is read and the tape still needs older. */
    const oldest = entry.items.at(-1);
    const settled = entry.items.every((item) => item.state === "read" || item.misses >= limits.tries);
    if (!entry.end && oldest && settled && entry.items.length < limits.keptPerPool && needed(oldest, entry.items.length - 1, windowStart, scope)) {
      try {
        const older = await withTimeout(source.list(address, { limit: limits.page, before: oldest.signature }), limits.timeout);
        const seen = new Set(entry.items.map((item) => item.signature));
        entry.items.push(...older.filter((listing) => listing.err === null && !seen.has(listing.signature)).map(listedOf));
        if (older.length < limits.page) entry.end = true;
      } catch {
        /* The next read lists on; what is read stands. */
      }
    }

    await readWanted(entry, now, scope, scope === "day" ? Math.min(limits.dayReads, limits.readsPerRefresh) : limits.readsPerRefresh);
  }

  /**
   * What the scope needs and is not read yet — newest first, at most `most`, within the process's budget less `keep` —
   * read from the node, where the node has not refused it for good (a refused one again past `stale`); then lets go of
   * what the tape no longer needs.
   */
  async function readWanted(entry: Entry, now: number, scope: TapeScope, most: number, untouched = 0): Promise<void> {
    const windowStart = Math.floor(now / 1000) - STATS_HOURS * 3600;
    const unread: Item[] = [];
    for (let index = 0; index < entry.items.length && unread.length < most; index += 1) {
      const item = entry.items[index]!;
      if (!needed(item, index, windowStart, scope)) break;
      if (item.state !== "read") unread.push(item);
    }
    const wanted = unread.filter((item) => item.misses < limits.tries || (item.lostAt !== null && now - item.lostAt >= limits.stale));
    const allowed = allowance(wanted.length, now, untouched);
    await readItems(entry, wanted.slice(0, allowed), clock() + limits.time, now);

    /* Let go of what the tape no longer needs: past the day and the last trades, one kept as the edge, and the cap. */
    let keep = entry.items.findIndex((item, index) => !needed(item, index, windowStart));
    keep = keep < 0 ? entry.items.length : keep + 1;
    keep = Math.min(keep, limits.keptPerPool);
    if (keep < entry.items.length) {
      entry.items.length = keep;
      entry.end = false;
    }
  }

  function viewOf(entry: Entry, now: number): TapeView {
    const windowStart = Math.floor(now / 1000) - STATS_HOURS * 3600;
    const listed: TapeListed[] = entry.items.map((item) => ({ blockTime: item.blockTime, state: item.state, created: item.records?.created ?? false }));
    const depth = depthOf(listed, entry.end, windowStart, entry.checkedAt === null ? null : new Date(entry.checkedAt).toISOString());
    const txs = entry.items.slice(0, depth.transactions).map((item) => item.records!);
    return { pool: entry.pool, depth, txs, sides: entry.sides };
  }

  const freshFor = (entry: Entry, scope: TapeScope, now: number): boolean => {
    const at = scope === "day" ? Math.max(entry.refreshed.day ?? -Infinity, entry.refreshed.tape ?? -Infinity) : (entry.refreshed.tape ?? -Infinity);
    return now - at < limits.fresh;
  };

  /**
   * The pool's tape now: read again where the scope's read is older than `fresh`, else as kept. Throws
   * `TapeUnavailable` where the node did not answer, or answered nothing of a day not known to be empty.
   */
  async function read(pool: TapePool, now: number = clock(), scope: TapeScope = "tape"): Promise<TapeView> {
    let entry = entries.get(pool.address);
    if (entry) entries.delete(pool.address);
    entry ??= { pool, items: [], end: false, checkedAt: null, refreshed: { tape: null, day: null }, sides: new Map(), running: null };
    /* The coins' dollar prices move; the pool's coins and sides do not. */
    entry.pool = pool;
    entries.set(pool.address, entry);
    while (entries.size > limits.pools) {
      const oldest = [...entries.entries()].find(([, kept]) => kept.running === null && kept !== entry);
      if (!oldest) break;
      entries.delete(oldest[0]);
    }
    /* A read of the other scope may be running: wait for it, then read this scope's own where it is still not fresh. */
    for (let turn = 0; turn < 2 && !freshFor(entry, scope, now); turn += 1) {
      const current = entry;
      current.running ??= refresh(current, now, scope)
        .then(() => {
          current.refreshed[scope] = now;
        })
        .finally(() => {
          current.running = null;
        });
      try {
        await current.running;
      } catch (error) {
        if (current.checkedAt === null) entries.delete(pool.address);
        throw error;
      }
    }
    return answerOf(entry, now);
  }

  function answerOf(entry: Entry, now: number): TapeView {
    const view = viewOf(entry, now);
    if (view.depth.transactions === 0 && !view.depth.whole) {
      throw new TapeUnavailable("Nothing of the pool's transactions could be read yet.", view.depth.stop === "budget" ? "budget" : "node");
    }
    return view;
  }

  /**
   * A pool's day read deeper within the same refresh: what its list already holds and the day still needs, up to
   * `readsPerRefresh` more, from what is left of the minute's budget — no new list. A pool never listed is read as a day.
   */
  async function deepen(pool: TapePool, now: number = clock()): Promise<TapeView> {
    const entry = entries.get(pool.address);
    if (!entry || entry.checkedAt === null) return read(pool, now, "day");
    if (entry.running) await entry.running.catch(() => undefined);
    const current = entry;
    current.running ??= readWanted(current, now, "day", limits.readsPerRefresh, limits.reserve).finally(() => {
      current.running = null;
    });
    await current.running;
    return answerOf(current, now);
  }

  return { read, deepen, size: () => entries.size };
}

export type TapeReader = ReturnType<typeof createTapeReader>;

/** The node of a network as a tape's source, through earning's one door to the venue. */
export function nodeTapeSource(network: EarnProNetwork): TapeSource {
  return {
    async list(address, options) {
      const found = await earnProConnection(network).getSignaturesForAddress(
        new PublicKey(address),
        { limit: options.limit, ...(options.before ? { before: options.before } : {}), ...(options.until ? { until: options.until } : {}) },
        "confirmed",
      );
      return found.map((row) => ({ signature: row.signature, slot: row.slot, blockTime: row.blockTime ?? null, err: row.err }));
    },
    events: (signature) => earnProVenue(network).events.read(signature),
  };
}

const readers = new Map<EarnProNetwork, TapeReader>();

/** A DLMM Pro pool's tape on a network, from the process's one reader of that network. */
export function readProTape(network: EarnProNetwork, pool: TapePool, now?: number, scope: TapeScope = "tape"): Promise<TapeView> {
  return readerOf(network).read(pool, now, scope);
}

/** A DLMM Pro pool's day read deeper from what is left of the minute's budget (`TapeReader.deepen`). */
export function deepenProDay(network: EarnProNetwork, pool: TapePool, now?: number): Promise<TapeView> {
  return readerOf(network).deepen(pool, now);
}

function readerOf(network: EarnProNetwork): TapeReader {
  let reader = readers.get(network);
  if (!reader) {
    reader = createTapeReader(nodeTapeSource(network));
    readers.set(network, reader);
  }
  return reader;
}
