import assert from "node:assert/strict";
import test from "node:test";

import { compileAdviceCase } from "./advice-case.ts";
import { JOURNAL_STAGES, projectJournal } from "./journal.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const caseWith = (overrides = {}) =>
  compileAdviceCase({
    ownerRef: "owner-1",
    asOf: ASOF,
    investorContext: { state: "NOT_SERVER_READABLE", version: null, reason: "held in this browser" },
    trigger: {
      kind: "USER_INITIATED",
      ref: "paper:t1",
      subjectRef: "arcus:perp:TSLA-USD",
      subjectLabel: "TSLA-USD",
      subjectKind: "PAPER_TRADE",
      factKey: null,
      observedAt: "2026-08-22T08:55:00.000Z",
      ruleId: null,
      detail: "A paper trade was opened on TSLA-USD.",
    },
    evidence: [],
    conflicts: [],
    unknowns: [],
    risk: { state: "UNAVAILABLE", reason: "no calculation" },
    disposition: { state: "PAPER", recordedAt: "2026-08-22T09:00:00.000Z", recordedBy: "USER", source: "Paper book", note: null, reason: null },
    action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" },
    outcome: null,
    review: { state: "MISSING", reason: "No review is recorded." },
    ...overrides,
  });

const closedOutcome = {
  observedAt: "2026-08-22T18:00:00.000Z",
  observedBy: "Paper book",
  authoritative: true,
  book: "PAPER",
  effects: ["Closed at 440.00 for +280.00."],
  realizedAmount: "280.00",
  realizedCurrency: "USD",
};

const plan = { stop: "400.00", target: "440.00", rationale: "Break of the range high." };

const entry = (advice, planOverride = plan) => ({ case: advice, plan: planOverride });

test("the cycle is exactly plan, decision, outcome, conclusion", () => {
  assert.deepEqual([...JOURNAL_STAGES], ["PLAN", "DECISION", "OUTCOME", "CONCLUSION"]);
  const projection = projectJournal({ asOf: ASOF, entries: [entry(caseWith())] });
  assert.deepEqual(projection.stages.map((stage) => stage.id), [...JOURNAL_STAGES]);
  assert.deepEqual(projection.cycles[0].links.map((link) => link.id), [...JOURNAL_STAGES]);
});

test("an open cycle records plan and decision and states the two that are missing", () => {
  const projection = projectJournal({ asOf: ASOF, entries: [entry(caseWith())] });
  const [cycle] = projection.cycles;
  assert.equal(cycle.state, "OPEN");
  assert.equal(cycle.complete, false);
  const byId = Object.fromEntries(cycle.links.map((link) => [link.id, link]));
  assert.equal(byId.PLAN.state, "RECORDED");
  assert.equal(byId.DECISION.state, "RECORDED");
  assert.equal(byId.OUTCOME.state, "MISSING");
  assert.equal(byId.CONCLUSION.state, "MISSING");
  assert.ok(byId.OUTCOME.reason.length > 20);
});

test("a closed and reviewed cycle is complete and says so", () => {
  const advice = caseWith({
    outcome: closedOutcome,
    review: { state: "RECORDED", recordedAt: "2026-08-22T18:30:00.000Z", followedPlan: true, mistakeTag: null, lesson: "Waited for the level." },
  });
  const [cycle] = projectJournal({ asOf: ASOF, entries: [entry(advice)] }).cycles;
  assert.equal(cycle.state, "REVIEWED");
  assert.equal(cycle.complete, true);
  for (const link of cycle.links) assert.equal(link.state, "RECORDED");
  assert.match(cycle.links.at(-1).summary, /Waited for the level/);
});

test("a closed cycle nobody reviewed is CLOSED, not REVIEWED", () => {
  const [cycle] = projectJournal({ asOf: ASOF, entries: [entry(caseWith({ outcome: closedOutcome }))] }).cycles;
  assert.equal(cycle.state, "CLOSED");
  assert.equal(cycle.complete, false);
  assert.equal(cycle.links.find((link) => link.id === "CONCLUSION").state, "MISSING");
});

