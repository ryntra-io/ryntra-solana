/**
 * Pure helpers behind the landing's live product visuals.
 *
 * Everything here is deterministic and DOM-free so the truth rules stay testable:
 * the landing may only ever show real venue numbers or an explicitly labelled
 * deterministic sample — never an invented number dressed as live data.
 */

/** Shape we consume from `/api/arcus?kind=markets` (superset ignored on purpose). */
export type RawMarket = {
  marketDisplayName?: unknown;
  fullAssetName?: unknown;
  category?: unknown;
  status?: unknown;
  oraclePrice?: unknown;
  markPrice?: unknown;
  lastTradePrice?: unknown;
  /** 24h change as a FRACTION (0.0188 = +1.88%), per the verified Arcus payload. */
  priceChange24h?: unknown;
};

export type StripMarket = {
  /** Base symbol without the quote leg — "BTC-USD" → "BTC". */
  symbol: string;
  name: string;
  category: MarketCategory;
  price: number;
  /** 24h change fraction, or null when the venue did not report one. */
  change: number | null;
};

export type MarketCategory = "CRYPTO" | "EQUITIES" | "COMMODITIES" | "INDICES";

const CATEGORIES: readonly MarketCategory[] = ["CRYPTO", "EQUITIES", "COMMODITIES", "INDICES"];

/**
 * Recognition order for the ticker: the names a first-time visitor knows lead,
 * everything else keeps the venue's own ordering behind them.
 */
const LEAD_SYMBOLS: readonly string[] = [
  "BTC", "ETH", "SOL", "XRP",
  "NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "META", "AMZN",
  "GLD", "SLV", "USO",
  "SPY", "QQQ",
  "PLTR", "COIN", "HOOD", "AMD",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fraction(value: unknown): number | null {
  if (typeof value !== "number" && !text(value)) return null;
  const parsed = typeof value === "number" ? value : Number(text(value));
  // A 24h move outside ±1000% is upstream noise, not a fact we will paint green.
  return Number.isFinite(parsed) && Math.abs(parsed) <= 10 ? parsed : null;
}

/** "TSLA-USD" → "TSLA". Leaves already-bare symbols untouched. */
export function baseSymbol(displayName: string): string {
  const [base] = displayName.split("-");
  return (base ?? displayName).toUpperCase();
}

/**
 * Fail-closed selection: a row survives only with an ONLINE status, a known
 * venue category and a real positive price. Anything partial is dropped rather
 * than rendered with a placeholder.
 */
export function selectStripMarkets(raw: readonly RawMarket[] | null | undefined): StripMarket[] {
  const seen = new Set<string>();
  const rows: StripMarket[] = [];

  for (const market of raw ?? []) {
    if (market.status !== "ONLINE") continue;

    const display = text(market.marketDisplayName);
    if (!display) continue;
    const symbol = baseSymbol(display);
    if (seen.has(symbol)) continue;

    const category = text(market.category).toUpperCase() as MarketCategory;
    if (!CATEGORIES.includes(category)) continue;

    const price =
      positiveNumber(market.oraclePrice) ??
      positiveNumber(market.markPrice) ??
      positiveNumber(market.lastTradePrice);
    if (price === null) continue;

    seen.add(symbol);
    rows.push({
      symbol,
      name: text(market.fullAssetName) || symbol,
      category,
      price,
      change: fraction(market.priceChange24h),
    });
  }

  const rank = (symbol: string) => {
    const index = LEAD_SYMBOLS.indexOf(symbol);
    return index === -1 ? LEAD_SYMBOLS.length : index;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.symbol) - rank(b.row.symbol) || a.index - b.index)
    .map((entry) => entry.row);
}

/** Counts per venue category — drives the honest "crypto · stocks · commodities" line. */
export function countByCategory(rows: readonly StripMarket[]): Record<MarketCategory, number> {
  const counts: Record<MarketCategory, number> = { CRYPTO: 0, EQUITIES: 0, COMMODITIES: 0, INDICES: 0 };
  for (const row of rows) counts[row.category] += 1;
  return counts;
}

/** Price text with a digit count that suits the magnitude (BTC vs a sub-cent token). */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const digits = value >= 10_000 ? 0 : value >= 100 ? 2 : value >= 1 ? 3 : value >= 0.1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export type ChangeTone = "up" | "down" | "flat";
export type FeedStatus = "loading" | "sample" | "live" | "stale" | "unavailable";

/** Landing data is no longer presented as current after two minutes. */
export const LANDING_FEED_TTL_MS = 120_000;

