import { z } from "zod";

import { canonicalJson, sha256Hex } from "./hash";
import { DiceError, DiceMatch, isInput, type LogEntry, type MatchLog, type MatchResult, type Showdown } from "./match";
import { MatchLogSchema } from "./schema";

/**
 * Replay and verification of a match log (CITY-69). Only the inputs (moves, beacon rounds, ticks) are taken as given:
 * every roll, showdown and the result are derived again and compared with what the log and the claim say. Anyone can
 * run it on a finished log, and no derived entry or claim is taken on the host's word.
 *
 * The inputs are: the host records which moves arrived and when, and agents do not sign them yet; the beacon round is
 * checked for `randomness = sha256(signature)`, not for its BLS signature. A replay therefore shows that the result
 * follows from the log, not that the log is what happened; `diceReceipt` states both limits.
 */

export interface RoundRoll {
  round: number;
  opener: Showdown["opener"];
  hands: [number[], number[]];
}

export interface Replay {
  /** Null when the log stops before the match is decided. */
  result: MatchResult | null;
  /** Every roll, re-derived from the seeds and the beacon round. */
  rolls: RoundRoll[];
  /** The log as the engine writes it for these inputs. */
  log: MatchLog;
}

/** Re-runs the inputs of a log. Throws DiceError when an input is not acceptable at its place. */
export function replay(log: MatchLog): Replay {
  const match = new DiceMatch(log.config);
  for (const entry of log.entries) if (isInput(entry)) match.apply(entry);
  const recomputed = match.log();
  const rolls: RoundRoll[] = [];
  for (const entry of recomputed.entries) {
    if (entry.type === "round") rolls.push({ round: entry.round, opener: entry.opener, hands: entry.hands });
  }
  return { result: match.result, rolls, log: recomputed };
}

export interface Divergence {
  /** Index of the first log entry that differs; 'log' for a malformed log; 'result' for a wrong claim. */
  index: number | "log" | "result";
  /** Path inside the entry or result, e.g. `hands[1][3]`; empty for the whole value. */
  path: string;
  /** What the engine derives. */
  expected: unknown;
  /** What the log or the claim says. */
  found: unknown;
  message: string;
}

export type Verification = { ok: true; result: MatchResult } | { ok: false; divergence: Divergence };

/** Checks a log and a claimed result against a fresh replay; reports the first divergence. */
export function verify(log: unknown, claimedResult: unknown): Verification {
  const shape = MatchLogSchema.safeParse(log);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    return fail("log", issue ? issue.path.join(".") : "", undefined, undefined, `malformed log: ${z.prettifyError(shape.error)}`);
  }
  const recorded = shape.data.entries as unknown as LogEntry[];
  const match = new DiceMatch(shape.data.config);

  let rejected: { index: number; message: string } | null = null;
  for (const [index, entry] of recorded.entries()) {
    if (!isInput(entry)) continue;
    try {
      match.apply(entry);
    } catch (error) {
      if (!(error instanceof DiceError)) throw error;
      rejected = { index, message: error.message };
      break;
    }
  }

  const derived = match.log().entries;
  const common = Math.min(derived.length, recorded.length);
  for (let i = 0; i < common; i++) {
    const diff = firstDifference(derived[i], recorded[i]);
    if (diff) return fail(i, diff.path, diff.expected, diff.found, `entry ${i} differs at ${diff.path || "the root"}`);
  }
  if (rejected) return fail(rejected.index, "", undefined, recorded[rejected.index], `input rejected: ${rejected.message}`);
  if (derived.length > recorded.length) {
    return fail(common, "", derived[common], undefined, `the log is missing entry ${common}`);
  }
  if (recorded.length > derived.length) {
    return fail(common, "", undefined, recorded[common], `entry ${common} should not exist`);
  }

  const result = match.result;
  if (!result) return fail("result", "", null, claimedResult, "the log stops before the match is decided");
  const diff = firstDifference(result, claimedResult);
  if (diff) return fail("result", diff.path, diff.expected, diff.found, `the claimed result differs at ${diff.path || "the root"}`);
  return { ok: true, result };
}

/** SHA-256 of the canonical JSON of a log: the value to anchor on-chain or sign. */
export function logDigest(log: MatchLog): string {
  return sha256Hex(canonicalJson(log));
}

export interface Difference {
  path: string;
  expected: unknown;
  found: unknown;
}

/** First place where two JSON values differ, in key order; null when they are equal. */
export function firstDifference(expected: unknown, found: unknown, path = ""): Difference | null {
  if (expected === found) return null;
  if (Array.isArray(expected) && Array.isArray(found)) {
    for (let i = 0; i < Math.max(expected.length, found.length); i++) {
      const diff = firstDifference(expected[i], found[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isPlainObject(expected) && isPlainObject(found)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(found)])].sort();
    for (const key of keys) {
      const diff = firstDifference(expected[key], found[key], path ? `${path}.${key}` : key);
      if (diff) return diff;
    }
    return null;
  }
  return { path, expected, found };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(index: Divergence["index"], path: string, expected: unknown, found: unknown, message: string): Verification {
  return { ok: false, divergence: { index, path, expected, found, message } };
}
