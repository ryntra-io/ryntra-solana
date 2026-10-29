/**
 * A tiny deterministic game — the judge's demo, its tests and a worked example of `ReplayGame`: two seats take turns adding
 * 1 … `maxAdd` to a running total; whoever brings it to `target` wins. Seat 0 moves first.
 *
 *   config  = { target, maxAdd }
 *   input   = { seat, add }
 *   derived = { total, turn }
 *   result  = { winner, total }
 */

import { MoveRejected, type ReplayGame } from "./replay.ts";

type State = { target: number; maxAdd: number; total: number; turn: number; winner: number | null };

const whole = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

export const race: ReplayGame<State> = {
  id: "race",
  version: "1",
  start(config) {
    const { target, maxAdd } = (config ?? {}) as Record<string, unknown>;
    if (!whole(target, 2, 1_000) || !whole(maxAdd, 1, 10)) throw new MoveRejected("config needs target 2-1000 and maxAdd 1-10");
    return { target, maxAdd, total: 0, turn: 0, winner: null };
  },
  step(state, input) {
    if (state.winner !== null) throw new MoveRejected("the match is over");
    const { seat, add } = (input ?? {}) as Record<string, unknown>;
    if (seat !== state.turn) throw new MoveRejected(`seat ${state.turn} moves now`);
    if (!whole(add, 1, Math.min(state.maxAdd, state.target - state.total))) throw new MoveRejected("add is out of range");
    const total = state.total + add;
    return { ...state, total, turn: 1 - state.turn, winner: total === state.target ? state.turn : null };
  },
  derive: (state) => ({ total: state.total, turn: state.turn }),
  result: (state) => (state.winner === null ? null : { winner: state.winner, total: state.total }),
};
