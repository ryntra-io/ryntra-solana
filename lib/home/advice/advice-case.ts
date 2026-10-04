import { createHash } from "node:crypto";

import type { ConflictEntry } from "../research/change.ts";
import type { Entitlement } from "../research/mandate.ts";

/**
 * The AdviceCase — Ryntra Home's decision record.
 *
 * The material-change engine gave the product a *change*. This is the
 * *decision about* that change, and it is one object rather than six screens,
 * because an audit that has to be reassembled from six screens is not an audit.
 *
 * The chain it records is exactly this:
 *
 *   InvestorContext version → trigger → EvidenceBundle → conflicts, unknowns
 *   and alternatives → RiskCalculation → human disposition → optional exact
 *   ActionCase → observed outcome → JournalReview.
 *
 * Three properties make it worth calling an audit record rather than a summary.
 *
 * **It is not a recommendation and cannot become one.** `adviceAuthority` is
 * the constant `"NONE"` and `recommendation` is structurally `null`; the
 * compiler writes both itself and reads neither from its input, so a caller
 * cannot pass one in. `BUY / SELL / HOLD / REDUCE / HEDGE / REBALANCE` is a
 * provider-gated vocabulary and it appears nowhere in this module. Before that
 * gate exists the case carries facts, the reader's own goals, alternatives
 * including doing nothing, and the reader's own decision.
 *
 * **A disposition is read, never inferred.** The most tempting shortcut in this
 * whole module is to notice an open paper trade on the same instrument as a
 * change and call that the reader's decision. It is not: it is two facts that
 * share a ticker. An inferred disposition would be a fabricated audit record,
 * which is precisely what this object exists to prevent, so a case nobody
 * decided stays `PENDING` and says why.
 *
 * **It is pure.** No clock, no fetch, no randomness. `caseId` is a digest of
 * the owner and the trigger, so the same case keeps the same identity across
 * reads while `asOf` moves — an identity that changed every render would make
 * every link into this surface dead within a minute.
 */

/** What Ryntra is authorized to advise. One value, and it is not a variable. */
export const ADVICE_AUTHORITY = "NONE" as const;

export const ADVICE_TRIGGER_KINDS = ["MATERIAL_CHANGE", "USER_INITIATED"] as const;

export type AdviceTriggerKind = (typeof ADVICE_TRIGGER_KINDS)[number];

/**
 * What the case is about, in the product's own terms.
 *
 * `subjectKind` is what decides which alternatives are real. A paper route
 * exists for an Arcus perpetual market and does not exist for a Robinhood Stock
 * Token, and saying so is more useful than offering an action that fails.
 */
export const ADVICE_SUBJECT_KINDS = ["VENUE_MARKET", "PAPER_TRADE", "STOCK_TOKEN", "OTHER"] as const;

export type AdviceSubjectKind = (typeof ADVICE_SUBJECT_KINDS)[number];

export type AdviceTrigger = Readonly<{
  kind: AdviceTriggerKind;
  /** The change id or the action ref this case was raised from. */
  ref: string;
  subjectRef: string;
  subjectLabel: string;
  subjectKind: AdviceSubjectKind;
  factKey: string | null;
  observedAt: string | null;
  /** The MonitorRule that raised it, or `null` when the reader started it. */
  ruleId: string | null;
  detail: string;
}>;

export const EVIDENCE_STATES = ["OK", "STALE", "FAILED", "REFUSED"] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type EvidenceItem = Readonly<{
  sourceId: string;
  label: string;
  entitlement: Entitlement;
  observedAt: string | null;
  ref: string;
  state: EvidenceState;
  reason: string | null;
}>;

export type EvidenceBundle = Readonly<{
  bundleId: string;
  items: readonly EvidenceItem[];
  conflicts: readonly ConflictEntry[];
  unknowns: readonly string[];
  completeness: "COMPLETE" | "PARTIAL" | "NONE";
}>;

