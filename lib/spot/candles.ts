/**
 * Spot candles — pure shapes and the pool choice behind the chart.
 *
 * Jupiter Price V3 is current-only (its own FAQ: *Historical prices — Not
 * available*), so candles come from a separate market-data source:
 * GeckoTerminal's public OHLCV, per pool, keyless and documented at
 * apiguide.geckoterminal.com. A chart is therefore the price of one pool — the
 * deepest one for the mint — in USD, and the page says which pool and which
 * venue in Asset details rather than presenting it as *the* price. The header
 * price stays Jupiter's, which is the aggregate every route is quoted against.
 *
 * Pure: the fetch lives in `candles.server.ts`.
 */

import type { UTCTimestamp } from "lightweight-charts";

import type { NormalizedCandle } from "../chart/types.ts";

export const SPOT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type SpotTimeframe = (typeof SPOT_TIMEFRAMES)[number];

export function isSpotTimeframe(value: unknown): value is SpotTimeframe {
  return typeof value === "string" && (SPOT_TIMEFRAMES as readonly string[]).includes(value);
}

/** GeckoTerminal's `{timeframe}?aggregate=` pair for each of ours. */
export const TIMEFRAME_SOURCE: Readonly<Record<SpotTimeframe, Readonly<{ path: "minute" | "hour" | "day"; aggregate: 1 | 4 | 5 | 15; seconds: number }>>> = {
  "1m": { path: "minute", aggregate: 1, seconds: 60 },
  "5m": { path: "minute", aggregate: 5, seconds: 300 },
  "15m": { path: "minute", aggregate: 15, seconds: 900 },
  "1h": { path: "hour", aggregate: 1, seconds: 3_600 },
  "4h": { path: "hour", aggregate: 4, seconds: 14_400 },
  "1d": { path: "day", aggregate: 1, seconds: 86_400 },
};

/** How long a read of each timeframe stays fresh. A one-minute bar is stale in twenty seconds; a daily one in ten minutes. */
export const TIMEFRAME_TTL_MS: Readonly<Record<SpotTimeframe, number>> = {
  "1m": 20_000,
  "5m": 45_000,
  "15m": 45_000,
  "1h": 120_000,
  "4h": 120_000,
  "1d": 600_000,
};

/**
 * The source's reads behind the six intervals: four, not six. The chart source refuses after a few calls a
 * minute from the platform's shared addresses (measured 19.11: MET's fifth read was a 429), so the quarter hours are the
 * five-minute bars three by three and the four hours the hours four by four — one read serves two intervals, and a
 * person going through the intervals costs the source four reads at most. Each read asks the source's own ceiling of
 * bars (a thousand), so the coarser interval still has days of them.
 */
export const SPOT_SOURCE_READS = ["m1", "m5", "h1", "d1"] as const;
export type SpotSourceRead = (typeof SPOT_SOURCE_READS)[number];

export const SOURCE_READ: Readonly<Record<SpotSourceRead, Readonly<{ path: "minute" | "hour" | "day"; aggregate: 1 | 5; seconds: number; limit: number; ttlMs: number }>>> = {
  m1: { path: "minute", aggregate: 1, seconds: 60, limit: 300, ttlMs: TIMEFRAME_TTL_MS["1m"] },
  m5: { path: "minute", aggregate: 5, seconds: 300, limit: 1000, ttlMs: TIMEFRAME_TTL_MS["5m"] },
  h1: { path: "hour", aggregate: 1, seconds: 3_600, limit: 1000, ttlMs: TIMEFRAME_TTL_MS["1h"] },
  /* A year and a day of daily bars: «1Р» on a company page is a year. */
  d1: { path: "day", aggregate: 1, seconds: 86_400, limit: 366, ttlMs: TIMEFRAME_TTL_MS["1d"] },
};

/** Which read each interval is drawn from, and how many of its bars make one of the interval's. */
export const TIMEFRAME_READ: Readonly<Record<SpotTimeframe, Readonly<{ read: SpotSourceRead; group: number }>>> = {
  "1m": { read: "m1", group: 1 },
  "5m": { read: "m5", group: 1 },
  "15m": { read: "m5", group: 3 },
  "1h": { read: "h1", group: 1 },
  "4h": { read: "h1", group: 4 },
  "1d": { read: "d1", group: 1 },
};

