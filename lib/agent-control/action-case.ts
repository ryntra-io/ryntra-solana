import type { ActionPassportPreview } from "./contracts";

/*
 * The Action Case: one economic action, in the shape every surface reads it.
 *
 * It is deliberately **derived**, not authored. `ActionPassportPreview` already
 * carries the whole lifecycle — intent, evidence root, policy definition and
 * result, human decision, execution state, outcome state, integrity — so a
 * second object holding its own copy of those facts would be a second source of
 * truth that drifts. This module reads the artifact and answers the questions a
 * screen asks; it invents nothing and it stores nothing.
 *
 * That is the product's own arrangement: one immutable envelope, and the
 * Passport and the Receipt as projections of it. What was missing was the
 * projection a *workspace* needs — stage by stage, with the responsible party
 * and the limitation attached to each — so Simple, Pro, the Actions list and
 * the Inspector stop being four independent readings of the same artifact.
 *
 * Everything here is a pure function of the preview. No clock, no fetch, no
 * randomness: two callers with the same artifact get the same case.
 */

/** The eight stages the workspace is built around. */
export const ACTION_STAGES = [
  "intent",
  "evidence",
  "policy",
  "risk",
  "review",
  "authorization",
  "execution",
  "outcome",
] as const;

export type ActionStageId = (typeof ACTION_STAGES)[number];

/**
 * What a stage is doing.
 *
 * `blocked` and `unavailable` are different answers and must not be merged.
 * Blocked means a rule refused this action; unavailable means the product
 * cannot reach that stage at all yet, for anyone. Collapsing them would let a
 * missing capability read as a policy decision.
 */
export type ActionStageState = "done" | "attention" | "waiting" | "blocked" | "unavailable";

/** Who is holding the action at a stage. Never Ryntra for execution. */
export type ActionParty = "agent" | "ryntra" | "human" | "wallet" | "rail" | "none";

export type ActionStage = {
  id: ActionStageId;
  label: string;
  state: ActionStageState;
  party: ActionParty;
  /** One line naming what is true at this stage, from the artifact. */
  summary: string;
  /** The limitation that applies here, or null when none does. */
  limitation: string | null;
};

export type ActionCaseEvidence = {
  id: string;
  provider: string;
  sourceRef: string;
  observedAt: string;
  validUntil: string;
  status: string;
  availability: string;
  verificationStatus: string;
  reason: string | null;
  freshness: "FRESH" | "STALE" | "NON_POSITIVE";
};

export type ActionCase = {
  /** The preview's own id. The case has no identity of its own. */
  id: string;
  createdAt: string;
  /** `SOURCE_PREVIEW` — carried through rather than restated. */
  maturity: string;
  sourceKind: string;
  sample: boolean;

  agentId: string;
  agentName: string | null;
  requester: string;
  requestText: string;

  actionKind: string;
  provider: string;
  chainRef: string;
  deliverable: string;
  counterpartyRef: string | null;
  venueRef: string | null;
  expectedEffects: readonly string[];
  /** Null when the action class carries no budget, which is a rule, not a gap. */
  amount: string | null;
  assetRef: string | null;
  deadline: string;
  expiresAt: string;
  revision: number;
  idempotencyKey: string;

  intentHash: string;
  evidenceRoot: string;
  policyDigest: string;
  passportHash: string;

  policyId: string;
  policyVersion: number;
  decision: string;
  policyStatus: string;
  blockers: readonly string[];
  warnings: readonly string[];
  /** Exact domain codes carried by non-positive evidence into the policy result. */
  policyReasonCodes: readonly string[];
  budgetLimitAmount: string | null;
  budgetLimitAssetRef: string | null;

  evidenceCount: number;
  evidenceItems: readonly ActionCaseEvidence[];
  /** Evidence whose `validUntil` is at or before the artifact's creation. */
  staleEvidence: readonly string[];
  /** Evidence that did not fully answer. */
  partialEvidence: readonly string[];

  humanDecision: string;
  humanDecisionIsDemoOnly: boolean;
  executionStatus: string;
  executionReason: string;
  outcomeStatus: string;

  limitations: readonly string[];
  stages: readonly ActionStage[];
  /** The stage a person should look at first. */
  currentStageId: ActionStageId;
  /** What the product needs next, in one sentence. */
  nextStep: string;
};

const STAGE_LABEL: Readonly<Record<ActionStageId, string>> = {
  intent: "Intent",
  evidence: "Evidence",
  policy: "Policy",
  risk: "Risk",
  review: "Review",
  authorization: "Authorization",
  execution: "Execution",
  outcome: "Outcome",
};

