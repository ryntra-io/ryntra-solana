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
import { GECKO_SOLANA_BASE, getJson, readTokenPoolsBody, scaledUnitMultiplier } from "./candles.server.ts";
import type { SpotMarket } from "./markets.ts";
import { readSpotTokenFacts } from "./markets.server.ts";
import {
  holdersOf,
  honeypotOf,
  isNativeToken,
  marksOf,
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

export type TokenPageFailure = Readonly<{ ok: false; code: "NOT_LISTED" | "NO_POOL" | "UNREACHABLE" | "RATE_LIMITED" | "REFUSED" | "MALFORMED" | "NOT_READ"; reason: string }>;

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

function geckoFailure(code: string, reason: string): TokenPageFailure {
  return { ok: false, code: code === "RATE_LIMITED" ? "RATE_LIMITED" : code === "REFUSED" ? "REFUSED" : code === "MALFORMED" ? "MALFORMED" : "UNREACHABLE", reason };
}

/* --------------------------------------------------------------- facts */

export type TokenFactsRead = Readonly<{ ok: true; market: SpotMarket; facts: TokenFacts | null; observedAt: string; stale: boolean }>;

async function readFacts(mint: string): Promise<TokenFactsRead | TokenPageFailure> {
  const read = await readSpotTokenFacts(mint);
  if (!read.ok) return { ok: false, code: read.code === "RATE_LIMITED" ? "RATE_LIMITED" : "UNREACHABLE", reason: read.reason };
  if (!read.market) return { ok: false, code: "NOT_LISTED", reason: "Jupiter does not list this token." };
  return { ok: true, market: read.market, facts: read.facts, observedAt: read.observedAt, stale: read.stale };
}

/* --------------------------------------------------------------- pools */

export type TokenPoolsRead = Readonly<{ ok: true; pools: readonly TokenPool[]; observedAt: string }>;

export async function readTokenPools(mint: string): Promise<TokenPoolsRead | TokenPageFailure> {
  const read = await readTokenPoolsBody(mint, "page");
  if (!read.ok) return geckoFailure(read.code, read.reason);
  return { ok: true, pools: poolsOf(read.body, mint), observedAt: read.observedAt };
}

/* -------------------------------------------------------------- trades */

export type TokenTradesRead = Readonly<{
  ok: true;
  trades: readonly TokenTrade[];
  /** The pool the trades are of — where the token traded most in the last day. */
  pool: TokenPool;
  span: Readonly<{ from: string; to: string }> | null;
  /** Whether the capitalisation at each trade was counted (not for a tokenized stock). */
  capCounted: boolean;
  /** The largest holders' wallets the page last read for this mint, so a trade can say «a top holder»; empty when none was read. */
  topHolders: readonly string[];
  observedAt: string;
  stale: boolean;
}>;

const TRADES_TTL_MS = 45_000;
const trades = new Map<string, Cached<TokenTradesRead>>();

export function readTokenTrades(mint: string): Promise<TokenTradesRead | TokenPageFailure> {
  const hit = fresh(trades, mint, TRADES_TTL_MS);
  if (hit) return Promise.resolve(withTopHolders(hit.value, mint));
  return once(`trades:${mint}`, async () => {
    const [facts, pools] = await Promise.all([readFacts(mint), readTokenPools(mint)]);
    const kept = fresh(trades, mint, STALE_GRACE_MS);
    if (!pools.ok) return kept ? withTopHolders({ ...kept.value, stale: true }, mint) : pools;
    const pool = tradesPoolOf(pools.pools);
    if (!pool) return { ok: false, code: "NO_POOL", reason: "No pool of this token traded in the last day." } as const;
    const read = await getJson(`${GECKO_SOLANA_BASE}/pools/${encodeURIComponent(pool.address)}/trades?token=${encodeURIComponent(mint)}`, "page");
    if (!read.ok) return kept ? withTopHolders({ ...kept.value, stale: true }, mint) : geckoFailure(read.code, read.reason);
    const market = facts.ok ? facts.market : null;
    const stock = market?.category === "stock";
    const capSupply = stock ? null : capSupplyOf(market, facts.ok ? facts.facts : null);
    const multiplier = stock ? await scaledUnitMultiplier(mint, Date.now()) : null;
    const list = tradesOf(read.body, mint, capSupply, multiplier);
    const value: TokenTradesRead = { ok: true, trades: list, pool, span: tradesSpan(list), capCounted: capSupply !== null, topHolders: [], observedAt: new Date().toISOString(), stale: false };
    remember(trades, mint, value);
    return withTopHolders(value, mint);
  });
}

/** The largest people the holders tab last read, ranked as it ranked them; nothing is read for it. */
function withTopHolders(read: TokenTradesRead, mint: string): TokenTradesRead {
  const known = fresh(holders, mint, STALE_GRACE_MS);
  if (!known) return read;
  return { ...read, topHolders: known.value.holders.filter((row) => !row.labels.includes("program") && !row.labels.includes("pool")).slice(0, 10).map((row) => row.owner) };
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
    let accounts: HolderAccount[];
    let supplyRaw: string;
    let decimals: number;
    try {
      const [largest, supply] = await Promise.all([
        handle.rpc.getTokenLargestAccounts(mint as never, { commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) }),
        handle.rpc.getTokenSupply(mint as never, { commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) }),
      ]);
      supplyRaw = String(supply.value.amount);
      decimals = Number(supply.value.decimals);
      const addresses = largest.value.map((entry) => String(entry.address));
      const amounts = largest.value.map((entry) => String(entry.amount));
      /* Five accounts a request: a public node blocks twenty in one and answers five. */
      const chunks: string[][] = [];
      for (let start = 0; start < addresses.length; start += OWNER_CHUNK) chunks.push(addresses.slice(start, start + OWNER_CHUNK));
      const answers = await Promise.all(
        chunks.map((chunk) => handle.rpc.getMultipleAccounts(chunk as never, { encoding: "base64", dataSlice: OWNER_SLICE, commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) })),
      );
      const infos = answers.flatMap((answer) => answer.value as readonly SlicedAccount[]);
      accounts = [];
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
    const facts = await readFacts(mint);
    const tradeRead = knownTrades(mint);
    const market = facts.ok ? facts.market : null;
    const multiplier = market?.category === "stock" ? await scaledUnitMultiplier(mint, Date.now()) : null;
    const read = holdersOf({
      accounts,
      decimals,
      supplyRaw,
      programOwners,
      dev: facts.ok ? (facts.facts?.dev ?? null) : null,
      trades: tradeRead ? tradeRead.trades : [],
      multiplier,
    });
    const value: TokenHoldersRead = { ok: true, ...read, span: tradeRead ? tradeRead.span : null, observedAt: new Date().toISOString(), stale: false };
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
  flying.clear();
}
