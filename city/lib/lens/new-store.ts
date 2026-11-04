import { create } from 'zustand';
import { useCity } from '../city/store.ts';
import { launchEngine, useLaunch } from '../launch/district.ts';
import type { CitySnapshot, Tower } from '../market/types.ts';
import { useRun } from '../run/store.ts';
import type { NewStage } from './lens.ts';
import { EMPTY_RINGS, pulseUrl, ringsOf, stagesOf, STAGES, towerOfLaunch, withDockLaunches, type LaunchSort, type NewLaunch, type Rings } from './launches.ts';
import { buyersOf, flowCandidates, lighthouseOf, type BuyerCount, type Lighthouse } from './lighthouse.ts';
import { useLens } from './store.ts';

/**
 * «New» over the whole of Solana, live (CITY-142): the engine's three Pulse feeds read every minute — every half
 * minute while «New» is picked — the network's launches laid into the Docks beside the city's own towers, and the
 * beacon counted from the engine's flow of each candidate while «New» is looked at. Read only: no wallet, no key, no
 * signature; nothing here moves anything. A feed that does not answer keeps its ring as it was; a city that reads
 * nothing keeps its towers.
 */

/** How often the feeds are read; while «New» is looked at, twice as often. */
export const READ_MS = 60_000;
export const READ_LOOKED_MS = 30_000;
/** A flow is read again after this long: the engine serves one answer for two minutes. */
export const FLOW_MS = 2 * 60_000;
/** The first read waits for the city's first frames. */
const FIRST_MS = 3_500;
/** The rings lay their towers in with the city's own next read, unless the city has not read for this long. */
const CITY_QUIET_MS = 2.5 * 60_000;

type Answer = Readonly<{ ok: boolean; json: () => Promise<unknown> }>;
export type PulseFetcher = (url: string) => Promise<Answer>;

type NewState = {
  rings: Rings;
  /** Every launch of the rings by mint and the ring it stands on — what the Lens reads for «New». */
  stages: ReadonlyMap<string, NewStage>;
  /** `reading` until the first answer; `live` every feed answered; `partial` some did; `off` none ever did. */
  status: 'idle' | 'reading' | 'live' | 'partial' | 'off';
  at: number;
  counts: ReadonlyMap<string, BuyerCount>;
  lighthouse: Lighthouse | null;
  /** The list instead of the rings (the toggle by «New»): the city's window «New launches on Solana» (CITY-191). */
  list: boolean;
  /** The window's order for every ring, and the one launchpad it is cut to (null: every launchpad). */
  sort: LaunchSort;
  pad: string | null;
  /** Running on the development stand-in. */
  stub: boolean;
  setList: (list: boolean) => void;
  setSort: (sort: LaunchSort) => void;
  setPad: (pad: string | null) => void;
};

export const useNewLaunches = create<NewState>((set) => ({
  rings: EMPTY_RINGS,
  stages: new Map(),
  status: 'idle',
  at: 0,
  counts: new Map(),
  lighthouse: null,
  list: false,
  sort: 'feed',
  pad: null,
  stub: false,
  setList: (list) => set({ list }),
  setSort: (sort) => set({ sort }),
  setPad: (pad) => set({ pad }),
}));

/** The three feeds read at once; a feed that does not answer leaves its ring as it was. */
export async function readRings(fetcher: PulseFetcher, kept: Rings): Promise<{ rings: Rings; answered: number }> {
  const answers: Partial<Record<NewStage, unknown>> = {};
  const read = await Promise.all(
    STAGES.map(async (stage) => {
      try {
        const answer = await fetcher(pulseUrl(stage));
        if (!answer.ok) return false;
        const body = await answer.json();
        if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) return false;
        answers[stage] = body;
        return true;
      } catch {
        return false;
      }
    }),
  );
  return { rings: ringsOf(answers, kept), answered: read.filter(Boolean).length };
}

/* ---------------------------------------------------------------- the reads */

