import type { LaunchCrewsResponse, LaunchMarketResponse, LaunchMarketRow, LaunchSurvivalResponse } from '../../../lib/api/v1/contract.ts';
import { eventsBetween, snapshotFrom, withMarket } from '../../../lib/mission-control/scene.ts';
import type { SceneEvent, SceneMission, SceneSnapshot } from '../../../lib/mission-control/types.ts';
import type { EventDraft } from '../city/events.ts';
import { shownText } from '../../../lib/world/text-safety/clean.ts';
import type { LaunchEngine, Network } from './engine.ts';
import { cityMoment, skylineMoment } from './moments.ts';
import { crownRings, FLOW_SETTLED_MS, flowBehind, flowFreshMs, mergeFlow, needsFlow, silhouetteOf, towerFlowOf, type TowerFlow } from './silhouette.ts';
import { sameOriginImage, shownLaunches, type LaunchTower } from './towers.ts';

/**
 * The launches of Ryntra as the city reads them — the same public reads and the same scene logic as Mission Control's
 * live scene: the markets list, the checks of days 7, 30 and 90 and the crews in flight, and the market of the few
 * towers someone looks at. No wallet. A read that fails keeps the last towers, and an event is only what changed
 * between two reads.
 *
 * L7 (CITY-144): the flow (`GET /api/v1/launch/{mint}/flow`) of each tower that graduated or passed a check and can
 * stand in the city — the towers someone looks at, the newest ones, the day-90 candidates and the ones shown — read in
 * turn, a few per read, says where the tower stands and which rings burn on its crown (`silhouette.ts`). A graduated tower the city has not drawn yet waits for its first flow rather than
 * standing in the Docks and jumping to the skyline a read later. The move into the skyline is the city's moment only
 * for a graduation the city saw happen, once; a passed check or a day-90 landmark plays only once its ring burns.
 */

