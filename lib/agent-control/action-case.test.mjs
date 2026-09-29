// Run from repo root: node --test lib/agent-control/action-case.test.mjs
//
// The Action Case is a projection, and these tests exist to keep it one. The
// failure mode being guarded is a screen quietly gaining a fact the artifact
// does not carry — which is how a preview starts reading like a receipt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAgentControlDemo } from "./demo.ts";
import { ACTION_STAGES, actionCaseVerdict, buildActionCase } from "./action-case.ts";

const previewOf = (demo) => demo.allowed ?? demo.preview ?? demo;

function samples() {
  const demo = createAgentControlDemo();
  // The demo exposes more than one scenario; take every Action Passport Preview
  // it produces rather than assuming a shape.
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "ACTION_PASSPORT_PREVIEW") {
      found.push(value);
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(demo);
  return found;
}

test("the demo produces at least one Action Passport Preview to project", () => {
  const previews = samples();
  assert.ok(previews.length >= 1, "no preview found in the demo payload");
});

test("every stage is present, in order, exactly once", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    assert.deepEqual(
      kase.stages.map((stage) => stage.id),
      [...ACTION_STAGES],
      `${preview.id} has the wrong stage sequence`,
    );
  }
});

test("the case never claims execution, authorization or an outcome", () => {
  // The three that a projection must not invent, because the artifact cannot
  // carry them: `ActionPassportPreview` types execution as UNAVAILABLE and
  // outcome as OUTCOME_NOT_OBSERVED at the schema level.
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    const byId = Object.fromEntries(kase.stages.map((stage) => [stage.id, stage]));
    assert.equal(byId.execution.state, "unavailable", `${preview.id} claims execution`);
    assert.equal(byId.authorization.state, "unavailable", `${preview.id} claims authorization`);
    assert.equal(byId.outcome.state, "unavailable", `${preview.id} claims an outcome`);
    assert.equal(kase.outcomeStatus, "OUTCOME_NOT_OBSERVED");
    assert.equal(kase.executionStatus, "UNAVAILABLE");
  }
});

test("execution belongs to the rail and never to Ryntra", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    const byId = Object.fromEntries(kase.stages.map((stage) => [stage.id, stage]));
    assert.equal(byId.execution.party, "rail");
    assert.equal(byId.authorization.party, "wallet");
    assert.equal(byId.intent.party, "agent");
    assert.equal(byId.review.party, "human");
  }
});

test("blocked and unavailable stay different answers", () => {
  // A rule refusing an action and the product being unable to reach a stage are
  // not the same fact. Merging them would let a missing capability read as a
  // policy decision, which is the claim canon v5.2 §10 forbids most directly.
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    const policy = kase.stages.find((stage) => stage.id === "policy");
    if (kase.decision === "BLOCKED_BY_RULE") {
      assert.equal(policy.state, "blocked", `${preview.id}: a refusal must read as blocked`);
    }
    // Whatever policy decided, execution is unavailable rather than blocked.
    const execution = kase.stages.find((stage) => stage.id === "execution");
    assert.notEqual(execution.state, "blocked");
  }
});

test("every hash on the case is the artifact's own", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    assert.equal(kase.intentHash, preview.intentHash);
    assert.equal(kase.evidenceRoot, preview.evidence.root);
    assert.equal(kase.passportHash, preview.passportHash);
    assert.equal(kase.policyDigest, preview.policy.result.policyDigest);
    assert.equal(kase.id, preview.id);
  }
});

test("a budget-free action class reports no amount rather than zero", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    if (preview.intent.action.budget === null) {
      assert.equal(kase.amount, null, `${preview.id} invented an amount`);
      assert.equal(kase.assetRef, null);
    } else {
      assert.equal(kase.amount, preview.intent.action.budget.amount);
    }
  }
});

test("the projection is pure: same artifact, same case", () => {
  for (const preview of samples()) {
    assert.deepEqual(buildActionCase(preview), buildActionCase(preview), preview.id);
  }
});

test("the current stage is the first one that is not finished", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    const index = kase.stages.findIndex((stage) => stage.id === kase.currentStageId);
    assert.ok(index >= 0);
    for (const earlier of kase.stages.slice(0, index)) {
      assert.equal(earlier.state, "done", `${preview.id}: ${earlier.id} is before the current stage but not done`);
    }
    assert.notEqual(kase.stages[index].state, "done");
  }
});

test("the four preview limitations survive onto the case", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    assert.deepEqual([...kase.limitations], [...preview.limitations]);
    assert.ok(kase.limitations.some((line) => line.includes("NOT AN OUTCOME RECEIPT")));
  }
});

test("the verdict is derived from the decision, never stored", () => {
  for (const preview of samples()) {
    const kase = buildActionCase(preview);
    const verdict = actionCaseVerdict(kase);
    assert.ok(["ALLOW", "REVIEW", "BLOCK", "UNKNOWN"].includes(verdict));
    if (kase.decision === "ALLOWED_BY_POLICY") assert.equal(verdict, "ALLOW");
    if (kase.decision === "BLOCKED_BY_RULE") assert.equal(verdict, "BLOCK");
  }
});

test("every stage names its party and either a limitation or nothing", () => {
  for (const preview of samples()) {
    for (const stage of buildActionCase(preview).stages) {
      assert.ok(stage.summary.length > 8, `${stage.id} has no summary`);
      assert.ok(
        stage.limitation === null || stage.limitation.length > 20,
        `${stage.id} has a limitation too short to mean anything`,
      );
    }
  }
});

/* Unused today; kept because the demo shape has changed before and a helper
   that silently stops matching is how a test starts asserting nothing. */
void previewOf;
