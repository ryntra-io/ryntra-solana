import assert from "node:assert/strict";
import test from "node:test";

import { projectWorkbench } from "./read-model.ts";

const answerInput = (overrides = {}) => ({
  asOf: "2026-08-23T10:00:00.000Z",
  question: {
    questionId: "rq_change_ch1",
    prompt: "What changed on TSLA-USD, and what does it touch that I hold?",
    operation: "EXPLAIN",
    subjectLabel: "TSLA-USD",
    subjectHref: "/app/research",
  },
  plainAnswer: "A scheduled corporate action is declared on TSLA-USD and you carry it in one book.",
  facts: [
    {
      key: "multiplier",
      statement: "TSLA-USD carries a uiMultiplier of 1.000000.",
      value: "1.000000",
      sourceId: "rhj",
      sourceLabel: "Robinhood stock tokens",
      observedAt: "2026-08-23T09:00:00.000Z",
      freshness: "CURRENT",
      entitlement: "PUBLIC",
    },
  ],
  conflicts: [],
  unknowns: [],
  scenarios: [],
  relevance: { state: "RELEVANT", positions: ["TSLA-USD"], plans: [], reason: null },
  deterministic: {
    statement: "TSLA-USD is 42.10% of priced value against a 25.00% limit.",
    value: "42.10%",
    basis: "PRICED_POSITIONS_AT_AS_OF",
    inputDigest: "0xabc",
  },
  risk: { state: "AVAILABLE", reference: "portfolio", reason: null },
  nextSteps: [{ kind: "REVIEW_EVIDENCE", label: "Open the change", href: "/app/research", reason: null }],
  sourceVersions: [{ sourceId: "rhj", label: "Robinhood stock tokens", version: "rhj-1" }],
  ...overrides,
});

const input = (overrides = {}) => ({
  asOf: "2026-08-23T10:00:00.000Z",
  context: {
    changes: [{ changeId: "ch1", subjectLabel: "TSLA-USD", state: "MATERIAL", conflictCount: 0, unknownCount: 0 }],
    conflicts: [],
    riskCategories: [],
    coverage: "COMPLETE",
    queue: [],
    holdings: [{ label: "TSLA-USD" }],
  },
  answerInputs: [["rq_change_ch1", answerInput()]],
  selectedQuestionId: null,
  drafts: [],
  recovery: [],
  ...overrides,
});

test("with nothing in scope the workbench is empty and says why, rather than offering a text field", () => {
  const projection = projectWorkbench(
    input({
      context: { changes: [], conflicts: [], riskCategories: [], coverage: "COMPLETE", queue: [], holdings: [] },
      answerInputs: [],
    }),
  );
  assert.equal(projection.state, "EMPTY");
  assert.deepEqual(projection.questions, []);
  assert.equal(projection.answer, null);
  assert.ok(projection.emptyReason.length > 0);
});

test("with no question selected the first one is answered rather than none", () => {
  const projection = projectWorkbench(input());
  assert.equal(projection.selectedQuestionId, "rq_change_ch1");
  assert.equal(projection.answer.question.questionId, "rq_change_ch1");
  assert.equal(projection.answer.sections.length, 8);
});

test("a question with no compiled input answers nothing and states the gap", () => {
  const projection = projectWorkbench(input({ answerInputs: [] }));
  assert.equal(projection.answer, null);
  assert.ok(projection.answerReason.length > 0);
  assert.equal(projection.questions.length, 1, "the question stays listed even when it cannot be answered");
});

test("an unknown selection falls back to the first question rather than to nothing", () => {
  const projection = projectWorkbench(input({ selectedQuestionId: "rq_nothing" }));
  assert.equal(projection.selectedQuestionId, "rq_change_ch1");
});

test("the four operations are always listed, whatever is in scope", () => {
  for (const projection of [projectWorkbench(input()), projectWorkbench(input({ answerInputs: [] }))]) {
    assert.deepEqual(
      projection.operations.map((operation) => operation.operation),
      ["EXPLAIN", "FORMALIZE", "COMPARE", "REVIEW"],
    );
  }
});

test("a conflict or a blocking unknown makes the surface attention rather than calm", () => {
  assert.equal(projectWorkbench(input()).state, "CALM");
  const conflicted = projectWorkbench(
    input({
      answerInputs: [[
        "rq_change_ch1",
        answerInput({
          conflicts: [
            {
              conflictId: "c1",
              subject: "TSLA-USD mark",
              readings: [
                { sourceId: "arcus", label: "Arcus", value: "441.20", observedAt: "2026-08-23T09:59:00.000Z" },
                { sourceId: "rhj", label: "Robinhood", value: "439.80", observedAt: "2026-08-23T09:58:00.000Z" },
              ],
              reason: "Two venues disagree.",
            },
          ],
        }),
      ]],
    }),
  );
  assert.equal(conflicted.state, "ATTENTION");
});

test("a failed read is degraded and carries its recovery lines", () => {
  const projection = projectWorkbench(input({ recovery: ["The research read did not complete."] }));
  assert.equal(projection.state, "DEGRADED");
  assert.deepEqual(projection.recovery, ["The research read did not complete."]);
});

test("a draft that reaches the surface is unsaved and cannot be saved from here", () => {
  const projection = projectWorkbench(
    input({
      drafts: [
        {
          draftId: "drf_000000000000",
          kind: "MONITOR_RULE",
          label: "Watch TSLA-USD",
          state: "UNSAVED",
          savePolicy: "EXPLICIT_USER_REVIEW_AND_SAVE",
          autoSaveCapable: false,
          savedAt: null,
          savedBy: null,
          owner: { surface: "Research", href: "/app/research" },
          saveControl: { state: "NOT_BUILT", reason: "Needs storage this release does not add." },
          fields: [{ key: "subject", value: "TSLA-USD", origin: "USER" }],
        },
      ],
    }),
  );
  assert.equal(projection.drafts.length, 1);
  assert.equal(projection.drafts[0].state, "UNSAVED");
  assert.equal(projection.savedAnything, false);
});

test("the same input always projects the same workbench", () => {
  assert.deepEqual(projectWorkbench(input()), projectWorkbench(input()));
});
