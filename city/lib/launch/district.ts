import { create } from 'zustand';
import type { LaunchPresetView } from '../../../lib/api/v1/contract.ts';
import type { EventDraft } from '../city/events.ts';
import { useCity } from '../city/store.ts';
import type { CitySnapshot } from '../market/types.ts';
import { useRun } from '../run/store.ts';
import { httpEngine, type LaunchEngine, type Network } from './engine.ts';
import { startLaunchFeed } from './feed.ts';
import type { Liftoff, Phase } from './flow.ts';
import { cityLaunchOpen, cityPreset } from './gate.ts';
import { launchesKey, MINE_KEEP_MS, shownLaunches, withLaunches, type LaunchTower } from './towers.ts';
import { httpTradeEngine, type LaunchTradeEngine } from './trade.ts';
import type { CityWallet, Connection } from './wallet.ts';

/**
 * The Launch Docks as a district of the city: whether launching is open here, the sheet with its three fields, the
 * launches standing in the city, and their moments. It reads the engine once for its presets and then keeps the
 * launches' feed running; the towers join the city's own read, and the moments wait their turn between the city's own.
 */

export type Draft = Readonly<{ name: string; symbol: string; picture: Readonly<{ url: string; base64: string; bytes: number }> | null }>;
export type SheetStep = 'form' | 'review';

type DistrictState = {
  /** `reading` until the engine names its presets; `unavailable` where it does not serve Launch. */
  status: 'reading' | 'ready' | 'unavailable';
  network: Network | null;
  preset: LaunchPresetView | null;
  /** Running on the development stand-in: every screen says so. */
  stub: boolean;
  feed: readonly LaunchTower[];
  /** Launched from this browser, until the engine's list carries them. */
  mine: readonly LaunchTower[];
  sheet: boolean;
  step: SheetStep;
  draft: Draft;
  phase: Phase | null;
  connection: Connection | null;
  setDraft: (draft: Partial<Draft>) => void;
  setStep: (step: SheetStep) => void;
  setPhase: (phase: Phase | null) => void;
  setConnection: (connection: Connection | null) => void;
  openSheet: () => void;
  closeSheet: () => void;
};

const EMPTY: Draft = { name: '', symbol: '', picture: null };

export const useLaunch = create<DistrictState>((set) => ({
  status: 'reading',
  network: null,
  preset: null,
  stub: false,
  feed: [],
  mine: [],
  sheet: false,
  step: 'form',
  draft: EMPTY,
  phase: null,
  connection: null,
  setDraft: (draft) => set((state) => ({ draft: { ...state.draft, ...draft } })),
  setStep: (step) => set({ step }),
  setPhase: (phase) => set({ phase }),
  setConnection: (connection) => set({ connection }),
  openSheet: () => {
    useCity.getState().select(null);
    set((state) => ({ sheet: true, ...(state.phase?.step === 'done' ? { phase: null, step: 'form' as const, draft: EMPTY } : {}) }));
  },
  closeSheet: () => set((state) => ({ sheet: false, ...(state.phase?.step === 'failed' ? { phase: null } : {}) })),
}));

/** Every launch the city knows now: the engine's, with this browser's own marked, and the ones the engine does not list yet. */
export function allLaunches(state: Pick<DistrictState, 'feed' | 'mine'>, now = Date.now()): readonly LaunchTower[] {
  const mine = new Map(state.mine.map((launch) => [launch.token, launch]));
  const kept = remembered();
  const listed = new Set(state.feed.map((launch) => launch.token));
  const feed = state.feed.map((launch) => {
    const own = mine.get(launch.token);
    if (own) return { ...launch, mine: true, image: launch.image ?? own.image };
    return kept.has(launch.token) ? { ...launch, mine: true } : launch;
  });
  const pending = state.mine.filter((launch) => !listed.has(launch.token) && now - (Date.parse(launch.launchedAt ?? '') || 0) < MINE_KEEP_MS);
  return [...pending, ...feed];
}

/** The launch tower a city tower is, when it is one. */
export function launchTowerIn(state: Pick<DistrictState, 'feed' | 'mine'>, id: string | null): LaunchTower | null {
  if (!id) return null;
  return shownLaunches(allLaunches(state)).find((launch) => launch.token === id) ?? null;
}

/** Whether the Launch district opens its sheet here: the engine named a preset, on a network the city may launch on. */
export function launchOpenHere(state: Pick<DistrictState, 'status' | 'preset' | 'network' | 'stub'>): boolean {
  return state.status === 'ready' && state.preset !== null && (state.stub || cityLaunchOpen(state.network));
}