export const ALTERNATIVE_KINDS = [
  "NO_ACTION",
  "WAIT_FOR_EVIDENCE",
  "PAPER",
  "MANUAL_EXACT_ACTION",
] as const;

export type AlternativeKind = (typeof ALTERNATIVE_KINDS)[number];

export type AdviceAlternative = Readonly<{
  kind: AlternativeKind;
  label: string;
  rationale: string;
  available: boolean;
  unavailableReason: string | null;
}>;

export const DISPOSITION_STATES = [
  "PENDING",
  "NO_ACTION",
  "PAPER",
  "MANUAL",
  "EXACT_ACTION_REVIEW",
] as const;

export type DispositionState = (typeof DISPOSITION_STATES)[number];

/**
 * The human's decision, or the honest absence of one.
 *
 * The union is what enforces the rule: a recorded disposition cannot exist
 * without the time it was recorded and the store it came from, and a `PENDING`
 * one cannot exist without a reason. There is no third shape where a decision
 * appears with nothing behind it.
 */
export type HumanDisposition =
  | Readonly<{
      state: "PENDING";
      recordedAt: null;
      recordedBy: null;
      source: null;
      note: null;
      reason: string;
    }>
  | Readonly<{
      state: Exclude<DispositionState, "PENDING">;
      recordedAt: string;
      recordedBy: "USER";
      source: string;
      note: string | null;
      reason: null;
    }>;

export type RiskReference =
  | Readonly<{
      state: "ATTACHED";
      schemaVersion: string;
      formulaVersion: string;
      inputDigest: string;
      scopeId: string;
      bindingConstraintIds: readonly string[];
      unknowns: readonly string[];
    }>
  | Readonly<{ state: "UNAVAILABLE"; reason: string }>;

export type ActionRef = Readonly<{
  actionRef: string;
  kind: string;
  book: "PAPER" | "LIVE";
}>;

/**
 * What was actually observed after the action, and by whom.
 *
 * `authoritative` is the whole gate on a receipt. A paper close is authoritative
 * for the paper book and for nothing else; a venue fill is authoritative for the
 * venue. Anything a reader typed, guessed or expected is neither.
 */
export type ObservedOutcome = Readonly<{
  observedAt: string;
  observedBy: string;
  authoritative: boolean;
  book: "PAPER" | "LIVE";
  effects: readonly string[];
  realizedAmount: string | null;
  realizedCurrency: string | null;
}>;

export type JournalReview =
  | Readonly<{
      state: "RECORDED";
      recordedAt: string | null;
      followedPlan: boolean | null;
      mistakeTag: string | null;
      lesson: string | null;
    }>
  | Readonly<{ state: "MISSING"; reason: string }>;

export type InvestorContextBinding =
  | Readonly<{ state: "BOUND"; version: number; reason: null }>
  | Readonly<{ state: "NOT_SERVER_READABLE"; version: null; reason: string }>
  | Readonly<{ state: "MISSING"; version: null; reason: string }>;

export const ADVICE_STAGES = [
  "TRIGGERED",
  "EVIDENCE",
  "DECISION",
  "ACTION",
  "OUTCOME",
  "REVIEWED",
] as const;

export type AdviceStage = (typeof ADVICE_STAGES)[number];

export type AdviceCase = Readonly<{
  caseId: string;
  /** Always `"NONE"`. Ryntra issues no personalized recommendation. */
  adviceAuthority: typeof ADVICE_AUTHORITY;
  /** Always `null`, and typed so that it can hold nothing else. */
  recommendation: null;
  ownerRef: string;
  asOf: string;
  investorContext: InvestorContextBinding;
  trigger: AdviceTrigger;
  evidence: EvidenceBundle;
  alternatives: readonly AdviceAlternative[];
  risk: RiskReference;
  disposition: HumanDisposition;
  action: ActionRef | null;
  outcome: ObservedOutcome | null;
  review: JournalReview;
  stage: AdviceStage;
  /** What this case needs next, in one sentence. */
  openQuestion: string;
}>;

