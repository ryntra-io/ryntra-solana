// Run from repo root: node --test lib/rwa/risk.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRwaRisk, computePremiumPct, HIGH_SPREAD_BPS, HIGH_FUNDING_HOURLY, HIGH_PREMIUM_PCT } from "./risk.ts";

/** Healthy regular-hours stock-token snapshot; override per test. */
function snap(over = {}) {
  return {
    symbol: "NVDA",
    assetType: "stock-token",
    marketOpen: true,
    offHours: false,
    oracleFresh: true,
    oraclePaused: false,
    sequencerUp: true,
    spreadBps: 5,
    premiumPct: 0.3,
    bookOneSided: null,
    fundingRateHourly: null,
    initialMarginFraction: 0.1,
    offHoursInitialMarginFraction: 0.15,
    corporateAction: "none",
    ...over,
  };
}

test("all good → ok, no reasons", () => {
  const r = classifyRwaRisk(snap());
  assert.equal(r.level, "ok");
  assert.deepEqual(r.reasons, []);
});

test("off-hours → caution, mentions closed market and higher margin", () => {
  const r = classifyRwaRisk(snap({ marketOpen: false, offHours: true }));
  assert.equal(r.level, "caution");
  assert.ok(r.reasons.some((x) => /closed/i.test(x)));
  assert.ok(r.reasons.some((x) => /margin/i.test(x)));
});

test("oracle paused → avoid", () => {
  const r = classifyRwaRisk(snap({ oraclePaused: true }));
  assert.equal(r.level, "avoid");
  assert.ok(r.reasons.some((x) => /paused/i.test(x)));
});

test("stale oracle while market OPEN → avoid", () => {
  const r = classifyRwaRisk(snap({ oracleFresh: false, offHours: false }));
  assert.equal(r.level, "avoid");
  assert.ok(r.reasons.some((x) => /stale/i.test(x)));
});

test("stale oracle while market CLOSED → caution, not a false red (24/5 feed off-hours is expected)", () => {
  const r = classifyRwaRisk(snap({ oracleFresh: false, marketOpen: false, offHours: true }));
  assert.equal(r.level, "caution");
  assert.ok(!r.reasons.some((x) => /stale/i.test(x))); // off-hours flat feed is not called "stale"
  assert.ok(r.reasons.some((x) => /closed/i.test(x)));
});

test("sequencer down → avoid", () => {
  const r = classifyRwaRisk(snap({ sequencerUp: false }));
  assert.equal(r.level, "avoid");
  assert.ok(r.reasons.some((x) => /sequencer/i.test(x)));
});

test("corporate action paused → avoid; wording hedges ('typically pauses'), never states the halt as fact", () => {
  const r = classifyRwaRisk(snap({ corporateAction: "paused" }));
  assert.equal(r.level, "avoid");
  assert.ok(r.reasons.some((x) => /typically pauses/.test(x)));
  assert.ok(!r.reasons.some((x) => /is paused/.test(x) && /market/.test(x)));
});

test("high spread → caution (threshold is inclusive)", () => {
  assert.equal(classifyRwaRisk(snap({ spreadBps: HIGH_SPREAD_BPS })).level, "caution");
  assert.equal(classifyRwaRisk(snap({ spreadBps: HIGH_SPREAD_BPS - 1 })).level, "ok");
});

test("elevated funding → caution (absolute value)", () => {
  assert.equal(classifyRwaRisk(snap({ fundingRateHourly: HIGH_FUNDING_HOURLY })).level, "caution");
  assert.equal(classifyRwaRisk(snap({ fundingRateHourly: -HIGH_FUNDING_HOURLY })).level, "caution");
  assert.equal(classifyRwaRisk(snap({ fundingRateHourly: HIGH_FUNDING_HOURLY / 2 })).level, "ok");
});

test("corporate action pending → caution", () => {
  assert.equal(classifyRwaRisk(snap({ corporateAction: "pending" })).level, "caution");
});

test("notable premium → caution, says 'above … (est.)' (threshold inclusive, absolute)", () => {
  const up = classifyRwaRisk(snap({ premiumPct: HIGH_PREMIUM_PCT }));
  assert.equal(up.level, "caution");
  assert.ok(up.reasons.some((x) => /above/.test(x) && /est\./.test(x)));
  const down = classifyRwaRisk(snap({ premiumPct: -HIGH_PREMIUM_PCT }));
  assert.equal(down.level, "caution");
  assert.ok(down.reasons.some((x) => /below/.test(x)));
  assert.equal(classifyRwaRisk(snap({ premiumPct: HIGH_PREMIUM_PCT / 2 })).level, "ok");
});

test("premium wording: fresh oracle → 'live oracle price'; flat off-hours feed → 'last price'; never 'underlying'", () => {
  const fresh = classifyRwaRisk(snap({ premiumPct: HIGH_PREMIUM_PCT }));
  assert.ok(fresh.reasons.some((x) => /live oracle price/.test(x)));
  // the feed prices the TOKEN — claiming "the underlying's price" is wrong once uiMultiplier > 1
  assert.ok(!fresh.reasons.some((x) => /underlying/.test(x)));
  const flat = classifyRwaRisk(snap({ premiumPct: HIGH_PREMIUM_PCT, oracleFresh: false, marketOpen: false, offHours: true }));
  assert.equal(flat.level, "caution"); // off-hours stale feed is not a false red
  assert.ok(flat.reasons.some((x) => /last price/.test(x)));
});

