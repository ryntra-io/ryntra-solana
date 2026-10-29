/**
 * Pool names on a company's page (UX-505, UX-954). Anyone can name a pool on
 * the venue, and the page — rendered on the server and indexed — never says a
 * hate word: a pool whose name or other token carries one is left out, never
 * masked, as Pulse leaves such a token out (`offensive-names.ts`); the counts
 * are the pools shown. Pure, so the card and the tests read one rule.
 */

import { isMeaningful, primaryOf, type LiquidityPool, type StockLiquidity } from "../../../../lib/liquidity/model.ts";
import { isOffensiveName } from "../../../../lib/spot/offensive-names.ts";

/** Whether a pool's name, or its other token's symbol or name, carries a hate word. */
export function isOffensivePool(pool: Pick<LiquidityPool, "name" | "counter">): boolean {
  return isOffensiveName(pool.name, pool.counter.symbol, pool.counter.name);
}

/** The read without the offensive pools, its primary and counts said again from what is left. */
export function withoutOffensivePools(liquidity: StockLiquidity): StockLiquidity {
  if (!liquidity.pools.some(isOffensivePool)) return liquidity;
  const pools = liquidity.pools.filter((pool) => !isOffensivePool(pool));
  return {
    ...liquidity,
    pools,
    /* The primary said again from the pools left, as the read chose it: a clean money pool still leads. */
    primary: liquidity.primary && !isOffensivePool(liquidity.primary) ? liquidity.primary : primaryOf(pools),
    meaningfulCount: pools.filter(isMeaningful).length,
    dustCount: pools.filter((pool) => !isMeaningful(pool)).length,
  };
}

/** A pool's name as the page may say it: the name, or null when it carries a hate word. */
export function sayablePoolName(name: string | null | undefined): string | null {
  return name && !isOffensiveName(name) ? name : null;
}
