// Run from repo root: node --test lib/plans/sizing.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { PlanRulesSchema, PlanSizingSchema } from "../api/v1/contract.ts";
import { computePlanSizing, validatePlanRules } from "./sizing.ts";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

/** A well-formed spot-long plan on a $180 stock. */
export function exampleRules(overrides = {}) {
  return PlanRulesSchema.parse({
    thesis: { text: "Data-centre demand keeps the next two quarters above guidance.", whyNow: "Earnings in three weeks.", horizon: { unit: "weeks", value: 8 }, sources: ["https://example.com/thesis"], assumptions: ["No export restriction before the print."] },
    entry: { pricePerShare: 180, maxPricePerShare: 185, validUntil: "2026-10-15T00:00:00.000Z" },
    capital: { budgetUsd: 1000, reserveForCostsUsd: 20 },
    risk: { invalidationPerShare: 160, plannedRiskUsd: 100, costBufferBps: 100 },
    exit: { targetPerShare: 230, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: 1.5, referenceRequired: true, minLiquidityUsd: null },
    evidenceConditions: [],
    ...overrides,
  });
}

test("a well-formed plan sizes by the formula, limited by the smaller of risk and capital", () => {
  const result = computePlanSizing(exampleRules(), NOW);
  assert.ok(result.ok);
  const { sizing } = result;
  PlanSizingSchema.parse(sizing);
  /* loss per share = 180 − 160 + 180 × 1 % = 21.8 */
  assert.equal(sizing.lossPerShareUsd, 21.8);
  /* 100 / 21.8 = 4.587155…, truncated to six decimals */
  assert.equal(sizing.riskLimitedUnits, 4.587155);
  /* (1000 − 20) / 180 = 5.444444… */
  assert.equal(sizing.capitalLimitedUnits, 5.444444);
  assert.equal(sizing.units, 4.587155);
  assert.equal(sizing.limitedBy, "risk");
  assert.equal(sizing.notionalUsd, 825.68);
  assert.ok(sizing.assumptions.some((line) => /not an exit order/.test(line)));
  assert.ok(sizing.assumptions.some((line) => /limited by the planned risk/.test(line)));
});

test("capital limits the size when the risk would allow more", () => {
  const result = computePlanSizing(exampleRules({ risk: { invalidationPerShare: 160, plannedRiskUsd: 900, costBufferBps: 100 } }), NOW);
  assert.ok(result.ok);
  assert.equal(result.sizing.limitedBy, "capital");
  assert.equal(result.sizing.units, 5.444444);
  assert.equal(result.sizing.notionalUsd, 979.99);
});

test("the same rules always size the same — deterministic, no clock inside the number", () => {
  const a = computePlanSizing(exampleRules(), NOW);
  const b = computePlanSizing(exampleRules(), NOW + 86_400_000);
  assert.deepEqual(a, b);
});

test("entry at or below the invalidation is refused, with the field named", () => {
  const issues = validatePlanRules(exampleRules({ risk: { invalidationPerShare: 180, plannedRiskUsd: 100, costBufferBps: 100 } }), NOW);
  assert.deepEqual(issues.map((issue) => issue.path), ["risk.invalidationPerShare"]);
  const sized = computePlanSizing(exampleRules({ risk: { invalidationPerShare: 200, plannedRiskUsd: 100, costBufferBps: 100 } }), NOW);
  assert.ok(!sized.ok);
});

test("every contradiction is named at once, one issue per field", () => {
  const issues = validatePlanRules(
    exampleRules({
      entry: { pricePerShare: 180, maxPricePerShare: 170, validUntil: "2026-09-01T00:00:00.000Z" },
      capital: { budgetUsd: 100, reserveForCostsUsd: 100 },
      risk: { invalidationPerShare: 160, plannedRiskUsd: 500, costBufferBps: 100 },
      exit: { targetPerShare: 150, timeExitAt: "2026-09-01T00:00:00.000Z", invalidationIsOrder: false },
      /* Carried, not judged here: the evidence layer validates conditions on its own registry (`lib/evidence/conditions.ts`). */
      evidenceConditions: [{ metric: "dex_volume_usd", window: "7d", operator: "gt", threshold: 0, mode: "advisory", onUnknown: "warn" }],
    }),
    NOW,
  );
  assert.deepEqual(
    issues.map((issue) => issue.path).sort(),
    ["capital.reserveForCostsUsd", "entry.maxPricePerShare", "entry.validUntil", "exit.targetPerShare", "exit.timeExitAt", "risk.plannedRiskUsd"].sort(),
  );
});

test("a time exit before the entry's validity ends is a contradiction", () => {
  const issues = validatePlanRules(exampleRules({ exit: { targetPerShare: null, timeExitAt: "2026-10-01T00:00:00.000Z", invalidationIsOrder: false } }), NOW);
  assert.deepEqual(issues.map((issue) => issue.path), ["exit.timeExitAt"]);
});

test("costs are modelled once: a zero buffer sizes on the bare distance to the invalidation", () => {
  const result = computePlanSizing(exampleRules({ risk: { invalidationPerShare: 160, plannedRiskUsd: 100, costBufferBps: 0 } }), NOW);
  assert.ok(result.ok);
  assert.equal(result.sizing.lossPerShareUsd, 20);
  assert.equal(result.sizing.riskLimitedUnits, 5);
});
