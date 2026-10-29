import { defineMatch, DiceError, type EndReason, type MatchResult, type MatchSetup } from "./match";
import type { MatchConfig } from "./schema";

/**
 * Single-elimination brackets for dice tournaments, and per-match records for a rating system (CITY-69). Entrants come
 * in seed order (index 0 is the top seed); byes go to the top seeds; one owner's agents never share a bracket. Money
 * brackets draw their order from MagicBlock VRF (CITY-52); this file only keeps the seeding it is handed.
 */

export interface Entrant {
  id: string;
  /** Agents of one owner never share a bracket. */
  owner?: string;
}

export type Slot = { kind: "agent"; id: string } | { kind: "bye" } | { kind: "pending" };

export interface BracketMatch {
  id: string;
  /** 1 is the first round; the last round is the final. */
  round: number;
  /** Position within the round, from 0. */
  index: number;
  slots: [Slot, Slot];
  /** waiting: a slot is still open; ready: two agents must play; done: decided. */
  status: "waiting" | "ready" | "done";
  winner: string | null;
  /** Decided without a game: a bye, or an opponent eliminated by a double forfeit. */
  walkover: boolean;
  result: MatchResult | null;
}

export interface Bracket {
  id: string;
  /** Slots in the first round: the entrant count rounded up to a power of two. */
  size: number;
  rounds: number;
  entrants: Entrant[];
  matches: BracketMatch[];
}

const BRACKET_ID = /^[A-Za-z0-9._-]{1,96}$/;

/** Standard seeding: seed 1 meets the lowest seed, and the top two can only meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function createBracket(id: string, entrants: readonly Entrant[]): Bracket {
  if (!BRACKET_ID.test(id)) throw new DiceError("bracket id must be 1-96 characters of A-Z a-z 0-9 . _ -");
  if (entrants.length < 2) throw new DiceError("a bracket needs at least two entrants");
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const e of entrants) {
    if (ids.has(e.id)) throw new DiceError(`entrant ${e.id} appears twice`);
    ids.add(e.id);
    if (e.owner === undefined) continue;
    if (owners.has(e.owner)) throw new DiceError(`owner ${e.owner} has more than one agent in the bracket`);
    owners.add(e.owner);
  }

  const size = 2 ** Math.ceil(Math.log2(entrants.length));
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const slotFor = (seed: number): Slot => {
    const entrant = entrants[seed - 1];
    return entrant ? { kind: "agent", id: entrant.id } : { kind: "bye" };
  };
  const matches: BracketMatch[] = [];
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let index = 0; index < count; index++) {
      const slots: [Slot, Slot] =
        round === 1 ? [slotFor(order[2 * index] ?? 0), slotFor(order[2 * index + 1] ?? 0)] : [{ kind: "pending" }, { kind: "pending" }];
      matches.push({ id: `${id}:r${round}:m${index}`, round, index, slots, status: "waiting", winner: null, walkover: false, result: null });
    }
  }
  const bracket: Bracket = { id, size, rounds, entrants: entrants.map((e) => ({ ...e })), matches };
  settle(bracket);
  return bracket;
}

/** Matches that two agents must play now. */
export function readyMatches(bracket: Bracket): BracketMatch[] {
  return bracket.matches.filter((m) => m.status === "ready");
}

/** The two agents of a ready match, in seat order. */
export function pairing(match: BracketMatch): [string, string] {
  const [a, b] = match.slots;
  if (a.kind !== "agent" || b.kind !== "agent") throw new DiceError(`match ${match.id} has no two agents`);
  return [a.id, b.id];
}

/** Duel config for a ready bracket match. */
export function matchConfigFor(match: BracketMatch, setup: Omit<MatchSetup, "matchId" | "players">): MatchConfig {
  return defineMatch({ ...setup, matchId: match.id, players: pairing(match) });
}

