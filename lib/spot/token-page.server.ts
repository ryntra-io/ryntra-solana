/**
 * The token page's reads — the `TokenData` adapter of plan §5.2 for the token
 * page: the token's facts, who bought and who
 * sold, who holds, the facts behind «Ризик», the pools and the chart's marks.
 *
 * Three sources, each the one with the right to be shown for its part
 * (`TOKEN_PAGE_SOURCES`): Jupiter Tokens V2 — through the Spot market's own
 * detail read, so the page asks Jupiter once; GeckoTerminal — inside the same
 * per-instance minute budget as the chart, as its junior: the page reads only
 * while the chart's reserve stands (`getJson(…, "page")`), so a page full of
 * tabs never takes the chart down; and the chain through Ryntra's own node for
 * the holders. Every read is cached per mint for as long as the source's own
 * figures move, one read per mint is in flight at a time, a source that does
 * not answer serves its last read marked as such for a while, and a failure
 * past that is a named reason, never an empty list. The caches keep the most
 * recent few hundred mints.
 */

import { getAddressDecoder } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";

import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import { GECKO_SOLANA_BASE, POOL_TRADES_TTL_MS, getJson, readMarketTrades, readTokenPoolsBody, scaledUnitMultiplier } from "./candles.server.ts";
import type { SpotMarket } from "./markets.ts";
import { readSpotTokenFacts } from "./markets.server.ts";
import {
  holdersOf,
  honeypotOf,
  isNativeToken,
  marksOf,
  mergeTrades,
  poolsOf,
  riskFactsOf,
  tradesOf,
  tradesPoolOf,
  tradesSpan,
  type HolderAccount,
  type HolderRead,
  type RiskFact,
  type TokenFacts,
  type TokenMark,
  type TokenPool,
  type TokenTrade,
} from "./token-page.ts";
import { fillUnpriced, mergeTrades as mergeEventTrades } from "./token-events.ts";
import { EVENTS_TRADES_TARGET, readMintTradeEvents, tokenEventsEndpoint } from "./token-events.server.ts";
import { readHolderAccountsWhole } from "./token-holders-das.server.ts";
import { ALL_ACCOUNTS_CEILING, holdersReachOf, LARGEST_ACCOUNTS_CEILING, withHolderValues, type HoldersReach, type TradesSource } from "./token-traders.ts";
import { freshCandidates, labelBasisOf, labelTrades, ownersOf, topHoldersOf, type LabelBasis, type WalletBook } from "./wallet-labels.ts";
import { AGE_PER_READ, knownAges, readWalletAges, ryntraAgents, walletLabelSettings } from "./wallet-labels.server.ts";

export type TokenPageFailure = Readonly<{
  ok: false;
  code: "NOT_LISTED" | "NO_POOL" | "UNREACHABLE" | "RATE_LIMITED" | "REFUSED" | "MALFORMED" | "NOT_READ";
  reason: string;
  retryAfterMs?: number | null;
  /** The pools a refused trades read would have read: the page may read them from the person's browser. */
  pools?: readonly TokenPool[];
}>;

type Cached<T> = { value: T; readAt: number };
/** The most mints a cache keeps: the oldest read leaves first. */
const CACHE_CEILING = 400;

function fresh<T>(cache: Map<string, Cached<T>>, key: string, ttlMs: number): Cached<T> | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.readAt < ttlMs ? hit : null;
}

function remember<T>(cache: Map<string, Cached<T>>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, { value, readAt: Date.now() });
  while (cache.size > CACHE_CEILING) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** One read per key in flight: a tab, the overview and a second visitor share the answer. */
const flying = new Map<string, Promise<unknown>>();
function once<T>(key: string, read: () => Promise<T>): Promise<T> {
  const pending = flying.get(key);
  if (pending) return pending as Promise<T>;
  const promise = read().finally(() => flying.delete(key));
  flying.set(key, promise);
  return promise;
}

const STALE_GRACE_MS = 10 * 60_000;

function geckoFailure(code: string, reason: string, retryAfterMs?: number | null): TokenPageFailure {
  return { ok: false, code: code === "RATE_LIMITED" ? "RATE_LIMITED" : code === "REFUSED" ? "REFUSED" : code === "MALFORMED" ? "MALFORMED" : "UNREACHABLE", reason, retryAfterMs };
}

