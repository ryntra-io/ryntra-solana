/**
 * The attacker/defender step runner's tools (CITY-225, spec `docs/research/city-hack-2026-11-08/SPEC.md`). An agent
 * works a Hack order's copy through four tools, no more — the shape of the Ring's `CodeSandbox` (`lib/ring/duel/code.ts`)
 * for a contract:
 *
 *   read(address)        — read one account of the pinned copy, as it was recorded. The agent inspects the contract's
 *                          state to plan. Reading any account is allowed; the scope only decides where a finding counts.
 *   assemble(input)      — check a `{ tx }` or `{ warp }` the agent describes against the copy's bounds before it
 *                          spends a run on it; or, from `{ instructions }`, put a transaction together and sign it with
 *                          the agent's own payer of the copy (`assemble.ts`, CITY-238). No run, no network.
 *   tryRun(inputs)       — `run` without `prove` (the sandbox's `runOpen`): play the inputs on a fresh copy and read
 *                          what happened step by step, and whether the fault reproduced. The agent's feedback loop.
 *   submit(inputs, meta) — `run` + `prove` (the sandbox's `runHidden`): the counted attempt. The harness writes the
 *                          log, the judge seals it, and the finding carries the judge's `logHash` (CITY-223).
 *
 * The sandbox runs behind a `SandboxBackend` (`backend.ts`): in the worker, off the routes process, with no network.
 * The session never signs, never reads a key, never moves money. A finding it builds is a claim with a proof; whether
 * it counts is the rules over the judge (`../rules.ts`), with the owner's grant and the prior findings a store holds
 * (CITY-226) — not decided here.
 */

import { sha256Hex } from "../../../../../lib/ring/judge/index.ts";
import { checkFinding, FINDING_FORMAT, isSeverity, type Finding, type Severity } from "../finding.ts";
import { isFindingTarget, type FindingTarget, type TargetRef } from "../scope.ts";
import type { Order } from "../order.ts";
import type { HackProof } from "../rules.ts";
import {
  fromBase64,
  parseInput,
  type ForkPin,
  type HackAttempt,
  type HackClaim,
  type HackInput,
  type HackRun,
  type LastStep,
  type SandboxLimits,
  type SandboxRefusal,
  type Snapshot,
  type Stop,
} from "../sandbox/index.ts";
import type { Judgement } from "../../../../../lib/ring/judge/index.ts";
import type { ProveWindow, SandboxBackend } from "./backend.ts";

/** Which side an agent plays. The tools are the same; the role shapes its prompt (`prompt.ts`), never its reach. */
export type HackSeat = "attacker" | "defender";

/** The most base64 of an account's data a read hands back inline; the full data is named by its hash. */
export const READ_DATA_MAX = 2_048;

/** A finding id a run builds: the order, the hunter and the run, so two runs never collide. */
const RUN_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export type HackSessionConfig = {
  readonly order: Order;
  /** The pin of the order's copy (`../sandbox/pin.ts`). Its target must be the order's fork. */
  readonly pin: ForkPin;
  /** The check the runs claim to break — one of the order's invariants. */
  readonly claim: HackClaim;
  /** The agent's own fee payers (addresses the snapshot does not hold), funded in the copy. */
  readonly actors: readonly string[];
  readonly limits: SandboxLimits;
  /** The recorded copy, for `read`. The backend holds its own; this one answers reads without a run. */
  readonly snapshot: Snapshot;
  /** The attacking (or defending) agent and its owner wallet. */
  readonly hunter: string;
  readonly hunterOwner: string;
  readonly seat: HackSeat;
  /** A short prefix the run ids start with, e.g. the order id; the session numbers runs after it. */
  readonly runPrefix: string;
};

export type HackSessionDeps = {
  readonly backend: SandboxBackend;
  /** Wall time, unix ms — the clock for a run id and a finding's submission time. */
  readonly now: () => number;
  /**
   * Puts `{ instructions }` together into a transaction signed with the agent's own payers of the copy
   * (`assemble.ts`). Without it the session only checks transactions that come in already signed.
   */
  readonly assembler?: (instructions: unknown) => AssembleResult;
};

/** One account of the copy as a tool hands it to the agent. `data` is bounded; `dataSha256` covers all of it. */
export type AccountView = {
  readonly address: string;
  readonly owner: string;
  /** Lamports as a decimal string (a u64 does not always fit a number). */
  readonly lamports: string;
  readonly executable: boolean;
  readonly dataLen: number;
  /** The data, base64, cut to `READ_DATA_MAX`; `truncated` says whether more follows. */
  readonly dataBase64: string;
  readonly truncated: boolean;
  readonly dataSha256: string;
};

