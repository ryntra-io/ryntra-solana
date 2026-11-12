import type { CatalogPool, LiquidityPoolKind } from '../../../../lib/liquidity/catalog/model.ts';
import { digits, wordsNow } from '../../i18n/dict.ts';
import { plainFigure } from '../../i18n/figures.ts';
import { HARBOR_FIGURES } from './words.ts';

/**
 * The Harbor's pools: Meteora DLMM and DAMM v2 pools as the engine's catalogue reads them, cut down to what one line
 * of the list and one simple card need. Every figure is the venue's own; the Harbor adds no yield of its own. What a
 * position "gets" is said as a fact of the day gone — the pool's fees for liquidity in the last 24 hours and the share
 * of the pool an amount would be — never as a promised return.
 */

export type HarborVenue = 'meteora-dlmm' | 'meteora-damm2';

export const VENUE_OF: Readonly<Record<LiquidityPoolKind, HarborVenue>> = { dlmm: 'meteora-dlmm', 'damm-v2': 'meteora-damm2' };
export const VENUE_NAME: Readonly<Record<LiquidityPoolKind, string>> = { dlmm: 'DLMM', 'damm-v2': 'DAMM v2' };

export type HarborToken = Readonly<{ mint: string; symbol: string; decimals: number; priceUsd: number | null }>;

export type HarborPool = Readonly<{
  kind: LiquidityPoolKind;
  address: string;
  /** The pair as the venue names it: SOL-USDC. */
  pair: string;
  x: HarborToken;
  y: HarborToken;
  /** Y per one X, the pool's own price. */
  price: number;
  tvlUsd: number;
  volume24hUsd: number | null;
  /** What trades paid the pool in 24 hours, before the venue's share. */
  fees24hUsd: number | null;
  /** The part of those fees that went to liquidity: the venue's protocol share taken off. */
  lpFees24hUsd: number | null;
  /** What a trade pays now, percent. */
  feePct: number | null;
  /** DLMM's price step between bins, basis points. */
  binStepBps: number | null;
  /** DAMM v2's one range for every position; null bounds — the plain curve, every price. */
  band: Readonly<{ min: number | null; max: number | null }> | null;
}>;

/** Pools the Harbor lists from this deep: below it a day's luck tops the list (the engine's own line for ordering by fees). */
export const HARBOR_MIN_TVL_USD = 100_000;
/** How many pools the list carries: the most traded first. */
export const HARBOR_POOLS = 24;

/** One catalogue pool as the Harbor shows it; null when a figure the card needs is missing or a token is not verified. */
export function harborPool(pool: CatalogPool): HarborPool | null {
  if (pool.blacklisted || !pool.x.verified || !pool.y.verified) return null;
  if (pool.x.decimals === null || pool.y.decimals === null) return null;
  if (pool.price === null || !(pool.price > 0) || pool.tvlUsd === null || pool.tvlUsd < HARBOR_MIN_TVL_USD) return null;
  const share = pool.protocolSharePct;
  const lp = pool.fees24hUsd === null || share === null || share > 100 ? null : pool.fees24hUsd * (1 - share / 100);
  const band = pool.kind === 'damm-v2' ? (pool.range?.concentrated ? { min: pool.range.minPrice, max: pool.range.maxPrice } : { min: null, max: null }) : null;
  if (pool.kind === 'dlmm' && !(pool.binStepBps && pool.binStepBps > 0)) return null;
  return {
    kind: pool.kind,
    address: pool.address,
    pair: pool.name,
    x: { mint: pool.x.mint, symbol: pool.x.symbol, decimals: pool.x.decimals, priceUsd: pool.x.priceUsd },
    y: { mint: pool.y.mint, symbol: pool.y.symbol, decimals: pool.y.decimals, priceUsd: pool.y.priceUsd },
    price: pool.price,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    fees24hUsd: pool.fees24hUsd,
    lpFees24hUsd: lp,
    feePct: pool.dynamicFeePct ?? pool.baseFeePct,
    binStepBps: pool.kind === 'dlmm' ? pool.binStepBps : null,
    band,
  };
}

