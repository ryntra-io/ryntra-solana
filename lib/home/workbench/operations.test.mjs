import assert from "node:assert/strict";
import test from "node:test";

import {
  RYN_AI_AUTHORITY,
  RYN_FORBIDDEN_ACTS,
  RYN_OPERATIONS,
  isRynOperation,
  rynOperation,
  rynOperations,
} from "./operations.ts";

test("the operation set is exactly Explain, Formalize, Compare and Review", () => {
  assert.deepEqual([...RYN_OPERATIONS], ["EXPLAIN", "FORMALIZE", "COMPARE", "REVIEW"]);
});

test("an operation outside the union cannot be built or recognised", () => {
  for (const rejected of ["DECIDE", "AUTHORIZE", "EXECUTE", "SIGN", "RECOMMEND", "explain", "", null, 7]) {
    assert.equal(isRynOperation(rejected), false, String(rejected) + " must not be an operation");
    assert.throws(() => rynOperation(rejected), /operation/i);
  }
  for (const accepted of RYN_OPERATIONS) assert.equal(isRynOperation(accepted), true);
});

test("every operation records no AI authority and the same six forbidden acts", () => {
  assert.equal(RYN_AI_AUTHORITY, "NONE");
  assert.deepEqual(
    [...RYN_FORBIDDEN_ACTS],
    ["GOVERN", "AUTHORIZE", "SIGN", "EXECUTE", "SUPPLY_MISSING_FACT", "MATERIAL_ARITHMETIC"],
  );
  for (const state of rynOperations()) {
    assert.equal(state.aiAuthority, "NONE");
    assert.deepEqual([...state.forbidden], [...RYN_FORBIDDEN_ACTS]);
  }
});

test("Explain and Compare are served deterministically; Formalize and Review are the guarded path, linked", () => {
  const byId = new Map(rynOperations().map((state) => [state.operation, state]));
  assert.equal(byId.get("EXPLAIN").servedBy, "DETERMINISTIC");
  assert.equal(byId.get("COMPARE").servedBy, "DETERMINISTIC");
  assert.equal(byId.get("EXPLAIN").href, null);
  assert.equal(byId.get("COMPARE").href, null);
  assert.equal(byId.get("FORMALIZE").servedBy, "GUARDED_STRATEGY_LAB");
  assert.equal(byId.get("REVIEW").servedBy, "GUARDED_STRATEGY_LAB");
  assert.equal(byId.get("FORMALIZE").href, "/app/strategy-lab");
  assert.equal(byId.get("REVIEW").href, "/app/strategy-lab");
});

test("a deterministic operation names no model, because none is called", () => {
  for (const state of rynOperations()) {
    if (state.servedBy !== "DETERMINISTIC") continue;
    assert.equal(state.modelCalled, false);
    assert.ok(state.reason.length > 0);
  }
});

test("the operation set is stated once and every operation carries a distinct label", () => {
  const states = rynOperations();
  assert.equal(states.length, RYN_OPERATIONS.length);
  assert.equal(new Set(states.map((state) => state.label)).size, states.length);
  assert.deepEqual(states.map((state) => state.operation), [...RYN_OPERATIONS]);
});

test("no operation carries a personalized verdict word", () => {
  const forbidden = ["BUY", "SELL", "HOLD", "REDUCE", "HEDGE", "REBALANCE"];
  const text = JSON.stringify(rynOperations()).toUpperCase();
  for (const word of forbidden) {
    assert.equal(text.includes(word), false, "the operation set must not contain " + word);
  }
});
