// Run from repo root: node --test city/lib/arena/hack/rules.test.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { hack, makeOrder, makeGrant, makeFinding, makeProof, verify, PROGRAM2, RUN_HASH } from "./fixtures.mjs";

const { assessFinding } = hack;

/** An open order, a valid grant for it, and the pieces of one assessment. */
function setup(over = {}) {
  const order = makeOrder({ status: "open", ...over.order });
  const grant = makeGrant(order, over.grant);
  const finding = makeFinding(order, over.finding);
  const proof = makeProof(over.proof);
  const prior = over.prior ?? [];
  return { input: { order, grant, finding, proof, prior }, order, grant, finding, proof };
}

const assess = (over) => assessFinding(setup(over).input, verify);

test("a reproduced, in-scope, permitted, first finding counts and is payable", () => {
  const a = assess();
  assert.equal(a.outcome, "counts");
  assert.equal(a.status, "confirmed");
  assert.equal(a.reason, "COUNTS");
  assert.equal(a.severity, "high");
  assert.equal(a.first, true);
  assert.equal(a.payable, true);
});

test("a run that did not reproduce the fault is rejected", () => {
  const a = assess({ proof: { verdict: "FAIL" } });
  assert.equal(a.outcome, "rejected");
  assert.equal(a.reason, "NOT_REPRODUCED");
  assert.equal(a.payable, false);
});

test("a judge-blocked run (a forged or tampered proof) is blocked as a cheat", () => {
  const a = assess({ proof: { verdict: "BLOCKED", reason: "FALSE_CLAIM" } });
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "CHEAT");
  assert.match(a.detail, /FALSE_CLAIM/);
});

test("a run the judge cannot decide goes to review", () => {
  const a = assess({ proof: { verdict: "NEEDS_REVIEW", reason: "UNCLEAR" } });
  assert.equal(a.outcome, "review");
  assert.equal(a.reason, "NEEDS_REVIEW");
  assert.equal(a.payable, false);
});

test("a model's score only describes a finding — it never counts or pays", () => {
  const a = assess({ proof: { verdict: "PASS", deterministic: false } });
  assert.equal(a.outcome, "description");
  assert.equal(a.reason, "DESCRIPTION_ONLY");
  assert.equal(a.payable, false);
});

test("REFUSAL — out of scope: a target the scope does not name", () => {
  const a = assess({ finding: { target: { program: PROGRAM2 } } });
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "OUT_OF_SCOPE");
});

test("REFUSAL — an instruction outside the scope's narrowed set", () => {
  const a = assess({ finding: { target: { program: makeOrder().target.program, instruction: "selfdestruct" } } });
  assert.equal(a.reason, "OUT_OF_SCOPE");
});

test("REFUSAL — no permission: a forged owner signature", () => {
  const a = assess({ grant: { signature: { signature: "forged" } } });
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "NO_PERMISSION");
});

test("REFUSAL — self-audit: an agent of the protocol's own owner may not attack it", () => {
  const order = makeOrder({ status: "open" });
  const a = assessFinding(
    { order, grant: makeGrant(order), finding: makeFinding(order, { hunterOwner: order.protocol }), proof: makeProof(), prior: [] },
    verify,
  );
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "SELF_AUDIT");
});

test("REFUSAL — a closed or paused order takes no finding", () => {
  assert.equal(assess({ order: { status: "paused" } }).reason, "ORDER_CLOSED");
  assert.equal(assess({ order: { status: "closed" } }).reason, "ORDER_CLOSED");
});

test("REFUSAL — a finding outside the order's window", () => {
  const order = makeOrder({ status: "open" });
  const late = assessFinding(
    { order, grant: makeGrant(order), finding: makeFinding(order, { submittedAt: order.closesAt + 1 }), proof: makeProof(), prior: [] },
    verify,
  );
  assert.equal(late.reason, "WINDOW");
});

