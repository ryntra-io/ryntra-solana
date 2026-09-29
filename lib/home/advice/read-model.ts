import type { MaterialChange } from "../research/change.ts";
import {
  compileAdviceCase,
  decisionQueue,
  type AdviceCase,
  type AdviceSubjectKind,
  type EvidenceItem,
  type HumanDisposition,
  type InvestorContextBinding,
  type JournalReview,
  type ObservedOutcome,
  type RiskReference,
} from "./advice-case.ts";
import {
  projectHomeActionCase,
  type HomeActionCase,
  type HomeExactAction,
} from "./action-case.ts";
import { projectActivity, type ActivityIndex, type ActivitySource } from "./activity.ts";
import { projectJournal, type JournalProjection } from "./journal.ts";
import { projectReceiptIndex, type ReceiptIndex } from "./receipt.ts";

/**
 * The decisions surface, as one pure projection.
 *
 * Two things become an AdviceCase here, and they are deliberately different
 * shapes rather than one blurred one:
 *
 *   A **material change** the Radar detected becomes a case with a
 *   `MATERIAL_CHANGE` trigger and a `PENDING` disposition. Nobody has decided
 *   anything about it, and this release has nowhere to record a decision, so
 *   that is what it says.
 *
 *   An **exact action** the reader already took — a paper trade, a venue fill —
 *   becomes a case with a `USER_INITIATED` trigger and a *recorded* disposition,
 *   because opening it was the decision and the store that holds it also holds
 *   when and where.
 *
 * **The two are never joined.** An open paper trade on TSLA and a material
 * change on TSLA share a ticker and nothing else; treating the first as the
 * reader's answer to the second would invent a causal link no record contains.
 * A test refuses exactly that.
 *
 * Pure throughout: every effect happens in the route's `read.ts`, so every
 * state this surface can render is reachable in a test by handing this function
 * a literal.
 */

export type DecisionsInput = Readonly<{
  asOf: string;
  ownerRef: string;
  investorContext: InvestorContextBinding;
  changes: readonly MaterialChange[];
  actions: readonly HomeExactAction[];
  /** Reviews keyed by the action they were written about. */
  reviews: readonly (readonly [string, JournalReview])[];
  risk: RiskReference;
  sources: readonly ActivitySource[];
  recovery: readonly string[];
}>;

export type DecisionsProjection = Readonly<{
  asOf: string;
  ownerRef: string;
  state: "EMPTY" | "CALM" | "ATTENTION" | "DEGRADED";
  investorContext: InvestorContextBinding;
  /** Cases waiting on a human, most material first. */
  queue: readonly AdviceCase[];
  cases: readonly AdviceCase[];
  actions: readonly HomeActionCase[];
  receipts: ReceiptIndex;
  activity: ActivityIndex;
  journal: JournalProjection;
  sources: readonly ActivitySource[];
  recovery: readonly string[];
  counts: Readonly<{
    cases: number;
    queue: number;
    actions: number;
    openActions: number;
    receipts: number;
  }>;
}>;

/**
 * Why every change-raised case is `PENDING`, spelled out where it is decided.
 *
 * This sentence is the honest half of the packet. There is no control anywhere
 * in this release that records a disposition, so there is no store that could
 * report one, so `PENDING` is not a default that a later read might improve on
 * — it is the whole truth about this case until persistence is added.
 */
const PENDING_REASON =
  "No disposition is recorded for this case. Recording one needs storage this release deliberately does not add, and no decision is inferred from a nearby action.";

const NO_REVIEW_REASON =
  "No review is recorded against this outcome. The journal writes one from the paper book or the live notes, and neither carries one for this action.";

const SUBJECT_KIND: Readonly<Record<string, AdviceSubjectKind>> = {
  HOLDING: "VENUE_MARKET",
  CHAIN: "VENUE_MARKET",
  STRATEGY: "PAPER_TRADE",
  ISSUER: "STOCK_TOKEN",
  EXPLICIT_ASSET: "STOCK_TOKEN",
  WATCHLIST: "OTHER",
  MACRO_EVENT: "OTHER",
};

