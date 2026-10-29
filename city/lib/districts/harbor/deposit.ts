import { WRAPPED_SOL_MINT } from '../../../../lib/solana/send-kinds.ts';
import { formatUnits } from '../../trade/format.ts';
import type { Holdings } from '../../trade/wallet.ts';
import { defaultRange, VENUE_OF, type HarborPool, type HarborRange } from './pools.ts';

/**
 * The amount of the Harbor's card and what it asks the engine. An amount is a tile of dollars, split over the pool's
 * two coins at the pool's own price, in the share the range takes them; the engine's Review then says exactly what
 * goes in (it takes the two coins in the pool's own ratio, the rest stays in the wallet). Nothing here sends, signs or
 * prices money: the Review is the figure the person signs.
 */

/** The amount tiles, dollars of value put in. */
export const DEPOSIT_TILES_USD = [10, 25, 50, 100] as const;
/** How far the price may move between the Review and the chain before the program refuses, basis points. */
export const HARBOR_SLIPPAGE_BPS = 100;

export type Split = Readonly<{ x: string; y: string; xShown: string; yShown: string }>;

/** A dollar price for one Y: the venue's own, or X's through the pool's price; null when the venue priced neither. */
export function yPriceUsd(pool: HarborPool): number | null {
  if (pool.y.priceUsd !== null && pool.y.priceUsd > 0) return pool.y.priceUsd;
  if (pool.x.priceUsd !== null && pool.x.priceUsd > 0) return pool.x.priceUsd / pool.price;
  return null;
}

/**
 * The part of the value that goes in as Y. Bins around the price and the plain curve take the two coins in equal value;
 * a DAMM v2 band takes them as its curve does at this price, and a band the price has left takes one coin only.
 */
export function yWeight(pool: HarborPool, range: HarborRange): number {
  if (range.kind !== 'band') return 0.5;
  const p = pool.price;
  const a = range.low ?? 0;
  const b = range.high ?? Infinity;
  if (p <= a) return 0;
  if (p >= b) return 1;
  // In a band [a, b] at price p, per unit of liquidity: Y = √p − √a, X·p = √p − p/√b.
  const y = Math.sqrt(p) - Math.sqrt(a);
  const x = Math.sqrt(p) - (Number.isFinite(b) ? p / Math.sqrt(b) : 0);
  return y + x > 0 ? y / (y + x) : 0.5;
}

/** A number of tokens as base units, never rounded up. */
export function toUnits(amount: number, decimals: number): string {
  if (!(amount > 0) || !Number.isFinite(amount)) return '0';
  const places = Math.min(decimals, 9);
  const head = BigInt(Math.floor(amount * 10 ** places));
  return (head * 10n ** BigInt(decimals - places)).toString();
}

/** `usd` of value as the two coins, base units; null without a dollar price. */
export function splitDeposit(pool: HarborPool, usd: number, range: HarborRange = defaultRange(pool)): Split | null {
  const yUsd = yPriceUsd(pool);
  if (yUsd === null || !(usd > 0)) return null;
  const inY = usd / yUsd;
  const w = yWeight(pool, range);
  const x = toUnits((inY * (1 - w)) / pool.price, pool.x.decimals);
  const y = toUnits(inY * w, pool.y.decimals);
  return { x, y, xShown: formatUnits(x, pool.x.decimals), yShown: formatUnits(y, pool.y.decimals) };
}

/** What the wallet can put in of one coin: native SOL for the SOL side (the venue wraps it), else the token. */
export function spendable(holdings: Holdings | null, mint: string): bigint | null {
  if (!holdings) return null;
  if (mint === WRAPPED_SOL_MINT) return holdings.sol ? BigInt(holdings.sol.spendableRaw) : holdings.complete ? 0n : null;
  const held = holdings.tokens.get(mint);
  if (held) return BigInt(held.spendableRaw);
  return holdings.complete ? 0n : null;
}

export type DepositTile = Readonly<{
  usd: number;
  split: Split | null;
  /** Within what the wallet holds; true while the wallet is unknown — the engine has the last word. */
  fits: boolean;
  /** The coin there is not enough of. */
  short: string | null;
  /** Above what the engine admits for this wallet now. */
  overCeiling: boolean;
}>;

export function depositTiles(pool: HarborPool, holdings: Holdings | null, ceilingUsd: number | null): DepositTile[] {
  const range = defaultRange(pool);
  return DEPOSIT_TILES_USD.map((usd) => {
    const split = splitDeposit(pool, usd, range);
    let short: string | null = null;
    if (split) {
      const hx = spendable(holdings, pool.x.mint);
      const hy = spendable(holdings, pool.y.mint);
      if (hx !== null && BigInt(split.x) > hx) short = pool.x.symbol;
      else if (hy !== null && BigInt(split.y) > hy) short = pool.y.symbol;
    }
    return { usd, split, fits: short === null, short, overCeiling: ceilingUsd !== null && usd > ceilingUsd };
  });
}

/** The tile the card starts on: the first that fits and the engine admits. */
export function startTile(tiles: readonly DepositTile[]): number {
  const index = tiles.findIndex((tile) => tile.split && tile.fits && !tile.overCeiling);
  return index < 0 ? 0 : index;
}

export type ReviewBody =
  | Readonly<{
      action: 'add';
      venue: string;
      request: Readonly<{ pool: string; owner: string; amountX: string; amountY: string; shape?: 'spot'; slippageBps: number }>;
      range?: Readonly<{ place: 'around'; half: number }>;
    }>
  | Readonly<{ action: 'remove'; venue: string; request: Readonly<{ position: string; owner: string; shareBps: number; close: boolean; slippageBps: number }> }>
  | Readonly<{ action: 'claim'; venue: string; request: Readonly<{ position: string; owner: string }> }>;

/** A new position with the card's amount; DLMM's bins are counted by the engine from the price it reads at the Review. */
export function addBody(pool: HarborPool, owner: string, split: Split): ReviewBody {
  const range = defaultRange(pool);
  const dlmm = pool.kind === 'dlmm' && range.kind === 'bins';
  return {
    action: 'add',
    venue: VENUE_OF[pool.kind],
    request: { pool: pool.address, owner, amountX: split.x, amountY: split.y, ...(dlmm ? { shape: 'spot' as const } : {}), slippageBps: HARBOR_SLIPPAGE_BPS },
    ...(dlmm ? { range: { place: 'around' as const, half: range.half } } : {}),
  };
}

/** Take the fees a position earned; the position stays. */
export function claimBody(venue: string, position: string, owner: string): ReviewBody {
  return { action: 'claim', venue, request: { position, owner } };
}

/** Leave: everything out, the fees with it, and the position closed so its rent comes back. */
export function exitBody(venue: string, position: string, owner: string): ReviewBody {
  return { action: 'remove', venue, request: { position, owner, shareBps: 10_000, close: true, slippageBps: HARBOR_SLIPPAGE_BPS } };
}
