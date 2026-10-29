/**
 * Pools — the catalogue of Meteora DLMM and DAMM v2 pools on Solana, as a
 * person reads it before putting money in: the pair, the venue, how much the
 * pool holds, what traded through it and what it earned in a day, what a trade
 * pays, and where the liquidity sits.
 *
 * Every figure is the venue's own, carried with the time it was read. Nothing
 * here projects a return: the venue's APR and fee-to-TVL ratios are the past
 * day stretched over a year, and the page does not repeat them. A pool earns
 * what trades pay it, and a position earns only while the price is inside it.
 *
 * Pure and client-safe; the reader and the chain reads are server-side.
 */

import { LIQUIDITY_POOL_KINDS, type LiquidityPoolKind } from "../model.ts";
import { METEORA_APP_PATH, METEORA_DATA_API } from "../meteora/mapper.ts";

export { LIQUIDITY_POOL_KINDS, type LiquidityPoolKind };

export const POOL_VENUE_LABEL: Readonly<Record<LiquidityPoolKind, string>> = { dlmm: "Meteora DLMM", "damm-v2": "Meteora DAMM v2" };

/** A pool is listed from this much TVL: below it the venue's lists are test pools and dust. */
export const CATALOG_MIN_TVL_USD = 10_000;
/** Pools of each venue the catalogue carries: the most traded in a day, so the other orders re-sort these, not all of Meteora. */
export const CATALOG_PER_VENUE = 120;

export type CatalogToken = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  decimals: number | null;
  /** The venue's verified flag, carried as read. */
  verified: boolean;
  /** USD per one token as the venue states it; for reading, never for sizing money. */
  priceUsd: number | null;
}>;

/** DAMM v2's one range for every position in the pool; null bounds — the plain curve. */
export type CatalogRange = Readonly<{ minPrice: number | null; maxPrice: number | null; concentrated: boolean }>;

export type CatalogPool = Readonly<{
  kind: LiquidityPoolKind;
  address: string;
  /** The pair as the venue names it, e.g. `SOL-USDC`. */
  name: string;
  x: CatalogToken;
  y: CatalogToken;
  /** Y per one X at the pool's price, as the venue states it. */
  price: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  /** The base fee a trade pays, percent (0.25 = 0.25 %). */
  baseFeePct: number | null;
  /**
   * DLMM: the fee a trade pays now — the base plus the part that grows with volatility — percent. The Data API's
   * `dynamic_fee_pct` is that variable part alone (0.0017 beside a 0.04 base, read on 2026-10-16), so the two are added.
   */
  dynamicFeePct: number | null;
  /** The ceiling of the fee, percent; null when the venue states none. */
  maxFeePct: number | null;
  /** The protocol's share of every fee, percent; the rest goes to the liquidity. */
  protocolSharePct: number | null;
  /** DLMM's price step between bins, basis points. */
  binStepBps: number | null;
  /** DAMM v2 only. */
  range: CatalogRange | null;
  /** DAMM v2: part of every fee goes back into the pool rather than waiting to be claimed. */
  compounding: boolean;
  /** How much of each token the pool holds, in the token's own unit. */
  xAmount: number | null;
  yAmount: number | null;
  hasFarm: boolean;
  /** The venue's own blacklist flag: such a pool is never listed, and its page says so. */
  blacklisted: boolean;
  createdAt: string | null;
  launchpad: string | null;
  source: Readonly<{ api: string; page: string }>;
}>;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isPoolAddress(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null);
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

function catalogToken(raw: unknown): CatalogToken | null {
  const node = record(raw);
  const mint = text(node.address, 44);
  if (!mint || !BASE58.test(mint)) return null;
  const decimals = typeof node.decimals === "number" && Number.isInteger(node.decimals) && node.decimals >= 0 && node.decimals <= 18 ? node.decimals : null;
  return {
    mint,
    symbol: text(node.symbol, 32) ?? `${mint.slice(0, 4)}…`,
    name: text(node.name, 80) ?? "",
    decimals,
    verified: node.is_verified === true,
    priceUsd: finite(node.price),
  };
}

const window24h = (raw: unknown): number | null => finite(record(raw)["24h"]);

const epochToIso = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  /* The Data APIs state milliseconds; a value that reads as seconds is treated as such. */
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
};