/** The most bars an interval answers: the chart's window (a year and a day of daily bars). */
export const TIMEFRAME_LIMIT: Readonly<Record<SpotTimeframe, number>> = { "1m": 300, "5m": 300, "15m": 300, "1h": 300, "4h": 300, "1d": 366 };

/** The source's OHLCV path of a pool for one read: the price of `side` in dollars. Pool address and interval only. */
export function ohlcvPath(pool: Readonly<{ address: string; side: "base" | "quote" }>, read: SpotSourceRead): string {
  const source = SOURCE_READ[read];
  return `/pools/${encodeURIComponent(pool.address)}/ohlcv/${source.path}?aggregate=${source.aggregate}&limit=${source.limit}&currency=usd&token=${pool.side}`;
}

/**
 * Bars gathered `seconds` long: each bar of the interval opens at a multiple of `seconds` (UTC), opens at its first
 * bar's open, closes at its last close, its high and low the extremes, its volume the sum (absent when none of its bars
 * stated one). Oldest first in, oldest first out.
 */
export function groupCandles(candles: readonly NormalizedCandle[], seconds: number): NormalizedCandle[] {
  if (!(seconds > 0)) return [...candles];
  const out: NormalizedCandle[] = [];
  for (const candle of candles) {
    const time = (Math.floor(candle.time / seconds) * seconds) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      if (candle.volume !== undefined) last.volume = (last.volume ?? 0) + candle.volume;
    } else {
      out.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close, ...(candle.volume !== undefined ? { volume: candle.volume } : {}) });
    }
  }
  return out;
}

/**
 * An interval's bars from finer or equal bars — its own read's, or a finer read standing in: gathered to the interval
 * (bars already of its size stay as they are, the source's bars open on their interval), the newest of its window.
 */
export function candlesOfTimeframe(readBars: readonly NormalizedCandle[], timeframe: SpotTimeframe): NormalizedCandle[] {
  return groupCandles(readBars, TIMEFRAME_SOURCE[timeframe].seconds).slice(-TIMEFRAME_LIMIT[timeframe]);
}

/**
 * The reads an interval can be drawn from when its own was refused and none of it is held, finest last: the
 * neighbouring read's bars gathered to the interval — the same trades, fewer bars back. Only finer reads stand in: a coarse bar cannot be cut into fine ones.
 */
export const STAND_INS: Readonly<Record<SpotSourceRead, readonly SpotSourceRead[]>> = {
  m1: [],
  m5: ["m1"],
  h1: ["m5", "m1"],
  d1: ["h1", "m5"],
};

/**
 * Bars counted from trades: a coin too young for the source's bars — its pool a curve that opened minutes
 * ago — still has its trades, and each is a price at a moment. A bar of `seconds` opens at its first trade's price and
 * closes at its last; its volume is the dollars traded in it. A trade without a price, or at no price, is no bar.
 * Trades may come newest first; bars leave oldest first. Nothing is filled between trades: an empty minute is no bar.
 */
export function candlesFromTrades(trades: readonly Readonly<{ at: string; priceUsd: number | null; usd: number | null }>[], seconds: number): NormalizedCandle[] {
  if (!(seconds > 0)) return [];
  const points = trades
    .map((trade) => ({ t: Date.parse(trade.at) / 1000, price: trade.priceUsd, usd: trade.usd }))
    .filter((point): point is { t: number; price: number; usd: number | null } => Number.isFinite(point.t) && point.price !== null && Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.t - b.t);
  const out: NormalizedCandle[] = [];
  for (const point of points) {
    const time = (Math.floor(point.t / seconds) * seconds) as UTCTimestamp;
    const last = out[out.length - 1];
    const usd = point.usd !== null && Number.isFinite(point.usd) && point.usd > 0 ? point.usd : 0;
    if (last && last.time === time) {
      last.high = Math.max(last.high, point.price);
      last.low = Math.min(last.low, point.price);
      last.close = point.price;
      last.volume = (last.volume ?? 0) + usd;
    } else {
      out.push({ time, open: point.price, high: point.price, low: point.price, close: point.price, volume: usd });
    }
  }
  return out;
}