/** Decisions that let an action continue past policy. */
const PASSING_DECISIONS = new Set(["ALLOWED_BY_POLICY"]);
/** Decisions where a rule refused, as opposed to the product being unable. */
const REFUSING_DECISIONS = new Set(["BLOCKED_BY_RULE", "EXPIRED", "UNSUPPORTED"]);

export function buildActionCase(preview: ActionPassportPreview): ActionCase {
  const { intent, policy, authorization, execution, outcome } = preview;
  const result = policy.result;

  const stale = preview.evidence.items
    .filter((item) => Date.parse(item.validUntil) <= Date.parse(preview.createdAt))
    .map((item) => item.id);
  const partial = preview.evidence.items
    .filter((item) => item.availability !== "AVAILABLE")
    .map((item) => item.id);

  const passed = PASSING_DECISIONS.has(result.decision);
  const refused = REFUSING_DECISIONS.has(result.decision);
  const recorded = authorization.status === "RECORDED_DEMO_ONLY";
  /* Execution being unavailable is a boundary, not a risk signal. Keeping it
     in the Risk stage made an otherwise complete review appear to stop before
     the external-wallet boundary it had actually reached. */
  const riskWarnings = result.warnings.filter(
    (warning) => warning !== "EXECUTION_DISABLED_FOR_SOURCE_PREVIEW",
  );
  const policyReasonCodes = result.blockers
    .filter((blocker) => blocker.startsWith("EVIDENCE_REASON:"))
    .map((blocker) => blocker.slice("EVIDENCE_REASON:".length))
    .sort();

  const stages: ActionStage[] = [
    {
      id: "intent",
      label: STAGE_LABEL.intent,
      state: "done",
      party: "agent",
      summary: `${intent.action.kind} on ${intent.action.chainRef} via ${intent.action.provider}, revision ${intent.revision}.`,
      limitation: null,
    },
    {
      id: "evidence",
      label: STAGE_LABEL.evidence,
      state: stale.length || partial.length ? "attention" : "done",
      party: "ryntra",
      summary:
        `${preview.evidence.items.length} source-labelled item(s)` +
        (stale.length ? `, ${stale.length} past its validity` : "") +
        (partial.length ? `, ${partial.length} not fully available` : "") +
        ".",
      limitation: stale.length
        ? "Evidence older than its own validity window cannot support a fresh decision."
        : null,
    },
    {
      id: "policy",
      label: STAGE_LABEL.policy,
      state: refused ? "blocked" : passed ? "done" : "attention",
      party: "ryntra",
      summary: `${result.decision} · ${result.status} · policy ${result.policyRef.id} v${result.policyVersion}.`,
      limitation:
        "A policy result is not a human authorization, and an allowed result is not permission to execute.",
    },
    {
      id: "risk",
      label: STAGE_LABEL.risk,
      state: riskWarnings.length ? "attention" : passed ? "done" : "waiting",
      party: "ryntra",
      summary: riskWarnings.length
        ? `${riskWarnings.length} warning(s): ${riskWarnings.join("; ")}`
        : "No warning was raised by the evaluated rules.",
      limitation:
        "The rules evaluated are the ones in this policy version. Absence of a warning is not a statement that no risk exists.",
    },
    {
      id: "review",
      label: STAGE_LABEL.review,
      state: refused ? "unavailable" : recorded ? "done" : "waiting",
      party: "human",
      summary: refused
        ? "Not reached: policy refused the action."
        : recorded
          ? "A local demo acknowledgement was recorded."
          : "No human decision is recorded.",
      limitation:
        "There is no authenticated approval workflow. A demo acknowledgement binds the hashes locally and authorizes nothing.",
    },
    {
      id: "authorization",
      label: STAGE_LABEL.authorization,
      state: "unavailable",
      party: "wallet",
      summary: recorded
        ? "Bound to this exact intent hash, evidence root and policy digest — as a demo record."
        : "Nothing is authorized.",
      limitation:
        "Ryntra holds no key and produces no signature. A wallet authorization would come from the owner's own wallet.",
    },
    {
      id: "execution",
      label: STAGE_LABEL.execution,
      state: "unavailable",
      party: "rail",
      summary: `${execution.status} · ${execution.reasonCode}.`,
      limitation:
        "No provider signer, no wallet authorization and no submitted transaction. Ryntra executes nothing.",
    },
    {
      id: "outcome",
      label: STAGE_LABEL.outcome,
      state: "unavailable",
      party: "ryntra",
      summary: `${outcome.status} · ${outcome.observedEffects.length} observed effect(s).`,
      limitation:
        "A preview that states OUTCOME_NOT_OBSERVED is an Action Passport Preview, not an Outcome Receipt.",
    },
  ];

  /* The first stage that is not finished is the one a person should read. When
     everything reachable is finished, that is the first unavailable stage —
     which is the honest answer about where this product currently stops. */
  const current =
    stages.find((stage) => stage.state === "blocked") ??
    stages.find((stage) => stage.state === "attention") ??
    stages.find((stage) => stage.state === "waiting") ??
    stages.find((stage) => stage.state === "unavailable") ??
    stages[stages.length - 1];

  return {
    id: preview.id,
    createdAt: preview.createdAt,
    maturity: preview.maturity,
    sourceKind: intent.source.kind,
    sample: intent.source.kind === "DEMO",

    agentId: intent.source.agentId,
    agentName: intent.source.agentName,
    requester: intent.subjectRef,
    requestText: intent.requestText,

    actionKind: intent.action.kind,
    provider: intent.action.provider,
    chainRef: intent.action.chainRef,
    deliverable: intent.action.deliverable,
    counterpartyRef: intent.action.providerRef,
    venueRef: intent.action.evaluatorRef,
    expectedEffects: intent.action.expectedEffects,
    amount: intent.action.budget?.amount ?? null,
    assetRef: intent.action.budget?.assetRef ?? null,
    deadline: intent.action.deadline,
    expiresAt: intent.expiresAt,
    revision: intent.revision,
    idempotencyKey: intent.idempotencyKey,

    intentHash: preview.intentHash,
    evidenceRoot: preview.evidence.root,
    policyDigest: result.policyDigest,
    passportHash: preview.passportHash,

    policyId: result.policyRef.id,
    policyVersion: result.policyVersion,
    decision: result.decision,
    policyStatus: result.status,
    blockers: result.blockers,
    warnings: result.warnings,
    policyReasonCodes,
    budgetLimitAmount: policy.definition.maxBudget?.amount ?? null,
    budgetLimitAssetRef: policy.definition.maxBudget?.assetRef ?? null,

    evidenceCount: preview.evidence.items.length,
    evidenceItems: preview.evidence.items.map((item) => ({
      id: item.id,
      provider: item.provider,
      sourceRef: item.sourceRef,
      observedAt: item.observedAt,
      validUntil: item.validUntil,
      status: item.status,
      availability: item.availability,
      verificationStatus: item.verificationStatus,
      reason: item.reason,
      freshness:
        item.status === "STALE" || Date.parse(item.validUntil) <= Date.parse(preview.createdAt)
          ? "STALE"
          : item.status !== "VALID" || item.availability !== "AVAILABLE"
            ? "NON_POSITIVE"
            : "FRESH",
    })),
    staleEvidence: stale,
    partialEvidence: partial,

    humanDecision: authorization.status,
    humanDecisionIsDemoOnly: authorization.demoOnly,
    executionStatus: execution.status,
    executionReason: execution.reasonCode,
    outcomeStatus: outcome.status,

    limitations: preview.limitations,
    stages,
    currentStageId: current.id,
    nextStep: nextStepFor(current, refused),
  };
}

