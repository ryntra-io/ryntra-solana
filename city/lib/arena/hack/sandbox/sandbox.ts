/**
 * The Hack sandbox (CITY-224, spec `docs/research/city-hack-2026-11-08/SPEC.md` «How the sandbox works»): it runs an
 * agent's attempt on a pinned copy, writes the log itself, and hands back the proof the rules over the judge consume
 * (`HackProof`, `../rules.ts`).
 *
 *   run(attempt)  — the copy from the pin, the agent's inputs one by one under the limits, the log as the harness
 *                   records it, its `logHash`. Synchronous and offline. Going over a limit stops the run; it never
 *                   crashes. A run that tried to reach the network is refused whole.
 *   replay(log)   — anyone plays the same log again on the same pin: the same `logHash`, or the first divergence.
 *   rules(run, w) — the judge's rules for the run: class «verified», decided by replay, nothing to win here.
 *   prove(run, …) — the harness stamps the log and asks the judge (CITY-68); the verdict and `deterministic: true` are
 *                   the `HackProof` that `assessFinding` takes. The finding carries the same `logHash`.
 *
 * This is the shape of the Ring's `CodeSandbox` (`lib/ring/duel/code.ts`) for a contract: `run` alone is its `runOpen`
 * (try inputs on the copy and read what happened — the agent's tool, CITY-225), `run` + `prove` is its `runHidden` (the
 * run that counts, judged by code). A Hack run is decided by replay, not hidden tests: the protocol's checks read the
 * copy after the inputs, and the log lets anyone play it again.
 *
 * The time it gets is injected (`now`), the stamp key lives with the harness (a `Stamper` from outside), the engine
 * and the recorded states come in through `deps`. No store, no money, no keys in this repository.
 */

import {
  LOG_FORMAT,
  MAX_SUBMISSION_BYTES,
  MATCH_ID,
  MoveRejected,
  canonicalJson,
  judge,
  logHash as hashLog,
  rulesHash,
  sha256Hex,
  verifyLog,
  type Divergence,
  type JudgeInput,
  type Judgement,
  type LogEntry,
  type MatchLog,
  type ReplayGame,
  type Rules,
  type Stamper,
  type StampVerifier,
} from "../../../../../lib/ring/judge/index.ts";
import type { HackProof } from "../rules.ts";
import { createHackGame, parseInput, type HackClaim, type HackConfig, type HackGameDeps, type HackResult, type HackState } from "./game.ts";
import { checkLimits, limitsOf, type SandboxLimits } from "./limits.ts";
import { NetworkRefused, offline } from "./offline.ts";
import { checkPin, type ForkPin } from "./pin.ts";
import type { TargetRef } from "../scope.ts";

/** The Ring format a Hack run is judged under. */
export const HACK_FORMAT = "arena-hack";

/** The attacker's seat in the judge's terms. */
export const ATTACKER_SEAT = 0;

export type HackAttempt = {
  /** The run's id — the judge's match id (1-64 of A-Z a-z 0-9 . _ : -). */
  readonly runId: string;
  readonly pin: ForkPin;
  /** When given, the pin must be this order target's copy. */
  readonly target?: TargetRef;
  readonly claim: HackClaim;
  readonly actors: readonly string[];
  readonly inputs: readonly unknown[];
  readonly limits?: Partial<SandboxLimits>;
};

/** Why a run did not happen at all. */
export type SandboxRefusal = "BAD_ATTEMPT" | "BAD_LIMITS" | "BAD_PIN" | "NOT_A_FORK" | "PIN_MISMATCH" | "NO_SNAPSHOT" | "NETWORK" | "ENGINE";

/** Why the harness stopped feeding inputs before the end. */
export type Stop = "steps" | "time" | "cu" | "rejected";

