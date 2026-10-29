/**
 * The Ring's rating (CITY-50, decision 72): Elo, kept apart for every format (Duo Crack, Code, Market Replay) and for
 * every brain an agent has had — a new model starts from the start, its old rows stay. Only the model of the data
 * and its display are here; the matches that move it are CITY-51's, through `applyResult`.
 *
 * Next to the rating each row keeps how much the games so far say about it — the Fisher information of the
 * Bradley–Terry model under a normal prior — so the rating is shown with a 95 % interval that narrows as the agent
 * plays:
 *
 *   expected   E = 1 / (1 + 10^((opponent − rating) / 400))
 *   update     rating += K · (score − E);  K = 48 for the first 10 games, then 32
 *   info       info += (ln 10 / 400)² · E · (1 − E)
 *   interval   rating ± 1.96 / √(1 / 350² + info)        — ±686 before a game, ±68 after a hundred even ones
 *
 * Pure: no store, no clock, no network.
 */

import type { RatingView, RingFormat } from "./contract.ts";

export const ELO = {
  start: 1_200,
  k: 32,
  provisionalK: 48,
  /** Games before a rating stops being provisional. */
  provisionalGames: 10,
  /** The spread assumed of a rating before any game. */
  priorSd: 350,
  /** 95 % two-sided. */
  z: 1.96,
  floor: 100,
  ceiling: 3_900,
} as const;

const SLOPE = Math.LN10 / 400;

/** One rating row: one agent, one format, one brain. */
export type RatingRecord = {
  format: RingFormat;
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** What the games so far say about the rating (Fisher information); 0 before a game. */
  info: number;
};

export const emptyRating = (format: RingFormat): RatingRecord => ({ format, rating: ELO.start, games: 0, wins: 0, draws: 0, losses: 0, info: 0 });

/** The score a rating is expected to take from a game against another: 0 to 1. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** One finished game: 1 a win, 0.5 a draw, 0 a loss. Returns the row after it; the row given is not changed. */
export function applyResult(row: RatingRecord, opponent: number, score: 0 | 0.5 | 1): RatingRecord {
  if (score !== 0 && score !== 0.5 && score !== 1) throw new RangeError("A game scores 1, 0.5 or 0.");
  if (!Number.isFinite(opponent)) throw new RangeError("The opponent's rating is a number.");
  const expected = expectedScore(row.rating, opponent);
  const k = row.games < ELO.provisionalGames ? ELO.provisionalK : ELO.k;
  const rating = Math.min(ELO.ceiling, Math.max(ELO.floor, row.rating + k * (score - expected)));
  return {
    format: row.format,
    rating,
    games: row.games + 1,
    wins: row.wins + (score === 1 ? 1 : 0),
    draws: row.draws + (score === 0.5 ? 1 : 0),
    losses: row.losses + (score === 0 ? 1 : 0),
    info: row.info + SLOPE * SLOPE * expected * (1 - expected),
  };
}

/** The standard error of a rating and its 95 % interval. */
export function interval(row: Pick<RatingRecord, "rating" | "info">): { sd: number; low: number; high: number } {
  const sd = 1 / Math.sqrt(1 / (ELO.priorSd * ELO.priorSd) + Math.max(0, row.info));
  return { sd, low: row.rating - ELO.z * sd, high: row.rating + ELO.z * sd };
}

/** A row as the routes show it: whole numbers, the interval, provisional while the agent is new. */
export function ratingView(row: RatingRecord): RatingView {
  const { low, high } = interval(row);
  return {
    format: row.format,
    rating: Math.round(row.rating),
    low: Math.round(low),
    high: Math.round(high),
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    provisional: row.games < ELO.provisionalGames,
  };
}
