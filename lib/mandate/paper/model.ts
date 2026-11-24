/**
 * The agent's week on paper: «Practice first» is the agent itself, trading
 * on paper for a week at live prices, by the very rules and the very budget the agent with money keeps — not a run of
 * the rules over candles. Then, or any time before, «Start with money»: the same plan, one signature of the budget.
 *
 * What is the paper agent and what is not:
 * - its rules are the mandate's own, imported, never copied: the rhythm and the day's cap (`../strategy.ts` `decide`),
 *   its own pause (`autostop`), the plan's rule and exit (`../plans.ts` `ruleOf`, `exitOf`), the price marks of a dip or
 *   a grid (`../tick.server.ts` `withMark`); its pass runs on a cron, as the agent's does;
 * - its prices are the live route's: what the budget's SOL buys of the coin now, and what the coins it holds fetch back
 *   now, both Jupiter's quotes — no trade is placed, nothing is signed, no wallet is read;
 * - its result is honest, after every fee: Ryntra's fee on each buy at the table's rate for the pair (`../fee.ts`),
 *   the fee of selling back, the network's fee of each trade as the run on history counts it (`../backtest.ts`
 *   `RUN_COSTS`) — and beside it plain holding of the same coin (`../net.ts` `netOf`, the figure the agent's own card
 *   shows); nothing is forecast, nothing is promised;
 * - paper and money never mix: the paper agent lives in its own store (`private.agent_paper_weeks`), its trades carry
 *   `paper: true` and no signature, and no line of the mandate's book, the signer or the chain ever reads them.
 *
 * Pure and client-safe: the screen, the route, the cron and the tests share these shapes and figures.
 */

import { agentFeeRaw } from "../fee-rates.ts";
import { budgetFund, budgetIssue, type AgentBudget } from "../budget.ts";
import { RUN_COSTS } from "../backtest.ts";
import { netOf, type AgentNet } from "../net.ts";
import { planFrom, type Mark } from "../plans.ts";
import type { AgentTrade, PauseReason } from "../strategy.ts";

/** A paper agent's week: seven days from its start, or the person's term when it is shorter. */
export const PAPER_DAYS = 7;
export const DAY_MS = 86_400_000;

/** The network's fee of one paper trade, lamports: what the run on history counts for a trade (`RUN_COSTS.networkSol`). */
export const PAPER_NETWORK_LAMPORTS = BigInt(Math.round(RUN_COSTS.networkSol * 1e9));

/** The trades a paper agent keeps, newest last. A week of the busiest rhythm (24 a day) fits. */
export const PAPER_TRADES_KEPT = 200;

/**
 * Where a paper agent stands:
 * - `working` — trading on paper; `paused` — it paused itself, as the agent does (`pausedBy`);
 * - `done` — its week is over or its budget spent: the result stays, «Start with money» stays;
 * - `ended` — the person ended it; `live` — she started with money from it (the paper stays exactly as it was).
 */
