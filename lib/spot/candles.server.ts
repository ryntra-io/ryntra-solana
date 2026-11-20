/**
 * Spot candles — the GeckoTerminal reads, cached and rate-disciplined.
 *
 * The public API allows thirty calls a minute per address and asks for
 * attribution. Both are honoured here rather than hoped for: every read goes
 * through one process-wide bucket of twenty-four calls a minute, a pool
 * resolution is kept for an hour, and a timeframe read is kept for its own TTL
 * and served stale — marked so — for hours when the source rate-limits or
 * fails. A chart that cannot be read says so; it never shows a flat line.
 *
 * The source's limit is one for every person, so a
 * read is shared by every instance of the deployment, not only by this one —
 * the platform's data cache holds each market's and interval's last good bars,
 * served while the next read runs behind them and kept when that read is
 * refused. Inside one instance the same question is one read (single-flight),
 * and a refusal for rate stops every read until the source's own `Retry-After`.
 *
 * Measured from the
 * deployment, the source refused after about five calls — its limit is counted
 * per address and the platform's addresses are shared — so the reads are fewer
 * and nobody waits on one:
 *
 *  - four reads serve the six intervals (`TIMEFRAME_READ`: the quarter hours
 *    from the five-minute bars, the four hours from the hours);
 *  - the pools of a mint and the trades of a pool are kept in the platform's
 *    data cache too, so every instance asks the source once;
 *  - bars held past fresh are answered at once, stated stale, and read again
 *    behind the answer (`spotReadsBehind` keeps the function alive for it);
 *  - an interval refused with nothing held stands in on a finer read's bars
 *    (`STAND_INS`), and a coin too young for the source's bars is drawn from
 *    its trades (`candlesFromTrades`);
 *  - a refusal answers the pool the chart would read, so the page can read the
 *    same pool from the person's own browser (`city/lib/chart/direct.ts`).
 */

import { after } from "next/server.js";

import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { multiplierFromChain } from "../stocks/units.ts";
import {
  SOURCE_READ,
  SPOT_MARKET_MIN_RESERVE_USD,
  STAND_INS,
  TIMEFRAME_READ,
  TRADE_BARS_MIN,
  candlesDescribe,
  candlesFromTrades,
  candlesOfTimeframe,
  chooseSpotPool,
  normalizeCandles,
  ohlcvPath,
  rescaleCandles,
  type SpotCandlesRead,
  type SpotPool,
  type SpotSourceRead,
  type SpotTimeframe,
} from "./candles.ts";
import type { NormalizedCandle } from "../chart/types.ts";
import { sharedRead } from "../stocks/shared-read.ts";
import { readSpotMarket } from "./markets.server.ts";
import { pauseAfterRate, ratePauseLeftMs, resetRatePauses } from "./shared-reads.ts";
import { mergeTrades, poolsOf, tradePoolsOf, tradesOf, type TokenPool, type TokenTrade } from "./token-page.ts";

const MULTIPLIER_TTL_MS = 10 * 60_000;
const multipliers = new Map<string, { value: number | null; at: number }>();

/**
 * The Scaled UI Amount multiplier of a mint, from the chain, cached ten
 * minutes — the one fact that turns the chart source's raw-unit prices into
 * the unit on screen. A mint that could not be read, or carries no such
 * extension, answers null and the candles stay as they came.
 */
/** The active multiplier of a scaled-UI token (a stock's reinvested dividends), cached ten minutes; null for any other token. */
export async function scaledUnitMultiplier(mint: string, now: number): Promise<number | null> {
  const hit = multipliers.get(mint);
  if (hit && now - hit.at < MULTIPLIER_TTL_MS) return hit.value;
  let value: number | null = null;
  try {
    const read = await readMintAccount(createSolanaRpcHandle({ network: "mainnet" }), mint);
    if (read.ok && read.decoded.extensions.__option === "Some") {
      const scaled = read.decoded.extensions.value.find((extension) => extension.__kind === "ScaledUiAmountConfig");
      if (scaled && scaled.__kind === "ScaledUiAmountConfig") {
        const effective = Number(scaled.newMultiplierEffectiveTimestamp);
        value = multiplierFromChain({ multiplier: scaled.multiplier, newMultiplier: scaled.newMultiplier, newMultiplierEffectiveAt: Number.isFinite(effective) && effective > 0 ? new Date(effective * 1000).toISOString() : null }, now).current;
      }
    }
  } catch {
    value = null;
  }
  multipliers.set(mint, { value, at: now });
  return value;
}