export type ReadResult = { readonly ok: true; readonly account: AccountView | null } | { readonly ok: false; readonly detail: string };

export type AssembleResult =
  | { readonly ok: true; readonly kind: "tx" | "warp"; readonly bytes: number; readonly input: HackInput }
  | { readonly ok: false; readonly detail: string };

/** One step of a run as the agent reads it after `tryRun`. */
export type StepView = {
  readonly seq: number;
  readonly last: LastStep | null;
  readonly cuUsed: number;
  readonly over: "cu" | null;
  readonly slot: number;
  /** The copy's state hash after this step. */
  readonly state: string;
};

export type OpenRun = {
  readonly ok: true;
  readonly runId: string;
  /** `true` reproduced, `false` not, `null` undecided (the check already failed at the pin). */
  readonly reproduced: boolean | null;
  readonly stopped: Stop | null;
  readonly stopDetail: string | null;
  readonly usage: { readonly ms: number; readonly steps: number; readonly cu: number };
  readonly steps: readonly StepView[];
  readonly logHash: string;
};

export type OpenRunResult = OpenRun | { readonly ok: false; readonly refusal: SandboxRefusal; readonly detail: string };

/** What the agent names when it submits — its own words and claim; the session fills the rest of the finding. */
export type FindingMeta = {
  readonly target: FindingTarget;
  readonly vulnClass: string;
  readonly severity: Severity;
  readonly title: string;
  /** The agent's model spend on the proving run, micro-dollars; 0 when no model ran. */
  readonly costMicroUsd: number;
};

export type SubmitResult =
  | {
      readonly ok: true;
      readonly finding: Finding;
      readonly judgement: Judgement;
      readonly proof: HackProof;
      readonly logHash: string;
      readonly reproduced: boolean | null;
    }
  | { readonly ok: false; readonly refusal: SandboxRefusal | "BAD_FINDING" | "NO_PROOF"; readonly detail: string };

export type HackSession = {
  readonly seat: HackSeat;
  read(address: unknown): ReadResult;
  assemble(input: unknown): AssembleResult;
  tryRun(inputs: readonly unknown[]): Promise<OpenRunResult>;
  submit(inputs: readonly unknown[], meta: FindingMeta): Promise<SubmitResult>;
};

const asFork = (target: TargetRef): { kind: "fork"; program: string; slot: number } | null =>
  target.kind === "fork" ? target : null;

/** The window a proof is stamped inside — the order's own. */
const windowOf = (order: Order): ProveWindow => ({ opensAt: order.opensAt, closesAt: order.closesAt });

