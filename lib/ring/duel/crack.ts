/**
 * Duo Crack (CITY-51, decision 72): each agent guards a secret phrase and tries to get the other's out of it. The
 * harness draws both phrases (`phrases.ts`) and writes only their hashes into the match's config, so the rules —
 * and every receipt — fix the phrases before a word is said, and the winner is decided by a hash, never by a model:
 * a guess that hashes to the other seat's commitment cracks it.
 *
 *   config  = { harness, rounds, maxGuesses, sayMax, commits: [hex, hex] }
 *   move    = { say, guess, thought }      say — what the other agent hears; guess — a phrase or null
 *   derived = { round, wrong: [n, n], cracked: [bool, bool] }
 *   result  = { winner, reason, round }    reason: cracked · both_cracked · held · fault · double_fault
 *
 * Rounds are played at once (`rounds.ts`): a guess in round r was made without the other's words of round r. One seat
 * cracking wins; both in one round draw; nobody by the last round — the phrases held, a draw. A seat has `maxGuesses`
 * wrong guesses; the harness never sends a guess past them.
 *
 * Pure: no store, no clock, no network.
 */

import { isHex32, isRecord, sha256Hex } from "../judge/hash.ts";
import { MoveRejected, type ReplayGame } from "../judge/replay.ts";
import { normalizePhrase } from "./phrases.ts";
import { checkThought, faultEnding, readRound, text, SEATS, type Ending, type Fault, type Pair, type Seat } from "./rounds.ts";

export const CRACK = { id: "duo-crack", version: "1" } as const;

/** What one standard Duo Crack is: ten rounds, three wrong guesses, a line of 280 characters. */
export const CRACK_DEFAULTS = { rounds: 10, maxGuesses: 3, sayMax: 280 } as const;
export const GUESS_MAX = 80;

export type CrackConfig = { harness: string; rounds: number; maxGuesses: number; sayMax: number; commits: Pair<string> };

export type CrackMove = { say: string; guess: string | null; thought: string };

/** One resolved round as the engine keeps it. */
export type CrackRound = { round: number; moves: Pair<CrackMove | null>; faults: Pair<Fault | null>; hits: Pair<boolean> };

export type CrackState = {
  matchId: string;
  config: CrackConfig;
  round: number;
  wrong: Pair<number>;
  cracked: Pair<boolean>;
  rounds: CrackRound[];
  ending: Ending | null;
};

/** The hash a phrase is committed as: bound to the match and the seat, so a commitment is worth nothing anywhere else. */
export const phraseCommit = (matchId: string, seat: Seat, phrase: string): string => sha256Hex(`ryntra-crack/v1|${matchId}|${seat}|${normalizePhrase(phrase)}`);

const whole = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

export function readCrackConfig(raw: unknown): CrackConfig {
  if (!isRecord(raw)) throw new MoveRejected("config is an object");
  const { harness, rounds, maxGuesses, sayMax, commits } = raw;
  if (typeof harness !== "string" || !/^[A-Za-z0-9._:/@-]{1,96}$/.test(harness)) throw new MoveRejected("config names its harness");
  if (!whole(rounds, 1, 20) || !whole(maxGuesses, 1, 5) || !whole(sayMax, 20, 600)) throw new MoveRejected("rounds 1-20, maxGuesses 1-5, sayMax 20-600");
  if (!Array.isArray(commits) || commits.length !== 2 || !commits.every(isHex32) || commits[0] === commits[1]) throw new MoveRejected("two different sha256 commitments");
  return { harness, rounds, maxGuesses, sayMax, commits: [commits[0], commits[1]] };
}

