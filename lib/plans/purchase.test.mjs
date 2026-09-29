import assert from "node:assert/strict";
import test from "node:test";

import { PlanRulesSchema } from "../api/v1/contract.ts";
import { LOSS_LIMIT_PRESETS, lossLimitPurchase, PURCHASE_VALID_MS } from "./purchase.ts";
import { moneyChecks } from "./review.ts";
import { computePlanSizing } from "./sizing.ts";

/*
 * RYN-FIRST-SCREEN-001, S3 — the purchase with a loss limit is the person's
 * amount and a published preset turned into a plan. The property that makes
 * it one loop and not a trap: the purchase the person chose, at any price
 * the Review's own bound lets through, passes every required money check —
 * and a price above that bound does not.
 */

const NOW = Date.parse("2026-09-24T09:00:00.000Z");
const PRICES = [212.5, 1055.01, 0.004321, 3.3];
const AMOUNTS = [10, 20, 50, 100];

for (const preset of Object.keys(LOSS_LIMIT_PRESETS)) {
  test(`«${preset}»: the chosen amount passes every required money check at any price up to the bound, and none above it`, () => {
    for (const price of PRICES) {
      for (const amount of AMOUNTS) {
        const made = lossLimitPurchase({ amountUsd: amount, pricePerUnit: price, preset, hasReference: false, thesis: "A purchase with a loss limit.", nowMs: NOW });
        assert.ok(made, `${preset} ${amount} @ ${price}`);
        const rules = PlanRulesSchema.parse(made.rules);
        const sized = computePlanSizing(rules, NOW, { unitWord: "share", tokenAsset: false });
        assert.ok(sized.ok, `${preset} ${amount} @ ${price}: ${JSON.stringify(sized.ok ? null : sized.issues)}`);
        for (const perShare of [rules.entry.pricePerShare, rules.entry.maxPricePerShare]) {
          const checks = moneyChecks({ rules, sizing: sized.sizing, usdAmount: amount, units: amount / perShare, perShare, symbol: "X" });
          const failed = checks.filter((check) => check.required && check.outcome !== "pass");
          assert.deepEqual(failed, [], `${preset} $${amount} @ ${perShare} (entry ${rules.entry.pricePerShare}): ${JSON.stringify(failed)}`);
        }
        const above = rules.entry.maxPricePerShare * 1.001;
        const refused = moneyChecks({ rules, sizing: sized.sizing, usdAmount: amount, units: amount / above, perShare: above, symbol: "X" });
        assert.equal(refused.find((check) => check.id === "entryPrice").outcome, "fail", "above the bound the Review refuses");
      }
    }
  });
}

test("the card's figures are the plan's: the limit, the target and the most that can be lost, in the preset's own percentages", () => {
  const made = lossLimitPurchase({ amountUsd: 100, pricePerUnit: 200, preset: "balanced", hasReference: true, thesis: "x", nowMs: NOW });
  assert.equal(made.limitPerUnit, 180, "−10 %");
  assert.equal(made.targetPerUnit, 240, "+20 %");
  assert.equal(made.rules.risk.invalidationPerShare, 180);
  assert.equal(made.rules.exit.targetPerShare, 240);
  assert.equal(made.rules.exit.invalidationIsOrder, false, "a rule the person acts on, never an order");
  assert.equal(made.rules.risk.plannedRiskUsd, made.canLoseUsd, "the card shows the ceiling the Review enforces");
  assert.ok(made.canLoseUsd > 10 && made.canLoseUsd < 13, `−10 % of $100 plus costs and the price bound's room: ${made.canLoseUsd}`);
  assert.equal(made.rules.capital.budgetUsd - made.rules.capital.reserveForCostsUsd, 100, "the spendable part is exactly the amount chosen");
  assert.equal(made.rules.execution.referenceRequired, false, "a closed exchange does not block a purchase; the deviation bound still does");
  assert.equal(made.rules.execution.maxReferenceDeviationPct, 1.5);
  assert.equal(Date.parse(made.rules.entry.validUntil) - NOW, PURCHASE_VALID_MS, "a purchase decided now, not an order left waiting");

  const careful = lossLimitPurchase({ amountUsd: 100, pricePerUnit: 200, preset: "careful", hasReference: false, thesis: "x", nowMs: NOW });
  assert.equal(careful.limitPerUnit, 190, "−5 %");
  assert.equal(careful.targetPerUnit, 220, "+10 %");
  assert.equal(careful.rules.execution.maxReferenceDeviationPct, null, "no reference, no deviation bound");
});

test("nothing is made from a missing or impossible figure", () => {
  assert.equal(lossLimitPurchase({ amountUsd: 0, pricePerUnit: 200, preset: "balanced", hasReference: false, thesis: "x", nowMs: NOW }), null);
  assert.equal(lossLimitPurchase({ amountUsd: 20, pricePerUnit: Number.NaN, preset: "balanced", hasReference: false, thesis: "x", nowMs: NOW }), null);
  assert.equal(lossLimitPurchase({ amountUsd: 20, pricePerUnit: -1, preset: "careful", hasReference: false, thesis: "x", nowMs: NOW }), null);
});