/** Records a duel result and advances the bracket. Returns a new bracket. */
export function recordResult(bracket: Bracket, result: MatchResult): Bracket {
  const next = structuredClone(bracket);
  const match = next.matches.find((m) => m.id === result.matchId);
  if (!match) throw new DiceError(`no match ${result.matchId} in bracket ${bracket.id}`);
  if (match.status !== "ready") throw new DiceError(`match ${match.id} is ${match.status}, not ready`);
  const [a, b] = pairing(match);
  if (result.players[0] !== a || result.players[1] !== b) {
    throw new DiceError(`match ${match.id} is ${a} vs ${b}, the result is for ${result.players[0]} vs ${result.players[1]}`);
  }
  // The winner is one of the two players, at the seat the result names; no winning seat, no winner id.
  const winnerId = result.winner === 0 ? a : result.winner === 1 ? b : result.winner === null ? null : undefined;
  if (winnerId === undefined || result.winnerId !== winnerId) {
    throw new DiceError(`match ${match.id}: the winner must be ${a} at seat 0, ${b} at seat 1 or nobody`);
  }
  // A void match (the beacon never came) decides nothing: it is played again, not recorded as a double forfeit.
  if (result.reason === "beacon_timeout") throw new DiceError(`match ${match.id} was void: play it again`);
  match.status = "done";
  match.winner = result.winnerId;
  match.result = structuredClone(result);
  settle(next);
  return next;
}

export function isFinished(bracket: Bracket): boolean {
  return bracket.matches.at(-1)?.status === "done";
}

/** The tournament winner; null while the final is open or when it ended without a winner. */
export function champion(bracket: Bracket): string | null {
  const final = bracket.matches.at(-1);
  return final?.status === "done" ? final.winner : null;
}

/** Resolves byes and moves winners on. Matches are stored in round order, so one pass is enough. */
function settle(bracket: Bracket): void {
  for (const match of bracket.matches) {
    if (match.status !== "done") {
      const [a, b] = match.slots;
      if (a.kind === "pending" || b.kind === "pending") {
        match.status = "waiting";
        continue;
      }
      if (a.kind === "agent" && b.kind === "agent") {
        match.status = "ready";
        continue;
      }
      match.status = "done";
      match.walkover = true;
      match.winner = a.kind === "agent" ? a.id : b.kind === "agent" ? b.id : null;
    }
    if (match.round === bracket.rounds) continue;
    const parent = bracket.matches.find((m) => m.round === match.round + 1 && m.index === Math.floor(match.index / 2));
    if (!parent) throw new DiceError(`match ${match.id} has no next match`);
    parent.slots[match.index % 2] = match.winner === null ? { kind: "bye" } : { kind: "agent", id: match.winner };
  }
}

export interface RatingRecord {
  ruleset: string;
  matchId: string;
  /** When the match ended, ms. */
  at: number;
  players: [string, string];
  /** Score per seat as rating systems expect: 1 for a win, 0 for a loss. */
  scores: [number, number];
  /** False when nobody won (both missed a deadline): such a game should not move ratings. */
  rated: boolean;
  reason: EndReason;
  rounds: number;
  /** Dice left per seat, for margin statistics. */
  dice: [number, number];
}

export function ratingRecord(result: MatchResult): RatingRecord {
  return {
    ruleset: result.ruleset,
    matchId: result.matchId,
    at: result.endedAt,
    players: [result.players[0], result.players[1]],
    scores: result.winner === null ? [0, 0] : result.winner === 0 ? [1, 0] : [0, 1],
    rated: result.winner !== null,
    reason: result.reason,
    rounds: result.rounds,
    dice: [result.dice[0], result.dice[1]],
  };
}

/** Records of every match played in a bracket, oldest first. Walkovers are not games. */
export function ratingRecords(bracket: Bracket): RatingRecord[] {
  return bracket.matches
    .flatMap((m) => (m.result ? [ratingRecord(m.result)] : []))
    .sort((x, y) => x.at - y.at || (x.matchId < y.matchId ? -1 : x.matchId > y.matchId ? 1 : 0));
}