const browserFetch: PulseFetcher = (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
let fetcher: PulseFetcher = browserFetch;

/* The development stand-in, never in a production bundle: `?launch=stub` in a development build, beside the Launch stub. */
const loadStub = process.env.NODE_ENV === 'production' ? null : () => import('./new-stub.ts');
const stubAsked = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('launch') === 'stub';

const looked = () => useLens.getState().lens === 'new' || useNewLaunches.getState().list;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

let reading: Promise<void> | null = null;
/** When the feeds were last asked, answered or not: a silent engine is not asked again sooner than an answering one. */
let triedAt = 0;
const due = (ms: number) => Date.now() - triedAt >= ms - 1_000;

/** One read of the three feeds; a second ask while one runs joins it. */
export function readNow(): Promise<void> {
  reading ??= (async () => {
    triedAt = Date.now();
    const state = useNewLaunches.getState();
    if (state.status === 'idle') useNewLaunches.setState({ status: 'reading' });
    const { rings, answered } = await readRings(fetcher, state.rings);
    const before = useNewLaunches.getState();
    const status = answered === STAGES.length ? 'live' : answered > 0 ? 'partial' : before.at ? before.status : 'off';
    useNewLaunches.setState({ rings, stages: stagesOf(rings), status, at: answered ? Date.now() : before.at, lighthouse: lighthouseOf(rings, before.counts) });
    if (answered) layIn();
    if (looked()) void readFlows();
  })().finally(() => {
    reading = null;
  });
  return reading;
}

const flowAt = new Map<string, number>();
let flowing = false;

/**
 * The beacon's counts: the engine's flow of each candidate, one at a time, each again after {@link FLOW_MS}. Only where
 * the engine serves Launch — elsewhere no coin is counted and no beacon is lit.
 */
async function readFlows() {
  if (flowing || useLaunch.getState().status !== 'ready') return;
  flowing = true;
  try {
    for (const mint of flowCandidates(useNewLaunches.getState().rings)) {
      if (Date.now() - (flowAt.get(mint) ?? 0) < FLOW_MS) continue;
      flowAt.set(mint, Date.now());
      const answer = await launchEngine()
        .flow(mint)
        .catch(() => null);
      const counted = answer?.ok ? buyersOf(answer.data) : null;
      const counts = new Map(useNewLaunches.getState().counts);
      if (counted) counts.set(mint, counted);
      else counts.delete(mint);
      /* The map keeps the coins still on the rings. */
      const known = useNewLaunches.getState().stages;
      for (const key of counts.keys()) if (!known.has(key)) counts.delete(key);
      useNewLaunches.setState({ counts, lighthouse: lighthouseOf(useNewLaunches.getState().rings, counts) });
    }
  } finally {
    flowing = false;
  }
}

/* ---------------------------------------------------------------- the Docks */

/** The towers the rings laid into the city: carried by reference through every snapshot made from one with them. */
const laid = new WeakSet<Tower>();
const produced = new WeakSet<CitySnapshot>();
let cityAt = 0;

function make(launch: NewLaunch): Tower {
  const tower = towerOfLaunch(launch);
  laid.add(tower);
  return tower;
}

/**
 * The network's launches join the city's own towers. A new read of the rings waits for the city's next read to be laid
 * in with it — laying the skyline out costs frames, once a minute is enough — unless none stands yet or the city has
 * not read for a while. While a run plays, or the city stands on its own exact plan, nothing is laid in.
 */
function layIn() {
  if (useCity.getState().snapshot.towers.some((tower) => laid.has(tower)) && Date.now() - cityAt < CITY_QUIET_MS) return;
  merge();
}

function merge() {
  if (useRun.getState().phase !== 'off') return;
  const city = useCity.getState();
  if (city.exact || !city.snapshot.towers.length) return;
  const next = withDockLaunches(city.snapshot, useNewLaunches.getState().rings, (tower) => laid.has(tower), make);
  if (next === city.snapshot) return;
  produced.add(next);
  city.setSnapshot(next);
}

/* ---------------------------------------------------------------- the life */

let started = false;

/** Starts once for the page: the first read after the city's first frames, then on its clock and on «New». */
export function startNewLaunches(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void boot();
}

async function boot() {
  if (loadStub && stubAsked()) {
    const stub = await loadStub();
    fetcher = stub.stubPulse();
    useNewLaunches.setState({ stub: true });
  }
  useCity.subscribe((state, before) => {
    if (state.snapshot === before.snapshot || produced.has(useCity.getState().snapshot)) return;
    cityAt = Date.now();
    merge();
  });
  /* «New» picked, or the list opened: a read older than the half minute is read again, and the beacon is counted. */
  const onLook = () => {
    if (!looked()) return;
    if (due(READ_LOOKED_MS)) void readNow();
    else void readFlows();
  };
  useLens.subscribe((state, before) => state.lens !== before.lens && onLook());
  useNewLaunches.subscribe((state, before) => state.list !== before.list && onLook());
  /* Launch served here: the beacon may be counted now. */
  useLaunch.subscribe((state, before) => state.status !== before.status && state.status === 'ready' && looked() && void readFlows());
  document.addEventListener('visibilitychange', () => {
    if (!hidden() && due(looked() ? READ_LOOKED_MS : READ_MS)) void readNow();
  });
  await new Promise((resolve) => setTimeout(resolve, FIRST_MS));
  await readNow();
  setInterval(() => {
    if (!hidden() && due(looked() ? READ_LOOKED_MS : READ_MS)) void readNow();
  }, READ_LOOKED_MS / 2);
}

/* The store for the development stand's shots; never in a production bundle. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __newLaunches: useNewLaunches });
