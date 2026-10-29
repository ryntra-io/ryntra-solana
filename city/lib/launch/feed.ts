import type { LaunchCrewsResponse, LaunchMarketResponse, LaunchMarketRow, LaunchSurvivalResponse } from '../../../lib/api/v1/contract.ts';
import { eventsBetween, snapshotFrom, withMarket } from '../../../lib/mission-control/scene.ts';
import type { SceneMission, SceneSnapshot } from '../../../lib/mission-control/types.ts';
import type { EventDraft } from '../city/events.ts';
import { shownText } from '../../../lib/world/text-safety/clean.ts';
import type { LaunchEngine, Network } from './engine.ts';
import { cityMoment } from './moments.ts';
import { sameOriginImage, shownLaunches, type LaunchTower } from './towers.ts';

/**
 * The launches of Ryntra as the city reads them — the same public reads and the same scene logic as Mission Control's
 * live scene: the markets list, the checks of days 7, 30 and 90 and the crews in flight, and the market of the few
 * towers someone looks at. No wallet. A read that fails keeps the last towers, and an event is only what changed
 * between two reads.
 */

export const READ_MS = 30_000;
export const SURVIVAL_MS = 5 * 60_000;
/** Markets read whole each time: the towers someone looks at first, then the docks in turn. */
export const MARKET_READS_MAX = 3;

export type FeedState = 'live' | 'stale' | 'off';

export type LaunchFeedOptions = Readonly<{
  engine: LaunchEngine;
  /** The towers whose markets are read every time: the creator's new one, the one whose card is open. */
  focus?: () => readonly string[];
  onTowers: (towers: readonly LaunchTower[], network: Network | null) => void;
  onMoments: (moments: readonly EventDraft[]) => void;
  onState?: (state: FeedState) => void;
  now?: () => number;
  readMs?: number;
  /** Tests run the reads by hand. */
  manual?: boolean;
}>;

export type LaunchFeed = Readonly<{ stop: () => void; readNow: () => Promise<void> }>;

export function startLaunchFeed(options: LaunchFeedOptions): LaunchFeed {
  const { engine } = options;
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let last: SceneSnapshot | null = null;
  let survival: LaunchSurvivalResponse | null = null;
  let crews: LaunchCrewsResponse | null = null;
  let survivalAt = -Infinity;
  let graduation: ReadonlyMap<string, number> | null = null;
  const markets = new Map<string, LaunchMarketResponse>();
  let turn = 0;

  const readOnce = async () => {
    if (!graduation) {
      const presets = await engine.presets();
      if (presets.ok) graduation = new Map(presets.data.presets.map((preset) => [preset.id, preset.graduationMarketCapUsd]));
    }
    const list = await engine.markets();
    if (stopped) return;
    if (!list.ok || !Array.isArray(list.data.markets)) {
      options.onState?.(last ? 'stale' : 'off');
      return;
    }
    if (now() - survivalAt > SURVIVAL_MS) {
      const [readSurvival, readCrews] = await Promise.all([engine.survival(), engine.crews()]);
      if (readSurvival.ok) survival = readSurvival.data;
      if (readCrews.ok && Array.isArray(readCrews.data.crews)) crews = readCrews.data;
      survivalAt = now();
    }
    const rows = new Map(list.data.markets.map((row) => [row.token, row]));
    const network: Network = list.data.network;
    const base = snapshotFrom(list.data, survival, now(), undefined, crews);
    const read = (): SceneSnapshot => ({ ...base, missions: base.missions.map((mission) => (markets.has(mission.id) ? withMarket(mission, markets.get(mission.id)!) : mission)) });
    /* A launch whose ticker is held back (CITY-73) stands no tower: the city never shows a launch it cannot name. */
    const towersOf = (snapshot: SceneSnapshot) => snapshot.missions.map((mission) => launchTowerOf(mission, rows.get(mission.id), network, graduation)).filter((tower) => tower.symbol !== '');

    /* The markets read whole: the focus first, then one more of the towers the city shows, in turn. */
    const focus = (options.focus?.() ?? []).filter((token) => rows.has(token));
    const others = shownLaunches(towersOf(read())).filter((tower) => !focus.includes(tower.token));
    const next = others.length ? others[turn++ % others.length]!.token : null;
    const wanted = [...new Set([...focus, ...(next ? [next] : [])])].slice(0, MARKET_READS_MAX);
    const answers = await Promise.all(wanted.map((token) => engine.market(token)));
    if (stopped) return;
    answers.forEach((answer) => {
      if (answer.ok) markets.set(answer.data.token, answer.data);
    });

    const snapshot = read();
    const events = eventsBetween(last, snapshot, now());
    last = snapshot;
    const towers = towersOf(snapshot);
    options.onTowers(towers, network);
    const byToken = new Map(towers.map((tower) => [tower.token, tower]));
    const moments = events.map((event) => ('id' in event ? cityMoment(event, byToken.get(event.id)) : null)).filter((moment): moment is EventDraft => moment !== null);
    if (moments.length) options.onMoments(moments);
    options.onState?.(list.data.complete ? 'live' : 'stale');
  };

  /* One read at a time: a second ask while one runs waits for it. */
  const readNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= readOnce()
      .catch(() => options.onState?.(last ? 'stale' : 'off'))
      .finally(() => {
        running = null;
      });
    return running;
  };

  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const schedule = () => {
    if (stopped || options.manual) return;
    timer = setTimeout(async () => {
      if (!hidden()) await readNow();
      schedule();
    }, options.readMs ?? READ_MS);
  };
  const onVisible = () => {
    if (!hidden()) void readNow();
  };

  if (!options.manual) {
    void readNow().then(schedule);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  }
  return {
    readNow,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

/**
 * One market of the engine's list, with the scene's reading of it, as a tower of the city. The creator's name and
 * ticker are somebody else's text (CITY-73): a held ticker is empty and the caller leaves the tower out; a held name
 * gives way to the ticker.
 */
export function launchTowerOf(mission: SceneMission, row: LaunchMarketRow | undefined, network: Network, graduation: ReadonlyMap<string, number> | null): LaunchTower {
  const symbol = shownText(row?.symbol ?? mission.ticker.replace(/^\$/, ''), 'symbol') ?? '';
  return {
    token: mission.id,
    symbol,
    name: shownText(mission.name, 'name') ?? symbol,
    image: sameOriginImage(row?.image),
    launchedAt: mission.launchedAt,
    creator: row?.creator ?? null,
    preset: row?.preset ?? null,
    graduationUsd: row ? (graduation?.get(row.preset) ?? null) : null,
    progress: mission.altitude,
    migrated: mission.migrated,
    marketCapUsd: mission.marketCapUsd,
    liquidityUsd: mission.liquidityUsd,
    holders: mission.holders,
    holdersAtLeast: mission.holdersAtLeast,
    checks: mission.checks,
    phase: mission.phase,
    crew: Math.max(0, mission.crew.length - 1),
    ryntraTest: mission.ryntraTest,
    network,
    mine: false,
  };
}