export const GECKO_SOLANA_BASE = "https://api.geckoterminal.com/api/v2/networks/solana";
const BASE = GECKO_SOLANA_BASE;
const POOL_TTL_MS = 60 * 60_000;
/* How long the last good bars are served, stated stale, while the source refuses: a day's bars two days, any other six
   hours (half an hour left an empty chart through a long refusal). */
const HELD_MS: Readonly<Record<SpotSourceRead, number>> = { m1: 6 * 3_600_000, m5: 6 * 3_600_000, h1: 6 * 3_600_000, d1: 48 * 3_600_000 };
/** The most markets and reads one instance keeps in memory; the oldest read leaves first. */
const MAX_HELD_READS = 600;
const BUCKET_PER_MINUTE = 24;
/* The chart is the page's first screen: the token page's own reads (its pools, trades, checks) stop while fewer than this
   many calls are left in the minute, so a page full of tabs never takes the chart down. */
const CHART_RESERVE = 8;
/* A pool's trades read is answered as it is for this long; the trades the tape shows are this fresh at most, past the
   edge's own seconds (the tape was minutes behind the market). Thirty seconds and the second pool only where
   it trades too keep the tape near the source's limit's old share. */
export const POOL_TRADES_TTL_MS = 30_000;
/** How long a pool's last trades stand in for a refused read, stated stale. */
const TRADES_HELD_MS = 10 * 60_000;
const RESPONSE_CEILING_BYTES = 512 * 1024;

export type SpotCandlesFailure = Readonly<{
  ok: false;
  code:
    | "NO_POOL"
    | "NO_MAJOR_QUOTE"
    | "THIN"
    | "QUIET"
    | "STALE"
    | "PRICE_MISMATCH"
    | "RATE_LIMITED"
    | "REFUSED"
    | "UNREACHABLE"
    | "MALFORMED";
  reason: string;
  /** After a refusal for rate: how long the source's reads pause in this instance. */
  retryAfterMs?: number | null;
  /** The pool the chart would read, where it is known: the page may read that pool from the person's browser. */
  pool?: SpotPool | null;
}>;

/** The reasons a market has no chart, in words the frame can print. */
export const NO_CHART_REASONS: Readonly<Record<"NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET" | "STALE" | "PRICE_MISMATCH", string>> = {
  NO_POOL: "No pool prices this asset on the chart source.",
  NO_MAJOR_QUOTE: "This asset is only paired against assets whose dollar price cannot be trusted.",
  THIN: "No pool for this asset holds enough liquidity to be called its market.",
  QUIET: "No pool for this asset traded in the last day.",
  STALE: "The newest candle is more than three days old.",
  PRICE_MISMATCH: "The pool's price does not agree with the market price of this asset.",
};

/* Until when the page's own reads wait after a refusal of one of them (`getJson`). */
let pagePausedUntil = 0;

/* A sliding one-minute window. Refusing locally is what keeps the source from
   refusing us for the next minute, which would take every chart down at once. */
const calls: number[] = [];
/** A call taken from the minute's budget (0), or how long until the budget has one again, ms. */
function takeCall(priority: "chart" | "page"): number {
  const now = Date.now();
  while (calls.length > 0 && now - calls[0] > 60_000) calls.shift();
  const room = BUCKET_PER_MINUTE - (priority === "page" ? CHART_RESERVE : 0);
  if (calls.length >= room) return Math.max(1_000, 60_000 - (now - calls[calls.length - room]!));
  calls.push(now);
  return 0;
}

