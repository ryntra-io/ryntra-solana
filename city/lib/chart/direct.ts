import {
  SOURCE_READ,
  TIMEFRAME_READ,
  candlesDescribe,
  candlesOfTimeframe,
  chooseSpotPool,
  normalizeCandles,
  ohlcvPath,
  type SpotSourceRead,
} from '../../../lib/spot/candles.ts';
import type { NormalizedCandle } from '../../../lib/chart/types.ts';
import { TRADE_POOLS, mergeTrades, poolsOf, tradePoolsOf, tradesOf, type TokenTrade } from '../../../lib/spot/token-page.ts';
import type { CandlesFetch, CandlesRead, Timeframe } from './candles.ts';

/**
 * The chart's spare way to its bars: the same source, read from the person's own browser.
 *
 * The engine reads GeckoTerminal from the platform's shared addresses, and the source counts its limit per address:
 * measured on 19.11 it refused after about five calls, so a chart nobody had opened yet waited 16 s or more for its
 * first bar. A person's browser has a limit of its own. Only when the engine refused (its 429 or 503) and has no bars
 * to give, the page reads the source itself:
 *
 *  - the pool the engine named in its refusal — the request carries the pool's address and the interval only; for a
 *    coin the engine has not read yet, the coin's pools by its address (public, the page's own address names it),
 *    and the pool is chosen by the engine's own rule (`chooseSpotPool`);
 *  - the bars pass the engine's own check (`candlesDescribe`) against the price on screen, or they are not drawn — no
 *    price on screen, no check, nothing drawn; the chart keeps saying «Chart in a moment»;
 *  - nothing of the person is sent: no wallet, no address of theirs, no cookie (the source is another origin).
 *
 * A read is kept for its interval's own time, so going through the intervals asks the source four times at most; a
 * refusal from the source pauses this browser's reads for the time it asks. A refusal the browser cannot read (a 429
 * without the source's CORS headers fails as `TypeError: Failed to fetch`, and the browser logs every one) pauses the
 * same way, longer each time in a row; until the source answers again, one read at a time goes out — the
 * others wait for it and ask only if it was answered — so one refusal is one line in the console, not one per read.
 * Pure but for the fetch passed in.
 */

export const DIRECT_BASE = 'https://api.geckoterminal.com/api/v2/networks/solana';

/** What the engine's refusal names of the pool it would read; the page reads that pool or, with none, chooses one. */
export type DirectPool = Readonly<{ address: string; side: 'base' | 'quote'; name: string | null }>;

/** The most reads this browser makes of the source in a minute — under the source's thirty a person. */
export const DIRECT_PER_MINUTE = 20;
/** A browser read that hangs is given up after this long: the chart's next try is never held up by it. */
const DIRECT_WAIT_MS = 8_000;

/**
 * The browser's own read of the source: no cookie, no referrer, never from the browser's cache, given up after
 * `DIRECT_WAIT_MS` or when the caller stops.
 */
export const directFetch: CandlesFetch = (url, init) => {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), DIRECT_WAIT_MS);
  const outer = init.signal;
  const relay = () => stop.abort();
  if (outer?.aborted) stop.abort();
  else outer?.addEventListener('abort', relay, { once: true });
  return fetch(url, { signal: stop.signal, headers: { accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  });
};

/** A refusal that names no wait — or one the browser cannot read — pauses this long; each next one in a row, twice as long. */
export const DIRECT_PAUSE_MS = 30_000;
/** The longest pause a run of refusals reaches. */
export const DIRECT_PAUSE_MAX_MS = 5 * 60_000;
const POOL_KEEP_MS = 10 * 60_000;
/** Bars this browser read stand in, stated stale, for at most this long; older, they are no bars. */
const BARS_HELD_MS = 30 * 60_000;

type Kept = Readonly<{ candles: readonly NormalizedCandle[]; pool: DirectPool; at: number }>;

const state = {
  calls: [] as number[],
  pausedUntil: 0,
  /** Refusals in a row since the source last answered. */
  refusals: 0,
  /** Whether the source is not known to answer: nothing answered yet, or the last read was refused. */
  doubt: true,
  /** The one read out while in doubt; the others wait for it. */
  probe: null as Promise<void> | null,
  bars: new Map<string, Kept>(),
  pools: new Map<string, Readonly<{ pool: DirectPool | null; at: number }>>(),
};

