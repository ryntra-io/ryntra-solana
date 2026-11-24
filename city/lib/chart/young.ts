import type { NormalizedCandle } from '../../../lib/chart/types.ts';
import { candlesFromTrades, TIMEFRAME_SOURCE } from '../../../lib/spot/candles.ts';
import { saysUnavailable, type ChartData, type Ready, type Timeframe } from './candles.ts';

/**
 * A chart from the first trade. A coin a minute old trades before the chart source has a single bar of it: its candles
 * are counted from its own trades — the same trades the tape lists — until the source wakes, then the source's bars
 * carry the chart and the trades only add what came after their newest bar, so the picture goes on without a jump.
 * «No chart yet» is said only while there is not one trade.
 *
 * Pure: the screen passes the engine's read and the trades it holds.
 */

/** A trade as a price at a moment: when, at what dollar price, for how many dollars. */
export type TradePoint = Readonly<{ at: string; priceUsd: number | null; usd: number | null }>;

/** The interval a chart of trades opens on: the finest the engine reads, a minute. */
export const YOUNG_TIMEFRAME: Timeframe = '1m';

const priced = (trade: TradePoint): boolean => trade.priceUsd !== null && Number.isFinite(trade.priceUsd) && trade.priceUsd > 0 && Number.isFinite(Date.parse(trade.at));

/** Whether any of the trades is a price at a moment — one is enough for a bar. */
export const hasPricedTrade = (trades: readonly TradePoint[]): boolean => trades.some(priced);

/** The trades as bars of the interval: each bar opens at its first trade's price, closes at its last; an empty stretch is no bar. */
export function tradeCandles(trades: readonly TradePoint[], timeframe: Timeframe): NormalizedCandle[] {
  return candlesFromTrades(trades, TIMEFRAME_SOURCE[timeframe].seconds);
}

/**
 * Whether the engine has nothing to draw for this market and interval — it said the coin has no chart, or it stays
 * unavailable — while the coin already trades. A read on its way is not «nothing»: the screen waits for it, unless it
 * already draws the trades (`drawing`), which then stay until the answer.
 */
export function wantsTrades(data: ChartData, mint: string, trades: readonly TradePoint[], drawing = false): boolean {
  if (data.mint !== mint || data.last || !hasPricedTrade(trades)) return false;
  if (data.status === 'none' || saysUnavailable(data)) return true;
  return drawing && (data.status === 'loading' || data.status === 'unavailable');
}

/**
 * The source's bars, then the trades' bars that opened after its newest: where both have a bar, the source's stands. The
 * newest bar on screen is still the newest trade, so the price does not step back when the source wakes.
 */
export function joinCandles(source: readonly NormalizedCandle[], fromTrades: readonly NormalizedCandle[]): NormalizedCandle[] {
  const last = source.at(-1);
  if (!last) return [...fromTrades];
  return [...source, ...fromTrades.filter((bar) => bar.time > last.time)];
}

/**
 * What the chart draws for a market and interval: the engine's read as it is; the trades' bars when the engine has none
 * (`wantsTrades`); and once the chart was drawn from trades (`joined`), the engine's bars with the newer trades after them.
 * Null — nothing to draw yet. `stale` — the trades' last read failed.
 */
export function chartRead(
  input: Readonly<{ data: ChartData; mint: string; timeframe: Timeframe; trades: readonly TradePoint[]; drawing: boolean; joined: boolean; stale: boolean; now: number }>,
): Ready | null {
  const { data, mint, timeframe, trades } = input;
  const engine = data.mint === mint && data.timeframe === timeframe ? data.last : null;
  if (engine) {
    if (!input.joined) return engine;
    const own = tradeCandles(trades, timeframe);
    return own.length ? { ...engine, candles: joinCandles(engine.candles, own) } : engine;
  }
  if (!wantsTrades(data, mint, trades, input.drawing)) return null;
  const candles = tradeCandles(trades, timeframe);
  if (!candles.length) return null;
  const newest = trades.reduce((most, trade) => Math.max(most, priced(trade) ? Date.parse(trade.at) : 0), 0);
  return { status: 'ready', timeframe, candles, pool: null, observedAt: Math.min(input.now, newest || input.now), stale: input.stale, source: null };
}
