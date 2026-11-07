/**
 * Who may meet whom, how many games make a series, and what a finished duel does to the ratings (CITY-51, decision 72).
 *
 * - Two agents meet only in one weight class: a cheap model never meets one that costs fifty times more.
 * - Agents of one owner never play each other: nobody farms a rating — or, later, a prize — against themselves.
 * - Both must be on, and their brains able to play the format (`FORMAT_NEEDS` of `agent.ts`).
 * - A series swaps the sides each game; a Market Replay series is the best of three stretches, a Duo Crack series two
 *   games, one on each side. A duel for nothing is one game.
 * - Elo moves per format, through `applyResult` of `rating.ts`. A void duel and a practice against the house move
 *   nothing.
 *
 * Pure: no store, no clock, no network.
 */

import type { Money } from "../judge/rules.ts";
import type { RingFormat, Weight } from "../contract.ts";
import { applyResult, type RatingRecord } from "../rating.ts";
import type { DuelFormat } from "./harness.ts";
import type { Pair, Seat } from "./rounds.ts";

/** What pairing reads of an agent. */
export type Contender = { id: string; owner: string; status: "active" | "off"; weight: Weight; formats: readonly RingFormat[] };

export type PairRefusal = "SAME_AGENT" | "SAME_OWNER" | "WEIGHT" | "FORMAT" | "OFF";

/** Why these two may not meet in this format, or `null` when they may. */
export function pairRefusal(a: Contender, b: Contender, format: DuelFormat): PairRefusal | null {
  if (a.id === b.id) return "SAME_AGENT";
  if (a.owner === b.owner) return "SAME_OWNER";
  if (a.status !== "active" || b.status !== "active") return "OFF";
  if (a.weight !== b.weight) return "WEIGHT";
  if (!a.formats.includes(format) || !b.formats.includes(format)) return "FORMAT";
  return null;
}

export type SeriesPlan = { games: number; needed: number };

/** How many games a series of this format plays for this money, and how many wins take it. */
export function seriesPlan(format: DuelFormat, money: Money): SeriesPlan {
  if (money === "none") return { games: 1, needed: 1 };
  return format === "market-replay" ? { games: 3, needed: 2 } : { games: 2, needed: 2 };
}

/** The seats of game `g` (from 0): agent A sits at seat 0 in even games and at seat 1 in odd ones. */
export const seatsOf = <T>(pair: Pair<T>, game: number): Pair<T> => (game % 2 === 0 ? [pair[0], pair[1]] : [pair[1], pair[0]]);

/** A game's winner as one of the pair (0 — A, 1 — B), from the seat that won it. */
export const sideOf = (game: number, winner: Seat | null): 0 | 1 | null => (winner === null ? null : ((game % 2 === 0 ? winner : 1 - winner) as 0 | 1));

export type SeriesState = { wins: Pair<number>; draws: number; played: number; winner: 0 | 1 | null; over: boolean };

/**
 * The series after these games (each a side 0 or 1, `null` a draw). It is over once a side has `needed` wins, once the
 * other cannot catch up, or once every game is played; then the side with more wins takes it, equal — a draw.
 */
export function seriesState(plan: SeriesPlan, results: readonly (0 | 1 | null)[]): SeriesState {
  const wins: Pair<number> = [0, 0];
  let draws = 0;
  for (const side of results) {
    if (side === null) draws += 1;
    else wins[side] += 1;
  }
  const played = results.length;
  const left = plan.games - played;
  const decided = wins[0] >= plan.needed || wins[1] >= plan.needed || wins[0] + left < wins[1] || wins[1] + left < wins[0];
  const over = played >= plan.games || (decided && wins[0] !== wins[1]);
  const winner = over && wins[0] !== wins[1] ? (wins[0] > wins[1] ? 0 : 1) : null;
  return { wins, draws, played, winner, over };
}

/** Both rows after one rated game between them: 1 a win, 0.5 a draw, 0 a loss — each against the other's rating before. */
export function rateGame(rows: Pair<RatingRecord>, winner: Seat | null): Pair<RatingRecord> {
  const score = (seat: Seat): 0 | 0.5 | 1 => (winner === null ? 0.5 : winner === seat ? 1 : 0);
  return [applyResult(rows[0], rows[1].rating, score(0)), applyResult(rows[1], rows[0].rating, score(1))];
}
