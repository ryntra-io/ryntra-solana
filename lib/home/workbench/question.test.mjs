import assert from "node:assert/strict";
import test from "node:test";

import { RYN_QUESTION_LIMIT, buildRynQuestions, findRynQuestion } from "./question.ts";

const context = (overrides = {}) => ({
  changes: [
    { changeId: "ch1", subjectLabel: "TSLA-USD", state: "MATERIAL", conflictCount: 0, unknownCount: 0 },
  ],
  conflicts: [],
  riskCategories: [],
  coverage: "COMPLETE",
  queue: [],
  holdings: [{ label: "TSLA-USD" }],
  ...overrides,
});

test("with nothing in scope there is no question, because a workbench is not a chat box", () => {
  const questions = buildRynQuestions({
    changes: [],
    conflicts: [],
    riskCategories: [],
    coverage: "COMPLETE",
    queue: [],
    holdings: [],
  });
  assert.deepEqual(questions, []);
});

test("a material change becomes a question about what it touches", () => {
  const [question] = buildRynQuestions(context());
  assert.equal(question.operation, "EXPLAIN");
  assert.match(question.prompt, /TSLA-USD/);
  assert.equal(question.subjectLabel, "TSLA-USD");
  assert.match(question.subjectHref, /^\/app\/research/);
});

test("a disagreement becomes a Compare question, never an Explain one", () => {
  const questions = buildRynQuestions(
    context({ conflicts: [{ conflictId: "c1", subject: "TSLA-USD mark", sourceCount: 2 }] }),
  );
  const compare = questions.find((question) => question.operation === "COMPARE");
  assert.ok(compare);
  assert.match(compare.prompt, /disagree/i);
});

test("an exceeded constraint and an incomplete coverage each raise their own question", () => {
  const questions = buildRynQuestions(
    context({
      riskCategories: [{ id: "concentration", status: "EXCEEDED" }, { id: "liquidity", status: "WITHIN" }],
      coverage: "PARTIAL",
    }),
  );
  const prompts = questions.map((question) => question.prompt).join(" | ");
  assert.match(prompts, /concentration/i);
  assert.equal(/liquidity/i.test(prompts), false, "a constraint inside its limit is not a question");
  assert.match(prompts, /price|priced/i);
});

test("a case waiting on a decision asks what it is waiting on", () => {
  const questions = buildRynQuestions(context({ queue: [{ caseId: "adv_1", subjectLabel: "TSLA-USD" }] }));
  const waiting = questions.find((question) => question.subjectHref.startsWith("/app/action-cases"));
  assert.ok(waiting);
  assert.match(waiting.prompt, /waiting on/i);
});

test("every question is unique, identified and bounded in number", () => {
  const many = buildRynQuestions(
    context({
      changes: Array.from({ length: 40 }, (unused, index) => ({
        changeId: "ch" + index,
        subjectLabel: "SUB-" + index,
        state: "MATERIAL",
        conflictCount: 0,
        unknownCount: 0,
      })),
    }),
  );
  assert.ok(many.length <= RYN_QUESTION_LIMIT);
  assert.equal(new Set(many.map((question) => question.questionId)).size, many.length);
  for (const question of many) assert.match(question.questionId, /^rq_[a-z0-9_-]+$/);
});

test("the same context always produces the same questions in the same order", () => {
  const first = buildRynQuestions(context({ conflicts: [{ conflictId: "c1", subject: "mark", sourceCount: 2 }] }));
  const second = buildRynQuestions(context({ conflicts: [{ conflictId: "c1", subject: "mark", sourceCount: 2 }] }));
  assert.deepEqual(first, second);
});

test("a question is found by its id, and an unknown id resolves to nothing rather than the first one", () => {
  const questions = buildRynQuestions(context());
  assert.equal(findRynQuestion(questions, questions[0].questionId), questions[0]);
  assert.equal(findRynQuestion(questions, "rq_nothing"), null);
});

test("no question asks Ryntra what to do", () => {
  const questions = buildRynQuestions(
    context({
      conflicts: [{ conflictId: "c1", subject: "mark", sourceCount: 2 }],
      riskCategories: [{ id: "concentration", status: "EXCEEDED" }],
      coverage: "PARTIAL",
      queue: [{ caseId: "adv_1", subjectLabel: "TSLA-USD" }],
    }),
  );
  for (const question of questions) {
    assert.equal(/should i|what do i do|is it a good/i.test(question.prompt), false, question.prompt);
  }
});