function nextStepFor(stage: ActionStage, refused: boolean): string {
  switch (stage.id) {
    case "evidence":
      return "Refresh the evidence that is past its validity window, then preflight again.";
    case "policy":
      return refused
        ? "Nothing to approve. The action must change, or the policy must — and a policy change is a new version."
        : "Read the decision and its reasons before anything is approved.";
    case "risk":
      return "Read the warnings. They do not block, and they are not nothing.";
    case "review":
      return refused
        ? "Not reachable while policy refuses the action."
        : "A person decides. There is no authenticated approval workflow yet, so any decision here is a local demo record.";
    case "authorization":
      return "A wallet authorization would come from the owner's own wallet. Ryntra holds no key.";
    case "execution":
      return "Execution is unavailable: no provider signer and no wallet authorization exist in this product.";
    case "outcome":
      return "No outcome can be observed until an action executes. Until then this stays a preview.";
    default:
      return "Compose an intent and preflight it.";
  }
}

/** A short verdict word for a list row, derived rather than stored. */
export function actionCaseVerdict(actionCase: ActionCase): "ALLOW" | "REVIEW" | "BLOCK" | "UNKNOWN" {
  if (PASSING_DECISIONS.has(actionCase.decision)) return "ALLOW";
  if (REFUSING_DECISIONS.has(actionCase.decision)) return "BLOCK";
  if (actionCase.decision === "REVIEW_REQUIRED" || actionCase.decision === "INSUFFICIENT_EVIDENCE") {
    return "REVIEW";
  }
  return "UNKNOWN";
}
