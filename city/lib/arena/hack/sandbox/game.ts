/**
 * A Hack run as a game the judge can replay (CITY-224 over CITY-68). The judge's «verified» class decides by code: the
 * harness writes the log as the run plays (`sandbox.ts`), and anyone with the same pin, the same engine and the
 * protocol's check replays it input by input — the first entry where the copy derives something else is the
 * divergence (`lib/ring/judge/replay.ts`).
 *
 *   config  = { pin, claim: { invariant, version }, actors, limits: { cuPerStep, cuTotal } }
 *   input   = { tx: base64 wire bytes } | { warp: slots }
 *   derived = { last, cuUsed, over, slot, state }      — `state` is the copy's hash after the entry
 *   result  = { winner: 0 | null, reproduced, stop }   — seat 0 is the attacker
 *
 * What «reproduced» means is not the agent's word: the order brings its own checks — named properties of the
 * protocol (an invariant: «the vault's supply equals the sum of its balances», «only the authority moves the
 * treasury») as code that only reads the copy. A run claims one of them; the fault reproduces when that check held in
 * the pinned copy and fails after the run's inputs. A check that already fails at the pin proves nothing about the
 * attacker: the result is undecided and a person looks (the judge's `UNDECIDED`). Going over the run's compute is the
 * seat's loss whatever the copy holds (`stop: "cu"`).
 *
 * Every call into the engine and the check runs inside the offline wall (`offline.ts`), during the run and during
 * every replay.
 */

import { MoveRejected, sha256Hex, type GameResult, type ReplayGame } from "../../../../../lib/ring/judge/index.ts";
import { isAddress, isName } from "../scope.ts";
import type { EngineFactory, ForkEngine } from "./engine.ts";
import { LIMIT_CAPS } from "./limits.ts";
import { offline } from "./offline.ts";
import { checkPin, fromBase64, snapshotMatches, type AccountState, type ForkPin, type Snapshot } from "./pin.ts";

export const HACK_GAME = { id: "ryntra-hack-fork", version: "1" } as const;

/** The most bytes of one transaction: Solana's packet. */
export const TX_MAX_BYTES = 1_232;
/** The most slots one `warp` input moves the copy's clock: about two days. */
export const WARP_MAX_SLOTS = 432_000;
/** The agent's own fee payers: at most this many, each funded with `ACTOR_LAMPORTS` at the start of the copy. */
export const ACTORS_MAX = 4;
export const ACTOR_LAMPORTS = 10_000_000_000n;
/** The longest engine error a log keeps. */
const ERR_MAX = 200;

/** One of the protocol's checks: reads the copy, says whether the property holds. Never writes, never reaches out. */
export type Invariant = {
  readonly id: string;
  readonly version: string;
  holds(read: (address: string) => AccountState | null): boolean;
};

export type HackClaim = { readonly invariant: string; readonly version: string };

export type HackConfig = {
  readonly pin: ForkPin;
  readonly claim: HackClaim;
  /** The agent's own fee payers — addresses the snapshot does not hold. */
  readonly actors: readonly string[];
  readonly limits: { readonly cuPerStep: number; readonly cuTotal: number };
};

export type HackInput = { readonly tx: string } | { readonly warp: number };

export type LastStep =
  | { readonly kind: "tx"; readonly ok: boolean; readonly err: string | null; readonly units: number; readonly logs: string }
  | { readonly kind: "warp"; readonly slots: number };

export type HackDerived = {
  readonly last: LastStep | null;
  readonly cuUsed: number;
  readonly over: "cu" | null;
  readonly slot: number;
  /** The copy's state hash after this entry. */
  readonly state: string;
};

export type HackResult = GameResult & { readonly winner: 0 | null; readonly reproduced: boolean; readonly stop: "cu" | null };

export type HackGameDeps = {
  readonly engine: EngineFactory;
  /** The recorded state a pin names, or `null`. A lookup in what was recorded — never a fetch. */
  readonly snapshot: (pin: ForkPin) => Snapshot | null;
  /** The order's checks a run may claim to break. */
  readonly invariants: readonly Invariant[];
};

export type HackState = {
  readonly engine: ForkEngine;
  readonly invariant: Invariant;
  readonly config: HackConfig;
  /** The claimed check held in the pinned copy. */
  readonly heldAtPin: boolean;
  cuUsed: number;
  over: "cu" | null;
  last: LastStep | null;
};

const isWhole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const keysOf = (value: object): string => Object.keys(value).sort().join(",");

/** What is wrong with a run's config; `null` when a copy may start from it. Does not look the snapshot up. */
export function checkConfig(config: unknown): string | null {
  if (config === null || typeof config !== "object") return "config is not an object";
  const c = config as Record<string, unknown>;
  if (keysOf(c) !== "actors,claim,limits,pin") return "config is { pin, claim, actors, limits }";
  const pin = checkPin(c.pin);
  if (pin) return pin.detail;
  const claim = c.claim as Record<string, unknown> | null;
  if (claim === null || typeof claim !== "object" || keysOf(claim) !== "invariant,version" || !isName(claim.invariant) || !isName(claim.version)) {
    return "claim is { invariant, version }: the protocol check the run breaks";
  }
  const actors = c.actors;
  if (!Array.isArray(actors) || actors.length > ACTORS_MAX || !actors.every(isAddress) || new Set(actors).size !== actors.length) {
    return `actors: at most ${ACTORS_MAX} distinct addresses`;
  }
  const limits = c.limits as Record<string, unknown> | null;
  if (limits === null || typeof limits !== "object" || keysOf(limits) !== "cuPerStep,cuTotal") return "limits is { cuPerStep, cuTotal }";
  const { cuPerStep, cuTotal } = limits;
  if (!isWhole(cuPerStep) || cuPerStep < 1 || cuPerStep > LIMIT_CAPS.cuPerStep) return `cuPerStep: 1…${LIMIT_CAPS.cuPerStep}`;
  if (!isWhole(cuTotal) || cuTotal < cuPerStep || cuTotal > LIMIT_CAPS.cuTotal) return `cuTotal: cuPerStep…${LIMIT_CAPS.cuTotal}`;
  return null;
}

