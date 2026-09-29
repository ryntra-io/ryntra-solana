import { createHash } from "node:crypto";

import type { AdviceCase } from "./advice-case.ts";
import type { Entitlement } from "../research/mandate.ts";

/**
 * The global typed event index.
 *
 * "Global" is the load-bearing word. Home already had four places where
 * something happened — a change was detected, a case was raised, a trade was
 * closed, a note was written — and no single place where a reader could see
 * them in order. This is that place, and it is typed rather than free text so
 * that a surface can style, filter and count events without parsing sentences.
 *
 * The vocabulary is a **closed union**. An event is built by one of the
 * functions below or it is not built at all, so no caller can invent a kind and
 * no surface has to handle one it has never seen.
 *
 * Nothing here observes anything. Every event is derived from a record that
 * already exists, so the index cannot claim an event that did not happen — and
 * `RECEIPT_ISSUED` in particular follows the same rule as the receipt itself:
 * no authoritative observed outcome, no event.
 */

export const ACTIVITY_KINDS = [
  "RESEARCH_CHANGE_DETECTED",
  "ADVICE_CASE_RAISED",
  "DECISION_RECORDED",
  "ACTION_EXECUTED",
  "OUTCOME_OBSERVED",
  "RECEIPT_ISSUED",
  "JOURNAL_REVIEW_RECORDED",
  "SOURCE_DEGRADED",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivityEvent = Readonly<{
  eventId: string;
  kind: ActivityKind;
  at: string;
  subjectRef: string;
  subjectLabel: string;
  caseId: string | null;
  actionRef: string | null;
  book: "PAPER" | "LIVE" | "NONE";
  sourceId: string;
  summary: string;
}>;

export type ActivityIndex = Readonly<{
  asOf: string;
  events: readonly ActivityEvent[];
  counts: Readonly<Record<ActivityKind, number>>;
}>;

/** The minimum a change has to state to become an event. */
export type ActivityChange = Readonly<{
  id: string;
  subjectRef: string;
  subjectLabel: string;
  factKey: string;
  kind: string;
  state: string;
  observedAt: string | null;
  sources: readonly string[];
}>;

export type ActivitySource = Readonly<{
  sourceId: string;
  label: string;
  state: string;
  reason: string | null;
  entitlement: Entitlement;
}>;

export type ActivityInput = Readonly<{
  asOf: string;
  cases: readonly AdviceCase[];
  changes: readonly ActivityChange[];
  sources: readonly ActivitySource[];
}>;

function eventId(kind: ActivityKind, parts: readonly string[]): string {
  return `evt_${createHash("sha256").update([kind, ...parts].join(" ")).digest("hex").slice(0, 12)}`;
}

function event(
  kind: ActivityKind,
  at: string,
  fields: Omit<ActivityEvent, "eventId" | "kind" | "at">,
): ActivityEvent {
  return Object.freeze({
    eventId: eventId(kind, [fields.subjectRef, fields.caseId ?? "", fields.actionRef ?? "", at]),
    kind,
    at,
    ...fields,
  });
}

function fromChange(change: ActivityChange, asOf: string): ActivityEvent {
  return event("RESEARCH_CHANGE_DETECTED", change.observedAt ?? asOf, {
    subjectRef: change.subjectRef,
    subjectLabel: change.subjectLabel,
    caseId: null,
    actionRef: change.id,
    book: "NONE",
    sourceId: change.sources[0] ?? "research",
    summary: `${change.state} · ${change.kind} on ${change.factKey}.`,
  });
}

function fromCase(advice: AdviceCase, asOf: string): readonly ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const subject = { subjectRef: advice.trigger.subjectRef, subjectLabel: advice.trigger.subjectLabel };

  events.push(
    event("ADVICE_CASE_RAISED", advice.trigger.observedAt ?? asOf, {
      ...subject,
      caseId: advice.caseId,
      actionRef: null,
      book: advice.action?.book ?? "NONE",
      sourceId: advice.trigger.ruleId ?? "user",
      summary: advice.trigger.detail,
    }),
  );

  if (advice.disposition.state !== "PENDING") {
    events.push(
      event("DECISION_RECORDED", advice.disposition.recordedAt, {
        ...subject,
        caseId: advice.caseId,
        actionRef: advice.action?.actionRef ?? null,
        book: advice.action?.book ?? "NONE",
        sourceId: advice.disposition.source,
        summary: `Disposition ${advice.disposition.state}, recorded by ${advice.disposition.source}.`,
      }),
    );
  }

  if (advice.action !== null) {
    events.push(
      event("ACTION_EXECUTED", advice.disposition.recordedAt ?? advice.trigger.observedAt ?? asOf, {
        ...subject,
        caseId: advice.caseId,
        actionRef: advice.action.actionRef,
        book: advice.action.book,
        sourceId: advice.action.kind,
        summary: `${advice.action.kind === "PAPER_TRADE" ? "Simulated by the paper book" : "Reported as a venue fill"}: ${advice.action.actionRef}.`,
      }),
    );
  }

  if (advice.outcome !== null) {
    const { outcome } = advice;
    events.push(
      event("OUTCOME_OBSERVED", outcome.observedAt, {
        ...subject,
        caseId: advice.caseId,
        actionRef: advice.action?.actionRef ?? null,
        book: outcome.book,
        sourceId: outcome.observedBy,
        summary: outcome.effects[0] ?? `Observed by ${outcome.observedBy}.`,
      }),
    );
    /* The same gate the receipt itself applies. An event saying a receipt was
       issued, beside a surface saying none exists, is the drift this index was
       supposed to remove. */
    if (outcome.authoritative && advice.action !== null) {
      events.push(
        event("RECEIPT_ISSUED", outcome.observedAt, {
          ...subject,
          caseId: advice.caseId,
          actionRef: advice.action.actionRef,
          book: outcome.book,
          sourceId: outcome.observedBy,
          summary: `Receipt issued against the outcome ${outcome.observedBy} observed.`,
        }),
      );
    }
  }

  if (advice.review.state === "RECORDED") {
    events.push(
      event("JOURNAL_REVIEW_RECORDED", advice.review.recordedAt ?? advice.outcome?.observedAt ?? asOf, {
        ...subject,
        caseId: advice.caseId,
        actionRef: advice.action?.actionRef ?? null,
        book: advice.action?.book ?? "NONE",
        sourceId: "journal",
        summary: advice.review.lesson ?? "A review is recorded against this outcome.",
      }),
    );
  }

  return events;
}

