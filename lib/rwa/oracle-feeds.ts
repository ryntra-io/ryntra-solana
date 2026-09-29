/* Oracle Health — Chainlink price-feed registry + freshness classification for Robinhood Chain
   Stock Tokens. This is the moat signal: "is this token's price actually alive right now?".

   Feed addresses are NOT hardcoded — Robinhood's own docs say the Chainlink reference-data
   directory is the source of truth (addresses/decimals/heartbeats change there). We fetch that
   JSON server-side (see /api/arcus?kind=oracle-feeds), map it by symbol, and the client reads
   `latestRoundData()` from the feed proxy on-chain (public eth_call, non-custodial).

   Verified live 2026-07-10: 55 feeds on feeds-robinhood-mainnet.json; 35 cover Arcus stock tokens
   (TSLA/NVDA/AAPL/…); TSLA feed `latestRoundData()` returned $403.53 @ 8 decimals, heartbeat 86400. */

export type OracleFeed = {
  /** AggregatorV3 proxy address to read latestRoundData()/decimals() from. */
  proxy: string;
  /** feed answer decimals (stock/USD feeds use 8). */
  decimals: number;
  /** max seconds between updates; older than this ⇒ stale (docs-mandated staleness bound). */
  heartbeat: number;
};

/** Robinhood-Chain Chainlink reference-data directory (public JSON, source of truth). */
export const ORACLE_FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

type RawFeed = {
  name?: string;
  proxyAddress?: string;
  decimals?: number;
  decimalPlaces?: number;
  heartbeat?: number;
  docs?: { baseAssetEntityId?: string };
};

/** Derive the trading symbol a feed maps to: prefer `baseAssetEntityId` (…-RHTSLA → TSLA),
    else clean the display name ("Robinhood TSLA / USD" → TSLA, "Robinhood SGOV-USD" → SGOV). */
function feedSymbol(f: RawFeed): string | null {
  const be = f.docs?.baseAssetEntityId ?? "";
  const m = be.match(/RH([A-Z0-9]+)$/);
  if (m) return m[1];
  const name = f.name ?? "";
  const cleaned = name.replace(/^Robinhood\s+/i, "").replace(/\s*\/\s*USD$/i, "").replace(/-USD$/i, "").trim();
  return /^[A-Z0-9]{1,10}$/.test(cleaned) ? cleaned : null;
}

/** Parse the Chainlink directory JSON into a symbol → feed map. Pure (unit-tested). */
export function parseOracleFeeds(json: unknown): Record<string, OracleFeed> {
  if (!Array.isArray(json)) return {};
  const map: Record<string, OracleFeed> = {};
  for (const raw of json as RawFeed[]) {
    const sym = feedSymbol(raw);
    const proxy = raw.proxyAddress;
    if (!sym || typeof proxy !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(proxy)) continue;
    const decimals = typeof raw.decimals === "number" ? raw.decimals : typeof raw.decimalPlaces === "number" ? raw.decimalPlaces : 8;
    const heartbeat = typeof raw.heartbeat === "number" && raw.heartbeat > 0 ? raw.heartbeat : 86400;
    // first feed wins per symbol (directory has no dup stock feeds; guards against odd future dups)
    if (!map[sym]) map[sym] = { proxy, decimals, heartbeat };
  }
  return map;
}

export type OracleReading = {
  /** feed answer scaled to a number using the feed's decimals; null if unreadable/≤0. */
  price: number | null;
  /** unix seconds of the last feed update; null if unreadable. */
  updatedAt: number | null;
};

/**
 * Classify feed freshness for the risk engine (docs' staleness rule: answer>0, and age within the
 * feed heartbeat). Returns:
 *   true  — fresh & positive
 *   false — stale (older than heartbeat) or non-positive answer  → risk engine → "avoid"
 *   null  — could not read → "unknown" (never fake healthy)
 * Note: stock feeds update 24/5 on deviation, so an off-hours flat feed is EXPECTED and still
 * "fresh" as long as its last update is within heartbeat — the Market tile carries off-hours. */
export function classifyOracleFresh(r: OracleReading | null, heartbeat: number, nowSec: number): boolean | null {
  if (!r || r.updatedAt == null || r.price == null) return null;
  if (r.price <= 0) return false;
  const age = nowSec - r.updatedAt;
  // small grace over the heartbeat: Chainlink can publish slightly late, so don't flip to "stale"
  // on a few seconds of overshoot. NOTE: an off-hours 24/5 feed will legitimately exceed heartbeat
  // over weekends — the RISK ENGINE only treats stale as "avoid" while the market is open.
  if (age > Math.max(60, heartbeat) + 600) return false;
  return true;
}
