/**
 * CITY-70 — the agent's mission as the person sees it, and its money as the chain and the book agree on it. Pure: the
 * view (`./agent-service.server.ts`) and the agent's pass (`./tick.server.ts`) read the chain and the book, ask here.
 *
 * - **A trade's state** (`tradeState`): done, refused by the chain, refused by the agent's own signer, a wait for the
 *   day's budget — or **unknown**: sent, its fate not read yet. Unknown is never «failed»: the pass reads it again by its
 *   signature before anything else is bought (`./tick.server.ts` `settled`), and only the chain's own answer settles it.
 * - **The books** (`reconcile`): the budget she moved in is what the done trades spent plus what the vault holds, to the
 *   lamport — the vault read from the chain, the trades from the book. A vault holding less than the book can explain is
 *   money that moved outside the agent's book: the agent spends nothing more on it (`mismatch`).
 * - **The mission** (`missionOf`): what the agent is doing now — working, confirming a trade, waiting for its next buy,
 *   frozen by her, paused by itself, done, or stopped.
 */

import { decide, type AgentTrade, type PauseReason } from "./strategy.ts";

export type TradeState = "ok" | "failed" | "refused" | "unknown" | "held";

/** One trade as the person may read it: an unknown one is a trade being confirmed, never a failure. */
export function tradeState(trade: Pick<AgentTrade, "status" | "unsettledRaw" | "allowance">): TradeState {
  if (trade.unsettledRaw !== undefined) return "unknown";
  if (trade.status === "ok") return "ok";
  /* The chain's own count said the day's budget is spent: a wait, never a failure. */
  if (trade.allowance) return "held";
  return trade.status;
}

/**
 * The money of one mandate: `exact` — budget = spent + left, to the lamport; `settling` — a trade being confirmed explains
 * the difference; `more` — the vault holds more than the book needs (money added, or another mandate's on the same vault);
 * `off` — the vault holds less than the book can explain; `unread` — the vault or the whole book was not read; `closed` — the
 * mandate was stopped and what was left went back to her.
 */
export type BooksState = "exact" | "settling" | "more" | "off" | "unread" | "closed";

export type Books = Readonly<{
  state: BooksState;
  /** What she moved into the vault for this mandate, lamports. */
  budgetRaw: string;
  /** What the done trades spent, lamports. */
  spentRaw: string;
  /** What the vault holds now, from the chain; null — not read. */
  leftRaw: string | null;
  /** What trades still being confirmed may have spent, lamports. */
  pendingRaw: string;
  /** `off`: what is missing; `more`: what is over; else 0. */
  gapRaw: string;
}>;

export function reconcile(input: Readonly<{ budgetRaw: bigint; leftRaw: bigint | null; trades: readonly AgentTrade[]; full?: boolean; closed?: boolean }>): Books {
  const spent = input.trades.reduce((sum, trade) => sum + (tradeState(trade) === "ok" ? BigInt(trade.spentRaw) : 0n), 0n);
  const pending = input.trades.reduce((sum, trade) => sum + (trade.unsettledRaw === undefined ? 0n : BigInt(trade.unsettledRaw)), 0n);
  const base = { budgetRaw: input.budgetRaw.toString(), spentRaw: spent.toString(), leftRaw: input.leftRaw === null ? null : input.leftRaw.toString(), pendingRaw: pending.toString() };
  if (input.closed) return { ...base, state: "closed", gapRaw: "0" };
  /* A book cut to its newest trades cannot prove the oldest ones: unread, never a mismatch it cannot see. */
  if (input.leftRaw === null || input.full) return { ...base, state: "unread", gapRaw: "0" };
  const left = input.leftRaw;
  const expected = input.budgetRaw - spent;
  if (left === expected) return { ...base, state: pending > 0n ? "settling" : "exact", gapRaw: "0" };
  if (left > expected) return { ...base, state: "more", gapRaw: (left - expected).toString() };
  if (left >= expected - pending) return { ...base, state: "settling", gapRaw: "0" };
  return { ...base, state: "off", gapRaw: (expected - pending - left).toString() };
}

export type MissionState = "working" | "confirming" | "waiting" | "frozen" | "paused" | "done" | "stopped";

export type Mission = Readonly<{
  state: MissionState;
  /** `paused`: why; `done`: `ended` or `spent`; `waiting`: `interval` or `day-spent`. */
  reason: string | null;
  /** `waiting`: when the next buy is due, ms. */
  nextAt: number | null;
}>;

export type MissionInput = Readonly<{
  status: "working" | "paused" | "stopped" | "ended" | "spent";
  pausedBy: PauseReason | null;
  frozen: boolean;
  /** Whether the policy still stands on chain; null — not read. */
  live: boolean | null;
  trades: readonly AgentTrade[];
  perTrade: bigint;
  perDay: bigint;
  /** Unix seconds. */
  expiresAt: bigint;
  pace: number | null;
  budgetLeft: bigint | null;
  now: number;
}>;

/** What the agent is doing now, as one state the city words. */
export function missionOf(input: MissionInput): Mission {
  if (input.status === "stopped" || input.live === false) return { state: "stopped", reason: null, nextAt: null };
  if (input.status === "ended" || input.status === "spent") return { state: "done", reason: input.status, nextAt: null };
  /* A trade on its way is told before anything else: it is the agent's money in motion. */
  if (input.trades.some((trade) => trade.unsettledRaw !== undefined)) return { state: "confirming", reason: null, nextAt: null };
  if (input.frozen) return { state: "frozen", reason: null, nextAt: null };
  if (input.status === "paused" && input.pausedBy !== "unread") return { state: "paused", reason: input.pausedBy, nextAt: null };
  const next = decide({ strategy: "steady", perTrade: input.perTrade, perDay: input.perDay, expiresAt: input.expiresAt, trades: input.trades, budgetLeft: input.budgetLeft, now: input.now, pace: input.pace });
  if (next.action === "end") return next.reason === "failing" ? { state: "paused", reason: "failing", nextAt: null } : { state: "done", reason: next.reason, nextAt: null };
  if (next.action === "wait") return { state: "waiting", reason: next.reason, nextAt: next.until };
  return { state: "working", reason: null, nextAt: null };
}
