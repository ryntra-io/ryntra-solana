import { create } from 'zustand';
import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import type { HarborPool } from '../districts/harbor/pools.ts';
import { stepFromConfig, type MultiplierStep } from './corporate.ts';
import { keepLot, keepSteps, keepWishes, lotsOf, stepsSeen, wishes } from './device.ts';
import { createEarnEngine, type EarnEngine, type LendRates } from './engine.ts';
import type { LstFeed } from './feed.ts';
import type { ProductId } from './flag.ts';
import type { SaverLot } from './mine.ts';
import { setSaverEnv } from './saver-store.ts';
import type { ScaledConfig } from './stocks.ts';

/**
 * What the Earn window reads, kept while it is open: the LST yield feed, the Piers list, the lending rates (context for
 * the Dollar Saver), and for the connected wallet its pool positions, the multipliers of the stocks it holds and the
 * SOL Saver's lots. Every read is the engine's; a read that failed is said as failed, never drawn as an empty list.
 */

export type Loaded<T> =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; value: T; at: number }>
  | Readonly<{ status: 'error' }>;

type Owned<T> = Readonly<{ owner: string; value: Loaded<T> }> | null;

type EarnData = {
  feed: Loaded<LstFeed>;
  piers: Loaded<Readonly<{ pools: readonly HarborPool[]; at: string | null }>>;
  lend: Loaded<LendRates>;
  positions: Owned<readonly PositionView[]>;
  stocks: Owned<readonly ScaledConfig[]>;
  /** The multiplier steps seen on this device, every stock. */
  steps: readonly MultiplierStep[];
  lots: Readonly<{ owner: string; lots: readonly SaverLot[] }> | null;
  wishes: ReadonlySet<ProductId>;
  loadFeed: () => Promise<void>;
  loadPiers: () => Promise<void>;
  loadLend: () => Promise<void>;
  /** The wallet changed (or none): its reads are read again and the last wallet's go. */
  follow: (owner: string | null) => void;
  loadPositions: (owner: string) => Promise<void>;
  loadStocks: (owner: string, mints: readonly string[]) => Promise<void>;
  toggleWish: (product: ProductId) => void;
};

let engine: EarnEngine = createEarnEngine();
const now = () => Date.now();

/** For the tests and the screenshot stand. */
export function setEarnEngine(next: EarnEngine): void {
  engine = next;
}

/** A read older than this is read again when the window asks. */
export const STALE_MS = 60_000;

const fresh = <T,>(value: Loaded<T>) => value.status === 'loading' || (value.status === 'ready' && now() - value.at < STALE_MS);

export const useEarnData = create<EarnData>((set, get) => ({
  feed: { status: 'idle' },
  piers: { status: 'idle' },
  lend: { status: 'idle' },
  positions: null,
  stocks: null,
  steps: [],
  lots: null,
  wishes: new Set(),

  loadFeed: async () => {
    if (fresh(get().feed)) return;
    const keep = get().feed;
    if (keep.status !== 'ready') set({ feed: { status: 'loading' } });
    const read = await engine.feed();
    set({ feed: read.ok ? { status: 'ready', value: read.value, at: now() } : keep.status === 'ready' ? keep : { status: 'error' } });
  },

  loadPiers: async () => {
    if (fresh(get().piers)) return;
    const keep = get().piers;
    if (keep.status !== 'ready') set({ piers: { status: 'loading' } });
    const read = await engine.piers();
    set({ piers: read.ok ? { status: 'ready', value: read.value, at: now() } : keep.status === 'ready' ? keep : { status: 'error' } });
  },

  loadLend: async () => {
    if (fresh(get().lend)) return;
    set({ lend: { status: 'loading' } });
    const read = await engine.lend();
    set({ lend: read.ok ? { status: 'ready', value: read.value, at: now() } : { status: 'error' } });
  },

  follow: (owner) => {
    set({
      positions: null,
      stocks: null,
      steps: typeof window === 'undefined' ? [] : stepsSeen(),
      lots: owner && typeof window !== 'undefined' ? { owner, lots: lotsOf(owner) } : null,
      wishes: typeof window === 'undefined' ? new Set() : wishes(),
    });
    if (owner) void get().loadPositions(owner);
  },

  loadPositions: async (owner) => {
    const before = get().positions;
    if (!(before?.owner === owner && before.value.status === 'ready')) set({ positions: { owner, value: { status: 'loading' } } });
    const read = await engine.positions(owner);
    if (get().positions?.owner !== owner) return;
    set({ positions: { owner, value: read.ok ? { status: 'ready', value: read.value.positions, at: now() } : { status: 'error' } } });
  },

  loadStocks: async (owner, mints) => {
    set({ stocks: { owner, value: { status: 'loading' } } });
    const read = await engine.stocks(mints);
    if (get().stocks?.owner !== owner) return;
    if (!read.ok) return set({ stocks: { owner, value: { status: 'error' } } });
    const seen = read.value.map((config) => stepFromConfig(config.mint, config, now())).filter((step): step is MultiplierStep => step !== null);
    set({ stocks: { owner, value: { status: 'ready', value: read.value, at: now() } }, steps: keepSteps(seen) });
  },

  toggleWish: (product) => {
    const next = new Set(get().wishes);
    if (next.has(product)) next.delete(product);
    else next.add(product);
    keepWishes(next);
    set({ wishes: next });
  },
}));

// A purchase the SOL Saver lands is kept on the device and shows in «Mine» at once.
setSaverEnv({
  keep: (owner, lot) => {
    const lots = keepLot(owner, lot);
    if (useEarnData.getState().lots?.owner === owner) useEarnData.setState({ lots: { owner, lots } });
  },
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __earnData: useEarnData });
