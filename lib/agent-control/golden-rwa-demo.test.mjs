// Run from repo root: node --test lib/agent-control/golden-rwa-demo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildActionCase } from "./action-case.ts";
import {
  GOLDEN_RWA_DEMO_BANNER,
  createGoldenRwaDemo,
} from "./golden-rwa-demo.ts";
import { verifyActionPassportPreview } from "./core.ts";

const NOW = new Date("2026-08-21T12:00:00.000Z");

test("the Golden RWA demo is permanently and exactly labelled as synthetic", () => {
  assert.equal(GOLDEN_RWA_DEMO_BANNER, "INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE");
});

test("stale RWA evidence returns REVIEW with exact semantic evidence reasons", () => {
  const demo = createGoldenRwaDemo(NOW);
  const actionCase = buildActionCase(demo.stale);

  assert.equal(actionCase.chainRef, "eip155:84532");
  assert.equal(actionCase.decision, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(actionCase.policyReasonCodes, ["MARKET_HOURS_MISMATCH", "REFERENCE_STALE"]);
  assert.equal(actionCase.currentStageId, "evidence");
  assert.equal(verifyActionPassportPreview(demo.stale).valid, true);
});

test("the corrected action advances only to an exact local review and external-wallet boundary", () => {
  const demo = createGoldenRwaDemo(NOW);
  const fresh = buildActionCase(demo.fresh);
  const reviewed = buildActionCase(demo.reviewed);

  assert.equal(fresh.decision, "ALLOWED_BY_POLICY");
  assert.equal(fresh.humanDecision, "NOT_RECORDED");
  assert.equal(fresh.currentStageId, "review");

  assert.equal(reviewed.decision, "ALLOWED_BY_POLICY");
  assert.equal(reviewed.humanDecision, "RECORDED_DEMO_ONLY");
  assert.equal(reviewed.currentStageId, "authorization");
  assert.equal(reviewed.stages.find((stage) => stage.id === "authorization")?.party, "wallet");
  assert.equal(reviewed.stages.find((stage) => stage.id === "authorization")?.state, "unavailable");
  assert.equal(reviewed.executionStatus, "UNAVAILABLE");
  assert.equal(reviewed.outcomeStatus, "OUTCOME_NOT_OBSERVED");
  assert.equal(verifyActionPassportPreview(demo.fresh).valid, true);
  assert.equal(verifyActionPassportPreview(demo.reviewed).valid, true);
});

test("the reviewed artifact binds the exact corrected action without inventing a wallet signature", () => {
  const { fresh, reviewed } = createGoldenRwaDemo(NOW);

  assert.equal(reviewed.id, fresh.id, "reviewing must not silently create another action");
  assert.equal(reviewed.authorization.intentHash, reviewed.intentHash);
  assert.equal(reviewed.authorization.evidenceRoot, reviewed.evidence.root);
  assert.equal(reviewed.authorization.policyDigest, reviewed.policy.result.policyDigest);
  assert.equal("walletSignature" in reviewed.authorization, false);
  assert.equal(reviewed.execution.transactionHash, null);
});