/** One read of GeckoTerminal inside this instance's minute budget — the chart, the pools and the trades share it. */
export async function getJson(url: string, priority: "chart" | "page" = "chart"): Promise<{ ok: true; body: unknown } | SpotCandlesFailure> {
  /* After the source refused for rate, nothing is asked of it until its pause ends — a refused minute is not spent twice. */
  const paused = Math.max(ratePauseLeftMs("geckoterminal"), priority === "page" ? pagePausedUntil - Date.now() : 0);
  if (paused > 0) return { ok: false, code: "RATE_LIMITED", reason: "The chart source is pausing after a refusal for rate; the last read is shown.", retryAfterMs: paused };
  const wait = takeCall(priority);
  if (wait > 0) return { ok: false, code: "RATE_LIMITED", reason: "The chart source's minute budget is spent; the last read is shown.", retryAfterMs: wait };
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: `GeckoTerminal did not answer: ${failure instanceof Error ? failure.message : String(failure)}` };
  }
  if (response.status === 429) {
    const header = Number(response.headers.get("retry-after") ?? "");
    const wait = Number.isFinite(header) && header > 0 ? header * 1_000 : null;
    /* A refusal of a page's read (pools, trades) pauses the page's reads only: the charts people have open keep asking
       until the source refuses one of theirs. */
    const until = priority === "page" ? (pagePausedUntil = Math.max(pagePausedUntil, Date.now() + Math.min(30_000, wait ?? 15_000))) : pauseAfterRate("geckoterminal", wait);
    await response.body?.cancel();
    return { ok: false, code: "RATE_LIMITED", reason: "GeckoTerminal rate-limited the chart read.", retryAfterMs: Math.max(0, until - Date.now()) };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, code: "REFUSED", reason: `GeckoTerminal refused the read: HTTP ${response.status}` };
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RESPONSE_CEILING_BYTES) {
    await response.body?.cancel();
    return { ok: false, code: "MALFORMED", reason: "GeckoTerminal answered more than the chart can read." };
  }
  try {
    const text = await response.text();
    if (text.length > RESPONSE_CEILING_BYTES) return { ok: false, code: "MALFORMED", reason: "GeckoTerminal answered more than the chart can read." };
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch (failure) {
    return { ok: false, code: "MALFORMED", reason: failure instanceof Error ? failure.message : "GeckoTerminal returned unreadable JSON." };
  }
}

/** One read per key in flight: everyone asking the same thing at once waits on the same answer. */
const flying = new Map<string, Promise<unknown>>();
function once<T>(key: string, read: () => Promise<T>): Promise<T> {
  const pending = flying.get(key);
  if (pending) return pending as Promise<T>;
  const promise = read().finally(() => {
    if (flying.get(key) === promise) flying.delete(key);
  });
  flying.set(key, promise);
  return promise;
}

/* The reads made behind an answer already given: the request keeps the function alive for them (`after`),
   whichever route or reader asked. */
const behind = new Set<Promise<unknown>>();
function readBehind(key: string, read: () => Promise<unknown>): void {
  if (flying.has(key)) return;
  const promise = once(key, read).catch(() => undefined);
  behind.add(promise);
  void promise.finally(() => behind.delete(promise));
  try {
    after(() => promise.then(() => undefined));
  } catch {
    /* Outside a request (tests, scripts) the read simply runs. */
  }
}

/** The reads still running behind the answers given, if any. */
export function spotReadsBehind(): Promise<unknown> | null {
  return behind.size ? Promise.allSettled([...behind]) : null;
}

/**
 * A read every instance shares through the platform's data cache, kept `seconds` and then served while the next read
 * runs behind it. Only a good answer is kept; anything else comes back as it came. Outside a Next request (tests,
 * scripts) the data cache is absent and the read is made as it is.
 */
async function sharedOrNow<T extends { ok: boolean }>(key: readonly string[], seconds: number, read: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
  try {
    return await sharedRead(key, Math.max(5, Math.round(seconds)), read, keep);
  } catch {
    return read();
  }
}

/**
 * A shared read never trusted past its age: the data cache answers its old copy at once and
 * swallows a refused read behind it. A copy younger than `heldMs` is answered as it is — the data cache is already
 * reading the next one behind it, and the caller states the copy's age; an older copy is no copy at all: the source is read
 * here, now, and its answer — good or refused — is the answer.
 */
async function sharedRecent<T extends Readonly<{ ok: true; observedAt: string }>, F extends Readonly<{ ok: false }>>(
  key: readonly string[],
  seconds: number,
  read: () => Promise<T | F>,
  limits: Readonly<{ heldMs: number }>,
): Promise<T | F> {
  const shared = await sharedOrNow<T | F>(key, seconds, read, (value) => value.ok);
  if (!shared.ok) return shared;
  const age = Date.now() - Date.parse(shared.observedAt);
  if (!(age > limits.heldMs)) return shared;
  return read();
}

type PoolRefusal = "NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET";
const pools = new Map<string, { value: SpotPool | null; refusal: PoolRefusal | null; readAt: number; market: boolean }>();
/* The answer the choice was made from, kept for the token page's pools and trades: one read of the mint's pools serves both. */
const poolBodies = new Map<string, { body: unknown; readAt: number }>();
const POOL_BODY_TTL_MS = 5 * 60_000;

type PoolsBody = Readonly<{ ok: true; body: unknown; observedAt: string }>;

