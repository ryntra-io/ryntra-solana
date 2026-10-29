import { dayChange, fundingPayer, markIndexGap, stateOf, symbolKey, type FuturesFunding, type FuturesMarket, type FuturesMarketState } from '../../../lib/phoenix/market-data.ts';
import type { PerpUnits } from '../../../lib/phoenix/orders-model.ts';
import type { Tower } from '../market/types.ts';

/**
 * Phoenix's markets as the Exchange lists them, and which towers have one. Every figure is the engine's read of
 * Phoenix (`/api/solana/futures/markets`, `/funding`) passed through the engine's own helpers: the day's change, the
 * market's state, who pays the funding. The city adds no figure of its own.
 */

/** A coin's symbol as Phoenix spells a market: no `$`, case-blind. */
export const towerSymbol = (tower: Pick<Tower, 'symbol'>): string => tower.symbol.replace(/^\$/, '').trim();

/**
 * The Phoenix market of a tower, when there is one: the same symbol, and only for a coin Jupiter verified — an
 * unverified pool that borrows a ticker never gets a perpetual's button. Null when Phoenix lists none.
 */
export function marketForTower(tower: Pick<Tower, 'symbol' | 'verified'>, markets: readonly FuturesMarket[]): FuturesMarket | null {
  if (!tower.verified) return null;
  const key = symbolKey(towerSymbol(tower));
  if (!key) return null;
  return markets.find((market) => symbolKey(market.symbol) === key) ?? null;
}

/** A market's whole and sane units, or null: without them no size or price can become lots and ticks. */
export function unitsOf(market: Pick<FuturesMarket, 'tickSize' | 'baseLotsDecimals'> | null | undefined): PerpUnits | null {
  if (!market || market.tickSize === null || market.baseLotsDecimals === null) return null;
  if (!Number.isSafeInteger(market.tickSize) || market.tickSize <= 0 || !Number.isInteger(market.baseLotsDecimals) || Math.abs(market.baseLotsDecimals) > 12) return null;
  return { tickSize: market.tickSize, baseLotsDecimals: market.baseLotsDecimals };
}

/** Whether Phoenix takes orders on the market now: listed as active and trading by its own state. */
export const tradable = (market: Pick<FuturesMarket, 'status' | 'state'>): boolean => market.status === 'active' && stateOf(market) === 'trading';

export const STATE_WORDS: Readonly<Record<FuturesMarketState, string>> = {
  trading: 'Trading',
  underlyingClosed: 'Its market is closed',
  internalPricing: 'After hours: Phoenix prices it',
  paused: 'Paused by Phoenix',
  unknown: 'Session not known',
};

/** The list in the picker: what trades now first, then the day's volume, largest first. */
export function marketRows(markets: readonly FuturesMarket[]): FuturesMarket[] {
  return [...markets].sort((a, b) => Number(tradable(b)) - Number(tradable(a)) || (b.dayVolumeUsd ?? -1) - (a.dayVolumeUsd ?? -1) || a.symbol.localeCompare(b.symbol));
}

/** The picker's search: the symbol, Phoenix's name and its aliases. */
export function marketMatchesText(market: Pick<FuturesMarket, 'symbol' | 'name' | 'aliases'>, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return [market.symbol, market.name ?? '', ...(market.aliases ?? [])].some((word) => word.toLowerCase().includes(needle));
}

export type MarketFacts = Readonly<{
  mark: number | null;
  index: number | null;
  /** The day's change of the mark, per cent. */
  changePercent: number | null;
  maxLeverage: number | null;
  state: FuturesMarketState;
  tradable: boolean;
  isolatedOnly: boolean;
  funding: Readonly<{ ratePercent: number; payer: 'long' | 'short' | null; periodSeconds: number | null }> | null;
}>;

/** The market strip's figures: Phoenix's prices, the day's move and the funding now, each through the engine. */
export function marketFacts(market: FuturesMarket, funding: FuturesFunding | null): MarketFacts {
  const change = dayChange(market);
  const ownFunding = funding && symbolKey(funding.symbol) === symbolKey(market.symbol) ? funding : null;
  return {
    mark: market.markPrice,
    index: market.oraclePrice,
    changePercent: change === null ? null : change * 100,
    maxLeverage: market.maxLeverage,
    state: stateOf(market),
    tradable: tradable(market),
    isolatedOnly: market.isolatedOnly,
    funding: ownFunding ? { ratePercent: ownFunding.ratePercent, payer: fundingPayer(ownFunding.ratePercent, markIndexGap(market)), periodSeconds: ownFunding.periodSeconds } : null,
  };
}

/** The leverages the ticket offers up to the market's highest: the usual steps and the highest itself. */
export function leverageSteps(max: number | null): number[] {
  if (max === null || !(max >= 1)) return [1];
  const top = Math.floor(max);
  return [...new Set([1, 2, 3, 5, 10, 20, 25, 50, 100].filter((step) => step < top).concat(top))];
}

/** The leverage a market opens with before the person picks one: two times, the careful start of the specification §9. */
export const CAREFUL_LEVERAGE = 2;

/** A picked leverage inside the market's range: a whole number from one to its highest. */
export function clampLeverage(value: number, max: number | null): number {
  const top = max !== null && max >= 1 ? Math.floor(max) : 1;
  if (!Number.isFinite(value)) return Math.min(top, CAREFUL_LEVERAGE);
  return Math.min(top, Math.max(1, Math.round(value)));
}
