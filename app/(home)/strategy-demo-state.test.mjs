import assert from "node:assert/strict";
import test from "node:test";
import {
  DECISION_STAGE, INITIAL_DEMO, MONITOR_STAGE, RESULTS_STAGE,
  canAdvance, demoTransition, isDemoWatching, needsReview,
} from "./strategy-demo-state.ts";

test("the example advances only after an explicit user decision", () => {
  let state = INITIAL_DEMO;
  for (let i = 0; i < DECISION_STAGE; i++) state = demoTransition(state, { type: "next" });
  assert.equal(state.stage, DECISION_STAGE);
  assert.equal(canAdvance(state), false, "no decision yet, so forward is closed");
  assert.equal(demoTransition(state, { type: "next" }).stage, DECISION_STAGE);
  state = demoTransition(state, { type: "choose", choice: "watch" });
  assert.equal(state.stage, MONITOR_STAGE);
  assert.equal(isDemoWatching(state), true);
  assert.equal(demoTransition(state, { type: "next" }).stage, RESULTS_STAGE);
});

test("a changed condition invalidates the decision until a fresh review", () => {
  let state = demoTransition({ ...INITIAL_DEMO, stage: DECISION_STAGE }, { type: "choose", choice: "watch" });
  assert.equal(state.approvedVersion, 1);
  state = demoTransition(state, { type: "change_condition" });
  assert.equal(state.stage, MONITOR_STAGE);
  assert.equal(state.version, 2);
  assert.equal(needsReview(state), true);
  assert.equal(isDemoWatching(state), false);
  assert.equal(canAdvance(state), false, "an outstanding review closes the way forward");

  // Neither jumping to the decision nor choosing again may approve the new
  // version while the review is outstanding.
  const jumped = demoTransition(state, { type: "select", stage: DECISION_STAGE });
  assert.equal(demoTransition(jumped, { type: "choose", choice: "watch" }).approvedVersion, null);
  assert.equal(isDemoWatching(demoTransition(jumped, { type: "choose", choice: "watch" })), false);

  const declined = demoTransition(jumped, { type: "choose", choice: "reject" });
  assert.equal(declined.choice, "reject", "a fresh review is never required just to decline");
  assert.equal(declined.approvedVersion, null);
  assert.equal(isDemoWatching(declined), false);

  state = demoTransition(state, { type: "review" });
  assert.equal(state.stage, DECISION_STAGE);
  assert.equal(needsReview(state), false);
  state = demoTransition(state, { type: "choose", choice: "watch" });
  assert.equal(isDemoWatching(state), true);
  assert.equal(state.approvedVersion, 2);
});

test("reject and reset never become a successful trading result", () => {
  const rejected = demoTransition({ ...INITIAL_DEMO, stage: DECISION_STAGE }, { type: "choose", choice: "reject" });
  assert.equal(rejected.stage, RESULTS_STAGE);
  assert.equal(rejected.choice, "reject");
  assert.equal(isDemoWatching(rejected), false);
  assert.deepEqual(demoTransition(rejected, { type: "reset" }), INITIAL_DEMO);
  assert.equal(demoTransition(INITIAL_DEMO, { type: "select", stage: 80 }).stage, 0);
  assert.equal(demoTransition(INITIAL_DEMO, { type: "select", stage: -1 }).stage, 0);
  assert.equal(canAdvance({ ...INITIAL_DEMO, stage: RESULTS_STAGE }), false);
});

test("editing the example changes its budget and invalidates the previous decision", () => {
  let state = demoTransition({ ...INITIAL_DEMO, stage: DECISION_STAGE }, { type: "choose", choice: "watch" });
  state = demoTransition(state, { type: "edit" });
  assert.equal(state.stage, 4);
  assert.equal(state.editing, true);
  state = demoTransition(state, { type: "set_budget", budget: 15 });
  assert.equal(state.budget, 15);
  assert.equal(state.priceChanged, false, "editing a budget does not invent a changed price");
  assert.equal(state.version, 2);
  assert.equal(state.approvedVersion, null);
  assert.equal(isDemoWatching(state), false);
  // Re-selecting the same budget is not a new version.
  assert.equal(demoTransition(state, { type: "set_budget", budget: 15 }).version, 2);
  assert.equal(demoTransition(state, { type: "reset" }).budget, 25);
});
