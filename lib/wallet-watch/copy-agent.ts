/**
 * «Повторюй за гаманцем»: a person pastes a wallet's address and her agent
 * repeats its buys and sales on a share of her own budget. The pure half: the agent's terms, the rules a copy keeps on
 * top of the paper copy of SOL-R3 (`./paper.ts`), and the month's fees said before she starts.
 *
 * The terms are the mandate's own numbers — so much a day, a trade a share of the day, so many days (`../mandate/budget.ts`
 * `budgetIssue`, any sums she writes, no ceiling of Ryntra's). The rules the agent keeps, each a line of `fillCopy`:
 * - **the leader's exit never becomes the copy's entry** — a buy the copy has not filled yet is never filled once the
 *   leader has sold that coin after it; a sale of a coin the copy does not hold does nothing;
 * - **the copy's price stays near the leader's** — a buy whose price now (with the copy's own impact on the pool) is more
 *   than the bound above the leader's own fill is not made: a copy that late and that dear is not a copy. A sale is never
 *   held back by the bound: the leader is out, the copy goes out too;
 * - **the day's cap and the term** — a buy over what is left of the day, or after the term, is not made; sales go on.
 *
 * Paper here and in the cron: nothing here builds, signs or sends a transaction.
 *
 * Pure and client-safe: no clock unless given, no network.
 */

import { budgetIssue, LAMPORTS_PER_SOL, type AgentBudget, type BudgetIssue } from "../mandate/budget.ts";
import { COPY_ASSUMPTIONS, COPY_SLIPPAGES, ryntraFeeBps } from "./reality.ts";
import type { WalletTrade } from "./trades.ts";

export const DAY_S = 86_400;

/** A trade's share of the day's budget, percent: the copy buys this much of her day on each of the leader's buys. */
export const COPY_SHARES = [10, 25, 50, 100] as const;
export type CopyShare = (typeof COPY_SHARES)[number];
export const COPY_SHARE_DEFAULT: CopyShare = 25;

/** The terms she picks from, days. */
export const COPY_TERMS = [7, 30, 90] as const;
export const COPY_TERM_DEFAULT = 7;

/** How far above the leader's own price the copy still buys, percent — the tolerance the paper copy already keeps. */
export const COPY_BOUNDS = COPY_SLIPPAGES;
export const COPY_BOUND_DEFAULT = 5;

/** The day's budget the form starts at, SOL — her own number from then on. */
export const COPY_DAY_DEFAULT = 1;

/** Why a buy of the leader's was not repeated, beyond the paper copy's own reasons (`./paper.ts`). */
export const AGENT_MISSES = ["exited", "drift", "budget", "ended"] as const;
export type AgentMiss = (typeof AGENT_MISSES)[number];

/** The agent's terms as a copy keeps them: lamports and whole days as the signature would carry them, and the day so far. */
export type CopyTerms = Readonly<{
  perDayRaw: string;
  perTradeRaw: string;
  days: number;
  sharePct: number;
  /** ISO: buys stop then; the copy's sales go on. */
  endsAt: string;
  /** The day of the term the count below is of (0 — the first), and the SOL its buys spent. */
  dayN: number;
  daySpentSol: number;
}>;

const lamports = (sol: number): bigint => (Number.isFinite(sol) && sol > 0 ? BigInt(Math.round(sol * 1e9)) : 0n);
export const solOf = (raw: bigint | string): number => Number(BigInt(raw)) / Number(LAMPORTS_PER_SOL);

/** Her numbers as the mandate reads them: the day, a trade its share, the days. */
export function copyBudgetOf(input: Readonly<{ perDaySol: number; sharePct: number; days: number }>): AgentBudget {
  const perDay = lamports(input.perDaySol);
  return { perDay, perTrade: (perDay * BigInt(Math.round(input.sharePct))) / 100n, days: input.days };
}

/** What is wrong with her numbers, as the mandate says it; null when the agent takes them. */
export function copyBudgetIssue(input: Readonly<{ perDaySol: number; sharePct: number; days: number }>): BudgetIssue | null {
  if (!(COPY_SHARES as readonly number[]).includes(input.sharePct)) return "buys";
  return budgetIssue(copyBudgetOf(input));
}

/** The terms a copy starts with, from now. */
export function copyTermsOf(input: Readonly<{ perDaySol: number; sharePct: number; days: number }>, nowIso: string): CopyTerms {
  const budget = copyBudgetOf(input);
  return {
    perDayRaw: budget.perDay.toString(),
    perTradeRaw: budget.perTrade.toString(),
    days: budget.days,
    sharePct: input.sharePct,
    endsAt: new Date(Date.parse(nowIso) + budget.days * DAY_S * 1000).toISOString(),
    dayN: 0,
    daySpentSol: 0,
  };
}

/** The day of the term a moment falls in, counted from the copy's start: 0 — the first. */
export const termDayOf = (sinceS: number, nowS: number): number => Math.max(0, Math.floor((nowS - sinceS) / DAY_S));

/** The leader's own price of a trade, SOL a whole token; a dollar leg at SOL's price now. Null when it is not known. */
export function leaderPriceSol(trade: Pick<WalletTrade, "tokensRaw" | "decimals" | "quote" | "quoteAmount">, solUsd: number | null): number | null {
  const tokens = Number(trade.tokensRaw) / 10 ** trade.decimals;
  if (!(tokens > 0) || trade.quoteAmount === null || !(trade.quoteAmount > 0)) return null;
  if (trade.quote === "SOL") return trade.quoteAmount / tokens;
  if ((trade.quote === "USDC" || trade.quote === "USDT") && solUsd && solUsd > 0) return trade.quoteAmount / solUsd / tokens;
  return null;
}

