/**
 * The Hack step runner (CITY-225) in one import: the attacker/defender over the pinned-copy sandbox (CITY-224). An
 * agent works an order's copy through four tools — read an account, assemble an input, run it, submit a finding — with
 * its brain on the one model gateway (CITY-45), under the class ceiling and a time wall. The sandbox runs in a worker
 * with no network, off the routes process.
 *
 * No routes (CITY-226), no windows (CITY-227), no money (CITY-229) here. See `README.md`.
 */

export type { ProveArgs, ProveWindow, SandboxBackend, SandboxExecution, Stamp, InProcessBackendDeps } from "./backend.ts";
export { inProcessBackend } from "./backend.ts";

export type { StampPem, WorkerBackendConfig } from "./worker.ts";
export { createWorkerBackend } from "./worker.ts";

export {
  createHackSession,
  READ_DATA_MAX,
  type AccountView,
  type AssembleResult,
  type FindingMeta,
  type HackSeat,
  type HackSession,
  type HackSessionConfig,
  type HackSessionDeps,
  type OpenRun,
  type OpenRunResult,
  type ReadResult,
  type StepView,
  type SubmitResult,
} from "./session.ts";

export {
  HACK_TOOLS,
  HACK_MOVE_SCHEMA,
  WHY_MAX,
  quote,
  readAction,
  runnerMessages,
} from "./prompt.ts";

export {
  HACK_SUBJECT_KIND,
  MOVE_MS,
  MOVE_TOKENS,
  modelBrain,
  runAgent,
  type AgentOutcome,
  type AgentResult,
  type BrainAction,
  type BrainFault,
  type BrainReply,
  type HackBrain,
  type ModelBrainInput,
  type RunAgentOptions,
  type RunnerView,
  type TurnRecord,
} from "./brain.ts";

export { stubAllowed, stubBrain, type StubBrainInput, type StubPlan } from "./stub-brain.ts";