/**
 * GeckoTerminal's list of a mint's pools, as it answered — the chart's choice
 * and the token page's «Ліквідність» and trades read the same answer, kept
 * five minutes, in this instance and for every other.
 */
export async function readTokenPoolsBody(mint: string, priority: "chart" | "page" = "chart"): Promise<PoolsBody | SpotCandlesFailure> {
  const hit = poolBodies.get(mint);
  const now = Date.now();
  if (hit && now - hit.readAt < POOL_BODY_TTL_MS) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString() };
  /* The chart and the page's pools ask for the same mint at once: one read. */
  const read = await once(`pools:${mint}`, () =>
    sharedRecent<PoolsBody, SpotCandlesFailure>(
      ["spot-pools", "v1", mint],
      POOL_BODY_TTL_MS / 1000,
      async () => {
        const answer = await getJson(`${BASE}/tokens/${encodeURIComponent(mint)}/pools?page=1`, priority);
        return answer.ok ? { ok: true, body: answer.body, observedAt: new Date().toISOString() } : answer;
      },
      { heldMs: POOL_TTL_MS },
    ),
  );
  if (!read.ok) {
    if (hit && now - hit.readAt < POOL_TTL_MS) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString() };
    return read;
  }
  const at = Date.parse(read.observedAt);
  if (!hit || (Number.isFinite(at) && at > hit.readAt)) poolBodies.set(mint, { body: read.body, readAt: Number.isFinite(at) ? at : now });
  trim(poolBodies);
  /* The newer of this instance's copy and the shared one. */
  const kept = poolBodies.get(mint) ?? { body: read.body, readAt: Number.isFinite(at) ? at : now };
  return { ok: true, body: kept.body, observedAt: new Date(kept.readAt).toISOString() };
}
/* A refusal is remembered for less than a choice: a pool can be funded or
   wake up within the hour, and the frame should follow. */
const POOL_REFUSAL_TTL_MS = 10 * 60_000;

/**
 * The pool a mint's chart reads. `market` — the coin's own market pool, chosen because no pool against USDC, USDT or SOL
 * qualified: its bars are drawn only against a known market price, and the choice is kept ten minutes, not
 * an hour — a young coin moves pools within minutes.
 */
export async function resolveSpotPool(mint: string, priority: "chart" | "page" = "chart"): Promise<{ ok: true; pool: SpotPool; market?: boolean } | SpotCandlesFailure> {
  const hit = pools.get(mint);
  const now = Date.now();
  if (hit && now - hit.readAt < (hit.value && !hit.market ? POOL_TTL_MS : POOL_REFUSAL_TTL_MS)) {
    if (hit.value) return { ok: true, pool: hit.value, market: hit.market };
    const refusal = hit.refusal ?? "NO_POOL";
    return { ok: false, code: refusal, reason: NO_CHART_REASONS[refusal] };
  }
  const read = await readTokenPoolsBody(mint, priority);
  if (!read.ok) {
    if (hit?.value) return { ok: true, pool: hit.value, market: hit.market };
    return read;
  }
  const choice = chooseSpotPool(read.body, mint);
  const market = choice.pool !== null && choice.market === true;
  pools.set(mint, { value: choice.pool, refusal: choice.reason, readAt: now, market });
  trim(pools);
  if (choice.pool) return { ok: true, pool: choice.pool, market };
  return { ok: false, code: choice.reason, reason: NO_CHART_REASONS[choice.reason] };
}

/** The pool a chart of this mint reads, if this instance already knows it — nothing is read for it. */
export function knownSpotPool(mint: string): SpotPool | null {
  return pools.get(mint)?.value ?? null;
}

/* ------------------------------------------------------------- trades */

type PoolTradesBody = Readonly<{ ok: true; body: unknown; observedAt: string }>;
const poolTrades = new Map<string, { body: unknown; readAt: number }>();

/**
 * A pool's latest trades as the source answered them (its last few hundred), kept `POOL_TRADES_TTL_MS` in this instance
 * and for every other; a refused read answers the last good one for ten minutes, stated stale. The token page's tape
 * and a young coin's bars read the same answer. The request names the pool only.
 */
