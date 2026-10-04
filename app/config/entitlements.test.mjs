// Run from repo root: node --test app/config/entitlements.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { BILLING_READINESS, entitlementsFor } from "./entitlements.ts";
import { FLAGS } from "./features.ts";

test("INVARIANT: while billing is disabled, every tier resolves to full beta — no paywall exists", () => {
  assert.equal(FLAGS.billing.enabled, false, "billing must stay off until the pricing gate clears");
  for (const tier of ["free", "pro", "trader", "team"]) {
    const e = entitlementsFor(tier);
    assert.equal(e.paperTradesPerDay, "unlimited", `${tier} must not be limited during free beta`);
    assert.equal(e.riskPanels, true);
    assert.equal(e.routeComparison, true);
    assert.equal(e.dailyRecap, true);
  }
});

test("billing remains gated on its own evidence", () => {
  assert.deepEqual(BILLING_READINESS, {
    northStar: "Weekly Risk-Reviewed Decisions (WRRD)",
    requiredEvidence: ["retained_wrrd", "willingness_to_pay"],
    numericThresholds: null,
    calendarDeadline: null,
  });
});

test("API access is never granted during beta on any tier", () => {
  for (const tier of ["free", "pro", "trader", "team"]) {
    assert.equal(entitlementsFor(tier).apiAccess, false);
  }
});