/**
 * A stale landing snapshot is discarded after a bounded recovery window. The
 * browser may keep retrying, but old venue values cannot remain visible forever.
 */
export const LANDING_FEED_MAX_STALE_MS = 900_000;

/**
 * Derive when an HTTP representation was observed without trusting a future or
 * malformed intermediary timestamp. Age wins because it directly describes
 * cache residency; Date is the fallback for providers that omit Age.
 */
export function observedAtFromHeaders(
  ageHeader: string | null,
  dateHeader: string | null,
  receivedAt: number,
): number {
  const ageSeconds = ageHeader?.trim() ? Number(ageHeader) : Number.NaN;
  if (Number.isFinite(ageSeconds) && ageSeconds >= 0) {
    return Math.max(0, receivedAt - ageSeconds * 1_000);
  }

  const datedAt = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (Number.isFinite(datedAt) && datedAt <= receivedAt) return datedAt;
  return receivedAt;
}

/** A successful snapshot still expires after the tab was suspended. */
export function expireFeedStatus(
  status: FeedStatus,
  observedAt: number | null,
  now: number,
  ttlMs = LANDING_FEED_TTL_MS,
  maxStaleMs = LANDING_FEED_MAX_STALE_MS,
): FeedStatus {
  if (status !== "live" && status !== "stale") return status;
  if (observedAt === null || !Number.isFinite(observedAt)) {
    return status === "live" ? "stale" : "unavailable";
  }
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(ttlMs) ||
    !Number.isFinite(maxStaleMs) ||
    ttlMs <= 0 ||
    maxStaleMs <= ttlMs
  ) {
    return status === "live" ? "stale" : "unavailable";
  }

  const age = Math.max(0, now - observedAt);
  if (age >= maxStaleMs) return "unavailable";
  if (status === "live" && age >= ttlMs) return "stale";
  return status;
}

/** A refresh never leaves an old successful snapshot labelled Live. */
export function markRefreshing<T extends FeedStatus>(status: T): T | "stale" {
  return status === "live" ? "stale" : status;
}

/** Moves under 0.05% are noise: they stay neutral instead of borrowing a risk colour. */
export function changeTone(change: number | null): ChangeTone {
  if (change === null || !Number.isFinite(change) || Math.abs(change) < 0.0005) return "flat";
  return change > 0 ? "up" : "down";
}

export function formatChange(change: number | null): string | null {
  if (change === null || !Number.isFinite(change)) return null;
  const percent = change * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(2)}%`;
}

/* ---------- hero series ---------- */

export type HeroPoint = { time: number; value: number };

/** Shape we consume from `/api/arcus?kind=spot-candles` (openTime already in seconds). */
export type RawSpotCandle = { openTime?: unknown; close?: unknown };

/** Five sessions at 1h — long enough to read a shape, short enough to stay lively. */
const HERO_MAX_POINTS = 120;

/**
 * Lightweight-charts rejects unsorted or duplicated timestamps, so the feed is
 * normalized here: finite points only, strictly ascending, last write wins.
 */
export function toHeroSeries(candles: readonly RawSpotCandle[] | null | undefined): HeroPoint[] {
  const byTime = new Map<number, number>();
  for (const candle of candles ?? []) {
    const time = Math.floor(Number(candle?.openTime));
    const value = Number(candle?.close);
    if (!Number.isFinite(time) || time <= 0) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    byTime.set(time, value);
  }
  const points = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time, value }));
  return points.slice(-HERO_MAX_POINTS);
}

/** Change across a real elapsed-time window, as a fraction. */
export function seriesChange(points: readonly HeroPoint[], windowSeconds = 86_400): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  if (!last) return null;
  const cutoff = last.time - windowSeconds;
  const first = points.findLast((point) => point.time <= cutoff);
  if (!first || first === last || first.value <= 0) return null;
  return last.value / first.value - 1;
}

/**
 * Deterministic stand-in used when the venue feed is unavailable. It is always
 * rendered behind the "sample" label — the chart never claims live data it does
 * not have. No wall clock and no randomness: identical on every render.
 */
export const SAMPLE_HERO_SERIES: readonly HeroPoint[] = (() => {
  const points: HeroPoint[] = [];
  let seed = 20260804;
  let value = 296;
  for (let index = 0; index < 168; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = (seed / 2147483648 - 0.5) * 5.2;
    value = value + noise + Math.sin(index / 11) * 1.15 + 0.19;
    points.push({ time: 1_780_000_000 + index * 3600, value: Math.round(value * 100) / 100 });
  }
  return points;
})();
