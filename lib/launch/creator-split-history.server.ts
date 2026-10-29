/**
 * Who bought what of a launch, from its whole history — the holders' snapshot's ledger (SOL-L2b).
 *
 * The creator's split pays holders by what they bought and still hold, so it needs every trade from the token's
 * creation: the curve's back to the creation, the graduated pool's back to the migration. A token past a few thousand
 * transactions cannot be read in one request, so the read goes in steps and is kept (`launchCreatorSplitBought`, keyed
 * `<cluster>:<token>`). Each account is read as descending runs, every run resumable from a stored cursor:
 * - **the back-fill** — from the newest signature at the first read (`newest`) down to the account's start: for the
 *   curve, once the counted part holds the creation's signature; for the pool, once it holds the migration's — DBC's
 *   `migration_damm_v2` of this curve into this pool, found as the cabinet finds the move to the DEX (`migration`) —,
 *   whatever older transactions name the pool's address and wherever a page was cut. A list from a node that keeps
 *   only recent history holds neither, and the account waits for one that has it;
 * - **the gap** — what landed since `newest`: from its own top (the newest signature when the gap opened) down page by
 *   page, closed only by a page that holds `newest` itself; `newest` then moves to its top, and the next gap opens.
 * Each run decodes its page newest-first, a few at a time, and counts the prefix it read, the run's cursor moved past it.
 *
 * Each signature is counted once: every step is a compare-and-set of the kept ledger that also checks the account's read
 * is still the one the step began from; a step that lost the race is dropped, and the account is read again from the
 * ledger as stored. A page that cannot prove where it stands — short, or reaching an older slot than `newest`'s without
 * holding it — is no answer. A transaction listed by both accounts counts once: each account counts only its own
 * venue's trades.
 *
 * Per wallet the ledger keeps the tokens bought less sold on the curve and the pool, and the wallets a buy of which the
 * creator's wallet paid for. `complete` — both accounts reached their start and no gap is open.
 *
 * Server-only.
 */

import { PublicKey, type Connection } from "@solana/web3.js";

import type { GuardStore } from "../guard/store.ts";

export const LAUNCH_CREATOR_SPLIT_BOUGHT = "launchCreatorSplitBought" as const;

/** A gap being read: its top (the newest signature when it opened) and how far down it was counted. */
export type Run = Readonly<{ top: string; topSlot: number; cursor: string }>;

/** One account's read. `newest`/`newestSlot`: the back-fill's top; everything from there to the start is the back-fill's. */
export type AccountScan = Readonly<{
  address: string;
  newest: string | null;
  newestSlot: number | null;
  /** The back-fill's cursor: counted from `newest` down to here. */
  cursor: string | null;
  reachedStart: boolean;
  /** The pool's: the migration's signature — its first transaction — once found. */
  start?: string | null;
  /** What landed above `newest`, being read; null when none is open. */
  gap: Run | null;
}>;

export type BoughtLedger = Readonly<{
  version: number;
  cluster: string;
  token: string;
  curve: AccountScan;
  pool: AccountScan | null;
  /** Each wallet's tokens bought less sold, raw. */
  bought: Readonly<Record<string, string>>;
  /** Wallets a buy of which the creator's wallet paid for, delivered to them. */
  creatorPaid: readonly string[];
  updatedAt: string;
}>;

export type ListedSignature = Readonly<{ signature: string; slot: number; blockTime: number | null; failed: boolean }>;
export type HistoryTrade = Readonly<{ trader: string; payer: string; side: "buy" | "sell"; tokensRaw: string; venue: "curve" | "pool" }>;

export type HistoryDeps = Readonly<{
  store: GuardStore;
  cluster: string;
  now: () => Date;
  /** An account's signatures, newest first: before `before`, down to (not including) `until`. A read that fails throws. */
  list: (address: string, options: Readonly<{ before?: string; until?: string; limit: number }>) => Promise<readonly ListedSignature[]>;
  /** The trades one transaction made on the token; null when it could not be read now. */
  decode: (signature: string) => Promise<readonly HistoryTrade[] | null>;
  /** The signature of the migration of the curve into the pool (DBC's `migration_damm_v2`); null when it was not found now. */
  migration: () => Promise<string | null>;
}>;