function fromSource(source: ActivitySource, asOf: string): ActivityEvent | null {
  if (source.state === "OK") return null;
  return event("SOURCE_DEGRADED", asOf, {
    subjectRef: `source:${source.sourceId}`,
    subjectLabel: source.label,
    caseId: null,
    actionRef: null,
    book: "NONE",
    sourceId: source.sourceId,
    summary: source.reason ?? `${source.label} reported ${source.state}.`,
  });
}

export function projectActivity(input: ActivityInput): ActivityIndex {
  const collected = [
    ...input.changes.map((change) => fromChange(change, input.asOf)),
    ...input.cases.flatMap((advice) => fromCase(advice, input.asOf)),
    ...input.sources.map((source) => fromSource(source, input.asOf)),
  ].filter((entry): entry is ActivityEvent => entry !== null);

  /* Deduped by identity rather than by position: the same event derived twice
     from two reads of the same records is one event, and the digest is what
     says so. */
  const unique = new Map<string, ActivityEvent>();
  for (const entry of collected) if (!unique.has(entry.eventId)) unique.set(entry.eventId, entry);

  const events = [...unique.values()].sort((left, right) => {
    const byTime = right.at.localeCompare(left.at);
    return byTime !== 0 ? byTime : left.eventId.localeCompare(right.eventId);
  });

  const counts = Object.fromEntries(
    ACTIVITY_KINDS.map((kind) => [kind, events.filter((entry) => entry.kind === kind).length]),
  ) as Record<ActivityKind, number>;

  return Object.freeze({ asOf: input.asOf, events: Object.freeze(events), counts: Object.freeze(counts) });
}
