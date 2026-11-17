import type { LaunchPoolView } from '../../../lib/api/v1/contract.ts';
import { DLMM_PRO_LAUNCH_TERMS, WRAPPED_SOL_MINT } from '../../../lib/core/launch/dlmm-pro.ts';
import type { CitySnapshot, Tower, TowerFigure } from '../market/types.ts';
import { phaseAt, type PoolListed } from './pool.ts';

/**
 * Launches into a pool as towers of the city. A launch stands in the Launch Docks from the moment it is on
 * chain whole — counting down to its opening, then trading. One still being built is its creator's alone to see: a
 * tower is a coin people can trade, and a coin without its pool is not one yet.
 *
 * Every figure is the engine's read. The market cap is the pool's own price times the supply, in dollars only where
 * the pair's dollar price is known — USDC's, or SOL's as the city's own snapshot has it; otherwise it is named unread
 * and the tower stands at its least, never at a guess.
 */

/** How many launches into a pool stand in the docks at most. */
export const POOL_DOCKS_MAX = 6;

/** SOL's dollar price as the city's own read has it; null when the snapshot does not carry SOL. */
export function solUsdOf(snapshot: Pick<CitySnapshot, 'towers'>): number | null {
  const sol = snapshot.towers.find((tower) => tower.id === WRAPPED_SOL_MINT);
  return sol && sol.price > 0 ? sol.price : null;
}

export function poolTowerOf(launch: PoolListed, view: LaunchPoolView | undefined, solUsd: number | null): Tower {
  const unread: TowerFigure[] = ['change5m', 'change1h', 'change24h', 'volume24h', 'traders1h', 'organic', 'liquidity', 'holders'];
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const pairUsd = launch.pair === 'USDC' ? 1 : solUsd;
  /* The pair's coin per coin: the pool's price now, its first price, or — before any read — the terms' own first price. */
  const inPair = view?.price.now ?? view?.price.start ?? terms.startCap[launch.pair] / terms.coin.supply;
  const price = pairUsd === null ? 0 : inPair * pairUsd;
  if (pairUsd === null) unread.push('price', 'mcap');
  return {
    id: launch.mint,
    symbol: launch.symbol,
    name: launch.name,
    icon: null,
    district: 'docks',
    price,
    mcap: price * terms.coin.supply,
    liquidity: 0,
    holders: 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24h: 0,
    traders1h: 0,
    organic: 0,
    verified: false,
    launchedAt: launch.createdAt,
    unread,
  };
}

/** The launches into a pool the city stands as towers: those on chain whole, and — still being built — the viewer's own. */
export function shownPools(launches: readonly PoolListed[], viewer: string | null, now: number): readonly PoolListed[] {
  return launches.filter((launch) => phaseAt(launch, now) !== 'BUILDING' || (viewer !== null && launch.creator === viewer)).slice(0, POOL_DOCKS_MAX);
}

/** The city with its launches into a pool beside everything else it stands; the same snapshot when there is none. */
export function withPoolLaunches(base: CitySnapshot, launches: readonly PoolListed[], views: Readonly<Record<string, LaunchPoolView>>, viewer: string | null, now: number): CitySnapshot {
  const shown = shownPools(launches, viewer, now);
  if (!shown.length) return base;
  const ids = new Set(shown.map((launch) => launch.mint));
  const solUsd = solUsdOf(base);
  return { ...base, towers: [...base.towers.filter((tower) => !ids.has(tower.id)), ...shown.map((launch) => poolTowerOf(launch, views[launch.mint], solUsd))] };
}

/** What of the launches into a pool changes the city's look: which stand, and how tall — a read that changes nothing leaves the skyline alone. */
export function poolTowersKey(launches: readonly PoolListed[], views: Readonly<Record<string, LaunchPoolView>>, viewer: string | null, now: number): string {
  return shownPools(launches, viewer, now)
    .map((launch) => `${launch.mint}:${Math.round(Math.log10(Math.max((views[launch.mint]?.price.now ?? 0) * 1e12, 1)) * 4)}`)
    .join('|');
}