/**
 * A bound the venue or the chain states at the program's own extremes is no bound: DAMM v2 writes its widest range as a
 * price of about 5e-23 below and 1.8e16 above (read on 2026-10-16), and some records say 0.
 */
export function priceBound(value: unknown, side: "min" | "max"): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  const v = finite(n);
  if (v === null) return null;
  if (side === "min" && v < 1e-15) return null;
  if (side === "max" && (v <= 0 || v >= 1e15)) return null;
  return v;
}
const bound = priceBound;

/** One Data API pool record → a catalogue pool; null when the record is not a pool. */
export function mapCatalogPool(raw: unknown, kind: LiquidityPoolKind): CatalogPool | null {
  const node = record(raw);
  const address = text(node.address, 44);
  if (!address || !BASE58.test(address)) return null;
  const x = catalogToken(node.token_x);
  const y = catalogToken(node.token_y);
  if (!x || !y) return null;
  const config = record(node.pool_config);
  const dlmm = kind === "dlmm";
  const maxFee = finite(config.max_fee_pct);
  const baseFee = finite(config.base_fee_pct);
  const variableFee = dlmm ? finite(node.dynamic_fee_pct) : null;
  return {
    kind,
    address,
    name: text(node.name, 120) ?? `${x.symbol}-${y.symbol}`,
    x,
    y,
    price: finite(node.current_price),
    tvlUsd: finite(node.tvl),
    volume24hUsd: window24h(node.volume),
    fees24hUsd: window24h(node.fees),
    baseFeePct: baseFee,
    dynamicFeePct: baseFee !== null && variableFee !== null ? baseFee + variableFee : null,
    /* DLMM states 0 for a pool with no stated ceiling. */
    maxFeePct: maxFee && maxFee > 0 ? maxFee : null,
    protocolSharePct: finite(config.protocol_fee_pct),
    binStepBps: dlmm ? finite(config.bin_step) : null,
    range: dlmm
      ? null
      : { minPrice: bound(config.min_price, "min"), maxPrice: bound(config.max_price, "max"), concentrated: config.concentrated_liquidity === true },
    compounding: !dlmm && config.collect_fee_mode === 2,
    xAmount: finite(node.token_x_amount),
    yAmount: finite(node.token_y_amount),
    hasFarm: node.has_farm === true,
    blacklisted: node.is_blacklisted === true,
    createdAt: epochToIso(node.created_at),
    launchpad: text(node.launchpad, 64),
    source: { api: `${METEORA_DATA_API[kind]}/pools/${address}`, page: `${METEORA_APP_PATH[kind]}/${address}` },
  };
}

/** The list endpoint's page `{ total, data }` → pools, deduplicated, blacklisted ones dropped; null when the body is not that shape. */
export function mapCatalogPage(body: unknown, kind: LiquidityPoolKind): Readonly<{ total: number | null; pools: readonly CatalogPool[] }> | null {
  const node = record(body);
  if (!Array.isArray(node.data)) return null;
  const seen = new Set<string>();
  const pools: CatalogPool[] = [];
  for (const raw of node.data) {
    const pool = mapCatalogPool(raw, kind);
    if (pool && !pool.blacklisted && !seen.has(pool.address)) {
      seen.add(pool.address);
      pools.push(pool);
    }
  }
  const total = typeof node.total === "number" && Number.isInteger(node.total) && node.total >= 0 ? node.total : null;
  return { total, pools };
}

/** The venue's query for the catalogue: the deep pools, the most traded first; a search adds the venue's own `query`. */
export function catalogUrl(kind: LiquidityPoolKind, search: string | null): string {
  const filter = encodeURIComponent(`is_blacklisted=false && tvl>=${CATALOG_MIN_TVL_USD}`);
  const query = search ? `&query=${encodeURIComponent(search)}` : "";
  return `${METEORA_DATA_API[kind]}/pools?page_size=${CATALOG_PER_VENUE}&sort_by=volume_24h:desc&filter_by=${filter}${query}`;
}

export function poolRecordUrl(kind: LiquidityPoolKind, address: string): string {
  return `${METEORA_DATA_API[kind]}/pools/${address}`;
}

/** What a search may ask the venue: letters, digits and a few separators, at most an address long. */
export function cleanSearch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 44);
  return /^[\p{L}\p{N} ._/-]{1,44}$/u.test(trimmed) ? trimmed : null;
}

