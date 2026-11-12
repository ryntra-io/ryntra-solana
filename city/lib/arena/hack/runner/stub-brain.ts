/**
 * A brain without a model for tests and the stand (CITY-225) — never production, like the Ring's stub brain
 * (`lib/ring/duel/stub-brain.ts`, reached only off the live catalog). It plays the same loop through the same four
 * tools (`session.ts`), so the whole way — read the copy, assemble an input, run it, submit the finding — is walked on a
 * stand with no network and no key, and every tool and every limit is exercised deterministically.
 *
 * It is a small state machine over the run so far: read the account it was told to inspect, validate the first input,
 * run the exploit, and — only when the run reports the fault reproduced — submit. Each move costs the pinned move price,
 * so the class ceiling (`runAgent`) is exercised as a real brain would exercise it.
 *
 * Guarded off production: `stubBrain` throws whenever `NODE_ENV` is `production` — no setting turns it on there (review 9.11).
 */

import type { Severity } from "../finding.ts";
import type { FindingTarget } from "../scope.ts";
import type { BrainReply, HackBrain, RunnerView, TurnRecord } from "./brain.ts";
import type { OpenRunResult } from "./session.ts";

export type StubPlan = {
  /** The account the stub reads first, to show the read tool over the copy. */
  readonly inspect: string;
  /** The inputs the stub runs and submits — the exploit (or an honest run that does not reproduce). */
  readonly exploit: readonly unknown[];
  /** What the stub names when it submits. */
  readonly finding: { readonly target: FindingTarget; readonly vulnClass: string; readonly severity: Severity; readonly title: string };
  /**
   * Without it the stub stops there.
   */
  readonly undecided?: boolean;
};

export type StubBrainInput = {
  readonly plan: StubPlan;
  /** What one move costs, micro-dollars; charged every turn so the ceiling is exercised. */
  readonly moveMicroUsd: number;
  /** For a test that wants to see the ceiling or the turn cap reached: never submit, keep running. */
  readonly loopForever?: boolean;
};

/** True when the stub may run here (anywhere but production, unless explicitly allowed). */
export function stubAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production";
}

/** A deterministic brain for tests and the stand. Throws in production, always. */
export function stubBrain(input: StubBrainInput): HackBrain {
  if (!stubAllowed()) throw new Error("the Hack stub brain never runs in production");
  const { plan } = input;
  const move = (reply: Omit<Extract<BrainReply, { kind: "action" }>, "costMicroUsd" | "kind">): BrainReply => ({ kind: "action", costMicroUsd: input.moveMicroUsd, ...reply });

  return {
    async next(view: RunnerView): Promise<BrainReply> {
      const last = view.history[view.history.length - 1];
      switch (last?.tool) {
        case undefined:
          return move({ action: { kind: "read", address: plan.inspect }, thought: "read the vault before touching it" });
        case "read_account":
          return move({ action: { kind: "assemble", input: plan.exploit[0] ?? {} }, thought: "check the first input fits the copy" });
        case "assemble_tx":
          return move({ action: { kind: "run", inputs: plan.exploit, why: "probe the exploit" }, thought: "run the exploit open" });
        case "run": {
          if (input.loopForever) return move({ action: { kind: "run", inputs: plan.exploit, why: "again" }, thought: "keep probing" });
          const reproduced = lastReproduced(last);
          if (reproduced === true || (reproduced === null && plan.undecided === true && lastRan(last))) {
            const why = reproduced === true ? "the fault reproduced; submit" : "the check already fails in the copy; the owner decides";
            return move({ action: { kind: "submit", inputs: plan.exploit, meta: { ...plan.finding, costMicroUsd: 0 }, why }, thought: "submit the finding" });
          }
          return move({ action: { kind: "stop", why: reproduced === null ? "the check did not hold at the pin" : "the fault did not reproduce" } });
        }
        default:
          return move({ action: { kind: "stop", why: "nothing more to try" } });
      }
    },
  };
}

/** True when the run was played at all (not refused before it started). */
function lastRan(turn: TurnRecord): boolean {
  const result = turn.result as OpenRunResult;
  return !!result && result.ok === true;
}

function lastReproduced(turn: TurnRecord): boolean | null {
  const result = turn.result as OpenRunResult;
  return result && result.ok ? result.reproduced : null;
}
