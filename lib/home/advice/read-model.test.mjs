import assert from "node:assert/strict";
import test from "node:test";

import { findDecisionCase, projectDecisions } from "./read-model.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const change = (overrides = {}) => ({
  id: "chg_1",
  ruleId: "rule-1",
  ruleVersion: "v1-aaa",
  scopeKind: "HOLDING",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  factKey: "markPrice",
  kind: "VALUE_MOVE",
  state: "MATERIAL",
  severity: "MEDIUM",
  observedAt: "2026-08-23T11:59:00.000Z",
  effectiveAt: null,
  previous: { value: "412.00", observedAt: null, source: "Arcus position entry price" },
  current: { value: "386.40", observedAt: "2026-08-23T11:59:00.000Z", source: "arcus-markets" },
  threshold: { comparison: "RELATIVE_BPS", value: 500, unit: "bps" },
  measured: { value: "621", unit: "bps" },
  conflict: [],
  unknown: [],
  sources: ["arcus-markets"],
  evidenceRefs: ["evidence:arcus-markets:TSLA-USD"],
  dedupeKey: "d1",
  ...overrides,
});

const action = (overrides = {}) => ({
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

const source = (overrides = {}) => ({
  sourceId: "arcus-markets",
  label: "Arcus markets",
  state: "OK",
  reason: null,
  entitlement: "PROVIDER_PUBLIC",
  ...overrides,
});

const input = (overrides = {}) => ({
  asOf: ASOF,
  ownerRef: "owner-1",
  investorContext: { state: "NOT_SERVER_READABLE", version: null, reason: "The declared context is held in this browser." },
  changes: [],
  actions: [],
  reviews: [],
  risk: { state: "UNAVAILABLE", reason: "No portfolio risk calculation was produced on this read." },
  sources: [source()],
  recovery: [],
  ...overrides,
});

test("a material change becomes a case waiting on a human, never a decided one", () => {
  const projection = projectDecisions(input({ changes: [change()] }));
  assert.equal(projection.cases.length, 1);
  assert.equal(projection.queue.length, 1);
  const [advice] = projection.cases;
  assert.equal(advice.trigger.kind, "MATERIAL_CHANGE");
  assert.equal(advice.trigger.ruleId, "rule-1");
  assert.equal(advice.disposition.state, "PENDING");
  assert.match(advice.disposition.reason, /storage|record/i);
  assert.equal(advice.adviceAuthority, "NONE");
});

test("an exact action carries its own recorded disposition and leaves the queue", () => {
  const projection = projectDecisions(input({ actions: [action()] }));
  assert.equal(projection.cases.length, 1);
  assert.deepEqual(projection.queue, []);
  const [advice] = projection.cases;
  assert.equal(advice.trigger.kind, "USER_INITIATED");
  assert.equal(advice.disposition.state, "PAPER");
  assert.equal(advice.action.actionRef, "paper:t1");
  assert.equal(projection.actions.length, 1);
  assert.equal(projection.actions[0].caseId, advice.caseId);
});

test("an open paper trade on the same instrument is never read as a decision on a change", () => {
  /* The single most tempting shortcut in this packet, refused by a test: two
     facts that share a ticker are two facts, not a cause and its effect. */
  const projection = projectDecisions(input({ changes: [change()], actions: [action()] }));
  assert.equal(projection.cases.length, 2);
  const raised = projection.cases.find((entry) => entry.trigger.kind === "MATERIAL_CHANGE");
  assert.equal(raised.disposition.state, "PENDING");
  assert.equal(raised.action, null);
  assert.equal(projection.queue.length, 1);
});

test("a closed action carries an authoritative outcome and issues one receipt", () => {
  const closed = action({
    closedAt: "2026-08-22T18:00:00.000Z",
    exitReason: "tp",
    realizedAmount: "280.00",
    realizedCurrency: "USD",
  });
  const projection = projectDecisions(input({ actions: [closed] }));
  const [advice] = projection.cases;
  assert.equal(advice.outcome.authoritative, true);
  assert.equal(advice.outcome.book, "PAPER");
  assert.equal(projection.receipts.count, 1);
  assert.equal(projection.receipts.books[0].book, "PAPER");
});

test("an open action has no receipt and the index says exactly why", () => {
  const projection = projectDecisions(input({ actions: [action()] }));
  assert.equal(projection.receipts.count, 0);
  assert.equal(projection.receipts.refusals.length, 1);
  assert.match(projection.receipts.refusals[0].reason, /no observed outcome|not happened/i);
});

test("a live fill is a live-book case observed by the venue", () => {
  const fill = action({
    actionRef: "arcus:fill:f1",
    kind: "LIVE_FILL",
    book: "LIVE",
    side: "SELL",
    plan: { stop: null, target: null, rationale: null },
    closedAt: "2026-08-22T10:00:00.000Z",
    exitReason: "CLOSE_LONG",
    realizedAmount: "61.40",
    realizedCurrency: "USD",
    venue: "Arcus",
  });
  const projection = projectDecisions(input({ actions: [fill] }));
  const [advice] = projection.cases;
  assert.equal(advice.disposition.state, "MANUAL");
  assert.equal(advice.outcome.observedBy, "Arcus");
  assert.equal(projection.receipts.books[0].book, "LIVE");
  assert.equal(projection.receipts.books[0].receipts[0].kind, "VENUE_OBSERVED_FILL");
});

test("a recorded review reaches the case it belongs to and nothing else", () => {
  const closed = action({ closedAt: "2026-08-22T18:00:00.000Z", exitReason: "tp", realizedAmount: "280.00", realizedCurrency: "USD" });
  const other = action({ actionRef: "paper:t2", closedAt: "2026-08-22T19:00:00.000Z", exitReason: "sl", realizedAmount: "-90.00", realizedCurrency: "USD" });
  const projection = projectDecisions(input({
    actions: [closed, other],
    reviews: [["paper:t1", { state: "RECORDED", recordedAt: null, followedPlan: true, mistakeTag: null, lesson: "Waited for the level." }]],
  }));
  const reviewed = projection.cases.find((entry) => entry.action.actionRef === "paper:t1");
  const unreviewed = projection.cases.find((entry) => entry.action.actionRef === "paper:t2");
  assert.equal(reviewed.review.state, "RECORDED");
  assert.equal(unreviewed.review.state, "MISSING");
  assert.ok(unreviewed.review.reason.length > 20);
});

test("a conflicting change surfaces the conflict on the case and ranks it first", () => {
  const conflicting = change({
    id: "chg_2",
    state: "CONFLICT",
    kind: "EVIDENCE_CONFLICT",
    conflict: [
      { sourceId: "arcus-positions", value: "412.10", observedAt: "2026-08-23T11:59:00.000Z" },
      { sourceId: "arcus-markets", value: "409.80", observedAt: "2026-08-23T11:59:00.000Z" },
    ],
  });
  const projection = projectDecisions(input({ changes: [change({ observedAt: "2026-08-23T11:59:59.000Z" }), conflicting] }));
  assert.equal(projection.queue[0].evidence.conflicts.length, 2);
  assert.equal(projection.state, "ATTENTION");
});

test("the surface state reflects what is actually there", () => {
  assert.equal(projectDecisions(input()).state, "EMPTY");
  assert.equal(projectDecisions(input({ actions: [action()] })).state, "CALM");
  assert.equal(projectDecisions(input({ changes: [change()] })).state, "ATTENTION");
  assert.equal(
    projectDecisions(input({ actions: [action()], sources: [source({ state: "FAILED", reason: "The venue read did not complete." })] })).state,
    "DEGRADED",
  );
  assert.equal(projectDecisions(input({ recovery: ["This read did not complete."] })).state, "DEGRADED");
});

test("the activity index covers changes, cases, actions, outcomes and degraded sources", () => {
  const projection = projectDecisions(input({
    changes: [change()],
    actions: [action({ closedAt: "2026-08-22T18:00:00.000Z", exitReason: "tp", realizedAmount: "280.00", realizedCurrency: "USD" })],
    sources: [source({ state: "FAILED", reason: "The venue read did not complete." })],
  }));
  const kinds = new Set(projection.activity.events.map((event) => event.kind));
  for (const expected of [
    "RESEARCH_CHANGE_DETECTED",
    "ADVICE_CASE_RAISED",
    "DECISION_RECORDED",
    "ACTION_EXECUTED",
    "OUTCOME_OBSERVED",
    "RECEIPT_ISSUED",
    "SOURCE_DEGRADED",
  ]) {
    assert.ok(kinds.has(expected), `the activity index is missing ${expected}`);
  }
});

test("a case is found by its own id and by the action it points at", () => {
  const projection = projectDecisions(input({ actions: [action()] }));
  const [advice] = projection.cases;
  assert.equal(findDecisionCase(projection, advice.caseId).case.caseId, advice.caseId);
  assert.equal(findDecisionCase(projection, "paper:t1").case.caseId, advice.caseId);
  assert.equal(findDecisionCase(projection, "paper:t1").action.actionRef, "paper:t1");
  assert.equal(findDecisionCase(projection, "nope"), null);
});

test("the journal cycle is projected from the same cases, not from a second read", () => {
  const projection = projectDecisions(input({
    actions: [action({ closedAt: "2026-08-22T18:00:00.000Z", exitReason: "tp", realizedAmount: "280.00", realizedCurrency: "USD" })],
    reviews: [["paper:t1", { state: "RECORDED", recordedAt: null, followedPlan: true, mistakeTag: null, lesson: "Waited." }]],
  }));
  assert.equal(projection.journal.cycles.length, 1);
  assert.equal(projection.journal.cycles[0].state, "REVIEWED");
  assert.equal(projection.journal.cycles[0].caseId, projection.cases[0].caseId);
});

test("the projection is pure and stable across identical reads", () => {
  const build = () => projectDecisions(input({ changes: [change()], actions: [action()] }));
  assert.deepEqual(build(), build());
});