/* --------------------------------------------------------------- facts */

export type TokenFactsRead = Readonly<{ ok: true; market: SpotMarket; facts: TokenFacts | null; observedAt: string; stale: boolean }>;

async function readFacts(mint: string): Promise<TokenFactsRead | TokenPageFailure> {
  const read = await readSpotTokenFacts(mint);
  if (!read.ok) return { ok: false, code: read.code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNREACHABLE", reason: read.reason, retryAfterMs: read.retryAfterMs };
  if (!read.market) return { ok: false, code: "NOT_LISTED", reason: "Jupiter does not list this token." };
  return { ok: true, market: read.market, facts: read.facts, observedAt: read.observedAt, stale: read.stale };
}

/* --------------------------------------------------------------- pools */

export type TokenPoolsRead = Readonly<{ ok: true; pools: readonly TokenPool[]; observedAt: string }>;

export async function readTokenPools(mint: string): Promise<TokenPoolsRead | TokenPageFailure> {
  const read = await readTokenPoolsBody(mint, "page");
  if (!read.ok) return geckoFailure(read.code, read.reason, read.retryAfterMs);
  return { ok: true, pools: poolsOf(read.body, mint), observedAt: read.observedAt };
}

/* -------------------------------------------------------------- trades */

export type TokenTradesRead = Readonly<{
  ok: true;
  trades: readonly TokenTrade[];
  /** The pool the trades are of — where the token trades most now (the busiest of `pools`); null only when the trades are the chain's events and no pool was read. */
  pool: TokenPool | null;
  /** Every pool the trades were read from, the busiest first; empty only beside the chain's events when no pool was read. */
  pools: readonly TokenPool[];
  span: Readonly<{ from: string; to: string }> | null;
  /** Whether the capitalisation at each trade was counted (not for a tokenized stock). */
  capCounted: boolean;
  /** The largest holders' wallets the page last read for this mint, so a trade can say «a top holder»; empty when none was read. */
  topHolders: readonly string[];
  observedAt: string;
  stale: boolean;
  /** Where the trades come from — GeckoTerminal's busiest pool, or the chain's events over every pool. */
  source?: TradesSource;
  /** The list reaches the coin's first trade (the chain's events only), and none of its trades is left out. */
  whole?: boolean;
  /**
   * The chain's events only: of the swaps the events could not price themselves — since the coin was last read afresh —
   * how many took their price from the pools' trades (`filled`) and how many are not shown for want of one (`hidden`).
   * Every trade listed is whole.
   */
  events?: Readonly<{ filled: number; hidden: number }>;
  /** The creator the marks were made against, as Jupiter names it; null — not named. */
  creator?: string | null;
  /** What the trades' marks stand on. */
  labelBasis?: LabelBasis;
}>;

/* The tape is as fresh as the source's read of the pools' trades (`POOL_TRADES_TTL_MS`, shared by every instance). */
const TRADES_TTL_MS = POOL_TRADES_TTL_MS;
const trades = new Map<string, Cached<TokenTradesRead>>();

/**
 * The most of a coin's trades the chain's events may leave out for want of a price and still be its tape: past this
 * share the tape would stand with holes — a curve's sales missing reads as nobody selling — so the page shows the
 * pools' trades instead, as when the events are closed.
 */
export const EVENTS_HIDDEN_MOST = 0.1;
/** How long a coin whose events stood with holes reads the pools' trades before its events are asked again: no credits meanwhile. */
const EVENTS_REST_MS = 10 * 60_000;
const eventsResting = new Map<string, Cached<true>>();
/** The swaps of a coin's events that had no price of their own, each once, since the coin was last read afresh: those a pool's trade priced, and those not shown. */
type EventsTally = Readonly<{ filled: Set<string>; hidden: Set<string> }>;
const eventsTally = new Map<string, Cached<EventsTally>>();
const tradeKey = (trade: Readonly<{ signature: string; side: string }>): string => `${trade.signature}:${trade.side}`;

/** A wallet's own key is on the curve; a pool's, a vault's or a program's account is not. */
function isWalletAddress(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/**
 * The token's latest trades where it trades now: the busiest two of its pools by the last five minutes'
 * trades, merged newest first — one pool chosen by the day's dollars left BONK's and JUP's tapes minutes behind the
 * market. A refused read keeps the last trades for ten minutes, stated stale; with none it says why and names the pools
 * it would read, so the page can read them from the person's browser.
 */
export function readTokenTrades(mint: string): Promise<TokenTradesRead | TokenPageFailure> {
  const hit = fresh(trades, mint, TRADES_TTL_MS);
  if (hit) return Promise.resolve(withTopHolders(hit.value, mint));
  return once(`trades:${mint}`, async () => {
    const eventsOpen = !isNativeToken(mint) && tokenEventsEndpoint() !== null && !fresh(eventsResting, mint, EVENTS_REST_MS);
    /* With the chain's events open the busiest pools' trades are read only when the events fail or leave swaps without a price. */
    const [facts, first] = await Promise.all([readFacts(mint), eventsOpen ? Promise.resolve(null) : readMarketTrades(mint, "page")]);
    let early = first;
    const kept = fresh(trades, mint, STALE_GRACE_MS);
    const info = facts.ok ? facts.market : null;
    const stock = info?.category === "stock";
    const capSupply = stock ? null : capSupplyOf(info, facts.ok ? facts.facts : null);
    const multiplier = stock ? await scaledUnitMultiplier(mint, Date.now()) : null;
    const creator = facts.ok ? (facts.facts?.dev ?? null) : null;
    /* The chain's events over every pool, where the deployment opens them; else — or when they fail — the busiest pools' trades. */
    if (eventsOpen) {
      const known = kept?.value.source === "helius" ? { trades: kept.value.trades, whole: kept.value.whole === true } : null;
      const events = await readMintTradeEvents(mint, { capSupply, multiplier, solPriceUsd: await solPriceUsd(), isWallet: isWalletAddress }, known);
      if (events) {
        let list = events.trades;
        /* A refresh adds to what the list already left out — each swap once: the share is of the whole tape, not of one read. */
        const tally: EventsTally = (events.refreshed ? eventsTally.get(mint)?.value : undefined) ?? { filled: new Set<string>(), hidden: new Set<string>() };
        /* A swap the events could not price takes its price from the pools' trades by the same signature, or is not shown — never a row with dashes. */
        if (events.unpriced.length > 0) {
          early = await readMarketTrades(mint, "page");
          const spare = early.ok ? mergeTrades(early.bodies.map((body) => (body ? tradesOf(body, mint, capSupply, multiplier) : []))) : [];
          const fill = fillUnpriced(events.unpriced, spare, capSupply);
          for (const trade of fill.filled) tally.filled.add(tradeKey(trade));
          for (const entry of fill.left) tally.hidden.add(tradeKey(entry));
          if (fill.filled.length > 0) list = mergeEventTrades(fill.filled, list, EVENTS_TRADES_TARGET);
        }
        /* A swap that has its price now — a later read stood it with the market, or a pool's trade came — is hidden no more. */
        for (const trade of list) tally.hidden.delete(tradeKey(trade));
        remember(eventsTally, mint, tally);
        const filled = tally.filled.size;
        const hidden = tally.hidden.size;
        if (hidden <= (list.length + hidden) * EVENTS_HIDDEN_MOST) {
          const read = await readTokenPools(mint);
          const pool = read.ok ? tradesPoolOf(read.pools) : null;
          const pools = pool ? [pool] : [];
          const value: TokenTradesRead = { ok: true, trades: list, pool, pools, span: tradesSpan(list), capCounted: capSupply !== null, topHolders: [], observedAt: new Date().toISOString(), stale: false, source: "helius", whole: events.whole && hidden === 0, events: { filled, hidden }, creator };
          return settleTrades(mint, value);
        }
        /* Too many of this coin's trades have no price in the events: the pools' trades are its tape for a while, and its events are not asked meanwhile. */
        remember(eventsResting, mint, true);
      }
    }
    const market = early ?? (await readMarketTrades(mint, "page"));
    if (!market.ok) {
      if (kept) return withTopHolders({ ...kept.value, stale: true }, mint);
      if (market.code === "QUIET" || market.code === "NO_POOL") return { ok: false, code: "NO_POOL", reason: "No pool of this token traded in the last day." } as const;
      return { ...geckoFailure(market.code, market.reason, market.retryAfterMs), pools: market.pools ?? [] };
    }
    const list = mergeTrades(market.bodies.map((body) => (body ? tradesOf(body, mint, capSupply, multiplier) : [])));
    const pool = market.pools[0]!;
    const value: TokenTradesRead = { ok: true, trades: list, pool, pools: market.pools, span: tradesSpan(list), capCounted: capSupply !== null, topHolders: [], observedAt: market.observedAt, stale: market.stale, source: "geckoterminal", creator };
    return settleTrades(mint, value);
  });
}

/** How long a first trades read waits for its marks' reads. */
const MARKS_WAIT_MS = 1_200;

/**
 * A fresh trades read is kept, then what its marks stand on is read — the largest holders when none are
 * known, and the age of the largest buyers' wallets — at once and within a short wait. What does not answer in time
 * lands in its cache and marks the next answer: the marks are made at every answer from what is known
 * (`withTopHolders`), and `labelBasis` says what that was.
 */
async function settleTrades(mint: string, value: TokenTradesRead): Promise<TokenTradesRead> {
  remember(trades, mint, value);
  const settings = walletLabelSettings();
  const reads: Promise<unknown>[] = [readWalletAges(freshCandidates(value.trades, bookOf(mint, value), AGE_PER_READ), settings)];
  if (!fresh(holders, mint, STALE_GRACE_MS) && !isNativeToken(mint)) reads.push(readTokenHolders(mint));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(reads), new Promise((resolve) => (timer = setTimeout(resolve, MARKS_WAIT_MS)))]);
  clearTimeout(timer);
  return withTopHolders(value, mint);
}