export type HistoryFacts = Readonly<{
  token: string;
  creator: string;
  curve: string;
  /** The token's creation: the curve's first transaction. */
  creationSignature: string;
  /** The graduated pool; null before the DEX. */
  pool: string | null;
}>;

/** A page of signatures: the most an RPC node lists at once. */
export const PAGE = 1_000;
/** How many transactions are decoded at once. */
export const DECODE_WIDTH = 6;

const key = (cluster: string, token: string) => `${cluster}:${token}`;
const fresh = (address: string): AccountScan => ({ address, newest: null, newestSlot: null, cursor: null, reachedStart: false, gap: null });

export async function readBoughtLedger(store: GuardStore, cluster: string, token: string): Promise<BoughtLedger | null> {
  return (await store.versioned<BoughtLedger>(LAUNCH_CREATOR_SPLIT_BOUGHT).get(key(cluster, token))) ?? null;
}

/** The trades counted into a ledger: each wallet's bought less sold, and the wallets the creator paid a buy for. */
function counted(ledger: BoughtLedger, trades: readonly HistoryTrade[], creator: string): Pick<BoughtLedger, "bought" | "creatorPaid"> {
  const bought = { ...ledger.bought };
  const paid = new Set(ledger.creatorPaid);
  for (const trade of trades) {
    const amount = BigInt(trade.tokensRaw);
    bought[trade.trader] = (BigInt(bought[trade.trader] ?? "0") + (trade.side === "buy" ? amount : -amount)).toString();
    if (trade.side === "buy" && trade.payer === creator && trade.trader !== creator) paid.add(trade.trader);
  }
  return { bought, creatorPaid: [...paid] };
}

