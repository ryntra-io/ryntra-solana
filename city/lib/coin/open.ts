import { useAgent } from '../agent/store.ts';
import { useCity } from '../city/store.ts';
import { useHarbor } from '../districts/harbor/store.ts';
import { useLaunch } from '../launch/district.ts';
import type { Tower } from '../market/types.ts';
import { readCoinFacts, type CoinFacts } from '../search/sources.ts';
import { useTrade } from '../trade/store.ts';

/**
 * Opening one coin in the city, from its link (`/c/<mint>`) or the search: a coin that stands in the city is flown to
 * and its card opens, exactly as a tap on its tower; a coin that does not opens the city's trade card for it, named as
 * the engine names it. One panel at a time: the agent's, the Harbor's and the Launch sheet give way.
 */

export type CoinRef = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;

export function standsInCity(mint: string): boolean {
  return useCity.getState().layout.towers.some((placed) => placed.tower.id === mint);
}

function clearPanels() {
  useAgent.getState().closePanel();
  useHarbor.getState().hide();
  if (useLaunch.getState().sheet) useLaunch.getState().closeSheet();
}

/** Fly to the tower and open its card. */
export function openTower(mint: string): void {
  clearPanels();
  useCity.getState().select(mint);
}

/** The trade card for a coin that is not a tower: no tower is picked, so nothing else closes it. */
export function openTradeCard(coin: CoinRef): void {
  clearPanels();
  useCity.getState().select(null);
  useTrade.getState().openFor({ id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon } as Tower);
}

/** A coin by its mint: its tower, or its trade card once the engine names it; false when nothing names it. */
export async function openCoin(mint: string, known: CoinFacts | CoinRef | null = null, signal?: AbortSignal): Promise<boolean> {
  if (standsInCity(mint)) {
    openTower(mint);
    return true;
  }
  const facts = known ?? (await readCoinFacts(mint, { signal }));
  if (signal?.aborted || !facts) return false;
  /* The city may have read the coin's tower in the meantime. */
  if (standsInCity(mint)) openTower(mint);
  else openTradeCard(facts);
  return true;
}
