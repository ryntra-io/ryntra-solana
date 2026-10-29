/**
 * The match log and its replay (CITY-68; ideas of RXN `duel-engine/src/replay.ts`). A log holds the inputs of a match —
 * moves, beacon rounds, ticks, whatever the game takes — and, after each, what the engine derived from it. Anyone with
 * the game's code replays the inputs and compares: the first entry where the engine derives something else, or an
 * input it would not accept, is the divergence. Only the inputs are taken as given; every derived value and the result
 * are computed again.
 *
 *   MatchLog = { format: "ryntra-ring-log/1", matchId, game: { id, version }, config,
 *                entries: [{ seq, at, input, derived }], result }
 *
 * `logHash` is SHA-256 of the log's canonical JSON — the value a Solana memo carries (`memo.ts`). Nothing here writes
 * to a chain.
 *
 * Pure: no store, no clock, no network.
 */

import { canonicalJson, firstDifference, hashOf, isRecord } from "./hash.ts";

export const LOG_FORMAT = "ryntra-ring-log/1";

/** What a game's result must say: the winning seat, or `null` for a draw. Anything else it adds is compared too. */
export type GameResult = { winner: number | null } & Record<string, unknown>;

/**
 * A deterministic game the judge can replay. `start` and `step` throw `MoveRejected` for a config or an input the rules
 * do not allow at that place; any other throw is a bug in the game and is not caught here. `step` may return the same
 * object it was given (mutated) or a new one.
 */
export type ReplayGame<S = unknown> = Readonly<{
  id: string;
  version: string;
  start(config: unknown, matchId: string): S;
  step(state: S, input: unknown, at: number): S;
  /** What the log records after an entry: JSON only, the same for the same state. */
  derive(state: S): unknown;
  /** `null` while the match is not decided. */
  result(state: S): GameResult | null;
}>;

export class MoveRejected extends Error {
  override name = "MoveRejected";
}

export type LogEntry = { seq: number; at: number; input: unknown; derived: unknown };

export type MatchLog = {
  format: typeof LOG_FORMAT;
  matchId: string;
  game: { id: string; version: string };
  config: unknown;
  entries: LogEntry[];
  result: GameResult | null;
};

/** The input of a match as the harness records it, before anything is derived. */
export type Input = { at: number; input: unknown };

/** Writes the log of these inputs as the engine derives it. Throws `MoveRejected` at the first input it refuses. */
export function recordLog<S>(game: ReplayGame<S>, matchId: string, config: unknown, inputs: readonly Input[]): MatchLog {
  let state = game.start(config, matchId);
  const entries: LogEntry[] = [];
  for (const [seq, { at, input }] of inputs.entries()) {
    state = game.step(state, input, at);
    entries.push({ seq, at, input, derived: game.derive(state) });
  }
  return { format: LOG_FORMAT, matchId, game: { id: game.id, version: game.version }, config, entries, result: game.result(state) };
}

/** SHA-256 of the log's canonical JSON. */
export const logHash = (log: MatchLog): string => hashOf(log);

export type Divergence = {
  /** The first entry that differs; `log` for a malformed log or the wrong game; `result` for a wrong result or claim. */
  index: number | "log" | "result";
  /** Where inside the entry or result, e.g. `derived.total`; empty for the whole value. */
  path: string;
  /** What the engine derives. */
  expected: unknown;
  /** What the log or the claim says. */
  found: unknown;
  message: string;
};

export type Verification =
  | { ok: true; result: GameResult | null; steps: number }
  | { ok: false; divergence: Divergence };

/**
 * Replays a log and checks it entry by entry; with `claimed`, also checks a claimed result against the derived one.
 * A log that stops before the match is decided verifies with `result: null` — undecided, never a win.
 */