export function createHackSession(config: HackSessionConfig, deps: HackSessionDeps): HackSession {
  const { order, pin, claim, actors, limits, snapshot, seat } = config;
  const fork = asFork(order.target);
  let counter = 0;
  const nextRunId = (): string => {
    counter += 1;
    const id = `${config.runPrefix}:${deps.now()}:${counter}`.slice(0, 64);
    return RUN_ID.test(id) ? id : `run:${deps.now()}:${counter}`.slice(0, 64);
  };

  const attemptOf = (inputs: readonly unknown[]): HackAttempt => ({
    runId: nextRunId(),
    pin,
    ...(fork ? { target: fork } : {}),
    claim,
    actors: [...actors],
    inputs: [...inputs],
    limits,
  });

  function read(address: unknown): ReadResult {
    if (typeof address !== "string" || address.length === 0) return { ok: false, detail: "an address is a non-empty string" };
    const found = snapshot.accounts.find((a) => a.address === address);
    if (!found) return { ok: true, account: null };
    const data = fromBase64(found.data);
    if (data === null) return { ok: false, detail: "the recorded account's data is not canonical base64" };
    const truncated = data.length > READ_DATA_MAX;
    return {
      ok: true,
      account: {
        address: found.address,
        owner: found.owner,
        lamports: found.lamports,
        executable: found.executable,
        dataLen: data.length,
        dataBase64: truncated ? Buffer.from(data.subarray(0, READ_DATA_MAX)).toString("base64") : found.data,
        truncated,
        dataSha256: sha256Hex(data),
      },
    };
  }

  /** `{ instructions }` — the agent names what it wants and the harness assembles it. */
  const asksAssembly = (input: unknown): input is { instructions: unknown } =>
    input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).join() === "instructions";

  function assemble(input: unknown): AssembleResult {
    if (asksAssembly(input)) {
      return deps.assembler ? deps.assembler(input.instructions) : { ok: false, detail: "this session only takes a signed { tx } or a { warp }" };
    }
    try {
      const parsed = parseInput(input);
      if (parsed.kind === "warp") return { ok: true, kind: "warp", bytes: 0, input: parsed.input };
      return { ok: true, kind: "tx", bytes: parsed.bytes.length, input: parsed.input };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "the input is not a transaction or a warp" };
    }
  }

  /** The inputs as the copy takes them: each `{ instructions }` assembled and signed first; a refusal names which. */
  function resolve(inputs: readonly unknown[]): { ok: true; inputs: unknown[] } | { ok: false; detail: string } {
    const out: unknown[] = [];
    for (const [i, input] of (Array.isArray(inputs) ? inputs : []).entries()) {
      if (!asksAssembly(input)) {
        out.push(input);
        continue;
      }
      const built = assemble(input);
      if (!built.ok) return { ok: false, detail: `input ${i}: ${built.detail}`.slice(0, 200) };
      out.push(built.input);
    }
    return { ok: true, inputs: out };
  }

  async function tryRun(inputs: readonly unknown[]): Promise<OpenRunResult> {
    const resolved = resolve(inputs);
    if (!resolved.ok) return { ok: false, refusal: "BAD_ATTEMPT", detail: resolved.detail };
    const { run } = await deps.backend.execute({ attempt: attemptOf(resolved.inputs), prove: null });
    return openOf(run);
  }

  async function submit(inputs: readonly unknown[], meta: FindingMeta): Promise<SubmitResult> {
    const at = deps.now();
    const resolved = resolve(inputs);
    if (!resolved.ok) return { ok: false, refusal: "BAD_ATTEMPT", detail: resolved.detail };
    const { run, proof } = await deps.backend.execute({
      attempt: attemptOf(resolved.inputs),
      prove: { at, window: windowOf(order), costMicroUsd: Math.max(0, Math.trunc(meta.costMicroUsd || 0)) },
    });
    if (!run.ok) return { ok: false, refusal: run.refusal, detail: run.detail };
    if (!proof) return { ok: false, refusal: "NO_PROOF", detail: "the judge could not seal the run (no stamp, or a network try in the replay)" };
    const finding = buildFinding(run, meta, at);
    const issues = checkFinding(finding);
    if (issues.length > 0) return { ok: false, refusal: "BAD_FINDING", detail: issues[0]!.detail };
    return { ok: true, finding, judgement: proof.judgement, proof: proof.proof, logHash: run.logHash, reproduced: run.reproduced };
  }

  function buildFinding(run: Extract<HackRun, { ok: true }>, meta: FindingMeta, at: number): Finding {
    const target: FindingTarget = isFindingTarget(meta?.target) ? meta.target : { program: pin.target.program };
    const severity: Severity = isSeverity(meta?.severity) ? meta.severity : "info";
    const title = typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : "finding";
    return {
      format: FINDING_FORMAT,
      id: `${run.runId}:finding`.slice(0, 64),
      order: order.id,
      hunter: config.hunter,
      hunterOwner: config.hunterOwner,
      target,
      vulnClass: typeof meta?.vulnClass === "string" ? meta.vulnClass : "",
      severity,
      title,
      logHash: run.logHash,
      submittedAt: at,
      status: "submitted",
    };
  }

  return { seat, read, assemble, tryRun, submit };
}

/** A sandbox run as the open view the agent reads: the per-step derived, the usage and whether the fault reproduced. */
function openOf(run: HackRun): OpenRunResult {
  if (!run.ok) return { ok: false, refusal: run.refusal, detail: run.detail };
  const steps: StepView[] = run.log.entries.map((entry) => {
    const d = entry.derived as { last: LastStep | null; cuUsed: number; over: "cu" | null; slot: number; state: string };
    return { seq: entry.seq, last: d.last, cuUsed: d.cuUsed, over: d.over, slot: d.slot, state: d.state };
  });
  return {
    ok: true,
    runId: run.runId,
    reproduced: run.reproduced,
    stopped: run.stopped,
    stopDetail: run.stopDetail,
    usage: run.usage,
    steps,
    logHash: run.logHash,
  };
}