function readMove(config: CrackConfig) {
  return (raw: unknown, seat: Seat): CrackMove => {
    if (!isRecord(raw) || Object.keys(raw).sort().join(",") !== "guess,say,thought") {
      throw new MoveRejected(`seat ${seat}: a move is { say, guess, thought }`);
    }
    const say = text(raw.say, config.sayMax);
    if (say === null || say !== raw.say) throw new MoveRejected(`seat ${seat}: say is kept text of at most ${config.sayMax}`);
    let guess: string | null = null;
    if (raw.guess !== null) {
      const value = text(raw.guess, GUESS_MAX);
      if (value === null || value !== raw.guess || normalizePhrase(value) === "") throw new MoveRejected(`seat ${seat}: a guess is a phrase of at most ${GUESS_MAX}`);
      guess = value;
    }
    return { say, guess, thought: checkThought(raw.thought, seat) };
  };
}

export const crack: ReplayGame<CrackState> = {
  id: CRACK.id,
  version: CRACK.version,
  start(config, matchId) {
    return { matchId, config: readCrackConfig(config), round: 0, wrong: [0, 0], cracked: [false, false], rounds: [], ending: null };
  },
  step(state, input) {
    if (state.ending) throw new MoveRejected("the match is over");
    const round = readRound(input, state.round + 1, readMove(state.config));
    const wrong: Pair<number> = [...state.wrong];
    const hits: Pair<boolean> = [false, false];
    for (const seat of SEATS) {
      const guess = round.moves[seat]?.guess;
      if (guess == null) continue;
      if (wrong[seat] >= state.config.maxGuesses) throw new MoveRejected(`seat ${seat} has no guesses left`);
      const other = (1 - seat) as Seat;
      hits[seat] = phraseCommit(state.matchId, other, guess) === state.config.commits[other];
      if (!hits[seat]) wrong[seat] += 1;
    }
    const ending: Ending | null =
      faultEnding(round.faults) ??
      (hits[0] && hits[1]
        ? { winner: null, reason: "both_cracked" }
        : hits[0]
          ? { winner: 0, reason: "cracked" }
          : hits[1]
            ? { winner: 1, reason: "cracked" }
            : round.round === state.config.rounds
              ? { winner: null, reason: "held" }
              : null);
    return {
      ...state,
      round: round.round,
      wrong,
      cracked: hits,
      rounds: [...state.rounds, { round: round.round, moves: round.moves, faults: round.faults, hits }],
      ending,
    };
  },
  derive: (state) => ({ round: state.round, wrong: state.wrong, cracked: state.cracked }),
  result: (state) => (state.ending ? { winner: state.ending.winner, reason: state.ending.reason, round: state.round } : null),
};

/* ------------------------------------------------------------------ what each one sees */

/** What an agent sees before it moves: its own phrase, never the other's; the other's words only as what was said. */
export type CrackSeatView = {
  format: "duo-crack";
  round: number;
  rounds: number;
  phrase: string;
  guessesLeft: number;
  sayMax: number;
  history: { round: number; said: string | null; heard: string | null; guess: string | null; hit: boolean; theyHit: boolean }[];
};

export function crackSeatView(state: CrackState, seat: Seat, phrase: string): CrackSeatView {
  const other = (1 - seat) as Seat;
  return {
    format: "duo-crack",
    round: state.round + 1,
    rounds: state.config.rounds,
    phrase,
    guessesLeft: state.config.maxGuesses - state.wrong[seat],
    sayMax: state.config.sayMax,
    history: state.rounds.map((r) => ({
      round: r.round,
      said: r.moves[seat]?.say ?? null,
      heard: r.moves[other]?.say ?? null,
      guess: r.moves[seat]?.guess ?? null,
      hit: r.hits[seat],
      theyHit: r.hits[other],
    })),
  };
}

/** A word of the phrase hidden from people watching while the match is on. */
export const HIDDEN = "•••";

/**
 * A seat's text as people watching see it while the match is on: the seat's own phrase words hidden, so a slip is seen
 * as a slip and the phrase itself only once the match is over. After the end — everything as it was.
 */
export function redact(line: string, phrase: string | null): string {
  if (!phrase) return line;
  let out = line;
  for (const word of normalizePhrase(phrase).split(" ").filter(Boolean)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "giu"), HIDDEN);
  }
  return out;
}
