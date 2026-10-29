import type { PositionsAnswer, PositionView } from '../../../../lib/liquidity/catalog/positions.ts';
import { SOLANA_MAINNET_USDC_MINT } from '../../../../lib/solana/send-kinds.ts';
import { VENUE_OF, VENUE_NAME } from './pools.ts';

/**
 * The person's pool positions as the Harbor shows them, read from the chain by the engine: the fees earned and not yet
 * taken, whether the price is inside the range, what the position holds, and the tower it lights in the city.
 */

export type HarborPosition = Readonly<{
  address: string;
  pool: string;
  venue: string;
  venueName: string;
  pair: string;
  inRange: boolean;
  /** Where the position sits against the price when out of it: above it holds only the first coin, below only the second. */
  side: 'above' | 'below' | null;
  valueUsd: number | null;
  earnedUsd: number | null;
  /** The unclaimed fees in each coin: "0.0021 SOL + 0.31 USDC"; null when nothing is earned yet. */
  earned: string | null;
  /** Fees go to an address other than this wallet (a launch can set that): claiming is not this wallet's to do. */
  feesElsewhere: boolean;
  /** Part of it cannot be withdrawn now: leaving takes only what is free. */
  locked: boolean;
  symbols: Readonly<{ x: string; y: string }>;
  /** The coin whose tower this position lights. */
  towerMint: string;
}>;

/** USD coins stand for no tower of their own; a position in a pool against one lights the other coin. */
const DOLLARS = new Set([SOLANA_MAINNET_USDC_MINT, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

export function towerMintOf(view: Readonly<{ x: Readonly<{ mint: string }>; y: Readonly<{ mint: string }> }>): string {
  return DOLLARS.has(view.x.mint) && !DOLLARS.has(view.y.mint) ? view.y.mint : view.x.mint;
}

function amount(value: number): string {
  if (!(value > 0)) return '0';
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (value >= 1) return Number(value.toFixed(2)).toString();
  return Number(value.toPrecision(2)).toString();
}

export function harborPosition(view: PositionView): HarborPosition {
  const parts = [view.x.unclaimed > 0 ? `${amount(view.x.unclaimed)} ${view.x.symbol}` : null, view.y.unclaimed > 0 ? `${amount(view.y.unclaimed)} ${view.y.symbol}` : null].filter(Boolean);
  return {
    address: view.address,
    pool: view.pool,
    venue: VENUE_OF[view.kind],
    venueName: VENUE_NAME[view.kind],
    pair: view.name,
    inRange: view.rangeState === 'in_range',
    side: view.rangeState === 'in_range' ? null : view.rangeState,
    valueUsd: view.valueUsd,
    earnedUsd: view.unclaimedUsd,
    earned: parts.length ? parts.join(' + ') : null,
    feesElsewhere: view.feesElsewhere,
    locked: view.lockedBps > 0,
    symbols: { x: view.x.symbol, y: view.y.symbol },
    towerMint: towerMintOf(view),
  };
}

/** A positions answer for this wallet only; another wallet's answer is no answer. */
export function harborPositions(answer: PositionsAnswer | null, owner: string | null): HarborPosition[] | null {
  if (!answer || !owner || answer.owner !== owner || !Array.isArray(answer.positions)) return null;
  return answer.positions.map(harborPosition);
}

/** The towers a wallet's positions light, by mint. */
export function harborMints(positions: readonly HarborPosition[] | null): ReadonlySet<string> {
  return new Set((positions ?? []).map((position) => position.towerMint));
}

/** The status line of a position in words: in range and earning, or out and why. */
export function rangeLine(position: HarborPosition): string {
  if (position.inRange) return 'In range · earning';
  return position.side === 'above' ? 'Out of range · price fell below it' : 'Out of range · price rose above it';
}