/** SOL's price now, from the Spot market's own cached read; null when it is not quoted. */
async function solPriceUsd(): Promise<number | null> {
  const read = await readFacts(WRAPPED_SOL_MINT);
  return read.ok ? read.market.price : null;
}

/** What the engine knows of the wallets around a coin, from the reads already made. */
function bookOf(mint: string, read: TokenTradesRead): WalletBook {
  const known = fresh(holders, mint, STALE_GRACE_MS)?.value ?? null;
  const owners = known ? ownersOf(known.holders) : { pools: new Set<string>(), programs: new Set<string>() };
  if (read.pool) owners.pools.add(read.pool.address);
  const settings = walletLabelSettings();
  return {
    dev: read.creator ?? null,
    agents: ryntraAgents(),
    topHolders: known ? topHoldersOf(known.holders, settings.topHolderRanks) : null,
    poolOwners: owners.pools,
    programOwners: owners.programs,
    ages: knownAges(read.trades.map((trade) => trade.wallet)),
  };
}

/** The largest people the holders tab last read, ranked as it ranked them; nothing is read for it. And the trades' marks. */
function withTopHolders(read: TokenTradesRead, mint: string): TokenTradesRead {
  const known = fresh(holders, mint, STALE_GRACE_MS);
  const book = bookOf(mint, read);
  const settings = walletLabelSettings();
  const labelled = { ...read, trades: labelTrades(read.trades, book, settings), labelBasis: labelBasisOf(book, read.trades.map((trade) => trade.wallet), settings) };
  if (!known) return labelled;
  return { ...labelled, topHolders: known.value.holders.filter((row) => !row.labels.includes("program") && !row.labels.includes("pool")).slice(0, 10).map((row) => row.owner) };
}

