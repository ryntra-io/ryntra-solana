import type { AdviceCase } from "./advice-case.ts";
import type { HomeActionPlan } from "./action-case.ts";

/**
 * The Journal, as the cycle it actually records.
 *
 * `plan → decision → outcome → conclusion`. The old Journal was a table of
 * closed trades with a lesson column, which is the last quarter of that
 * sentence rendered as a spreadsheet: it could tell a reader what happened and
 * never what they had said would happen.
 *
 * Each link is `RECORDED` or `MISSING`, and a missing link carries the reason
 * it is missing. That distinction is the product: a cycle with three links and
 * a blank is not a cycle with a small gap, it is a cycle whose conclusion was
 * never written, and the difference is exactly what a journal is for.
 *
 * **A missing link never blames the reader for a control that does not exist.**
 * There is nowhere in this release to record a disposition, so a case with no
 * decision says so about the product rather than about the person reading it.
 */

export const JOURNAL_STAGES = ["PLAN", "DECISION", "OUTCOME", "CONCLUSION"] as const;

export type JournalStage = (typeof JOURNAL_STAGES)[number];

export type JournalLinkState = "RECORDED" | "MISSING";

export type JournalCycleLink = Readonly<{
  id: JournalStage;
  label: string;
  state: JournalLinkState;
  summary: string;
  reason: string | null;
}>;

export type JournalCycle = Readonly<{
  caseId: string;
  actionRef: string | null;
  subjectLabel: string;
  book: "PAPER" | "LIVE" | "NONE";
  links: readonly JournalCycleLink[];
  state: "OPEN" | "CLOSED" | "REVIEWED";
  complete: boolean;
  at: string;
}>;

export type JournalStageSummary = Readonly<{
  id: JournalStage;
  label: string;
  recorded: number;
  missing: number;
  state: "COMPLETE" | "PARTIAL" | "EMPTY";
  reason: string | null;
}>;

export type JournalProjection = Readonly<{
  asOf: string;
  state: "EMPTY" | "PARTIAL" | "COMPLETE";
  stages: readonly JournalStageSummary[];
  cycles: readonly JournalCycle[];
  counts: Readonly<{
    cycles: number;
    open: number;
    closed: number;
    reviewed: number;
    /* Counted per book. There is deliberately no combined realized figure:
       adding a simulated result to a real one describes nothing that happened. */
    byBook: Readonly<{ PAPER: number; LIVE: number }>;
  }>;
}>;

export type JournalEntry = Readonly<{
  case: AdviceCase;
  plan: HomeActionPlan;
}>;

export type JournalInput = Readonly<{
  asOf: string;
  entries: readonly JournalEntry[];
}>;

const LABEL: Readonly<Record<JournalStage, string>> = {
  PLAN: "Plan",
  DECISION: "Decision",
  OUTCOME: "Outcome",
  CONCLUSION: "Conclusion",
};

const EMPTY_REASON: Readonly<Record<JournalStage, string>> = {
  PLAN: "No plan is recorded, because no action has been opened with one.",
  DECISION: "No decision is recorded, because no case has reached one.",
  OUTCOME: "No outcome is observed, because no action has closed.",
  CONCLUSION: "No conclusion is written, because no outcome has been observed to write one about.",
};

function link(id: JournalStage, state: JournalLinkState, summary: string, reason: string | null): JournalCycleLink {
  return Object.freeze({ id, label: LABEL[id], state, summary, reason });
}

function planLink(plan: HomeActionPlan): JournalCycleLink {
  const parts = [
    plan.stop === null ? null : `stop ${plan.stop}`,
    plan.target === null ? null : `target ${plan.target}`,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0 && plan.rationale === null) {
    return link(
      "PLAN",
      "MISSING",
      "Nothing was written before this action.",
      "No stop, target or reason was recorded at open. A venue reports a fill; it does not report the plan behind one.",
    );
  }
  const summary = parts.length > 0 ? parts.join(" · ") : "A reason was recorded at open.";
  return link("PLAN", "RECORDED", plan.rationale === null ? summary : `${summary} — ${plan.rationale}`, null);
}

function decisionLink(advice: AdviceCase): JournalCycleLink {
  if (advice.disposition.state === "PENDING") {
    return link("DECISION", "MISSING", "No disposition is recorded against this case.", advice.disposition.reason);
  }
  return link(
    "DECISION",
    "RECORDED",
    `${advice.disposition.state} · recorded by ${advice.disposition.source} at ${advice.disposition.recordedAt}.`,
    null,
  );
}

