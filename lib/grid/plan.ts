/**
 * A grid on Meteora DLMM Pro: buy lower, sell higher, inside a band of prices — the arithmetic, and nothing else.
 *
 * A grid is two ladders of the lane's limit orders (`lib/pro-limits/`): a ladder of buys under the price and a ladder of
 * sells over it, each up to 25 prices of one order (`MAX_ORDER_TICKS`), placed together in one approval of the wallet.
 * The program fills each price exactly at its tick, and the maker keeps a share of the pool's fee on what filled
 * (D-M3: a fifth of that share is Ryntra's referral, shown before the signature).
 *
 * - **Levels.** The band's prices are geometric: each one step of the same percent above the last, from the lower edge
 *   to the upper one. A step in percent is a step in ticks (a tick is the price 1.0001^tick), so the lane's ladder —
 *   spread evenly in ticks between its nearest and farthest price — lands on the grid's own levels, to the pool's tick
 *   spacing.
 * - **Sides.** Levels under the price are buys, over it sells; the level within half a step of the price is skipped —
 *   an order there would fill at once.
 * - **Money.** The same value at every level: the amount in the quote coin over the levels placed. The buys rest the
 *   quote coin; the sells rest the coin, as much of it as that value buys at the price now.
 * - **Again.** What filled is taken back to the wallet, then placed again on the grid's empty levels on the other side
 *   of the price: the coin a buy bought is sold one level up or more, the quote a sell was paid buys one level down or
 *   more. That is the grid's cycle; each cycle earns the step.
 *
 * Pure: no I/O, no clock. Floats choose levels and show numbers; the money sent is base units, as the lane builds it.
 */

/** The most prices one ladder holds: the program's own limit of one order. */
export const GRID_MAX_PER_SIDE = 25;
/** The fewest and the most levels of a band. */
export const GRID_MIN_LEVELS = 2;
export const GRID_MAX_LEVELS = 50;
/** A buy rests no farther than 99 % under the price (the lane's own reach). */
const MAX_BUY_BPS = 9_900;
const MAX_SELL_BPS = 990_000;

export type GridShape = Readonly<{ lower: number; upper: number; levels: number }>;
export type GridIntent = Readonly<{ action: 'buy' | 'sell'; nearBps: number; farBps: number; rungs: number; spread: 'even'; amountRaw: string }>;
export type GridIssue = 'range' | 'levels' | 'side' | 'amount' | 'near';

const finite = (value: number): boolean => typeof value === 'number' && Number.isFinite(value);

/** Whether a band can be drawn at all: two positive prices, the lower under the upper, a whole count of levels. */
export function shapeIssue(shape: GridShape): GridIssue | null {
  if (!finite(shape.lower) || !finite(shape.upper) || shape.lower <= 0 || shape.upper <= shape.lower) return 'range';
  if (!Number.isInteger(shape.levels) || shape.levels < GRID_MIN_LEVELS || shape.levels > GRID_MAX_LEVELS) return 'levels';
  return null;
}

/** One step between two levels, as a fraction: (upper / lower)^(1 / (levels − 1)) − 1. */
export function gridStep(shape: GridShape): number {
  if (shapeIssue(shape)) return 0;
  return Math.pow(shape.upper / shape.lower, 1 / (shape.levels - 1)) - 1;
}

/** The band's levels, lowest first. */
export function gridPrices(shape: GridShape): number[] {
  if (shapeIssue(shape)) return [];
  const ratio = 1 + gridStep(shape);
  return Array.from({ length: shape.levels }, (_, index) => (index === shape.levels - 1 ? shape.upper : shape.lower * Math.pow(ratio, index)));
}

export type GridSplit = Readonly<{ buys: readonly number[]; sells: readonly number[]; skipped: number | null }>;

/**
 * Which levels buy and which sell at a price: under it buys, over it sells, and the one level within half a step of
 * it none — an order there would fill at once.
 */
export function gridSplit(prices: readonly number[], price: number, step: number): GridSplit {
  if (!(price > 0) || !prices.length) return { buys: [], sells: [], skipped: null };
  let nearest: number | null = null;
  for (const level of prices) if (nearest === null || Math.abs(level / price - 1) < Math.abs(nearest / price - 1)) nearest = level;
  const skipped = nearest !== null && Math.abs(nearest / price - 1) < step / 2 ? nearest : null;
  const buys = prices.filter((level) => level !== skipped && level < price);
  const sells = prices.filter((level) => level !== skipped && level > price);
  return { buys, sells, skipped };
}

/** How far a level is from the price, basis points of the price, positive away from it. */
export function awayBps(level: number, price: number): number {
  return Math.round(Math.abs(level / price - 1) * 10_000);
}

/**
 * One ladder of the lane over levels on one side of the price: its nearest and farthest price as distances from the
 * price, as many prices as levels (at most 25, the nearest kept), the amount spread evenly. Null — no level, or none
 * the lane can take (nearer than a basis point, farther than its reach).
 */
export function ladderOver(levels: readonly number[], price: number, action: 'buy' | 'sell', amountRaw: bigint): GridIntent | null {
  if (!levels.length || amountRaw <= 0n || !(price > 0)) return null;
  const sorted = [...levels].sort((a, b) => (action === 'buy' ? b - a : a - b)).slice(0, GRID_MAX_PER_SIDE);
  const near = awayBps(sorted[0]!, price);
  const far = awayBps(sorted[sorted.length - 1]!, price);
  if (near < 1 || far > (action === 'buy' ? MAX_BUY_BPS : MAX_SELL_BPS)) return null;
  return { action, nearBps: near, farBps: Math.max(near, far), rungs: sorted.length, spread: 'even', amountRaw: amountRaw.toString() };
}

