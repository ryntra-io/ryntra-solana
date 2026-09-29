import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVICE_AUTHORITY,
  ALTERNATIVE_KINDS,
  compileAdviceCase,
} from "./advice-case.ts";

const ASOF = "2026-08-23T12:00:00.000Z";

const trigger = (overrides = {}) => ({
  kind: "MATERIAL_CHANGE",
  ref: "chg_1",
  subjectRef: "arcus:perp:TSLA-USD",
  subjectLabel: "TSLA-USD",
  subjectKind: "VENUE_MARKET",
  factKey: "markPrice",
  observedAt: "2026-08-23T11:59:00.000Z",
  ruleId: "rule-1",
  detail: "Mark price moved 620 bps against the recorded entry price.",
  ...overrides,
});

const evidenceItem = (overrides = {}) => ({
  sourceId: "arcus-markets",
  label: "Arcus markets",
  entitlement: "PROVIDER_PUBLIC",
  observedAt: "2026-08-23T11:59:00.000Z",
  ref: "evidence:arcus-markets:TSLA-USD",
  state: "OK",
  reason: null,
  ...overrides,
});

const pending = (reason = "No disposition is recorded for this case.") => ({
  state: "PENDING",
  recordedAt: null,
  recordedBy: null,
  source: null,
  note: null,
  reason,
});

const recorded = (overrides = {}) => ({
  state: "PAPER",
  recordedAt: "2026-08-23T10:00:00.000Z",
  recordedBy: "USER",
  source: "Paper book",
  note: null,
  reason: null,
  ...overrides,
});

const base = (overrides = {}) => ({
  ownerRef: "owner-1",
  asOf: ASOF,
  investorContext: { state: "NOT_SERVER_READABLE", version: null, reason: "The declared context is held in this browser." },
  trigger: trigger(),
  evidence: [evidenceItem()],
  conflicts: [],
  unknowns: [],
  risk: { state: "UNAVAILABLE", reason: "No portfolio risk calculation was produced on this read." },
  disposition: pending(),
  action: null,
  outcome: null,
  review: { state: "MISSING", reason: "No review is recorded." },
  ...overrides,
});

test("Ryntra never issues a recommendation, whatever the caller passes", () => {
  const advice = compileAdviceCase(base());
  assert.equal(advice.adviceAuthority, "NONE");
  assert.equal(ADVICE_AUTHORITY, "NONE");
  assert.equal(advice.recommendation, null);

  /* The caller cannot smuggle one in through an unexpected key: the compiler
     builds the object from named fields, so an extra one is not carried. */
  const smuggled = compileAdviceCase({
    ...base(),
    adviceAuthority: "FULL",
    recommendation: "BUY",
  });
  assert.equal(smuggled.adviceAuthority, "NONE");
  assert.equal(smuggled.recommendation, null);
});

test("no personalized verdict vocabulary appears anywhere in a compiled case", () => {
  const advice = compileAdviceCase(base({
    conflicts: [
      { sourceId: "arcus-positions", value: "412.10", observedAt: "2026-08-23T11:59:00.000Z" },
      { sourceId: "arcus-markets", value: "409.80", observedAt: "2026-08-23T11:59:00.000Z" },
    ],
    unknowns: ["No source supplied a next funding rate for TSLA-USD."],
  }));
  const text = JSON.stringify(advice);
  for (const verdict of ["BUY", "SELL", "HOLD", "REDUCE", "HEDGE", "REBALANCE"]) {
    assert.equal(text.includes(verdict), false, `a compiled case must not carry the verdict ${verdict}`);
  }
});

