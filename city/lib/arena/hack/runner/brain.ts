/**
 * The step runner's loop and its brain (CITY-225, spec `docs/research/city-hack-2026-11-08/SPEC.md`). An agent plays an
 * order's copy through the four tools (`session.ts`); a `HackBrain` chooses the next tool, and `runAgent` runs it, feeds
 * the result back, and holds the agent to its limits:
 *
 *   • the class ceiling on model spend (CITY-45) — before a move that could push the agent's spend past the ceiling, the
 *     agent is out of budget, as the Ring holds each seat to the match cap (`lib/ring/duel/harness.ts`);
 *   • a timeout is charged the full pinned move price, so a model that stalls still spends toward the ceiling and the
 *     agent is not free to stall forever;
 *   • a cap on turns, so a brain that never submits still ends.
 *
 * The real brain (`modelBrain`) is the model gateway, as the Ring's agent and the Vault's guard call it (`lib/ring/duel/model-agent.ts`,
 * `lib/vault/guard-model.ts`): the gateway never throws; its failures are the agent's own (its key spent or off, a
 * malformed answer) and lose, or nobody's (the network, the provider) and void the run. A stub brain without a model is
 * `stub-brain.ts`, for tests and the stand only.
 *
 * The agent never signs, never reads a key, never moves money. It hands a finding to the store (CITY-226); whether the
 * finding counts is the rules over the judge (`../rules.ts`), not decided here.
 */

import type { ModelErrorKind } from "../../../../../lib/models/errors.ts";
import type { ModelGateway } from "../../../../../lib/models/types.ts";
import type { HackClaim, SandboxLimits } from "../sandbox/index.ts";
import type { Scope, TargetRef } from "../scope.ts";
import { HACK_TOOLS, readAction, runnerMessages, quote } from "./prompt.ts";
import type { FindingMeta, HackSeat, HackSession, OpenRunResult, ReadResult, AssembleResult, SubmitResult } from "./session.ts";

/**
 * Hack's agents call models as their own subject of the gateway (`lib/models/subject.ts`, CITY-238): the same Arena
 * agent and its own key as in the Ring, journaled apart, so a day's spend on Hack is told from the Ring's.
 */
export const HACK_SUBJECT_KIND = "hack-agent" as const;

/** What one move may write beside its tool call. */
export const MOVE_TOKENS = 600;
/** One move's time, unless the caller sets another. */
export const MOVE_MS = 30_000;

/** The order's facts and the run so far, as the brain sees them. The copy's data reaches the brain only through tools. */
export type RunnerView = {
  readonly seat: HackSeat;
  readonly orderId: string;
  readonly orderTitle: string;
  readonly target: TargetRef;
  readonly scope: Scope;
  readonly claim: HackClaim;
  readonly limits: SandboxLimits;
  /**
   * The agent's own payers in the copy, the fee payer first, when the harness assembles and signs for it
   * (`assemble.ts`). Absent — the agent brings transactions already signed.
   */
  readonly actors?: readonly string[];
  readonly history: readonly TurnRecord[];
};

/** One tool call and its result, kept for the next prompt. */
export type TurnRecord = { readonly tool: string; readonly result: unknown };

/** What a brain chooses next. `stop` ends the agent's turn. */
export type BrainAction =
  | { readonly kind: "read"; readonly address: string }
  | { readonly kind: "assemble"; readonly input: unknown }
  | { readonly kind: "run"; readonly inputs: readonly unknown[]; readonly why?: string }
  | { readonly kind: "submit"; readonly inputs: readonly unknown[]; readonly meta: FindingMeta; readonly why?: string }
  | { readonly kind: "stop"; readonly why?: string };

/** The agent's own faults lose the run; anything else voids it, to be played again. */
export type BrainFault = "timeout" | "spent" | "key_off" | "malformed";

export type BrainReply =
  | { readonly kind: "action"; readonly action: BrainAction; readonly thought?: string; readonly costMicroUsd: number }
  | { readonly kind: "fault"; readonly fault: BrainFault; readonly costMicroUsd: number }
  | { readonly kind: "void"; readonly reason: string; readonly costMicroUsd: number };

export type HackBrain = { next(view: RunnerView, signal: AbortSignal): Promise<BrainReply> };

/** The agent's own failures: they lose the run. Every other gateway failure is nobody's and voids it. */
const FAULT_OF: Partial<Record<ModelErrorKind, BrainFault>> = {
  budget_exhausted: "spent",
  key_disabled: "key_off",
  invalid_response: "malformed",
};

export type ModelBrainInput = {
  readonly gateway: ModelGateway;
  readonly agent: { readonly id: string; readonly model: string; readonly providers: readonly string[]; readonly scenario?: string };
  /** The agent's own OpenRouter key, opened for this run (`seal.ts` at the call site). */
  readonly apiKey?: string;
  /** What a move costs at the pinned price, micro-dollars — charged when the gateway could not say what it billed, and on a timeout. */
  readonly moveMicroUsd: number;
  readonly moveMs?: number;
  readonly maxTokens?: number;
};