export type AdviceCaseInput = Readonly<{
  ownerRef: string;
  asOf: string;
  investorContext: InvestorContextBinding;
  trigger: AdviceTrigger;
  evidence: readonly EvidenceItem[];
  conflicts: readonly ConflictEntry[];
  unknowns: readonly string[];
  risk: RiskReference;
  disposition: HumanDisposition;
  action: ActionRef | null;
  outcome: ObservedOutcome | null;
  review: JournalReview;
}>;

/**
 * A short content digest over an ordered list of parts.
 *
 * Length-prefixed rather than delimiter-joined, because a delimiter that can
 * occur inside a part is a collision waiting for the one input that contains
 * it: `["ab", "c"]` and `["a", "bc"]` would digest identically under any plain
 * separator, and two different cases sharing an id is the worst failure this
 * module could have.
 */
function digest(prefix: string, parts: readonly string[]): string {
  const canonical = parts.map((part) => `${part.length}:${part}`).join("|");
  return `${prefix}_${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

function bundle(input: AdviceCaseInput): EvidenceBundle {
  const items = [...input.evidence];
  const degraded = items.some((item) => item.state !== "OK");
  const completeness: EvidenceBundle["completeness"] =
    items.length === 0
      ? "NONE"
      : degraded || input.conflicts.length > 0 || input.unknowns.length > 0
        ? "PARTIAL"
        : "COMPLETE";
  return Object.freeze({
    bundleId: digest("evb", items.map((item) => `${item.sourceId}|${item.ref}|${item.state}|${item.observedAt ?? ""}`)),
    items: Object.freeze(items),
    /* Both sides of every disagreement, in the order the engine reported them.
       Nothing here picks a winner and nothing here computes a midpoint: a
       midpoint of two contradictory readings is a number no source stated. */
    conflicts: Object.freeze([...input.conflicts]),
    unknowns: Object.freeze([...input.unknowns]),
    completeness,
  });
}

/**
 * The alternatives, derived rather than supplied.
 *
 * Derived because the invariant lives here: **every set contains no-action**. A
 * case that offers only ways to act is a recommendation with extra steps, and
 * leaving the set to the caller is how that eventually ships.
 */
function alternatives(input: AdviceCaseInput, evidence: EvidenceBundle): readonly AdviceAlternative[] {
  const outstanding =
    evidence.unknowns.length > 0 || evidence.conflicts.length > 0 || evidence.completeness !== "COMPLETE";
  const paperRoute = input.trigger.subjectKind === "VENUE_MARKET" || input.trigger.subjectKind === "PAPER_TRADE";

  return Object.freeze([
    Object.freeze({
      kind: "NO_ACTION" as const,
      label: "Do nothing",
      rationale: "Nothing in this case obliges a trade. Deciding not to act is a decision and it belongs in the record.",
      available: true,
      unavailableReason: null,
    }),
    Object.freeze({
      kind: "WAIT_FOR_EVIDENCE" as const,
      label: "Wait for evidence",
      rationale: outstanding
        ? `Something on this read is still outstanding: ${describeOutstanding(evidence)}`
        : "Every required fact on this read was supplied by a source.",
      available: outstanding,
      unavailableReason: outstanding
        ? null
        : "Every required fact on this read was supplied by a source, no source disagreed with another, and nothing is outstanding to wait for.",
    }),
    Object.freeze({
      kind: "PAPER" as const,
      label: "Plan it on paper",
      rationale: paperRoute
        ? "The paper book covers this market, so a plan can be written and closed without money moving."
        : "The paper book covers Arcus perpetual markets only.",
      available: paperRoute,
      unavailableReason: paperRoute
        ? null
        : "The paper book covers Arcus perpetual markets. This subject is not one of them, so no paper route exists for it and offering one would fail at the point of use.",
    }),
    Object.freeze({
      kind: "MANUAL_EXACT_ACTION" as const,
      label: "Act yourself at the venue",
      rationale:
        "Ryntra transmits no order and holds no key. An action you take at the venue becomes visible here only when the venue reports it.",
      available: true,
      unavailableReason: null,
    }),
  ]);
}

function describeOutstanding(evidence: EvidenceBundle): string {
  if (evidence.completeness === "NONE") return "no source answered on this read.";
  if (evidence.conflicts.length > 0) return "two sources disagree about the same fact.";
  if (evidence.unknowns.length > 0) return evidence.unknowns[0];
  const degraded = evidence.items.find((item) => item.state !== "OK");
  return degraded?.reason ?? "a source did not answer normally.";
}

function stageOf(input: AdviceCaseInput, evidence: EvidenceBundle): AdviceStage {
  if (input.review.state === "RECORDED") return "REVIEWED";
  if (input.outcome !== null) return "OUTCOME";
  if (input.action !== null) return "ACTION";
  if (input.disposition.state !== "PENDING") return "DECISION";
  if (evidence.items.length > 0) return "EVIDENCE";
  return "TRIGGERED";
}

/**
 * The one sentence a reader needs, matched to where the chain actually stops.
 *
 * The `DECISION` and `TRIGGERED` answers name a product limit rather than a
 * reader's oversight, because that is what is true: there is nowhere to record
 * a disposition in this release, and saying "waiting on you" about a control
 * that does not exist would be blaming the reader for a missing feature.
 */
function openQuestion(stage: AdviceStage, input: AdviceCaseInput): string {
  if (stage === "REVIEWED") return "This cycle is complete: decided, acted, observed and reviewed.";
  if (stage === "OUTCOME") return "The outcome is observed. No review is recorded against it yet.";
  if (stage === "ACTION") return "The action is open. No outcome has been observed, so no receipt exists.";
  if (stage === "DECISION") {
    return input.disposition.state === "NO_ACTION"
      ? "The decision was to do nothing, so there is no action and no outcome to observe."
      : "The decision is recorded. No exact action is linked to it in a store this surface can read.";
  }
  if (stage === "EVIDENCE") {
    return "Evidence is gathered and no decision is recorded. Recording one needs storage this release does not add.";
  }
  return "No source answered for this subject on this read, so there is nothing yet to decide on.";
}

export function compileAdviceCase(input: AdviceCaseInput): AdviceCase {
  const evidence = bundle(input);
  const stage = stageOf(input, evidence);
  return Object.freeze({
    /* Identity is the owner and the trigger — not `asOf`. A case whose id moved
       on every render would break every link into it within a minute. */
    caseId: digest("adv", [
      input.ownerRef,
      input.trigger.kind,
      input.trigger.ref,
      input.trigger.subjectRef,
      input.trigger.factKey ?? "",
    ]),
    /* Written here, read from nowhere. A caller cannot pass either of these in:
       that is the difference between a rule and a default. */
    adviceAuthority: ADVICE_AUTHORITY,
    recommendation: null,
    ownerRef: input.ownerRef,
    asOf: input.asOf,
    investorContext: input.investorContext,
    trigger: input.trigger,
    evidence,
    alternatives: alternatives(input, evidence),
    risk: input.risk,
    disposition: input.disposition,
    action: input.action,
    outcome: input.outcome,
    review: input.review,
    stage,
    openQuestion: openQuestion(stage, input),
  });
}

/** Cases a human still has to decide, in the order they should be read. */
export function decisionQueue(cases: readonly AdviceCase[]): readonly AdviceCase[] {
  return Object.freeze(
    cases
      .filter((entry) => entry.disposition.state === "PENDING")
      .slice()
      .sort((left, right) => {
        const byConflict = Number(right.evidence.conflicts.length > 0) - Number(left.evidence.conflicts.length > 0);
        if (byConflict !== 0) return byConflict;
        const byObserved = (right.trigger.observedAt ?? "").localeCompare(left.trigger.observedAt ?? "");
        if (byObserved !== 0) return byObserved;
        return left.caseId.localeCompare(right.caseId);
      }),
  );
}