test("every alternative set contains a no-action option", () => {
  for (const subjectKind of ["VENUE_MARKET", "PAPER_TRADE", "STOCK_TOKEN", "OTHER"]) {
    const advice = compileAdviceCase(base({ trigger: trigger({ subjectKind }) }));
    const kinds = advice.alternatives.map((entry) => entry.kind);
    assert.ok(kinds.includes("NO_ACTION"), `${subjectKind} produced no no-action alternative`);
    const noAction = advice.alternatives.find((entry) => entry.kind === "NO_ACTION");
    assert.equal(noAction.available, true, "no-action is always available");
    for (const kind of kinds) assert.ok(ALTERNATIVE_KINDS.includes(kind), `${kind} is not a registered alternative`);
  }
});

test("an unavailable alternative carries the reason it is unavailable", () => {
  const advice = compileAdviceCase(base({ trigger: trigger({ subjectKind: "STOCK_TOKEN" }) }));
  const paper = advice.alternatives.find((entry) => entry.kind === "PAPER");
  assert.equal(paper.available, false);
  assert.ok(paper.unavailableReason && paper.unavailableReason.length > 20);
});

test("waiting for evidence is offered only when something is actually outstanding", () => {
  const complete = compileAdviceCase(base());
  const wait = complete.alternatives.find((entry) => entry.kind === "WAIT_FOR_EVIDENCE");
  assert.equal(wait.available, false);
  assert.ok(wait.unavailableReason);

  const outstanding = compileAdviceCase(base({ unknowns: ["No source supplied a mark price."] }));
  assert.equal(outstanding.alternatives.find((entry) => entry.kind === "WAIT_FOR_EVIDENCE").available, true);
});

test("a disposition nobody recorded is PENDING with its reason, never inferred", () => {
  const advice = compileAdviceCase(base());
  assert.equal(advice.disposition.state, "PENDING");
  assert.equal(advice.disposition.recordedAt, null);
  assert.ok(advice.disposition.reason.length > 10);
  assert.equal(advice.stage, "EVIDENCE");
});

test("a recorded disposition keeps its own time and source", () => {
  const advice = compileAdviceCase(base({ disposition: recorded() }));
  assert.equal(advice.disposition.state, "PAPER");
  assert.equal(advice.disposition.recordedAt, "2026-08-23T10:00:00.000Z");
  assert.equal(advice.disposition.source, "Paper book");
  assert.equal(advice.stage, "DECISION");
});

test("conflicts keep every disagreeing value and are never averaged", () => {
  const conflicts = [
    { sourceId: "arcus-positions", value: "412.10", observedAt: "2026-08-23T11:59:00.000Z" },
    { sourceId: "arcus-markets", value: "409.80", observedAt: "2026-08-23T11:59:00.000Z" },
  ];
  const advice = compileAdviceCase(base({ conflicts }));
  assert.equal(advice.evidence.conflicts.length, 2);
  assert.deepEqual(advice.evidence.conflicts.map((entry) => entry.value), ["412.10", "409.80"]);
  /* The midpoint of the two readings must appear nowhere. */
  assert.equal(JSON.stringify(advice).includes("410.95"), false);
  assert.equal(advice.evidence.completeness, "PARTIAL");
});

test("unknowns name the missing fact and stay independent of conflicts", () => {
  const advice = compileAdviceCase(base({ unknowns: ["No source supplied a next funding rate."] }));
  assert.deepEqual(advice.evidence.unknowns, ["No source supplied a next funding rate."]);
  assert.deepEqual(advice.evidence.conflicts, []);
  assert.equal(advice.evidence.completeness, "PARTIAL");
});

test("an evidence bundle with no item is NONE, not COMPLETE", () => {
  const advice = compileAdviceCase(base({ evidence: [] }));
  assert.equal(advice.evidence.completeness, "NONE");
  assert.equal(advice.stage, "TRIGGERED");
});

test("a failed or refused source drops completeness even with no unknown listed", () => {
  const advice = compileAdviceCase(base({
    evidence: [evidenceItem(), evidenceItem({ sourceId: "rhj", state: "REFUSED", reason: "Blocked by jurisdiction." })],
  }));
  assert.equal(advice.evidence.completeness, "PARTIAL");
});

