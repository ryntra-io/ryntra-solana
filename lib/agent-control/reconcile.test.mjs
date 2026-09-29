import assert from "node:assert/strict";
import test from "node:test";

import { reconcileObservedOutcome } from "./reconcile.ts";

const AT = "2026-08-17T12:00:00.000Z";

function outcome(effects, status = "MATCHED") {
  return {
    status,
    chainRef: "eip155:97",
    transactionHash: "0xabc",
    observedEffects: effects.map((description, index) => ({
      description,
      sourceRef: `https://example.invalid/log/${index}`,
      observedAt: AT,
    })),
    reconciledAt: AT,
  };
}

test("every expectation met and nothing else observed is a match", () => {
  const result = reconcileObservedOutcome({
    expectedEffects: ["job created", "budget escrowed"],
    observed: outcome(["Job created with id 42", "Budget escrowed: 5 U"]),
  });
  assert.equal(result.status, "MATCHED");
  assert.equal(result.matched, 2);
  assert.equal(result.expected, 2);
  assert.deepEqual(result.unexpected, []);
  assert.ok(result.findings.every((finding) => finding.matchedBy !== null));
});

test("a missing expectation is a deviation, never a rounded-up match", () => {
  /* The rule this module exists for: an outcome that mostly matched is not a
     match, and a receipt saying MATCHED over a partial result is worse than no
     receipt because somebody acts on it. */
  const result = reconcileObservedOutcome({
    expectedEffects: ["job created", "budget escrowed"],
    observed: outcome(["Job created with id 42"]),
  });
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.equal(result.matched, 1);
  assert.deepEqual(
    result.findings.map((finding) => [finding.expectation, finding.status]),
    [["budget escrowed", "NOT_OBSERVED"], ["job created", "MATCHED"]],
  );
});

test("an observed effect nobody expected is reported, never dropped", () => {
  const result = reconcileObservedOutcome({
    expectedEffects: ["job created"],
    observed: outcome(["Job created with id 42", "Ownership transferred to 0xdead"]),
  });
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.deepEqual(result.unexpected, ["Ownership transferred to 0xdead"]);
});

test("one observed effect satisfies exactly one expectation", () => {
  /* Without consumption, a single effect would silently satisfy every
     expectation that is a substring of it, and a partial result would read as
     complete. */
  const result = reconcileObservedOutcome({
    expectedEffects: ["transfer", "transfer"],
    observed: outcome(["Transfer of 5 U"]),
  });
  assert.equal(result.status, "DEVIATION_RECORDED");
  assert.equal(result.matched, 1, "one effect satisfied two expectations");
});

test("formatting differences are not findings", () => {
  const result = reconcileObservedOutcome({
    expectedEffects: ["Budget   Escrowed"],
    observed: outcome(["the budget escrowed successfully"]),
  });
  assert.equal(result.status, "MATCHED");
});

test("the chain's own verdict outranks the comparison", () => {
  /* A failed transaction that happens to have emitted the expected events is
     still a failure. Calling it MATCHED would be the product deciding it knows
     better than the ledger. */
  const result = reconcileObservedOutcome({
    expectedEffects: ["job created"],
    observed: outcome(["Job created with id 42"], "FAILED"),
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.matched, 1, "the findings are still reported");
});

test("an intent that expected nothing cannot be reconciled", () => {
  /* Returning MATCHED would mean "we checked and it was fine", which is exactly
     the claim that was not made. */
  assert.throws(
    () => reconcileObservedOutcome({ expectedEffects: [], observed: outcome(["anything"]) }),
    /cannot be reconciled/,
  );
});

test("an observation with no effects is refused by the schema, not smoothed", () => {
  assert.throws(() => reconcileObservedOutcome({ expectedEffects: ["job created"], observed: outcome([]) }));
});

test("the module explains nothing it did not observe", () => {
  const result = reconcileObservedOutcome({
    expectedEffects: ["job created", "budget escrowed"],
    observed: outcome(["Job created with id 42"]),
  });
  /* It reports which expectations were met and what was seen. Inventing a cause
     would be the product asserting something it never observed. */
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ["expectation", "matchedBy", "status"]);
  }
});
