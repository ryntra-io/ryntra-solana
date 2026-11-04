import { SOLANA_MAINNET_USDC_MINT } from '../../../lib/solana/send-kinds.ts';
import type { LiquidityReview } from '../../../lib/liquidity/studio/actions.ts';
import { spendable, toUnits } from '../districts/harbor/deposit.ts';
import type { HarborPool, HarborToken } from '../districts/harbor/pools.ts';
import type { Holdings } from '../trade/wallet.ts';
import { LST_BY_MINT, SOL_MINT, type Lst } from './lst.ts';

/**
 * The SOL Pier (CITY-93, `docs/research/ryntra-earn-2026-10-29/SPEC.md` E2): the Harbor inside the Earn window. A pier
 * is a Meteora DLMM pool of SOL against an LST or against USDC; the person types an amount in SOL, picks one of three
 * styles, and the engine's Liquidity Studio builds the position around the price — its own `shape` and `range.half`,
 * nothing new in the engine. Every result is said in SOL; what a pool paid is the day gone, never a promise.
 *
 * Pure: the window, the store, the routes and the tests import it alike.
 */

export const USDC_MINT = SOLANA_MAINNET_USDC_MINT;

/** Calm → wide and even; Balanced → half as wide; Dense → close to the price, earns most while it stays and leaves soonest. */
export const PIER_STYLES = ['calm', 'balanced', 'dense'] as const;
export type PierStyle = (typeof PIER_STYLES)[number];

/**
 * Bins on each side of the price for each style. Calm is the widest one position holds in the engine (69 bins); the
 * spread is even (`spot`) in all three, so a style is only how wide — the one thing that decides how soon a move
 * leaves the range — and the engine's own arithmetic (`simulateBins`) pictures it exactly.
 */
export const STYLE_HALF: Readonly<Record<PierStyle, number>> = { calm: 34, balanced: 16, dense: 5 };
/** Risk dots per style: the narrower, the sooner it stops earning and the more a move costs against holding. */
export const STYLE_RISK: Readonly<Record<PierStyle, 1 | 2 | 3>> = { calm: 1, balanced: 2, dense: 3 };
export const DEFAULT_STYLE: PierStyle = 'balanced';

export function isPierStyle(value: unknown): value is PierStyle {
  return typeof value === 'string' && (PIER_STYLES as readonly string[]).includes(value);
}

/** How far the price may move between the Review and the chain before the program refuses, basis points. */
export const PIER_SLIPPAGE_BPS = 100;

/** The least that may go in, before the Review says what never comes back: 0.05 SOL. */
export const PIER_MIN_LAMPORTS = 50_000_000n;
/** What never comes back (pool rent, the network) stays at most this share of what goes in: one twentieth. */
export const PIER_LOST_SHARE = 20n;
/**
 * SOL kept aside before a Review states it: a new DLMM position's rent (it comes back on exit) and the network. The
 * Review's own figure replaces it at once.
 */
export const PIER_RESERVE_LAMPORTS = 65_000_000n;

export type PierPair = 'lst' | 'usdc';

export type Pier = Readonly<{
  pool: HarborPool;
  pair: PierPair;
  /** Which side of the pool is SOL: X — SOL–USDC; Y — LST–SOL. */
  solSide: 'x' | 'y';
  sol: HarborToken;
  other: HarborToken;
  lst: Lst | null;
}>;

/** A Harbor pool as a SOL pier: DLMM, one side SOL, the other an LST of the SOL Saver or USDC; null for anything else. */
export function pierOf(pool: HarborPool): Pier | null {
  if (pool.kind !== 'dlmm' || !(pool.binStepBps && pool.binStepBps > 0) || !(pool.price > 0)) return null;
  const xSol = pool.x.mint === SOL_MINT;
  const ySol = pool.y.mint === SOL_MINT;
  if (xSol === ySol) return null;
  const other = xSol ? pool.y : pool.x;
  const lst = LST_BY_MINT.get(other.mint) ?? null;
  const pair: PierPair | null = other.mint === USDC_MINT ? 'usdc' : lst ? 'lst' : null;
  if (!pair) return null;
  return { pool, pair, solSide: xSol ? 'x' : 'y', sol: xSol ? pool.x : pool.y, other, lst };
}

