import assert from "node:assert/strict";
import test from "node:test";

import { solanaCanaryRefusalSentence } from "./canary-policy.ts";
import { canBurn, evaluateCctpSafety } from "./cctp-safety.ts";

const base = {
  state: "OPEN",
  direction: "SOLANA_TO_BASE",
  plan: { maxFeeRaw: "0", protocolFeeRaw: "0" },
  provider: { direction: "SOLANA_TO_BASE", sourceDomain: 5, destinationDomain: 6, fees: { state: "AVAILABLE" } },
  simulation: { status: "PRESENT", succeeded: true, error: null },
  /* The founder's own canary: the one case the owner policy still decides. */
  canaryVerdict: { decision: "ALLOW", scope: { status: "INSIDE_ENVELOPE" } },
  reviewProof: { status: "SIGNED" },
  settlementStore: "DURABLE_MULTI_WRITER",
  independentSolanaRead: true,
  independentBaseRead: true,
  recipientConfirmed: true,
};

const evaluate = (overrides = {}) => evaluateCctpSafety({ ...base, ...overrides });
const finding = (verdict, code) => verdict.findings.find((entry) => entry.code === code);

test("everything in place is the only way to reach ALLOW", () => {
  const verdict = evaluate();
  assert.equal(verdict.decision, "ALLOW");
  assert.equal(verdict.blockedReason, null);
  assert.equal(canBurn(verdict), true);
  assert.equal(verdict.findings.every((entry) => entry.outcome === "PASS"), true);
});

test("a burn cannot proceed without a durable claim, because nothing would stop a second one", () => {
  const verdict = evaluate({ settlementStore: "NOT_DURABLE" });
  assert.equal(verdict.decision, "BLOCK");
  assert.equal(canBurn(verdict), false);
  assert.equal(finding(verdict, "DURABLE_CLAIM").outcome, "BLOCK");
  assert.match(verdict.blockedReason, /nothing here could prevent a second burn/);
});

test("a simulation that did not run is not a simulation that passed", () => {
  const skipped = evaluate({ simulation: { status: "SKIPPED", succeeded: false, error: null } });
  assert.equal(skipped.decision, "BLOCK");
  assert.match(finding(skipped, "SIMULATION").detail, /nothing is known about what they would do/);

  const failed = evaluate({ simulation: { status: "PRESENT", succeeded: false, error: "InsufficientFunds" } });
  assert.equal(failed.decision, "BLOCK");
  assert.match(finding(failed, "SIMULATION").detail, /InsufficientFunds/);
});

test("an unsigned Review blocks, because the burn route would have nothing to check", () => {
  const verdict = evaluate({ reviewProof: { status: "UNSIGNED" } });
  assert.equal(verdict.decision, "BLOCK");
  assert.equal(finding(verdict, "REVIEW_PROOF").outcome, "BLOCK");
});

test("a fee that could not be read is not a zero fee", () => {
  const verdict = evaluate({ provider: { fees: { state: "UNAVAILABLE" } } });
  assert.equal(verdict.decision, "BLOCK");
  assert.match(finding(verdict, "PROVIDER_FACTS").detail, /not established/);
});

test("a ceiling that does not equal the quoted fee blocks", () => {
  const verdict = evaluate({ plan: { maxFeeRaw: "1000000", protocolFeeRaw: "0" } });
  assert.equal(verdict.decision, "BLOCK");
  assert.equal(finding(verdict, "FEE_CEILING").outcome, "BLOCK");
});

test("no second Solana operator blocks; no second Base operator is a review", () => {
  /* The source read is what confirms the burn happened at all, so its absence
     is fatal. The destination read is a second opinion about a mint that the
     replay guard can also answer, so its absence is a warning. */
  assert.equal(evaluate({ independentSolanaRead: false }).decision, "BLOCK");
  const base_ = evaluate({ independentBaseRead: false });
  assert.equal(base_.decision, "REVIEW");
  assert.equal(canBurn(base_), false);
});

test("an unconfirmed recipient is a review, never a silent pass", () => {
  const verdict = evaluate({ recipientConfirmed: false });
  assert.equal(verdict.decision, "REVIEW");
  assert.equal(finding(verdict, "RECIPIENT_CONFIRMED").outcome, "REVIEW");
});