/* ---------------------------------------------------------------- the engine and the wallet */

/* The development stand-in, never in a production bundle: `?launch=stub` in a development build. */
const loadStub = process.env.NODE_ENV === 'production' ? null : () => import('./stub.ts');
const stubAsked = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('launch') === 'stub';
/* `&pace=4` makes the stand-in four times slower, so a slow screenshot still catches each step. */
const stubPace = () => Math.min(10, Math.max(1, Number(new URLSearchParams(window.location.search).get('pace')) || 1));

let engine: LaunchEngine | null = null;
let wallet: Promise<CityWallet> | null = null;

/** The engine the district reads and the flow launches through. */
export function launchEngine(): LaunchEngine {
  return engine ?? httpEngine();
}

/* The district's store for the development stand's shots (`trade-shots.mjs`); never in a production bundle. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __launch: useLaunch });

let tradeEngine: Promise<LaunchTradeEngine> | null = null;
const loadTradeStub = process.env.NODE_ENV === 'production' ? null : () => import('./trade-stub.ts');

/**
 * The engine's trade routes for a launch's tower (L1): over HTTP, or the stand-in's beside the stub engine. A load that
 * fails is let go, so the next read asks again.
 */
export function launchTradeEngine(): Promise<LaunchTradeEngine> {
  if (tradeEngine) return tradeEngine;
  const made =
    useLaunch.getState().stub && loadTradeStub
      ? loadTradeStub().then((trade) => trade.stubTradeEngine({ market: (token) => launchEngine().market(token), delayMs: 450 * stubPace() }))
      : Promise.resolve(httpTradeEngine());
  tradeEngine = made;
  made.catch(() => {
    if (tradeEngine === made) tradeEngine = null;
  });
  return made;
}

/** The creator's wallet: the browser's, or the stand-in's beside the stub engine. Loaded when the sheet first needs it. */
export function launchWallet(): Promise<CityWallet> {
  wallet ??= useLaunch.getState().stub && loadStub ? loadStub().then((stub) => stub.stubWallet({ delayMs: 4000 * stubPace() })) : import('./wallet.ts').then((module) => module.browserWallet());
  return wallet;
}

/* ---------------------------------------------------------------- the district's life */

let started = false;

/** Starts the district once for the page: the presets, the feed, the towers in the city and their moments. */
export function startDistrict(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void boot();
}

async function boot() {
  if (loadStub && stubAsked()) {
    const stub = await loadStub();
    engine = stub.stubEngine({ delayMs: 650 * stubPace() });
    useLaunch.setState({ stub: true });
    /* The stand-in's trade routes load with it, not on the first tap. */
    void launchTradeEngine().catch(() => undefined);
  }
  const source = launchEngine();
  useLaunch.subscribe((state, before) => {
    if (state.feed !== before.feed || state.mine !== before.mine) mergeIntoCity();
  });
  useCity.subscribe((state, before) => {
    if (state.snapshot !== before.snapshot) mergeIntoCity();
    /* A tower picked in the city closes the sheet; what was typed stays for the next time it opens. */
    if (state.selectedId && state.selectedId !== before.selectedId && useLaunch.getState().sheet) useLaunch.setState({ sheet: false });
  });
  setInterval(playNext, 500);
  /* The launches are read only where the engine serves Launch. */
  if (await readPresets(source)) startFeed(source);
}

/** The engine's presets: true once read; a deployment without Launch says so once, a silent engine is asked again. */
async function readPresets(source: LaunchEngine): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const answer = await source.presets();
    if (answer.ok) {
      useLaunch.setState({ status: 'ready', network: answer.data.network, preset: cityPreset(answer.data) });
      return true;
    }
    if (answer.code === 'LAUNCH_UNAVAILABLE' || answer.code === 'UNSUPPORTED_API') break;
    await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)));
  }
  useLaunch.setState({ status: 'unavailable' });
  return false;
}

function startFeed(source: LaunchEngine) {
  startLaunchFeed({
    engine: source,
    focus: () => {
      const selected = useCity.getState().selectedId;
      const mine = useLaunch.getState().mine.map((launch) => launch.token);
      return [...mine, ...(selected ? [selected] : [])];
    },
    onTowers: (towers) => useLaunch.setState({ feed: towers }),
    onMoments: queueMoments,
  });
}

