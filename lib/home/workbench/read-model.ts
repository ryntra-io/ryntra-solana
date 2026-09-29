import { compileRynAnswer, type RynAnswer, type RynAnswerInput, type RynQuestion } from "./answer.ts";
import type { TypedDraft } from "./draft.ts";
import { rynOperations, type RynOperationState } from "./operations.ts";
import { buildRynQuestions, findRynQuestion, type RynQuestionContext } from "./question.ts";

/**
 * The workbench surface's projection: which questions exist, which one is
 * answered, and what the answer could not reach.
 *
 * Two behaviours here are decisions rather than conveniences.
 *
 * **A question that cannot be answered stays listed.** The tempting shape is to
 * build the question list from the answers available, so every row is
 * guaranteed to resolve. That hides the interesting case: something happened in
 * this account, and the evidence to answer a question about it did not arrive.
 * The question stays, `answer` is `null`, and `answerReason` says which.
 *
 * **An unknown selection falls back to the first question, not to nothing.** A
 * stale link, a reload after the Radar moved on, a bookmarked id — none of them
 * should produce a blank workbench, and none of them should silently answer a
 * *different* question while showing the old id either, which is why
 * `selectedQuestionId` is always the question that was actually answered.
 *
 * `savedAnything` is a constant `false` carried on the projection. It exists to
 * be rendered: the reader is told, on the surface, that using this workbench
 * changed nothing.
 */

export type WorkbenchProjection = Readonly<{
  asOf: string;
  state: "EMPTY" | "CALM" | "ATTENTION" | "DEGRADED";
  questions: readonly RynQuestion[];
  selectedQuestionId: string | null;
  answer: RynAnswer | null;
  answerReason: string;
  operations: readonly RynOperationState[];
  drafts: readonly TypedDraft[];
  savedAnything: false;
  emptyReason: string | null;
  recovery: readonly string[];
}>;

export type WorkbenchInput = Readonly<{
  asOf: string;
  context: RynQuestionContext;
  answerInputs: readonly (readonly [string, RynAnswerInput])[];
  selectedQuestionId: string | null;
  drafts: readonly TypedDraft[];
  recovery: readonly string[];
}>;

const EMPTY_REASON =
  "Nothing in this account has raised a question yet. This workbench asks about what you hold, what changed and what is waiting on you, so with none of those there is nothing to ask about.";

export function projectWorkbench(input: WorkbenchInput): WorkbenchProjection {
  const questions = buildRynQuestions(input.context);
  const answers = new Map(input.answerInputs);

  const requested = input.selectedQuestionId === null
    ? null
    : findRynQuestion(questions, input.selectedQuestionId);
  const selected = requested ?? questions[0] ?? null;

  const answerInput = selected === null ? undefined : answers.get(selected.questionId);
  const answer = answerInput === undefined ? null : compileRynAnswer(answerInput);

  const answerReason = answer !== null
    ? ""
    : selected === null
      ? EMPTY_REASON
      : "No source answered this question on this read, so nothing is stated about it. That is a gap in evidence, not a quiet all-clear.";

  const attention = answer !== null
    && (answer.conflicts.length > 0
      || answer.unknowns.some((unknown) => unknown.blocking)
      || answer.result.state === "INSUFFICIENT");

  const state: WorkbenchProjection["state"] = input.recovery.length > 0
    ? "DEGRADED"
    : questions.length === 0
      ? "EMPTY"
      : attention
        ? "ATTENTION"
        : "CALM";

  return {
    asOf: input.asOf,
    state,
    questions,
    selectedQuestionId: selected?.questionId ?? null,
    answer,
    answerReason,
    operations: rynOperations(),
    drafts: input.drafts,
    savedAnything: false,
    emptyReason: questions.length === 0 ? EMPTY_REASON : null,
    recovery: input.recovery,
  };
}
