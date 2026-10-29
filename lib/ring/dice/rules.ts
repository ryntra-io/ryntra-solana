/**
 * Liar's Dice for two agents (CITY-69). Every rule the engine enforces lives in this file.
 *
 *   1. Each player starts with 5 six-sided dice. Ones are ordinary faces, not wild.
 *   2. Every round all remaining dice are rolled; a player sees only their own dice.
 *   3. The opener of round 1 is drawn from the match randomness; later rounds are opened by the loser of the previous
 *      round.
 *   4. Players alternate. On a turn a player either bids or challenges the last bid. The opener must bid: there is
 *      nothing to challenge yet.
 *   5. A bid {count, face} claims that at least `count` of all dice in play show `face`.
 *      1 <= count <= dice in play, 1 <= face <= 6.
 *   6. A bid must be higher than the last bid of the round: a higher count, or the same count with a higher face. When
 *      the last bid is {all dice, 6} the only move left is a challenge.
 *   7. A challenge ends the round. All dice are shown. If at least `count` dice show `face` the bid stands and the
 *      challenger loses a die; otherwise the bidder loses a die.
 *   8. A player with no dice left loses the match.
 */

export const RULES = {
  id: "liars-dice/1",
  players: 2,
  dicePerPlayer: 5,
  faces: 6,
  onesWild: false,
} as const;

export type Seat = 0 | 1;
export const SEATS = [0, 1] as const satisfies readonly Seat[];

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export type Bid = Readonly<{ count: number; face: number }>;

/** Total order of bids: count first, then face. Negative when `a` is lower than `b`. */
export function compareBids(a: Bid, b: Bid): number {
  return a.count - b.count || a.face - b.face;
}

export type BidProblem = "count_out_of_range" | "face_out_of_range" | "not_higher";

/** Why a bid is not allowed after `previous` with `totalDice` in play, or null when it is. */
export function checkBid(bid: Bid, previous: Bid | null, totalDice: number): BidProblem | null {
  if (!Number.isInteger(bid.count) || bid.count < 1 || bid.count > totalDice) return "count_out_of_range";
  if (!Number.isInteger(bid.face) || bid.face < 1 || bid.face > RULES.faces) return "face_out_of_range";
  if (previous && compareBids(bid, previous) <= 0) return "not_higher";
  return null;
}

/** The lowest bid allowed after `previous`, or null when only a challenge is left. */
export function nextBid(previous: Bid | null, totalDice: number): Bid | null {
  if (!previous) return totalDice > 0 ? { count: 1, face: 1 } : null;
  if (previous.face < RULES.faces) return { count: previous.count, face: previous.face + 1 };
  if (previous.count < totalDice) return { count: previous.count + 1, face: 1 };
  return null;
}

/** Number of dice across all hands that show `face`. */
export function countFace(hands: readonly (readonly number[])[], face: number): number {
  let n = 0;
  for (const hand of hands) for (const die of hand) if (die === face) n++;
  return n;
}

export type ChallengeOutcome = Readonly<{
  /** Dice that actually show the bid face. */
  actual: number;
  bidStands: boolean;
  loser: Seat;
}>;

/** Settles a challenge against `bid`, placed by `bidder`. */
export function settleChallenge(hands: readonly (readonly number[])[], bid: Bid, bidder: Seat): ChallengeOutcome {
  const actual = countFace(hands, bid.face);
  const bidStands = actual >= bid.count;
  return { actual, bidStands, loser: bidStands ? other(bidder) : bidder };
}