export type HackRun =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly config: HackConfig;
      readonly limits: SandboxLimits;
      readonly log: MatchLog;
      readonly logHash: string;
      /** What the harness measured: never what the agent says. `ms` is wall time and stays out of the log. */
      readonly usage: { readonly ms: number; readonly steps: number; readonly cu: number };
      /** Why the run ended before its inputs did, or lost on a limit; `null` when every input ran within the limits. */
      readonly stopped: Stop | null;
      readonly stopDetail: string | null;
      /** `true` reproduced, `false` not, `null` undecided (the check already failed at the pin). */
      readonly reproduced: boolean | null;
      readonly result: HackResult | null;
    }
  | { readonly ok: false; readonly runId: string; readonly refusal: SandboxRefusal; readonly detail: string };

export type ReplayCheck = { readonly ok: true; readonly logHash: string; readonly result: HackResult | null } | { readonly ok: false; readonly divergence: Divergence };

export type ProveContext = {
  /** The harness's stamp (its Ed25519 key lives in the server's environment) and the judge's check of it. */
  readonly stamp: Stamper;
  readonly verifyStamp: StampVerifier;
  /** When the harness hands the log in (unix ms) — inside the window. */
  readonly at: number;
  /** The order's window: a log stamped outside it is early or late. */
  readonly window: { readonly opensAt: number; readonly closesAt: number };
  /** The agent's model spend on the run, as the runner measured it (CITY-225); 0 when no model ran. */
  readonly costMicroUsd?: number;
};

export type HackSandboxDeps = HackGameDeps & {
  /** Wall time, unix ms — only to stop a run that runs too long. Never written into the log. */
  readonly now: () => number;
};

export type HackSandbox = {
  readonly game: ReturnType<typeof createHackGame>;
  run(attempt: HackAttempt): HackRun;
  replay(log: unknown): ReplayCheck;
  rules(run: Extract<HackRun, { ok: true }>, window: { opensAt: number; closesAt: number }): Rules;
  prove(run: HackRun, context: ProveContext): { proof: HackProof; judgement: Judgement } | null;
};

