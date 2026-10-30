/**
 * The Exchange's chart source: the core chart's feed for a Phoenix perpetual (B7), unchanged — Phoenix's traded-price
 * and mark bars from the engine's `/api/solana/futures/candles`, the contract `ryntra.chart/2.2`. The city reads it from
 * the futures page's file, where the chart line keeps it, as the tower chart reads the spot feed (`city/lib/chart/feed.ts`);
 * when CITY-13 retires the old screens, this file moves with the feed (to `lib/`) rather than going with them.
 */
export { FuturesChartFeed, LAST_BASIS, MARK_BASIS, resolutionOf, timeframeOf } from '../../../app/solana/workspace/futures/futures-chart-source.ts';
