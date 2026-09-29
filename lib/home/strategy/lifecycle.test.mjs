import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGY_MATERIAL_FIELDS,
  STRATEGY_STATES,
  STRATEGY_TERMINAL_STATES,
  canTransition,
  materialDiff,
  nextVersionNumber,
  strategyState,
  transitionsFrom,
} from "./lifecycle.ts";

test("the lifecycle is the canon's seven stages plus the four it names beside them", () => {
  assert.deepEqual(
    [...STRATEGY_STATES],
    [
      "IDEA",
      "DRAFT",
      "BACKTEST",
      "FORWARD_PAPER",
      "APPROVED",
      "ACTIVE",
      "REVIEW",
      "PAUSED",
      "INVALIDATED",
      "EXPIRED",
      "ARCHIVED",
    ],
  );
});

test("a state outside the eleven cannot be built", () => {
  for (const rejected of ["LIVE", "RUNNING", "draft", "", null]) {
    assert.throws(() => strategyState(rejected), /state/i);
  }
  for (const accepted of STRATEGY_STATES) assert.equal(strategyState(accepted), accepted);
});

test("the forward path is the canon's order and nothing skips the evidence stages", () => {
  assert.equal(canTransition("IDEA", "DRAFT"), true);
  assert.equal(canTransition("DRAFT", "BACKTEST"), true);
  assert.equal(canTransition("BACKTEST", "FORWARD_PAPER"), true);
  assert.equal(canTransition("FORWARD_PAPER", "APPROVED"), true);
  assert.equal(canTransition("APPROVED", "ACTIVE"), true);
  assert.equal(canTransition("ACTIVE", "REVIEW"), true);

  assert.equal(canTransition("DRAFT", "APPROVED"), false, "a draft cannot be approved without evidence");
  assert.equal(canTransition("IDEA", "ACTIVE"), false, "an idea cannot become active");
  assert.equal(canTransition("BACKTEST", "ACTIVE"), false, "a backtest alone cannot make a strategy active");
});

test("an unlisted transition cannot be built, only asked about", () => {
  assert.equal(canTransition("ARCHIVED", "ACTIVE"), false);
  assert.equal(canTransition("INVALIDATED", "APPROVED"), false);
});

test("a terminal state has no way out", () => {
  assert.deepEqual([...STRATEGY_TERMINAL_STATES], ["EXPIRED", "ARCHIVED"]);
  for (const state of STRATEGY_TERMINAL_STATES) {
    assert.deepEqual(transitionsFrom(state), []);
  }
});

test("everything unfinished can be shelved, and only what is running can be paused", () => {
  /* Archiving is always available while a strategy is not already an end.
     Pausing is not: pausing an INVALIDATED strategy would be stopping something
     that is not going anywhere, and offering the control would say the evidence
     might still be good. It is redrafted or shelved, and those are its two
     edges. */
  for (const state of STRATEGY_STATES) {
    if (STRATEGY_TERMINAL_STATES.includes(state)) continue;
    assert.equal(canTransition(state, "ARCHIVED"), true, state + " must be archivable");
    if (state === "PAUSED" || state === "INVALIDATED") {
      assert.equal(canTransition(state, "PAUSED"), false, state + " must not be pausable");
      continue;
    }
    assert.equal(canTransition(state, "PAUSED"), true, state + " must be pausable");
  }
});

test("a material rule change is named, and an immaterial one is not", () => {
  const before = { symbol: "TSLA", timeframe: "1h", stopPercent: 2, title: "First" };
  assert.deepEqual(materialDiff(before, { ...before, title: "Renamed" }), []);
  assert.deepEqual(materialDiff(before, { ...before, stopPercent: 3 }), ["stopPercent"]);
  assert.deepEqual(
    materialDiff(before, { ...before, symbol: "AAPL", timeframe: "4h" }).sort(),
    ["symbol", "timeframe"],
  );
  for (const field of STRATEGY_MATERIAL_FIELDS) assert.ok(field.length > 0);
});

test("a material change forces a new version, and reusing the number is refused", () => {
  const before = { symbol: "TSLA", timeframe: "1h", stopPercent: 2 };
  assert.equal(nextVersionNumber({ previous: before, next: { ...before, stopPercent: 3 }, versionNumber: 4 }), 5);
  assert.equal(nextVersionNumber({ previous: before, next: { ...before }, versionNumber: 4 }), 4);
  assert.throws(
    () => nextVersionNumber({ previous: before, next: { ...before, stopPercent: 3 }, versionNumber: 0 }),
    /version/i,
  );
});

test("a missing field is a material change: absence and a value are not the same rule", () => {
  assert.deepEqual(materialDiff({ symbol: "TSLA" }, {}), ["symbol"]);
  assert.deepEqual(materialDiff({}, { symbol: "TSLA" }), ["symbol"]);
});