function evidenceFromChange(change: MaterialChange, sources: readonly ActivitySource[]): readonly EvidenceItem[] {
  return change.sources.map((sourceId, index) => {
    const known = sources.find((entry) => entry.sourceId === sourceId);
    const state: EvidenceItem["state"] =
      known === undefined ? "OK" : known.state === "OK" ? "OK" : known.state === "STALE" ? "STALE" : "FAILED";
    return Object.freeze({
      sourceId,
      label: known?.label ?? sourceId,
      entitlement: known?.entitlement ?? "PROVIDER_PUBLIC",
      observedAt: change.observedAt,
      ref: change.evidenceRefs[index] ?? `evidence:${sourceId}:${change.subjectRef}`,
      state,
      reason: state === "OK" ? null : (known?.reason ?? null),
    });
  });
}

function detailOf(change: MaterialChange): string {
  if (change.state === "CONFLICT") {
    return `${change.conflict.length} sources report a different ${change.factKey} for ${change.subjectLabel}.`;
  }
  if (change.state === "UNKNOWN") {
    return change.unknown[0] ?? `A required ${change.factKey} was not supplied for ${change.subjectLabel}.`;
  }
  if (change.measured !== null && change.threshold !== null) {
    return `${change.factKey} moved ${change.measured.value}${change.measured.unit === null ? "" : ` ${change.measured.unit}`} against a ${change.threshold.value ?? "state"} threshold.`;
  }
  return `${change.kind} on ${change.factKey} for ${change.subjectLabel}.`;
}

function caseFromChange(change: MaterialChange, input: DecisionsInput): AdviceCase {
  return compileAdviceCase({
    ownerRef: input.ownerRef,
    asOf: input.asOf,
    investorContext: input.investorContext,
    trigger: {
      kind: "MATERIAL_CHANGE",
      ref: change.id,
      subjectRef: change.subjectRef,
      subjectLabel: change.subjectLabel,
      subjectKind: SUBJECT_KIND[change.scopeKind] ?? "OTHER",
      factKey: change.factKey,
      observedAt: change.observedAt,
      ruleId: change.ruleId,
      detail: detailOf(change),
    },
    evidence: evidenceFromChange(change, input.sources),
    conflicts: change.conflict,
    unknowns: change.unknown,
    risk: input.risk,
    disposition: {
      state: "PENDING",
      recordedAt: null,
      recordedBy: null,
      source: null,
      note: null,
      reason: PENDING_REASON,
    },
    action: null,
    outcome: null,
    review: { state: "MISSING", reason: NO_REVIEW_REASON },
  });
}

/**
 * The disposition an exact action carries by existing.
 *
 * A paper trade in the book *is* a recorded paper decision: the store holds
 * what was opened, when, and at what plan. A venue fill is a recorded manual
 * decision: the reader acted at the venue themselves, and the venue reported
 * it. Neither is inferred — both are read from the record that holds them.
 */
function dispositionOf(action: HomeExactAction): HumanDisposition {
  const recordedAt = action.openedAt ?? action.closedAt;
  if (recordedAt === null) {
    return {
      state: "PENDING",
      recordedAt: null,
      recordedBy: null,
      source: null,
      note: null,
      reason: "This action carries no recorded time, so nothing can be said about when it was decided.",
    };
  }
  return action.kind === "PAPER_TRADE"
    ? { state: "PAPER", recordedAt, recordedBy: "USER", source: "Paper book", note: action.plan.rationale, reason: null }
    : { state: "MANUAL", recordedAt, recordedBy: "USER", source: action.venue, note: null, reason: null };
}

function outcomeOf(action: HomeExactAction): ObservedOutcome | null {
  if (action.closedAt === null) return null;
  const realized =
    action.realizedAmount === null
      ? "no realized amount was reported"
      : `${action.realizedAmount}${action.realizedCurrency === null ? "" : ` ${action.realizedCurrency}`}`;
  return Object.freeze({
    observedAt: action.closedAt,
    /* Who authoritatively observed it. The paper book is authoritative for the
       paper book; the venue is authoritative for its own fill. Neither is
       authoritative for the other, and the receipt index keeps them apart. */
    observedBy: action.kind === "PAPER_TRADE" ? "Paper book" : action.venue,
    authoritative: true,
    book: action.book,
    effects: Object.freeze([
      `Closed${action.exitReason === null ? "" : ` on ${action.exitReason}`}: ${realized}.`,
    ]),
    realizedAmount: action.realizedAmount,
    realizedCurrency: action.realizedCurrency,
  });
}

