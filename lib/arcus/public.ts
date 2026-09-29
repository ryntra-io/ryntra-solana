// Server-side proxy helpers for Arcus PUBLIC endpoints (no keys involved).
// Proxied to avoid browser CORS concerns and to cache hot metadata.

import { ORACLE_FEEDS_URL, parseOracleFeeds, type OracleFeed } from "../rwa/oracle-feeds";
import { BoundedTtlCache } from "../http-control";
import { candleCacheMs } from "./policy";

const BASE = "https://api.arcus.xyz";

export type ArcusMarket = {
  marketDisplayName: string;
  fullAssetName: string;
  marketId: number;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  stepSize: string;
  minOrderNotional: string;
  /** CRYPTO | EQUITIES | COMMODITIES | INDICES — non-CRYPTO perps carry the off-hours RWA regime. */
  category?: string;
  /** Hourly funding fraction (verified: crypto base 0.0000125/h = 0.01%/8h). */
  fundingRate?: string;
  nextFundingRate?: string;
  /** Epoch seconds. */
  nextFundingAt?: number;
  oraclePrice?: string;
  markPrice?: string;
  initialMarginFraction?: string;
  offHoursInitialMarginFraction?: string;
  /** Venue's own market-hours fact (calendar incl. weekends/US holidays). ABSENT for 24/7
      crypto and for OFFLINE markets; present on ONLINE EQUITIES/COMMODITIES/INDICES perps.
      Prefer over any local NYSE calc (rwa-risk-signals #1). */
  isOutsideRth?: boolean;
};

const cache = new BoundedTtlCache({ maxEntries: 2_000 });

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  return cache.get(key, ttlMs, fetcher);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`arcus ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function getMarkets(): Promise<ArcusMarket[]> {
  // 120s TTL: funding/oracle fields in the risk monitor should not go stale for 5 min.
  return cached("markets", 60_000, async () => {
    const j = await get<{ markets?: ArcusMarket[] } | ArcusMarket[]>("/v1/markets");
    return Array.isArray(j) ? j : j.markets ?? [];
  });
}

/** Taker fee as a fraction (e.g. 0.00045). feetiers units are hundredths of a bps: 450 → 4.5 bps. */
export function getTakerFeeFraction(): Promise<number> {
  return cached("takerFee", 300_000, async () => {
    try {
      const j = await get<{ tiers: { level: number; taker_fee_bps: number }[] }>("/v1/feetiers");
      const base = j.tiers?.find((t) => t.level === 0) ?? j.tiers?.[0];
      return (base?.taker_fee_bps ?? 450) / 1_000_000;
    } catch {
      return 450 / 1_000_000; // Base tier fallback (0.045%)
    }
  });
}

export type ArcusCandle = {
  openTime: number; // µs
  open: string; high: string; low: string; close: string; volume: string;
  isFinal: boolean;
};

/* ---------- public account data (read-only, by address — no auth on Arcus side) ---------- */

export type ArcusFill = {
  tradeId: string; orderId: string; marketDisplayName: string; side: "BUY" | "SELL";
  size: string; price: string; fee: string; closedPnl: string;
  positionEffect: string; createdAt: number; sequenceNumber: number; role: string;
};

export type ArcusPosition = {
  marketDisplayName: string; side: "LONG" | "SHORT"; size: string; averageEntryPrice: string;
  unrealizedPnl?: string; markPrice?: string;
  cumulativeFunding?: { sinceOpen?: string };
};

export type ArcusOrder = {
  orderId: string; marketDisplayName: string; side: "BUY" | "SELL"; type: string;
  status: string; price: string; originalSize: string; filledSize: string; remainingSize: string;
};

// Short TTL: collapses the terminal's ~8s polling and repeated identical addresses into one
// upstream call, capping fan-out to api.arcus.xyz (this is public, non-personalized data).
const ACCOUNT_TTL_MS = 6_000;

export function getFills(address: string, limit = 100): Promise<ArcusFill[]> {
  return cached(`fills:${address}`, ACCOUNT_TTL_MS, async () => {
    const j = await get<{ fills: ArcusFill[] }>(`/v1/fills?address=${address}`);
    return j.fills ?? [];
  }).then((fills) => fills.slice(0, limit));
}

export function getPositions(address: string): Promise<ArcusPosition[]> {
  return cached(`positions:${address}`, ACCOUNT_TTL_MS, async () => {
    const j = await get<{ positions: Record<string, ArcusPosition> | ArcusPosition[] }>(`/v1/positions?address=${address}`);
    const p = j.positions ?? {};
    return Array.isArray(p) ? p : Object.values(p);
  });
}

export function getOrders(address: string): Promise<ArcusOrder[]> {
  return cached(`orders:${address}`, ACCOUNT_TTL_MS, async () => {
    const j = await get<{ orders: ArcusOrder[] }>(`/v1/orders?address=${address}`);
    return (j.orders ?? []).filter((o) => o.status === "OPEN").slice(0, 100);
  });
}

/** Registered API keys for an address (public read; used to confirm key activation). */
export function getApiKeys(address: string): Promise<unknown> {
  return get<unknown>(`/v1/apiKeys?address=${address}`);
}

/* ---------- SPOT RFQ router (host router.spot.arcus.xyz, chain 4663) ---------- */
import { SPOT_ROUTER_BASE, SPOT_CHAIN_ID } from "./spot";

export function getSpotTokens(): Promise<unknown> {
  return cached("spotTokens", 300_000, async () => {
    const res = await fetch(`${SPOT_ROUTER_BASE}/tokens?chainId=${SPOT_CHAIN_ID}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`spot tokens: ${res.status}`);
    return res.json();
  });
}