/** Test seam: forget every read and pause. */
export function resetDirect(): void {
  state.calls.length = 0;
  state.pausedUntil = 0;
  state.refusals = 0;
  state.doubt = true;
  state.probe = null;
  state.bars.clear();
  state.pools.clear();
  tradesKept.clear();
  tradePools.clear();
}

/** A call from this minute's budget, or false while spent or paused. */
function take(now: number): boolean {
  if (now < state.pausedUntil) return false;
  while (state.calls.length && now - state.calls[0]! > 60_000) state.calls.shift();
  if (state.calls.length >= DIRECT_PER_MINUTE) return false;
  state.calls.push(now);
  return true;
}

/** The source refused (`waitMs` — the wait it named, if any): this browser pauses, longer each time in a row. */
function refused(now: number, waitMs: number | null): void {
  state.refusals += 1;
  state.doubt = true;
  const own = Math.min(DIRECT_PAUSE_MS * 2 ** (state.refusals - 1), DIRECT_PAUSE_MAX_MS);
  state.pausedUntil = now + (waitMs !== null ? Math.min(waitMs, 120_000) : own);
}

/** The source answered: the pause and the doubt are over. */
function answered(): void {
  state.refusals = 0;
  state.doubt = false;
}

async function getJson(path: string, deps: Readonly<{ fetch: CandlesFetch; now: () => number; signal?: AbortSignal }>): Promise<unknown | null> {
  // While the source is in doubt, one read at a time: the others wait for it, then ask only if it was answered.
  while (state.doubt && state.probe) {
    await state.probe;
    if (deps.signal?.aborted) return null;
  }
  if (!take(deps.now())) return null;
  let done = (): void => undefined;
  const mine = state.doubt ? new Promise<void>((resolve) => (done = resolve)) : null;
  if (mine) state.probe = mine;
  try {
    let answer: Awaited<ReturnType<CandlesFetch>>;
    try {
      answer = await deps.fetch(`${DIRECT_BASE}${path}`, { signal: deps.signal });
    } catch {
      // A refusal the browser cannot read (a 429 without the source's CORS headers fails as a network error) pauses
      // as a 429 does; a read the caller stopped is no refusal.
      if (!deps.signal?.aborted) refused(deps.now(), null);
      return null;
    }
    if (answer.status === 429) {
      const wait = Number(answer.headers?.get('retry-after') ?? '');
      refused(deps.now(), Number.isFinite(wait) && wait > 0 ? wait * 1000 : null);
      return null;
    }
    answered();
    if (answer.status < 200 || answer.status >= 300) return null;
    try {
      return await answer.json();
    } catch {
      return null;
    }
  } finally {
    if (mine) {
      if (state.probe === mine) state.probe = null;
      done();
    }
  }
}

/** The pool the chart reads for a mint: the engine's, else the engine's rule over the coin's pools read here. */
async function poolOf(mint: string, named: DirectPool | null, deps: Readonly<{ fetch: CandlesFetch; now: () => number; signal?: AbortSignal }>): Promise<DirectPool | null> {
  if (named) return named;
  const kept = state.pools.get(mint);
  if (kept && deps.now() - kept.at < POOL_KEEP_MS) return kept.pool;
  const body = await getJson(`/tokens/${encodeURIComponent(mint)}/pools?page=1`, deps);
  if (body === null) return null;
  const choice = chooseSpotPool(body, mint);
  const pool = choice.pool ? { address: choice.pool.address, side: choice.pool.side, name: choice.pool.name } : null;
  state.pools.set(mint, { pool, at: deps.now() });
  return pool;
}

/**
 * One interval's bars read by this browser, or `unavailable` — never `none`: whether a market has a chart is the
 * engine's to say. `price` is the price on screen the bars must agree with; without it nothing is read.
 */
