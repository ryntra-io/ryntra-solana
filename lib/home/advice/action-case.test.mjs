import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_STAGES } from "../../agent-control/action-case.ts";
import { HOME_ACTION_KINDS, projectHomeActionCase } from "./action-case.ts";

const paperAction = (overrides = {}) => ({
  actionRef: "paper:t1",
  kind: "PAPER_TRADE",
  book: "PAPER",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  side: "long",
  size: "10",
  entryPrice: "412.00",
  plan: { stop: "400.00", target: "440.00", rationale: "Break of the range high." },
  openedAt: "2026-08-22T09:00:00.000Z",
  closedAt: null,
  exitReason: null,
  realizedAmount: null,
  realizedCurrency: null,
  fees: null,
  venue: "Arcus SmartTrade (paper)",
  ...overrides,
});

const liveAction = (overrides = {}) => ({
  actionRef: "arcus:fill:f1",
  kind: "LIVE_FILL",
  book: "LIVE",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  side: "SELL",
  size: "3",
  entryPrice: "418.20",
  plan: { stop: null, target: null, rationale: null },
  openedAt: "2026-08-22T10:00:00.000Z",
  closedAt: "2026-08-22T10:00:00.000Z",
  exitReason: "CLOSE_LONG",
  realizedAmount: "61.40",
  realizedCurrency: "USD",
  fees: "0.41",
  venue: "Arcus",
  ...overrides,
});

const context = (overrides = {}) => ({
  caseId: "adv_abc123abc123",
  evidenceCompleteness: "COMPLETE",
  risk: { state: "UNAVAILABLE", reason: "No portfolio risk calculation was produced on this read." },
  review: { state: "MISSING", reason: "No review is recorded." },
  ...overrides,
});

test("Home uses Agent Control's stage vocabulary rather than a second one", () => {
  const projected = projectHomeActionCase({ action: paperAction(), ...context() });
  assert.deepEqual(projected.stages.map((stage) => stage.id), [...ACTION_STAGES]);
  assert.equal(projected.stages.length, 8);
});

test("Ryntra is never the executing party", () => {
  for (const action of [paperAction(), liveAction(), paperAction({ closedAt: "2026-08-22T18:00:00.000Z", exitReason: "tp", realizedAmount: "280.00", realizedCurrency: "USD" })]) {
    const projected = projectHomeActionCase({ action, ...context() });
    const execution = projected.stages.find((stage) => stage.id === "execution");
    assert.notEqual(execution.party, "ryntra", "Ryntra must never be recorded as executing an action");
  }
});

test("a paper action transmitted no order and says so", () => {
  const projected = projectHomeActionCase({ action: paperAction(), ...context() });
  const execution = projected.stages.find((stage) => stage.id === "execution");
  assert.equal(execution.party, "none");
  assert.match(execution.summary + (execution.limitation ?? ""), /no order/i);

  const authorization = projected.stages.find((stage) => stage.id === "authorization");
  assert.equal(authorization.state, "unavailable");
  assert.ok(authorization.limitation);
});

test("a live fill was executed by the venue and authorized by a wallet this product does not hold", () => {
  const projected = projectHomeActionCase({ action: liveAction(), ...context() });
  assert.equal(projected.stages.find((stage) => stage.id === "execution").party, "rail");
  const authorization = projected.stages.find((stage) => stage.id === "authorization");
  assert.equal(authorization.party, "wallet");
  assert.equal(authorization.state, "done");
  assert.ok(authorization.limitation);
});

test("blocked and unavailable are never merged: Home evaluated no policy and says unavailable", () => {
  const projected = projectHomeActionCase({ action: paperAction(), ...context() });
  const policy = projected.stages.find((stage) => stage.id === "policy");
  assert.equal(policy.state, "unavailable");
  assert.notEqual(policy.state, "blocked");
  assert.match(policy.limitation, /Agent Control/);
});

test("an open action waits at outcome and a closed one is done", () => {
  const open = projectHomeActionCase({ action: paperAction(), ...context() });
  assert.equal(open.stages.find((stage) => stage.id === "outcome").state, "waiting");
  assert.equal(open.currentStageId, "outcome");
  assert.equal(open.closed, false);

  const closed = projectHomeActionCase({
    action: paperAction({ closedAt: "2026-08-22T18:00:00.000Z", exitReason: "tp", realizedAmount: "280.00", realizedCurrency: "USD" }),
    ...context(),
  });
  assert.equal(closed.stages.find((stage) => stage.id === "outcome").state, "done");
  assert.equal(closed.closed, true);
});

test("the plan recorded at open is the review stage's fact, and its absence is stated", () => {
  const planned = projectHomeActionCase({ action: paperAction(), ...context() });
  const review = planned.stages.find((stage) => stage.id === "review");
  assert.equal(review.state, "done");
  assert.match(review.summary, /400\.00/);

  const unplanned = projectHomeActionCase({ action: liveAction(), ...context() });
  const missing = unplanned.stages.find((stage) => stage.id === "review");
  assert.equal(missing.state, "unavailable");
  assert.ok(missing.limitation);
});

test("risk is carried from the case rather than recomputed here", () => {
  const attached = projectHomeActionCase({
    action: paperAction(),
    ...context({
      risk: {
        state: "ATTACHED",
        schemaVersion: "1.0.0",
        formulaVersion: "1.0.0",
        inputDigest: "0xdeadbeef",
        scopeId: "home",
        bindingConstraintIds: [],
        unknowns: [],
      },
    }),
  });
  const risk = attached.stages.find((stage) => stage.id === "risk");
  assert.equal(risk.state, "done");
  assert.match(risk.summary, /0xdeadbeef/);

  const missing = projectHomeActionCase({ action: paperAction(), ...context() });
  assert.equal(missing.stages.find((stage) => stage.id === "risk").state, "unavailable");
});

test("every action kind is registered and every projection carries its book", () => {
  assert.deepEqual([...HOME_ACTION_KINDS], ["PAPER_TRADE", "LIVE_FILL"]);
  assert.equal(projectHomeActionCase({ action: paperAction(), ...context() }).book, "PAPER");
  assert.equal(projectHomeActionCase({ action: liveAction(), ...context() }).book, "LIVE");
});

test("the projection is pure and states the next step", () => {
  const first = projectHomeActionCase({ action: paperAction(), ...context() });
  const second = projectHomeActionCase({ action: paperAction(), ...context() });
  assert.deepEqual(first, second);
  assert.ok(first.nextStep.length > 10);
  assert.ok(first.limitations.length >= 1);
});
