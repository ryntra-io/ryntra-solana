// Run from repo root: node --test lib/phoenix/risk-guardian.test.mjs
//
// PERP-7 — the account's scale (spec §12): every one of its five states from Phoenix's own risk tier, which word wins
// when a stale read meets a worse tier, and the order the actions stand in — a critical account leads with the two
// that take risk off the table.
import assert from "node:assert/strict";
import test from "node:test";

import { RISK_ORDER } from "./collateral-model.ts";
import { GUARDIAN_STATES, TIER_STATE, guardianView } from "./risk-guardian.ts";

const margin = (riskTier, portfolioUsd = 1_000, maintenanceMarginUsd = 170) => ({ riskTier, portfolioUsd, maintenanceMarginUsd });
const view = (over = {}) => guardianView({ margins: [margin("safe")], stale: false, hasPositions: true, hasOrders: true, ...over });

test("every tier Phoenix can send has a state, and every state of the scale is reachable", () => {
  for (const tier of RISK_ORDER) assert.ok(GUARDIAN_STATES.includes(TIER_STATE[tier]), tier);
  const reached = new Set(RISK_ORDER.map((tier) => TIER_STATE[tier]));
  reached.add(view({ stale: true }).state);
  assert.deepEqual([...GUARDIAN_STATES].sort(), [...reached].sort(), "no state of the scale is unreachable");
});

test("the five states: healthy, raised, critical, stale, liquidation", () => {
  assert.equal(view({ margins: [margin("safe")] }).state, "healthy");
  assert.equal(view({ margins: [margin("atRisk")] }).state, "raised");
  assert.equal(view({ margins: [margin("cancellable")] }).state, "critical", "Phoenix may start taking the orders away");
  for (const tier of ["liquidatable", "backstopLiquidatable", "highRisk"]) {
    assert.equal(view({ margins: [margin(tier)] }).state, "liquidation", tier);
  }
  assert.equal(view({ margins: [margin("safe")], stale: true }).state, "stale");
});

test("the account is the riskiest of its subaccounts, and the least room any of them keeps", () => {
  const seen = view({ margins: [margin("safe", 1_000, 100), margin("atRisk", 1_000, 400)] });
  assert.equal(seen.state, "raised");
  assert.equal(seen.tier, "atRisk");
  assert.equal(Math.round(seen.room), 60, "the thinnest subaccount stands for the account");
});

test("stale reads: the word says the figures stopped, but never makes a bad account look better", () => {
  assert.equal(view({ margins: [margin("safe")], stale: true }).state, "stale");
  assert.equal(view({ margins: [margin("atRisk")], stale: true }).state, "stale");
  /* A worse last read is not softened into «data is old»: the tier it was read at is carried for the reason line. */
  const critical = view({ margins: [margin("cancellable")], stale: true });
  assert.equal(critical.state, "critical");
  assert.equal(critical.tier, "cancellable");
  assert.equal(critical.stale, true, "the line still says the figures are old");
  assert.equal(view({ margins: [margin("liquidatable")], stale: true }).state, "liquidation");
  /* Old figures close new risk, not the way out. */
  assert.deepEqual(view({ margins: [margin("safe")], stale: true }).actions, ["reduce", "close"]);
});

test("a critical account leads with «Зменшити» and «Закрити»", () => {
  const critical = view({ margins: [margin("cancellable")] });
  assert.deepEqual(critical.actions.slice(0, 2), ["reduce", "close"], "the two that take risk off the table come first");
  assert.deepEqual(critical.actions, ["reduce", "close", "deposit", "cancelAll"]);
  assert.deepEqual(view({ margins: [margin("liquidatable")] }).actions.slice(0, 2), ["reduce", "close"]);
  /* Nothing is offered that there is nothing to do it to. */
  assert.deepEqual(view({ margins: [margin("cancellable")], hasPositions: false, hasOrders: false }).actions, ["deposit"]);
  assert.deepEqual(view({ margins: [margin("cancellable")], hasOrders: false }).actions, ["reduce", "close", "deposit"]);
  assert.deepEqual(view({ margins: [margin("atRisk")] }).actions, ["reduce", "deposit"]);
  assert.deepEqual(view({ margins: [margin("safe")] }).actions, [], "a healthy account is not pushed to do anything");
});

test("a tier Phoenix did not send is not read as a verdict", () => {
  const unnamed = view({ margins: [margin(null)] });
  assert.equal(unnamed.state, "healthy");
  assert.equal(unnamed.tier, null, "no reason line is invented");
  assert.equal(view({ margins: [margin("somethingNew")] }).tier, null);
  /* A word that happens to name something on every object is still not a tier — on either side of the lookup. */
  for (const word of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
    const odd = view({ margins: [margin(word)] });
    assert.equal(odd.tier, null, word);
    assert.equal(odd.state, "healthy", word);
    assert.deepEqual(odd.actions, [], word);
  }
  assert.equal(view({ margins: [], stale: true }).state, "stale");
  assert.equal(view({ margins: [margin("safe", 1_000, 0)] }).room, null, "nothing to liquidate, no room figure");
});

test("a subaccount that was not read is said, not guessed", () => {
  assert.equal(view({ partial: true }).partial, true);
  assert.equal(view({}).partial, false);
});