const same = (a: AccountScan | null, b: AccountScan | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The ledger read further within `budgetMs`, and whether it now holds the whole history. Each step is written as it is
 * counted; a step another instance already took is dropped and the account read again as stored.
 */
export async function advanceBoughtLedger(deps: HistoryDeps, facts: HistoryFacts, budgetMs: number): Promise<Readonly<{ ledger: BoughtLedger; complete: boolean }>> {
  const until = Date.now() + budgetMs;
  const rows = deps.store.versioned<BoughtLedger>(LAUNCH_CREATOR_SPLIT_BOUGHT);
  const id = key(deps.cluster, facts.token);
  const blank: BoughtLedger = { version: -1, cluster: deps.cluster, token: facts.token, curve: fresh(facts.curve), pool: null, bought: {}, creatorPaid: [], updatedAt: deps.now().toISOString() };
  let ledger: BoughtLedger = (await rows.get(id)) ?? blank;

  /**
   * One step, written only over the ledger as this step read it and only while the account's read is the one the step
   * began from; true when written. Lost, the ledger is read again.
   */
  const commit = async (which: "curve" | "pool", from: AccountScan | null, scan: AccountScan, trades: readonly HistoryTrade[]): Promise<boolean> => {
    if (!same(ledger[which], from)) return false;
    const next: BoughtLedger = { ...ledger, ...counted(ledger, trades, facts.creator), [which]: scan, version: ledger.version + 1, updatedAt: deps.now().toISOString() };
    const written = await rows.compareAndSet(id, ledger.version < 0 ? null : ledger.version, next).catch(() => false);
    if (written) ledger = next;
    else ledger = (await rows.get(id).catch(() => null)) ?? ledger;
    return written;
  };

  /** A page's transactions decoded newest-first, a few at a time: the prefix read, its trades of this account's venue. */
  const decodePrefix = async (page: readonly ListedSignature[], venue: "curve" | "pool"): Promise<Readonly<{ trades: HistoryTrade[]; count: number }>> => {
    const trades: HistoryTrade[] = [];
    let count = 0;
    for (let at = 0; at < page.length && Date.now() < until; at += DECODE_WIDTH) {
      const chunk = page.slice(at, at + DECODE_WIDTH);
      const decoded = await Promise.all(chunk.map((entry) => (entry.failed ? Promise.resolve([] as readonly HistoryTrade[]) : deps.decode(entry.signature).catch(() => null))));
      for (const result of decoded) {
        if (!result) return { trades, count };
        trades.push(...result.filter((trade) => trade.venue === venue));
        count += 1;
      }
    }
    return { trades, count };
  };

  if (facts.pool && (!ledger.pool || ledger.pool.address !== facts.pool)) {
    const from = ledger.pool;
    await commit("pool", from, fresh(facts.pool), []);
  }

  /* The accounts whose tip this read reached: a gap closed, or none above `newest`. */
  const tipSeen = new Set<"curve" | "pool">();
  for (const which of ["curve", "pool"] as const) {
    const venue = which;
    let rounds = 0;
    while (Date.now() < until && rounds++ < 10_000) {
      const scan = ledger[which];
      if (!scan) break;
      /* The back-fill first, from the newest at its first read down to the start. */
      if (!scan.reachedStart) {
        /* The pool's start is its migration: found once, kept; not found now, the pool waits. */
        let first = which === "curve" ? facts.creationSignature : (scan.start ?? null);
        if (!first) {
          first = await deps.migration().catch(() => null);
          if (!first) break;
          await commit(which, scan, { ...scan, start: first }, []);
          continue;
        }
        const page = await deps.list(scan.address, { ...(scan.cursor ? { before: scan.cursor } : {}), limit: PAGE }).catch(() => null);
        if (!page) break;
        const { trades, count } = await decodePrefix(page, venue);
        if (count === 0 && page.length > 0) break;
        const whole = count === page.length;
        /*
         * Started once the counted part holds the account's first transaction — the curve's creation, the pool's
         * migration: everything newer is counted, and nothing older traded on it, whatever older entries name its address.
         */
        const start = page.slice(0, count).some((entry) => entry.signature === first);
        const top = scan.newest ? null : (page[0] ?? null);
        const next: AccountScan = {
          ...scan,
          newest: scan.newest ?? top?.signature ?? null,
          newestSlot: scan.newestSlot ?? top?.slot ?? null,
          cursor: count > 0 ? page[count - 1]!.signature : scan.cursor,
          reachedStart: start,
        };
        if (!(await commit(which, scan, next, trades))) continue;
        /* A short page that is not the start: the node keeps no older history, and nothing older can be listed now. */
        if (whole && page.length < PAGE && !start) break;
        continue;
      }
      /*
       * Then what landed above `newest`: a gap opened at the tip and read down page by page from its own cursor, closed
       * only by a page that holds `newest` itself. A page that does not, and is short or reaches into an older slot than
       * `newest`'s — a node that does not know the gap's cursor or `newest` yet — is no answer: the gap waits as it is.
       */
      if (!scan.newest || scan.newestSlot === null) break;
      const gap = scan.gap;
      const page = await deps.list(scan.address, { ...(gap ? { before: gap.cursor } : {}), limit: PAGE }).catch(() => null);
      if (!page) break;
      const at = page.findIndex((entry) => entry.signature === scan.newest);
      if (at < 0 && (page.length < PAGE || page.some((entry) => entry.slot < scan.newestSlot!))) break;
      const own = at >= 0 ? page.slice(0, at) : page;
      if (!gap && !own.length) {
        tipSeen.add(which);
        break;
      }
      const { trades, count } = await decodePrefix(own, venue);
      if (count === 0 && own.length > 0) break;
      const top = gap ?? { top: own[0]!.signature, topSlot: own[0]!.slot };
      const closed = at >= 0 && count === own.length;
      const next: AccountScan = closed
        ? { ...scan, newest: top.top, newestSlot: top.topSlot, gap: null }
        : { ...scan, gap: { top: top.top, topSlot: top.topSlot, cursor: count > 0 ? own[count - 1]!.signature : gap!.cursor } };
      if (!(await commit(which, scan, next, trades))) continue;
      if (closed) {
        tipSeen.add(which);
        break;
      }
    }
  }
  const settled = (which: "curve" | "pool") => Boolean(ledger[which]?.reachedStart && ledger[which]?.gap === null && tipSeen.has(which));
  const complete = settled("curve") && (!facts.pool || (ledger.pool?.address === facts.pool && settled("pool")));
  return { ledger, complete };
}

/** Listing through a node: its signatures with their slot, time and whether they failed. */
export function nodeLister(connection: Connection): HistoryDeps["list"] {
  return async (address, options) =>
    (await connection.getSignaturesForAddress(new PublicKey(address), { limit: options.limit, ...(options.before ? { before: options.before } : {}), ...(options.until ? { until: options.until } : {}) }, "confirmed")).map((entry) => ({
      signature: entry.signature,
      slot: entry.slot,
      blockTime: entry.blockTime ?? null,
      failed: entry.err !== null,
    }));
}
