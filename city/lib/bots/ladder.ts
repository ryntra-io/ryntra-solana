import { create } from 'zustand';
import { costVerdict, ladderCosts, type CostVerdict, type LadderCosts } from '../../../lib/bots/ladder/costs.ts';
import { ladderNetwork, type LadderNetwork } from '../../../lib/bots/ladder/network.ts';
import { finishLegs, liveView, quotePerBase, type LadderOrderRead, type LiveView, type PlacedLeg } from '../../../lib/bots/ladder/orders.ts';
import { bandOfPlan, legAmountRaw, planIssues, planLeg, type LadderIssue, type LadderLeg, type LadderPool, type LegPlan } from '../../../lib/bots/ladder/plan.ts';
import type { VenueChoice } from '../../../lib/bots/ladder/venue.ts';
import { isExitPolicy } from '../../../lib/bots/ladder/exit.ts';
import { ladderOf, type BotDraft } from './draft.ts';

/**
 * The ladder composer in the bots window (B5, CITY-135): a buy or an exit ladder — or Smart DCA's ladder leg — placed
 * as DLMM limit orders on devnet, signed once in the person's own wallet.
 *
 * The window shows this only when the deployment says `NEXT_PUBLIC_RYNTRA_CITY_LADDER=devnet` (closed otherwise; the
 * engine's routes answer 404 while their own switch is closed). The plan, the bins and the one line of costs are the
 * engine's pure modules, the same the server builds with, so what the person sees before the wallet is what the server
 * builds; the signing itself is `ladder-sign.ts`, loaded on the tap.
 *
 * The placed ladders are kept in this browser (their order accounts and steps — public facts, never a key) and read
 * back from devnet while the window is open.
 */

export const LADDER_NET: LadderNetwork | null = ladderNetwork(process.env.NEXT_PUBLIC_RYNTRA_CITY_LADDER);

export type LadderPoolInfo = Readonly<{
  facts: LadderPool;
  activePrice: number;
  takesLimitOrders: boolean;
  existingArrays: readonly number[];
  bitmapExtension: boolean;
}>;

