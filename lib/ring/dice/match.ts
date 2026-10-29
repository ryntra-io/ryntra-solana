import { z } from "zod";

import { checkBeaconRound, latestRound, roundTime, type BeaconInfo, type BeaconRound } from "./beacon";
import { combineSeeds, commitmentFor, drawOpener, rollHands } from "./randomness";
import {
  RULES,
  SEATS,
  checkBid,
  nextBid,
  other,
  settleChallenge,
  type Bid,
  type BidProblem,
  type Seat,
} from "./rules";
import {
  LOG_FORMAT,
  MatchConfigSchema,
  MatchEventSchema,
  MoveCall,
  type Limits,
  type MatchConfig,
  type ToolName,
} from "./schema";

/**
 * A Liar's Dice match between two agents as a deterministic state machine (CITY-69).
 *
 *   commit -> reveal -> beacon -> play -> finished
 *
 * Inputs are agent moves, beacon rounds and clock ticks, each stamped with a time. The machine appends every input
 * and everything it derives (beacon round, rolls, showdowns, the result) to one log, so the same inputs always produce
 * the same log.
 *
 * Agent mistakes never throw: an illegal move, a missed deadline or a seed that does not match its commitment ends the
 * match with a recorded fault. Host mistakes (bad config, events out of order, a beacon value that does not check out)
 * throw DiceError and leave the state untouched. A beacon round that does not arrive by its deadline voids the match:
 * nobody wins and nobody is at fault.
 *
 * No text an agent writes reaches the log or a result: a move is kept as its parsed tool call without the free `id`
 * (or as null when it does not parse), and every fault carries a code with text the engine writes itself.
 */

export type Phase = "commit" | "reveal" | "beacon" | "play" | "finished";

/** `beacon_timeout`: the beacon round never arrived; the match is void, with no winner and no faults. */
export type EndReason = "eliminated" | "illegal_move" | "timeout" | "commit_mismatch" | "beacon_timeout";

export type FaultCode =
  | "malformed"
  | "wrong_phase"
  | "not_your_turn"
  | "duplicate"
  | "no_bid"
  | BidProblem
  | "commit_mismatch"
  | "deadline";

export interface Fault {
  seat: Seat;
  reason: Exclude<EndReason, "eliminated" | "beacon_timeout">;
  code: FaultCode;
  /** Written by the engine from the code and checked numbers only; never the agent's own text. */
  detail: string;
}

export interface MatchResult {
  matchId: string;
  ruleset: typeof RULES.id;
  players: [string, string];
  /** Winning seat. Null when both agents missed the same deadline, or when the beacon never came (void). */
  winner: Seat | null;
  winnerId: string | null;
  reason: EndReason;
  /** Empty when the match ended on dice or was void. */
  faults: Fault[];
  /** Rounds settled by a challenge. */
  rounds: number;
  /** Dice left per seat. */
  dice: [number, number];
  /** Time of the deciding event; for a timeout, the missed deadline. */
  endedAt: number;
}

export interface BidEntry extends Bid {
  seat: Seat;
  at: number;
}

/** A settled round with both hands shown, as every player sees it after a challenge. */
export interface Showdown {
  round: number;
  opener: Seat;
  hands: [number[], number[]];
  bids: BidEntry[];
  challenger: Seat;
  /** Dice that showed the last bid's face. */
  actual: number;
  loser: Seat;
}

export interface MoveEvent {
  type: "move";
  seat: Seat;
  at: number;
  /** The call as the log keeps it: the parsed tool call without its `id`, or null when it is not a valid call. */
  call: unknown;
}
export interface BeaconEvent {
  type: "beacon";
  at: number;
  beacon: BeaconRound;
}
/** Lets time pass so missed deadlines expire. */
export interface TickEvent {
  type: "tick";
  at: number;
}
export type MatchEvent = MoveEvent | BeaconEvent | TickEvent;

export type DerivedEntry =
  | { type: "commits_closed"; at: number; beaconRound: number }
  | { type: "seeded"; at: number; seed: string; opener: Seat }
  | { type: "round"; at: number; round: number; opener: Seat; hands: [number[], number[]] }
  | {
      type: "showdown";
      at: number;
      round: number;
      bid: BidEntry;
      challenger: Seat;
      actual: number;
      loser: Seat;
      dice: [number, number];
    }
  | { type: "end"; at: number; result: MatchResult };

