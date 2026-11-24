/**
 * The Scout's desk — the one record a pass reads and writes: the paper positions open and closed, the plans it issued,
 * each coin's latest check, when each coin was last paid for (a chain read, a model call) and what the last pass did.
 * Plain JSON, versioned for compare-and-set in the store every instance shares.
 *
 * Pure and client-safe.
 */

import type { ScoutCheck } from "./journal.ts";
import { resultOf, type PaperPosition } from "./paper.ts";
import type { ScoutPlan } from "./plan.ts";
import { dayOf, type RiskState } from "./risk.ts";

export type PassStats = Readonly<{
  at: number;
  /** Coins the feed carried. */
  seen: number;
  /** Passed the free screen. */
  screened: number;
  /** Read on the chain this pass. */
  chained: number;
  /** Asked of the model this pass. */
  asked: number;
  took: number;
  closed: number;
  /** Why a stage could not run: the feed, the chain reads or the model, each said once. */
  missing: readonly ("feed" | "chain" | "model" | "prices")[];
}>;

export type ScoutDesk = Readonly<{
  version: number;
  key: string;
  open: readonly PaperPosition[];
  /** The newest first. */
  closed: readonly PaperPosition[];
  /** The plans issued, the newest first: the money side's queue once it is connected. */
  plans: readonly ScoutPlan[];
  checks: Readonly<Record<string, ScoutCheck>>;
  /** When each coin was last read on the chain or asked of the model. */
  paid: Readonly<Record<string, number>>;
  pass: PassStats | null;
}>;

export const PLANS_KEPT = 30;
/** A coin read on the chain or asked of the model is not paid for again within this span unless its numbers changed stage. */
export const REASK_MS = 30 * 60_000;

export function emptyDesk(key: string): ScoutDesk {
  return { version: 0, key, open: [], closed: [], plans: [], checks: {}, paid: {}, pass: null };
}

/** A stored value as a desk, or an empty one for anything that is not. */
export function deskOf(raw: unknown, key: string): ScoutDesk {
  if (!raw || typeof raw !== "object") return emptyDesk(key);
  const r = raw as Partial<ScoutDesk>;
  if (!Number.isInteger(r.version) || !Array.isArray(r.open) || !Array.isArray(r.closed)) return emptyDesk(key);
  return {
    version: r.version as number,
    key,
    open: r.open,
    closed: r.closed,
    plans: Array.isArray(r.plans) ? r.plans : [],
    checks: r.checks && typeof r.checks === "object" ? r.checks : {},
    paid: r.paid && typeof r.paid === "object" ? r.paid : {},
    pass: r.pass ?? null,
  };
}

/** The risk engine's view of the desk at `now`: what is open, what closed, what the day spent and what it made or lost. */
export function riskStateOf(desk: Pick<ScoutDesk, "open" | "closed">, now: number): RiskState {
  const today = dayOf(now);
  const all = [...desk.open, ...desk.closed];
  const ofToday = all.filter((position) => dayOf(position.openedAt) === today);
  return {
    open: desk.open.map((position) => ({ mint: position.mint, openedAt: position.openedAt })),
    closed: desk.closed.filter((position) => position.closedAt !== null).map((position) => ({ mint: position.mint, closedAt: position.closedAt as number })),
    daySpentLamports: ofToday.reduce((total, position) => total + BigInt(position.spentLamports), 0n),
    dayResultLamports: ofToday.reduce((total, position) => total + resultOf(position).resultLamports, 0n),
  };
}
