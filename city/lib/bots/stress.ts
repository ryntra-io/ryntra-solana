import { KIND_FACTS } from './kinds.ts';
import type { BotDraft } from './draft.ts';
import { straightBars } from './path.ts';
import { simulate } from './sim.ts';

/**
 * Before a start, in dollars: what the bot and plain holding would be worth if the price went straight to a few
 * places from here, and what a live start would cost. Paper figures, the same rules as the simulation.
 */

export const STRESS_MOVES = [-30, -15, 15, 30] as const;

export type StressRow = Readonly<{ movePct: number; botUsd: number; holdUsd: number }>;

export function stressTest(draft: BotDraft, price: number, moves: readonly number[] = STRESS_MOVES, start = 0): StressRow[] {
  if (!(price > 0)) return [];
  return moves.map((movePct) => {
    const run = simulate(draft, straightBars(price, price * (1 + movePct / 100), start));
    return { movePct, botUsd: run?.endUsd ?? draft.amountUsd, holdUsd: run?.holdUsd ?? draft.amountUsd * (1 + movePct / 100) };
  });
}

/**
 * Estimates of a live start, in SOL: a network fee for each signature (base and priority together, rounded up) and,
 * for a pool position, the rent the chain holds while it is open and gives back when it closes. Never a fee of
 * Ryntra's: a swap's own fee is shown on the swap before its signature.
 */
export const SIGNATURE_SOL = 0.0001;
export const POSITION_RENT_SOL = 0.06;

export type Preflight = Readonly<{
  /** Signatures to start; reminders ask one per trade instead. */
  startSignatures: number;
  /** Signatures per trade the person answers (reminders, signals); 0 where orders fill on their own. */
  perTrade: number;
  networkSol: number;
  /** Held while open, back on close. */
  depositSol: number;
}>;

export function preflight(draft: BotDraft): Preflight {
  const facts = KIND_FACTS[draft.kind];
  const startSignatures = facts.startSignatures;
  const perTrade = facts.drive === 'chain' ? 0 : 1;
  const depositSol = facts.custody === 'position' ? POSITION_RENT_SOL : 0;
  return { startSignatures, perTrade, networkSol: startSignatures * SIGNATURE_SOL, depositSol };
}