test("the risk reference is carried whole or refused with a reason", () => {
  const attached = compileAdviceCase(base({
    risk: {
      state: "ATTACHED",
      schemaVersion: "1.0.0",
      formulaVersion: "1.0.0",
      inputDigest: "0xabc",
      scopeId: "home",
      bindingConstraintIds: ["max-gross"],
      unknowns: [],
    },
  }));
  assert.equal(attached.risk.state, "ATTACHED");
  assert.equal(attached.risk.inputDigest, "0xabc");
  assert.deepEqual(attached.risk.bindingConstraintIds, ["max-gross"]);

  const advice = compileAdviceCase(base());
  assert.equal(advice.risk.state, "UNAVAILABLE");
  assert.ok(advice.risk.reason.length > 10);
});

test("the chain advances only as far as the records reach", () => {
  const outcome = {
    observedAt: "2026-08-23T11:00:00.000Z",
    observedBy: "Paper book",
    authoritative: true,
    book: "PAPER",
    effects: ["Closed at 401.00 for -22.40."],
    realizedAmount: "-22.40",
    realizedCurrency: "USD",
  };
  const withAction = compileAdviceCase(base({ disposition: recorded(), action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" } }));
  assert.equal(withAction.stage, "ACTION");

  const withOutcome = compileAdviceCase(base({
    disposition: recorded(),
    action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" },
    outcome,
  }));
  assert.equal(withOutcome.stage, "OUTCOME");

  const reviewed = compileAdviceCase(base({
    disposition: recorded(),
    action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" },
    outcome,
    review: { state: "RECORDED", recordedAt: null, followedPlan: true, mistakeTag: null, lesson: "Waited for the level." },
  }));
  assert.equal(reviewed.stage, "REVIEWED");
  assert.ok(reviewed.openQuestion.length > 10);
});

test("the open question names what the case needs next at every stage", () => {
  const questions = new Set();
  for (const advice of [
    compileAdviceCase(base()),
    compileAdviceCase(base({ disposition: recorded() })),
    compileAdviceCase(base({ disposition: recorded(), action: { actionRef: "paper:t1", kind: "PAPER_TRADE", book: "PAPER" } })),
  ]) {
    assert.ok(advice.openQuestion.length > 10);
    questions.add(advice.openQuestion);
  }
  assert.equal(questions.size, 3, "each stage asks a different question");
});

test("compilation is deterministic and identity does not move with the clock", () => {
  const first = compileAdviceCase(base());
  const second = compileAdviceCase(base({ asOf: "2026-08-24T09:30:00.000Z" }));
  assert.equal(first.caseId, second.caseId);
  assert.equal(first.evidence.bundleId, second.evidence.bundleId);
  assert.match(first.caseId, /^adv_[0-9a-f]{12}$/);
  assert.match(first.evidence.bundleId, /^evb_[0-9a-f]{12}$/);
  assert.deepEqual(compileAdviceCase(base()), first);
});

test("two different triggers on one subject are two different cases", () => {
  const first = compileAdviceCase(base());
  const second = compileAdviceCase(base({ trigger: trigger({ ref: "chg_2", factKey: "nextFundingRate" }) }));
  assert.notEqual(first.caseId, second.caseId);
});

test("a different evidence set is a different bundle", () => {
  const first = compileAdviceCase(base());
  const second = compileAdviceCase(base({ evidence: [evidenceItem({ sourceId: "paper-book" })] }));
  assert.notEqual(first.evidence.bundleId, second.evidence.bundleId);
});

test("no case carries a confidence, conviction or opportunity score", () => {
  const advice = compileAdviceCase(base());
  const keys = JSON.stringify(advice).toLowerCase();
  for (const banned of ["confidence", "conviction", "opportunityscore", "qualityscore", "\"score\""]) {
    assert.equal(keys.includes(banned), false, `a compiled case must not carry ${banned}`);
  }
});
