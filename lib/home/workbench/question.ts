import type { RynQuestion } from "./answer.ts";

/**
 * The bounded question set, built from what the reader actually has.
 *
 * Home canon §7: *Ryn is a first-class contextual workbench, not an empty chat
 * box.* This module is what makes that sentence structural. A question exists
 * because something in this account produced it — a change the Radar measured,
 * two sources that disagree, a constraint outside its limit, value nobody could
 * price, a case waiting on a decision. Nothing in scope means **no questions**,
 * and the surface says so rather than offering a text field over an empty
 * account.
 *
 * **No question asks Ryntra what to do.** Every prompt here is a question about
 * evidence — what changed, who disagrees, what is missing, what is waiting.
 * *Should I sell?* is not phrasing this product has to refuse in the answer,
 * because it is not a question it can be asked.
 *
 * Pure and ordered: same context, same questions, same order, so a reader who
 * reloads gets the list they had rather than a reshuffle.
 */

/** How many questions the list may carry before it stops being readable. */
export const RYN_QUESTION_LIMIT = 12;

export type RynQuestionContext = Readonly<{
  changes: readonly Readonly<{
    changeId: string;
    subjectLabel: string;
    state: string;
    conflictCount: number;
    unknownCount: number;
  }>[];
  conflicts: readonly Readonly<{ conflictId: string; subject: string; sourceCount: number }>[];
  riskCategories: readonly Readonly<{ id: string; status: string }>[];
  coverage: "COMPLETE" | "PARTIAL" | "NONE";
  queue: readonly Readonly<{ caseId: string; subjectLabel: string }>[];
  holdings: readonly Readonly<{ label: string }>[];
}>;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "subject";
}

export function buildRynQuestions(context: RynQuestionContext): readonly RynQuestion[] {
  const questions: RynQuestion[] = [];

  /* Order is fixed and it is the order of urgency, not of arrival: what
     changed, who disagrees, what is outside a limit, what cannot be priced,
     what is waiting on a person. */
  for (const change of context.changes) {
    if (change.state === "IMMATERIAL") continue;
    questions.push({
      questionId: "rq_change_" + slug(change.changeId),
      prompt: "What changed on " + change.subjectLabel + ", and what does it touch that I hold?",
      operation: "EXPLAIN",
      subjectLabel: change.subjectLabel,
      subjectHref: "/app/research",
    });
  }

  for (const conflict of context.conflicts) {
    questions.push({
      questionId: "rq_conflict_" + slug(conflict.conflictId),
      prompt: "Which sources disagree about " + conflict.subject + ", and by how much?",
      operation: "COMPARE",
      subjectLabel: conflict.subject,
      subjectHref: "/app/research",
    });
  }

  for (const category of context.riskCategories) {
    if (category.status === "WITHIN") continue;
    questions.push({
      questionId: "rq_risk_" + slug(category.id),
      prompt:
        "Which " + category.id + " constraint is " + category.status.toLowerCase() + ", and on what basis was it measured?",
      operation: "EXPLAIN",
      subjectLabel: category.id,
      subjectHref: "/app/portfolio",
    });
  }

  if (context.coverage !== "COMPLETE") {
    questions.push({
      questionId: "rq_coverage",
      prompt: "What part of what I hold could not be priced, and why?",
      operation: "EXPLAIN",
      subjectLabel: "Valuation coverage",
      subjectHref: "/app/portfolio",
    });
  }

  for (const entry of context.queue) {
    questions.push({
      questionId: "rq_case_" + slug(entry.caseId),
      prompt: "What is the decision on " + entry.subjectLabel + " waiting on?",
      operation: "EXPLAIN",
      subjectLabel: entry.subjectLabel,
      subjectHref: "/app/action-cases",
    });
  }

  return questions.slice(0, RYN_QUESTION_LIMIT);
}

export function findRynQuestion(
  questions: readonly RynQuestion[],
  questionId: string,
): RynQuestion | null {
  return questions.find((question) => question.questionId === questionId) ?? null;
}