/** The SOL piers of a pools list, the most paid in a day first (in SOL), LST piers before USDC ones on a tie. */
export function solPiers(pools: readonly HarborPool[]): Pier[] {
  return pools
    .map(pierOf)
    .filter((pier): pier is Pier => pier !== null)
    .sort((a, b) => (feesSol24h(b) ?? -1) - (feesSol24h(a) ?? -1) || (a.pair === b.pair ? 0 : a.pair === 'lst' ? -1 : 1) || b.pool.tvlUsd - a.pool.tvlUsd);
}

/** SOL for one whole unit of the other coin, at the pool's own price. */
export function otherInSol(pier: Pier): number {
  return pier.solSide === 'y' ? pier.pool.price : 1 / pier.pool.price;
}

/** The dollar price of SOL as the venue states it; null when it states none. */
export function solUsd(pier: Pier): number | null {
  const direct = pier.sol.priceUsd;
  if (direct !== null && direct > 0) return direct;
  const other = pier.other.priceUsd;
  return other !== null && other > 0 ? other / otherInSol(pier) : null;
}

/** Dollars as SOL at the venue's own price; null without one. */
export function usdToSol(pier: Pier, usd: number | null): number | null {
  const price = solUsd(pier);
  return usd === null || !Number.isFinite(usd) || price === null ? null : usd / price;
}

/** What trades paid the pool's liquidity in the last 24 hours, in SOL. */
export function feesSol24h(pier: Pier): number | null {
  return usdToSol(pier, pier.pool.lpFees24hUsd);
}

/** The pool's depth in SOL. */
export function depthSol(pier: Pier): number | null {
  return usdToSol(pier, pier.pool.tvlUsd);
}

export type PierRange = Readonly<{ half: number; low: number; high: number; downPct: number; upPct: number }>;

/** Where a new position earns for a style: the engine counts the same bins from the active bin it reads at the Review. */
export function pierRange(pier: Pier, style: PierStyle): PierRange {
  const half = STYLE_HALF[style];
  const step = 1 + pier.pool.binStepBps! / 10_000;
  const low = pier.pool.price * step ** -half;
  const high = pier.pool.price * step ** half;
  return { half, low, high, downPct: (1 - low / pier.pool.price) * 100, upPct: (high / pier.pool.price - 1) * 100 };
}

export type PierSplit = Readonly<{
  /** Base units for the engine, X and Y of the pool. */
  x: string;
  y: string;
  /** The SOL side, lamports, and the other coin's side in its base units. */
  solLamports: bigint;
  otherUnits: bigint;
}>;

/**
 * An amount of SOL as the pool's two coins: half its worth as SOL, half as the other coin at the pool's price — an
 * even spread around the price takes the two in equal worth. The engine's Review then says exactly what goes in.
 */
export function pierSplit(pier: Pier, lamports: bigint): PierSplit | null {
  if (lamports <= 0n) return null;
  const solLamports = lamports / 2n;
  const otherSol = Number(lamports - solLamports) / 1e9;
  const otherUnits = BigInt(toUnits(otherSol / otherInSol(pier), pier.other.decimals));
  if (solLamports <= 0n || otherUnits <= 0n) return null;
  const sol = solLamports.toString();
  const other = otherUnits.toString();
  return { x: pier.solSide === 'x' ? sol : other, y: pier.solSide === 'x' ? other : sol, solLamports, otherUnits };
}

export type PierFit = Readonly<{
  /** The wallet holds both sides and the SOL kept aside; true while the wallet is unknown — the engine has the last word. */
  fits: boolean;
  short: 'sol' | 'other' | null;
  /** How much of the other coin is missing, base units, and its worth in lamports. */
  otherMissing: bigint;
  otherMissingLamports: bigint;
}>;

/** Whether the wallet can put the split in and still pay `reserve` lamports of rent and network. */
export function pierFit(pier: Pier, split: PierSplit | null, holdings: Holdings | null, reserve: bigint = PIER_RESERVE_LAMPORTS): PierFit {
  const none: PierFit = { fits: true, short: null, otherMissing: 0n, otherMissingLamports: 0n };
  if (!split) return none;
  const sol = spendable(holdings, SOL_MINT);
  const other = spendable(holdings, pier.other.mint);
  if (sol !== null && split.solLamports + reserve > sol) return { fits: false, short: 'sol', otherMissing: 0n, otherMissingLamports: 0n };
  if (other !== null && split.otherUnits > other) {
    const missing = split.otherUnits - other;
    const lamports = BigInt(Math.ceil((Number(missing) / 10 ** pier.other.decimals) * otherInSol(pier) * 1e9));
    return { fits: false, short: 'other', otherMissing: missing, otherMissingLamports: lamports };
  }
  return none;
}

