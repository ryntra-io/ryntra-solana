import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePredictionPlan, evaluateTradingPlan, nextObservations } from "./engine.ts";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const NOW_ISO = "2026-09-18T12:00:00.000Z";

const plan = (overrides = {}) => ({
  planId: "plan_test",
  symbol: "NVDAx",
  status: "active",
  paused: false,
  maxPricePerShare: 224,
  invalidationPerShare: 197.75,
  validUntil: "2026-10-18T12:00:00.000Z",
  maxReferenceDeviationPct: 1.5,
  evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", required: true }],
  ...overrides,
});

const market = (overrides = {}) => ({
  lastPriceUsd: 219.6,
  referencePerShare: 219.67,
  deviationPct: 0.1,
  observedAt: NOW_ISO,
  ...overrides,
});

test("a plan inside its bounds is watching and does not fire", () => {
  const result = evaluateTradingPlan({
    plan: plan(),
    market: market(),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(result.status, "watching");
  assert.equal(result.crossings.length, 0);
  assert.ok(result.findings.every((row) => !row.material));
});

test("crossing the price bound fires once; a retry of the same state does not", () => {
  const first = evaluateTradingPlan({
    plan: plan(),
    market: market({ lastPriceUsd: 230 }),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(first.status, "needs_attention");
  assert.equal(first.crossings.length, 1);
  assert.match(first.crossings[0].finding.reason.en, /will not pay more/);
  assert.equal(first.findings.some((row) => row.title.en.includes("BUY") || row.title.en.includes("SELL")), false);

  const again = evaluateTradingPlan({
    plan: plan(),
    market: market({ lastPriceUsd: 231 }),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW + 60_000,
    previous: nextObservations(NOW_ISO, first.findings),
  });
  assert.equal(again.status, "needs_attention");
  assert.equal(again.crossings.length, 0, "same fail key is not a new trigger");
});

test("returning to pass then failing again is a new crossing", () => {
  const fail = evaluateTradingPlan({
    plan: plan(),
    market: market({ lastPriceUsd: 230 }),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW,
    previous: [],
  });
  const ok = evaluateTradingPlan({
    plan: plan(),
    market: market({ lastPriceUsd: 210 }),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW + 1,
    previous: nextObservations(NOW_ISO, fail.findings),
  });
  assert.equal(ok.status, "watching");
  const again = evaluateTradingPlan({
    plan: plan(),
    market: market({ lastPriceUsd: 230 }),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW + 2,
    previous: nextObservations(NOW_ISO, ok.findings),
  });
  assert.equal(again.crossings.length, 1);
});

test("stale evidence is needs-attention and never a pass; a provider fault is not a trigger", () => {
  const stale = evaluateTradingPlan({
    plan: plan(),
    market: market(),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "unknown", reason: "old", state: "STALE", served: "stale-cache" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(stale.status, "needs_attention");
  assert.equal(stale.crossings[0].finding.outcome, "stale");
  assert.match(stale.crossings[0].finding.reason.en, /fresh reading/);

  const down = evaluateTradingPlan({
    plan: plan({ evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", required: false }] }),
    market: market(),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "unknown", reason: "timeout", state: "UNAVAILABLE", served: "none" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(down.status, "unavailable");
  assert.equal(down.crossings.length, 0, "a provider fault is not a triggered condition");

  const requiredDown = evaluateTradingPlan({
    plan: plan({ evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", required: true }] }),
    market: market(),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "unknown", reason: "timeout", state: "UNAVAILABLE", served: "none" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(requiredDown.status, "unavailable");
  assert.equal(requiredDown.crossings.length, 0, "a required source that did not answer is not a triggered condition");
});

test("an expired plan needs attention; a cancelled plan is paused", () => {
  const expired = evaluateTradingPlan({
    plan: plan({ validUntil: "2026-09-18T11:00:00.000Z" }),
    market: market(),
    evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(expired.status, "needs_attention");
  assert.ok(expired.findings.some((row) => row.kind === "plan.expiry" && row.outcome === "fail"));

  const paused = evaluateTradingPlan({
    plan: plan({ status: "cancelled" }),
    market: market(),
    evidence: [],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.crossings.length, 0);
});

test("a prediction crossing is paper-labelled and never a buy instruction", () => {
  const result = evaluatePredictionPlan({
    plan: {
      planId: "pplan_test",
      title: "Fed Decision in October?",
      status: "active",
      paused: false,
      paper: true,
      maxProbability: 0.65,
      invalidationProbability: 0.4,
      resolutionDeadline: "2026-10-29T00:00:00.000Z",
      monitoring: [{ conditionId: "m-1", metric: "probability", direction: "above", threshold: 0.65 }],
    },
    market: { probability: 0.72, endsAt: "2026-10-29T00:00:00.000Z", signalFingerprint: "sig-a", paper: true },
    nowMs: NOW,
    previous: [],
  });
  assert.equal(result.status, "needs_attention");
  assert.ok(result.crossings.every((row) => /Paper prediction/.test(row.finding.title.en)));
  assert.ok(result.crossings.every((row) => /not a real-money position/.test(row.finding.reason.en)));
  assert.equal(result.findings.some((row) => /BUY|SELL|guaranteed/i.test(row.title.en + row.reason.en)), false);
});

test("the same prediction crossing is not duplicated on retry", () => {
  const plan = {
    planId: "pplan_test",
    title: "Fed",
    status: "active",
    paused: false,
    paper: true,
    maxProbability: 0.65,
    invalidationProbability: null,
    resolutionDeadline: null,
    monitoring: [],
  };
  const first = evaluatePredictionPlan({
    plan,
    market: { probability: 0.8, endsAt: null, signalFingerprint: null, paper: true },
    nowMs: NOW,
    previous: [],
  });
  const again = evaluatePredictionPlan({
    plan,
    market: { probability: 0.81, endsAt: null, signalFingerprint: null, paper: true },
    nowMs: NOW + 5_000,
    previous: nextObservations(NOW_ISO, first.findings),
  });
  assert.equal(first.crossings.length, 1);
  assert.equal(again.crossings.length, 0);
});

/* A plan on a token-unit instrument (a PreStocks token) is judged on the
   token's own price — the row states no share
   figure and no reference for a private company, and the engine must not
   mistake that for missing market data. The note's figures are the token's. */
test("a token-unit plan crosses its price bound on the token's price; the missing reference is not a trigger", () => {
  const tokenPlan = plan({ planId: "plan_anthropic", symbol: "ANTHROPIC", maxPricePerShare: 100, invalidationPerShare: 50, maxReferenceDeviationPct: null, evidence: [] });
  const tokenMarket = market({ lastPriceUsd: 966.37, referencePerShare: null, deviationPct: null });
  const result = evaluateTradingPlan({ plan: tokenPlan, market: tokenMarket, evidence: [], nowMs: NOW, previous: [] });
  assert.equal(result.status, "needs_attention");
  const bound = result.findings.find((row) => row.kind === "plan.price_bound");
  assert.equal(bound.outcome, "fail");
  assert.equal(bound.material, true);
  assert.equal(bound.title.en, "ANTHROPIC is above your price bound");
  assert.match(bound.reason.en, /\$966\.37/);
  assert.match(bound.reason.en, /\$100\.00/);
  assert.equal(result.crossings.length, 1);
  assert.equal(result.crossings[0].finding.kind, "plan.price_bound");
  assert.ok(!result.findings.some((row) => row.kind === "plan.deviation"), "no deviation condition was written, none is judged");
  /* The same state on the next pass is not a second crossing. */
  const again = evaluateTradingPlan({ plan: tokenPlan, market: tokenMarket, evidence: [], nowMs: NOW + 300_000, previous: nextObservations(NOW_ISO, result.findings) });
  assert.equal(again.crossings.length, 0);
  /* A deviation rule written on a row without a reference is unavailable, never a trigger and never a pass. */
  const withDeviation = evaluateTradingPlan({ plan: plan({ symbol: "ANTHROPIC", maxPricePerShare: 1200, maxReferenceDeviationPct: 2, evidence: [] }), market: tokenMarket, evidence: [], nowMs: NOW, previous: [] });
  const deviation = withDeviation.findings.find((row) => row.kind === "plan.deviation");
  assert.equal(deviation.outcome, "unavailable");
  assert.equal(deviation.material, false);
  assert.equal(withDeviation.crossings.length, 0);
});

/* A plan whose buy settled is watched as a position: its loss limit only, in the position's words, never a sale made for the person. */
test("a plan whose buy settled is watched for its loss limit only, in a position's words", () => {
  const evidence = [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "fail", reason: "volume fell", state: "FRESH", served: "cache" }];
  const calm = evaluateTradingPlan({ plan: plan({ status: "executed" }), market: market({ lastPriceUsd: 260, deviationPct: 9 }), evidence, nowMs: Date.parse("2026-11-01T00:00:00.000Z"), previous: [] });
  assert.equal(calm.status, "watching", "above the loss limit: watching, whatever the spent entry rules would say");
  assert.deepEqual(calm.findings.map((row) => row.kind), ["plan.invalidation"], "the bound, the window, the deviation and the evidence decided an entry that already happened");
  assert.equal(calm.findings[0].title.en, "Your loss limit");
  assert.equal(calm.crossings.length, 0);

  const hit = evaluateTradingPlan({ plan: plan({ status: "executed" }), market: market({ lastPriceUsd: 190 }), evidence, nowMs: NOW, previous: [] });
  assert.equal(hit.crossings.length, 1, "reaching the loss limit is one note");
  assert.equal(hit.crossings[0].finding.title.en, "NVDAx reached your loss limit");
  assert.equal(hit.crossings[0].finding.title.uk, "NVDAx дійшов до твоєї межі збитку");
  assert.match(hit.crossings[0].finding.reason.en, /does not sign for you/);
  assert.match(hit.crossings[0].finding.reason.uk, /не підписує за тебе/);
  assert.doesNotMatch(`${hit.crossings[0].finding.reason.en} ${hit.crossings[0].finding.reason.uk}`, /sell now|продавай/i, "a note says what changed and whose act comes next, never an order");
});

test("an active plan keeps its entry rules and its own words for the invalidation", () => {
  const result = evaluateTradingPlan({ plan: plan(), market: market({ lastPriceUsd: 190 }), evidence: [{ conditionId: "ev-1", metric: "dex_volume_usd", outcome: "pass", reason: "ok", state: "FRESH", served: "cache" }], nowMs: NOW, previous: [] });
  assert.ok(result.findings.some((row) => row.kind === "plan.price_bound"));
  assert.ok(result.findings.some((row) => row.kind === "plan.expiry"));
  assert.equal(result.findings.find((row) => row.kind === "plan.invalidation").title.en, "NVDAx reached where the thesis is wrong");
});
