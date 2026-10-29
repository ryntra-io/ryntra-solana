/**
 * «Стеження за гаманцями» (SOL-R4) — reading a wallet from the chain, through
 * a seam (`WalletChain`, `FactsReader`); mainnet's side is `chain.server.ts`.
 *
 * A wallet's record is shared: the first read takes its last transactions,
 * every later one only what came after — so a hundred people following one
 * wallet cost one read. A transaction no node gave is asked again next time,
 * never counted as «nothing happened».
 *
 * Reads only. Nothing here builds, signs or sends a transaction.
 */

import type { GuardStore } from "../guard/store.ts";
import {
  readActivity,
  readBirth,
  TRADES_KEPT,
  writeActivity,
  writeBirth,
  type ActivityRecord,
  type BirthRecord,
} from "./store.ts";
import {
  boughtEarly,
  firstBuys,
  labelsOf,
  tradesOfTransaction,
  walletBadges,
  walletPnl,
  WRAPPED_SOL,
  type ParsedTransactionLike,
  type TokenBirth,
  type WalletLabel,
  type WalletPnl,
  type WalletTrade,
} from "./trades.ts";
import { walletHonest, type TokenMarket, type WalletHonest } from "./honest.ts";

/**
 * How a signature list is asked: `race` — the whole history if it comes quickly, else the newest (a first read);
 * `newest` — a node that keeps a day or two is enough (a record read in the last hours: what came since is within it);
 * `whole` — only a whole history reaches back (a record read long ago, a creation).
 */
export type ListMode = "race" | "newest" | "whole";

/** A record older than this is extended only from a whole history: a node keeping a day or two may not reach it. */
const RECENT_RECORD_MS = 12 * 3_600_000;

/** The chain as this module asks it — a seam, so tests answer from fixtures. */
export type WalletChain = Readonly<{
  /**
   * Newest first. `until` — stop at this signature (not included); `before` — start below it. `whole` — the list came
   * from a node that keeps an account's whole history; a list from one that keeps a day or two is the newest only, never
   * proof the wallet has nothing older.
   */
  signatures(address: string, options: Readonly<{ until?: string; before?: string; limit: number; mode?: ListMode }>): Promise<Readonly<{ rows: readonly Readonly<{ signature: string; slot: number; blockTime: number | null; failed: boolean }>[]; whole: boolean }>>;
  /** Null when no node gave it (refused, rate-limited, not kept). */
  transaction(signature: string): Promise<ParsedTransactionLike | null>;
  /** What the wallet holds now, whole tokens by mint; null when not read. `minSlot` — not from a node behind this slot. */
  holdings(wallet: string, minSlot?: number): Promise<ReadonlyMap<string, number> | null>;
}>;

/** What Jupiter says of each mint: ticker, icon, price now, creator, creation. */
export type MintFacts = Readonly<{ symbol: string | null; name: string | null; icon: string | null; priceUsd: number | null; creator: string | null; createdAt: number | null; liquidityUsd?: number | null }>;
export type FactsReader = (mints: readonly string[]) => Promise<ReadonlyMap<string, MintFacts> | null>;

/* ------------------------------------------------------------ holdings */

export const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"] as const;

/** One JSON-RPC call to one node: its `result`, or a throw with the node's own reason (a status, an error message). */
export type RpcCall = (url: string, method: string, params: readonly unknown[]) => Promise<unknown>;

/** A `getTokenAccountsByOwner` answer (`jsonParsed`) → whole tokens by mint, from the exact amount and its decimals. */
export function holdingsFromAccounts(answers: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const answer of answers) {
    const value = (answer as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) throw new Error("malformed token accounts");
    for (const account of value) {
      const info = (account as { account?: { data?: { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } })?.account?.data?.parsed?.info;
      const mint = typeof info?.mint === "string" ? info.mint : null;
      const amount = typeof info?.tokenAmount?.amount === "string" ? Number(info.tokenAmount.amount) : NaN;
      const decimals = typeof info?.tokenAmount?.decimals === "number" ? info.tokenAmount.decimals : NaN;
      if (!mint || !Number.isFinite(amount) || !Number.isFinite(decimals)) continue;
      out.set(mint, (out.get(mint) ?? 0) + amount / 10 ** decimals);
    }
  }
  return out;
}

/**
 * What a wallet holds, from the first node that answers both token programs. An indexed read: the public primary refuses
 * it («a personal token»), and one operator may refuse a cloud's address while another answers — so each in turn. None
 * answering is `reasons`, never an empty wallet.
 */
