import assert from "node:assert/strict";
import test from "node:test";

import {
  CCTP_PRECANARY_STATES,
  cctpFundsInMotion,
  cctpRecovery,
  initialCctpLifecycle,
  isCctpCompleted,
  transitionCctpLifecycle,
} from "./cctp-lifecycle.ts";

const AT = "2026-08-27T12:00:00.000Z";
const BURN = "5".repeat(88);
const MINT = `0x${"6".repeat(64)}`;
const MESSAGE = `0x${"7".repeat(64)}`;

function step(record, event) {
  const result = transitionCctpLifecycle(record, event, AT);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result.record;
}

test("the exact ten-state vocabulary is closed", () => {
  assert.deepEqual(CCTP_PRECANARY_STATES, [
    "READY",
    "BURN_SUBMITTED",
    "BURN_CONFIRMED",
    "ATTESTATION_PENDING",
    "ATTESTED",
    "MINT_SUBMITTED",
    "COMPLETED",
    "FAILED",
    "UNKNOWN",
    "RECOVERY",
  ]);
});

test("the happy path completes only after both chains are observed and reconciled", () => {
  let record = initialCctpLifecycle({ intentId: "bridge:one", at: AT });
  record = step(record, { type: "SUBMIT_BURN", signature: BURN });
  assert.equal(cctpFundsInMotion(record), true);
  record = step(record, { type: "CONFIRM_BURN", observedAt: AT });
  record = step(record, { type: "WAIT_FOR_ATTESTATION" });
  record = step(record, { type: "RECEIVE_ATTESTATION", messageHash: MESSAGE, nonce: "9", attestationRef: "iris:v2:9" });
  record = step(record, { type: "SUBMIT_MINT", signature: MINT });
  assert.equal(isCctpCompleted(record), false);
  record = step(record, {
    type: "OBSERVE_AND_RECONCILE_MINT",
    observedAt: AT,
    expectedReceivedRaw: "2000000",
    actualReceivedRaw: "2000000",
  });
  assert.equal(record.state, "COMPLETED");
  assert.equal(isCctpCompleted(record), true);
  assert.equal(cctpFundsInMotion(record), false);
});

test("no post-burn, failure, unknown or recovery state has a second-burn edge", () => {
  let burned = initialCctpLifecycle({ intentId: "bridge:two", at: AT });
  burned = step(burned, { type: "SUBMIT_BURN", signature: BURN });
  const records = [
    burned,
    step(burned, { type: "CONFIRM_BURN", observedAt: AT }),
    step(burned, { type: "MARK_FAILED", stage: "BURN", reasonCode: "RPC_UNAVAILABLE" }),
    step(burned, { type: "MARK_UNKNOWN", stage: "BURN", reasonCode: "SUBMIT_OUTCOME_UNKNOWN" }),
  ];
  records.push(step(records[2], { type: "START_RECOVERY" }));
  for (const record of records) {
    const refused = transitionCctpLifecycle(record, { type: "SUBMIT_BURN", signature: "4".repeat(88) }, AT);
    assert.equal(refused.ok, false, record.state);
    assert.equal(refused.code, "SECOND_BURN_REFUSED");
  }
});

test("recovery inspects the existing message and retries only the destination mint", () => {
  let record = initialCctpLifecycle({ intentId: "bridge:three", at: AT });
  record = step(record, { type: "SUBMIT_BURN", signature: BURN });
  record = step(record, { type: "CONFIRM_BURN", observedAt: AT });
  record = step(record, { type: "WAIT_FOR_ATTESTATION" });
  record = step(record, { type: "RECEIVE_ATTESTATION", messageHash: MESSAGE, nonce: "10", attestationRef: "iris:v2:10" });
  record = step(record, { type: "MARK_FAILED", stage: "MINT", reasonCode: "DESTINATION_GAS" });
  record = step(record, { type: "START_RECOVERY" });
  const recovery = cctpRecovery(record);
  assert.equal(recovery.action, "RETRY_DESTINATION_MINT_WITH_EXISTING_ATTESTATION");
  assert.equal(recovery.secondBurnAllowed, false);
  record = step(record, { type: "RETRY_MINT", signature: MINT });
  assert.equal(record.state, "MINT_SUBMITTED");
  assert.equal(record.burnSignature, BURN);
  assert.equal(record.messageHash, MESSAGE);
});

test("every state has an explicit recovery and only READY is at rest before a burn", () => {
  for (const state of CCTP_PRECANARY_STATES) {
    const base = initialCctpLifecycle({ intentId: `bridge:${state}`, at: AT });
    const record = { ...base, state };
    const recovery = cctpRecovery(record);
    assert.ok(recovery.action.length > 0, state);
    assert.ok(recovery.whereValueIs.length > 0, state);
    assert.equal(recovery.secondBurnAllowed, state === "READY");
  }
});