/** The trades and the holders read last for a mint, without asking for them — the traders' table counts on them. */
export function knownTokenReads(mint: string): Readonly<{ trades: TokenTradesRead | null; holders: TokenHoldersRead | null }> {
  return { trades: fresh(trades, mint, STALE_GRACE_MS)?.value ?? null, holders: fresh(holders, mint, STALE_GRACE_MS)?.value ?? null };
}

/** The trades a page read last for a mint, without asking for them — the chart's marks use what the tab read. */
function knownTrades(mint: string): TokenTradesRead | null {
  return fresh(trades, mint, STALE_GRACE_MS)?.value ?? null;
}

/**
 * The supply the capitalisation at a trade is counted on: the circulating
 * supply Jupiter states, else the market cap over the price — the same
 * supply the chart's «Капіталізація» uses.
 */
function capSupplyOf(market: SpotMarket | null, facts: TokenFacts | null): number | null {
  if (facts?.circulatingSupply !== null && facts?.circulatingSupply !== undefined && facts.circulatingSupply > 0) return facts.circulatingSupply;
  if (market && market.price !== null && market.marketCapUsd !== null && market.price > 0) return market.marketCapUsd / market.price;
  return null;
}

/* ------------------------------------------------------------- holders */

export type TokenHoldersRead = Readonly<HolderRead & {
  ok: true;
  /** How far the list reaches — the node's twenty largest accounts, or every account of a small coin. */
  reach?: HoldersReach;
  /** The span of trades each holder's change is counted over; null when no trade was read. */
  span: Readonly<{ from: string; to: string }> | null;
  observedAt: string;
  stale: boolean;
}>;

