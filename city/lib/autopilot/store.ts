import { create } from 'zustand';
import type { AgentBudget } from '../../../lib/mandate/budget.ts';
import type { AgentDay } from '../../../lib/mandate/report.ts';
import type { AgentNet } from '../../../lib/mandate/net.ts';
import type { Picture } from '../../../lib/launch/picture.client.ts';
import { MANDATE_NET, useMandate, type MandateRecord } from '../bots/mandate.ts';
import { useMine } from '../trade/mine-store.ts';
import { useWallet } from '../trade/wallet.ts';
import { launchOpenHere, poolDoorHere, useLaunch } from '../launch/district.ts';
import { poolChoiceOf, usePool } from '../launch/pool.ts';
import { poolAskOf } from '../launch/pool-ask.ts';
import { AUTOPILOT_NET } from './flag.ts';
import { budgetFor, proposal, type Proposal } from './plan.ts';
import type { AgentAsk } from './read.ts';
import { planText, STEADY, type StrategyPlan } from '../../../lib/mandate/plans.ts';
import type { Paper, RunResult } from '../../../lib/mandate/backtest.ts';
import { pickLaunch, readRun } from './runs.ts';

/**
 * The agent on its word: the card a sentence opens, and what the agent did since.
 *
 * - **Trade.** The card takes the budget a day from the words said — exactly as said, no ceiling of Ryntra's —
 *   with the trade and the term that follow, the rhythm the agent keeps and the limits in one line; «Sign once» is the mandate — the person's wallet signs once, her
 *   budget moves into her own smart account's vault under a policy the chain holds — and the mandate joins the agent's
 *   book with her words, so the agent trades by itself from then on. «Stop» is one more signature.
 * - **Launch.** The card proposes a name, a ticker and a picture the agent made (`emblem.ts`), with the launch sheet's
 *   own rules; «Launch» fills the sheet and opens it on its review, where the person's wallet signs the launch.
 *
 * The signing is the mandate's own (`../bots/mandate-sign.ts`), loaded on the tap: nothing here holds a key or builds a
 * transaction. What the agent did is read from the agent's book (`/api/bots/mandate/agent`) while the card or «Mine»
 * shows it.
 */

/** The agent's view of a mandate, as the book answers it (`lib/mandate/agent-service.server.ts` `AgentView`). */
export type AgentView = Readonly<{
  status: 'working' | 'stopped' | 'ended' | 'spent' | 'paused';
  /** Why it paused itself (`lib/mandate/strategy.ts` `PauseReason`); `take`, `stop`, `late` — the person's own exit. */
  pausedBy?: string | null;
  strategy: string;
  /** The strategy with its numbers (`lib/mandate/plans.ts` `planText`). */
  plan?: string;
  receiveMint: string;
  symbol?: string | null;
  everyMs: number;
  result: Readonly<{ trades: number; spentRaw: string; boughtRaw: string; worthRaw: string | null; earnedRaw: string | null; multiple: number | null }>;
  /** `state` — `unknown` is a trade being confirmed, never a failure; absent on an engine of before. */
  last: readonly Readonly<{ at: number; ok: boolean; state?: TradeState; signature: string | null; spentRaw: string; receivedRaw: string | null }>[];
  /** What the agent is doing now, her «Freeze», and the money — budget = spent + left. */
  mission?: Mission;
  frozen?: boolean;
  books?: Books;
  updatedAt: number;
  /** What the agent still holds for her of its coin, and her last sale through it. */
  heldRaw?: string;
  lastSale?: Readonly<{ policy: string; status: 'review' | 'signed' | 'sold' | 'failed'; signature: string | null; soldRaw: string; receivedRaw: string | null; reason: string | null }> | null;
  /** Its last day, and — when asked with `since` — what it did since the person last looked. */
  day?: AgentDay;
  away?: AgentDay;
  /** The whole mandate after every fee, and plain holding beside it. */
  net?: AgentNet;
}>;

const isDay = (value: unknown): value is AgentDay => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.trades === 'number' && typeof v.since === 'number' && typeof v.until === 'number' && typeof v.spentRaw === 'string' && (v.earnedRaw === null || typeof v.earnedRaw === 'string');
};

const rawOrNull = (value: unknown) => value === null || (typeof value === 'string' && /^-?\d{1,30}$/u.test(value));
const isNet = (value: unknown): value is AgentNet => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.trades === 'number' && typeof v.spentRaw === 'string' && rawOrNull(v.netRaw) && rawOrNull(v.holdRaw) && rawOrNull(v.feesRaw);
};