export const PAPER_STATUSES = ["working", "paused", "done", "ended", "live"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

/** Why its week ended: the seven days, or the budget spent. */
export type PaperDoneBy = "week" | "spent";

/** One paper trade: the mandate's trade row (so the same rules read it), marked paper, with no signature, and the fee it paid. */
export type PaperTrade = AgentTrade & Readonly<{ paper: true; signature: null; feeRaw: string }>;

/**
 * One paper sale of a bot's own rule, as the agent with money makes it (`../bots.server.ts`): a grid's level
 * one step up, or everything once a signal turned. What it sold, what the route's quote fetched for exactly those coins
 * less Ryntra's fee at the pair's rate (`gotRaw`, what would reach her wallet), the cost those coins carried, the fee.
 * No signature: nothing is sold.
 */
export type PaperSale = Readonly<{ at: number; why: "grid" | "signal"; status: "ok"; level?: number; soldRaw: string; gotRaw: string; costRaw: string; feeRaw: string; paper: true; signature: null }>;

export type PaperNetwork = "mainnet";

export type PaperAgent = Readonly<{
  /** The store's key: sha256 of the key the person's browser holds, hex. */
  id: string;
  kind: "paper";
  network: PaperNetwork;
  /** The plan as text (`../plans.ts` `planText`) and the coin, exactly what «Start with money» signs. */
  plan: string;
  coin: string;
  symbol: string | null;
  /** The person's budget, lamports and whole days — the same numbers the signature would carry. */
  perDayRaw: string;
  perTradeRaw: string;
  days: number;
  startedAt: number;
  endsAt: number;
  /** An early plan's launch, ms. */
  bornAt: number | null;
  /** The coins a trade of the budget bought at the start: the unit a dip's or a grid's price is read in. */
  unitRaw: string;
  status: PaperStatus;
  pausedBy?: PauseReason;
  doneBy?: PaperDoneBy;
  trades: readonly PaperTrade[];
  /** The paper sales of a bot's own rule, newest last; absent — none (every paper week of before). */
  sales?: readonly PaperSale[];
  marks?: readonly Mark[];
  anchor?: number;
  unreadSince?: number;
  /** Every coin it bought, quoted back into SOL at the last pass (before Ryntra's fee), lamports, and when. */
  worthRaw: string | null;
  worthAt: number | null;
  /** Ryntra's fee on selling the coin back, basis points, as the table named it at the last buy; null — not read. */
  exitBps: number | null;
  /** When she started with money from it. */
  liveAt?: number;
  updatedAt: number;
}>;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const RAW = /^\d{1,30}$/u;
const ID = /^[0-9a-f]{64}$/u;
const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/u;

export const isPaperId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
export const isMint = (value: unknown): value is string => typeof value === "string" && MINT.test(value);

/** A coin's ticker as the screen may show it; null for anything else. */
export function symbolOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return SYMBOL.test(text) ? text : null;
}

/** The paper agent's budget, as the mandate's rules read it. */
export const budgetOf = (agent: Pick<PaperAgent, "perDayRaw" | "perTradeRaw" | "days">): AgentBudget => ({ perDay: BigInt(agent.perDayRaw), perTrade: BigInt(agent.perTradeRaw), days: agent.days });

/** When a week started at `startedAt` ends: seven days, or the person's term when it is shorter. */
export const weekEnd = (startedAt: number, days: number): number => startedAt + Math.min(PAPER_DAYS, Math.max(1, days)) * DAY_MS;

/** Who the paper agent still trades for: at work, or paused only because it could not read — that lifts once it reads. */
export const paperAtWork = (agent: Pick<PaperAgent, "status" | "pausedBy">): boolean => agent.status === "working" || (agent.status === "paused" && agent.pausedBy === "unread");

/** Whether «Start with money» is still the paper agent's to offer: anything but a paper she ended or already took live. */
export const canGoLive = (agent: Pick<PaperAgent, "status">): boolean => agent.status !== "ended" && agent.status !== "live";

/** The paper trades that happened. */
const done = (agent: Pick<PaperAgent, "trades">) => agent.trades.filter((trade) => trade.status === "ok");

/** What the paper buys spent, lamports — Ryntra's fee inside. */
export const spentOf = (agent: Pick<PaperAgent, "trades">): bigint => done(agent).reduce((sum, trade) => sum + BigInt(trade.spentRaw), 0n);

/** The coins the paper buys hold, base units — less what its paper sales sold. */
export const heldOf = (agent: Pick<PaperAgent, "trades" | "sales">): bigint => {
  const held = done(agent).reduce((sum, trade) => sum + BigInt(trade.receivedRaw ?? "0"), 0n) - soldOf(agent);
  return held > 0n ? held : 0n;
};

/** The coins the paper sales sold, base units. */
export const soldOf = (agent: Pick<PaperAgent, "sales">): bigint => (agent.sales ?? []).reduce((sum, sale) => sum + BigInt(sale.soldRaw), 0n);