export type LogEntry = MatchEvent | DerivedEntry;

export interface MatchLog {
  format: typeof LOG_FORMAT;
  config: MatchConfig;
  entries: LogEntry[];
}

/**
 * A log entry as spectators may see it while the match runs: no seed (in a reveal or the match seed) and no hand before
 * its showdown. A showdown carries the hands it shows.
 */
export type PublicEntry =
  | Exclude<LogEntry, { type: "seeded" } | { type: "round" } | { type: "showdown" }>
  | { type: "seeded"; at: number; opener: Seat }
  | { type: "round"; at: number; round: number; opener: Seat; dice: [number, number] }
  | (Extract<DerivedEntry, { type: "showdown" }> & { hands: [number[], number[]] });

/** What one input produced. */
export interface Applied {
  /** Log entries, the input first. Secret while the match runs: reveals, the match seed and every hand. */
  secret: LogEntry[];
  /** The same entries as anyone may see them now; safe to stream to spectators. */
  public: PublicEntry[];
}

export function isInput(entry: { type: string }): entry is MatchEvent {
  return entry.type === "move" || entry.type === "beacon" || entry.type === "tick";
}

/** What everyone may see, spectators included: no dice of a round in progress. */
export interface PublicView {
  matchId: string;
  ruleset: typeof RULES.id;
  players: [string, string];
  phase: Phase;
  /** Seats the engine is waiting on. */
  pending: Seat[];
  deadline: number | null;
  /** Current round; 0 before play. */
  round: number;
  /** Dice left per seat. */
  dice: [number, number];
  /** Bids of the current round. */
  bids: BidEntry[];
  history: Showdown[];
  result: MatchResult | null;
}

/** What one agent sees: its own dice, never the opponent's, and the tools it may call now. */
export interface AgentView extends PublicView {
  you: Seat;
  tools: ToolName[];
  yourDice: number[];
  /** Lowest bid allowed now, or null when there is none. */
  minBid: Bid | null;
}

/** Raised for host mistakes. Agent mistakes never throw: they lose the match. */
export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceError";
  }
}

export const DEFAULT_LIMITS: Limits = { commitMs: 30_000, revealMs: 30_000, moveMs: 30_000, beaconMs: 30_000 };
export const DEFAULT_BEACON_DELAY_ROUNDS = 2;

export interface MatchSetup {
  matchId: string;
  players: [string, string];
  startedAt: number;
  beacon: BeaconInfo;
  limits?: Partial<Limits>;
  beaconDelayRounds?: number;
}