test("inside the owner envelope the canary decision still carries through exactly", () => {
  for (const [decision, expected] of [
    ["ALLOW", "ALLOW"],
    ["REVIEW", "REVIEW"],
    ["BLOCK", "BLOCK"],
    ["PAUSE", "BLOCK"],
    ["UNKNOWN", "BLOCK"],
  ]) {
    const verdict = evaluate({ canaryVerdict: { decision, scope: { status: "INSIDE_ENVELOPE" } } });
    assert.equal(verdict.decision, expected, decision);
    /* The decision carries in the finding's outcome, which is structure, and
       never in its detail, which is the sentence a person reads. This assertion
       used to match the verdict word inside the prose, and so it was quietly
       requiring the prose to name the policy's own vocabulary — which is what
       shipped `The owner-canary policy returned BLOCK.` to a customer. */
    assert.equal(finding(verdict, "OWNER_CANARY_POLICY").outcome, expected === "ALLOW" ? "PASS" : expected, decision);
  }
});

test("the sentence a refused person reads names no internal vocabulary", () => {
  /* The policy has a name and five verdict words and none of them belong on a
     customer surface — a reader given `BLOCK` learns neither that their money
     is untouched nor that the limit is not theirs to lift. */
  for (const decision of ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]) {
    const sentence = solanaCanaryRefusalSentence(decision);
    assert.doesNotMatch(sentence, /canary/i, decision);
    assert.doesNotMatch(sentence, /(ALLOW|REVIEW|BLOCK|PAUSE|UNKNOWN)/, decision);
    assert.doesNotMatch(sentence, /policy/i, decision);
    assert.ok(sentence.endsWith("."), decision);
  }
  /* And a refusal says the two things that are actually load-bearing. */
  for (const decision of ["BLOCK", "PAUSE"]) {
    assert.match(solanaCanaryRefusalSentence(decision), /Nothing has been sent/, decision);
    assert.match(solanaCanaryRefusalSentence(decision), /funds are untouched/, decision);
  }
});

test("no finding a person can be shown names the canary", () => {
  /* The whole surface, not one string: `blockedReason` is whichever detail
     refused the transfer, so any of them can reach the screen. */
  for (const status of ["INSIDE_ENVELOPE", "OUTSIDE_ENVELOPE"]) {
    for (const decision of ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]) {
      const verdict = evaluate({ canaryVerdict: { decision, scope: { status } } });
      for (const entry of verdict.findings) {
        assert.doesNotMatch(entry.detail, /owner-canary|canary intent/i, `${status}/${decision}/${entry.code}`);
      }
      if (verdict.blockedReason !== null) {
        assert.doesNotMatch(verdict.blockedReason, /owner-canary|canary intent/i, `${status}/${decision}`);
      }
    }
  }
});

test("outside the owner envelope the canary policy is evidence and decides nothing", () => {
  /* An ordinary person bridging their own money is not on the founder's
     destination allowlist, so the canary policy answers BLOCK. That answer is
     about a $20 experiment's budget and has no authority over their transfer.
     This was the single line that made every non-owner bridge impossible. */
  for (const decision of ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]) {
    const verdict = evaluate({ canaryVerdict: { decision, scope: { status: "OUTSIDE_ENVELOPE" } } });
    assert.equal(verdict.decision, "ALLOW", decision);
    assert.equal(canBurn(verdict), true, decision);
    assert.equal(finding(verdict, "OWNER_CANARY_POLICY").outcome, "PASS", decision);
    /* The meaning, not the wording: the sentence has to say the limits decide
       nothing, and the guard above already forbids it naming the mechanism. */
    assert.match(finding(verdict, "OWNER_CANARY_POLICY").detail, /decide[s]? nothing/);
  }
});

test("a paused bridge lane blocks before anything is signed, and says so first", () => {
  const verdict = evaluate({ state: "PAUSED" });
  assert.equal(verdict.decision, "BLOCK");
  assert.equal(canBurn(verdict), false);
  assert.equal(finding(verdict, "LANE_STATE").outcome, "BLOCK");
  /* The operator stop is the sentence a person sees, not whichever technical
     refusal happens to sort first. */
  assert.equal(verdict.blockedReason, "Bridging is turned off right now.");

  /* And it is not rescued by being outside the owner envelope: the lane stop
     is the control that replaced the canary policy, so it must outrank it. */
  const outside = evaluate({
    state: "PAUSED",
    canaryVerdict: { decision: "ALLOW", scope: { status: "OUTSIDE_ENVELOPE" } },
  });
  assert.equal(outside.decision, "BLOCK");
  assert.equal(canBurn(outside), false);
});

test("a blocked verdict always names one reason a person can act on", () => {
  const verdict = evaluate({ settlementStore: "NOT_DURABLE", recipientConfirmed: false });
  assert.equal(verdict.decision, "BLOCK");
  assert.ok(verdict.blockedReason && verdict.blockedReason.length > 20);
});