/** The engine's mission and books (`lib/mandate/mission.ts`), as the card reads them. */
export type TradeState = 'ok' | 'failed' | 'refused' | 'unknown' | 'held';
export type Mission = Readonly<{ state: 'working' | 'confirming' | 'waiting' | 'frozen' | 'paused' | 'done' | 'stopped'; reason: string | null; nextAt: number | null }>;
export type Books = Readonly<{ state: 'exact' | 'settling' | 'more' | 'off' | 'unread' | 'closed'; budgetRaw: string; spentRaw: string; leftRaw: string | null; pendingRaw: string; gapRaw: string }>;

const MISSIONS = new Set(['working', 'confirming', 'waiting', 'frozen', 'paused', 'done', 'stopped']);
const BOOKS = new Set(['exact', 'settling', 'more', 'off', 'unread', 'closed']);
const RAW = /^\d{1,30}$/u;

export const isMission = (value: unknown): value is Mission => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.state === 'string' && MISSIONS.has(v.state) && (v.reason === null || typeof v.reason === 'string') && (v.nextAt === null || typeof v.nextAt === 'number');
};

export const isBooks = (value: unknown): value is Books => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.state === 'string' && BOOKS.has(v.state) && [v.budgetRaw, v.spentRaw, v.pendingRaw, v.gapRaw].every((raw) => typeof raw === 'string' && RAW.test(raw)) && (v.leftRaw === null || (typeof v.leftRaw === 'string' && RAW.test(v.leftRaw)));
};