/** The Harbor's list from the catalogue: verified, deep pools of both venues, the most traded in a day first. */
export function harborPools(pools: readonly CatalogPool[], limit = HARBOR_POOLS): HarborPool[] {
  return pools
    .map(harborPool)
    .filter((pool): pool is HarborPool => pool !== null)
    .sort((a, b) => (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || b.tvlUsd - a.tvlUsd || (a.address < b.address ? -1 : 1))
    .slice(0, limit);
}

/**
 * The bins on each side of the price a new DLMM position takes in the Harbor: the widest the engine builds in one
 * position (69 bins), so a simple card leaves the range as late as one position can.
 */
export const HARBOR_HALF_BINS = 34;

export type HarborRange =
  | Readonly<{ kind: 'bins'; low: number; high: number; downPct: number; upPct: number; half: number }>
  | Readonly<{ kind: 'band'; low: number | null; high: number | null; downPct: number | null; upPct: number | null }>
  | Readonly<{ kind: 'curve' }>;

/**
 * Where a new position earns: DLMM — the engine counts the bins from the active bin it reads at the Review, around the
 * price; DAMM v2 — the pool's own range, the same for everyone.
 */
export function defaultRange(pool: HarborPool): HarborRange {
  if (pool.kind === 'dlmm' && pool.binStepBps) {
    const step = 1 + pool.binStepBps / 10_000;
    const low = pool.price * step ** -HARBOR_HALF_BINS;
    const high = pool.price * step ** HARBOR_HALF_BINS;
    return { kind: 'bins', low, high, downPct: (1 - low / pool.price) * 100, upPct: (high / pool.price - 1) * 100, half: HARBOR_HALF_BINS };
  }
  const band = pool.band;
  if (!band || (band.min === null && band.max === null)) return { kind: 'curve' };
  return {
    kind: 'band',
    low: band.min,
    high: band.max,
    downPct: band.min === null ? null : Math.max(0, (1 - band.min / pool.price) * 100),
    upPct: band.max === null ? null : Math.max(0, (band.max / pool.price - 1) * 100),
  };
}

/** The range in a few words: 101.7 – 104.6 USDC, or every price. */
export function rangeText(pool: HarborPool, range: HarborRange): string {
  if (range.kind === 'curve') return wordsNow(HARBOR_FIGURES).everyPrice;
  const low = range.low === null ? '0' : formatPrice(range.low);
  const high = range.high === null ? '∞' : formatPrice(range.high);
  return `${low} – ${high} ${pool.y.symbol}`;
}

/**
 * The risk of leaving the range, in words, two short sentences at most: where it stops earning and what it then holds;
 * on the plain curve, what a move does instead.
 */
export function riskWords(pool: HarborPool, range: HarborRange): string {
  const w = wordsNow(HARBOR_FIGURES);
  const coin = pool.x.symbol;
  if (range.kind === 'curve') return w.riskCurve(coin);
  if (range.kind === 'bins') return w.riskBins(coin, percent(Math.min(range.downPct, range.upPct)));
  // A band is the pool's own and rarely even: its two edges, as prices.
  const edges = [range.low === null ? null : w.below(formatPrice(range.low)), range.high === null ? null : w.above(formatPrice(range.high))].filter(Boolean).join(` ${w.or} `);
  return w.riskBand(coin, edges, pool.y.symbol);
}

/**
 * What an amount would have earned in the day gone: its share of the pool's depth, times what the pool's trades paid
 * liquidity in 24 hours. DLMM pays the bins at the price more than the edges, so this is only "about". Null when the
 * pool states no fees.
 */
export function feeShare(pool: HarborPool, depositUsd: number): Readonly<{ sharePct: number; dayUsd: number }> | null {
  if (!(depositUsd > 0) || pool.lpFees24hUsd === null) return null;
  const share = depositUsd / (pool.tvlUsd + depositUsd);
  return { sharePct: share * 100, dayUsd: pool.lpFees24hUsd * share };
}

/* The figures below are for the eye only: written the English way, then in the language on screen (`digits`). */

export function percent(value: number): string {
  return digits(percentText(value));
}

function percentText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10) return `${Math.round(value)}%`;
  if (value >= 1) return `${Number(value.toFixed(1))}%`;
  if (value >= 0.01) return `${Number(value.toFixed(2))}%`;
  // A small share keeps one real digit: 0.001%, never a rounded zero.
  if (value >= 0.0001) return `${Number(value.toPrecision(1))}%`;
  return '<0.0001%';
}

export function formatPrice(p: number): string {
  return digits(priceText(p));
}

function priceText(p: number): string {
  if (!(p > 0)) return '0';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return Number(p.toFixed(p >= 100 ? 1 : 2)).toString();
  if (p >= 0.01) return Number(p.toFixed(4)).toString();
  // Three figures after the leading zeros, written out: a price under a millionth is never «3.7e-7» (CITY-243).
  return plainFigure(p, { significant: 3 });
}

export function usd(v: number | null): string {
  return digits(usdText(v));
}

function usdText(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `$${(v / 1e3).toFixed(0)}K`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return v > 0 ? '<$0.01' : '$0';
}