export async function holdingsAcross(urls: readonly string[], wallet: string, rpc: RpcCall, minSlot?: number): Promise<{ held: Map<string, number> | null; node: string | null; reasons: string[]; failed: string[] }> {
  const reasons: string[] = [];
  const failed: string[] = [];
  /* A node behind the newest trade read would say «0» of what was just bought: it is asked only from that slot on. */
  const config = { encoding: "jsonParsed", commitment: "confirmed", ...(minSlot ? { minContextSlot: minSlot } : {}) };
  for (const url of urls) {
    try {
      /* One program after the other: a public node answers a pair sent at once with 429 (measured 21.10). */
      const answers: unknown[] = [];
      for (const programId of TOKEN_PROGRAMS) answers.push(await rpc(url, "getTokenAccountsByOwner", [wallet, { programId }, config]));
      return { held: holdingsFromAccounts(answers), node: url, reasons, failed };
    } catch (error) {
      /* A node behind the newest trade is not refusing: it rests no longer than the read. */
      if (!(error instanceof Error && /context slot/i.test(error.message))) failed.push(url);
      reasons.push(`${hostOf(url)}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
    }
  }
  return { held: null, node: null, reasons, failed };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "node";
  }
}

/* ------------------------------------------------------------- reading */

async function pool<T, R>(items: readonly T[], work: (item: T) => Promise<R>, size: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await work(items[at]!);
      }
    }),
  );
  return out;
}

export type ReadOptions = Readonly<{
  nowMs: number;
  /** A record younger than this is served as it is. */
  freshMs: number;
  /** The most transactions one read asks for. */
  maxNew: number;
  /** How many at once. */
  concurrency?: number;
}>;

const FIRST_LIST = 100;
const NEXT_LIST = 200;
const HELD_FRESH_MS = 60_000;

/**
 * The wallet's record, extended by what is new since the last read. A read that failed whole returns the last record
 * (or null) — the page says how old it is.
 */
export async function refreshActivity(store: GuardStore, chain: WalletChain, wallet: string, options: ReadOptions): Promise<ActivityRecord | null> {
  const found = await readActivity(store, wallet).catch(() => null);
  if (found && options.nowMs - Date.parse(found.readAt) < options.freshMs) return found;
  const firstList = Math.min(FIRST_LIST, options.maxNew);
  let listed: Awaited<ReturnType<WalletChain["signatures"]>>["rows"];
  let whole = false;
  let staleGap = false;
  try {
    /* The first read lists only what it will read: what lies beyond is older history, not a gap. */
    const mode: ListMode = !found ? "race" : options.nowMs - Date.parse(found.readAt) < RECENT_RECORD_MS ? "newest" : "whole";
    const list = await chain.signatures(wallet, { until: found?.newest ?? undefined, limit: found ? NEXT_LIST : firstList, mode });
    listed = list.rows;
    whole = list.whole;
    /* An old record extended from the newest only: what lies between may be missing — said as a gap, never hidden. */
    if (mode === "whole" && !whole) staleGap = true;
  } catch {
    return found;
  }
  const ok = listed.filter((row) => !row.failed);
  /* The newest first; the rest of a burst is skipped and counted — a bot's thousand a day cannot all be read. What a
     node refused last time is asked again with the room left, and kept for the next read when there is none. */
  const fresh = ok.slice(0, options.maxNew);
  /* A full list between reads: more came than one list holds — the rest is a gap, said, never silent. */
  const gap = (Boolean(found) && listed.length >= NEXT_LIST) || staleGap;
  const skipped = ok.length - fresh.length;
  const owed = (found?.pending ?? []).filter((signature) => !ok.some((row) => row.signature === signature));
  const room = options.maxNew - fresh.length;
  const asked = [...fresh.map((row) => row.signature), ...owed.slice(0, room)];
  const read = await pool(asked, async (signature) => ({ signature, tx: await chain.transaction(signature).catch(() => null) }), options.concurrency ?? 3);
  const missed = [...read.filter((row) => row.tx === null).map((row) => row.signature), ...owed.slice(room)].slice(0, 50);
  const got = read.flatMap((row) => tradesOfTransaction(row.tx, wallet));
  const seen = new Set<string>();
  const trades = [...got, ...(found?.trades ?? [])]
    .filter((trade) => {
      const key = `${trade.signature}:${trade.mint}:${trade.side}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.slot - a.slot)
    .slice(0, TRADES_KEPT);
  const times = [...fresh.map((row) => row.blockTime), found?.oldestAt ?? null].filter((at): at is number => at !== null);
  /* What it holds, read again once a minute — and at once when new trades came, so a token just bought is never «0». */
  const heldStale = !found?.heldAt || options.nowMs - Date.parse(found.heldAt) > HELD_FRESH_MS || got.length > 0;
  const held = heldStale ? await chain.holdings(wallet, trades[0]?.slot).catch(() => null) : null;
  const next: ActivityRecord = {
    schema: "ryntra.wallet-watch.activity",
    version: (found?.version ?? 0) + 1,
    wallet,
    trades,
    newest: ok[0]?.signature ?? listed[0]?.signature ?? found?.newest ?? null,
    pending: missed,
    scanned: (found?.scanned ?? 0) + read.filter((row) => row.tx !== null).length,
    oldestAt: times.length > 0 ? Math.min(...times) : null,
    /* The first list shorter than asked reached the wallet's first transaction. */
    complete: found ? found.complete : whole && listed.length < firstList && missed.length === 0,
    skipped: (found?.skipped ?? 0) + skipped,
    gap: (found?.gap ?? false) || gap,
    held: held ? Object.fromEntries(held) : (found?.held ?? null),
    heldAt: held ? new Date(options.nowMs).toISOString() : (found?.heldAt ?? null),
    readAt: new Date(options.nowMs).toISOString(),
  };
  /* A lost race: another read wrote first — its record is as good as this one. */
  await writeActivity(store, next, found?.version ?? null).catch(() => false);
  return next;
}

const BIRTH_FRESH_MS = 24 * 3_600_000;
const CREATION_RETRY_MS = 10 * 60_000;
/* When a mint's creation block was last looked for and not found, in this instance. */
const creationTried = new Map<string, number>();
const MINT_LIST = 1_000;

/**
 * Each mint's creator and creation, from Jupiter, kept a day; the creation's block read once, and only for a mint the
 * wallet bought early — the one case where it can make a bundle.
 */
export async function birthsOf(store: GuardStore, chain: WalletChain, facts: ReadonlyMap<string, MintFacts> | null, trades: readonly WalletTrade[], nowMs: number): Promise<Map<string, TokenBirth>> {
  const mints = [...new Set(trades.map((trade) => trade.mint))];
  const out = new Map<string, TokenBirth>();
  const early = firstBuys(trades);
  await pool(
    mints,
    async (mint) => {
      const kept = await readBirth(store, mint).catch(() => null);
      const fact = facts?.get(mint);
      let record: BirthRecord | null = kept;
      if (fact && (!kept || nowMs - Date.parse(kept.checkedAt) > BIRTH_FRESH_MS)) {
        record = { schema: "ryntra.wallet-watch.birth", version: (kept?.version ?? 0) + 1, mint, creator: fact.creator, createdAt: fact.createdAt, createdSlot: kept?.createdSlot, checkedAt: new Date(nowMs).toISOString() };
      }
      const buy = early.get(mint);
      if (record && buy && record.createdSlot === undefined && boughtEarly(buy, { creator: record.creator, createdAt: record.createdAt, createdSlot: null })) {
        /* Everything before the buy, back to the mint's first transaction — a short list for a two-minute-old token; a longer one is not read whole and says nothing. */
        /* Only a whole history reaches the creation: a node that keeps a day or two says nothing of it. */
        /* Asked at most every ten minutes per mint: a whole history slow from the cloud is not waited on every view. */
        const tried = creationTried.get(mint) ?? 0;
        const list = nowMs - tried < CREATION_RETRY_MS ? null : await chain.signatures(mint, { before: buy.signature, limit: MINT_LIST, mode: "whole" }).catch(() => null);
        if (!list || !list.whole) creationTried.set(mint, nowMs);
        if (creationTried.size > 5_000) for (const [key, at] of creationTried) if (nowMs - at >= CREATION_RETRY_MS) creationTried.delete(key);
        const before = list && list.whole ? list.rows : null;
        /* An empty list is a node that does not keep the buy, not proof the buy was the creation: no bundle on it. */
        record = { ...record, createdSlot: before === null ? undefined : before.length > 0 && before.length < MINT_LIST ? before.at(-1)!.slot : null };
      }
      if (record && record !== kept) await writeBirth(store, record, kept?.version ?? null).catch(() => false);
      out.set(mint, { creator: record?.creator ?? null, createdAt: record?.createdAt ?? null, createdSlot: record?.createdSlot ?? null });
    },
    3,
  );
  return out;
}

/* ---------------------------------------------------------------- view */

export type TradeView = WalletTrade & Readonly<{ symbol: string | null; icon: string | null; labels: readonly WalletLabel[] }>;
export type TokenView = WalletPnl["tokens"][number] & Readonly<{ symbol: string | null; name: string | null; icon: string | null; priceUsd: number | null; heldNow: number | null }>;

export type WalletView = Readonly<{
  wallet: string;
  readAt: string | null;
  scanned: number;
  oldestAt: number | null;
  complete: boolean;
  skipped: number;
  /** More transactions came between two reads than one list holds: some were never listed. */
  gap: boolean;
  /** Newest first, at most 50. */
  trades: readonly TradeView[];
  tokens: readonly TokenView[];
  pnl: Omit<WalletPnl, "tokens">;
  /** The result by the honest standard (DSC-2): fees, the exit price, completeness, drawdown, 7 · 30 · 90 days. */
  honest: WalletHonest;
  badges: Readonly<Record<WalletLabel, number>>;
  solUsd: number | null;
  pricesAt: string | null;
}>;

/** The wallet as the page draws it: trades with tickers, the result per token and in all, the labels earned. */
export async function walletView(store: GuardStore, chain: WalletChain, facts: FactsReader, wallet: string, options: ReadOptions): Promise<WalletView | null> {
  const activity = await refreshActivity(store, chain, wallet, options);
  if (!activity) return null;
  const mints = [...new Set(activity.trades.map((trade) => trade.mint))];
  const known = await facts([...mints, WRAPPED_SOL].slice(0, 100));
  const births = await birthsOf(store, chain, known, activity.trades, options.nowMs);
  const labels = labelsOf(wallet, activity.trades, births);
  const solUsd = known?.get(WRAPPED_SOL)?.priceUsd ?? null;
  const usd = new Map<string, number>();
  for (const [mint, fact] of known ?? []) if (fact.priceUsd !== null) usd.set(mint, fact.priceUsd);
  /* A token traded after the accounts were last read is not known to be held or not: null, never a cap at 0. */
  const heldAtS = activity.heldAt ? Date.parse(activity.heldAt) / 1000 : null;
  const tradedAfter = new Set(activity.trades.filter((trade) => heldAtS === null || trade.at === null || trade.at > heldAtS).map((trade) => trade.mint));
  const held = activity.held ? new Map<string, number | null>([...Object.entries(activity.held), ...[...tradedAfter].map((mint) => [mint, null] as const)]) : undefined;
  const pnl = walletPnl(activity.trades, { solUsd, usd }, labels, held);
  const market = new Map<string, TokenMarket>();
  for (const [mint, fact] of known ?? []) market.set(mint, { priceUsd: fact.priceUsd, liquidityUsd: fact.liquidityUsd ?? null });
  const honest = walletHonest({ trades: activity.trades, solUsd, market, held, nowS: Math.floor(options.nowMs / 1000) });
  const named = (mint: string) => known?.get(mint);
  return {
    wallet,
    readAt: activity.readAt,
    scanned: activity.scanned,
    oldestAt: activity.oldestAt,
    complete: activity.complete,
    skipped: activity.skipped,
    gap: activity.gap ?? false,
    trades: activity.trades.slice(0, 50).map((trade) => ({ ...trade, symbol: named(trade.mint)?.symbol ?? null, icon: named(trade.mint)?.icon ?? null, labels: labels.get(trade.mint) ?? [] })),
    tokens: pnl.tokens.map((row) => ({ ...row, symbol: named(row.mint)?.symbol ?? null, name: named(row.mint)?.name ?? null, icon: named(row.mint)?.icon ?? null, priceUsd: named(row.mint)?.priceUsd ?? null, heldNow: !held || held.get(row.mint) === null ? null : (held.get(row.mint) ?? 0) })),
    pnl: { realizedSol: pnl.realizedSol, unrealizedSol: pnl.unrealizedSol, wins: pnl.wins, losses: pnl.losses, partial: pnl.partial, approx: pnl.approx },
    honest,
    badges: walletBadges(labels),
    solUsd,
    pricesAt: known ? new Date(options.nowMs).toISOString() : null,
  };
}
