import { create } from 'zustand';
import { costVerdict, DEFAULT_TERMS, ladderCosts, type ChainTerms, type CostVerdict, type LadderCosts } from '../../../lib/bots/ladder/costs.ts';
import { ladderNetwork, type LadderNetwork } from '../../../lib/bots/ladder/network.ts';
import { legReceives } from '../../../lib/bots/ladder/promise.ts';
import { finishLegs, liveView, quotePerBase, type LadderOrderRead, type LiveView, type PlacedLeg } from '../../../lib/bots/ladder/orders.ts';
import { bandOfPlan, legAmountRaw, legUsd, planIssues, planLeg, type LadderIssue, type LadderLeg, type LadderPool, type LegPlan } from '../../../lib/bots/ladder/plan.ts';
import type { VenueChoice } from '../../../lib/bots/ladder/venue.ts';
import { isExitPolicy } from '../../../lib/bots/ladder/exit.ts';
import { ladderOf, type BotDraft } from './draft.ts';

/**
 * The ladder composer in the bots window (B5, CITY-135; mainnet CITY-219): a buy or an exit ladder — or Smart DCA's
 * ladder leg — placed as DLMM limit orders, signed once in the person's own wallet.
 *
 * The window shows this only on the network the deployment names, `NEXT_PUBLIC_RYNTRA_CITY_LADDER=devnet` or
 * `mainnet` (closed otherwise; the engine's routes answer 404 while that network's own server switch is closed). The
 * plan, the bins and the one line of costs are the engine's pure modules, on the chain's own terms the engine reads
 * (rent per byte, mainnet's priority), so what the person sees before the wallet is what the server builds; the
 * signing itself is `ladder-sign.ts`, loaded on the tap.
 *
 * The placed ladders are kept in this browser per network (their order accounts and steps — public facts, never a
 * key) and read back from the chain while the window is open.
 */

export const LADDER_NET: LadderNetwork | null = ladderNetwork(process.env.NEXT_PUBLIC_RYNTRA_CITY_LADDER);

export type LadderPoolInfo = Readonly<{
  facts: LadderPool;
  activePrice: number;
  takesLimitOrders: boolean;
  existingArrays: readonly number[];
  bitmapExtension: boolean;
  /** The chain's rent and priority the cost line stands on; CITY-135's constants when absent. */
  terms?: ChainTerms;
  /** The most one ladder may place on this network, dollars; null or absent — no cap. */
  maxUsd?: number | null;
}>;