export function createHackSandbox(deps: HackSandboxDeps): HackSandbox {
  const game = createHackGame(deps);

  function run(attempt: HackAttempt): HackRun {
    const runId = typeof attempt?.runId === "string" ? attempt.runId : "";
    const refuse = (refusal: SandboxRefusal, detail: string): HackRun => ({ ok: false, runId, refusal, detail: detail.slice(0, 200) });
    if (attempt === null || typeof attempt !== "object" || !MATCH_ID.test(runId)) return refuse("BAD_ATTEMPT", "an attempt needs a run id");
    if (!Array.isArray(attempt.inputs)) return refuse("BAD_ATTEMPT", "inputs: a list");
    const limits = limitsOf(attempt.limits);
    const limitIssue = checkLimits(limits);
    if (limitIssue) return refuse("BAD_LIMITS", limitIssue.detail);
    const pinIssue = checkPin(attempt.pin, attempt.target);
    if (pinIssue) return refuse(pinIssue.code === "BAD_PIN" ? "BAD_PIN" : pinIssue.code === "NOT_A_FORK" ? "NOT_A_FORK" : "PIN_MISMATCH", pinIssue.detail);

    const config: HackConfig = {
      pin: attempt.pin,
      claim: attempt.claim,
      actors: Array.isArray(attempt.actors) ? [...attempt.actors] : attempt.actors,
      limits: { cuPerStep: limits.cuPerStep, cuTotal: limits.cuTotal },
    };
    const started = deps.now();
    try {
      return offline(() => {
        if (deps.snapshot(attempt.pin) === null) return refuse("NO_SNAPSHOT", "no recorded state for this pin");
        return play(runId, config, limits, attempt.inputs, started);
      });
    } catch (error) {
      if (error instanceof NetworkRefused) return refuse("NETWORK", error.message);
      if (error instanceof MoveRejected) return refuse("BAD_ATTEMPT", error.message);
      return refuse("ENGINE", error instanceof Error ? error.message : "the engine broke");
    }
  }

  function play(runId: string, config: HackConfig, limits: SandboxLimits, inputs: readonly unknown[], started: number): HackRun {
    const state: HackState = game.start(config, runId);
    const entries: LogEntry[] = [];
    let stopped: Stop | null = null;
    let stopDetail: string | null = null;
    for (const input of inputs) {
      if (state.over) {
        [stopped, stopDetail] = ["cu", `the run's compute went over ${limits.cuTotal}`];
        break;
      }
      if (entries.length >= limits.steps) {
        [stopped, stopDetail] = ["steps", `${limits.steps} steps at most`];
        break;
      }
      const elapsed = deps.now() - started;
      if (elapsed > limits.ms) {
        [stopped, stopDetail] = ["time", `${elapsed} ms, ${limits.ms} at most`];
        break;
      }
      // The entry's time is the copy's own clock, so the log is the same on every machine.
      const at = state.engine.clock().unixTimestamp * 1_000;
      let plain: unknown;
      try {
        // The log keeps the input's plain form only: what the agent sent, nothing it hung on it.
        plain = parseInput(input).input;
        game.step(state, plain, at);
      } catch (error) {
        if (!(error instanceof MoveRejected)) throw error;
        [stopped, stopDetail] = ["rejected", error.message];
        break;
      }
      entries.push({ seq: entries.length, at, input: plain, derived: game.derive(state) });
    }
    if (stopped === null && state.over) [stopped, stopDetail] = ["cu", `the run's compute went over ${limits.cuTotal}`];
    const result = game.result(state) as HackResult | null;
    const log: MatchLog = { format: LOG_FORMAT, matchId: runId, game: { id: game.id, version: game.version }, config, entries, result };
    return {
      ok: true,
      runId,
      config,
      limits,
      log,
      logHash: hashLog(log),
      usage: { ms: Math.max(0, deps.now() - started), steps: entries.length, cu: state.cuUsed },
      stopped,
      stopDetail,
      reproduced: result === null ? null : result.reproduced,
      result,
    };
  }

  function replay(log: unknown): ReplayCheck {
    try {
      const verification = offline(() => verifyLog(game, log));
      if (!verification.ok) return { ok: false, divergence: verification.divergence };
      return { ok: true, logHash: hashLog(log as MatchLog), result: verification.result as HackResult | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "the replay broke";
      return { ok: false, divergence: { index: "log", path: "", expected: undefined, found: undefined, message: message.slice(0, 200) } };
    }
  }

  function rules(done: Extract<HackRun, { ok: true }>, window: { opensAt: number; closesAt: number }): Rules {
    return {
      format: HACK_FORMAT,
      class: "verified",
      decider: "replay",
      money: "none",
      game: { id: game.id, version: game.version, config: done.config },
      submission: { media: [LOG_FORMAT], maxBytes: MAX_SUBMISSION_BYTES },
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      limits: done.limits.costMicroUsd === undefined ? { steps: done.limits.steps } : { steps: done.limits.steps, costMicroUsd: done.limits.costMicroUsd },
    };
  }

  /** The judge's verdict on a run. `null` for a refused run, and for a replay that tried to reach the network. */
  function prove(done: HackRun, context: ProveContext): { proof: HackProof; judgement: Judgement } | null {
    if (!done.ok) return null;
    const content = canonicalJson(done.log);
    const hash = sha256Hex(content);
    const runRules = rules(done, context.window);
    const input: JudgeInput = {
      matchId: done.runId,
      seat: ATTACKER_SEAT,
      rules: runRules,
      rulesHash: rulesHash(runRules),
      submission: { media: LOG_FORMAT, content, hash, size: Buffer.byteLength(content, "utf8"), stamp: context.stamp({ matchId: done.runId, seat: ATTACKER_SEAT, hash }, context.at) },
      usage: { costMicroUsd: context.costMicroUsd ?? 0, ms: done.usage.ms, steps: done.usage.steps },
      // The harness's own record — the log it wrote as the run played.
      harness: { logHash: done.logHash },
    };
    let judgement: Judgement;
    try {
      judgement = offline(() => judge(input, { verifyStamp: context.verifyStamp, games: [game as unknown as ReplayGame<unknown>] }));
    } catch (error) {
      if (error instanceof NetworkRefused) return null;
      throw error;
    }
    // Decided by replay: deterministic, the only kind that can make a counted finding (`../rules.ts`).
    return { proof: { judgement, deterministic: runRules.class === "verified" && runRules.decider !== "model" }, judgement };
  }

  return { game, run, replay, rules, prove };
}