function outcomeLink(advice: AdviceCase): JournalCycleLink {
  if (advice.outcome === null) {
    return link(
      "OUTCOME",
      "MISSING",
      "No outcome has been observed.",
      advice.action === null
        ? "No exact action is linked to this case, so there is nothing whose outcome could be observed."
        : "The action is still open. Nothing is claimed about how it will end.",
    );
  }
  const realized =
    advice.outcome.realizedAmount === null
      ? "no realized amount was reported"
      : `${advice.outcome.realizedAmount}${advice.outcome.realizedCurrency === null ? "" : ` ${advice.outcome.realizedCurrency}`}`;
  return link(
    "OUTCOME",
    "RECORDED",
    `${advice.outcome.effects[0] ?? "Closed."} Observed by ${advice.outcome.observedBy}: ${realized}.`,
    null,
  );
}

function conclusionLink(advice: AdviceCase): JournalCycleLink {
  if (advice.review.state === "MISSING") {
    return link(
      "CONCLUSION",
      "MISSING",
      "Nothing is written about what this taught.",
      advice.outcome === null
        ? "There is no observed outcome to draw a conclusion from yet."
        : advice.review.reason,
    );
  }
  const parts = [
    advice.review.followedPlan === null
      ? null
      : advice.review.followedPlan
        ? "Followed the plan"
        : "Broke the plan",
    advice.review.mistakeTag === null ? null : `mistake: ${advice.review.mistakeTag}`,
    advice.review.lesson,
  ].filter((part): part is string => part !== null && part !== "");
  return link("CONCLUSION", "RECORDED", parts.join(" · "), null);
}

function cycleOf(entry: JournalEntry): JournalCycle {
  const links = Object.freeze([
    planLink(entry.plan),
    decisionLink(entry.case),
    outcomeLink(entry.case),
    conclusionLink(entry.case),
  ]);
  const complete = links.every((item) => item.state === "RECORDED");
  const state: JournalCycle["state"] =
    entry.case.review.state === "RECORDED" ? "REVIEWED" : entry.case.outcome !== null ? "CLOSED" : "OPEN";

  return Object.freeze({
    caseId: entry.case.caseId,
    actionRef: entry.case.action?.actionRef ?? null,
    subjectLabel: entry.case.trigger.subjectLabel,
    book: entry.case.action?.book ?? "NONE",
    links,
    state,
    complete,
    /* The cycle's own clock: the most recent thing that happened to it, so the
       list reads in the order a person lived it rather than in id order. */
    at:
      entry.case.outcome?.observedAt ??
      (entry.case.disposition.state === "PENDING" ? null : entry.case.disposition.recordedAt) ??
      entry.case.trigger.observedAt ??
      "",
  });
}

function stageSummary(id: JournalStage, cycles: readonly JournalCycle[]): JournalStageSummary {
  const recorded = cycles.filter((cycle) => cycle.links.find((item) => item.id === id)?.state === "RECORDED").length;
  const missing = cycles.length - recorded;
  const state: JournalStageSummary["state"] =
    cycles.length === 0 ? "EMPTY" : missing === 0 ? "COMPLETE" : "PARTIAL";
  return Object.freeze({
    id,
    label: LABEL[id],
    recorded,
    missing,
    state,
    reason: cycles.length === 0 ? EMPTY_REASON[id] : null,
  });
}

export function projectJournal(input: JournalInput): JournalProjection {
  const cycles = input.entries
    .map(cycleOf)
    .sort((left, right) => {
      const byTime = right.at.localeCompare(left.at);
      return byTime !== 0 ? byTime : left.caseId.localeCompare(right.caseId);
    });

  const stages = JOURNAL_STAGES.map((id) => stageSummary(id, cycles));
  const reviewed = cycles.filter((cycle) => cycle.state === "REVIEWED").length;
  const closed = cycles.filter((cycle) => cycle.state === "CLOSED").length;

  return Object.freeze({
    asOf: input.asOf,
    state: cycles.length === 0 ? "EMPTY" : cycles.every((cycle) => cycle.complete) ? "COMPLETE" : "PARTIAL",
    stages: Object.freeze(stages),
    cycles: Object.freeze(cycles),
    counts: Object.freeze({
      cycles: cycles.length,
      open: cycles.filter((cycle) => cycle.state === "OPEN").length,
      closed,
      reviewed,
      byBook: Object.freeze({
        PAPER: cycles.filter((cycle) => cycle.book === "PAPER").length,
        LIVE: cycles.filter((cycle) => cycle.book === "LIVE").length,
      }),
    }),
  });
}
