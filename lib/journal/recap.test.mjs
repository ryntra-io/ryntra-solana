// Run from repo root: node --test lib/journal/recap.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecap, ADHERENCE_GOOD } from "./recap.ts";

const stats = (over = {}) => ({ adherencePct: 70, winRatePct: 55, trades: 8, journaled: 8, ...over });

test("no closed trades → null (never ping an inactive user)", () => {
  assert.equal(buildRecap(stats({ trades: 0, journaled: 0 })), null);
});

test("no plan flags yet (adherence null) → flag-plans advice", () => {
  const r = buildRecap(stats({ adherencePct: null }));
  assert.equal(r.advice, "flag-plans");
  assert.equal(r.trades, 8);
});

test("un-reviewed trades take priority → review-open, with the correct count", () => {
  const r = buildRecap(stats({ adherencePct: 80, trades: 10, journaled: 6 }));
  assert.equal(r.advice, "review-open");
  assert.equal(r.unreviewed, 4);
});

test("fully reviewed + healthy adherence → on-plan (threshold inclusive)", () => {
  assert.equal(buildRecap(stats({ adherencePct: ADHERENCE_GOOD })).advice, "on-plan");
  assert.equal(buildRecap(stats({ adherencePct: 95 })).advice, "on-plan");
});

test("fully reviewed + low adherence → discipline-slipped (gentle, no guilt)", () => {
  assert.equal(buildRecap(stats({ adherencePct: ADHERENCE_GOOD - 1 })).advice, "discipline-slipped");
});

test("unreviewed floors at 0 (journaled can't exceed trades in a wrong direction)", () => {
  const r = buildRecap(stats({ trades: 5, journaled: 9 }));
  assert.equal(r.unreviewed, 0);
});

test("passthrough of adherence/win-rate/trades for rendering", () => {
  const r = buildRecap(stats({ adherencePct: 73, winRatePct: 61, trades: 12, journaled: 12 }));
  assert.equal(r.adherencePct, 73);
  assert.equal(r.winRatePct, 61);
  assert.equal(r.trades, 12);
  assert.equal(r.advice, "on-plan");
});
