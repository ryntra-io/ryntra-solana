/**
 * The Scout's trade plan — what it hands to the money side, in the form the trading agent already takes: a coin, the
 * amount of one buy in lamports, the strategy and how it leaves. The amount is the risk engine's (`./risk.ts`), never the
 * model's; the exits are the same numbers the paper desk runs on (`SCOUT_EXIT`): a stop that sells, half at twice the
 * entry, a close when the volume fades and a close by time.
 *
 * Nothing here signs, sends or reads a key. With money, the person's own budget (the mandate she signs once) carries the
 * plan; until the agent can sell by itself, a plan is paper only.
 *
 * Pure and client-safe.
 */

import type { StrategyPlan } from "../mandate/plans.ts";
import type { ScoutCandidate } from "./feed.ts";
import type { SizeBound } from "./risk.ts";
import { SCOUT_EXIT, SCOUT_SCREEN } from "./rules.ts";
import type { ScoutThesis } from "./thesis.ts";

export type ScoutExitPlan = Readonly<{
  /** Sell everything this far under the entry, basis points. */
  stopBps: number;
  /** Sell half once at this multiple of the entry. */
  halfAt: number;
  /** Close when the hour's volume falls under this share of the six hours' pace, once the position is this old. */
  fadeShare: number;
  fadeAfterMs: number;
  /** Close any position this old. */
  maxHoldMs: number;
}>;

export type ScoutPlan = Readonly<{
  agent: "scout";
  coin: Readonly<{ mint: string; symbol: string }>;
  /** One buy, lamports of SOL, as the risk engine set it. */
  amountLamports: string;
  /** Which bound set the amount. */
  bound: SizeBound;
  /** The trading agent's own strategy form: a young launch, bought once; the exits below are the Scout's. */
  strategy: StrategyPlan;
  exit: ScoutExitPlan;
  /** Why: the thesis's codes, as the person reads them. */
  thesis: ScoutThesis;
  at: string;
}>;

export const SCOUT_EXIT_PLAN: ScoutExitPlan = Object.freeze({
  stopBps: SCOUT_EXIT.stopBps,
  halfAt: SCOUT_EXIT.halfAt,
  fadeShare: SCOUT_EXIT.fadeShare,
  fadeAfterMs: SCOUT_EXIT.fadeAfterMs,
  maxHoldMs: SCOUT_EXIT.maxHoldMs,
});

/** The plan of one trade the risk engine allowed. */
export function planOf(input: Readonly<{ candidate: Pick<ScoutCandidate, "mint" | "symbol">; lamports: bigint; bound: SizeBound; thesis: ScoutThesis; now: number }>): ScoutPlan {
  return {
    agent: "scout",
    coin: { mint: input.candidate.mint, symbol: input.candidate.symbol },
    amountLamports: input.lamports.toString(),
    bound: input.bound,
    strategy: { id: "early", maxAgeH: Math.ceil(SCOUT_SCREEN.maxAgeMin / 60), exit: null, pace: 1 },
    exit: SCOUT_EXIT_PLAN,
    thesis: input.thesis,
    at: new Date(input.now).toISOString(),
  };
}