/** What the paper sales would have brought to her wallet, lamports — Ryntra's fee already off. */
export const gotOf = (agent: Pick<PaperAgent, "sales">): bigint => (agent.sales ?? []).reduce((sum, sale) => sum + BigInt(sale.gotRaw), 0n);

/** What the coins it still holds cost — what the buys spent, less the cost the paper sales carried out. */
export const costOf = (agent: Pick<PaperAgent, "trades" | "sales">): bigint => {
  const cost = spentOf(agent) - (agent.sales ?? []).reduce((sum, sale) => sum + BigInt(sale.costRaw), 0n);
  return cost > 0n ? cost : 0n;
};

/** What of the budget's vault is left on paper: the vault the signature would fill, less what the paper buys spent. */
export const leftOf = (agent: PaperAgent): bigint => budgetFund(budgetOf(agent)) - spentOf(agent);

/** Ryntra's fees the paper buys paid, lamports. */
export const buyFeesOf = (agent: Pick<PaperAgent, "trades">): bigint => done(agent).reduce((sum, trade) => sum + BigInt(trade.feeRaw), 0n);

/** The network's fees of the paper trades — and of its paper sales — lamports. */
export const networkOf = (agent: Pick<PaperAgent, "trades" | "sales">): bigint => PAPER_NETWORK_LAMPORTS * BigInt(done(agent).length + (agent.sales?.length ?? 0));

/** A paper buy: the trade cap, Ryntra's fee at the pair's rate taken from it, and the coins the rest bought at the route's quote. */
export function paperBuy(input: Readonly<{ at: number; amount: bigint; feeBps: number; coins: bigint; level?: number }>): PaperTrade {
  return {
    at: input.at,
    status: "ok",
    signature: null,
    spentRaw: input.amount.toString(),
    receivedRaw: input.coins.toString(),
    reason: null,
    paper: true,
    feeRaw: agentFeeRaw(input.amount, input.feeBps).toString(),
    ...(input.level === undefined ? {} : { level: input.level }),
  };
}

/** The amount of a buy the route is asked for: the trade cap less Ryntra's fee, as Jupiter's program takes it from the input. */
export const routedOf = (amount: bigint, feeBps: number): bigint => amount - agentFeeRaw(amount, feeBps);

/* ---------------------------------------------------------------- the honest result */

/**
 * The paper agent's result after every fee, and plain holding beside it — the agent's own figure (`../net.ts` `netOf`):
 * what the coins fetch back now less the fee of selling them, less what the buys spent (their fee inside), less the
 * network's fee of every paper trade. Plain holding: the same SOL into the same coin at once, at the first buy's price,
 * sold back now with the same fee. A figure not read is null, never zero.
 */
export function paperNet(agent: PaperAgent): AgentNet {
  /* What its paper sales brought counts as her sales through the agent count. */
  const sold = agent.sales?.length ? { gotRaw: gotOf(agent).toString() } : {};
  return netOf({ trades: agent.trades, heldRaw: heldOf(agent).toString(), worthRaw: agent.worthRaw, exitBps: agent.exitBps, networkRaw: networkOf(agent).toString(), ...sold });
}

/** The day of its week it is on, 1 to 7; the last day once the week is over. */
export function dayOfWeek(agent: Pick<PaperAgent, "startedAt" | "endsAt">, now: number): number {
  const days = Math.max(1, Math.round((agent.endsAt - agent.startedAt) / DAY_MS));
  return Math.min(days, Math.max(1, Math.floor((now - agent.startedAt) / DAY_MS) + 1));
}