function caseFromAction(
  action: HomeExactAction,
  input: DecisionsInput,
  review: JournalReview,
): AdviceCase {
  return compileAdviceCase({
    ownerRef: input.ownerRef,
    asOf: input.asOf,
    investorContext: input.investorContext,
    trigger: {
      kind: "USER_INITIATED",
      ref: action.actionRef,
      subjectRef: action.subjectRef,
      subjectLabel: action.subjectLabel,
      subjectKind: action.kind === "PAPER_TRADE" ? "PAPER_TRADE" : "VENUE_MARKET",
      factKey: null,
      observedAt: action.openedAt,
      ruleId: null,
      detail: `${action.side} ${action.size ?? "an unstated size"} ${action.subjectLabel} on ${action.venue}.`,
    },
    evidence: [],
    conflicts: [],
    unknowns: [],
    risk: input.risk,
    disposition: dispositionOf(action),
    action: { actionRef: action.actionRef, kind: action.kind, book: action.book },
    outcome: outcomeOf(action),
    review,
  });
}

function surfaceState(input: {
  cases: readonly AdviceCase[];
  queue: readonly AdviceCase[];
  sources: readonly ActivitySource[];
  recovery: readonly string[];
}): DecisionsProjection["state"] {
  if (input.recovery.length > 0 || input.sources.some((source) => source.state !== "OK")) return "DEGRADED";
  if (input.cases.length === 0) return "EMPTY";
  if (input.queue.length > 0) return "ATTENTION";
  return "CALM";
}

export function projectDecisions(input: DecisionsInput): DecisionsProjection {
  const reviews = new Map(input.reviews);

  const fromChanges = input.changes.map((change) => caseFromChange(change, input));
  const fromActions = input.actions.map((action) =>
    caseFromAction(action, input, reviews.get(action.actionRef) ?? { state: "MISSING", reason: NO_REVIEW_REASON }),
  );
  const cases = [...fromChanges, ...fromActions];

  const actionCases = input.actions.map((action, index) => {
    const advice = fromActions[index];
    return projectHomeActionCase({
      action,
      caseId: advice.caseId,
      evidenceCompleteness: advice.evidence.completeness,
      risk: input.risk,
      review: advice.review,
    });
  });

  const receipts = projectReceiptIndex(
    cases.map((advice) => ({
      caseId: advice.caseId,
      actionRef: advice.action?.actionRef ?? null,
      subjectLabel: advice.trigger.subjectLabel,
      outcome: advice.outcome,
    })),
  );

  const activity = projectActivity({
    asOf: input.asOf,
    cases,
    changes: input.changes.map((change) => ({
      id: change.id,
      subjectRef: change.subjectRef,
      subjectLabel: change.subjectLabel,
      factKey: change.factKey,
      kind: change.kind,
      state: change.state,
      observedAt: change.observedAt,
      sources: change.sources,
    })),
    sources: input.sources,
  });

  /* The Journal reads the same cases rather than a second pass over the same
     stores. Two independent readings of one record is how two surfaces end up
     disagreeing about what a reader did. */
  const journal = projectJournal({
    asOf: input.asOf,
    entries: fromActions.map((advice, index) => ({ case: advice, plan: input.actions[index].plan })),
  });

  const queue = decisionQueue(cases);

  return Object.freeze({
    asOf: input.asOf,
    ownerRef: input.ownerRef,
    state: surfaceState({ cases, queue, sources: input.sources, recovery: input.recovery }),
    investorContext: input.investorContext,
    queue,
    cases: Object.freeze(cases),
    actions: Object.freeze(actionCases),
    receipts,
    activity,
    journal,
    sources: Object.freeze([...input.sources]),
    recovery: Object.freeze([...input.recovery]),
    counts: Object.freeze({
      cases: cases.length,
      queue: queue.length,
      actions: actionCases.length,
      openActions: actionCases.filter((entry) => !entry.closed).length,
      receipts: receipts.count,
    }),
  });
}

export function findDecisionCase(
  projection: DecisionsProjection,
  id: string,
): Readonly<{ case: AdviceCase; action: HomeActionCase | null }> | null {
  /* One id space with two spellings, and no redirect between them: a reader who
     arrives with an action ref lands on the case that owns it. */
  const advice =
    projection.cases.find((entry) => entry.caseId === id) ??
    projection.cases.find((entry) => entry.action?.actionRef === id) ??
    null;
  if (advice === null) return null;
  return Object.freeze({
    case: advice,
    action: projection.actions.find((entry) => entry.caseId === advice.caseId) ?? null,
  });
}