test("premium/book null = not measured → never degrades the verdict (enhancement signals)", () => {
  assert.equal(classifyRwaRisk(snap({ premiumPct: null, bookOneSided: null })).level, "ok");
});

test("one-sided book → caution; two-sided → ok", () => {
  const r = classifyRwaRisk(snap({ bookOneSided: true }));
  assert.equal(r.level, "caution");
  assert.ok(r.reasons.some((x) => /one-sided/.test(x)));
  assert.equal(classifyRwaRisk(snap({ bookOneSided: false })).level, "ok");
});

test("computePremiumPct: sign and magnitude; junk prices → null, never a fake 0%", () => {
  assert.ok(Math.abs(computePremiumPct(102, 100) - 2) < 1e-9);
  assert.ok(Math.abs(computePremiumPct(98, 100) - -2) < 1e-9);
  assert.equal(computePremiumPct(null, 100), null);
  assert.equal(computePremiumPct(100, null), null);
  assert.equal(computePremiumPct(0, 100), null);
  assert.equal(computePremiumPct(100, 0), null);
  assert.equal(computePremiumPct(NaN, 100), null);
  assert.equal(computePremiumPct(100, Infinity), null);
});

test("corporate action unknown on an RWA asset → caution (status unavailable)", () => {
  const r = classifyRwaRisk(snap({ corporateAction: "unknown" }));
  assert.equal(r.level, "caution");
  assert.ok(r.reasons.some((x) => /unavailable/i.test(x)));
});

test("missing oracle with no other triggers → unknown (sequencer-null no longer adds a reason)", () => {
  const r = classifyRwaRisk(snap({ oracleFresh: null, oraclePaused: null, sequencerUp: null }));
  assert.equal(r.level, "unknown");
  assert.equal(r.reasons.length, 1); // only the oracle reason — sequencer null is not "missing"
  assert.ok(r.reasons.some((x) => /oracle/i.test(x)));
});

test("sequencer NOT monitored (null) with every other signal healthy → ok, never 'partial data'", () => {
  // the whole reason for decoupling: an unmeasurable sequencer must not pin the verdict to unknown
  const r = classifyRwaRisk(snap({ sequencerUp: null }));
  assert.equal(r.level, "ok");
  assert.deepEqual(r.reasons, []);
});

test("partially-connected oracle (freshness missing, pause known) → unknown, never ok", () => {
  const r = classifyRwaRisk(snap({ oracleFresh: null, oraclePaused: false }));
  assert.equal(r.level, "unknown");
  assert.ok(r.reasons.some((x) => /oracle/i.test(x)));
});

test("partially-connected oracle (pause missing, freshness known) → unknown, never ok", () => {
  assert.equal(classifyRwaRisk(snap({ oraclePaused: null, oracleFresh: true })).level, "unknown");
});

test("missing market-hours estimate on an RWA asset → unknown", () => {
  assert.equal(classifyRwaRisk(snap({ marketOpen: null })).level, "unknown");
});

test("crypto: null marketOpen and corporateAction none do not degrade the level", () => {
  const r = classifyRwaRisk(snap({ assetType: "crypto", marketOpen: null, corporateAction: "none" }));
  assert.equal(r.level, "ok");
});

test("precedence: avoid beats caution (paused oracle during off-hours)", () => {
  const r = classifyRwaRisk(snap({ oraclePaused: true, marketOpen: false, offHours: true }));
  assert.equal(r.level, "avoid");
});

test("precedence: caution beats unknown (off-hours with oracle not connected)", () => {
  const r = classifyRwaRisk(snap({ marketOpen: false, offHours: true, oracleFresh: null, oraclePaused: null, sequencerUp: null }));
  assert.equal(r.level, "caution");
});

test("off-hours wording: est. source (default) hedges with '(est.)'", () => {
  const r = classifyRwaRisk(snap({ marketOpen: false, offHours: true }));
  assert.ok(r.reasons.some((x) => /closed/i.test(x) && /est\./i.test(x)), "default off-hours reason should hedge with (est.)");
});

test("off-hours wording: venue source states the fact plainly (no '(est.)', no 'likely')", () => {
  const r = classifyRwaRisk(snap({ marketOpen: false, offHours: true, marketOpenSource: "venue" }));
  assert.equal(r.level, "caution");
  const offHoursReason = r.reasons.find((x) => /closed/i.test(x));
  assert.ok(offHoursReason, "should carry a closed-market reason");
  assert.ok(!/est\./i.test(offHoursReason), "venue-sourced reason must not hedge with (est.)");
  assert.ok(!/likely/i.test(offHoursReason), "venue-sourced reason must not say 'likely'");
});