/** Fewer bars than this from trades is no chart: two prices are a line, not a market's picture. */
export const TRADE_BARS_MIN = 3;

export type SpotPool = Readonly<{
  address: string;
  name: string;
  dex: string | null;
  /** Which side of the pool the mint is on; the OHLCV read prices that side. */
  side: "base" | "quote";
  reserveUsd: number | null;
  volume24hUsd: number | null;
}>;

type GeckoPoolRow = Readonly<{
  attributes?: { address?: unknown; name?: unknown; reserve_in_usd?: unknown; pool_created_at?: unknown; volume_usd?: { h24?: unknown } };
  relationships?: {
    base_token?: { data?: { id?: unknown } };
    quote_token?: { data?: { id?: unknown } };
    dex?: { data?: { id?: unknown } };
  };
}>;

/** The quotes a price is usually stated against: the two dollar stables and SOL. */
const STABLE_QUOTES: ReadonlySet<string> = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const MAJOR_QUOTES: ReadonlySet<string> = new Set([...STABLE_QUOTES, WRAPPED_SOL]);

/** A pool against a major quote thinner than this is not the market of a coin that has a deeper one. */
export const SPOT_POOL_MIN_RESERVE_USD = 10_000;

/**
 * The floor of a young coin's own market: when no pool against USDC, USDT or SOL holds
 * {@link SPOT_POOL_MIN_RESERVE_USD}, the pool the coin trades in most is its market, whatever it is paired with (a
 * pump.fun coin launched against another coin — Lucia/DCTY, Sparrow/ANTHRP on 19.11), if it holds at least this much.
 * The source prices it in dollars and the close must still agree with the market price (`candlesDescribe`).
 */
export const SPOT_MARKET_MIN_RESERVE_USD = 250;

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function tokenIdMint(id: unknown): string | null {
  return typeof id === "string" && id.startsWith("solana_") ? id.slice("solana_".length) : null;
}

export type SpotPoolChoice =
  /** `market` — the coin's own market pool, chosen because no major pool qualified: drawn only against a known price. */
  | Readonly<{ pool: SpotPool; reason: null; market?: true }>
  | Readonly<{ pool: null; reason: "NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET" }>;

/**
 * The pool that is allowed to be the chart, or the reason there is none.
 *
 * A chart of *the* price is a chart of one pool, so the choice is a rule
 * rather than a score. A pool qualifies only if the exact mint is one of its
 * two sides, the **other** side is a major quote — USDC, USDT or SOL, the only
 * ones whose USD conversion is trustworthy — it holds at least
 * {@link SPOT_POOL_MIN_RESERVE_USD} of reserves, and it traded in the last
 * day. Among those, for SOL itself the mint on the base side against a stable
 * comes first, then the base side against SOL, then the mint as a quote, ties
 * by depth; for every other mint the pool that traded most over the day — the
 * market's main pair — ties by depth.
 *
 * Depth alone chose a week-old meme/SOL pool for SOL itself, because SOL is
 * the quote in most pools and a hot launch can out-reserve Orca for a day.
 * That is what the rule is for: a wrong chart is worse than none. And «a stable
 * first» for everyone charted Bonk from a side pool against USDC whose last
 * trade was 18 minutes old while BONK/SOL traded every second (B15): a meme's
 * market is where it trades.
 *
 * A young coin often has no such pool at all — its curve or its first
 * pool is paired with another coin, or holds a few thousand dollars — and the
 * rule left fourteen of fifteen Pulse coins without a chart on 19.11. When no
 * major pool qualifies, the coin's own market stands in: the pool it traded in
 * most over the day that holds at least {@link SPOT_MARKET_MIN_RESERVE_USD},
 * whatever its other side. SOL keeps its rule alone. The chart is still refused
 * if its close misses the market price (`candlesDescribe`).
 */
