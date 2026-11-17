/**
 * The pools a person chooses from on the terminal's «Заробіток», and the lending rates beside them.
 *
 * The engine's catalogue of Meteora DLMM and DAMM v2 pools (`lib/liquidity/catalog`) cut to one compact row each: the
 * pair, the venue, how much the pool holds, what traded through it and what trades paid it in a day, the fee a trade
 * pays, DLMM's price step and the pool's age. Every figure is the venue's own; the one figure worked out here — the
 * day's fees over what the pool holds — is a fact of the day gone, never a promised return. Jupiter Lend's markets are
 * carried as their rate now and what is supplied to them.
 *
 * Pure and client-safe: the server builds the answer from it, the screen and the tests read it alike.
 */

import { feeTvl24hPct, type CatalogPool, type LiquidityPoolKind } from "../liquidity/catalog/model.ts";

const SOL_MINT = "So11111111111111111111111111111111111111112";

/** A pool is listed from this much in it: below, the venue's lists are test pools and dust. */
export const EARN_POOL_MIN_TVL_USD = 10_000;
/** How many pools an answer carries: the catalogue's own two pages, most traded first. */
export const EARN_POOLS_MAX = 240;
/** How many lending markets an answer carries. */
export const EARN_LEND_MAX = 64;

export type EarnPoolCoin = Readonly<{ mint: string; symbol: string; verified: boolean }>;

export type EarnPool = Readonly<{
  kind: LiquidityPoolKind;
  address: string;
  x: EarnPoolCoin;
  y: EarnPoolCoin;
  tvlUsd: number;
  volume24hUsd: number | null;
  /** What trades paid the pool in 24 hours, before the venue's share — as Meteora shows it. */
  fees24hUsd: number | null;
  /** Those fees over what the pool holds, per cent of one day. */
  feeTvl24hPct: number | null;
  /** The fee a trade pays at the floor, per cent. */
  baseFeePct: number | null;
  /** The fee a trade pays now, per cent: DLMM's base plus its volatility part; DAMM v2's base. */
  feePct: number | null;
  /** DLMM's price step between bins, basis points; null for DAMM v2. */
  binStepBps: number | null;
  createdAt: string | null;
  /** The pool's page at the venue. */
  page: string;
}>;

export type EarnLendRate = Readonly<{
  mint: string;
  symbol: string;
  /** Per cent a year, as Jupiter Lend states it now. */
  ratePct: number;
  /** Everything supplied to the market, dollars at the market's own price; null when either was not read. */
  suppliedUsd: number | null;
}>;

export type EarnPoolsAnswer = Readonly<{
  pools: readonly EarnPool[];
  lend: readonly EarnLendRate[];
  /** When the oldest part of the answer was read, ISO; null when nothing was. */
  at: string | null;
  sources: Readonly<{ dlmm: boolean; dammV2: boolean; lend: boolean }>;
}>;

/** One catalogue pool as a row of the chooser; null for a blacklisted, shallow or unreadable one. */
export function earnPoolOf(pool: CatalogPool): EarnPool | null {
  if (pool.blacklisted) return null;
  if (pool.tvlUsd === null || !(pool.tvlUsd >= EARN_POOL_MIN_TVL_USD)) return null;
  if (pool.kind === "dlmm" && !(pool.binStepBps !== null && pool.binStepBps > 0)) return null;
  return {
    kind: pool.kind,
    address: pool.address,
    x: { mint: pool.x.mint, symbol: pool.x.symbol, verified: pool.x.verified },
    y: { mint: pool.y.mint, symbol: pool.y.symbol, verified: pool.y.verified },
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    fees24hUsd: pool.fees24hUsd,
    feeTvl24hPct: feeTvl24hPct(pool),
    baseFeePct: pool.baseFeePct,
    feePct: pool.dynamicFeePct ?? pool.baseFeePct,
    binStepBps: pool.kind === "dlmm" ? pool.binStepBps : null,
    createdAt: pool.createdAt,
    page: pool.source.page,
  };
}

/** The catalogue as the chooser's rows: each pool once, the most paid in a day first, at most `EARN_POOLS_MAX`. */
export function earnPools(pools: readonly CatalogPool[]): EarnPool[] {
  const seen = new Set<string>();
  const out: EarnPool[] = [];
  for (const pool of pools) {
    const row = earnPoolOf(pool);
    if (!row || seen.has(row.address)) continue;
    seen.add(row.address);
    out.push(row);
  }
  return out.sort((a, b) => (b.fees24hUsd ?? -1) - (a.fees24hUsd ?? -1) || b.tvlUsd - a.tvlUsd || (a.address < b.address ? -1 : 1)).slice(0, EARN_POOLS_MAX);
}

type LendMarket = Readonly<{
  asset: Readonly<{ mint: string; symbol: string; decimals: number }>;
  rateAnnualPercent: number | null;
  suppliedRaw: string | null;
  priceUsd: number | null;
}>;

/** Jupiter Lend's markets as rates: a market without a rate or a name is left out, the highest rate first. */
export function lendRates(markets: readonly LendMarket[]): EarnLendRate[] {
  const out: EarnLendRate[] = [];
  const seen = new Set<string>();
  for (const market of markets) {
    const rate = market.rateAnnualPercent;
    if (rate === null || !Number.isFinite(rate) || rate < 0 || !market.asset.symbol || seen.has(market.asset.mint)) continue;
    seen.add(market.asset.mint);
    const supplied = market.suppliedRaw !== null && /^\d{1,40}$/.test(market.suppliedRaw) && market.priceUsd !== null ? (Number(market.suppliedRaw) / 10 ** market.asset.decimals) * market.priceUsd : null;
    // Wrapped SOL is SOL to a person: the market lends SOL.
    const symbol = market.asset.mint === SOL_MINT ? "SOL" : market.asset.symbol.slice(0, 32);
    out.push({ mint: market.asset.mint, symbol, ratePct: rate, suppliedUsd: supplied !== null && Number.isFinite(supplied) ? supplied : null });
  }
  return out.sort((a, b) => b.ratePct - a.ratePct || (a.symbol < b.symbol ? -1 : 1)).slice(0, EARN_LEND_MAX);
}