export const CATALOG_VIEWS = ["all", "dlmm", "damm-v2"] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];

export function isCatalogView(value: unknown): value is CatalogView {
  return typeof value === "string" && (CATALOG_VIEWS as readonly string[]).includes(value);
}

export const CATALOG_SORTS = ["volume24h", "tvl", "fees24h", "feeTvl", "fee", "age"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * «Комісії/TVL 24 год»: what the pool's trades paid over the past day, as a percent of what it holds — the figure a
 * liquidity provider chooses by (B17). A fact of the day gone, not a projected yield; none without both figures.
 */
export function feeTvl24hPct(pool: Pick<CatalogPool, "fees24hUsd" | "tvlUsd">): number | null {
  if (pool.fees24hUsd === null || pool.tvlUsd === null || !(pool.tvlUsd > 0) || pool.fees24hUsd < 0) return null;
  return (pool.fees24hUsd / pool.tvlUsd) * 100;
}

/** The depth a pool needs to lead the order by Fees/TVL: below it a thin pool with a 2–5 % fee tops the list on a day's luck. */
export const FEE_TVL_ORDER_MIN_TVL_USD = 100_000;

const sortValue = (pool: CatalogPool, key: CatalogSort): number | null => {
  switch (key) {
    case "volume24h":
      return pool.volume24hUsd;
    case "tvl":
      return pool.tvlUsd;
    case "fees24h":
      return pool.fees24hUsd;
    case "feeTvl":
      /* A pool under the depth goes with the pools without a figure — after the rest, in either direction. */
      return (pool.tvlUsd ?? 0) >= FEE_TVL_ORDER_MIN_TVL_USD ? feeTvl24hPct(pool) : null;
    case "fee":
      return pool.dynamicFeePct ?? pool.baseFeePct;
    case "age":
      return pool.createdAt ? Date.parse(pool.createdAt) : null;
  }
};

/** Pools of a view, in the order asked; a figure nobody stated goes last either way; ties fall to TVL, then to the address. */
export function catalogRows(pools: readonly CatalogPool[], view: CatalogView, key: CatalogSort, direction: "asc" | "desc"): CatalogPool[] {
  const sign = direction === "asc" ? 1 : -1;
  return pools
    .filter((pool) => view === "all" || pool.kind === view)
    .slice()
    .sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === null || vb === null) {
        if (va !== vb) return va === null ? 1 : -1;
      }
      const by = va === null || vb === null ? 0 : sign * (va - vb);
      if (by !== 0) return by;
      const tvl = (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1);
      return tvl !== 0 ? tvl : a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
    });
}

/**
 * A filter over the carried rows: an address — the pool's or a token's — or words, each of which must be in the pair's
 * name or a symbol («sol usdc», «SOL/USDC» and «SOL-USDC» find the same pools).
 */
export function matchCatalog(pools: readonly CatalogPool[], query: string): CatalogPool[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return pools.slice();
  const words = needle.split(/[\s/-]+/).filter(Boolean);
  return pools.filter((pool) => {
    if (pool.address.toLowerCase() === needle || pool.x.mint.toLowerCase() === needle || pool.y.mint.toLowerCase() === needle) return true;
    const text = `${pool.name} ${pool.x.symbol} ${pool.y.symbol}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Two venues' pages merged: each pool once, the first venue's copy kept. */
export function mergeCatalog(pages: readonly (readonly CatalogPool[])[]): CatalogPool[] {
  const seen = new Set<string>();
  const out: CatalogPool[] = [];
  for (const page of pages) {
    for (const pool of page) {
      if (seen.has(pool.address)) continue;
      seen.add(pool.address);
      out.push(pool);
    }
  }
  return out;
}

/** One venue's read for the page: the pools, when they were read, and whether this is a kept copy. */
export type CatalogSource = Readonly<{ ok: boolean; stale: boolean; at: string | null; total: number | null }>;

export type PoolCatalog = Readonly<{
  pools: readonly CatalogPool[];
  sources: Readonly<Record<LiquidityPoolKind, CatalogSource>>;
  search: string | null;
  /** A search was asked while the venue's search budget was spent: the page filters the top pools instead. */
  searchLimited: boolean;
}>;