export async function readPoolTradesBody(pool: string, priority: "chart" | "page" = "page"): Promise<(PoolTradesBody & { stale: boolean }) | SpotCandlesFailure> {
  const hit = poolTrades.get(pool);
  const now = Date.now();
  if (hit && now - hit.readAt < POOL_TRADES_TTL_MS) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString(), stale: false };
  const read = await once(`trades:${pool}`, () =>
    sharedRecent<PoolTradesBody, SpotCandlesFailure>(
      ["spot-trades", "v1", pool],
      POOL_TRADES_TTL_MS / 1000,
      async () => {
        /* The tape has a budget of its own inside the minute's: trades never spend what the charts need. */
        if (ratePauseLeftMs("geckoterminal") <= 0 && pagePausedUntil <= Date.now() && !takeTradesCall()) return { ok: false, code: "RATE_LIMITED", reason: "The trades' share of the minute is spent; the last read is shown.", retryAfterMs: 5_000 };
        const answer = await getJson(`${BASE}/pools/${encodeURIComponent(pool)}/trades`, priority);
        return answer.ok ? { ok: true, body: answer.body, observedAt: new Date().toISOString() } : answer;
      },
      { heldMs: TRADES_HELD_MS },
    ),
  );
  if (!read.ok) {
    if (hit && now - hit.readAt < TRADES_HELD_MS) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString(), stale: true };
    return read;
  }
  const at = Date.parse(read.observedAt);
  const readAt = Number.isFinite(at) ? at : now;
  if (!hit || readAt > hit.readAt) poolTrades.set(pool, { body: read.body, readAt });
  trim(poolTrades);
  /* The newer of this instance's copy and the shared one; a copy past fresh says so. */
  const kept = poolTrades.get(pool) ?? { body: read.body, readAt };
  return { ok: true, body: kept.body, observedAt: new Date(kept.readAt).toISOString(), stale: now - kept.readAt > 2 * POOL_TRADES_TTL_MS };
}

/* The tape's own share of the minute: at most this many trades reads in one instance (the critic: two pools every
   few seconds would spend the source's limit and its pause would stop the charts). */
const TRADES_PER_MINUTE = 4;
const tradesCalls: number[] = [];
function takeTradesCall(): boolean {
  const now = Date.now();
  while (tradesCalls.length > 0 && now - tradesCalls[0]! > 60_000) tradesCalls.shift();
  if (tradesCalls.length >= TRADES_PER_MINUTE) return false;
  tradesCalls.push(now);
  return true;
}

/** The last trades a pool's read held in this instance, without asking for them. */
function heldPoolTrades(pool: string): { body: unknown; readAt: number } | null {
  const hit = poolTrades.get(pool);
  return hit && Date.now() - hit.readAt < TRADES_HELD_MS ? hit : null;
}

export type MarketTrades = Readonly<{
  ok: true;
  /** The pools read, the busiest first. */
  pools: readonly TokenPool[];
  /** Each pool's answer as the source gave it, in the order of `pools`; null where its read was refused. */
  bodies: readonly (unknown | null)[];
  observedAt: string;
  stale: boolean;
}>;

/**
 * A coin's trades where it trades now: its busiest pools by the last five minutes' trades (`tradePoolsOf`,
 * two), each read as above. One pool's refusal leaves the other's trades; both refused is the refusal.
 */
export async function readMarketTrades(mint: string, priority: "chart" | "page" = "page"): Promise<MarketTrades | (SpotCandlesFailure & { pools?: readonly TokenPool[] })> {
  const body = await readTokenPoolsBody(mint, priority);
  if (!body.ok) return body;
  const chosen = tradePoolsOf(poolsOf(body.body, mint, 20));
  if (!chosen.length) return { ok: false, code: "QUIET", reason: NO_CHART_REASONS.QUIET, pools: [] };
  const reads = await Promise.all(chosen.map((pool) => readPoolTradesBody(pool.address, priority)));
  const good = reads.filter((read) => read.ok);
  if (!good.length) {
    const refused = reads.find((read) => !read.ok);
    return { ...(refused as SpotCandlesFailure), pools: chosen };
  }
  const oldest = Math.min(...good.map((read) => Date.parse(read.observedAt)).filter(Number.isFinite));
  return {
    ok: true,
    pools: chosen,
    bodies: reads.map((read) => (read.ok ? read.body : null)),
    observedAt: new Date(Number.isFinite(oldest) ? oldest : Date.now()).toISOString(),
    stale: good.some((read) => read.stale) || good.length < reads.length,
  };
}