/** A validated match config with default limits. */
export function defineMatch(setup: MatchSetup): MatchConfig {
  const parsed = MatchConfigSchema.safeParse({
    matchId: setup.matchId,
    ruleset: RULES.id,
    players: setup.players,
    startedAt: setup.startedAt,
    limits: { ...DEFAULT_LIMITS, ...setup.limits },
    beacon: setup.beacon,
    beaconDelayRounds: setup.beaconDelayRounds ?? DEFAULT_BEACON_DELAY_ROUNDS,
  });
  if (!parsed.success) throw new DiceError(`invalid match config: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Calls bigger than this, or that do not survive a JSON round trip, are stored as null. */
const MAX_CALL_CHARS = 4096;

/**
 * The call as the log keeps it: a valid tool call with only its name and arguments, or null. Nothing free-form an agent
 * writes (an `id`, extra keys, a malformed payload) is stored, and normalizing a stored call again gives the same value.
 */
function normalizeCall(call: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(call);
  } catch {
    return null;
  }
  if (text === undefined || text.length > MAX_CALL_CHARS) return null;
  const parsed = MoveCall.safeParse(JSON.parse(text));
  if (!parsed.success) return null;
  const move = parsed.data;
  return move.name === "challenge" ? { name: move.name, arguments: {} } : { name: move.name, arguments: { ...move.arguments } };
}

/** Text of the faults that have no checked numbers to name. */
const FAULT_TEXT = {
  malformed: "the call is not a valid tool call",
  commit_mismatch: "the seed does not match the commitment",
  no_bid: "there is no bid to challenge yet",
} as const;

interface RoundState {
  round: number;
  opener: Seat;
  hands: [number[], number[]];
  bids: BidEntry[];
}

export class DiceMatch {
  readonly config: MatchConfig;
  #phase: Phase = "commit";
  #now: number;
  #deadline: number | null;
  #turn: Seat = 0;
  #commitments: [string | null, string | null] = [null, null];
  #seeds: [string | null, string | null] = [null, null];
  #beaconRound: number | null = null;
  #matchSeed: string | null = null;
  #dice: [number, number] = [RULES.dicePerPlayer, RULES.dicePerPlayer];
  #round: RoundState | null = null;
  #history: Showdown[] = [];
  #result: MatchResult | null = null;
  readonly #entries: LogEntry[] = [];

  constructor(config: MatchConfig) {
    const parsed = MatchConfigSchema.safeParse(config);
    if (!parsed.success) throw new DiceError(`invalid match config: ${z.prettifyError(parsed.error)}`);
    this.config = parsed.data;
    this.#now = this.config.startedAt;
    this.#deadline = this.config.startedAt + this.config.limits.commitMs;
  }

  get phase(): Phase {
    return this.#phase;
  }

  /** Time of the last event. */
  get now(): number {
    return this.#now;
  }

  /** An event after this time expires the phase: a missed move, or a void match while the beacon is awaited. */
  get deadline(): number | null {
    return this.#deadline;
  }

  /** The beacon round to mix in, fixed when the commitments close. */
  get beaconRound(): number | null {
    return this.#beaconRound;
  }

  get result(): MatchResult | null {
    return this.#result && structuredClone(this.#result);
  }

  /** Seats the engine is waiting on right now. */
  pending(): Seat[] {
    switch (this.#phase) {
      case "commit":
        return SEATS.filter((s) => this.#commitments[s] === null);
      case "reveal":
        return SEATS.filter((s) => this.#seeds[s] === null);
      case "play":
        return [this.#turn];
      default:
        return [];
    }
  }

  /** Tools `seat` may call right now. */
  tools(seat: Seat): ToolName[] {
    if (!this.pending().includes(seat)) return [];
    if (this.#phase === "commit") return ["commit"];
    if (this.#phase === "reveal") return ["reveal"];
    const bids = this.#round?.bids ?? [];
    const tools: ToolName[] = [];
    if (nextBid(bids.at(-1) ?? null, this.#total()) !== null) tools.push("bid");
    if (bids.length > 0) tools.push("challenge");
    return tools;
  }

  publicView(): PublicView {
    return structuredClone({
      matchId: this.config.matchId,
      ruleset: this.config.ruleset,
      players: this.config.players,
      phase: this.#phase,
      pending: this.pending(),
      deadline: this.#deadline,
      round: this.#round?.round ?? this.#history.length,
      dice: this.#dice,
      bids: this.#round?.bids ?? [],
      history: this.#history,
      result: this.#result,
    });
  }

  view(seat: Seat): AgentView {
    const live = this.#phase === "play" ? this.#round : null;
    const tools = this.tools(seat);
    return {
      ...this.publicView(),
      you: seat,
      tools,
      yourDice: live ? [...live.hands[seat]] : [],
      minBid: tools.includes("bid") ? nextBid(live?.bids.at(-1) ?? null, this.#total()) : null,
    };
  }

  /** The full log so far. During a match it holds secrets (seeds, dice): publish it only after the end. */
  log(): MatchLog {
    return structuredClone({ format: LOG_FORMAT, config: this.config, entries: this.#entries });
  }

  /**
   * Applies one input. Returns the log entries it produced, the input first, twice: `secret` as the log keeps them, and
   * `public` without seeds or hands not yet shown. Stream only `public` while the match runs.
   */
  apply(event: MatchEvent): Applied {
    if (this.#result) throw new DiceError("the match is finished");
    const parsed = MatchEventSchema.safeParse(event);
    if (!parsed.success) throw new DiceError(`invalid event: ${z.prettifyError(parsed.error)}`);
    const e = parsed.data;
    if (e.at < this.#now) throw new DiceError(`event at ${e.at} is earlier than the last event at ${this.#now}`);
    if (e.type === "beacon") {
      if (this.#phase !== "beacon" || this.#beaconRound === null) {
        throw new DiceError(`no beacon is expected in phase ${this.#phase}`);
      }
      const problem = checkBeaconRound(e.beacon, this.#beaconRound);
      if (problem) throw new DiceError(`bad beacon round: ${problem}`);
    }

    const start = this.#entries.length;
    const input: MatchEvent = e.type === "move" ? { type: "move", seat: e.seat, at: e.at, call: normalizeCall(e.call) } : e;
    this.#entries.push(input);
    this.#now = input.at;

    if (this.#deadline !== null && input.at > this.#deadline) this.#expire(this.#deadline);
    else if (input.type === "move") this.#move(input.seat, input.call, input.at);
    else if (input.type === "beacon") this.#startPlay(input.beacon, input.at);
    const secret = structuredClone(this.#entries.slice(start));
    return { secret, public: secret.map((entry) => this.#publicEntry(entry)) };
  }

  #publicEntry(entry: LogEntry): PublicEntry {
    switch (entry.type) {
      case "move": {
        const call = entry.call as { name?: unknown } | null;
        return call?.name === "reveal" ? { ...entry, call: { name: "reveal" } } : entry;
      }
      case "seeded":
        return { type: "seeded", at: entry.at, opener: entry.opener };
      case "round":
        return { type: "round", at: entry.at, round: entry.round, opener: entry.opener, dice: [entry.hands[0].length, entry.hands[1].length] };
      case "showdown": {
        const shown = this.#history.find((h) => h.round === entry.round);
        if (!shown) throw new DiceError(`round ${entry.round} has no showdown`);
        return { ...entry, hands: structuredClone(shown.hands) };
      }
      default:
        return entry;
    }
  }

  #total(): number {
    return this.#dice[0] + this.#dice[1];
  }

  #move(seat: Seat, call: unknown, at: number): void {
    const parsed = MoveCall.safeParse(call);
    if (!parsed.success) return this.#illegal(seat, "malformed", FAULT_TEXT.malformed, at);
    const move = parsed.data;

    if (!this.pending().includes(seat)) {
      const simultaneous = this.#phase === "commit" || this.#phase === "reveal";
      return simultaneous
        ? this.#illegal(seat, "duplicate", `already sent ${this.#phase}`, at)
        : this.#illegal(seat, "not_your_turn", `no move expected from seat ${seat}`, at);
    }

    switch (this.#phase) {
      case "commit":
        if (move.name !== "commit") return this.#illegal(seat, "wrong_phase", `expected commit, got ${move.name}`, at);
        return this.#commit(seat, move.arguments.commitment, at);
      case "reveal":
        if (move.name !== "reveal") return this.#illegal(seat, "wrong_phase", `expected reveal, got ${move.name}`, at);
        return this.#reveal(seat, move.arguments.seed, at);
      default:
        if (move.name === "bid") return this.#bid(seat, move.arguments, at);
        if (move.name === "challenge") return this.#challenge(seat, at);
        return this.#illegal(seat, "wrong_phase", `expected bid or challenge, got ${move.name}`, at);
    }
  }

  #commit(seat: Seat, commitment: string, at: number): void {
    this.#commitments[seat] = commitment;
    if (this.pending().length > 0) return;
    const beaconRound = latestRound(this.config.beacon, at) + this.config.beaconDelayRounds;
    this.#beaconRound = beaconRound;
    this.#phase = "reveal";
    this.#deadline = at + this.config.limits.revealMs;
    this.#entries.push({ type: "commits_closed", at, beaconRound });
  }

  #reveal(seat: Seat, seed: string, at: number): void {
    if (commitmentFor(this.config.matchId, seat, seed) !== this.#commitments[seat]) {
      return this.#end([{ seat, reason: "commit_mismatch", code: "commit_mismatch", detail: FAULT_TEXT.commit_mismatch }], at);
    }
    this.#seeds[seat] = seed;
    if (this.pending().length > 0) return;
    if (this.#beaconRound === null) throw new DiceError("the beacon round is not fixed");
    this.#phase = "beacon";
    // A beacon that never comes must not hold the match open: past this deadline the match is void.
    this.#deadline = Math.max(at, roundTime(this.config.beacon, this.#beaconRound)) + this.config.limits.beaconMs;
  }

  #startPlay(beacon: BeaconRound, at: number): void {
    const [a, b] = this.#seeds;
    if (a === null || b === null) throw new DiceError("seeds are missing");
    const seed = combineSeeds(this.config.matchId, [a, b], beacon);
    const opener = drawOpener(seed);
    this.#matchSeed = seed;
    this.#phase = "play";
    this.#entries.push({ type: "seeded", at, seed, opener });
    this.#startRound(1, opener, at);
  }

  #startRound(round: number, opener: Seat, at: number): void {
    if (this.#matchSeed === null) throw new DiceError("the match seed is missing");
    const hands = rollHands(this.#matchSeed, round, this.#dice);
    this.#round = { round, opener, hands, bids: [] };
    this.#turn = opener;
    this.#deadline = at + this.config.limits.moveMs;
    this.#entries.push({ type: "round", at, round, opener, hands: [[...hands[0]], [...hands[1]]] });
  }

  #bid(seat: Seat, bid: Bid, at: number): void {
    const round = this.#round;
    if (!round) throw new DiceError("no round in play");
    const last = round.bids.at(-1) ?? null;
    const problem = checkBid(bid, last, this.#total());
    if (problem) {
      const detail =
        problem === "not_higher" && last
          ? `bid ${bid.count}x${bid.face} does not beat ${last.count}x${last.face}`
          : `bid ${bid.count}x${bid.face} is outside 1..${this.#total()} dice and faces 1..${RULES.faces}`;
      return this.#illegal(seat, problem, detail, at);
    }
    round.bids.push({ seat, count: bid.count, face: bid.face, at });
    this.#turn = other(seat);
    this.#deadline = at + this.config.limits.moveMs;
  }

  #challenge(seat: Seat, at: number): void {
    const round = this.#round;
    if (!round) throw new DiceError("no round in play");
    const last = round.bids.at(-1);
    if (!last) return this.#illegal(seat, "no_bid", FAULT_TEXT.no_bid, at);
    const { actual, loser } = settleChallenge(round.hands, last, last.seat);
    this.#dice[loser] -= 1;
    this.#history.push({ round: round.round, opener: round.opener, hands: round.hands, bids: round.bids, challenger: seat, actual, loser });
    this.#entries.push({
      type: "showdown",
      at,
      round: round.round,
      bid: { ...last },
      challenger: seat,
      actual,
      loser,
      dice: [this.#dice[0], this.#dice[1]],
    });
    this.#round = null;
    if (this.#dice[loser] === 0) return this.#finish(other(loser), "eliminated", [], at);
    this.#startRound(round.round + 1, loser, at);
  }

  #illegal(seat: Seat, code: FaultCode, detail: string, at: number): void {
    this.#end([{ seat, reason: "illegal_move", code, detail }], at);
  }

  #expire(deadline: number): void {
    // Nobody owes the beacon round: a missing one voids the match, without blaming either agent.
    if (this.#phase === "beacon") return this.#finish(null, "beacon_timeout", [], deadline);
    const what = this.#phase === "play" ? "move" : this.#phase;
    const faults = this.pending().map((seat): Fault => ({ seat, reason: "timeout", code: "deadline", detail: `no ${what} by ${deadline}` }));
    this.#end(faults, deadline);
  }

  /** Ends on faults: one faulty seat loses; two (a shared deadline missed) means nobody wins. */
  #end(faults: Fault[], at: number): void {
    const [first] = faults;
    if (!first) throw new DiceError("a forfeit needs a fault");
    this.#finish(faults.length === 1 ? other(first.seat) : null, first.reason, faults, at);
  }

  #finish(winner: Seat | null, reason: EndReason, faults: Fault[], at: number): void {
    const result: MatchResult = {
      matchId: this.config.matchId,
      ruleset: this.config.ruleset,
      players: [this.config.players[0], this.config.players[1]],
      winner,
      winnerId: winner === null ? null : this.config.players[winner],
      reason,
      faults,
      rounds: this.#history.length,
      dice: [this.#dice[0], this.#dice[1]],
      endedAt: at,
    };
    this.#result = result;
    this.#phase = "finished";
    this.#deadline = null;
    this.#entries.push({ type: "end", at, result: structuredClone(result) });
  }
}
