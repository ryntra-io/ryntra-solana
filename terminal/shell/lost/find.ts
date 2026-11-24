import type { Tower } from '../../../city/lib/market/types.ts';
import { pastedMint } from '../../../city/lib/search/mint.ts';
import { cleanQuery, listed, matches } from '../../market/market-view.ts';

/**
 * The coin search of the page where there is none: the coins the Market names, by ticker, name or address, from the market
 * read the frame already holds — nothing new is asked of the engine. A ticker typed whole comes first, then the busiest.
 * A pasted address the read does not hold still opens its coin's screen, which reads the coin itself.
 *
 * Pure: the page and the tests read it as it is.
 */

/** How many coins the page offers: one look, no scrolling. */
export const FOUND_MAX = 5;

export type Found = Readonly<{ coins: readonly Tower[]; mint: string | null }>;

export function findCoins(towers: readonly Tower[], query: string, max: number = FOUND_MAX): Found {
  const q = cleanQuery(query);
  if (!q) return { coins: [], mint: null };
  const pasted = pastedMint(query);
  const named = listed(towers).filter((tower) => matches(tower, query) || tower.id === pasted);
  const whole = (tower: Tower) => (tower.symbol.toLowerCase() === q ? 0 : 1);
  const coins = [...named].sort((a, b) => whole(a) - whole(b) || b.volume24h - a.volume24h).slice(0, max);
  return { coins, mint: pasted && !coins.some((tower) => tower.id === pasted) ? pasted : null };
}
