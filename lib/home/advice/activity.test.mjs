import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVITY_KINDS, projectActivity } from "./activity.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const change = (overrides = {}) => ({
  id: "chg_1",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  factKey: "markPrice",
  kind: "VALUE_MOVE",
  state: "MATERIAL",
  observedAt: "2026-08-23T11:59:00.000Z",
  sources: ["arcus-markets"],
  ...overrides,
});

const adviceCase = (overrides = {}) => ({
  caseId: "adv_abc123abc123",
  trigger: {
    kind: "MATERIAL_CHANGE",
    ref: "chg_1",
    subjectRef: "arcus:perp:TSLA-USD",
    subjectLabel: "TSLA-USD",
    subjectKind: "VENUE_MARKET",
    factKey: "markPrice",
    observedAt: "2026-08-23T11:59:00.000Z",
    ruleId: "rule-1",
    detail: "Mark price moved.",
  },
  disposition: { state: "PENDING", recordedAt: null, recordedBy: null, source: null, note: null, reason: "none" },
  action: null,
  outcome: null,
  review: { state: "MISSING", reason: "none" },
  ...overrides,
});

const decided = () =>
  adviceCase({
    caseId: "adv_dddddddddddd",
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
    disposition: { state: "PAPER", recordedAt: "2026-08-22T09:00:00.000Z", recordedBy: "USER", source: "Paper book", note: null, reason: null },
    action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" },
    outcome: {
      observedAt: "2026-08-22T18:00:00.000Z",
      observedBy: "Paper book",
      authoritative: true,
      book: "PAPER",
      effects: ["Closed at 440.00."],
      realizedAmount: "280.00",
      realizedCurrency: "USD",
    },
    review: { state: "RECORDED", recordedAt: "2026-08-22T18:30:00.000Z", followedPlan: true, mistakeTag: null, lesson: "Waited for the level." },
  });

test("the event vocabulary is closed and every event uses it", () => {
  const index = projectActivity({ asOf: ASOF, cases: [adviceCase(), decided()], changes: [change()], sources: [] });
  assert.ok(index.events.length > 0);
  for (const event of index.events) {
    assert.ok(ACTIVITY_KINDS.includes(event.kind), `${event.kind} is not a registered activity kind`);
  }
  assert.deepEqual(Object.keys(index.counts).sort(), [...ACTIVITY_KINDS].sort());
});

test("a complete cycle raises one event per link, and no more", () => {
  const index = projectActivity({ asOf: ASOF, cases: [decided()], changes: [], sources: [] });
  assert.deepEqual(index.events.map((event) => event.kind).sort(), [
    "ACTION_EXECUTED",
    "ADVICE_CASE_RAISED",
    "DECISION_RECORDED",
    "JOURNAL_REVIEW_RECORDED",
    "OUTCOME_OBSERVED",
    "RECEIPT_ISSUED",
  ]);
  /* The chain reads backwards down the page: the review is the most recent
     thing that happened and the case being raised is the oldest. The two
     events that share the close instant are not ordered against each other,
     because nothing in the records says which came first. */
  assert.equal(index.events[0].kind, "JOURNAL_REVIEW_RECORDED");
  assert.equal(index.events.at(-1).kind, "ADVICE_CASE_RAISED");
  const times = index.events.map((event) => event.at);
  assert.deepEqual(times, [...times].sort().reverse());
});

test("a pending case raises its trigger and itself, and nothing after", () => {
  const index = projectActivity({ asOf: ASOF, cases: [adviceCase()], changes: [change()], sources: [] });
  const kinds = index.events.map((event) => event.kind);
  assert.ok(kinds.includes("RESEARCH_CHANGE_DETECTED"));
  assert.ok(kinds.includes("ADVICE_CASE_RAISED"));
  assert.equal(kinds.includes("DECISION_RECORDED"), false);
  assert.equal(kinds.includes("RECEIPT_ISSUED"), false);
});

test("no receipt event is raised for a non-authoritative outcome", () => {
  const shaky = adviceCase({
    caseId: "adv_eeeeeeeeeeee",
    disposition: { state: "MANUAL", recordedAt: "2026-08-22T09:00:00.000Z", recordedBy: "USER", source: "Live notes", note: null, reason: null },
    action: { actionRef: "arcus:fill:f1", kind: "LIVE_FILL", book: "LIVE" },
    outcome: {
      observedAt: "2026-08-22T18:00:00.000Z",
      observedBy: "an expectation",
      authoritative: false,
      book: "LIVE",
      effects: [],
      realizedAmount: null,
      realizedCurrency: null,
    },
  });
  const kinds = projectActivity({ asOf: ASOF, cases: [shaky], changes: [], sources: [] }).events.map((event) => event.kind);
  assert.ok(kinds.includes("OUTCOME_OBSERVED"));
  assert.equal(kinds.includes("RECEIPT_ISSUED"), false);
});

test("a degraded source is an event with the source's own reason", () => {
  const index = projectActivity({
    asOf: ASOF,
    cases: [],
    changes: [],
    sources: [{ sourceId: "rhj", label: "Robinhood Stock Tokens", state: "FAILED", reason: "Blocked by jurisdiction.", entitlement: "PROVIDER_PUBLIC" }],
  });
  assert.equal(index.events.length, 1);
  assert.equal(index.events[0].kind, "SOURCE_DEGRADED");
  assert.match(index.events[0].summary, /jurisdiction/);
});

test("an OK source raises nothing", () => {
  const index = projectActivity({
    asOf: ASOF,
    cases: [],
    changes: [],
    sources: [{ sourceId: "arcus-markets", label: "Arcus markets", state: "OK", reason: null, entitlement: "PROVIDER_PUBLIC" }],
  });
  assert.deepEqual(index.events, []);
});

test("events are ordered newest first and deduped by identity", () => {
  const index = projectActivity({ asOf: ASOF, cases: [adviceCase(), adviceCase()], changes: [change(), change()], sources: [] });
  const ids = index.events.map((event) => event.eventId);
  assert.equal(new Set(ids).size, ids.length, "duplicate events must collapse");
  const times = index.events.map((event) => event.at);
  assert.deepEqual(times, [...times].sort().reverse());
});

test("the projection is pure: same input, same index", () => {
  const build = () => projectActivity({ asOf: ASOF, cases: [adviceCase(), decided()], changes: [change()], sources: [] });
  assert.deepEqual(build(), build());
});

test("every event names its book, its source and its subject", () => {
  const index = projectActivity({ asOf: ASOF, cases: [decided()], changes: [change()], sources: [] });
  for (const event of index.events) {
    assert.ok(["PAPER", "LIVE", "NONE"].includes(event.book));
    assert.ok(event.sourceId.length > 0);
    assert.ok(event.subjectLabel.length > 0);
    assert.ok(event.summary.length > 0);
  }
});
