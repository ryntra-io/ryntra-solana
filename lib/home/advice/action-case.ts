import {
  ACTION_STAGES,
  type ActionParty,
  type ActionStage,
  type ActionStageId,
  type ActionStageState,
} from "../../agent-control/action-case.ts";
import type { JournalReview, RiskReference } from "./advice-case.ts";

/**
 * Home's exact actions, said in Agent Control's words.
 *
 * The planned-route register set this module's contract before it existed:
 * `/app/action-cases` must *project* existing ActionCases "without creating a
 * second action source", and the detail route "must read Agent Control truth".
 * So the stage ids, the stage shape and the party vocabulary are **imported**
 * from `lib/agent-control/action-case.ts` rather than redeclared. If Agent
 * Control adds a stage, this file stops compiling, which is the point.
 *
 * **What Home can actually see is not what Agent Control holds.** Agent
 * Control's own cases live in `sessionStorage` in one browser tab — that module
 * says so itself — so no server render can list them, and pretending otherwise
 * would be the second source of truth the register warned about. What Home *can*
 * see are two exact actions that already have durable records: a paper trade in
 * the paper book, and a fill the venue reported. Those are projected here; the
 * Agent Control lane is named on the surface and linked, not copied.
 *
 * **Ryntra never executes.** For a live fill the executing party is the venue
 * rail and the authorizing party is a wallet this product does not hold. For a
 * paper trade nothing executed at all — no order was transmitted — so the party
 * is `none` rather than a polite fiction about who filled it.
 */

export const HOME_ACTION_KINDS = ["PAPER_TRADE", "LIVE_FILL"] as const;

export type HomeActionKind = (typeof HOME_ACTION_KINDS)[number];

export type HomeActionPlan = Readonly<{
  stop: string | null;
  target: string | null;
  rationale: string | null;
}>;

export type HomeExactAction = Readonly<{
  actionRef: string;
  kind: HomeActionKind;
  book: "PAPER" | "LIVE";
  subjectRef: string;
  subjectLabel: string;
  side: string;
  size: string | null;
  entryPrice: string | null;
  plan: HomeActionPlan;
  openedAt: string | null;
  closedAt: string | null;
  exitReason: string | null;
  realizedAmount: string | null;
  realizedCurrency: string | null;
  fees: string | null;
  venue: string;
}>;

export type HomeActionCase = Readonly<{
  actionRef: string;
  caseId: string;
  kind: HomeActionKind;
  book: "PAPER" | "LIVE";
  subjectRef: string;
  subjectLabel: string;
  side: string;
  size: string | null;
  entryPrice: string | null;
  venue: string;
  openedAt: string | null;
  closedAt: string | null;
  closed: boolean;
  realizedAmount: string | null;
  realizedCurrency: string | null;
  stages: readonly ActionStage[];
  currentStageId: ActionStageId;
  nextStep: string;
  limitations: readonly string[];
}>;

export type HomeActionCaseInput = Readonly<{
  action: HomeExactAction;
  caseId: string;
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "NONE";
  risk: RiskReference;
  review: JournalReview;
}>;

const LABEL: Readonly<Record<ActionStageId, string>> = {
  intent: "Intent",
  evidence: "Evidence",
  policy: "Policy",
  risk: "Risk",
  review: "Review",
  authorization: "Authorization",
  execution: "Execution",
  outcome: "Outcome",
};

function stage(
  id: ActionStageId,
  state: ActionStageState,
  party: ActionParty,
  summary: string,
  limitation: string | null,
): ActionStage {
  return Object.freeze({ id, label: LABEL[id], state, party, summary, limitation });
}

function intentStage(action: HomeExactAction): ActionStage {
  const size = action.size === null ? "an unstated size" : action.size;
  const price = action.entryPrice === null ? "an unstated price" : action.entryPrice;
  return stage(
    "intent",
    "done",
    "human",
    `${action.side} ${size} ${action.subjectLabel} at ${price} on ${action.venue}.`,
    action.kind === "PAPER_TRADE"
      ? "A paper intent. It commits nothing and nothing about it reaches a venue."
      : null,
  );
}

function evidenceStage(completeness: HomeActionCaseInput["evidenceCompleteness"]): ActionStage {
  if (completeness === "COMPLETE") {
    return stage("evidence", "done", "ryntra", "Every source this case reads answered on the last read.", null);
  }
  if (completeness === "PARTIAL") {
    return stage(
      "evidence",
      "attention",
      "ryntra",
      "At least one source did not answer normally, disagreed with another, or left a required fact unsupplied.",
      "The case shows which, and neither a conflict nor an unknown is resolved by averaging.",
    );
  }
  return stage(
    "evidence",
    "unavailable",
    "none",
    "No source answered for this subject on this read.",
    "Nothing here is evidence of anything yet, which is a different statement from the action being unsafe.",
  );
}

/**
 * Policy, and why it is `unavailable` rather than `blocked`.
 *
 * Agent Control's own module makes the distinction load-bearing: blocked means a
 * rule refused; unavailable means the product cannot reach that stage at all.
 * Home evaluates no deterministic policy on a paper trade or a venue fill, so
 * reporting anything but `unavailable` would let a missing capability read as a
 * decision that was made.
 */
function policyStage(): ActionStage {
  return stage(
    "policy",
    "unavailable",
    "none",
    "No deterministic policy was evaluated for this action.",
    "Policy evaluation belongs to Agent Control and none of its policies was applied here. This is a capability Home does not reach, not a rule that allowed the action.",
  );
}