export const isAgentView = (value: unknown): value is AgentView => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const result = v.result as Record<string, unknown> | undefined;
  return typeof v.status === 'string' && typeof v.receiveMint === 'string' && typeof v.everyMs === 'number' && typeof result === 'object' && result !== null && typeof result.trades === 'number' && typeof result.spentRaw === 'string' && Array.isArray(v.last);
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What the agent did for this mandate; null when the book does not answer or does not know it. With `since`, what it did since then too. */
export async function readAgentView(record: MandateRecord, fetcher: Fetcher = (url, init) => fetch(url, init), since: number | null = null): Promise<AgentView | null> {
  try {
    const response = await fetcher(`/api/bots/mandate/agent?policy=${record.policy}&owner=${record.owner}${since !== null ? `&since=${Math.floor(since)}` : ''}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isAgentView(value)) return null;
    /* A span the book did not answer whole is left out, never shown half. */
    const { day, away, net, mission, books, frozen, ...rest } = value;
    return { ...rest, ...(isDay(day) ? { day } : {}), ...(isDay(away) ? { away } : {}), ...(isNet(net) ? { net } : {}), ...(isMission(mission) ? { mission } : {}), ...(isBooks(books) ? { books } : {}), ...(typeof frozen === 'boolean' ? { frozen } : {}) };
  } catch {
    return null;
  }
}

type AutopilotState = {
  open: boolean;
  ask: AgentAsk | null;
  /** `ask` — opened by the person's words; `agent` — opened from «Mine» to see what the agent did. */
  face: 'ask' | 'agent';
  /** Trade: the person's budget — from her words or her fields; null until it is one the agent takes. */
  budget: AgentBudget | null;
  /** Launch: the agent's proposal and its picture. */
  proposal: Proposal | null;
  picture: Picture | null;
  drawing: boolean;
  /** What the agent did, by policy. */
  views: Readonly<Record<string, AgentView>>;
  /** The strategy said, with its numbers; null — the steady one. */
  plan: StrategyPlan | null;
  /** An early plan's pick: being found, none passes, or the launch with its birth. */
  launch: Readonly<{ state: 'picking' | 'none' } | { state: 'picked'; bornAt: number }> | null;
  /** The run on history of the plan on the coin, for «Details»; null — not run, or the coin has no candles. */
  tested: Readonly<{ key: string; run: RunResult }> | null;
  /** The practice without money, and its run since it started. */
  paper: Paper | null;
  paperRun: RunResult | null;
  show: (ask: AgentAsk) => void;
  /** What the agent did, from «Mine». */
  showAgent: () => void;
  close: () => void;
  setBudget: (budget: AgentBudget | null) => void;
  another: () => Promise<void>;
  setView: (policy: string, view: AgentView) => void;
  setPaper: (paper: Paper | null, run?: RunResult | null) => void;
};

/* ---------------------------------------------------------------- Test, practice, pick */

const PAPER_KEY = 'ryntra.city.agentPaper';

/** The practice kept on this device only: a convenience of the viewer's, never state anything else counts on. */
function keptPaper(): Paper | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PAPER_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    return typeof v.plan === 'string' && typeof v.coin === 'string' && typeof v.startedAt === 'number' ? { plan: v.plan, coin: v.coin, symbol: typeof v.symbol === 'string' ? v.symbol : null, startedAt: v.startedAt, bornAt: typeof v.bornAt === 'number' ? v.bornAt : null } : null;
  } catch {
    return null;
  }
}

function keepPaper(paper: Paper | null): void {
  try {
    if (paper) localStorage.setItem(PAPER_KEY, JSON.stringify(paper));
    else localStorage.removeItem(PAPER_KEY);
  } catch {
    /* A private window keeps nothing: the practice lasts while the card is open. */
  }
}

/** The seed of the next proposal: different on each open, the same within one. */
let seedCounter = Math.floor(Math.random() * 1000);

async function paint(next: Proposal): Promise<Picture | null> {
  const { drawEmblem } = await import('./emblem.ts');
  return drawEmblem(next.symbol, next.seed).catch(() => null);
}

export const useAutopilot = create<AutopilotState>((set, get) => ({
  open: false,
  ask: null,
  face: 'ask',
  budget: null,
  proposal: null,
  picture: null,
  drawing: false,
  views: {},
  plan: null,
  launch: null,
  tested: null,
  paper: keptPaper(),
  paperRun: null,
  show: (ask) => {
    if (ask.kind === 'trade') {
      // The day as said, never cut; nothing said — the card asks, with no sum of Ryntra's proposed (decision 108).
      const budget = budgetFor(ask.perDaySol, spendableNow(), { perTradeSol: ask.perTradeSol ?? null, days: ask.days ?? null });
      const plan = ask.plan ?? null;
      set({ open: true, ask, face: 'ask', budget, proposal: null, picture: null, plan, tested: null, launch: plan?.id === 'early' && MANDATE_NET === 'mainnet' ? { state: 'picking' } : null });
      useMandate.getState().setBudget(budget);
      useMandate.getState().setCoin(ask.coin ? { mint: ask.coin.mint, symbol: ask.coin.symbol, icon: ask.coin.icon } : null);
      // An early plan on mainnet: the agent picks the launch itself, through the city's check.
      if (plan?.id === 'early' && MANDATE_NET === 'mainnet') {
        void pickLaunch(plan.maxAgeH).then((picked) => {
          if (get().ask !== ask) return;
          if (!picked) return set({ launch: { state: 'none' } });
          useMandate.getState().setCoin({ mint: picked.mint, symbol: picked.symbol, icon: picked.icon });
          set({ launch: { state: 'picked', bornAt: picked.bornAt } });
          void testNow();
        });
      } else void testNow();
      return;
    }
    const next = proposal(ask, (seedCounter += 1));
    set({ open: true, ask, face: 'ask', budget: null, proposal: next, picture: null, drawing: true });
    void paint(next).then((picture) => {
      if (get().proposal === next) set({ picture, drawing: false });
    });
  },
  showAgent: () => set({ open: true, ask: { kind: 'trade', said: '', perDaySol: null }, face: 'agent', budget: useMandate.getState().budget, proposal: null, picture: null }),
  close: () => set({ open: false }),
  setBudget: (budget) => {
    set({ budget });
    useMandate.getState().setBudget(budget);
  },
  another: async () => {
    const ask = get().ask;
    if (!ask || ask.kind !== 'launch' || get().drawing) return;
    // The person's own words stay; only what the agent filled in changes.
    const next = proposal(ask, (seedCounter += 1));
    set({ proposal: next, drawing: true });
    const picture = await paint(next);
    if (get().proposal === next) set({ picture, drawing: false });
  },
  setView: (policy, view) => set({ views: { ...get().views, [policy]: view } }),
  setPaper: (paper, run = null) => {
    keepPaper(paper);
    set({ paper, paperRun: run });
  },
}));

/**
 * The plan the card proposes: the one said, or the steady one. The rhythm is the person's own numbers — the day
 * over the trade (`lib/mandate/budget.ts`) — so no calm pace of the city's is put over it: «1 SOL a day» spends the day.
 */
const planNow = (): StrategyPlan => useAutopilot.getState().plan ?? STEADY;
export const planShown = planNow;
const bornNow = (): number | null => {
  const launch = useAutopilot.getState().launch;
  return launch && launch.state === 'picked' ? launch.bornAt : null;
};

/** The wallet's spendable SOL, when this wallet's holdings are read; null — not known. */
export function spendableNow(): bigint | null {
  const st = useWallet.getState();
  const owner = st.connection?.address ?? null;
  const raw = st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null;
  return typeof raw === 'string' && /^\d{1,20}$/u.test(raw) ? BigInt(raw) : null;
}

const budgetKey = (budget: AgentBudget) => `${budget.perDay}/${budget.perTrade}/${budget.days}`;

/** The run on history for the card's «Details», once per coin, plan and budget. */
export async function testNow(fetcher?: Fetcher): Promise<void> {
  const coin = useMandate.getState().coin?.mint ?? null;
  const budget = useAutopilot.getState().budget;
  if (!coin || !budget) return;
  const plan = planNow();
  const key = `${coin}:${planText(plan)}:${budgetKey(budget)}`;
  if (useAutopilot.getState().tested?.key === key) return;
  const run = await readRun({ coin, plan, budget, bornAt: bornNow() }, fetcher);
  // A run for numbers changed meanwhile is not the card's: only the run of what the card shows now is kept.
  const shown = useAutopilot.getState().budget;
  const still = useMandate.getState().coin?.mint === coin && shown !== null && budgetKey(shown) === budgetKey(budget) && planText(planNow()) === planText(plan);
  if (run && still) useAutopilot.setState({ tested: { key, run } });
}

/** «Practice first»: the agent on paper from now, on the plan, the coin and the budget the card shows. No wallet, no money. */
export function startPaper(now: number = Date.now()): Paper | null {
  const coin = useMandate.getState().coin;
  if (!coin) return null;
  const paper: Paper = { plan: planText(planNow()), coin: coin.mint, symbol: coin.symbol, startedAt: now, bornAt: bornNow() };
  useAutopilot.getState().setPaper(paper);
  return paper;
}

/** The practice's run since it started, read again while the card shows it. */
export async function readPaper(fetcher?: Fetcher): Promise<void> {
  const { paper, budget } = useAutopilot.getState();
  if (!paper || !budget) return;
  const { planFrom } = await import('../../../lib/mandate/plans.ts');
  const plan = planFrom(paper.plan);
  if (!plan) return useAutopilot.getState().setPaper(null);
  const run = await readRun({ coin: paper.coin, plan, budget, since: paper.startedAt, bornAt: paper.bornAt }, fetcher);
  if (useAutopilot.getState().paper === paper) useAutopilot.setState({ paperRun: run });
}

/** Whether the deployment opens this ask: the agent's switch, and the trading or the launching it stands on. */
export function askOpen(ask: AgentAsk, launchReady: boolean = launchOpenHere(useLaunch.getState())): boolean {
  if (!AUTOPILOT_NET) return false;
  return ask.kind === 'trade' ? MANDATE_NET !== null : launchReady;
}

/**
 * «Sign once»: the mandate with the picked budget, the person's words with it into the agent's book. `exit` —
 * the ticket showed the agent's own exit (`terminal/agents/Exit.tsx`); without it the agent buys and holds.
 */
export async function signTrade(who: Readonly<{ wallet: string; owner: string }>, options: Readonly<{ exit?: boolean }> = {}): Promise<MandateRecord | null> {
  const st = useAutopilot.getState();
  if (!st.budget || st.ask?.kind !== 'trade') return null;
  useMandate.getState().setBudget(st.budget);
  const { tapEnable } = await import('../bots/mandate-sign.ts');
  // The plan said — or the practice's, when the person goes live from paper — travels with the mandate.
  const plan = planNow();
  const record = await tapEnable(who, { strategy: plan.id, plan: planText(plan), said: st.ask.said, exit: options.exit === true });
  if (record) useAutopilot.getState().setPaper(null);
  return record;
}

/** «Stop»: one more signature; the rest back to her wallet. */
export async function stopTrade(who: Readonly<{ wallet: string; owner: string }>, record: MandateRecord): Promise<void> {
  const { tapStop } = await import('../bots/mandate-sign.ts');
  await tapStop(who, record);
}

/** «Launch»: the sheet filled with the agent's proposal, opened on its review — the person's wallet signs there. */
export function launchProposal(): boolean {
  const st = useAutopilot.getState();
  if (!st.proposal || !st.picture) return false;
  const launch = useLaunch.getState();
  const underWay = launch.phase !== null && launch.phase.step !== 'done' && launch.phase.step !== 'failed';
  launch.openSheet();
  if (underWay) {
    useAutopilot.getState().close();
    return true;
  }
  const fields = { name: st.proposal.name, symbol: st.proposal.symbol, picture: st.picture };
  useLaunch.getState().setDraft(fields);
  // A sentence that asked for a pool turns the pool's door on with the time and the pair it said.
  const said = st.ask?.kind === 'launch' ? st.ask.said : '';
  usePool.getState().setChoice(poolDoorHere() && poolAskOf(said, new Date()).asked ? poolChoiceOf(said, new Date()) : null);
  // The review hands the fields to the engine's store and simulates the launch itself.
  useLaunch.getState().setStep('review');
  useAutopilot.getState().close();
  return true;
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __autopilot: useAutopilot, __autopilotMandate: useMandate, __autopilotWallet: useWallet, __autopilotMine: useMine });
