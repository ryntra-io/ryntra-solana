import assert from "node:assert/strict";
import { test } from "node:test";

import { achievedPrice, classifySpotFill } from "./fill-outcome.ts";

const observation = { actualInputRaw: "1695435", actualOutputRaw: "5470720288" };
const facts = (reconciliation) => ({ reconciliation });

test("a fill that landed at or above the reviewed minimum is a fill, whatever the ledger calls the difference from the quote", () => {
  /* The Owner's first Spot fill: finalized, the fee collected, the output one
     tick off the quote — `DEVIATION_RECORDED`, and it read as a warning. */
  assert.deepEqual(
    classifySpotFill({ state: "DEVIATION_RECORDED", observation, facts: facts({ state: "DEVIATION_RECORDED", minimumMet: true, deviations: ["OUTPUT_MISMATCH", "PRIORITY_FEE_MISMATCH"] }), receipt: {} }),
    { kind: "FILLED", note: null },
  );
  assert.deepEqual(classifySpotFill({ state: "MATCHED", observation, facts: facts({ state: "MATCHED", minimumMet: true, deviations: [] }), receipt: {} }), { kind: "FILLED", note: null });
  /* The recovery's late answer to a good swap. */
  assert.deepEqual(classifySpotFill({ state: "RECOVERED", observation, facts: facts({ state: "DEVIATION_RECORDED", minimumMet: true, deviations: ["PROVIDER_EVIDENCE_UNAVAILABLE"] }), receipt: {} }), { kind: "FILLED", note: null });
  /* A Receipt already minted: landed and reconciled once; the amounts are in it. */
  assert.deepEqual(classifySpotFill({ state: "ALREADY_RECEIPTED", observation: null, facts: null, receipt: { id: "swap:1" } }), { kind: "FILLED", note: null });
});

test("the note stays for a landing the chain priced below the minimum or not as reviewed", () => {
  assert.deepEqual(classifySpotFill({ state: "DEVIATION_RECORDED", observation, facts: facts({ state: "DEVIATION_RECORDED", minimumMet: false, deviations: ["OUTPUT_MISMATCH", "BELOW_MINIMUM"] }), receipt: {} }), { kind: "FILLED", note: "BELOW_MINIMUM" });
  assert.deepEqual(classifySpotFill({ state: "RECOVERED", observation, facts: facts({ state: "RECOVERY", minimumMet: true, deviations: ["INPUT_MISMATCH"] }), receipt: {} }), { kind: "FILLED", note: "NOT_AS_REVIEWED" });
  assert.deepEqual(classifySpotFill({ state: "DEVIATION_RECORDED", observation, facts: facts({ state: "UNKNOWN" }), receipt: {} }), { kind: "FILLED", note: "NOT_AS_REVIEWED" });
});

test("an attempt the chain never saw, past the block that could carry it, is nothing happened", () => {
  for (const state of ["EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT", "UNKNOWN_TO_CHAIN"]) {
    assert.deepEqual(classifySpotFill({ state, observation: null, facts: null, receipt: null }), { kind: "NOTHING_HAPPENED", state });
  }
});

test("a landing the chain rejected is not filled; anything else keeps the ledger's own sentence", () => {
  assert.deepEqual(classifySpotFill({ state: "FAILED", observation: null, facts: null, receipt: null }), { kind: "NOT_FILLED" });
  assert.deepEqual(classifySpotFill({ state: "DEVIATION_RECORDED", observation, facts: facts({ state: "FAILED" }), receipt: null }), { kind: "NOT_FILLED" });
  assert.deepEqual(classifySpotFill({ state: "SEEN_WITHOUT_RECORD", observation: null, facts: null, receipt: null }), { kind: "UNPLACED" });
  assert.deepEqual(classifySpotFill({ state: "RECOVERY_PENDING", observation: null, facts: null, receipt: null }), { kind: "UNPLACED" });
  assert.deepEqual(classifySpotFill({ state: "SUBMITTED_UNKNOWN", observation: null, facts: null, receipt: null }), { kind: "UNPLACED" });
});

test("the achieved price is the quote paid per unit received, and nothing when a side is missing or zero", () => {
  assert.equal(achievedPrice(5.470720288, 1.695435), 1.695435 / 5.470720288);
  assert.equal(achievedPrice(null, 1), null);
  assert.equal(achievedPrice(0, 1), null);
  assert.equal(achievedPrice(2, 0), null);
});