export type ParsedInput =
  | { readonly kind: "tx"; readonly bytes: Uint8Array; readonly input: { readonly tx: string } }
  | { readonly kind: "warp"; readonly slots: number; readonly input: { readonly warp: number } };

/** An input as the copy takes it, and its plain form for the log; `MoveRejected` for anything else. */
export function parseInput(input: unknown): ParsedInput {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const keys = keysOf(input);
    const value = input as Record<string, unknown>;
    if (keys === "tx") {
      const bytes = fromBase64(value.tx);
      if (bytes !== null && bytes.length > 0 && bytes.length <= TX_MAX_BYTES) return { kind: "tx", bytes, input: { tx: value.tx as string } };
      throw new MoveRejected(`a transaction is 1…${TX_MAX_BYTES} bytes of canonical base64`);
    }
    if (keys === "warp") {
      if (isWhole(value.warp) && value.warp >= 1 && value.warp <= WARP_MAX_SLOTS) return { kind: "warp", slots: value.warp, input: { warp: value.warp } };
      throw new MoveRejected(`warp moves 1…${WARP_MAX_SLOTS} slots`);
    }
  }
  throw new MoveRejected("an input is { tx: base64 } or { warp: slots }");
}

/** The game of a Hack run over these engines, recorded states and checks. */
export function createHackGame(deps: HackGameDeps): ReplayGame<HackState> {
  const checks = deps.invariants;
  return {
    id: HACK_GAME.id,
    version: HACK_GAME.version,

    start(config) {
      const issue = checkConfig(config);
      if (issue) throw new MoveRejected(issue);
      const c = config as HackConfig;
      const invariant = checks.find((check) => check.id === c.claim.invariant && check.version === c.claim.version);
      if (!invariant) throw new MoveRejected(`the order has no check ${c.claim.invariant}@${c.claim.version}`);
      return offline(() => {
        const snapshot = deps.snapshot(c.pin);
        if (!snapshot) throw new MoveRejected("no recorded state for this pin");
        if (!snapshotMatches(snapshot, c.pin)) throw new MoveRejected("the recorded state is not the pinned one");
        const engine = deps.engine();
        if (engine.id !== c.pin.engine.id || engine.version !== c.pin.engine.version) {
          throw new MoveRejected(`the pin runs on ${c.pin.engine.id}@${c.pin.engine.version}, this engine is ${engine.id}@${engine.version}`);
        }
        engine.load(snapshot);
        if (engine.stateHash() !== c.pin.stateHash) throw new MoveRejected("the loaded copy does not hash to the pin");
        const held = new Set(snapshot.accounts.map((a) => a.address).concat(snapshot.programs.map((p) => p.address)));
        for (const actor of c.actors) {
          if (held.has(actor)) throw new MoveRejected("an actor is an account of the copy: the agent funds only its own payers");
          engine.fund(actor, ACTOR_LAMPORTS);
        }
        const heldAtPin = holds(invariant, engine);
        return { engine, invariant, config: c, heldAtPin, cuUsed: 0, over: null, last: null };
      });
    },

    step(state, input) {
      if (state.over) throw new MoveRejected(`the run is over: ${state.over}`);
      const parsed = parseInput(input);
      if (parsed.kind === "warp") {
        offline(() => state.engine.warp(parsed.slots));
        state.last = { kind: "warp", slots: parsed.slots };
        return state;
      }
      const { cuPerStep, cuTotal } = state.config.limits;
      const result = offline(() => state.engine.execute(parsed.bytes, cuPerStep));
      if (typeof result?.ok !== "boolean" || !isWhole(result.units) || !Array.isArray(result.logs)) throw new TypeError("the engine returned a malformed result");
      const units = Math.min(result.units, cuPerStep);
      state.cuUsed += units;
      if (state.cuUsed > cuTotal) state.over = "cu";
      state.last = {
        kind: "tx",
        ok: result.ok,
        err: result.ok ? null : String(result.err ?? "failed").slice(0, ERR_MAX),
        units,
        logs: sha256Hex(result.logs.join("\n")),
      };
      return state;
    },

    derive(state): HackDerived {
      return offline(() => ({ last: state.last, cuUsed: state.cuUsed, over: state.over, slot: state.engine.clock().slot, state: state.engine.stateHash() }));
    },

    result(state): HackResult | null {
      // A check that already fails in the pinned copy proves nothing about this run: a person looks.
      if (!state.heldAtPin) return null;
      if (state.over) return { winner: null, reproduced: false, stop: state.over };
      const broken = !holds(state.invariant, state.engine);
      return { winner: broken ? 0 : null, reproduced: broken, stop: null };
    },
  };
}

/** The check on the copy as it is now, inside the offline wall. Anything but a boolean is a broken check, not a verdict. */
function holds(invariant: Invariant, engine: ForkEngine): boolean {
  const value = offline(() => invariant.holds((address) => engine.read(address)));
  if (typeof value !== "boolean") throw new TypeError(`check ${invariant.id} did not answer true or false`);
  return value;
}
