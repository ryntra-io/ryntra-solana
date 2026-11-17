import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import type { EarnPool } from '../../lib/earn-pools/model.ts';
import type { PositionView } from '../../lib/liquidity/catalog/positions.ts';
import { inChart, type LayerLine } from './chart-layer.ts';

/**
 * What a pool says over a coin's chart: where its liquidity lies, as strips by the price scale, and the
 * edges of the person's own positions, as lines. Both go through the chart's own layer (`chart-layer.ts`), beside the
 * ticket's ladder. The strips' prices are the pool's, turned to the chart's dollars against the price both agree on
 * now; a position's edges are drawn only where its pool prices the coin in dollars, as those very prices.
 *
 * Pure: the screen reads the pool and the positions and writes the slots.
 */

const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** The dollars a pool may be priced in for a dollar chart. */
const DOLLAR_MINTS: ReadonlySet<string> = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

/**
 * The pool a coin's liquidity is drawn from, for a chart in dollars: the deepest DLMM pool of verified coins that sets
 * the coin against a dollar; else, for a coin that is not SOL, the deepest that sets it against SOL. A pool against
 * anything else — a staked SOL against SOL on SOL's own chart — says nothing of the coin's dollar price and is not
 * taken. Null — none listed.
 */
export function poolOfCoin(pools: readonly EarnPool[], mint: string): Readonly<{ pool: EarnPool; side: 'x' | 'y' }> | null {
  let dollar: EarnPool | null = null;
  let sol: EarnPool | null = null;
  for (const pool of pools) {
    if (pool.kind !== 'dlmm' || !pool.x.verified || !pool.y.verified) continue;
    if (pool.x.mint !== mint && pool.y.mint !== mint) continue;
    const other = pool.x.mint === mint ? pool.y.mint : pool.x.mint;
    if (DOLLAR_MINTS.has(other)) {
      if (!dollar || pool.tvlUsd > dollar.tvlUsd) dollar = pool;
    } else if (other === SOL_MINT && mint !== SOL_MINT) {
      if (!sol || pool.tvlUsd > sol.tvlUsd) sol = pool;
    }
  }
  const best = dollar ?? sol;
  return best ? { pool: best, side: best.x.mint === mint ? 'x' : 'y' } : null;
}

/** A pool's price (Y per one X) as the coin's own price in the pool's other coin: itself for X, turned over for Y. */
const coinPrice = (price: number, side: 'x' | 'y'): number => (side === 'x' ? price : 1 / price);

/** The most strips a chart carries: a pool's steps are gathered into this many bands. */
export const DEPTH_BANDS = 24;

/**
 * The pool's liquidity as strips at prices of the chart: its steps gathered into bands, each as long as what lies on it
 * against the deepest band. A band nothing lies on is not drawn. Empty where the coin's dollar price is not known.
 */
export function depthLines(answer: EarnBinsAnswer, side: 'x' | 'y', coinUsd: number | null, bands: number = DEPTH_BANDS): LayerLine[] {
  if (!answer.bins.length || !(bands > 0)) return [];
  const size = Math.max(1, Math.ceil(answer.bins.length / bands));
  const now = coinPrice(answer.price, side);
  const worthOf = (bin: EarnBinsAnswer['bins'][number]) => (Number(bin.x) / 10 ** answer.x.decimals) * bin.price + Number(bin.y) / 10 ** answer.y.decimals;
  const gathered: { price: number; worth: number; id: number }[] = [];
  for (let start = 0; start < answer.bins.length; start += size) {
    const group = answer.bins.slice(start, start + size);
    const middle = group[Math.floor(group.length / 2)]!;
    gathered.push({ price: middle.price, worth: group.reduce((sum, bin) => sum + worthOf(bin), 0), id: middle.id });
  }
  const top = gathered.reduce((most, band) => Math.max(most, band.worth), 0);
  if (!(top > 0)) return [];
  const lines: LayerLine[] = [];
  for (const band of gathered) {
    if (!(band.worth > 0)) continue;
    const usd = inChart(coinPrice(band.price, side), now, coinUsd);
    if (usd === null) continue;
    lines.push({ id: `depth:${band.id}`, price: usd, tone: 'depth', tag: null, weight: band.worth / top });
  }
  return lines;
}

/**
 * The edges of the wallet's positions in pools that hold the coin, as lines at the chart's prices: each position its
 * lower and its upper edge, tagged with the price. A position on the plain curve has no edges.
 */
/**
 * A position's two edges as the coin's dollar prices, where its pool sets the coin against a dollar: the pool's price
 * (Y per one X) is then the coin's dollar price itself, or one over it. Null for any other pool — a staked SOL against
 * SOL says nothing of a dollar price, and its edges are not drawn on a chart in dollars — and for the plain curve.
 */
export function dollarEdges(view: Pick<PositionView, 'x' | 'y' | 'lower' | 'upper'>, mint: string): Readonly<{ low: number; high: number }> | null {
  if (view.lower === null || view.upper === null || !(view.lower > 0) || !(view.upper > view.lower)) return null;
  if (view.x.mint === mint && DOLLAR_MINTS.has(view.y.mint)) return { low: view.lower, high: view.upper };
  if (view.y.mint === mint && DOLLAR_MINTS.has(view.x.mint)) return { low: 1 / view.upper, high: 1 / view.lower };
  return null;
}

/** Whether a position has edges to draw on the coin's chart. */
export function hasEdges(view: Pick<PositionView, 'x' | 'y' | 'lower' | 'upper'>, mint: string): boolean {
  return dollarEdges(view, mint) !== null;
}

/**
 * The edges of the wallet's positions in dollar pools of the coin, as lines at the chart's prices: each position its
 * lower and its upper edge, tagged with the price.
 */
export function positionLines(views: readonly PositionView[], mint: string, tag: (usd: number) => string): LayerLine[] {
  const lines: LayerLine[] = [];
  for (const view of views) {
    const edges = dollarEdges(view, mint);
    if (!edges) continue;
    lines.push({ id: `position:${view.address}:low`, price: edges.low, tone: 'held', tag: tag(edges.low) });
    lines.push({ id: `position:${view.address}:high`, price: edges.high, tone: 'held', tag: tag(edges.high) });
  }
  return lines;
}