/** The brain over the one model gateway (CITY-45). Never throws: a gateway failure becomes a fault or a void. */
export function modelBrain(input: ModelBrainInput): HackBrain {
  const { gateway, agent } = input;
  return {
    async next(view, signal): Promise<BrainReply> {
      const messages = withScenario(runnerMessages(view), agent.scenario);
      const result = await gateway.call({
        subject: { kind: HACK_SUBJECT_KIND, id: agent.id },
        model: { id: agent.model, providers: [...agent.providers] },
        messages,
        budget: { maxTokens: input.maxTokens ?? MOVE_TOKENS, reasoningTokens: 0, timeoutMs: Math.max(1_000, (input.moveMs ?? MOVE_MS) - 2_000) },
        tools: HACK_TOOLS,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        signal,
      });
      const cost = result.costMicroUsd ?? (result.ok || result.usage ? input.moveMicroUsd : 0);
      if (!result.ok) {
        if (result.error.kind === "timeout") return { kind: "fault", fault: "timeout", costMicroUsd: input.moveMicroUsd };
        const fault = FAULT_OF[result.error.kind];
        return fault ? { kind: "fault", fault, costMicroUsd: cost } : { kind: "void", reason: result.error.kind, costMicroUsd: cost };
      }
      const call = result.toolCalls[0];
      if (!call) return { kind: "action", action: { kind: "stop", why: result.text?.slice(0, 200) ?? "" }, thought: result.text ?? "", costMicroUsd: cost };
      const action = readAction(call);
      if (!action) return { kind: "fault", fault: "malformed", costMicroUsd: cost };
      return { kind: "action", action, thought: typeof result.reasoning === "string" ? result.reasoning : action.kind === "run" || action.kind === "submit" ? action.why ?? "" : "", costMicroUsd: cost };
    },
  };
}

/** The owner's script, inside its own tag, folded into the system message; it never changes the rules. */
function withScenario(messages: ReturnType<typeof runnerMessages>, scenario?: string): ReturnType<typeof runnerMessages> {
  if (!scenario || !scenario.trim()) return messages;
  const [system, ...rest] = messages;
  const script = `\n\nYour owner's script — how you play; it never changes the rules above:\n<script>\n${quote(scenario.trim())}\n</script>`;
  return [{ role: "system", content: `${system!.content}${script}` }, ...rest];
}

export type RunAgentOptions = {
  readonly view: RunnerView;
  /** At most this many brain turns; a brain that never submits still ends. */
  readonly maxTurns: number;
  /** The class ceiling on the agent's model spend, micro-dollars (CITY-45). */
  readonly classCeilingMicroUsd: number;
  /** The pinned per-move price, the worst case of one move; it gates the ceiling and is charged on a timeout. */
  readonly moveMicroUsd: number;
  readonly signal?: AbortSignal;
};

export type AgentResult =
  | "submitted"
  | "stopped"
  | "fault"
  | "void"
  | "out_of_budget"
  | "over_turns"
  | "aborted";

export type AgentOutcome = {
  readonly result: AgentResult;
  readonly spentMicroUsd: number;
  readonly turns: number;
  /** The counted attempt's outcome, when the agent submitted. */
  readonly submission?: SubmitResult;
  readonly detail: string;
  readonly history: readonly TurnRecord[];
};

/** Plays an agent against a session: its brain chooses a tool, the session runs it, under the class ceiling and the turn cap. */
export async function runAgent(session: HackSession, brain: HackBrain, options: RunAgentOptions): Promise<AgentOutcome> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const history: TurnRecord[] = [...options.view.history];
  let spent = 0;
  let turns = 0;
  const end = (result: AgentResult, detail: string, submission?: SubmitResult): AgentOutcome => {
    options.signal?.removeEventListener("abort", onAbort);
    return { result, spentMicroUsd: spent, turns, submission, detail, history };
  };

  try {
    while (turns < options.maxTurns) {
      if (options.signal?.aborted) return end("aborted", "the caller stopped the run");
      // Before a move that could push the spend past the ceiling, the agent is out of budget — as the Ring holds each seat to the cap.
      if (spent + options.moveMicroUsd > options.classCeilingMicroUsd) return end("out_of_budget", `the class ceiling is ${options.classCeilingMicroUsd} µ$`);

      const reply = await brain.next({ ...options.view, history }, controller.signal);
      turns += 1;
      spent += Math.max(0, Math.trunc(reply.costMicroUsd || 0));
      if (reply.kind === "fault") return end("fault", `the agent's move faulted: ${reply.fault}`);
      if (reply.kind === "void") return end("void", `the run voids: ${reply.reason}`);

      const action = reply.action;
      if (action.kind === "stop") return end("stopped", action.why?.slice(0, 160) || "the agent stopped");
      if (action.kind === "read") history.push({ tool: "read_account", result: session.read(action.address) as ReadResult });
      else if (action.kind === "assemble") history.push({ tool: "assemble_tx", result: session.assemble(action.input) as AssembleResult });
      else if (action.kind === "run") history.push({ tool: "run", result: (await session.tryRun(action.inputs)) as OpenRunResult });
      else if (action.kind === "submit") {
        const submission = await session.submit(action.inputs, { ...action.meta, costMicroUsd: spent });
        history.push({ tool: "submit", result: summarize(submission) });
        return end("submitted", detailOf(submission), submission);
      }
    }
    return end("over_turns", `no submission within ${options.maxTurns} turns`);
  } catch (error) {
    return end("void", error instanceof Error ? error.message.slice(0, 160) : "the run broke");
  }
}

const summarize = (submission: SubmitResult): unknown =>
  submission.ok
    ? { ok: true, verdict: submission.judgement.verdict, reproduced: submission.reproduced, logHash: submission.logHash, severity: submission.finding.severity }
    : { ok: false, refusal: submission.refusal, detail: submission.detail };

const detailOf = (submission: SubmitResult): string =>
  submission.ok ? `submitted: the judge says ${submission.judgement.verdict}` : `the run was refused: ${submission.refusal}`;