export async function readCandlesDirect(
  mint: string,
  timeframe: Timeframe,
  named: DirectPool | null,
  price: number | null,
  deps: Readonly<{ fetch: CandlesFetch; now: () => number; signal?: AbortSignal }>,
): Promise<CandlesRead> {
  const failed: CandlesRead = { status: 'unavailable', reason: 'busy' };
  if (price === null || !Number.isFinite(price) || price <= 0) return failed;
  const pool = await poolOf(mint, named, deps);
  if (!pool) return failed;
  const read: SpotSourceRead = TIMEFRAME_READ[timeframe].read;
  const key = `${pool.address}:${pool.side}:${read}`;
  const now = deps.now();
  let kept = state.bars.get(key);
  if (!kept || now - kept.at >= SOURCE_READ[read].ttlMs) {
    const body = await getJson(ohlcvPath(pool, read), deps);
    if (body !== null) {
      kept = { candles: normalizeCandles(body), pool, at: deps.now() };
      state.bars.set(key, kept);
    }
  }
  const age = kept ? deps.now() - kept.at : Number.POSITIVE_INFINITY;
  if (!kept || age > BARS_HELD_MS) return failed;
  const candles = candlesOfTimeframe(kept.candles, timeframe);
  // The engine's own check, against the price on screen: a chart that misses it is not drawn.
  if (!candles.length || !candlesDescribe(candles, price, deps.now()).ok) return failed;
  return { status: 'ready', timeframe, candles, pool: pool.name, observedAt: kept.at, stale: age >= SOURCE_READ[read].ttlMs, source: 'GeckoTerminal' };
}

const TRADES_KEEP_MS = 20_000;
const tradesKept = new Map<string, Readonly<{ body: unknown; at: number }>>();
const tradePools = new Map<string, Readonly<{ pools: readonly string[]; at: number }>>();

/**
 * A coin's latest trades read by this browser, when the engine refused with none held: the pools its
 * refusal names — else the coin's busiest by the engine's own rule (`tradePoolsOf`), kept ten minutes — each read by
 * its address only, merged newest first. The trades must agree with `price`, the price on screen (the newest's price
 * within the band the engine's check allows), or none are shown — a stock's raw-unit prices among them. Null when
 * nothing could be read. The capitalisation at a trade is the engine's to count: here it is left out.
 */
export async function readTradesDirect(mint: string, named: readonly string[], price: number | null, deps: Readonly<{ fetch: CandlesFetch; now: () => number; signal?: AbortSignal }>): Promise<TokenTrade[] | null> {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  let pools = named.filter((address) => BASE58.test(address)).slice(0, TRADE_POOLS);
  if (!pools.length) {
    const kept = tradePools.get(mint);
    if (kept && deps.now() - kept.at < POOL_KEEP_MS) pools = [...kept.pools];
    else {
      const body = await getJson(`/tokens/${encodeURIComponent(mint)}/pools?page=1`, deps);
      if (body === null) return null;
      pools = tradePoolsOf(poolsOf(body, mint, 20)).map((pool) => pool.address);
      tradePools.set(mint, { pools, at: deps.now() });
    }
  }
  if (!pools.length) return null;
  const lists: TokenTrade[][] = [];
  for (const pool of pools) {
    let kept = tradesKept.get(pool);
    if (!kept || deps.now() - kept.at >= TRADES_KEEP_MS) {
      const body = await getJson(`/pools/${encodeURIComponent(pool)}/trades`, deps);
      if (body !== null) {
        kept = { body, at: deps.now() };
        tradesKept.set(pool, kept);
      }
    }
    if (kept && deps.now() - kept.at < BARS_HELD_MS) lists.push(tradesOf(kept.body, mint, null));
  }
  if (!lists.length) return null;
  const trades = mergeTrades(lists);
  const newest = trades.find((trade) => trade.priceUsd !== null);
  if (newest && newest.priceUsd !== null) {
    const ratio = newest.priceUsd / price;
    if (ratio < 0.8 || ratio > 1.25) return null;
  }
  return trades;
}

/** The pools a refused trades read of the engine names: their addresses, nothing else. */
export function namedPools(body: unknown): string[] {
  const pools = body && typeof body === 'object' ? (body as { pools?: unknown }).pools : null;
  return Array.isArray(pools) ? pools.filter((address): address is string => typeof address === 'string' && BASE58.test(address)).slice(0, TRADE_POOLS) : [];
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The pool a refusal of the engine names, as the page reads it; null when it names none or names it wrongly. */
export function namedPool(body: unknown): DirectPool | null {
  const pool = body && typeof body === 'object' ? (body as { pool?: unknown }).pool : null;
  if (!pool || typeof pool !== 'object') return null;
  const { address, side, name } = pool as Record<string, unknown>;
  if (typeof address !== 'string' || !BASE58.test(address)) return null;
  if (side !== 'base' && side !== 'quote') return null;
  return { address, side, name: typeof name === 'string' && name ? name.slice(0, 96) : null };
}
