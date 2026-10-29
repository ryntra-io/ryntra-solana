/**
 * Spot candles — the GeckoTerminal reads, cached and rate-disciplined.
 *
 * The public API allows thirty calls a minute per address and asks for
 * attribution. Both are honoured here rather than hoped for: every read goes
 * through one process-wide bucket of twenty-four calls a minute, a pool
 * resolution is kept for an hour, and a timeframe read is kept for its own TTL
 * and served stale for up to thirty minutes when the source rate-limits or
 * fails. A chart that cannot be read says so; it never shows a flat line.
 */

import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { multiplierFromChain } from "../stocks/units.ts";
import {
  TIMEFRAME_SOURCE,
  TIMEFRAME_TTL_MS,
  candlesDescribe,
  chooseSpotPool,
  normalizeCandles,
  rescaleCandles,
  type SpotCandlesRead,
  type SpotPool,
  type SpotTimeframe,
} from "./candles.ts";
import { readSpotMarket } from "./markets.server.ts";

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
const STALE_GRACE_MS = 30 * 60_000;
const BUCKET_PER_MINUTE = 24;
/* The chart is the page's first screen: the token page's own reads (its pools, trades, checks) stop while fewer than this
   many calls are left in the minute, so a page full of tabs never takes the chart down. */
const CHART_RESERVE = 8;
const CANDLE_LIMIT = 300;
/* A year and a day of daily bars: «1Р» on a company page in «Простий» is a
   year, not three hundred days. The source allows a thousand; the
   contract's schema allows the same. */
const DAILY_CANDLE_LIMIT = 366;
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

/* A sliding one-minute window. Refusing locally is what keeps the source from
   refusing us for the next minute, which would take every chart down at once. */
const calls: number[] = [];
function takeCall(priority: "chart" | "page"): boolean {
  const now = Date.now();
  while (calls.length > 0 && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= BUCKET_PER_MINUTE - (priority === "page" ? CHART_RESERVE : 0)) return false;
  calls.push(now);
  return true;
}

/** One read of GeckoTerminal inside this instance's minute budget — the chart, the pools and the trades share it. */
export async function getJson(url: string, priority: "chart" | "page" = "chart"): Promise<{ ok: true; body: unknown } | SpotCandlesFailure> {
  if (!takeCall(priority)) return { ok: false, code: "RATE_LIMITED", reason: "The chart source's minute budget is spent; the last read is shown." };
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: `GeckoTerminal did not answer: ${failure instanceof Error ? failure.message : String(failure)}` };
  }
  if (response.status === 429) {
    await response.body?.cancel();
    return { ok: false, code: "RATE_LIMITED", reason: "GeckoTerminal rate-limited the chart read." };
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

type PoolRefusal = "NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET";
const pools = new Map<string, { value: SpotPool | null; refusal: PoolRefusal | null; readAt: number }>();
/* The answer the choice was made from, kept for the token page's pools and trades: one read of the mint's pools serves both. */
const poolBodies = new Map<string, { body: unknown; readAt: number }>();
const POOL_BODY_TTL_MS = 5 * 60_000;

/**
 * GeckoTerminal's list of a mint's pools, as it answered — the chart's choice
 * and the token page's «Ліквідність» and trades read the same answer, kept
 * five minutes.
 */
export async function readTokenPoolsBody(mint: string, priority: "chart" | "page" = "chart"): Promise<{ ok: true; body: unknown; observedAt: string } | SpotCandlesFailure> {
  const hit = poolBodies.get(mint);
  const now = Date.now();
  if (hit && now - hit.readAt < POOL_BODY_TTL_MS) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString() };
  const read = await getJson(`${BASE}/tokens/${encodeURIComponent(mint)}/pools?page=1`, priority);
  if (!read.ok) {
    if (hit) return { ok: true, body: hit.body, observedAt: new Date(hit.readAt).toISOString() };
    return read;
  }
  poolBodies.set(mint, { body: read.body, readAt: now });
  return { ok: true, body: read.body, observedAt: new Date(now).toISOString() };
}
/* A refusal is remembered for less than a choice: a pool can be funded or
   wake up within the hour, and the frame should follow. */
const POOL_REFUSAL_TTL_MS = 10 * 60_000;

