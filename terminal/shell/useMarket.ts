import { createContext, useContext } from 'react';
import { useCity } from '../../city/lib/city/store.ts';
import type { CitySnapshot } from '../../city/lib/market/types.ts';

/** The market the page was built with — the bundled snapshot the frame was given — for the frames before the store has one. */
export const MarketSeed = createContext<CitySnapshot | null>(null);

/**
 * The market a screen draws: the city's store once it holds a read (the bundled snapshot, then every live one, see
 * `./market.ts`), and until then the snapshot the frame was built with — so the server's page and the first paint
 * already show the coins, and agree.
 */
export function useMarket(): CitySnapshot {
  const live = useCity((st) => st.snapshot);
  const seed = useContext(MarketSeed);
  return live.towers.length || !seed ? live : seed;
}
