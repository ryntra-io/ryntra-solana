// Run from repo root: node --test lib/rwa/stock-token.test.mjs
// Pure-compute tests only (no network). The on-chain read is verified by live probe (see the
// selector comment in stock-token.ts): uiMultiplier() → 1e18 on real NVDA/TSLA, 2026-07-09.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stockTokenIntel } from "../token/ui-multiplier.ts";

const ONE = 10n ** 18n;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("launch state (multiplier 1.0): no drift, price and shares are 1:1", () => {
  const r = stockTokenIntel({ uiMultiplier: ONE, tokenFeedPrice: 200, rawBalance: 1000n });
  close(r.multiplierX, 1);
  close(r.perSharePrice, 200);
  assert.equal(r.shareEquivBalance, 1000n);
  assert.equal(r.hasDrift, false);
  assert.equal(r.pending, null);
});

test("after reinvestment (multiplier 1.05): drift flagged, per-share price below token price", () => {
  const m = (105n * ONE) / 100n;
  const r = stockTokenIntel({ uiMultiplier: m, tokenFeedPrice: 210, rawBalance: 2000n });
  close(r.multiplierX, 1.05);
  close(r.perSharePrice, 200); // 210 / 1.05
  assert.equal(r.shareEquivBalance, 2100n); // 2000 × 1.05
  assert.equal(r.hasDrift, true);
});

test("pending corporate action: scheduled multiplier differs with a future effectiveAt", () => {
  const r = stockTokenIntel({ uiMultiplier: ONE, newUiMultiplier: 2n * ONE, effectiveAt: 9_999_999_999 });
  assert.ok(r.pending);
  close(r.pending.newMultiplierX, 2);
  assert.equal(r.pending.effectiveAt, 9_999_999_999);
});

test("no pending when newUIMultiplier equals current or effectiveAt is 0", () => {
  assert.equal(stockTokenIntel({ uiMultiplier: ONE, newUiMultiplier: ONE, effectiveAt: 9_999_999_999 }).pending, null);
  assert.equal(stockTokenIntel({ uiMultiplier: ONE, newUiMultiplier: 2n * ONE, effectiveAt: 0 }).pending, null);
});

test("missing price/balance → nulls, never faked", () => {
  const r = stockTokenIntel({ uiMultiplier: ONE });
  assert.equal(r.perSharePrice, null);
  assert.equal(r.shareEquivBalance, null);
});

test("oraclePaused passes through", () => {
  assert.equal(stockTokenIntel({ uiMultiplier: ONE, oraclePaused: true }).oraclePaused, true);
  assert.equal(stockTokenIntel({ uiMultiplier: ONE }).oraclePaused, false);
});
