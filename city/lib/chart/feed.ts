import type { Tower } from '../market/types.ts';
import type { SpotChartFeed, SpotChartMarket } from '../../../app/solana/workspace/spot/core-chart-source.ts';

/**
 * The tower chart's source: the core chart's feed for a Solana market (CH-17), unchanged — the engine's candles of
 * the deepest pool, the last bar closed at the one live price, one update a bar a second, the core contract
 * `ryntra.chart/2.2`. The city reads it from the spot page's file, where the chart line keeps it; when CITY-13 retires
 * the old screens, this file moves with the feed (to `lib/`) rather than going with them.
 */
export { SpotChartFeed as TowerFeed, PRICE_BASIS, resolutionOf, tickFor, timeframeOf } from '../../../app/solana/workspace/spot/core-chart-source.ts';

/** A tower as the feed's market: a tokenized stock on Stock Avenue is a `stock`; the tower's price seeds the step. */
export function marketOf(tower: Pick<Tower, 'id' | 'symbol' | 'district' | 'price'>): SpotChartMarket {
  return {
    mint: tower.id,
    symbol: tower.symbol,
    stock: tower.district === 'avenue',
    capFactor: null,
    reference: Number.isFinite(tower.price) && tower.price > 0 ? tower.price : null,
  };
}

/** The feed's type, for the window. */
export type Feed = SpotChartFeed;