const HOLDERS_TTL_MS = 90_000;
const holders = new Map<string, Cached<TokenHoldersRead>>();

/* A token account's owner is bytes 32–63 of its data, for the classic program and Token-2022 alike: one slice of 32 bytes
   per account is the whole read, which every node answers — a public one refused the parsed form of twenty accounts. */
const OWNER_SLICE = { offset: 32, length: 32 } as const;
const OWNER_CHUNK = 5;
const ADDRESS_DECODER = getAddressDecoder();
type SlicedAccount = { data?: readonly [string, string] | unknown } | null;

function ownerOf(info: SlicedAccount): string | null {
  const data = info?.data;
  if (!Array.isArray(data) || typeof data[0] !== "string") return null;
  const bytes = Buffer.from(data[0], "base64");
  return bytes.length === 32 ? String(ADDRESS_DECODER.decode(bytes)) : null;
}

/**
 * The largest holders, from the chain: the twenty largest token accounts of
 * the mint, their owners read in small batches, merged by owner, their share
 * of the supply, and the net of each one's trades in the span the page read.
 * An owner off the curve is a program's account — a pool, a lock, a vault, a
 * multisig — and is labelled so; it stays in the list, and the share such
 * accounts hold is said beside it.
 */
export function readTokenHolders(mint: string): Promise<TokenHoldersRead | TokenPageFailure> {
  const hit = fresh(holders, mint, HOLDERS_TTL_MS);
  if (hit) return Promise.resolve(hit.value);
  if (isNativeToken(mint)) return Promise.resolve({ ok: false, code: "NOT_READ", reason: "SOL is held by every wallet on the network; its holders are not listed." } as const);
  return once(`holders:${mint}`, async () => {
    const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 8_000 });
    const kept = fresh(holders, mint, STALE_GRACE_MS);
    const facts = await readFacts(mint);
    const market = facts.ok ? facts.market : null;
    /* Every account of a small coin where the deployment opens Helius DAS — up to a hundred holders; else the node's twenty largest. */
    const whole = await readHolderAccountsWhole(mint, market?.holders ?? null);
    let accounts: HolderAccount[];
    let supplyRaw: string;
    let decimals: number;
    try {
      const [largest, supply] = await Promise.all([
        whole ? null : handle.rpc.getTokenLargestAccounts(mint as never, { commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) }),
        handle.rpc.getTokenSupply(mint as never, { commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) }),
      ]);
      supplyRaw = String(supply.value.amount);
      decimals = Number(supply.value.decimals);
      const addresses = (largest?.value ?? []).map((entry) => String(entry.address));
      const amounts = (largest?.value ?? []).map((entry) => String(entry.amount));
      /* Five accounts a request: a public node blocks twenty in one and answers five. */
      const chunks: string[][] = [];
      for (let start = 0; start < addresses.length; start += OWNER_CHUNK) chunks.push(addresses.slice(start, start + OWNER_CHUNK));
      const answers = await Promise.all(
        chunks.map((chunk) => handle.rpc.getMultipleAccounts(chunk as never, { encoding: "base64", dataSlice: OWNER_SLICE, commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) })),
      );
      const infos = answers.flatMap((answer) => answer.value as readonly SlicedAccount[]);
      accounts = whole ? [...whole] : [];
      infos.forEach((info, index) => {
        const owner = ownerOf(info);
        if (!owner) return;
        accounts.push({ account: addresses[index] as string, owner, amountRaw: amounts[index] as string });
      });
    } catch (failure) {
      if (kept) return { ...kept.value, stale: true };
      return { ok: false, code: "UNREACHABLE", reason: `The node did not list the token's holders: ${failure instanceof Error ? failure.message.slice(0, 160) : "no answer"}` } as const;
    }
    if (!Number.isInteger(decimals)) return { ok: false, code: "MALFORMED", reason: "The node did not state the token's decimals." } as const;
    const programOwners = new Set<string>();
    for (const entry of accounts) {
      try {
        if (!PublicKey.isOnCurve(new PublicKey(entry.owner).toBytes())) programOwners.add(entry.owner);
      } catch {
        /* An owner that is no address is not labelled. */
      }
    }
    const tradeRead = knownTrades(mint);
    const multiplier = market?.category === "stock" ? await scaledUnitMultiplier(mint, Date.now()) : null;
    const read = holdersOf({
      accounts,
      decimals,
      supplyRaw,
      programOwners,
      dev: facts.ok ? (facts.facts?.dev ?? null) : null,
      trades: tradeRead ? tradeRead.trades : [],
      multiplier,
      limit: whole ? ALL_ACCOUNTS_CEILING : LARGEST_ACCOUNTS_CEILING,
    });
    const value: TokenHoldersRead = {
      ok: true,
      ...read,
      holders: withHolderValues(read.holders, market?.price ?? null, multiplier),
      reach: holdersReachOf(read.holders.length, whole !== null, market?.holders ?? null),
      span: tradeRead ? tradeRead.span : null,
      observedAt: new Date().toISOString(),
      stale: false,
    };
    remember(holders, mint, value);
    return value;
  });
}

