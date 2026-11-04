import type { LaunchTower } from './towers.ts';

/**
 * «Launched on Ryntra» (CITY-185): every coin launched on Ryntra's launchpad, as one list a link can open
 * (`ryntra.io/launches`). The launches are the district's own feed — the engine's `GET /api/v1/launch/markets` and the
 * markets it reads behind it — with this browser's just-launched coin ahead of the engine's list; nothing here is read
 * twice and nothing is guessed: a figure the engine has not read is left off the card, never shown as a zero.
 *
 * Ryntra's own technical launches (`technicalValidation`) are never shown as people's projects: they stand apart, out of
 * the list, behind one quiet disclosure. Pure, so the tests read it.
 */

export type LaunchedCard = Readonly<{
  token: string;
  symbol: string;
  name: string;
  /** The engine's same-origin copy of the picture; null — the card draws the coin's icon. */
  image: string | null;
  marketCapUsd: number | null;
  /** The curve's way to the pool, 0…100; null when not read. Once in the pool it is not a curve any more. */
  curve: number | null;
  inPool: boolean;
  /** The holders as the engine counted them; null when not counted (an «at least none» says nothing). */
  holders: Readonly<{ count: number; atLeast: boolean }> | null;
  launchedAt: number;
  mine: boolean;
}>;

export type LaunchedList = Readonly<{ people: readonly LaunchedCard[]; tests: readonly LaunchedCard[] }>;

const at = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

export function cardOf(launch: LaunchTower): LaunchedCard {
  const holders = launch.holders === null || (launch.holdersAtLeast && launch.holders === 0) ? null : { count: launch.holders, atLeast: launch.holdersAtLeast };
  return {
    token: launch.token,
    symbol: launch.symbol,
    name: launch.name || launch.symbol,
    image: launch.hidden ? null : launch.image,
    marketCapUsd: launch.marketCapUsd,
    curve: launch.migrated || launch.progress === null ? null : Math.max(0, Math.min(100, launch.progress)),
    inPool: launch.migrated,
    holders,
    launchedAt: at(launch.launchedAt),
    mine: launch.mine,
  };
}

/**
 * The list: people's launches, this browser's own first, then the biggest market cap, then the newest; a launch whose
 * market cap is not read yet after the read ones. Ryntra's technical launches apart, newest first. A launch the city
 * cannot name (its ticker held, CITY-73) is not listed.
 */
export function launchedList(launches: readonly LaunchTower[]): LaunchedList {
  const named = launches.filter((launch) => launch.symbol !== '');
  const seen = new Set<string>();
  const unique = named.filter((launch) => (seen.has(launch.token) ? false : (seen.add(launch.token), true)));
  const people = unique
    .filter((launch) => !launch.ryntraTest)
    .map(cardOf)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1) || b.launchedAt - a.launchedAt);
  const tests = unique
    .filter((launch) => launch.ryntraTest)
    .map(cardOf)
    .sort((a, b) => b.launchedAt - a.launchedAt);
  return { people, tests };
}

/** The curve's way as a whole percent, never 100 before the pool and never 0 once anything was bought. */
export function curvePercent(curve: number): number {
  if (curve <= 0) return 0;
  if (curve >= 100) return 99;
  return Math.max(1, Math.min(99, Math.round(curve)));
}
