export const ARCUS_GET_KINDS = new Set([
  "markets",
  "fees",
  "candles",
  "account",
  "apikeys",
  "spot-tokens",
  "oracle-feeds",
  "spot-overview",
  "spot-candles",
  "spot-trades",
  "spot-quote",
]);

const CANDLE_CACHE_SECONDS: Readonly<Record<string, number>> = {
  "1m": 5,
  "5m": 10,
  "15m": 20,
  "1h": 30,
  "4h": 60,
  "1d": 120,
};

const PUBLIC_CACHE_SECONDS: Readonly<Record<string, number>> = {
  markets: 60,
  fees: 300,
  "spot-tokens": 300,
  "oracle-feeds": 3_600,
  "spot-overview": 20,
};

/**
 * Shared-cache TTL for public market data. Null is a hard privacy boundary: address-specific
 * account/API-key/trade data and taker-specific RFQ quotes must never enter a CDN cache.
 */
export function arcusCacheSeconds(kind: string, timeframe?: string): number | null {
  if (kind === "candles" || kind === "spot-candles") {
    return CANDLE_CACHE_SECONDS[timeframe ?? ""] ?? null;
  }
  return PUBLIC_CACHE_SECONDS[kind] ?? null;
}

/** Per-warm-instance budget. Public CDN hits bypass the function and do not consume it. */
export function arcusRateLimit(kind: string): number {
  if (kind === "account") return 40;
  if (kind === "candles" || kind === "spot-candles") return 90;
  if (kind === "spot-quote") return 120;
  return 240;
}

/** Internal TTL mirrors the public freshness contract for candle coalescing. */
export function candleCacheMs(timeframe: string): number {
  const seconds = CANDLE_CACHE_SECONDS[timeframe];
  if (!seconds) throw new TypeError("unsupported candle timeframe");
  return seconds * 1_000;
}