/** The paper agent as the screen reads it: public figures of a paper run only, never the key. */
export type PaperView = Readonly<{
  paper: true;
  status: PaperStatus;
  pausedBy: PauseReason | null;
  doneBy: PaperDoneBy | null;
  plan: string;
  coin: string;
  symbol: string | null;
  perDayRaw: string;
  perTradeRaw: string;
  days: number;
  startedAt: number;
  endsAt: number;
  bornAt: number | null;
  day: number;
  weekDays: number;
  trades: number;
  spentRaw: string;
  heldRaw: string;
  worthRaw: string | null;
  worthAt: number | null;
  /** Ryntra's fees on the buys, and the network's, lamports. */
  buyFeesRaw: string;
  networkRaw: string;
  net: AgentNet;
  /** The last paper buys, newest last. */
  last: readonly Readonly<{ at: number; spentRaw: string; receivedRaw: string | null }>[];
  liveAt: number | null;
  updatedAt: number;
  /** The paper sales of a bot's own rule, and what they would have brought her, lamports; absent — none. */
  sells?: number;
  gotRaw?: string;
}>;

export function viewOf(agent: PaperAgent, now: number): PaperView {
  return {
    paper: true,
    status: agent.status,
    pausedBy: agent.pausedBy ?? null,
    doneBy: agent.doneBy ?? null,
    plan: agent.plan,
    coin: agent.coin,
    symbol: agent.symbol,
    perDayRaw: agent.perDayRaw,
    perTradeRaw: agent.perTradeRaw,
    days: agent.days,
    startedAt: agent.startedAt,
    endsAt: agent.endsAt,
    bornAt: agent.bornAt,
    day: dayOfWeek(agent, now),
    weekDays: Math.max(1, Math.round((agent.endsAt - agent.startedAt) / DAY_MS)),
    trades: done(agent).length,
    spentRaw: spentOf(agent).toString(),
    heldRaw: heldOf(agent).toString(),
    worthRaw: agent.worthRaw,
    worthAt: agent.worthAt,
    buyFeesRaw: buyFeesOf(agent).toString(),
    networkRaw: networkOf(agent).toString(),
    net: paperNet(agent),
    last: done(agent)
      .slice(-5)
      .map((trade) => ({ at: trade.at, spentRaw: trade.spentRaw, receivedRaw: trade.receivedRaw })),
    liveAt: agent.liveAt ?? null,
    updatedAt: agent.updatedAt,
    ...(agent.sales?.length ? { sells: agent.sales.length, gotRaw: gotOf(agent).toString() } : {}),
  };
}

/* ---------------------------------------------------------------- reading a stored agent back */

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const raw = (value: unknown): value is string => typeof value === "string" && RAW.test(value);
const PAUSES: readonly PauseReason[] = ["failing", "loss", "losses", "short", "unread", "take", "stop", "late", "market", "balance", "mismatch"];

function tradeOf(value: unknown): PaperTrade | null {
  if (!isRecord(value) || value.paper !== true || value.signature !== null || !finite(value.at) || !raw(value.spentRaw) || !raw(value.feeRaw)) return null;
  if (value.status !== "ok" && value.status !== "failed") return null;
  if (value.receivedRaw !== null && !raw(value.receivedRaw)) return null;
  const level = value.level === undefined ? {} : Number.isInteger(value.level) && (value.level as number) >= 0 && (value.level as number) < 32 ? { level: value.level as number } : null;
  if (level === null) return null;
  return {
    at: value.at,
    status: value.status,
    signature: null,
    spentRaw: value.spentRaw,
    receivedRaw: value.receivedRaw as string | null,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 160) : null,
    paper: true,
    feeRaw: value.feeRaw,
    ...level,
  };
}

/** A paper sale as the store kept it; null for anything else. */
function saleOf(value: unknown): PaperSale | null {
  if (!isRecord(value) || value.paper !== true || value.signature !== null || value.status !== "ok" || !finite(value.at)) return null;
  if ((value.why !== "grid" && value.why !== "signal") || !raw(value.soldRaw) || !raw(value.gotRaw) || !raw(value.costRaw) || !raw(value.feeRaw)) return null;
  const level = value.level === undefined ? {} : Number.isInteger(value.level) && (value.level as number) >= 0 && (value.level as number) < 32 ? { level: value.level as number } : null;
  if (level === null) return null;
  return { at: value.at, why: value.why, status: "ok", soldRaw: value.soldRaw, gotRaw: value.gotRaw, costRaw: value.costRaw, feeRaw: value.feeRaw, paper: true, signature: null, ...level };
}

