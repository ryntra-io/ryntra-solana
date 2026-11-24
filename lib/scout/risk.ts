/**
 * The Scout's risk engine: whether a trade is made now and how large — code, inside the person's own budget, never the
 * model. The person's numbers (a day's budget, a trade's limit) are theirs, whatever they are; the engine only keeps
 * every trade inside them and inside what the market can take:
 *
 * - **size** — the least of the trade's limit, a share of the pool (`liquidityShareBps`) and what is left of the day;
 * - **at most `maxOpen` positions** at once, one per coin;
 * - **a pause after any close**, and a coin closed is not taken again for a while;
 * - **the day's loss** reaching a share of the day's budget pauses the rest of the day;
 * - a trade too small for its fees is not made; a pool or a price not read is no trade.
 *
 * Pure and client-safe: the same engine sizes the shared paper desk and replays it on each person's own numbers.
 */

import { SCOUT_RISK } from "./rules.ts";

export type ScoutBudget = Readonly<{ perDayLamports: bigint; perTradeLamports: bigint }>;

export type RiskState = Readonly<{
  open: readonly Readonly<{ mint: string; openedAt: number }>[];
  /** Each coin's latest close. */
  closed: readonly Readonly<{ mint: string; closedAt: number }>[];
  /** Spent on buys within the day of `now`. */
  daySpentLamports: bigint;
  /** The day's result so far — what the day's positions are worth now against what they cost; under zero is a loss. */
  dayResultLamports: bigint;
}>;

export type RiskAsk = Readonly<{
  mint: string;
  liquidityUsd: number | null;
  /** SOL's price in dollars, to put the pool's share in SOL. */
  solUsd: number | null;
  now: number;
}>;

export const RISK_CODES = ["budget_unset", "day_paused", "held", "max_open", "paused_after_close", "reentry", "day_spent", "liquidity_unread", "too_small"] as const;
export type RiskCode = (typeof RISK_CODES)[number];

/** Which bound set the size: the trade's limit, the pool's share or what was left of the day. */
export type SizeBound = "trade" | "liquidity" | "day";

export type RiskAnswer = Readonly<{ ok: true; lamports: bigint; bound: SizeBound }> | Readonly<{ ok: false; code: RiskCode }>;

export type RiskRules = typeof SCOUT_RISK;

/** The UTC day of a moment: the day a budget is counted in. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The day's loss that pauses the rest of the day, lamports. */
export const dayLossLimit = (budget: ScoutBudget, rules: Pick<RiskRules, "dayLossBps"> = SCOUT_RISK): bigint => (budget.perDayLamports * BigInt(rules.dayLossBps)) / 10_000n;

/** The pool's share a trade may take, in lamports; null — the pool or SOL's price not read. */
export function liquidityLamports(liquidityUsd: number | null, solUsd: number | null, rules: Pick<RiskRules, "liquidityShareBps"> = SCOUT_RISK): bigint | null {
  if (liquidityUsd === null || solUsd === null || !Number.isFinite(liquidityUsd) || !Number.isFinite(solUsd) || liquidityUsd <= 0 || solUsd <= 0) return null;
  const sol = (liquidityUsd * rules.liquidityShareBps) / 10_000 / solUsd;
  return BigInt(Math.floor(sol * 1e9));
}

/** Whether a trade is made now, and how large; else why not. Every rule is checked in this order, the first that holds answers. */
export function riskSize(budget: ScoutBudget, state: RiskState, ask: RiskAsk, rules: RiskRules = SCOUT_RISK): RiskAnswer {
  if (budget.perDayLamports <= 0n || budget.perTradeLamports <= 0n) return { ok: false, code: "budget_unset" };
  if (state.dayResultLamports <= -dayLossLimit(budget, rules) && state.dayResultLamports < 0n) return { ok: false, code: "day_paused" };
  if (state.open.some((slot) => slot.mint === ask.mint)) return { ok: false, code: "held" };
  if (state.open.length >= rules.maxOpen) return { ok: false, code: "max_open" };
  const lastClose = state.closed.reduce((latest, close) => Math.max(latest, close.closedAt), Number.NEGATIVE_INFINITY);
  if (ask.now - lastClose < rules.pauseAfterCloseMs) return { ok: false, code: "paused_after_close" };
  const coinClose = state.closed.filter((close) => close.mint === ask.mint).reduce((latest, close) => Math.max(latest, close.closedAt), Number.NEGATIVE_INFINITY);
  if (ask.now - coinClose < rules.reentryMs) return { ok: false, code: "reentry" };
  const left = budget.perDayLamports - state.daySpentLamports;
  if (left < rules.minTradeLamports) return { ok: false, code: "day_spent" };
  const pool = liquidityLamports(ask.liquidityUsd, ask.solUsd, rules);
  if (pool === null) return { ok: false, code: "liquidity_unread" };
  let lamports = budget.perTradeLamports;
  let bound: SizeBound = "trade";
  if (pool < lamports) {
    lamports = pool;
    bound = "liquidity";
  }
  if (left < lamports) {
    lamports = left;
    bound = "day";
  }
  if (lamports < rules.minTradeLamports) return { ok: false, code: "too_small" };
  return { ok: true, lamports, bound };
}
