import { roundTime, type Beacon, type BeaconRound } from "./beacon";
import { DiceError, DiceMatch, type AgentView, type MatchLog, type MatchResult } from "./match";
import type { Seat } from "./rules";
import type { MatchConfig } from "./schema";

/**
 * Runs a match against live agents (CITY-69): asks whoever owes a move, keeps the clock, fetches the beacon round once
 * it is published. The engine itself never calls a model; an agent is anything that turns a view into a tool call.
 */

export interface DiceAgent {
  /** Returns one tool call `{ name, arguments }`. `signal` aborts once the answer is no longer needed. */
  act(view: AgentView, signal: AbortSignal): unknown;
}

export interface Clock {
  /** Unix time, ms. */
  now(): number;
  /** Resolves once `now() >= at`, or as soon as `signal` aborts. */
  sleepUntil(at: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleepUntil: (at, signal) =>
    new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const wait = () => {
        const left = at - Date.now();
        if (left <= 0 || signal.aborted) return done();
        timer = setTimeout(wait, left);
      };
      signal.addEventListener("abort", done, { once: true });
      wait();
    }),
};

export interface ManualClock extends Clock {
  advance(ms: number): void;
}

/**
 * Virtual time for tests and simulations. Time moves only through `advance`, or when the driver
 * waits for a deadline that no agent answered in time: then it jumps straight to the deadline.
 */
export function createManualClock(start = 0): ManualClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    // A macrotask, so agents that answer through promises settle before time jumps.
    sleepUntil: (at, signal) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!signal.aborted) t = Math.max(t, at);
          resolve();
        }, 0),
      ),
  };
}

export interface RunOutcome {
  result: MatchResult;
  log: MatchLog;
}

/**
 * Plays a whole match. A beacon round that does not come by the beacon deadline (the client hangs or fails) voids the
 * match; the driver rejects only on a DiceError, such as a beacon value that does not check out.
 */
export async function runMatch(
  config: MatchConfig,
  agents: readonly [DiceAgent, DiceAgent],
  beacon: Beacon,
  clock: Clock = systemClock,
): Promise<RunOutcome> {
  if (beacon.info.chainHash !== config.beacon.chainHash) throw new DiceError("the beacon serves a different chain than the config names");
  const match = new DiceMatch(config);
  const never = new AbortController().signal;
  const now = () => Math.max(Math.floor(clock.now()), match.now);
  for (;;) {
    const result = match.result;
    if (result) return { result, log: match.log() };
    if (match.phase === "beacon") {
      const round = match.beaconRound;
      const deadline = match.deadline;
      if (round === null || deadline === null) throw new DiceError("the beacon round is not fixed");
      await clock.sleepUntil(roundTime(config.beacon, round), never);
      const value = await fetchRound(beacon, round, deadline, clock);
      // Past the deadline the engine voids the match, whether the round came late or not at all.
      if (value) match.apply({ type: "beacon", at: now(), beacon: value });
      else match.apply({ type: "tick", at: Math.max(now(), deadline + 1) });
    } else {
      await collectMoves(match, agents, clock, now);
    }
  }
}

/** The beacon round, or null once `deadline` passes without it. A failing client counts as one that never answers. */
async function fetchRound(beacon: Beacon, round: number, deadline: number, clock: Clock): Promise<BeaconRound | null> {
  const controller = new AbortController();
  const timer = clock.sleepUntil(deadline + 1, controller.signal).then(() => null);
  const value = Promise.resolve()
    .then(() => beacon.get(round))
    .then(
      (v) => v,
      () => timer,
    );
  try {
    return await Promise.race([value, timer]);
  } finally {
    controller.abort();
  }
}

/** Asks every seat the engine waits on, applies answers as they arrive, expires the deadline. */
async function collectMoves(
  match: DiceMatch,
  agents: readonly [DiceAgent, DiceAgent],
  clock: Clock,
  now: () => number,
): Promise<void> {
  const deadline = match.deadline;
  if (deadline === null) throw new DiceError(`nothing to wait for in phase ${match.phase}`);
  const phase = match.phase;
  const controller = new AbortController();
  const asks = new Map<Seat, Promise<{ seat: Seat; call: unknown }>>();
  for (const seat of match.pending()) {
    const view = match.view(seat);
    const ask = Promise.resolve()
      .then(() => agents[seat].act(view, controller.signal))
      // An agent that throws has made no valid move.
      .then((call) => ({ seat, call }), () => ({ seat, call: null }));
    asks.set(seat, ask);
  }
  const timer = clock.sleepUntil(deadline + 1, controller.signal).then(() => "deadline" as const);
  try {
    while (asks.size > 0 && !match.result && match.phase === phase) {
      const answer = await Promise.race([...asks.values(), timer]);
      const at = now();
      if (answer === "deadline") {
        match.apply({ type: "tick", at: Math.max(at, deadline + 1) });
        return;
      }
      asks.delete(answer.seat);
      match.apply({ type: "move", seat: answer.seat, at, call: answer.call });
    }
  } finally {
    controller.abort();
  }
}