/** Spot market universe with live price + 24h change + logo (api-meta). */
export function getSpotOverview(): Promise<unknown> {
  return cached("spotOverview", 20_000, async () => {
    const res = await fetch("https://api.arcus.xyz/v1/api-meta/spot/overview", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`spot overview: ${res.status}`);
    return res.json();
  });
}

export type SpotCandle = { openTime: number; open: string; high: string; low: string; close: string; volume: string; isFinal: boolean };

/** Spot OHLCV candles (api-meta). openTime is in SECONDS. */
export function getSpotCandles(market: string, timeframe: string, hours: number): Promise<SpotCandle[]> {
  return cached(`spotCandles:${market}:${timeframe}:${hours}`, candleCacheMs(timeframe), async () => {
    const to = Math.floor(Date.now() / 1000);
    const from = to - hours * 3600;
    const u = `https://api.arcus.xyz/v1/api-meta/candles?market=${encodeURIComponent(market)}&timeframe=${encodeURIComponent(timeframe)}&from=${from}&to=${to}&countback=400`;
    const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`spot candles: ${res.status}`);
    const j = (await res.json()) as { candles?: SpotCandle[] };
    return (j.candles ?? []).slice().sort((a, b) => a.openTime - b.openTime);
  });
}

/** Public spot swap history for an address (indexer). */
export async function getSpotTrades(address: string): Promise<unknown> {
  const res = await fetch(`https://indexer.spot.arcus.xyz/takers/${SPOT_CHAIN_ID}/${address}/trades?chainId=${SPOT_CHAIN_ID}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`spot trades: ${res.status}`);
  return res.json();
}

/** Relay a signed spot swap intent to the RFQ router (no funds/keys — only the signed intent). */
export async function relaySpotSubmit(body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${SPOT_ROUTER_BASE}/v1/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

/** Live RFQ quote. Never cached — quotes are short-lived and taker-specific. */
export async function getSpotQuote(p: {
  sellToken: string; buyToken: string; sellAmount: string; taker: string; slippageBps: number;
}): Promise<{ status: number; text: string }> {
  const u = new URL(`${SPOT_ROUTER_BASE}/v1/quote`);
  u.searchParams.set("chainId", String(SPOT_CHAIN_ID));
  u.searchParams.set("sellToken", p.sellToken);
  u.searchParams.set("buyToken", p.buyToken);
  u.searchParams.set("sellAmount", p.sellAmount);
  u.searchParams.set("taker", p.taker);
  u.searchParams.set("slippageBps", String(p.slippageBps));
  u.searchParams.set("allowWrapped", "true");
  const res = await fetch(u, { signal: AbortSignal.timeout(9000) });
  return { status: res.status, text: await res.text() };
}

/** Relay a createApiKey registration (no secrets: public key + wallet signature only). */
export async function relayCreateApiKey(body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/v1/createApiKey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, text: await res.text() };
}

/** Chainlink Robinhood-Chain feed registry (symbol → {proxy, decimals, heartbeat}), server-cached.
    Source of truth per Robinhood docs; CSP-blocked client-side so we proxy it. */
export async function getOracleFeeds(): Promise<Record<string, OracleFeed>> {
  return cached("oracle-feeds", 3600_000, async () => {
    const res = await fetch(ORACLE_FEEDS_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    return parseOracleFeeds(await res.json());
  });
}

/** Relay a revokeApiKey (wallet-signed; works without the key itself — recovery for lost/compromised keys). */
export async function relayRevokeApiKey(body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/v1/revokeApiKey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, text: await res.text() };
}

export function getCandles(market: string, timeframe: string, hours: number): Promise<ArcusCandle[]> {
  return cached(`candles:${market}:${timeframe}:${hours}`, candleCacheMs(timeframe), async () => {
    const to = Date.now() * 1000;
    const from = to - hours * 3600 * 1e6;
    const j = await get<{ candles: ArcusCandle[] }>(
      `/v1/candles?market=${encodeURIComponent(market)}&timeframe=${encodeURIComponent(timeframe)}&from=${from}&to=${to}`
    );
    return (j.candles ?? []).slice().sort((a, b) => a.openTime - b.openTime);
  });
}