export type LadderStatus = Readonly<{ open: true; network: LadderNetwork; venue: VenueChoice; pool: LadderPoolInfo | null; at: number }>;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The engine's answer for a coin: its devnet pool, or none; null — the composer is closed or did not answer. */
export async function fetchLadderStatus(mint: string, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<LadderStatus | null> {
  try {
    const response = await fetcher(`/api/bots/ladder?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || body.open !== true || body.network !== 'devnet') return null;
    return body as unknown as LadderStatus;
  } catch {
    return null;
  }
}

export type Composed = Readonly<{
  legs: readonly LadderLeg[];
  plans: readonly LegPlan[];
  issues: readonly LadderIssue[];
  costs: LadderCosts | null;
  verdict: CostVerdict | null;
  /** Dollars the ladder places. */
  amountUsd: number;
}>;

/** A draft as the legs the engine places in a pool, their plans, what is wrong and the exact costs. Null — no ladder. */
export function composeLadder(draft: BotDraft, pool: LadderPoolInfo, solUsd: number | null): Composed | null {
  const ladder = ladderOf(draft);
  if (!ladder) return null;
  const leg: LadderLeg = {
    side: ladder.side,
    steps: ladder.steps,
    firstPct: ladder.firstPct,
    lastPct: ladder.lastPct,
    shape: ladder.shape,
    amountRaw: legAmountRaw(ladder.side, ladder.amountUsd, pool.activePrice, pool.facts),
  };
  const plan = planLeg(leg, pool.facts);
  if (!plan) return { legs: [leg], plans: [], issues: ['amount'], costs: null, verdict: null, amountUsd: ladder.amountUsd };
  const costs = ladderCosts([plan], { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension });
  return {
    legs: [leg],
    plans: [plan],
    issues: planIssues(plan, pool.facts),
    costs,
    verdict: solUsd ? costVerdict(costs, ladder.amountUsd, solUsd) : null,
    amountUsd: ladder.amountUsd,
  };
}

/* ------------------------------------------------------------ placed ladders */

export type LiveLadder = Readonly<{
  id: string;
  network: LadderNetwork;
  owner: string;
  pool: string;
  baseIsX: boolean;
  draft: BotDraft;
  band: Readonly<{ lower: number; upper: number }> | null;
  legs: readonly PlacedLeg[];
  placedAt: number;
  closedAt: number | null;
}>;

export const LIVE_KEY = 'ryntra.city.bots.ladders.devnet.v1';

export const isLiveLadder = (value: unknown): value is LiveLadder =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.network === 'devnet' &&
  typeof value.owner === 'string' &&
  typeof value.pool === 'string' &&
  Array.isArray(value.legs) &&
  isRecord(value.draft) &&
  isExitPolicy((value.draft as Record<string, unknown>).exit);

/** What the window's action is doing now, one at a time. */
export type Busy = Readonly<{ kind: 'place' | 'cancel' | 'finish'; id: string | null }> | null;

/** The last answer the person sees under the action, in a word the window translates. */
export type LadderNote =
  | Readonly<{ kind: 'placed' | 'cancelled' | 'partly' | 'costsChanged' | 'walletNo' | 'refused' | 'unreachable'; at: number; reason?: string }>
  | null;

type Kept = Pick<Storage, 'getItem' | 'setItem'>;
const kept = (): Kept | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

type LadderState = {
  status: Readonly<Record<string, LadderStatus | 'none' | 'loading'>>;
  ladders: readonly LiveLadder[];
  reads: Readonly<Record<string, LadderOrderRead>>;
  prices: Readonly<Record<string, number>>;
  busy: Busy;
  note: LadderNote;
  /** The cost line shown before the last tap, when the server's reading came back higher: shown again, one more tap. */
  shownCosts: LadderCosts | null;
  hydrated: boolean;
  loadStatus: (mint: string, force?: boolean) => Promise<void>;
  hydrate: () => void;
  add: (ladder: LiveLadder) => void;
  update: (id: string, change: (ladder: LiveLadder) => LiveLadder) => void;
  setReads: (reads: readonly LadderOrderRead[], prices: Readonly<Record<string, number>>) => void;
  setBusy: (busy: Busy) => void;
  say: (note: LadderNote) => void;
  setShownCosts: (costs: LadderCosts | null) => void;
};

export function createLadderStore(options: Readonly<{ fetch?: Fetcher; storage?: () => Kept | null; now?: () => number }> = {}) {
  const fetcher = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const store = options.storage ?? kept;
  const now = options.now ?? Date.now;
  return create<LadderState>((set, get) => {
    const save = (ladders: readonly LiveLadder[]) => {
      set({ ladders });
      try {
        store()?.setItem(LIVE_KEY, JSON.stringify(ladders));
      } catch {
        /* Not kept: the ladder lives until the page closes; its orders stay on devnet all the same. */
      }
    };
    return {
      status: {},
      ladders: [],
      reads: {},
      prices: {},
      busy: null,
      note: null,
      shownCosts: null,
      hydrated: false,
      loadStatus: async (mint, force = false) => {
        if (!LADDER_NET && !force) return;
        const have = get().status[mint];
        if (have && have !== 'none' && !force && (have === 'loading' || now() - have.at < 60_000)) return;
        set({ status: { ...get().status, [mint]: 'loading' } });
        const answer = await fetchLadderStatus(mint, fetcher);
        set({ status: { ...get().status, [mint]: answer ?? 'none' } });
      },
      hydrate: () => {
        if (get().hydrated) return;
        let ladders: LiveLadder[] = [];
        try {
          const raw = store()?.getItem(LIVE_KEY);
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          ladders = Array.isArray(parsed) ? parsed.filter(isLiveLadder) : [];
        } catch {
          ladders = [];
        }
        set({ hydrated: true, ladders });
      },
      add: (ladder) => save([ladder, ...get().ladders]),
      update: (id, change) => save(get().ladders.map((ladder) => (ladder.id === id ? change(ladder) : ladder))),
      setReads: (reads, prices) => set({ reads: { ...get().reads, ...Object.fromEntries(reads.map((read) => [read.limitOrder, read])) }, prices: { ...get().prices, ...prices } }),
      setBusy: (busy) => set({ busy }),
      say: (note) => set({ note }),
      setShownCosts: (shownCosts) => set({ shownCosts }),
    };
  });
}

export const useLadder = createLadderStore();

/** A placed ladder's view now: its legs against the latest reads and its pool's price. */
export function viewOf(ladder: LiveLadder, reads: Readonly<Record<string, LadderOrderRead>>, prices: Readonly<Record<string, number>>): LiveView {
  const poolPrice = prices[ladder.pool];
  return liveView({
    legs: ladder.legs,
    reads,
    band: ladder.band,
    price: typeof poolPrice === 'number' ? quotePerBase(poolPrice, ladder.baseIsX) : null,
    policy: ladder.draft.exit,
    closed: ladder.closedAt !== null,
  });
}

/** The band a placed ladder answers its exit policy for, from its plans. */
export const bandOfPlans = (plans: readonly LegPlan[]) => (plans[0] ? bandOfPlan(plans[0]) : null);

export { finishLegs };

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __ladder: useLadder });
