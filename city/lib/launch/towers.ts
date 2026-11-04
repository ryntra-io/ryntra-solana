import type { CheckState, MissionPhase } from '../../../lib/mission-control/types.ts';
import type { CitySnapshot, Tower, TowerFigure } from '../market/types.ts';
import type { Network } from './engine.ts';
import { crownRings, silhouetteOf, type TowerFlow } from './silhouette.ts';

/**
 * Coins launched on Ryntra as towers of the city. On the curve a launch stands in the Launch Docks; once its curve fills
 * and it moves to its Meteora pool (at $75K on Classic and Protected) it stands in the skyline — when its graduation
 * passed the city's rule (L7, `silhouette.ts`): enough independent buyers and enough time on the curve; below it, it
 * stays in the Docks. Every figure is the engine's read — a figure not read stays null here and zero on the tower,
 * never a guess — and the tower is never marked verified: only Jupiter verifies a coin.
 */
export type LaunchTower = Readonly<{
  token: string;
  symbol: string;
  name: string;
  /** Same-origin address of the engine's copy of the picture, or the creator's own picture right after the launch. */
  image: string | null;
  launchedAt: string | null;
  creator: string | null;
  preset: string | null;
  /** The market cap its curve moves to the pool at, from the engine's preset; null when not known. */
  graduationUsd: number | null;
  /** The curve's way to the pool, 0…100; 100 once in the pool; null when not read. */
  progress: number | null;
  migrated: boolean;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  holdersAtLeast: boolean;
  /** Days 7, 30 and 90 as the engine's survival read has them. */
  checks: readonly [CheckState, CheckState, CheckState];
  phase: MissionPhase;
  /** People in its crew besides the creator, by the fee vault's rows. */
  crew: number;
  /** Launched by one of Ryntra's own wallets: a technical check, never demand. */
  ryntraTest: boolean;
  network: Network;
  /** Launched from this browser just now: kept until the engine's list carries it. */
  mine: boolean;
  /** Ryntra took its picture, description and links down (MC-1): the tower stands without them; the chain keeps the coin. */
  hidden: boolean;
  /** The flow's facts the silhouette and the crown's rings rest on (L3, L7), as the feed last read them; null — not read. */
  flow: TowerFlow | null;
  /** Its flow's first read is on its way and the city has not shown it yet: a graduated tower waits for it (`silhouetteOf`). */
  awaitingFlow: boolean;
  /** The creator's first purchase is under the creator's lock, as the engine's list says (CITY-169); absent — not read. */
  creatorLocked?: boolean;
  /** The creator sold some of it, as the engine's list says; null — their trades were not read whole; absent — not read. */
  creatorSold?: boolean | null;
}>;

/** How many launches stand in the docks and in the skyline at most, so the city's own coins keep their places. */
export const DOCKS_MAX = 10;
export const SKYLINE_MAX = 6;
/** A launch of this browser that the engine's list does not carry after this long is let go. */
export const MINE_KEEP_MS = 10 * 60_000;

/** The same-origin path of the engine's picture route; anything else is not drawn. */
export function sameOriginImage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const path = new URL(url, 'https://ryntra.io').pathname;
    return /^\/api\/launch\/image\/[0-9a-f]{64}$/.test(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * A launch as a tower of the city: the figures the engine read, zero for the ones it did not — and those named in
 * `unread`, so a screen writes «Not measured» for them, never the zero (CITY-73).
 */
export function towerOf(launch: LaunchTower): Tower {
  const unread: TowerFigure[] = ['price', 'change5m', 'change1h', 'change24h', 'volume24h', 'traders1h', 'organic'];
  if (launch.marketCapUsd === null) unread.push('mcap');
  if (launch.liquidityUsd === null) unread.push('liquidity');
  if (launch.holders === null) unread.push('holders');
  return {
    id: launch.token,
    symbol: launch.symbol,
    name: launch.name,
    icon: null,
    district: silhouetteOf(launch).stand === 'skyline' ? 'strip' : 'docks',
    price: 0,
    mcap: launch.marketCapUsd ?? 0,
    liquidity: launch.liquidityUsd ?? 0,
    holders: launch.holders ?? 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24h: 0,
    traders1h: 0,
    organic: 0,
    verified: false,
    launchedAt: launch.launchedAt,
    unread,
  };
}

/** Whether its day-90 ring burns: a landmark of the skyline. */
const landmark = (launch: LaunchTower) => crownRings(launch.checks, launch.flow?.survival ?? null)[2] === 'alive';

/**
 * The launches the city shows: this browser's first, then the ones in flight, newest first; a lost signal fades. The
 * skyline takes only the towers whose graduation passed the city's rule, the day-90 landmarks first; a graduation below
 * it keeps its place in the Docks, and one whose first read is on its way waits for it.
 */
export function shownLaunches(launches: readonly LaunchTower[]): readonly LaunchTower[] {
  const newest = (a: LaunchTower, b: LaunchTower) => Number(b.mine) - Number(a.mine) || (Date.parse(b.launchedAt ?? '') || 0) - (Date.parse(a.launchedAt ?? '') || 0);
  const kept = launches.filter((launch) => launch.mine || launch.phase !== 'lost');
  const stands = new Map(kept.map((launch) => [launch.token, silhouetteOf(launch).stand]));
  const docks = kept.filter((launch) => stands.get(launch.token) === 'docks').sort(newest).slice(0, DOCKS_MAX);
  const skyline = kept
    .filter((launch) => stands.get(launch.token) === 'skyline')
    .sort((a, b) => Number(landmark(b)) - Number(landmark(a)) || newest(a, b))
    .slice(0, SKYLINE_MAX);
  return [...docks, ...skyline];
}

/**
 * The city with its launches: Jupiter's own record of a launched mint gives way to the launch's (the engine knows what it
 * is), and the read's time and source stay the city's, so the live chip and the day's run read the same as before.
 */
export function withLaunches(base: CitySnapshot, launches: readonly LaunchTower[]): CitySnapshot {
  const shown = shownLaunches(launches);
  if (!shown.length) return base;
  const ids = new Set(shown.map((launch) => launch.token));
  return { ...base, towers: [...base.towers.filter((tower) => !ids.has(tower.id)), ...shown.map(towerOf)] };
}

/**
 * What of the launches changes the city's look: which stand where, and how tall. A read that changes nothing here leaves
 * the skyline alone — laying the city out again costs frames.
 */
export function launchesKey(launches: readonly LaunchTower[]): string {
  return shownLaunches(launches)
    .map((launch) => `${launch.token}:${silhouetteOf(launch).stand === 'skyline' ? 's' : 'd'}:${Math.round(Math.log10(Math.max(launch.marketCapUsd ?? 1, 1)) * 4)}:${Math.round(Math.log10(Math.max(launch.liquidityUsd ?? 1, 1)) * 4)}`)
    .join('|');
}