export function verifyLog<S>(game: ReplayGame<S>, log: unknown, claimed?: unknown): Verification {
  const shape = shapeOf(log);
  if (shape) return fail("log", shape.path, undefined, shape.found, shape.message);
  const recorded = log as MatchLog;
  if (recorded.game.id !== game.id || recorded.game.version !== game.version) {
    return fail("log", "game", { id: game.id, version: game.version }, recorded.game, "the log was written by another game or version");
  }

  let state: S;
  try {
    state = game.start(recorded.config, recorded.matchId);
  } catch (error) {
    if (!(error instanceof MoveRejected)) throw error;
    return fail("log", "config", undefined, recorded.config, `config rejected: ${error.message}`);
  }

  let lastAt = -1;
  for (const [index, entry] of recorded.entries.entries()) {
    if (entry.seq !== index) return fail(index, "seq", index, entry.seq, `entry ${index} is out of order`);
    if (entry.at < lastAt) return fail(index, "at", `≥ ${lastAt}`, entry.at, `entry ${index} goes back in time`);
    lastAt = entry.at;
    try {
      state = game.step(state, entry.input, entry.at);
    } catch (error) {
      if (!(error instanceof MoveRejected)) throw error;
      return fail(index, "input", undefined, entry.input, `input rejected: ${error.message}`);
    }
    const diff = firstDifference(json(game.derive(state)), entry.derived, "derived");
    if (diff) return fail(index, diff.path, diff.expected, diff.found, `entry ${index} differs at ${diff.path}`);
  }

  const result = game.result(state);
  const diff = firstDifference(json(result), recorded.result);
  if (diff) return fail("result", diff.path, diff.expected, diff.found, `the log's result differs at ${diff.path || "the root"}`);
  if (claimed !== undefined) {
    const claim = firstDifference(json(result), claimed);
    if (claim) return fail("result", claim.path, claim.expected, claim.found, `the claimed result differs at ${claim.path || "the root"}`);
  }
  return { ok: true, result, steps: recorded.entries.length };
}

/** A value as it reads back from its canonical JSON: what the log can hold. */
const json = (value: unknown): unknown => JSON.parse(canonicalJson(value ?? null));

function shapeOf(log: unknown): { path: string; found: unknown; message: string } | null {
  if (!isRecord(log)) return { path: "", found: log, message: "the log is not an object" };
  const keys = Object.keys(log).sort().join(",");
  if (keys !== "config,entries,format,game,matchId,result") return { path: "", found: keys, message: "the log has other fields than its format" };
  if (log.format !== LOG_FORMAT) return { path: "format", found: log.format, message: `expected ${LOG_FORMAT}` };
  if (typeof log.matchId !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(log.matchId)) {
    return { path: "matchId", found: log.matchId, message: "expected 1-64 characters of A-Z a-z 0-9 . _ : -" };
  }
  if (!isRecord(log.game) || typeof log.game.id !== "string" || typeof log.game.version !== "string") {
    return { path: "game", found: log.game, message: "expected { id, version }" };
  }
  if (!Array.isArray(log.entries)) return { path: "entries", found: log.entries, message: "expected an array" };
  for (const [i, entry] of log.entries.entries()) {
    if (!isRecord(entry) || Object.keys(entry).sort().join(",") !== "at,derived,input,seq") {
      return { path: `entries[${i}]`, found: entry, message: "expected { seq, at, input, derived }" };
    }
    if (!Number.isSafeInteger(entry.seq) || !Number.isSafeInteger(entry.at) || (entry.at as number) < 0) {
      return { path: `entries[${i}]`, found: entry, message: "seq and at must be whole numbers" };
    }
  }
  if (log.result !== null && !(isRecord(log.result) && (log.result.winner === null || Number.isSafeInteger(log.result.winner)))) {
    return { path: "result", found: log.result, message: "expected null or { winner }" };
  }
  return null;
}

function fail(index: Divergence["index"], path: string, expected: unknown, found: unknown, message: string): Verification {
  return { ok: false, divergence: { index, path, expected, found, message } };
}