/* ---------------------------------------------------------------- risk */

export type TokenRiskRead = Readonly<{ ok: true; facts: readonly RiskFact[]; observedAt: string; stale: boolean }>;

const HONEYPOT_TTL_MS = 30 * 60_000;
const honeypots = new Map<string, Cached<boolean | null>>();

async function readHoneypot(mint: string): Promise<boolean | null> {
  const hit = fresh(honeypots, mint, HONEYPOT_TTL_MS);
  if (hit) return hit.value;
  return once(`honeypot:${mint}`, async () => {
    const read = await getJson(`${GECKO_SOLANA_BASE}/tokens/${encodeURIComponent(mint)}/info`, "page");
    const value = read.ok ? honeypotOf(read.body) : null;
    /* A refused read is not remembered as «not stated» for half an hour. */
    if (read.ok) remember(honeypots, mint, value);
    return value;
  });
}

/** «Ризик» from the catalogue's facts at once, and GeckoTerminal's check when its budget allows — the chain's holders are the holders tab's. */
export async function readTokenRisk(mint: string): Promise<TokenRiskRead | TokenPageFailure> {
  const facts = await readFacts(mint);
  if (!facts.ok) return facts;
  const honeypot = isNativeToken(mint) || facts.market.category === "stock" ? undefined : await readHoneypot(mint);
  const list = riskFactsOf({ market: facts.market, facts: facts.facts, honeypot, now: Date.now() });
  return { ok: true, facts: list, observedAt: facts.observedAt, stale: facts.stale };
}

/* --------------------------------------------------------------- marks */

export type TokenMarksRead = Readonly<{ ok: true; marks: readonly TokenMark[]; facts: TokenFacts | null; observedAt: string }>;

/** The header's windows and the chart's marks — one read the page makes on arrival; the marks from the trades already read, else one read of them. */
export async function readTokenOverview(mint: string): Promise<TokenMarksRead | TokenPageFailure> {
  const facts = await readFacts(mint);
  if (!facts.ok) return facts;
  if (isNativeToken(mint)) return { ok: true, marks: [], facts: facts.facts, observedAt: facts.observedAt };
  const known = knownTrades(mint);
  const tradeRead = known ?? (await readTokenTrades(mint));
  const marks = marksOf({
    trades: tradeRead.ok ? tradeRead.trades : [],
    facts: facts.facts,
    supply: facts.market.category === "stock" ? null : capSupplyOf(facts.market, facts.facts),
    now: Date.now(),
  });
  return { ok: true, marks, facts: facts.facts, observedAt: facts.observedAt };
}

/** Test seam: forget every cached read. */
export function resetTokenPageCaches(): void {
  trades.clear();
  holders.clear();
  honeypots.clear();
  eventsResting.clear();
  eventsTally.clear();
  flying.clear();
}