export async function resolveSpotPool(mint: string, priority: "chart" | "page" = "chart"): Promise<{ ok: true; pool: SpotPool } | SpotCandlesFailure> {
  const hit = pools.get(mint);
  const now = Date.now();
  if (hit && now - hit.readAt < (hit.value ? POOL_TTL_MS : POOL_REFUSAL_TTL_MS)) {
    if (hit.value) return { ok: true, pool: hit.value };
    const refusal = hit.refusal ?? "NO_POOL";
    return { ok: false, code: refusal, reason: NO_CHART_REASONS[refusal] };
  }
  const read = await readTokenPoolsBody(mint, priority);
  if (!read.ok) {
    if (hit?.value) return { ok: true, pool: hit.value };
    return read;
  }
  const choice = chooseSpotPool(read.body, mint);
  pools.set(mint, { value: choice.pool, refusal: choice.reason, readAt: now });
  if (choice.pool) return { ok: true, pool: choice.pool };
  return { ok: false, code: choice.reason, reason: NO_CHART_REASONS[choice.reason] };
}

const reads = new Map<string, { value: SpotCandlesRead; readAt: number }>();
/* A chart refused for what it showed — the wrong price, a stale bar — is not
   asked for again for ten minutes; the frame keeps saying why. */
const noChart = new Map<string, { code: "STALE" | "PRICE_MISMATCH"; at: number }>();
const NO_CHART_TTL_MS = 10 * 60_000;

/**
 * `priority`: a person's chart reads with "chart"; a read nobody is waiting on — the landing's tape (SOL-T4) — with
 * "page", which leaves the minute's reserve to the charts people have open.
 */
export async function readSpotCandles(mint: string, timeframe: SpotTimeframe, priority: "chart" | "page" = "chart"): Promise<SpotCandlesRead | SpotCandlesFailure> {
  const key = `${mint}:${timeframe}`;
  const hit = reads.get(key);
  const now = Date.now();
  if (hit && now - hit.readAt < TIMEFRAME_TTL_MS[timeframe]) return hit.value;
  const refused = noChart.get(key);
  if (refused && now - refused.at < NO_CHART_TTL_MS) return { ok: false, code: refused.code, reason: NO_CHART_REASONS[refused.code] };
  const resolved = await resolveSpotPool(mint, priority);
  if (!resolved.ok) {
    if (hit && now - hit.readAt < STALE_GRACE_MS) return { ...hit.value, stale: true };
    return resolved;
  }
  const source = TIMEFRAME_SOURCE[timeframe];
  const url = `${BASE}/pools/${encodeURIComponent(resolved.pool.address)}/ohlcv/${source.path}?aggregate=${source.aggregate}&limit=${timeframe === "1d" ? DAILY_CANDLE_LIMIT : CANDLE_LIMIT}&currency=usd&token=${resolved.pool.side}`;
  const read = await getJson(url, priority);
  if (!read.ok) {
    if (hit && now - hit.readAt < STALE_GRACE_MS) return { ...hit.value, stale: true };
    return read;
  }
  /* The source prices the raw base token; the page prices the scaled unit. */
  const candles = rescaleCandles(normalizeCandles(read.body), await scaledUnitMultiplier(mint, now));
  /* An empty list is an answer — a pool younger than one daily bar has no
     daily candles — and the page says so under the timeframe. A non-empty
     list must describe the asset on screen: its last close has to agree with
     the catalogue's current price and its newest bar has to be recent, or the
     frame says *Chart unavailable* rather than showing a chart that lies. */
  if (candles.length > 0) {
    const market = await readSpotMarket(mint);
    const price = market.ok && market.market ? market.market.price : null;
    const verdict = candlesDescribe(candles, price, now);
    if (!verdict.ok && verdict.reason !== "EMPTY") {
      reads.delete(key);
      noChart.set(key, { code: verdict.reason, at: now });
      return { ok: false, code: verdict.reason, reason: NO_CHART_REASONS[verdict.reason] };
    }
  }
  noChart.delete(key);
  const value: SpotCandlesRead = {
    ok: true,
    timeframe,
    candles,
    pool: resolved.pool,
    observedAt: new Date(now).toISOString(),
    stale: false,
    source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" },
  };
  reads.set(key, { value, readAt: now });
  return value;
}

/** Test seam. */
export function resetSpotCandleCaches(): void {
  pools.clear();
  poolBodies.clear();
  reads.clear();
  noChart.clear();
  multipliers.clear();
  calls.length = 0;
}