export const READ_MS = 30_000;
export const SURVIVAL_MS = 5 * 60_000;
/** Markets read whole each time: the towers someone looks at first, then the docks in turn. */
export const MARKET_READS_MAX = 3;
/** A flow the engine did not give, or one behind the tower's checks, is asked again after this long. */
export const FLOW_RETRY_MS = 60_000;
/** Flows asked in one read at most. How long a kept flow stays fresh: `flowFreshMs`. */
export const FLOW_READS_MAX = 6;
/** The newest towers needing a flow that get one, beside the focus, the day-90 candidates and the towers shown. */
export const FLOW_TOWERS_MAX = 24;
/** How long a read waits for the first flows of the towers it holds back; a later answer is shown when it comes. */
export const FLOW_WAIT_MS = 6_000;
/** A held tower waits this long at most from its flow's first ask — a cold read of the chain takes a while — then stands in the Docks. */
export const HOLD_MS = 45_000;
/** A passed check waits this long at most for its ring to burn — a flow still tracing is read again within it. */
export const RING_WAIT_MS = 15 * 60_000;

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
  /** How long a read waits for its flows (`FLOW_WAIT_MS`); tests shorten it. */
  flowWaitMs?: number;
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
  /* The flows (L7): each tower's last answer, the asks in flight, each tower's first ask and whether the city drew it. */
  const flows = new Map<string, Readonly<{ at: number; ok: boolean; flow: TowerFlow | null }>>();
  const asking = new Set<string>();
  const firstAsked = new Map<string, number>();
  /** How many reads in a row found a tower's flow behind its checks: each waits twice as long, up to half an hour. */
  const behindReads = new Map<string, number>();
  const drawn = new Set<string>();
  /** Graduations the city saw happen between two reads, and the ones whose move into the skyline already played. */
  const graduatedHere = new Set<string>();
  const intoSkyline = new Set<string>();
  /** Passed checks waiting for their ring: a token's day and when the check was seen. */
  const ringWaits = new Map<string, Readonly<{ event: SceneEvent; at: number }>>();
  let current: Readonly<{ rows: ReadonlyMap<string, LaunchMarketRow>; network: Network }> | null = null;
  let inRead = false;

  /** The towers someone looks at now. */
  const focusNow = (): ReadonlySet<string> => new Set(options.focus?.() ?? []);

  /**
   * The towers whose flows are read: the towers someone looks at (a quiet one too), and of the others that graduated or
   * passed a check, the newest, the day-90 candidates and the ones the city shows. An older tower none of these is can
   * displace no tower shown: it costs no read.
   */
  const flowTowers = (towers: readonly LaunchTower[], focus: ReadonlySet<string>): ReadonlySet<string> => {
    const needing = towers.filter((tower) => needsFlow(tower) && (tower.phase !== 'lost' || focus.has(tower.token)));
    const newest = [...needing].sort((a, b) => (Date.parse(b.launchedAt ?? '') || 0) - (Date.parse(a.launchedAt ?? '') || 0)).slice(0, FLOW_TOWERS_MAX);
    const shown = new Set(shownLaunches(towers).map((tower) => tower.token));
    return new Set(needing.filter((tower) => focus.has(tower.token) || newest.includes(tower) || (tower.migrated && tower.checks[2] === 'alive') || shown.has(tower.token)).map((tower) => tower.token));
  };

  /** A graduated tower the city has not drawn, whose first flow is asked and not in yet: held back while it is. */
  const held = (tower: LaunchTower): boolean => {
    if (!tower.migrated || flows.has(tower.token) || drawn.has(tower.token)) return false;
    const asked = firstAsked.get(tower.token);
    return asked === undefined || now() - asked < HOLD_MS;
  };

  /* A launch whose ticker is held back (CITY-73) stands no tower: the city never shows a launch it cannot name. Only a
     tower whose flow will be asked is held back for it. */
  const towersOf = (snapshot: SceneSnapshot): LaunchTower[] => {
    if (!current) return [];
    const { rows, network } = current;
    const towers = snapshot.missions
      .map((mission) => launchTowerOf(mission, rows.get(mission.id), network, graduation))
      .filter((tower) => tower.symbol !== '')
      .map((tower) => ({ ...tower, flow: flows.get(tower.token)?.flow ?? null }));
    const read = flowTowers(towers, focusNow());
    return towers.map((tower) => ({ ...tower, awaitingFlow: read.has(tower.token) && held(tower) }));
  };

  /**
   * The flows due among the towers read (`flowTowers`), the most needed first: the towers someone looks at, a
   * graduation never read, one read before its graduation or a check, a passed check never read — then every kept one
   * past its freshness, the longest unread first; a day-90 candidate ahead within each, then the newest. A read asks a few.
   */
  const dueFlows = (towers: readonly LaunchTower[], focus: ReadonlySet<string>): string[] => {
    const t = now();
    const read = flowTowers(towers, focus);
    return towers
      .filter((tower) => read.has(tower.token) && !asking.has(tower.token))
      .map((tower) => {
        const kept = flows.get(tower.token);
        const age = kept ? t - kept.at : Infinity;
        let rank: number;
        const behind = kept?.flow ? flowBehind(tower, kept.flow) : false;
        if (!kept) rank = tower.migrated ? 1 : 3;
        else if (behind) rank = age >= Math.min(FLOW_SETTLED_MS, FLOW_RETRY_MS * 2 ** (behindReads.get(tower.token) ?? 0)) ? 2 : -1;
        else if (!kept.ok) rank = age >= FLOW_RETRY_MS ? 4 : -1;
        else rank = kept.flow && age >= flowFreshMs(tower, kept.flow) ? 4 : -1;
        if (rank >= 0 && focus.has(tower.token)) rank = 0;
        if (rank > 0 && tower.checks[2] === 'alive') rank -= 0.5;
        return { token: tower.token, rank, behind, at: kept?.at ?? 0, launched: Date.parse(tower.launchedAt ?? '') || 0 };
      })
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.at - b.at || b.launched - a.launched)
      .slice(0, FLOW_READS_MAX)
      .map((entry) => {
        if (entry.behind) behindReads.set(entry.token, (behindReads.get(entry.token) ?? 0) + 1);
        else behindReads.delete(entry.token);
        return entry.token;
      });
  };

  /** The due flows asked at once; each answer kept as it comes, and shown at once when it comes after the read was shown. */
  const readFlows = (tokens: readonly string[]): Promise<void> =>
    Promise.all(
      tokens.map(async (token) => {
        asking.add(token);
        if (!firstAsked.has(token)) firstAsked.set(token, now());
        const answer = await Promise.resolve()
          .then(() => engine.flow(token))
          .catch(() => ({ ok: false as const, code: 'UNAVAILABLE', message: '' }));
        asking.delete(token);
        if (stopped) return;
        /* A read that fails keeps the flow already kept: what the chain said stays said. A floor never counts down. */
        const kept = flows.get(token)?.flow ?? null;
        flows.set(token, { at: now(), ok: answer.ok, flow: answer.ok ? mergeFlow(kept, towerFlowOf(answer.data)) : kept });
        if (!inRead && last) show(last, []);
      }),
    ).then(
      () => undefined,
      () => undefined,
    );

  /** What the feed keeps of towers the engine's list no longer carries is let go with them. */
  const prune = (rows: ReadonlyMap<string, LaunchMarketRow>) => {
    for (const keyed of [flows, firstAsked, behindReads]) for (const token of keyed.keys()) if (!rows.has(token)) keyed.delete(token);
    for (const [key, wait] of ringWaits) if (!('id' in wait.event) || !rows.has(wait.event.id)) ringWaits.delete(key);
    for (const kept of [drawn, graduatedHere, intoSkyline]) for (const token of kept) if (!rows.has(token)) kept.delete(token);
  };

  /** The day of a check or a landmark event, as the index of its ring. */
  const ringIndexOf = (event: SceneEvent): number | null => (event.type === 'star' ? 2 : event.type === 'check' ? [7, 30, 90].indexOf(event.day) : null);

  /**
   * The city's towers and moments for a snapshot: the scene's events — a passed check or a landmark only once its ring
   * burns — and the move into the skyline for a graduation the city saw, once its flow proves the rule.
   */
  const show = (snapshot: SceneSnapshot, events: readonly SceneEvent[]) => {
    if (!current) return;
    const towers = towersOf(snapshot);
    for (const tower of towers) if (!tower.awaitingFlow) drawn.add(tower.token);
    options.onTowers(towers, current.network);
    const byToken = new Map(towers.map((tower) => [tower.token, tower]));
    const ringOn = (token: string, index: number) => {
      const tower = byToken.get(token);
      return tower !== undefined && crownRings(tower.checks, tower.flow?.survival ?? null)[index] === 'alive';
    };
    const moments: EventDraft[] = [];
    const play = (event: SceneEvent) => {
      if (!('id' in event)) return;
      const moment = cityMoment(event, byToken.get(event.id));
      if (moment) moments.push(moment);
    };
    for (const raw of events) {
      /* A day-90 ring on a tower the Docks keep is its day-90 check, not a landmark of the skyline. */
      const tower = 'id' in raw ? byToken.get(raw.id) : undefined;
      const event: SceneEvent = raw.type === 'star' && (!tower || silhouetteOf(tower).stand !== 'skyline') ? { type: 'check', id: raw.id, day: 90, at: null, signature: null } : raw;
      if (event.type === 'orbit') {
        graduatedHere.add(event.id);
        if (tower && silhouetteOf(tower).stand === 'skyline') intoSkyline.add(event.id);
      }
      const ring = ringIndexOf(event);
      if (ring !== null && 'id' in event && !ringOn(event.id, ring)) {
        if (ring >= 0 && !event.quiet) ringWaits.set(`${event.id}:${event.type}:${ring}`, { event, at: now() });
        continue;
      }
      play(event);
    }
    /* A passed check whose ring burns now, within its wait. */
    for (const [key, wait] of ringWaits) {
      const ring = ringIndexOf(wait.event);
      if (now() - wait.at > RING_WAIT_MS) ringWaits.delete(key);
      else if (ring !== null && ring >= 0 && 'id' in wait.event && ringOn(wait.event.id, ring)) {
        ringWaits.delete(key);
        play(wait.event);
      }
    }
    /* Into the skyline: a graduation seen here, once its flow proves the rule — once per tower. */
    for (const tower of towers) {
      if (!graduatedHere.has(tower.token) || intoSkyline.has(tower.token) || silhouetteOf(tower).stand !== 'skyline') continue;
      intoSkyline.add(tower.token);
      moments.push(skylineMoment(tower));
    }
    if (moments.length) options.onMoments(moments);
  };

  const readOnce = async () => {
    inRead = true;
    try {
      await readTurn();
    } finally {
      inRead = false;
    }
  };

  const readTurn = async () => {
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
    current = { rows, network: list.data.network };
    prune(rows);
    const base = snapshotFrom(list.data, survival, now(), undefined, crews);
    const read = (): SceneSnapshot => ({ ...base, missions: base.missions.map((mission) => (markets.has(mission.id) ? withMarket(mission, markets.get(mission.id)!) : mission)) });

    /* The markets read whole: the focus first, then one more of the towers the city shows, in turn. The flows due go out
       at the same time. */
    const before = towersOf(read());
    const focus = (options.focus?.() ?? []).filter((token) => rows.has(token));
    const asked = dueFlows(before, focusNow());
    const flowsRead = readFlows(asked);
    /* Worth a few seconds: a tower held back for its first flow, or a graduation whose facts are not in yet — so its
       moment names where it stands the first time. */
    const waitFor = before.some((tower) => asked.includes(tower.token) && tower.migrated && (tower.flow === null || !tower.flow.graduated));
    const others = shownLaunches(before).filter((tower) => !focus.includes(tower.token));
    const next = others.length ? others[turn++ % others.length]!.token : null;
    const wanted = [...new Set([...focus, ...(next ? [next] : [])])].slice(0, MARKET_READS_MAX);
    const answers = await Promise.all(wanted.map((token) => engine.market(token)));
    if (stopped) return;
    answers.forEach((answer) => {
      if (answer.ok) markets.set(answer.data.token, answer.data);
    });
    /* The flows of the held towers get a few seconds more; one that comes later is shown when it comes. */
    if (waitFor) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([flowsRead, new Promise<void>((resolve) => (timer = setTimeout(resolve, options.flowWaitMs ?? FLOW_WAIT_MS)))]).finally(() => clearTimeout(timer));
    }
    if (stopped) return;

    const snapshot = read();
    const events = eventsBetween(last, snapshot, now());
    last = snapshot;
    show(snapshot, events);
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
    image: row?.hidden ? null : sameOriginImage(row?.image),
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
    hidden: row?.hidden === true,
    flow: null,
    awaitingFlow: false,
    ...(row ? { creatorLocked: row.creatorLock !== null, creatorSold: row.creatorSold } : {}),
  };
}
