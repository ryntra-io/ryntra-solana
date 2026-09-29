/**
 * Network-free tests over the Trading Plan helpers. The sizing figures are
 * computed by hand in the comments, so a change in the formula fails on a
 * number rather than on a snapshot.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { computePlanSizing, decimalReadingDiffers, parseDecimalInput, validatePlanRules } from "./index.ts";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const LATER = "2026-10-16T12:00:00.000Z";

/* The plan from the product's own builder: entry 973.15, invalidation 882.86,
   a $1,000 budget with $10 kept for costs, $100 of planned risk, 1 % of costs
   and slippage modelled on the way in and out together. */
const rules = {
  entry: { pricePerShare: 973.15, maxPricePerShare: 992.61, validUntil: LATER },
  capital: { budgetUsd: 1000, reserveForCostsUsd: 10 },
  risk: { invalidationPerShare: 882.86, plannedRiskUsd: 100, costBufferBps: 100 },
  exit: { targetPerShare: null, timeExitAt: null },
  evidenceConditions: [],
};

test("a well-formed plan has no issues and a size limited by the planned risk", () => {
  assert.deepEqual(validatePlanRules(rules, NOW), []);
  const result = computePlanSizing(rules, NOW);
  assert.equal(result.ok, true);
  const { sizing } = result;
  assert.equal(sizing.model, "spot-long-v1");
  /* lossPerShare = 973.15 − 882.86 + 973.15 × 0.01 = 90.29 + 9.7315 = 100.0215 */
  assert.equal(sizing.lossPerShareUsd, 100.0215);
  /* riskLimitedUnits = 100 / 100.0215 = 0.999785… → 0.999785 (truncated to six decimals) */
  assert.equal(sizing.riskLimitedUnits, 0.999785);
  /* capitalLimitedUnits = (1000 − 10) / 973.15 = 1.017314… → 1.017314 */
  assert.equal(sizing.capitalLimitedUnits, 1.017314);
  assert.equal(sizing.units, 0.999785);
  assert.equal(sizing.limitedBy, "risk");
  /* notional = 0.999785 × 973.15 = 972.94… → 972.94 */
  assert.equal(sizing.notionalUsd, 972.94);
  assert.ok(sizing.assumptions.length >= 3, "the assumptions travel with the figure");
  assert.ok(sizing.assumptions.some((line) => /not an exit order/.test(line)), "the invalidation is named as a rule, not an order");
});

test("a small budget is limited by the capital, net of the reserve", () => {
  const capitalBound = { ...rules, capital: { budgetUsd: 500, reserveForCostsUsd: 10 } };
  const result = computePlanSizing(capitalBound, NOW);
  assert.equal(result.ok, true);
  /* (500 − 10) / 973.15 = 0.503519… → 0.503519, below the 0.999785 the risk allows. */
  assert.equal(result.sizing.units, 0.503519);
  assert.equal(result.sizing.limitedBy, "capital");
  assert.ok(result.sizing.assumptions.some((line) => /limited by the budget/.test(line)));
});

test("the rules that fail as rules are named by path, before any size is computed", () => {
  const broken = {
    ...rules,
    entry: { pricePerShare: 973.15, maxPricePerShare: 900, validUntil: "2026-09-16T11:00:00.000Z" },
    risk: { invalidationPerShare: 980, plannedRiskUsd: 2000, costBufferBps: 100 },
    exit: { targetPerShare: 900, timeExitAt: "2026-09-16T11:30:00.000Z" },
    /* Carried through untouched: a condition on an observation is judged by the evidence layer, not by the size. */
    evidenceConditions: [{ metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: 1_000_000, mode: "required", onUnknown: "block" }],
  };
  const paths = validatePlanRules(broken, NOW).map((issue) => issue.path);
  assert.deepEqual(paths, [
    "risk.invalidationPerShare",
    "entry.maxPricePerShare",
    "entry.validUntil",
    "risk.plannedRiskUsd",
    "exit.targetPerShare",
    "exit.timeExitAt",
  ]);
  const result = computePlanSizing(broken, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, paths.length);
});

test("a reserve that eats the budget sizes to nothing", () => {
  const nothing = { ...rules, capital: { budgetUsd: 10, reserveForCostsUsd: 10 } };
  const result = computePlanSizing(nothing, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].path, "capital.reserveForCostsUsd");
});

test("decimal input is read the way the person meant it", () => {
  assert.equal(parseDecimalInput("0,5"), 0.5);
  assert.equal(parseDecimalInput("0.5"), 0.5);
  assert.equal(parseDecimalInput("1 000,50"), 1000.5);
  assert.equal(parseDecimalInput("1,234.56"), 1234.56);
  assert.equal(parseDecimalInput("1.234,56"), 1234.56);
  assert.equal(parseDecimalInput("1,000,000"), 1_000_000);
  assert.equal(parseDecimalInput("$1000"), 1000);
  /* One separator is the decimal separator, by the documented rule; the form shows this reading beside the field. */
  assert.equal(parseDecimalInput("1,234"), 1.234);
  assert.equal(parseDecimalInput("12."), 12);
  assert.equal(parseDecimalInput(".5"), 0.5);
});

test("what cannot be read without guessing is null, never another number", () => {
  assert.equal(parseDecimalInput(""), null);
  assert.equal(parseDecimalInput("   "), null);
  assert.equal(parseDecimalInput("1,23.45"), null);
  assert.equal(parseDecimalInput("1,2,3"), null);
  assert.equal(parseDecimalInput("abc"), null);
  assert.equal(parseDecimalInput("1e5"), null);
});

test("the reading is shown beside the field only when a person could read it differently", () => {
  assert.equal(decimalReadingDiffers("1000"), false);
  assert.equal(decimalReadingDiffers("0.5"), false);
  assert.equal(decimalReadingDiffers("0,5"), true);
  assert.equal(decimalReadingDiffers("1 000"), true);
  assert.equal(decimalReadingDiffers("$50"), true);
  assert.equal(decimalReadingDiffers("abc"), false);
});