/* ---------------------------------------------------------------- towers in the city */

const produced = new WeakSet<CitySnapshot>();
let base: CitySnapshot | null = null;
let shownKey = '';

/**
 * The launches join the city's own read: each new read of the market is the base, and the launches are laid in beside
 * it. While a run plays, its frozen city stays as it is.
 */
function mergeIntoCity() {
  if (useRun.getState().phase !== 'off') return;
  const city = useCity.getState();
  const current = city.snapshot;
  if (!produced.has(current)) base = current;
  if (!base || base.towers.length === 0) return;
  const launches = allLaunches(useLaunch.getState());
  const key = launchesKey(launches);
  if (produced.has(current) && key === shownKey) return;
  shownKey = key;
  const next = withLaunches(base, launches);
  if (next === base) {
    if (current !== base) city.setSnapshot(base);
    return;
  }
  produced.add(next);
  city.setSnapshot(next);
}

/* ---------------------------------------------------------------- moments */

/** One moment owns the frame: a launch's waits this long after the city's last one. */
const GAP_MS = 6_500;
/** A moment that waited longer than this is old news. */
const STALE_MS = 2 * 60_000;
const waiting: { draft: EventDraft; at: number }[] = [];

function queueMoments(moments: readonly EventDraft[]) {
  const own = new Set(useLaunch.getState().mine.map((launch) => launch.token));
  for (const draft of moments) {
    /* The creator's own liftoff already played when it landed. */
    if (draft.kind === 'launch' && own.has(draft.towerId)) continue;
    if (waiting.length < 4) waiting.push({ draft, at: Date.now() });
  }
}

function playNext() {
  while (waiting.length && Date.now() - waiting[0]!.at > STALE_MS) waiting.shift();
  if (!waiting.length) return;
  const city = useCity.getState();
  /* The line holds while a card or the sheet is open, and while a run plays. */
  if (!city.entered || city.selectedId || useLaunch.getState().sheet || useRun.getState().phase !== 'off') return;
  if (Date.now() - (city.feed[0]?.at ?? 0) < GAP_MS) return;
  const next = waiting.shift()!;
  if (city.layout.towers.some((placed) => placed.tower.id === next.draft.towerId)) city.play(next.draft);
}

/* ---------------------------------------------------------------- a launch lands */

const KEPT_KEY = 'ryntra:city:launches';
const KEPT_MAX = 12;

/** The coins launched from this browser, so its towers stay its own after a reload. */
function remembered(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEPT_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((token): token is string => typeof token === 'string') : []);
  } catch {
    return new Set();
  }
}

function remember(token: string) {
  try {
    const kept = [token, ...[...remembered()].filter((known) => known !== token)].slice(0, KEPT_MAX);
    window.localStorage.setItem(KEPT_KEY, JSON.stringify(kept));
  } catch {
    /* Kept for this visit only. */
  }
}

/**
 * The creator's coin is on chain: its tower rises in the docks at once, the camera flies to it and its card opens, and
 * the feed reads its market from now on. The engine's list takes over the tower once it carries the coin.
 */
export function landed(liftoff: Liftoff, preset: LaunchPresetView) {
  const tower: LaunchTower = {
    token: liftoff.token,
    symbol: liftoff.symbol,
    name: liftoff.name,
    image: liftoff.picture,
    launchedAt: new Date(liftoff.at).toISOString(),
    creator: liftoff.creator,
    preset: preset.id,
    graduationUsd: preset.graduationMarketCapUsd,
    progress: 0,
    migrated: false,
    /* Nothing was bought in the creation: the curve stands where the preset opens it. */
    marketCapUsd: preset.startMarketCapUsd,
    liquidityUsd: null,
    holders: null,
    holdersAtLeast: false,
    checks: ['young', 'young', 'young'],
    phase: 'ascent',
    crew: 0,
    ryntraTest: false,
    network: liftoff.network,
    mine: true,
  };
  remember(liftoff.token);
  useLaunch.setState((state) => ({ mine: [tower, ...state.mine.filter((launch) => launch.token !== tower.token)], sheet: false }));
  /* The city lays the new tower out first; the light column and the climb from the ground play on the next frames. */
  setTimeout(() => {
    const city = useCity.getState();
    city.select(liftoff.token);
    city.play({ kind: 'launch', towerId: liftoff.token, symbol: liftoff.symbol, title: 'Liftoff', value: 'NEW TOWER IN THE DOCKS' });
  }, 400);
}
