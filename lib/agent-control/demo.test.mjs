import assert from "node:assert/strict";
import test from "node:test";

import { verifyActionPassportPreview } from "./core.ts";
import {
  AGENT_CONTROL_DEMO_MODE,
  createAgentControlDemo,
  createAgentControlDemoIntent,
} from "./demo.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

test("the bundled demo is a passing source preview and never an onchain receipt", () => {
  const demo = createAgentControlDemo({ now: NOW });

  assert.equal(demo.mode, AGENT_CONTROL_DEMO_MODE);
  assert.equal(demo.preflight.policyResult.status, "PASS");
  assert.equal(demo.preflight.policyResult.decision, "ALLOWED_BY_POLICY");
  assert.equal(demo.passport.execution.status, "UNAVAILABLE");
  assert.equal(demo.passport.outcome.status, "OUTCOME_NOT_OBSERVED");
  assert.equal("grantFacts" in demo, false);
  assert.deepEqual(verifyActionPassportPreview(demo.passport), {
    valid: true,
    verdict: "PREVIEW_INTEGRITY_VALID",
    finalized: false,
    outcomeStatus: "OUTCOME_NOT_OBSERVED",
    issues: [],
  });
});

test("an unsupported chain fails closed without inventing execution", () => {
  const intent = structuredClone(createAgentControlDemoIntent(NOW));
  intent.action.chainRef = "eip155:56";
  const demo = createAgentControlDemo({ now: NOW, intent });

  assert.equal(demo.preflight.policyResult.decision, "UNSUPPORTED");
  assert.equal(demo.preflight.policyResult.status, "BLOCK");
  assert.equal(demo.passport.execution.transactionHash, null);
  assert.equal(demo.passport.outcome.observedEffects.length, 0);
});

test("demo acknowledgement binds the decision inputs but remains demo-only", () => {
  const demo = createAgentControlDemo({ now: NOW, recordDemoDecision: true });

  assert.equal(demo.passport.authorization.status, "RECORDED_DEMO_ONLY");
  assert.equal(demo.passport.authorization.demoOnly, true);
  assert.equal(demo.passport.authorization.intentHash, demo.passport.intentHash);
  assert.equal(demo.passport.execution.status, "UNAVAILABLE");
});