test("REFUSAL — a finding for another order", () => {
  const order = makeOrder({ status: "open" });
  const a = assessFinding({ order, grant: makeGrant(order), finding: makeFinding(order, { order: "order-2" }), proof: makeProof(), prior: [] }, verify);
  assert.equal(a.reason, "WRONG_ORDER");
});

test("REFUSAL — the proof is for another run than the finding", () => {
  const a = assess({ finding: { logHash: RUN_HASH }, proof: { logHash: hashOtherRun() } });
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "EVIDENCE_MISMATCH");
});

test("REFUSAL — no evidence: a finding with no run attached", () => {
  const a = assess({ finding: { logHash: null } });
  assert.equal(a.outcome, "review");
  assert.equal(a.reason, "NO_EVIDENCE");
});

test("REFUSAL — a malformed finding is blocked, fail-closed, never thrown", () => {
  const order = makeOrder({ status: "open" });
  const a = assessFinding({ order, grant: makeGrant(order), finding: { not: "a finding" }, proof: makeProof(), prior: [] }, verify);
  assert.equal(a.outcome, "blocked");
  assert.equal(a.reason, "BAD_FINDING");
  // Even with wholly broken input, it returns a review rather than throwing.
  assert.equal(assessFinding(null, verify).outcome, "blocked");
});

test("duplicates: a later finding of a vulnerability already confirmed is a duplicate, not paid twice", () => {
  const order = makeOrder({ status: "open" });
  const first = makeFinding(order, { id: "f1", hunter: "a", status: "confirmed" });
  const second = makeFinding(order, { id: "f2", hunter: "b" }); // same program + instruction + class
  const a = assessFinding({ order, grant: makeGrant(order), finding: second, proof: makeProof(), prior: [first] }, verify);
  assert.equal(a.outcome, "duplicate");
  assert.equal(a.reason, "DUPLICATE");
  assert.equal(a.first, false);
  assert.equal(a.payable, false);
});

test("who first: an earlier finding that was not confirmed does not block a clean one", () => {
  const order = makeOrder({ status: "open" });
  const earlier = makeFinding(order, { id: "f1", hunter: "a", status: "rejected" }); // did not count
  const clean = makeFinding(order, { id: "f2", hunter: "b" });
  const a = assessFinding({ order, grant: makeGrant(order), finding: clean, proof: makeProof(), prior: [earlier] }, verify);
  assert.equal(a.outcome, "counts");
  assert.equal(a.first, true);
});

test("severity: an info-level reproduction counts but is never reward-eligible; low and up are", () => {
  assert.equal(assess({ finding: { severity: "info" } }).payable, false);
  assert.equal(assess({ finding: { severity: "info" } }).outcome, "counts");
  assert.equal(assess({ finding: { severity: "low" } }).payable, true);
  assert.equal(assess({ finding: { severity: "critical" } }).payable, true);
});

test("over the real CITY-68 judge: a genuine PASS verdict makes a counted finding", async () => {
  const judge = await import("../../../../lib/ring/judge/index.ts");
  const { demoKit } = await import("../../../../lib/ring/judge/bad-agent.ts");
  const harness = generateKeyPairSync("ed25519").privateKey;
  const stranger = generateKeyPairSync("ed25519").privateKey;
  const kit = demoKit(judge.createStamper(harness), judge.createStamper(stranger));
  const verdict = judge.judge(kit.tests, { verifyStamp: judge.stampVerifier([judge.signerOf(harness)]), games: [] });
  assert.equal(verdict.verdict, "PASS"); // the real judge, on an honest tests match
  assert.equal(typeof verdict.logHash, "string");

  const order = makeOrder({ status: "open" });
  const finding = makeFinding(order, { logHash: verdict.logHash });
  const a = assessFinding({ order, grant: makeGrant(order), finding, proof: { judgement: verdict, deterministic: true }, prior: [] }, verify);
  assert.equal(a.outcome, "counts");
  assert.equal(a.payable, true);
});

/** A 64-hex that is not RUN_HASH. */
function hashOtherRun() {
  return "f".repeat(64);
}
