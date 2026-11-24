import type { ChooseRow } from '../../earn/choose.ts';
import type { PositionRow } from '../../earn/rows.ts';
import type { Ticket } from '../../earn/ticket.ts';

/**
 * Liquidity on the coin's own screen, as Meteora's DLX lays it: the coin's pools under its chart, the person's
 * own positions in them, and «Add» opening Earn's own ticket on the spot. Nothing here is a figure or a path of its own:
 * the rows are Earn's (`terminal/earn/choose.ts`, `rows.ts`), the tickets are Earn's (`terminal/earn/ticket.ts`), and this
 * file only says which of them belong to one coin and which ticket a row opens.
 *
 * Pure: the screen and the tests read it alike.
 */

/** How many of the coin's pools the tab lists: the deepest, and every pool that takes a deposit here besides. */
export const COIN_POOLS_SHOWN = 8;

/** A row holds the coin on either side. */
const holds = (coins: readonly Readonly<{ mint: string }>[], mint: string) => coins.some((coin) => coin.mint === mint);

/** Whether a row takes a deposit from this screen: the city's own pool, or a DLMM Pro pool it opens. */
export const adds = (row: Pick<ChooseRow, 'act'>): boolean => row.act === 'add' || row.act === 'pro';

const deeper = (a: ChooseRow, b: ChooseRow) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1);

/**
 * The coin's pools — DLMM, DLMM Pro and DAMM v2 — from Earn's own rows: the deepest first, at most `COIN_POOLS_SHOWN` of
 * them, and every pool that takes a deposit here kept in the list even when shallower. One row per pool.
 */
export function coinPools(rows: readonly ChooseRow[], mint: string, shown: number = COIN_POOLS_SHOWN): ChooseRow[] {
  const seen = new Set<string>();
  const mine = rows.filter((row) => {
    if (!holds(row.coins, mint) || seen.has(row.address)) return false;
    seen.add(row.address);
    return true;
  });
  const sorted = [...mine].sort(deeper);
  const head = sorted.slice(0, shown);
  const kept = new Set(head.map((row) => row.address));
  return [...head, ...sorted.filter((row) => !kept.has(row.address) && adds(row))];
}

/** The ticket a pool's row opens: Earn's add to the city's pool or to DLMM Pro, else the pool shown to compare. */
export function rowTicket(row: Pick<ChooseRow, 'act' | 'address'>): Ticket {
  return row.act === 'add' ? { kind: 'pool', address: row.address } : row.act === 'pro' ? { kind: 'pro', address: row.address } : { kind: 'view', address: row.address };
}

/**
 * The pool «Earn on it» opens after a buy: of the pools that take a deposit here, the one that paid the most in a day
 * (then the deepest); with none, the deepest pool of the coin, shown to compare. Null — the coin has no pool.
 */
export function bestPool(rows: readonly ChooseRow[]): ChooseRow | null {
  const adding = rows.filter(adds).sort((a, b) => (b.fees24hUsd ?? -1) - (a.fees24hUsd ?? -1) || deeper(a, b));
  return adding[0] ?? [...rows].sort(deeper)[0] ?? null;
}

/** The person's pool positions that hold the coin: the city's pools and DLMM Pro; staking and lending are not pools. */
export function coinPositions(rows: readonly PositionRow[], mint: string): PositionRow[] {
  return rows.filter((row) => (row.kind === 'pool' || row.kind === 'pro') && holds(row.coins, mint));
}

/**
 * What «Take» on a position opens — the same ticket Earn's «My positions» opens: a pool position takes its fees where
 * the city lets this wallet out (its tabs hold «Exit» too), a DLMM Pro position collects, or closes when nothing is left
 * in it. Null where nothing is offered for it here.
 */
export function positionTicket(row: PositionRow, figures: Readonly<{ exitOpen: boolean; proBoats: readonly Readonly<{ nftMint: string; empty: boolean }>[] }>): Ticket | null {
  if (row.kind === 'pool') return figures.exitOpen ? { kind: 'position', address: row.ref, act: 'claim' } : null;
  if (row.kind === 'pro') {
    const boat = figures.proBoats.find((entry) => entry.nftMint === row.ref);
    return boat ? { kind: 'proPosition', nftMint: row.ref, act: boat.empty ? 'close' : 'collect' } : null;
  }
  return null;
}

/** Whether the catalogue names a pool of the coin at all: the quiet «Earn on it» after a buy stands only then. */
export function hasPool(pools: readonly Readonly<{ x: Readonly<{ mint: string }>; y: Readonly<{ mint: string }> }>[], mint: string): boolean {
  return pools.some((pool) => pool.x.mint === mint || pool.y.mint === mint);
}
