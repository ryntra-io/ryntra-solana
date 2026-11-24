import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { digits } from '../../../city/lib/i18n/dict.ts';
import type { PoolsShelf, ShelfPool } from '../../../lib/stocks/pools-shelf.ts';
import { usdText } from '../../ui/figures.ts';

/**
 * What a stock's pools show, decided apart from the markup: whether there is a shelf at all, which rows stand
 * open, each row's one action and where it leads, and the figures as text. Pure.
 */

/** The one action of a row: the stock's limit with its bonus, the engine's deposit, or none — the pair alone opens the pool. */
export type ShelfAction = 'limit' | 'deposit' | null;

/** What this build offers: a deposit into a stock's DLMM pool, and into a stock's DLMM Pro pool (the terminal's switches). */
export type ShelfScreen = Readonly<{ dlmm: boolean; pro: boolean }>;

/** The rows that stand open before «All pools»; the pool of the stock's limits is always among them. */
export const SHELF_SHOWN = 4;

/** Whether the shelf shows at all: a stock with at least one pool. A coin that is no stock, or nothing read, shows nothing. */
export function shelfShown(shelf: PoolsShelf | null | undefined): shelf is PoolsShelf {
  return shelf?.isStock === true && shelf.pools.length > 0;
}

/**
 * A row's one action: the limit where the stock's limits rest (DLMM Pro's own, the pool takes orders now), else the
 * deposit where the engine takes new money and this build offers it, else none.
 */
export function actionOf(pool: ShelfPool, screen: ShelfScreen): ShelfAction {
  if (pool.limit) return 'limit';
  if (pool.deposit && (pool.venue === 'dlmm' ? screen.dlmm : screen.pro)) return 'deposit';
  return null;
}

/** Where a row leads: the pool's page, on the ticket's tab of its action (`terminal/pool/desk-pool.ts`, `poolHref`). */
export function hrefOf(pool: Pick<ShelfPool, 'address'>, action: ShelfAction): string {
  const tab = action === 'limit' ? 'limit' : action === 'deposit' ? 'position' : null;
  return tab ? `/pool/${pool.address}?tab=${tab}` : `/pool/${pool.address}`;
}

/** The rows standing open: all of them, or the first `SHELF_SHOWN` with the limit's pool kept in place of the last. */
export function shownPools(pools: readonly ShelfPool[], all: boolean): readonly ShelfPool[] {
  if (all || pools.length <= SHELF_SHOWN) return pools;
  const top = pools.slice(0, SHELF_SHOWN);
  const limit = pools.find((pool) => pool.limit);
  if (limit && !top.includes(limit)) top.splice(SHELF_SHOWN - 1, 1, limit);
  return top;
}

/** A per cent with no more decimals than it needs: 0.8 → «0.8%», 0.32 → «0.32%», 0.0125 → «0.013%». */
export function pctText(pct: number, lang: Lang): string {
  if (!Number.isFinite(pct) || pct < 0) return '—';
  const places = pct >= 10 ? 1 : pct >= 0.1 ? 2 : 3;
  return digits(`${Number(pct.toFixed(places))}%`, lang);
}

/**
 * The pool's depth as the row's headline figure. Under ten thousand a thousand's tenth is kept — a thin pool of $1,554
 * reads «$1.6K», not «$2K» — above, the terminal's own short sum.
 */
export function depthText(pool: Pick<ShelfPool, 'tvlUsd'>, lang: Lang): string {
  const usd = pool.tvlUsd;
  if (Number.isFinite(usd) && usd >= 999.5 && usd < 9_950) return digits(`$${(usd / 1e3).toFixed(1)}K`, lang);
  return usdText(usd, lang);
}

/** A day's volume as text, and whether it is a floor; null — no figure to say. */
export function dayText(pool: Pick<ShelfPool, 'volume24hUsd' | 'volumeWhole'>, lang: Lang): Readonly<{ text: string; floor: boolean }> | null {
  if (pool.volume24hUsd === null) return null;
  return { text: usdText(pool.volume24hUsd, lang), floor: pool.volumeWhole === false };
}

/** USDC's own logo, kept with the site: the engine's logo route serves the market's coins and answers nothing for USDC. */
const USDC = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', logo: '/site/universe/USDC.png' } as const;

/** A coin's logo through Ryntra's own icon address, as every screen draws it (`terminal/earn/bits.tsx`). */
export const logoOf = (mint: string): string => (mint === USDC.mint ? USDC.logo : `/api/icon/${mint}`);

/** Where a logo is asked next when the engine's route has none: the catalogue's own, by the coin's address. */
export const logosAfter = (mint: string): readonly string[] => (mint === USDC.mint ? [] : [`/api/spot/icon?mint=${encodeURIComponent(mint)}`]);
