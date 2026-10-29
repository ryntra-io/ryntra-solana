/**
 * The live side of Mission Control in the browser: it reads Ryntra's public Launch API — no wallet — and hands the
 * scene a snapshot and the events between two reads. The markets list every 20 s, SOL-L3's checks and the crews in
 * flight (MC-2) every 5 min, and the trades of the few missions in flight that traded in the last day (and of the
 * Control Room's own mission) every read. Hidden tabs do not read. A failed read keeps the last snapshot and says so.
 * The launch windows' beats come from the published schedule each second (`windowEvents`), not from a read.
 */

import type { LaunchCrewsResponse, LaunchMarketResponse, LaunchMarketsResponse, LaunchSurvivalResponse } from "../api/v1/contract.ts";
import { eventsBetween, snapshotFrom, tradeEvents, windowEvents, withMarket } from "./scene.ts";
import type { SceneEvent, SceneSnapshot } from "./types.ts";

export const LIVE_READ_MS = 20_000;
export const SURVIVAL_READ_MS = 5 * 60_000;
/** The windows' clock: a beat a second, while the tab is seen. */
export const WINDOW_TICK_MS = 1_000;
/** Missions whose trades are read each time: the scene's busiest flights, never every market. */
export const TRADES_READ_MAX = 3;
/** The history the log opens with: the last day's trades, at most this many. */
export const HISTORY_MAX = 12;
const HISTORY_MS = 86_400_000;

export type LiveState = "reading" | "live" | "stale" | "unavailable";

export type LiveFeedOptions = Readonly<{
  /** Control Room: the mission whose trades are always read. */
  focus?: string;
  onSnapshot: (snapshot: SceneSnapshot) => void;
  onEvents: (events: readonly SceneEvent[]) => void;
  onState?: (state: LiveState) => void;
  /** For tests. */
  fetcher?: typeof fetch;
  now?: () => number;
}>;

async function readJson<T>(fetcher: typeof fetch, path: string): Promise<T | null> {
  try {
    const response = await fetcher(path, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The missions whose trades a read takes: the focus first, then flights that traded in the last day, highest first. */
export function tradeCandidates(markets: LaunchMarketsResponse, focus: string | undefined): string[] {
  const flying = markets.markets
    .filter((row) => row.traded24h && row.progress && !row.progress.migrated && row.token !== focus)
    .sort((a, b) => (b.progress?.bps ?? 0) - (a.progress?.bps ?? 0))
    .map((row) => row.token);
  return [...(focus ? [focus] : []), ...flying].slice(0, TRADES_READ_MAX + (focus ? 1 : 0));
}

export type LiveFeed = Readonly<{ stop: () => void; readNow: () => Promise<void> }>;

export function startLiveFeed(options: LiveFeedOptions): LiveFeed {
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: SceneSnapshot | null = null;
  let survival: LaunchSurvivalResponse | null = null;
  let crews: LaunchCrewsResponse | null = null;
  let survivalAt = 0;
  const seen = new Map<string, Set<string>>();
  let running: Promise<void> | null = null;

  /* One read at a time: a second ask while one runs waits for it. */
  const read = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= readOnce().finally(() => {
      running = null;
    });
    return running;
  };

  const readOnce = async () => {
    const markets = await readJson<LaunchMarketsResponse>(fetcher, "/api/v1/launch/markets");
    if (stopped) return;
    if (!markets || !Array.isArray(markets.markets)) {
      options.onState?.(last ? "stale" : "unavailable");
      return;
    }
    if (!survival || now() - survivalAt > SURVIVAL_READ_MS) {
      const [readSurvival, readCrews] = await Promise.all([
        readJson<LaunchSurvivalResponse>(fetcher, "/api/v1/launch/survival"),
        readJson<LaunchCrewsResponse>(fetcher, "/api/v1/launch/crews"),
      ]);
      survival = readSurvival ?? survival;
      crews = readCrews && Array.isArray(readCrews.crews) ? readCrews : crews;
      survivalAt = now();
    }
    const first = last === null;
    const candidates = tradeCandidates(markets, options.focus);
    const reads = await Promise.all(candidates.map((token) => readJson<LaunchMarketResponse>(fetcher, `/api/v1/launch/${token}/market`)));
    if (stopped) return;

    let snapshot = snapshotFrom(markets, survival, now(), options.focus, crews);
    const byToken = new Map(reads.filter((market): market is LaunchMarketResponse => market !== null && market.token !== undefined).map((market) => [market.token, market]));
    snapshot = { ...snapshot, missions: snapshot.missions.map((mission) => (byToken.has(mission.id) ? withMarket(mission, byToken.get(mission.id)!) : mission)) };

    const events: SceneEvent[] = [...eventsBetween(last, snapshot, now())];
    const history: SceneEvent[] = [];
    for (const market of byToken.values()) {
      const known = seen.get(market.token);
      if (!known) {
        const recent = market.trades.rows.filter((row) => now() - Date.parse(row.at) < HISTORY_MS);
        history.push(...tradeEvents({ ...market, trades: { ...market.trades, rows: recent } }, new Set(), true));
        seen.set(market.token, new Set(market.trades.rows.map((row) => row.signature)));
        continue;
      }
      events.push(...tradeEvents(market, known, false));
      for (const row of market.trades.rows) known.add(row.signature);
    }
    last = snapshot;
    options.onSnapshot(snapshot);
    const opening = history.sort((a, b) => Date.parse(("at" in a && a.at) || "") - Date.parse(("at" in b && b.at) || "")).slice(-HISTORY_MAX);
    const all = first ? [...opening, ...events.map((event) => ({ ...event, quiet: true }))] : events;
    if (all.length) options.onEvents(all);
    /* Stale is the markets' own read coming back short; SOL-L3's unread weeks show as unread checks, not as old numbers. */
    options.onState?.(markets.complete ? "live" : "stale");
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") await read();
      schedule();
    }, LIVE_READ_MS);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void read();
  };

  /* The windows' beats: the published schedule against the clock, said only while the tab is seen. */
  let beatAt = now();
  const beat = setInterval(() => {
    const at = now();
    if (stopped || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
      beatAt = at;
      return;
    }
    const beats = windowEvents(beatAt, at, last);
    beatAt = at;
    if (beats.length) options.onEvents(beats);
  }, WINDOW_TICK_MS);

  options.onState?.("reading");
  void read().then(schedule);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  return {
    readNow: read,
    stop: () => {
      stopped = true;
      clearInterval(beat);
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