export function chooseSpotPool(body: unknown, mint: string): SpotPoolChoice {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data as GeckoPoolRow[]) : null;
  if (!data) return { pool: null, reason: "NO_POOL" };
  let anyPool = false;
  let anyMajor = false;
  let anyDeep = false;
  let anyActive = false;
  let best: { pool: SpotPool; rank: number } | null = null;
  let market: SpotPool | null = null;
  for (const row of data) {
    const address = typeof row.attributes?.address === "string" ? row.attributes.address : null;
    if (!address) continue;
    const base = tokenIdMint(row.relationships?.base_token?.data?.id);
    const quote = tokenIdMint(row.relationships?.quote_token?.data?.id);
    const side: "base" | "quote" | null = base === mint ? "base" : quote === mint ? "quote" : null;
    if (!side) continue;
    anyPool = true;
    const other = side === "base" ? quote : base;
    const reserve = asNumber(row.attributes?.reserve_in_usd);
    const volume24h = asNumber(row.attributes?.volume_usd?.h24);
    const pool: SpotPool = {
      address,
      name: typeof row.attributes?.name === "string" ? row.attributes.name : address,
      dex: typeof row.relationships?.dex?.data?.id === "string" ? row.relationships.dex.data.id : null,
      side,
      reserveUsd: reserve,
      volume24hUsd: volume24h,
    };
    const active = volume24h !== null && volume24h > 0;
    if (active) anyActive = true;
    /* The coin's own market, whatever it is paired with: the busiest pool over the floor (ties by depth). */
    if (active && reserve !== null && reserve >= SPOT_MARKET_MIN_RESERVE_USD && other !== null && mint !== WRAPPED_SOL) {
      if (!market || volume24h > (market.volume24hUsd ?? 0) || (volume24h === market.volume24hUsd && reserve > (market.reserveUsd ?? 0))) market = pool;
    }
    if (other === null || !MAJOR_QUOTES.has(other)) continue;
    anyMajor = true;
    if (reserve === null || reserve < SPOT_POOL_MIN_RESERVE_USD) continue;
    anyDeep = true;
    if (!active) continue;
    /* SOL by the quote it is stated against; everything else by where it trades. */
    const rank = mint === WRAPPED_SOL ? (side === "base" ? (STABLE_QUOTES.has(other) ? 3 : 2) : 1) : volume24h;
    if (!best || rank > best.rank || (rank === best.rank && reserve > (best.pool.reserveUsd ?? 0))) best = { pool, rank };
  }
  if (best) return { pool: best.pool, reason: null };
  if (market) return { pool: market, reason: null, market: true };
  if (!anyPool) return { pool: null, reason: "NO_POOL" };
  /* SOL's chart is a major pool or none. Any other coin: no pool traded in the day, or every pool that did holds less
     than a market's floor. A coin paired only with coins of no dollar price is no longer refused for that — the source
     prices its pool, and the close is checked against the market. */
  if (mint === WRAPPED_SOL) return { pool: null, reason: !anyMajor ? "NO_MAJOR_QUOTE" : !anyDeep ? "THIN" : "QUIET" };
  return { pool: null, reason: anyActive ? "THIN" : "QUIET" };
}

/**
 * Do these candles describe the asset on screen?
 *
 * The last close must agree with the catalogue's own current price for the
 * mint within a wide band — a chart of the wrong side, the wrong token or a
 * pool that stopped tracking the market misses it by far more than any real
 * spread — and the newest bar must be recent. Both are cheap, and either
 * failing means *Chart unavailable* rather than a chart that lies.
 */
export function candlesDescribe(
  candles: readonly NormalizedCandle[],
  marketPriceUsd: number | null,
  now: number,
): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "EMPTY" | "STALE" | "PRICE_MISMATCH" }> {
  if (candles.length === 0) return { ok: false, reason: "EMPTY" };
  const last = candles[candles.length - 1];
  if (now / 1000 - last.time > 3 * 86_400) return { ok: false, reason: "STALE" };
  if (marketPriceUsd !== null && marketPriceUsd > 0) {
    const ratio = last.close / marketPriceUsd;
    if (ratio < 0.8 || ratio > 1.25) return { ok: false, reason: "PRICE_MISMATCH" };
  }
  return { ok: true };
}