/** The most the wallet can put in, lamports of worth: twice the smaller side it can spend; null while the wallet is unknown. */
export function pierMax(pier: Pier, holdings: Holdings | null, reserve: bigint = PIER_RESERVE_LAMPORTS): bigint | null {
  const sol = spendable(holdings, SOL_MINT);
  const other = spendable(holdings, pier.other.mint);
  if (sol === null || other === null) return null;
  const fromSol = sol > reserve ? sol - reserve : 0n;
  const fromOther = BigInt(Math.floor((Number(other) / 10 ** pier.other.decimals) * otherInSol(pier) * 1e9));
  const side = fromSol < fromOther ? fromSol : fromOther;
  return side * 2n;
}

/** What a Review costs in SOL besides the deposit: rent paid (and the part of it that comes back) and the network. */
export type PierCosts = Readonly<{ rent: bigint; rentBack: bigint; network: bigint; lost: bigint; total: bigint }>;

export function pierCosts(review: LiquidityReview): PierCosts {
  let rent = 0n;
  let rentBack = 0n;
  for (const row of review.preview.rent) {
    if (row.direction !== 'pay' || !/^\d+$/.test(row.lamports)) continue;
    rent += BigInt(row.lamports);
    if (row.refundable) rentBack += BigInt(row.lamports);
  }
  const network = /^\d+$/.test(review.networkFeeLamports) ? BigInt(review.networkFeeLamports) : 0n;
  return { rent, rentBack, network, lost: rent - rentBack + network, total: rent + network };
}

/**
 * The least worth putting in, lamports: never under 0.05 SOL, and high enough that what never comes back — the pool's
 * shared rent and the network — stays within a twentieth of it. Counted from the Review once there is one.
 */
export function pierMinimum(costs: PierCosts | null): bigint {
  if (!costs) return PIER_MIN_LAMPORTS;
  const byCost = costs.lost * PIER_LOST_SHARE;
  return byCost > PIER_MIN_LAMPORTS ? byCost : PIER_MIN_LAMPORTS;
}

export type PierAddBody = Readonly<{
  action: 'add';
  venue: 'meteora-dlmm';
  request: Readonly<{ pool: string; owner: string; amountX: string; amountY: string; shape: 'spot'; slippageBps: number }>;
  range: Readonly<{ place: 'around'; half: number }>;
}>;

/** A new position of the style around the price; the engine counts the bins from the active bin it reads. */
export function pierAddBody(pier: Pier, owner: string, split: PierSplit, style: PierStyle): PierAddBody {
  return {
    action: 'add',
    venue: 'meteora-dlmm',
    request: { pool: pier.pool.address, owner, amountX: split.x, amountY: split.y, shape: 'spot', slippageBps: PIER_SLIPPAGE_BPS },
    range: { place: 'around', half: STYLE_HALF[style] },
  };
}

/** Lamports as a short SOL figure for the eye: 0.05, 1.2345, 12.3. */
export function solShort(lamports: bigint | number | null): string {
  if (lamports === null) return '—';
  const value = typeof lamports === 'bigint' ? Number(lamports) / 1e9 : lamports;
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const places = abs === 0 ? 0 : abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  const body = abs.toLocaleString('en-US', { maximumFractionDigits: places, minimumFractionDigits: 0 });
  return `${value < 0 ? '−' : ''}${body}`;
}

/** A token amount in base units, short for the eye: 0.3967, 206.3, 1,587. */
export function unitsShort(units: bigint, decimals: number): string {
  return solShort(Number(units) / 10 ** decimals);
}

/**
 * A range's two prices with just enough places to tell them apart: an LST pier's bins are a hundredth of a per cent
 * apart, so 1.2584 – 1.2622, never 1.26 – 1.26.
 */
export function rangePrices(low: number, high: number): Readonly<{ low: string; high: string }> {
  if (!(low > 0) || !(high > low)) return { low: String(low), high: String(high) };
  const lead = Math.max(0, -Math.floor(Math.log10(low)));
  const start = Math.max(2, lead + 1);
  let places = start;
  while (places < 10 && low.toFixed(places) === high.toFixed(places)) places += 1;
  // Once places had to be added to tell them apart, one more says where each edge really sits.
  if (places > start) places = Math.min(10, places + 1);
  const text = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : Number(v.toFixed(places)).toString());
  return { low: text(low), high: text(high) };
}