function riskStage(risk: RiskReference): ActionStage {
  if (risk.state === "ATTACHED") {
    const binding = risk.bindingConstraintIds.length;
    return stage(
      "risk",
      binding > 0 ? "attention" : "done",
      "ryntra",
      `Deterministic calculation ${risk.schemaVersion}/${risk.formulaVersion}, input digest ${risk.inputDigest}${
        binding > 0 ? `, ${binding} binding constraint${binding === 1 ? "" : "s"}` : ""
      }.`,
      risk.unknowns.length > 0 ? risk.unknowns[0] : null,
    );
  }
  return stage("risk", "unavailable", "none", "No deterministic risk calculation is attached to this action.", risk.reason);
}

function reviewStage(action: HomeExactAction): ActionStage {
  const { stop, target, rationale } = action.plan;
  if (stop === null && target === null && rationale === null) {
    return stage(
      "review",
      "unavailable",
      "none",
      "No pre-action plan is recorded for this action.",
      "The venue reports a fill, not the plan behind it. A plan exists here only where the paper book recorded one at open.",
    );
  }
  const parts = [
    stop === null ? null : `stop ${stop}`,
    target === null ? null : `target ${target}`,
  ].filter((part): part is string => part !== null);
  return stage(
    "review",
    "done",
    "human",
    parts.length > 0 ? `Planned at open: ${parts.join(", ")}.` : "A rationale was recorded at open.",
    rationale === null ? null : `Reason given: ${rationale}`,
  );
}

function authorizationStage(action: HomeExactAction): ActionStage {
  if (action.kind === "PAPER_TRADE") {
    return stage(
      "authorization",
      "unavailable",
      "none",
      "No authorization exists for a paper action.",
      "Nothing was signed and nothing left this product, so there is no authorization to record.",
    );
  }
  return stage(
    "authorization",
    "done",
    "wallet",
    "The venue accepted this action from an authorized account.",
    "The key that authorized it is not held by Ryntra and the signature is not in this product's records.",
  );
}

function executionStage(action: HomeExactAction): ActionStage {
  if (action.kind === "PAPER_TRADE") {
    return stage(
      "execution",
      "done",
      "none",
      "Simulated by the paper book.",
      "No order was transmitted to any venue. Paper fills execute at the chosen price and slippage is not simulated, so a paper result is an optimistic bound.",
    );
  }
  return stage("execution", "done", "rail", `Executed by ${action.venue} and reported as a fill.`, null);
}

function outcomeStage(action: HomeExactAction): ActionStage {
  if (action.closedAt === null) {
    return stage(
      "outcome",
      "waiting",
      "none",
      "This action is still open, so no outcome has been observed.",
      "No receipt exists before an authoritative observed outcome.",
    );
  }
  const realized =
    action.realizedAmount === null
      ? "no realized amount was reported"
      : `realized ${action.realizedAmount}${action.realizedCurrency === null ? "" : ` ${action.realizedCurrency}`}`;
  return stage(
    "outcome",
    "done",
    action.kind === "PAPER_TRADE" ? "none" : "rail",
    `Closed${action.exitReason === null ? "" : ` on ${action.exitReason}`}: ${realized}.`,
    action.kind === "PAPER_TRADE" ? "Authoritative for the paper book and for nothing else." : null,
  );
}

/** The first stage a person should look at: the earliest one not finished. */
function currentStage(stages: readonly ActionStage[]): ActionStageId {
  const attention = stages.find((entry) => entry.state === "attention" || entry.state === "blocked");
  if (attention) return attention.id;
  const waiting = stages.find((entry) => entry.state === "waiting");
  if (waiting) return waiting.id;
  return stages[stages.length - 1].id;
}

function nextStepOf(action: HomeExactAction, review: JournalReview): string {
  if (action.closedAt === null) return "The action is open. Nothing is required until the venue or the book reports its close.";
  if (review.state === "MISSING") return "The outcome is observed. Writing what it taught you is the last link in this cycle.";
  return "This cycle is complete: planned, acted, observed and reviewed.";
}

export function projectHomeActionCase(input: HomeActionCaseInput): HomeActionCase {
  const { action } = input;
  const stages = Object.freeze([
    intentStage(action),
    evidenceStage(input.evidenceCompleteness),
    policyStage(),
    riskStage(input.risk),
    reviewStage(action),
    authorizationStage(action),
    executionStage(action),
    outcomeStage(action),
  ]);

  /* Asserted rather than assumed: the projection must cover exactly Agent
     Control's stages, in its order. A silent gap would be a Home-only lifecycle
     wearing the shared vocabulary's name. */
  const limitations = stages
    .map((entry) => entry.limitation)
    .filter((limitation): limitation is string => limitation !== null);

  return Object.freeze({
    actionRef: action.actionRef,
    caseId: input.caseId,
    kind: action.kind,
    book: action.book,
    subjectRef: action.subjectRef,
    subjectLabel: action.subjectLabel,
    side: action.side,
    size: action.size,
    entryPrice: action.entryPrice,
    venue: action.venue,
    openedAt: action.openedAt,
    closedAt: action.closedAt,
    closed: action.closedAt !== null,
    realizedAmount: action.realizedAmount,
    realizedCurrency: action.realizedCurrency,
    stages: Object.freeze(ACTION_STAGES.map((id) => stages.find((entry) => entry.id === id)!)),
    currentStageId: currentStage(stages),
    nextStep: nextStepOf(action, input.review),
    limitations: Object.freeze(limitations),
  });
}
