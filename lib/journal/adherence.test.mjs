// Run from repo root: node --test lib/journal/adherence.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adherenceOutcome, MIN_COHORT } from "./adherence.ts";

const t = (followedPlan, won) => ({ followedPlan, won });

test("empty input → both cohorts empty, no delta, not sufficient", () => {
  const r = adherenceOutcome([]);
  assert.equal(r.followed.n, 0);
  assert.equal(r.broke.n, 0);
  assert.equal(r.followed.winRatePct, null);
  assert.equal(r.deltaPts, null);
  assert.equal(r.sufficient, false);
  assert.equal(r.flagged, 0);
  assert.equal(r.unflagged, 0);
});

test("unflagged trades (null plan) are excluded from both cohorts but counted as unflagged", () => {
  const r = adherenceOutcome([t(null, true), t(null, false), t(true, true)]);
  assert.equal(r.flagged, 1);
  assert.equal(r.unflagged, 2);
  assert.equal(r.followed.n, 1);
  assert.equal(r.broke.n, 0);
});

test("win-rate per cohort is wins/n × 100; both cohorts ≥ MIN_COHORT → sufficient", () => {
  const trades = [
    ...Array(4).fill(t(true, true)), t(true, false), // followed: 4/5 = 80%
    t(false, true), ...Array(4).fill(t(false, false)), // broke: 1/5 = 20%
  ];
  const r = adherenceOutcome(trades);
  assert.equal(r.followed.winRatePct, 80);
  assert.equal(r.broke.winRatePct, 20);
  assert.equal(r.deltaPts, 60);
  assert.equal(r.sufficient, true);
});

test("break-even (won=false) counts as a non-win, never a win", () => {
  // won is pnl>0 at the call site; a break-even close arrives here as won:false
  const r = adherenceOutcome([t(true, false), t(true, false), t(true, true)]);
  assert.equal(r.followed.wins, 1);
  assert.equal(r.followed.winRatePct, (1 / 3) * 100);
});

test("MIN_COHORT boundary: one cohort below threshold → delta exists but sufficient=false", () => {
  const trades = [
    ...Array(MIN_COHORT).fill(t(true, true)), // followed n == MIN_COHORT
    ...Array(MIN_COHORT - 1).fill(t(false, false)), // broke n == MIN_COHORT-1
  ];
  const r = adherenceOutcome(trades);
  assert.equal(MIN_COHORT, 5);
  assert.equal(r.followed.n, MIN_COHORT);
  assert.equal(r.broke.n, MIN_COHORT - 1);
  assert.notEqual(r.deltaPts, null); // a delta is computable...
  assert.equal(r.sufficient, false); // ...but not yet a signal
});

test("inverted result is reported faithfully, never suppressed (broke out-wins followed)", () => {
  const trades = [
    t(true, false), t(true, false), t(true, false), t(true, false), t(true, true), // followed: 1/5 = 20%
    ...Array(4).fill(t(false, true)), t(false, false), // broke: 4/5 = 80%
  ];
  const r = adherenceOutcome(trades);
  assert.ok(r.deltaPts < 0, "delta should be negative when broke-plan out-wins");
  assert.equal(r.sufficient, true); // still a valid (if uncomfortable) reading
  assert.equal(r.broke.winRatePct, 80);
});

test("delta is null when one cohort is empty (cannot compare against nothing)", () => {
  const r = adherenceOutcome([t(true, true), t(true, false), t(true, true), t(true, true)]);
  assert.equal(r.broke.n, 0);
  assert.equal(r.deltaPts, null);
  assert.equal(r.sufficient, false);
});