/**
 * The chart's last bar at the page's one last price (B15): the header, the ticket and the chart print one figure, as a
 * terminal's header is its last bar. The live price closes the bar of the moment — a new bar from the last close when
 * the moment's bar has not come from the source yet — and stretches its high or low to it. A price that misses the
 * last close by the band `candlesDescribe` refuses, a clock behind the bars, or no price leaves the candles as read.
 */
export function withLivePrice(
  candles: readonly NormalizedCandle[],
  price: number | null,
  nowSeconds: number,
  timeframeSeconds: number,
): NormalizedCandle[] {
  if (candles.length === 0 || price === null || !Number.isFinite(price) || price <= 0 || !(timeframeSeconds > 0)) return [...candles];
  const last = candles[candles.length - 1];
  const bucket = (Math.floor(nowSeconds / timeframeSeconds) * timeframeSeconds) as UTCTimestamp;
  if (last.time > bucket) return [...candles];
  const ratio = price / last.close;
  if (ratio < 0.8 || ratio > 1.25) return [...candles];
  if (last.time === bucket) return [...candles.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
  return [...candles, { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }];
}

/**
 * The chart source prices the raw base token; the venue, the wallet and every
 * figure on the page price the scaled unit (the Scaled UI Amount extension:
 * one base token stands for `multiplier` scaled units). Candles are brought
 * onto the page's unit by dividing each price by the multiplier — the dollar
 * volume is a dollar volume and does not move. A multiplier of one, or none,
 * leaves the candles as they came (before this, NFLXx at ×10 and OPENAI at
 * ×1.486 had no chart, because the raw-unit close was ten times the price on
 * screen).
 */
export function rescaleCandles(candles: readonly NormalizedCandle[], multiplier: number | null): NormalizedCandle[] {
  if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0 || Math.abs(multiplier - 1) < 1e-9) return [...candles];
  return candles.map((candle) => ({ ...candle, open: candle.open / multiplier, high: candle.high / multiplier, low: candle.low / multiplier, close: candle.close / multiplier }));
}

/**
 * GeckoTerminal's `ohlcv_list` is `[[unixSeconds, o, h, l, c, v], …]`, newest
 * first. The chart wants oldest first, strictly increasing, and no bar with a
 * broken price. A partial bar in progress is kept — it is the live one.
 */
export function normalizeCandles(body: unknown): NormalizedCandle[] {
  const list = body && typeof body === "object"
    ? (body as { data?: { attributes?: { ohlcv_list?: unknown } } }).data?.attributes?.ohlcv_list
    : undefined;
  if (!Array.isArray(list)) return [];
  const out: NormalizedCandle[] = [];
  for (const raw of list) {
    if (!Array.isArray(raw) || raw.length < 5) continue;
    const time = asNumber(raw[0]);
    const open = asNumber(raw[1]);
    const high = asNumber(raw[2]);
    const low = asNumber(raw[3]);
    const close = asNumber(raw[4]);
    const volume = raw.length > 5 ? asNumber(raw[5]) : null;
    if (time === null || open === null || high === null || low === null || close === null) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < low) continue;
    out.push({
      time: Math.floor(time) as UTCTimestamp,
      open,
      high,
      low,
      close,
      volume: volume === null ? undefined : volume,
    });
  }
  out.sort((a, b) => a.time - b.time);
  const deduped: NormalizedCandle[] = [];
  for (const candle of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === candle.time) deduped[deduped.length - 1] = candle;
    else deduped.push(candle);
  }
  return deduped;
}

export type SpotCandlesRead = Readonly<{
  ok: true;
  timeframe: SpotTimeframe;
  candles: readonly NormalizedCandle[];
  pool: SpotPool;
  observedAt: string;
  stale: boolean;
  source: Readonly<{ label: "GeckoTerminal"; url: "https://www.geckoterminal.com" }>;
}>;
