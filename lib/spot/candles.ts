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
  "15m": 60_000,
  "1h": 120_000,
  "4h": 300_000,
  "1d": 600_000,
};

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

/** A pool thinner than this cannot be called the market for anything. */
export const SPOT_POOL_MIN_RESERVE_USD = 10_000;

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
  | Readonly<{ pool: SpotPool; reason: null }>
  | Readonly<{ pool: null; reason: "NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET" }>;

/**
 * The pool that is allowed to be the chart, or the reason there is none.
 *
 * A chart of *the* price is a chart of one pool, so the choice is a rule
 * rather than a score. A pool qualifies only if the exact mint is one of its
 * two sides, the **other** side is a major quote — USDC, USDT or SOL, the only
 * ones whose USD conversion is trustworthy — it holds at least
 * {@link SPOT_POOL_MIN_RESERVE_USD} of reserves, and it traded in the last
 * day. Among those, the mint on the base side against a stable comes first,
 * then the base side against SOL, then the mint as a quote; ties by depth.
 *
 * Depth alone chose a week-old meme/SOL pool for SOL itself, because SOL is
 * the quote in most pools and a hot launch can out-reserve Orca for a day.
 * That is what the rule is for: a wrong chart is worse than none.
 */
export function chooseSpotPool(body: unknown, mint: string): SpotPoolChoice {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data as GeckoPoolRow[]) : null;
  if (!data) return { pool: null, reason: "NO_POOL" };
  let anyPool = false;
  let anyMajor = false;
  let anyDeep = false;
  let best: { pool: SpotPool; rank: number } | null = null;
  for (const row of data) {
    const address = typeof row.attributes?.address === "string" ? row.attributes.address : null;
    if (!address) continue;
    const base = tokenIdMint(row.relationships?.base_token?.data?.id);
    const quote = tokenIdMint(row.relationships?.quote_token?.data?.id);
    const side: "base" | "quote" | null = base === mint ? "base" : quote === mint ? "quote" : null;
    if (!side) continue;
    anyPool = true;
    const other = side === "base" ? quote : base;
    if (other === null || !MAJOR_QUOTES.has(other)) continue;
    anyMajor = true;
    const reserve = asNumber(row.attributes?.reserve_in_usd);
    if (reserve === null || reserve < SPOT_POOL_MIN_RESERVE_USD) continue;
    anyDeep = true;
    const volume24h = asNumber(row.attributes?.volume_usd?.h24);
    if (volume24h === null || volume24h <= 0) continue;
    const rank = side === "base" ? (STABLE_QUOTES.has(other) ? 3 : 2) : 1;
    const pool: SpotPool = {
      address,
      name: typeof row.attributes?.name === "string" ? row.attributes.name : address,
      dex: typeof row.relationships?.dex?.data?.id === "string" ? row.relationships.dex.data.id : null,
      side,
      reserveUsd: reserve,
      volume24hUsd: volume24h,
    };
    if (!best || rank > best.rank || (rank === best.rank && reserve > (best.pool.reserveUsd ?? 0))) best = { pool, rank };
  }
  if (best) return { pool: best.pool, reason: null };
  if (!anyPool) return { pool: null, reason: "NO_POOL" };
  if (!anyMajor) return { pool: null, reason: "NO_MAJOR_QUOTE" };
  if (!anyDeep) return { pool: null, reason: "THIN" };
  return { pool: null, reason: "QUIET" };
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
 * The chart source prices the raw base token; the venue, the wallet and every
 * figure on the page price the scaled unit (the Scaled UI Amount extension:
 * one base token stands for `multiplier` scaled units). Candles are brought
 * onto the page's unit by dividing each price by the multiplier — the dollar
 * volume is a dollar volume and does not move. A multiplier of one, or none,
 * leaves the candles as they came (`RYN-STOCKS-PROVIDERS-001`: NFLXx at ×10
 * and OPENAI at ×1.486 had no chart, because the raw-unit close was ten times
 * the price on screen).
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