function marksOf(value: unknown): readonly Mark[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return null;
  const marks = value.filter((mark): mark is Mark => isRecord(mark) && finite(mark.at) && finite(mark.price) && mark.price > 0);
  return marks.length === value.length ? marks : null;
}

/**
 * A paper agent from what the store kept; null for anything that is not exactly one. The store's answer is checked as
 * any outside input: a row that does not read is no agent, and nothing is traded for it.
 */
export function paperAgentOf(value: unknown): PaperAgent | null {
  if (!isRecord(value) || value.kind !== "paper" || value.network !== "mainnet" || !isPaperId(value.id)) return null;
  if (typeof value.plan !== "string" || !planFrom(value.plan) || !isMint(value.coin)) return null;
  if (!raw(value.perDayRaw) || !raw(value.perTradeRaw) || !Number.isInteger(value.days) || !raw(value.unitRaw)) return null;
  const budget = { perDay: BigInt(value.perDayRaw), perTrade: BigInt(value.perTradeRaw), days: value.days as number };
  if (budgetIssue(budget) !== null) return null;
  if (!finite(value.startedAt) || !finite(value.endsAt) || value.endsAt <= value.startedAt || !finite(value.updatedAt)) return null;
  if (!(PAPER_STATUSES as readonly unknown[]).includes(value.status)) return null;
  if (!Array.isArray(value.trades) || value.trades.length > PAPER_TRADES_KEPT) return null;
  const trades = value.trades.map(tradeOf);
  if (trades.some((trade) => trade === null)) return null;
  const marks = marksOf(value.marks);
  if (marks === null) return null;
  /* The paper sales, when it has any; one that does not read makes no agent. */
  if (value.sales !== undefined && (!Array.isArray(value.sales) || value.sales.length > PAPER_TRADES_KEPT)) return null;
  const sales = Array.isArray(value.sales) ? value.sales.map(saleOf) : [];
  if (sales.some((sale) => sale === null)) return null;
  if (value.worthRaw !== null && !raw(value.worthRaw)) return null;
  const pausedBy = PAUSES.includes(value.pausedBy as PauseReason) ? { pausedBy: value.pausedBy as PauseReason } : {};
  const doneBy = value.doneBy === "week" || value.doneBy === "spent" ? { doneBy: value.doneBy as PaperDoneBy } : {};
  return {
    id: value.id,
    kind: "paper",
    network: "mainnet",
    plan: value.plan,
    coin: value.coin,
    symbol: symbolOf(value.symbol),
    perDayRaw: value.perDayRaw,
    perTradeRaw: value.perTradeRaw,
    days: value.days as number,
    startedAt: value.startedAt,
    endsAt: value.endsAt,
    bornAt: finite(value.bornAt) ? value.bornAt : null,
    unitRaw: value.unitRaw,
    status: value.status as PaperStatus,
    ...pausedBy,
    ...doneBy,
    trades: trades as PaperTrade[],
    ...(sales.length ? { sales: sales as PaperSale[] } : {}),
    ...(marks.length ? { marks } : {}),
    ...(finite(value.anchor) && value.anchor > 0 ? { anchor: value.anchor } : {}),
    ...(finite(value.unreadSince) ? { unreadSince: value.unreadSince } : {}),
    worthRaw: value.worthRaw as string | null,
    worthAt: finite(value.worthAt) ? value.worthAt : null,
    exitBps: Number.isInteger(value.exitBps) && (value.exitBps as number) >= 0 && (value.exitBps as number) < 10_000 ? (value.exitBps as number) : null,
    ...(finite(value.liveAt) ? { liveAt: value.liveAt } : {}),
    updatedAt: value.updatedAt,
  };
}