/** The trades held for a mint's busiest pools in this instance, parsed, and when the oldest of them was read; nothing is read for them. */
function heldMarketTrades(mint: string): { pool: TokenPool; trades: TokenTrade[]; readAt: number } | null {
  const body = poolBodies.get(mint)?.body;
  if (!body) return null;
  const chosen = tradePoolsOf(poolsOf(body, mint, 20));
  const held = chosen.map((pool) => heldPoolTrades(pool.address));
  const trades = mergeTrades(held.map((one) => (one ? tradesOf(one.body, mint, null, multipliers.get(mint)?.value ?? null) : [])));
  const times = held.flatMap((one) => (one ? [one.readAt] : []));
  return chosen[0] && trades.length && times.length ? { pool: chosen[0], trades, readAt: Math.min(...times) } : null;
}

/* ------------------------------------------------------------- candles */

type ReadBars = Readonly<{ ok: true; candles: readonly NormalizedCandle[]; pool: SpotPool; observedAt: string; stale: boolean }>;
/* Each mint's source reads (`m1`, `m5`, `h1`, `d1`), by the time they were read. */
const reads = new Map<string, { value: ReadBars; readAt: number }>();
/* A chart refused for what it showed — the wrong price, a stale bar — is not
   asked for again for ten minutes; the frame keeps saying why. */
const noChart = new Map<string, { code: "STALE" | "PRICE_MISMATCH"; at: number }>();
const NO_CHART_TTL_MS = 10 * 60_000;

/** How long a read's bars pass for fresh: two of its cache times, never under a minute. */
const freshForMs = (read: SpotSourceRead): number => Math.max(60_000, 2 * SOURCE_READ[read].ttlMs);

/**
 * `priority`: a person's chart reads with "chart"; a read nobody is waiting on — the landing's tape (SOL-T4) — with
 * "page", which leaves the minute's reserve to the charts people have open.
 */