/** Whether the leader sold the coin of a buy after it — then that buy is history, never the copy's entry. */
export function leaderLeft(ordered: readonly WalletTrade[], buy: WalletTrade): boolean {
  return ordered.some((trade) => trade.mint === buy.mint && trade.side === "sell" && trade.slot > buy.slot);
}

/** Whether a buy at `priceSol` a token is past the bound above the leader's own price. */
export function pastBound(priceSol: number, leaderSol: number | null, boundPct: number): boolean {
  return leaderSol !== null && priceSol > leaderSol * (1 + boundPct / 100) * (1 + 1e-9);
}

/* ------------------------------------------------------------- the month's fees, before she starts */

/** The network's fee of one copied trade, SOL: the base and priority fees, and the share sent again. */
export const COPY_NETWORK_SOL = (COPY_ASSUMPTIONS.networkFeeSol + COPY_ASSUMPTIONS.priorityFeeSol) * (1 + COPY_ASSUMPTIONS.failRate);

/** The least window a rate is read over: an hour — a wallet read in minutes says nothing of its day. */
const RATE_MIN_S = 3_600;

export type CopyFees = Readonly<{
  /** Ryntra's and the network's fees of a month of copying, SOL — the buys and the sales that close them. */
  sol: number;
  /** The leader's buys a day, as its read shows; the copy's — at most what her day holds. */
  leaderPerDay: number;
  copiesPerDay: number;
  /** One copied trade and its sale, SOL. */
  perCopySol: number;
  /** Ryntra's fee share the buys pay, basis points (memes and majors as the fee policy names them). */
  feeBps: number;
}>;

/**
 * The fees of a month of copying this wallet on these numbers — one line before she starts. The leader's pace is its
 * own read (the buys priced in SOL or dollars over the read's window, at most the last 30 days); the copy makes at most
 * what her day holds. Each copied buy pays Ryntra's fee on its size and the network's, and its sale the same: a
 * picture of the leader's pace, never a promise. Null when nothing of the wallet is read or her numbers are no budget.
 */
export function copyMonthFees(input: Readonly<{ trades: readonly Pick<WalletTrade, "side" | "at" | "mint" | "quote">[]; oldestAt: number | null; nowS: number; perTradeSol: number; perDaySol: number }>): CopyFees | null {
  if (!(input.perTradeSol > 0) || !(input.perDaySol >= input.perTradeSol)) return null;
  if (input.oldestAt === null && input.trades.length === 0) return null;
  const from = Math.max(input.nowS - 30 * DAY_S, input.oldestAt ?? input.nowS - 30 * DAY_S);
  const span = Math.max(RATE_MIN_S, input.nowS - from);
  const buys = input.trades.filter((trade) => trade.side === "buy" && trade.quote !== null && trade.at !== null && trade.at >= from && trade.at <= input.nowS);
  const leaderPerDay = buys.length / (span / DAY_S);
  const room = Math.max(1, Math.floor(input.perDaySol / input.perTradeSol + 1e-9));
  const copiesPerDay = Math.min(leaderPerDay, room);
  const feeBps = buys.length ? buys.reduce((sum, trade) => sum + ryntraFeeBps(trade.mint), 0) / buys.length : ryntraFeeBps("");
  const perCopySol = input.perTradeSol * (feeBps / 10_000) * 2 + COPY_NETWORK_SOL * 2;
  return { sol: 30 * copiesPerDay * perCopySol, leaderPerDay, copiesPerDay, perCopySol, feeBps };
}

/* ------------------------------------------------------------- money: behind its switch */

/** The deployment's switch of copying with money — server and screen; closed unless set to `on`. */
export const COPY_MONEY_ENV = "RYNTRA_AGENT_COPY";
export const COPY_MONEY_PUBLIC_ENV = "NEXT_PUBLIC_RYNTRA_AGENT_COPY";

/**
 * Whether the signer holds a rule for copying. It does — a copy names the coins she signs for, the leader's, at
 * most ten (`../mandate/terms.ts` `copyCoins`); its buys land in her vault's own account of one of them, its sales go
 * under a sale's policy for each five of them, each coin with its day's limit, the money only to her own account
 * (`copySalePolicyOf`, the signer's `tradeRefusal`); every swap with at most 1 % slippage.
 */
export const COPY_SIGNER_READY = true;

/**
 * Whether the start with money is wired end to end: the screen's signature, the copy into the book (`registerCopy`) and
 * the cron's pass (`runCopyMoneyPass`). It is — its door `./copy-money-door.server.ts` (routes
 * `app/api/wallet-watch/copy/money/**`), its cron `./copy-money-minute.server.ts`.
 * On the server `RYNTRA_AGENT_COPY`, on the screen `NEXT_PUBLIC_RYNTRA_AGENT_COPY`.
 */
export const COPY_START_READY = true;

/**
 * Her copy's worst day with a stolen agent key, in her day's caps at the price she signs at: the screen's one
 * line before her signature. The engine's own number is `../mandate/terms.ts` `COPY_WORST_DAYS` (a test holds them
 * equal): one day's cap of buys and two of sales together, however many coins she picks.
 */
export const COPY_WORST_DAYS = 3;

/** Whether «Start with money» may open: the switch on, the signer's rule in place and the start wired. */
export function copyMoneyOpen(value: string | undefined): boolean {
  return COPY_SIGNER_READY && COPY_START_READY && value?.trim().toLowerCase() === "on";
}