test("a plan nobody wrote is missing rather than invented", () => {
  const [cycle] = projectJournal({
    asOf: ASOF,
    entries: [entry(caseWith(), { stop: null, target: null, rationale: null })],
  }).cycles;
  const link = cycle.links.find((entry) => entry.id === "PLAN");
  assert.equal(link.state, "MISSING");
  assert.ok(link.reason.length > 20);
  assert.equal(link.summary.includes("null"), false);
});

test("a decision nobody recorded is missing and names the product limit, not the reader", () => {
  const pending = caseWith({
    disposition: { state: "PENDING", recordedAt: null, recordedBy: null, source: null, note: null, reason: "Recording a disposition needs storage this release does not add." },
    action: null,
  });
  const [cycle] = projectJournal({ asOf: ASOF, entries: [entry(pending, { stop: null, target: null, rationale: null })] }).cycles;
  const link = cycle.links.find((entry) => entry.id === "DECISION");
  assert.equal(link.state, "MISSING");
  assert.match(link.reason, /storage/i);
});

test("the stage summary counts what is recorded against what is not", () => {
  const projection = projectJournal({
    asOf: ASOF,
    entries: [
      entry(caseWith()),
      entry(caseWith({
        outcome: closedOutcome,
        review: { state: "RECORDED", recordedAt: null, followedPlan: false, mistakeTag: "moved the stop", lesson: null },
      })),
    ],
  });
  const byId = Object.fromEntries(projection.stages.map((stage) => [stage.id, stage]));
  assert.equal(byId.PLAN.recorded, 2);
  assert.equal(byId.PLAN.missing, 0);
  assert.equal(byId.PLAN.state, "COMPLETE");
  assert.equal(byId.OUTCOME.recorded, 1);
  assert.equal(byId.OUTCOME.missing, 1);
  assert.equal(byId.OUTCOME.state, "PARTIAL");
});

test("paper and live cycles are counted per book and never summed into one figure", () => {
  const live = caseWith({
    action: { actionRef: "arcus:fill:f1", kind: "LIVE_FILL", book: "LIVE" },
    disposition: { state: "MANUAL", recordedAt: "2026-08-22T10:00:00.000Z", recordedBy: "USER", source: "Arcus", note: null, reason: null },
    outcome: { ...closedOutcome, book: "LIVE", observedBy: "Arcus", realizedAmount: "61.40" },
  });
  const projection = projectJournal({ asOf: ASOF, entries: [entry(caseWith()), entry(live)] });
  assert.deepEqual(projection.counts.byBook, { PAPER: 1, LIVE: 1 });
  assert.equal("realized" in projection.counts, false);
  assert.equal("realizedTotal" in projection.counts, false);
});

test("nothing recorded at all is EMPTY rather than a page of dashes", () => {
  const projection = projectJournal({ asOf: ASOF, entries: [] });
  assert.equal(projection.state, "EMPTY");
  assert.deepEqual(projection.cycles, []);
  for (const stage of projection.stages) {
    assert.equal(stage.state, "EMPTY");
    assert.ok(stage.reason);
  }
});

test("cycles read newest first and the projection is pure", () => {
  const older = caseWith();
  const newer = caseWith({
    trigger: { ...older.trigger, ref: "paper:t2", observedAt: "2026-08-23T08:00:00.000Z" },
    /* A later trade was also decided later. Both fields move, because a cycle's
       clock is the most recent thing that happened to it and the disposition is
       more recent than the trigger. */
    disposition: { state: "PAPER", recordedAt: "2026-08-23T08:05:00.000Z", recordedBy: "USER", source: "Paper book", note: null, reason: null },
    action: { actionRef: "paper:t2", kind: "PAPER_TRADE", book: "PAPER" },
  });
  const build = () => projectJournal({ asOf: ASOF, entries: [entry(older), entry(newer)] });
  assert.deepEqual(build().cycles.map((cycle) => cycle.actionRef), ["paper:t2", "paper:t1"]);
  assert.deepEqual(build(), build());
});