export type LadderStatus = Readonly<{
  open: true;
  network: LadderNetwork;
  venue: VenueChoice;
  pool: LadderPoolInfo | null;
  terms?: ChainTerms | null;
  maxUsd?: number | null;
  at: number;
}>;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The engine's answer for a coin on a network: its pool there, or none; null — the composer is closed or did not answer. */
export async function fetchLadderStatus(mint: string, network: LadderNetwork = LADDER_NET ?? 'devnet', fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<LadderStatus | null> {
  try {
    const response = await fetcher(`/api/bots/ladder?mint=${encodeURIComponent(mint)}&network=${network}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || body.open !== true || body.network !== network) return null;
    const status = body as unknown as LadderStatus;
    /* The pool carries the chain's terms and the cap, so the line is composed on what the engine builds with. */
    const pool = status.pool ? { ...status.pool, terms: status.terms ?? undefined, maxUsd: status.maxUsd ?? null } : null;
    return { ...status, pool };
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
  /** What every step gives if all of them fill, whole units of the output (the coin for a buy, dollars for an exit). */
  receives: number;
  /** Each step's price, quote per base, nearest the market first. */
  prices: readonly number[];
  /** The ladder is over the network's cap: shown, not placed. */
  overCap: boolean;
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
  if (!plan) return { legs: [leg], plans: [], issues: ['amount'], costs: null, verdict: null, amountUsd: ladder.amountUsd, receives: 0, prices: [], overCap: false };
  const costs = ladderCosts([plan], { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension }, pool.terms ?? DEFAULT_TERMS);
  const placedUsd = legUsd(plan.side, plan.totalRaw, pool.activePrice, pool.facts);
  const max = pool.maxUsd ?? null;
  return {
    legs: [leg],
    plans: [plan],
    issues: planIssues(plan, pool.facts),
    costs,
    verdict: solUsd ? costVerdict(costs, ladder.amountUsd, solUsd) : null,
    amountUsd: ladder.amountUsd,
    receives: legReceives(plan, pool.facts),
    prices: plan.rungs.map((rung) => rung.price),
    overCap: max !== null && !(placedUsd <= max + 1e-9),
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
  /** When the person sent its cancellation: the ladder closes once the chain shows every order gone (CITY-231). */
  cancelSentAt?: number | null;
}>;

/** Where this browser keeps a network's placed ladders: one key per network, so neither ever shows the other's. */
export const liveKey = (network: LadderNetwork): string => `ryntra.city.bots.ladders.${network}.v1`;
export const LIVE_KEY = liveKey(LADDER_NET ?? 'devnet');

export const isLiveLadder = (value: unknown, network: LadderNetwork = LADDER_NET ?? 'devnet'): value is LiveLadder =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.network === network &&
  typeof value.owner === 'string' &&
  typeof value.pool === 'string' &&
  Array.isArray(value.legs) &&
  isRecord(value.draft) &&
  isExitPolicy((value.draft as Record<string, unknown>).exit);

/** What the window's action is doing now, one at a time; `check` — reading the chain before «Place» (CITY-233). */
export type Busy = Readonly<{ kind: 'check' | 'place' | 'cancel' | 'finish'; id: string | null }> | null;

/**
 * The last answer the person sees under the action, in a word the window translates. `checking` — sent, and the relay's
 * answer was lost: the chain is being read for what landed (CITY-231). `rest` — a cancellation took back part, the rest
 * waits for one more prompt; `elsewhere` — this wallet already has a ladder in the pool, placed from somewhere else
 * (CITY-233). `bot` — the answer belongs to a bot read from the chain, shown under that bot.
 */
export type LadderNoteKind = 'placed' | 'cancelled' | 'partly' | 'costsChanged' | 'walletNo' | 'refused' | 'unreachable' | 'overCap' | 'checking' | 'rest' | 'elsewhere';
export type LadderNote = Readonly<{ kind: LadderNoteKind; at: number; reason?: string; bot?: string }> | null;

/** «Take back and rebuild» sent: the ladder that opens again once the chain shows the old one closed, and when it was asked. */
export type Rebuild = Readonly<{ id: string; at: number }> | null;

/** This wallet's orders in a pool the chain holds and this browser placed no ladder for: «Place» is «View» there. */
export type Elsewhere = Readonly<{ pool: string; orders: readonly string[] }> | null;

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
  /** A rebuild waiting for the chain to close the old ladder (CITY-233). */
  rebuild: Rebuild;
  /** A ladder of this wallet's from elsewhere in the pool being composed (CITY-233). */
  elsewhere: Elsewhere;
  /** Orders from elsewhere the person has looked at: «Place» beside them is a choice now, not a slip. */
  seen: ReadonlySet<string>;
  /** Chain bots part-taken-back: their action reads «Cancel the rest» until nothing is left. */
  rest: Readonly<Record<string, true>>;
  /** Order accounts whose cancellation was sent, and when: not built twice while the chain catches up. */
  cancelSent: Readonly<Record<string, number>>;
  hydrated: boolean;
  loadStatus: (mint: string, force?: boolean) => Promise<void>;
  hydrate: () => void;
  add: (ladder: LiveLadder) => void;
  update: (id: string, change: (ladder: LiveLadder) => LiveLadder) => void;
  /** A ladder kept on signing whose relay certainly sent nothing: it never existed. */
  remove: (id: string) => void;
  setReads: (reads: readonly LadderOrderRead[], prices: Readonly<Record<string, number>>) => void;
  setBusy: (busy: Busy) => void;
  say: (note: LadderNote) => void;
  setShownCosts: (costs: LadderCosts | null) => void;
  setRebuild: (rebuild: Rebuild) => void;
  setElsewhere: (elsewhere: Elsewhere) => void;
  /** The person looked at these orders from elsewhere. */
  acknowledge: (orders: readonly string[]) => void;
  setRest: (bot: string, rest: boolean) => void;
  markCancelSent: (orders: readonly string[], at: number) => void;
};

export function createLadderStore(options: Readonly<{ fetch?: Fetcher; storage?: () => Kept | null; now?: () => number; network?: LadderNetwork | null }> = {}) {
  const fetcher = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const store = options.storage ?? kept;
  const now = options.now ?? Date.now;
  const network = options.network === undefined ? LADDER_NET : options.network;
  const key = liveKey(network ?? 'devnet');
  return create<LadderState>((set, get) => {
    const save = (ladders: readonly LiveLadder[]) => {
      set({ ladders });
      try {
        store()?.setItem(key, JSON.stringify(ladders));
      } catch {
        /* Not kept: the ladder lives until the page closes; its orders stay on the chain all the same. */
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
      rebuild: null,
      elsewhere: null,
      seen: new Set<string>(),
      rest: {},
      cancelSent: {},
      hydrated: false,
      loadStatus: async (mint, force = false) => {
        if (!network && !force) return;
        const have = get().status[mint];
        if (have && have !== 'none' && !force && (have === 'loading' || now() - have.at < 60_000)) return;
        set({ status: { ...get().status, [mint]: 'loading' } });
        const answer = await fetchLadderStatus(mint, network ?? 'devnet', fetcher);
        set({ status: { ...get().status, [mint]: answer ?? 'none' } });
      },
      hydrate: () => {
        if (get().hydrated) return;
        let ladders: LiveLadder[] = [];
        try {
          const raw = store()?.getItem(key);
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          ladders = Array.isArray(parsed) ? parsed.filter((value): value is LiveLadder => isLiveLadder(value, network ?? 'devnet')) : [];
        } catch {
          ladders = [];
        }
        set({ hydrated: true, ladders });
      },
      add: (ladder) => save([ladder, ...get().ladders]),
      update: (id, change) => save(get().ladders.map((ladder) => (ladder.id === id ? change(ladder) : ladder))),
      remove: (id) => save(get().ladders.filter((ladder) => ladder.id !== id)),
      setReads: (reads, prices) => set({ reads: { ...get().reads, ...Object.fromEntries(reads.map((read) => [read.limitOrder, read])) }, prices: { ...get().prices, ...prices } }),
      setBusy: (busy) => set({ busy }),
      say: (note) => set({ note }),
      setShownCosts: (shownCosts) => set({ shownCosts }),
      setRebuild: (rebuild) => set({ rebuild }),
      setElsewhere: (elsewhere) => set({ elsewhere }),
      acknowledge: (orders) => set({ seen: new Set([...get().seen, ...orders]) }),
      setRest: (bot, rest) => {
        const next: Record<string, true> = { ...get().rest };
        if (rest) next[bot] = true;
        else delete next[bot];
        set({ rest: next });
      },
      markCancelSent: (orders, at) => set({ cancelSent: { ...get().cancelSent, ...Object.fromEntries(orders.map((order) => [order, at])) } }),
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