/** A whole amount as base units, rounded down. */
export function rawOf(whole: number, decimals: number): bigint {
  if (!finite(whole) || whole <= 0) return 0n;
  /* Three digits past the base unit, then cut: rounded down, never up into money the wallet does not hold. */
  const [int, frac = ''] = whole.toFixed(Math.min(decimals + 3, 20)).split('.');
  return BigInt(int! + frac.padEnd(decimals, '0').slice(0, decimals));
}

/** Base units as a whole amount — a number to show. */
export function wholeOf(raw: bigint | string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

export type GridMarket = Readonly<{ price: number; coinDecimals: number; quoteDecimals: number }>;

export type GridPlan = Readonly<{
  prices: readonly number[];
  step: number;
  split: GridSplit;
  buy: GridIntent | null;
  sell: GridIntent | null;
  /** The quote coin each level holds the worth of. */
  perLevel: number;
  /** What the grid takes from the wallet: the quote coin the buys rest, the coin the sells rest. */
  put: Readonly<{ quoteRaw: bigint; coinRaw: bigint }>;
  issue: GridIssue | null;
}>;

/**
 * The grid a person draws: the band, its levels, an amount in the quote coin. The same worth at every level placed:
 * the buys rest that much of the quote coin each, the sells that much of the coin at the price now.
 */
export function gridPlan(shape: GridShape, amount: number, market: GridMarket): GridPlan {
  const empty = { prices: [], step: 0, split: { buys: [], sells: [], skipped: null }, buy: null, sell: null, perLevel: 0, put: { quoteRaw: 0n, coinRaw: 0n } };
  const shaped = shapeIssue(shape);
  if (shaped) return { ...empty, issue: shaped };
  const prices = gridPrices(shape);
  const step = gridStep(shape);
  const split = gridSplit(prices, market.price, step);
  const base = { ...empty, prices, step, split };
  if (split.buys.length > GRID_MAX_PER_SIDE || split.sells.length > GRID_MAX_PER_SIDE) return { ...base, issue: 'side' };
  const placed = split.buys.length + split.sells.length;
  if (!finite(amount) || amount <= 0 || placed === 0) return { ...base, issue: 'amount' };
  const perLevel = amount / placed;
  const quoteRaw = rawOf(perLevel * split.buys.length, market.quoteDecimals);
  const coinRaw = rawOf((perLevel * split.sells.length) / market.price, market.coinDecimals);
  const buy = ladderOver(split.buys, market.price, 'buy', quoteRaw);
  const sell = ladderOver(split.sells, market.price, 'sell', coinRaw);
  if ((split.buys.length && !buy) || (split.sells.length && !sell)) return { ...base, perLevel, issue: quoteRaw === 0n || coinRaw === 0n ? 'amount' : 'near' };
  return { prices, step, split, buy, sell, perLevel, put: { quoteRaw: buy ? quoteRaw : 0n, coinRaw: sell ? coinRaw : 0n }, issue: null };
}

/**
 * The grid's empty levels at a price, given what still rests: sells from the first level over the price up to the
 * lowest sell still resting (or the band's top), buys from the first level under it down to the highest buy still
 * resting (or the band's bottom). The level within half a step of the price stays empty.
 */
export function emptyLevels(prices: readonly number[], step: number, price: number, resting: Readonly<{ buyHigh: number | null; sellLow: number | null }>): Readonly<{ buys: number[]; sells: number[] }> {
  const split = gridSplit(prices, price, step);
  /* A level still resting is its own; the edges are compared within a tenth of a step — the ticks round the levels. */
  const tolerance = 1 + step / 10;
  const sells = split.sells.filter((level) => resting.sellLow === null || level < resting.sellLow / tolerance);
  const buys = split.buys.filter((level) => resting.buyHigh === null || level > resting.buyHigh * tolerance);
  return { buys, sells };
}

/**
 * Placing again what was taken: the coin over the empty levels above the price, the quote coin over those under it.
 * A side with nothing to place, or no empty level, is null.
 */
export function refillPlan(prices: readonly number[], step: number, price: number, resting: Readonly<{ buyHigh: number | null; sellLow: number | null }>, free: Readonly<{ coinRaw: bigint; quoteRaw: bigint }>): Readonly<{ buy: GridIntent | null; sell: GridIntent | null }> {
  const empty = emptyLevels(prices, step, price, resting);
  return {
    sell: free.coinRaw > 0n ? ladderOver(empty.sells, price, 'sell', free.coinRaw) : null,
    buy: free.quoteRaw > 0n ? ladderOver(empty.buys, price, 'buy', free.quoteRaw) : null,
  };
}

/**
 * Whether a ladder the lane built lands on the grid: as many prices as levels asked for, each within half a step of a
 * level. A ladder the pool's spacing merged, or one that moved with the price since the screen was drawn, is not placed.
 */
export function onLevels(prices: readonly number[], levels: readonly number[], rungs: number, step: number): boolean {
  if (prices.length !== rungs || !levels.length || !(step > 0)) return false;
  const half = Math.log(1 + step) / 2;
  return prices.every((price) => price > 0 && levels.some((level) => Math.abs(Math.log(price / level)) <= half));
}
