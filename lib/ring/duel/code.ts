/**
 * Code (CITY-51, decision 72): both agents get the same task and its open tests, work in up to 20 steps of tool calls
 * (run the open tests, read the result, change the code), then hand the code in. The winner is whoever passes more of
 * the hidden tests, run in a sandbox; the judge (CITY-68, `decider: "tests"`) checks each seat's run.
 *
 * What is here is the published part of the harness — the tools, the rules, how the winner is read off two runs — and
 * the sandbox it needs, as an interface. Until
 * then Code is not offered (`ready.ts` of the duels says so), and nothing here runs any agent's code.
 *
 * Pure: no store, no clock, no network.
 */

import { hashOf, isHex32 } from "../judge/hash.ts";
import type { Rules } from "../judge/rules.ts";
import type { TestRun } from "../judge/judge.ts";
import type { ModelTool } from "../../models/types.ts";
import type { Seat } from "./rounds.ts";

export const CODE = { id: "code", version: "1" } as const;

/** One standard Code match: 20 steps of tool calls (decision 72), 64 KiB of code at most. */
export const CODE_DEFAULTS = { steps: 20, maxBytes: 65_536 } as const;

/** The task as both agents get it; the hidden tests stay with the sandbox — only their hash is in the rules. */
export type CodeTask = { id: string; title: string; prompt: string; language: "typescript"; openTests: string; hiddenSuite: { suiteHash: string; ids: string[] } };

/** The tools of a Code match, as the model is offered them: run the open tests on a draft; hand the code in. */
export const CODE_TOOLS: readonly ModelTool[] = [
  {
    name: "run_open_tests",
    description: "Run the task's open tests on this code. Returns each test's name and whether it passed, with the first failure's message.",
    parameters: { type: "object", properties: { code: { type: "string", description: "The whole module." } }, required: ["code"], additionalProperties: false },
  },
  {
    name: "submit",
    description: "Hand this code in as your final answer. The match ends for you; the hidden tests decide.",
    parameters: { type: "object", properties: { code: { type: "string", description: "The whole module." } }, required: ["code"], additionalProperties: false },
  },
];

/** What a sandbox must do for Code: run the open tests on a draft, and the hidden suite on what was handed in. */
export type CodeSandbox = {
  runOpen(task: CodeTask, code: string, signal: AbortSignal): Promise<{ results: { name: string; passed: boolean }[]; message: string | null }>;
  /** The hidden suite on the handed-in bytes; `subject` is their SHA-256. `infra` for a test the runner broke on. */
  runHidden(task: CodeTask, code: string, signal: AbortSignal): Promise<TestRun>;
};

/** The rules a Code match is judged under: decided by tests, verified; nothing to win in CITY-51. */
export function codeRules(task: CodeTask, window: { opensAt: number; closesAt: number }, minPassed = 1): Rules {
  if (!isHex32(task.hiddenSuite.suiteHash) || task.hiddenSuite.ids.length === 0) throw new TypeError("a task needs its hidden suite");
  return {
    format: CODE.id,
    class: "verified",
    decider: "tests",
    money: "none",
    submission: { media: ["text/typescript"], maxBytes: CODE_DEFAULTS.maxBytes },
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    limits: { steps: CODE_DEFAULTS.steps },
    tests: { suiteHash: task.hiddenSuite.suiteHash, ids: task.hiddenSuite.ids, minPassed: Math.min(Math.max(1, minPassed), task.hiddenSuite.ids.length) },
  };
}

/** The suite's hash as the rules carry it: the ids and the tests' own source, so a changed test is another suite. */
export const suiteHash = (ids: readonly string[], source: string): string => hashOf({ format: "ryntra-code-suite/1", ids: [...ids], source });

/** The winner of a Code match: more hidden tests passed; equal is a draw. Each seat's count comes from its judged run. */
export function codeWinner(passed: readonly [number, number]): Seat | null {
  if (passed[0] === passed[1]) return null;
  return passed[0] > passed[1] ? 0 : 1;
}
