/**
 * What every duel of the Ring shares (CITY-51, decision 72): two seats, rounds played at once. In a round both agents
 * move without seeing the other's move; the harness fixes both, then the round resolves and both moves — with each
 * agent's line of thought — become visible together. So nobody moves first, nobody answers a move it has seen, and the
 * thoughts are shown only after both moves are fixed.
 *
 *   input of a round = { round, moves: [move | null, move | null], faults: [fault | null, fault | null] }
 *
 * A seat's move is `null` exactly when it has a fault: it did not answer in time, answered something that is not a
 * move, or its own key was spent or switched off. A fault loses the match; two faults in one round are a draw. A
 * failure that is nobody's — the network, the provider, our own gateway — is not a fault: the harness stops and the
 * match is void, to be played again (`harness.ts`).
 *
 * Pure: no store, no clock, no network.
 */

import { isRecord } from "../judge/hash.ts";
import { MoveRejected } from "../judge/replay.ts";

export type Seat = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1];

/** Why a seat has no move this round. All of them lose the match. */
export const FAULTS = ["timeout", "malformed", "illegal", "spent", "key_off"] as const;
export type Fault = (typeof FAULTS)[number];
export const isFault = (value: unknown): value is Fault => typeof value === "string" && (FAULTS as readonly string[]).includes(value);

export type Pair<T> = [T, T];

export type RoundInput<M> = { round: number; moves: Pair<M | null>; faults: Pair<Fault | null> };

/** The longest line of thought a move keeps, in code points: shown after the round, never to the other agent. */
export const THOUGHT_MAX = 600;

/** How a match ended: `winner` is the seat, or `null` for a draw. */
export type Ending = { winner: Seat | null; reason: string };

/**
 * Reads a round's input as the engine takes it: the next round, both moves checked by `move`, a fault exactly where a
 * move is missing. Throws `MoveRejected` otherwise.
 */
export function readRound<M>(input: unknown, expected: number, move: (raw: unknown, seat: Seat) => M): RoundInput<M> {
  if (!isRecord(input) || Object.keys(input).sort().join(",") !== "faults,moves,round") throw new MoveRejected("a round is { round, moves, faults }");
  if (input.round !== expected) throw new MoveRejected(`round ${expected} is next`);
  const { moves, faults } = input;
  if (!Array.isArray(moves) || moves.length !== 2 || !Array.isArray(faults) || faults.length !== 2) throw new MoveRejected("two moves and two faults");
  const out: RoundInput<M> = { round: expected, moves: [null, null], faults: [null, null] };
  for (const seat of SEATS) {
    const fault = faults[seat];
    if (fault === null) {
      if (moves[seat] === null) throw new MoveRejected(`seat ${seat} has neither a move nor a fault`);
      out.moves[seat] = move(moves[seat], seat);
    } else {
      if (!isFault(fault)) throw new MoveRejected(`seat ${seat}: unknown fault`);
      if (moves[seat] !== null) throw new MoveRejected(`seat ${seat} has a move and a fault`);
      out.faults[seat] = fault;
    }
  }
  return out;
}

/** The ending a round's faults make: one fault loses, two draw; `null` when both moved. */
export function faultEnding(faults: Pair<Fault | null>): Ending | null {
  if (faults[0] && faults[1]) return { winner: null, reason: "double_fault" };
  if (faults[0]) return { winner: 1, reason: "fault" };
  if (faults[1]) return { winner: 0, reason: "fault" };
  return null;
}

/** Text as a move keeps it: NFC, no control characters but line breaks, at most `max` code points. `null` when not text. */
export function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​‎‏‪-‮⁦-⁩﻿]/g, "")
    .trim();
  return [...clean].length <= max ? clean : null;
}

/** A thought as kept: the same text rules, cut (not refused) to `THOUGHT_MAX` — a long thought is not a bad move. */
export function thought(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = text(raw.slice(0, THOUGHT_MAX * 4), Number.MAX_SAFE_INTEGER) ?? "";
  return [...clean].slice(0, THOUGHT_MAX).join("");
}

/** A move's thought as the engine checks it: text within the bound. */
export function checkThought(raw: unknown, seat: Seat): string {
  if (raw === undefined) return "";
  const value = text(raw, THOUGHT_MAX);
  if (value === null || value !== raw) throw new MoveRejected(`seat ${seat}: thought is kept text of at most ${THOUGHT_MAX}`);
  return value;
}