export async function readSpotCandles(mint: string, timeframe: SpotTimeframe, priority: "chart" | "page" = "chart"): Promise<SpotCandlesRead | SpotCandlesFailure> {
  const { read } = TIMEFRAME_READ[timeframe];
  const answer = await readBars(mint, read, priority);
  if (answer.ok) return asTimeframe(answer, timeframe);
  /* Refused with nothing held: a finer read's bars held here stand in, gathered to this interval — the same trades,
     fewer bars back — stated stale. */
  if (answer.code === "RATE_LIMITED" || answer.code === "UNREACHABLE" || answer.code === "REFUSED" || answer.code === "MALFORMED") {
    for (const finer of STAND_INS[read]) {
      const held = reads.get(`${mint}:${finer}`);
      if (held && Date.now() - held.readAt < HELD_MS[finer] && held.value.candles.length) {
        const bars = candlesOfTimeframe(held.value.candles, timeframe);
        if (bars.length >= TRADE_BARS_MIN && !(await describes(mint, bars, Date.now()))) return { ...asTimeframe(held.value, timeframe), candles: bars, stale: true };
      }
    }
    /* Or the trades the token page already read for this coin — nothing more is asked of the source. */
    const young = await heldTradeBars(mint, SOURCE_READ_SECONDS[timeframe]);
    if (young) return { ok: true, timeframe, candles: young.candles, pool: young.pool, observedAt: young.observedAt, stale: true, source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" } };
  }
  return { ...answer, pool: answer.pool ?? knownSpotPool(mint) };
}

/** An interval's answer from its read's bars: gathered and windowed, with the read's pool, time and staleness. */
function asTimeframe(read: ReadBars, timeframe: SpotTimeframe): SpotCandlesRead {
  return { ok: true, timeframe, candles: candlesOfTimeframe(read.candles, timeframe), pool: read.pool, observedAt: read.observedAt, stale: read.stale, source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" } };
}

/**
 * Bars `seconds` long of the coin's trades this instance already holds (the token page's tape read them; nothing is
 * read for them), when their pool holds a market's floor (`SPOT_MARKET_MIN_RESERVE_USD`), there are enough bars and they
 * agree with a known market price — as old as the trades read.
 */
async function heldTradeBars(mint: string, seconds: number): Promise<{ candles: NormalizedCandle[]; pool: SpotPool; observedAt: string } | null> {
  const held = heldMarketTrades(mint);
  if (!held || (held.pool.reserveUsd ?? 0) < SPOT_MARKET_MIN_RESERVE_USD) return null;
  const bars = candlesFromTrades(held.trades, seconds);
  if (bars.length < TRADE_BARS_MIN) return null;
  if (await describes(mint, bars, Date.now(), true)) return null;
  return { candles: bars, pool: spotPoolOf(held.pool), observedAt: new Date(held.readAt).toISOString() };
}

const SOURCE_READ_SECONDS: Readonly<Record<SpotTimeframe, number>> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 };

/** A token page's pool as the chart names its pool. */
function spotPoolOf(pool: TokenPool): SpotPool {
  return { address: pool.address, name: pool.name, dex: pool.dex, side: pool.side, reserveUsd: pool.reserveUsd, volume24hUsd: pool.volume24hUsd };
}

/**
 * One source read of a mint: fresh from memory; held past fresh — answered at once, stated stale, and read
 * again behind the answer; else read once for every instance (the platform's data cache) and every request (single
 * flight). A refusal with bars held answers them, stated stale.
 */
async function readBars(mint: string, read: SpotSourceRead, priority: "chart" | "page"): Promise<ReadBars | SpotCandlesFailure> {
  const key = `${mint}:${read}`;
  const now = Date.now();
  const hit = reads.get(key);
  /* Fresh bars too are answered only while they agree with the market price (the instance that read them may have had none). */
  const agrees = hit ? !(await describes(mint, hit.value.candles, now)) : false;
  if (hit && agrees && now - hit.readAt < SOURCE_READ[read].ttlMs) return hit.value;
  const refused = noChart.get(key);
  if (refused && now - refused.at < NO_CHART_TTL_MS) return { ok: false, code: refused.code, reason: NO_CHART_REASONS[refused.code] };
  /* Held bars are answered at once only while they still agree with the market price: older ones that miss it wait for
     the read (the critic — a chart is never drawn against a price it disagrees with). */
  if (hit && agrees && now - hit.readAt < HELD_MS[read]) {
    readBehind(`bars:${key}`, () => refreshBars(mint, read, priority));
    return aged(hit.value, read, now);
  }
  return once(`bars:${key}`, () => refreshBars(mint, read, priority));
}

/**
 * The read shared by every instance, never trusted past its age: the data cache answers its old copy at once and
 * swallows a refused or refusing read behind it (a price that stopped agreeing never reached anyone), so a copy past
 * fresh is answered — stated stale — only while it agrees with the market price (the data cache reads the next one
 * behind it), and a copy past its hold, or one that no longer agrees, is no copy at all: the source is read now.
 */
async function refreshBars(mint: string, read: SpotSourceRead, priority: "chart" | "page"): Promise<ReadBars | SpotCandlesFailure> {
  const shared = await sharedOrNow<ReadBars | SpotCandlesFailure>(["spot-candles", "v2", mint, read], SOURCE_READ[read].ttlMs / 1000, () => readBarsNow(mint, read, priority), (value) => value.ok && !value.stale);
  if (shared.ok) {
    const age = Date.now() - Date.parse(shared.observedAt);
    /* Past its hold, or no longer agreeing with the market price (another instance may have had none to check it
       against): no copy at all — the source is read now. */
    if (age > HELD_MS[read] || (await describes(mint, shared.candles, Date.now()))) return settleBars(mint, read, await readBarsNow(mint, read, priority));
  }
  return settleBars(mint, read, shared);
}

/** A read's answer into this instance's memory: a refusal for what the bars showed is remembered, a blink keeps the held bars. */
async function settleBars(mint: string, read: SpotSourceRead, answer: ReadBars | SpotCandlesFailure): Promise<ReadBars | SpotCandlesFailure> {
  const key = `${mint}:${read}`;
  const now = Date.now();
  if (!answer.ok) {
    if (answer.code === "STALE" || answer.code === "PRICE_MISMATCH") {
      reads.delete(key);
      noChart.set(key, { code: answer.code, at: now });
      return answer;
    }
    const hit = reads.get(key);
    /* The source blinked: the last bars stay, stated stale. A market that has no chart now (no pool, a quiet one) says so. */
    const blink = answer.code === "RATE_LIMITED" || answer.code === "UNREACHABLE" || answer.code === "REFUSED" || answer.code === "MALFORMED";
    /* …while they still agree with the market price. */
    if (blink && hit && now - hit.readAt < HELD_MS[read] && !(await describes(mint, hit.value.candles, now))) return { ...hit.value, stale: true };
    return answer;
  }
  noChart.delete(key);
  remember(key, answer);
  /* The newer of this instance's bars and the answer — this instance's only while they agree with the market price. */
  const held = reads.get(key)?.value;
  const mine = held && held.observedAt !== answer.observedAt && !(await describes(mint, held.candles, now)) ? held : null;
  return aged(mine ?? (held && held.observedAt === answer.observedAt ? held : answer), read, now);
}

/** A read kept in this instance's memory by the time it was read (another instance's too) — never as fresher than it is. */
function remember(key: string, value: ReadBars): void {
  const at = Date.parse(value.observedAt);
  if (!Number.isFinite(at)) return;
  const held = reads.get(key);
  if (held && held.readAt >= at) return;
  reads.delete(key);
  reads.set(key, { value: { ...value, stale: false }, readAt: at });
  trim(reads);
}

function trim(map: Map<string, unknown>): void {
  while (map.size > MAX_HELD_READS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Bars older than fresh are stated stale, wherever they were kept: the chart says «Delayed» over them, not «Live». */
function aged(read: ReadBars, source: SpotSourceRead, now: number): ReadBars {
  const at = Date.parse(read.observedAt);
  const old = Number.isFinite(at) && now - at > freshForMs(source);
  return old && !read.stale ? { ...read, stale: true } : read;
}

/** An interval's answer aged as its read is (the landing's tape and the tests read it). */
export function agedRead(read: SpotCandlesRead, timeframe: SpotTimeframe, now: number): SpotCandlesRead {
  const at = Date.parse(read.observedAt);
  const old = Number.isFinite(at) && now - at > freshForMs(TIMEFRAME_READ[timeframe].read);
  return old && !read.stale ? { ...read, stale: true } : read;
}

/** The source's bars of the mint's chart pool now — or, for a pool too young for them, its held trades' bars. */
async function readBarsNow(mint: string, read: SpotSourceRead, priority: "chart" | "page"): Promise<ReadBars | SpotCandlesFailure> {
  const now = Date.now();
  const resolved = await resolveSpotPool(mint, priority);
  if (!resolved.ok) return resolved;
  /* The coin's own market pool (no major pool qualified) is drawn only against a known market price. */
  const needPrice = resolved.market === true;
  /* …so with no price to check against, nothing is spent on its bars (a blink: asked again). */
  if (needPrice && (await describes(mint, [], now, true))) return { ok: false, code: "UNREACHABLE", reason: "The market price to check the chart against could not be read.", pool: resolved.pool };
  const answer = await getJson(`${BASE}${ohlcvPath(resolved.pool, read)}`, priority);
  if (!answer.ok) return { ...answer, pool: resolved.pool };
  /* The source prices the raw base token; the page prices the scaled unit. */
  const candles = rescaleCandles(normalizeCandles(answer.body), await scaledUnitMultiplier(mint, now));
  if (candles.length === 0) {
    /* A pool younger than one of the read's bars has none yet: the trades this instance holds of it may — nothing more is
       asked of the source for them. An empty list is an answer otherwise. */
    const young = await heldTradeBars(mint, SOURCE_READ[read].seconds);
    if (young) return { ok: true, candles: young.candles, pool: resolved.pool, observedAt: young.observedAt, stale: false };
  } else {
    /* A non-empty list must describe the asset on screen: its last close has to agree with the catalogue's current price
       and its newest bar has to be recent, or the frame says *Chart unavailable* rather than showing a chart that lies. */
    const verdict = await describes(mint, candles, now, needPrice);
    if (verdict) return { ...verdict, pool: resolved.pool };
  }
  return { ok: true, candles, pool: resolved.pool, observedAt: new Date(now).toISOString(), stale: false };
}

/**
 * Null when the bars describe the asset; else the refusal the frame prints. `needPrice` — bars of a market pool or of
 * trades: without the market price to check them against they are not drawn (a blink, not a verdict: asked again).
 */
async function describes(mint: string, candles: readonly NormalizedCandle[], now: number, needPrice = false): Promise<SpotCandlesFailure | null> {
  const market = await readSpotMarket(mint);
  const price = market.ok && market.market ? market.market.price : null;
  if (needPrice && (price === null || !(price > 0))) return { ok: false, code: "UNREACHABLE", reason: "The market price to check the chart against could not be read." };
  const verdict = candlesDescribe(candles, price, now);
  if (verdict.ok || verdict.reason === "EMPTY") return null;
  return { ok: false, code: verdict.reason, reason: NO_CHART_REASONS[verdict.reason] };
}

/** Test seam. */
export function resetSpotCandleCaches(): void {
  pools.clear();
  poolBodies.clear();
  poolTrades.clear();
  reads.clear();
  noChart.clear();
  multipliers.clear();
  flying.clear();
  behind.clear();
  calls.length = 0;
  tradesCalls.length = 0;
  pagePausedUntil = 0;
  resetRatePauses();
}
