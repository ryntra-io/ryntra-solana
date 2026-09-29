// Run from repo root: node --test lib/token/ui-multiplier.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UI_MULTIPLIER_ONE,
  normalizeUiMultiplier,
  sharesFromTokenAmount,
  uiMultiplierToNumber,
  perShareEquivalentPrice,
  pendingCorporateAction,
  corporateActionStatus,
} from "./ui-multiplier.ts";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("launch multiplier 1.0 is identity", () => {
  close(uiMultiplierToNumber(UI_MULTIPLIER_ONE), 1);
  assert.equal(sharesFromTokenAmount(1000n, UI_MULTIPLIER_ONE), 1000n);
  close(perShareEquivalentPrice(250, UI_MULTIPLIER_ONE), 250);
});

test("multiplier 1.05 scales shares up and per-share price down", () => {
  const m = (105n * UI_MULTIPLIER_ONE) / 100n; // 1.05 in 18 dp
  close(uiMultiplierToNumber(m), 1.05);
  assert.equal(sharesFromTokenAmount(2000n, m), 2100n); // 2000 × 1.05
  close(perShareEquivalentPrice(210, m), 200); // 210 / 1.05
});

test("share-equivalent tracks corporate actions: forward split (2×) and reverse split (0.5×)", () => {
  // 2:1 forward split → each token now represents 2 shares
  assert.equal(sharesFromTokenAmount(1000n, 2n * UI_MULTIPLIER_ONE), 2000n);
  close(perShareEquivalentPrice(400, 2n * UI_MULTIPLIER_ONE), 200); // token $400 → $200/share
  // 1:2 reverse split → each token now represents half a share
  assert.equal(sharesFromTokenAmount(1000n, UI_MULTIPLIER_ONE / 2n), 500n);
  close(perShareEquivalentPrice(100, UI_MULTIPLIER_ONE / 2n), 200); // token $100 → $200/share
});

test("invalid / zero multiplier falls back to 1.0 (never fakes a scaled value)", () => {
  assert.equal(normalizeUiMultiplier(0n), UI_MULTIPLIER_ONE);
  assert.equal(normalizeUiMultiplier(null), UI_MULTIPLIER_ONE);
  assert.equal(normalizeUiMultiplier(undefined), UI_MULTIPLIER_ONE);
  assert.equal(normalizeUiMultiplier("not-a-number"), UI_MULTIPLIER_ONE);
  assert.equal(sharesFromTokenAmount(500n, 0n), 500n);
});

test("accepts decimal and hex string multipliers", () => {
  assert.equal(normalizeUiMultiplier("1000000000000000000"), UI_MULTIPLIER_ONE);
  assert.equal(normalizeUiMultiplier("0x" + (10n ** 18n).toString(16)), UI_MULTIPLIER_ONE);
});

const NOW = 1_800_000_000; // fixed clock for corporate-action tests
const DOUBLE = 2n * UI_MULTIPLIER_ONE; // a scheduled 2× split

test("corporate action: no schedule / schedule == current / effectiveAt 0 → none", () => {
  assert.equal(pendingCorporateAction({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: null, effectiveAt: null }), null);
  assert.equal(pendingCorporateAction({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: UI_MULTIPLIER_ONE, effectiveAt: NOW + 1000 }), null);
  assert.equal(pendingCorporateAction({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: DOUBLE, effectiveAt: 0 }), null);
  assert.equal(corporateActionStatus({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: UI_MULTIPLIER_ONE, effectiveAt: NOW + 1000 }, NOW), "none");
});

test("corporate action: future effectiveAt → pending; reached → paused (processing window)", () => {
  const sched = { uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: DOUBLE, effectiveAt: NOW + 3600 };
  assert.equal(corporateActionStatus(sched, NOW), "pending");
  assert.deepEqual(pendingCorporateAction(sched), { newMultiplierX: 2, effectiveAt: NOW + 3600 });
  // boundary: effectiveAt == now → the window has started
  assert.equal(corporateActionStatus({ ...sched, effectiveAt: NOW }, NOW), "paused");
  assert.equal(corporateActionStatus({ ...sched, effectiveAt: NOW - 3600 }, NOW), "paused");
});

test("corporate action: once applied on-chain (newUIMultiplier == uiMultiplier) the status self-heals to none", () => {
  assert.equal(corporateActionStatus({ uiMultiplier: DOUBLE, newUiMultiplier: DOUBLE, effectiveAt: NOW - 3600 }, NOW), "none");
});

test("corporate action: a failed sub-read (null) → 'unknown', never a fake 'none scheduled'", () => {
  // newUIMultiplier() eth_call failed while uiMultiplier() succeeded
  assert.equal(corporateActionStatus({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: null, effectiveAt: NOW + 3600 }, NOW), "unknown");
  // effectiveAt() eth_call failed — even though a differing multiplier looks like a schedule
  assert.equal(corporateActionStatus({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: DOUBLE, effectiveAt: null }, NOW), "unknown");
  // both failed
  assert.equal(corporateActionStatus({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: null, effectiveAt: null }, NOW), "unknown");
  // a genuine successful read of "nothing scheduled" is effectiveAt 0 (a number) → none, not unknown
  assert.equal(corporateActionStatus({ uiMultiplier: UI_MULTIPLIER_ONE, newUiMultiplier: UI_MULTIPLIER_ONE, effectiveAt: 0 }, NOW), "none");
});
