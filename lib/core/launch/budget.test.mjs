import assert from "node:assert/strict";
import test from "node:test";

import {
  BUDGET_LADDER,
  BUDGET_RULE,
  addPriceSeen,
  budgetExhausted,
  budgetPlaceableRaw,
  budgetReserveRaw,
  budgetRisk,
  budgetSteps,
  budgetTotals,
  dayTopUpsRaw,
  inPoolBudget,
  partnerMigrationFeeRaw,
  partnerSurplusRaw,
  revenueAlertDue,
  revenueLeftRaw,
  splitClaim,
  walletFreeRaw,
} from "./budget.ts";
import { CLASSIC_SHAPE, binOfPrice, floorLadder, floorRaise, priceOfBin } from "./autopilot.ts";

const USDC = (value) => BigInt(Math.round(value * 1_000_000));

test("the migration fee and the surplus go to the budget whole; a quarter of the curve's and the locked position's fees, three quarters Ryntra's revenue", () => {
  assert.deepEqual(splitClaim("migration", USDC(60)), { budgetRaw: USDC(60), revenueRaw: 0n });
  assert.deepEqual(splitClaim("surplus", USDC(3)), { budgetRaw: USDC(3), revenueRaw: 0n });
  assert.deepEqual(splitClaim("curve", USDC(62.179786)), { budgetRaw: 15_544_946n, revenueRaw: 46_634_840n });
  assert.deepEqual(splitClaim("lp", 3n), { budgetRaw: 0n, revenueRaw: 3n }, "the rounding is the revenue's, never the budget's above a quarter");
  assert.deepEqual(splitClaim("lp", 0n), { budgetRaw: 0n, revenueRaw: 0n });
});

test("the totals count each transaction once, by source", () => {
  const claim = (source, signature, pair) => ({ source, signature, at: null, pairRaw: String(pair), tokensRaw: "0", ...Object.fromEntries(Object.entries(splitClaim(source, pair)).map(([key, value]) => [key, String(value)])) });
  const totals = budgetTotals([claim("migration", "a", USDC(15)), claim("curve", "b", USDC(4.35654)), claim("curve", "b", USDC(4.35654)), claim("lp", "c", USDC(8))]);
  assert.equal(totals.earnedRaw, USDC(15) + 1_089_135n + USDC(2));
  assert.equal(totals.revenueRaw, 3_267_405n + USDC(6));
  assert.equal(totals.bySource.curve, 1_089_135n);
});

test("Micro's budget of ≈ 65 USDC deploys at most 70 %: nine steps of 5 USDC and more, 2.5 % apart from ≈ −4.8 % to ≈ −22 %", () => {
  const earned = USDC(65);
  const amount = budgetPlaceableRaw({ earnedRaw: earned, placedRaw: 0n, costsRaw: 10_000n, freeRaw: USDC(1000), topUp: false, dayTopUpsRaw: 0n });
  assert.equal(amount, USDC(45.5));
  assert.equal(budgetSteps(amount), 9);
  const ladder = floorLadder(0, { binStep: BUDGET_LADDER.binStep, topGapBins: BUDGET_LADDER.topGapBins, depthBins: budgetSteps(amount), raiseStepBins: BUDGET_LADDER.raiseStepBins });
  assert.deepEqual(ladder, { lowerBinId: -10, upperBinId: -2 });
  const top = priceOfBin(ladder.upperBinId, 250, 6, 6) / priceOfBin(0, 250, 6, 6) - 1;
  const deep = priceOfBin(ladder.lowerBinId, 250, 6, 6) / priceOfBin(0, 250, 6, 6) - 1;
  assert.ok(top > -0.05 && top < -0.047, `the first step at ${top}`);
  assert.ok(deep > -0.23 && deep < -0.21, `the deepest at ${deep}`);
  assert.equal(budgetReserveRaw({ earnedRaw: earned, placedRaw: amount, costsRaw: 10_000n }), USDC(19.49));
});

test("the demo market's ≈ 16 USDC pays for two steps; never deeper than Micro's ≈ −25 %, never fewer than 5 USDC a step", () => {
  assert.equal(budgetSteps(budgetPlaceableRaw({ earnedRaw: USDC(16.09), placedRaw: 0n, costsRaw: 0n, freeRaw: USDC(100), topUp: false, dayTopUpsRaw: 0n })), 2);
  assert.equal(budgetSteps(USDC(4.99)), 0);
  assert.equal(budgetSteps(USDC(1_300)), BUDGET_LADDER.maxStepsByDepth);
  const deepest = priceOfBin(-(BUDGET_LADDER.topGapBins + BUDGET_LADDER.maxStepsByDepth - 1), 250, 6, 6) / priceOfBin(0, 250, 6, 6) - 1;
  assert.ok(deepest > -0.26 && deepest < -0.25, `the deepest step at ${deepest}`);
  assert.equal(BUDGET_LADDER.maxStepsByDepth, 11);
  /* Below a step's worth nothing is placed at all. */
  assert.equal(budgetPlaceableRaw({ earnedRaw: USDC(7), placedRaw: 0n, costsRaw: 0n, freeRaw: USDC(100), topUp: false, dayTopUpsRaw: 0n }), 0n);
});

test("what may go in: within 70 % of what was earned, the reserve, the wallet's free money and the day's ceiling for a top-up", () => {
  const base = { earnedRaw: USDC(100), placedRaw: USDC(50), costsRaw: 0n, freeRaw: USDC(1000), topUp: true, dayTopUpsRaw: 0n };
  assert.equal(budgetPlaceableRaw(base), USDC(20), "70 less 50");
  assert.equal(budgetPlaceableRaw({ ...base, placedRaw: USDC(66) }), 0n, "4 USDC left is less than a step");
  assert.equal(budgetPlaceableRaw({ ...base, freeRaw: USDC(12) }), USDC(12), "never more than the wallet holds free");
  assert.equal(budgetPlaceableRaw({ ...base, dayTopUpsRaw: USDC(15) }), USDC(10), "a day's top-ups at most a quarter of what was earned");
  assert.equal(budgetPlaceableRaw({ ...base, dayTopUpsRaw: USDC(21) }), 0n);
  assert.equal(budgetPlaceableRaw({ ...base, topUp: false, dayTopUpsRaw: USDC(25) }), USDC(20), "the first placement is not a top-up");
  assert.equal(dayTopUpsRaw([{ at: 100, raw: "5000000" }, { at: 100 + 86_400, raw: "6000000" }], 100 + 86_400), USDC(6), "the day before, not older");
});

test("the risk limits: two nodes apart over 2 % or a gap in the reads — nothing done; a fall over 30 % in the hour, a creator's sale in the first week, SOL below 0.1 — no new money", () => {
  const now = 1_000_000;
  const seen = [{ at: now - 120, price: 1 }, { at: now - 60, price: 1 }];
  const base = { price: 1, second: 1.01, seen, now, launchedAt: now - 86_400, creatorSoldAt: null, lamports: 300_000_000n };
  assert.deepEqual(budgetRisk(base), { act: true, data: null, risks: [] });
  assert.equal(budgetRisk({ ...base, second: 1.03 }).data, "DIVERGED");
  assert.equal(budgetRisk({ ...base, second: null }).act, false, "a price that cannot be checked is not acted on");
  assert.equal(budgetRisk({ ...base, seen: [{ at: now - 400, price: 1 }] }).data, "STALE");
  assert.deepEqual(budgetRisk({ ...base, price: 0.69, second: 0.69, seen: [{ at: now - 3_000, price: 1 }, { at: now - 60, price: 0.7 }] }).risks, ["DROP"]);
  assert.deepEqual(budgetRisk({ ...base, price: 0.69, second: 0.69, seen: [{ at: now - 3_700, price: 1 }, { at: now - 60, price: 0.7 }] }).risks, [], "a fall from more than an hour ago is not this hour's");
  assert.deepEqual(budgetRisk({ ...base, creatorSoldAt: now - 3_600 }).risks, ["CREATOR_SOLD"]);
  assert.deepEqual(budgetRisk({ ...base, creatorSoldAt: base.launchedAt + 8 * 86_400 }).risks, [], "after the first week a sale is no stop");
  assert.deepEqual(budgetRisk({ ...base, lamports: 99_999_999n }).risks, ["LOW_SOL"]);
  assert.equal(BUDGET_RULE.executorMinLamports, 100_000_000n);
  const kept = addPriceSeen([{ at: now - 4_000, price: 2 }, ...seen], now, 1.2);
  assert.deepEqual(kept.map((row) => row.at), [now - 120, now - 60, now], "an hour of reads kept");
});

test("exhausted: placed, the steps empty of the pair currency, the reserve below a step", () => {
  assert.equal(budgetExhausted({ placedRaw: USDC(45), stepsPairRaw: 0n, reserveRaw: USDC(4) }), true);
  assert.equal(budgetExhausted({ placedRaw: USDC(45), stepsPairRaw: USDC(1), reserveRaw: USDC(4) }), false);
  assert.equal(budgetExhausted({ placedRaw: USDC(45), stepsPairRaw: 0n, reserveRaw: USDC(5) }), false, "a step's worth left refills them");
  assert.equal(budgetExhausted({ placedRaw: 0n, stepsPairRaw: 0n, reserveRaw: 0n }), false, "never placed is not exhausted");
  assert.equal(budgetExhausted({ placedRaw: USDC(45), stepsPairRaw: null, reserveRaw: 0n }), false, "steps not read are not said empty");
});

test("Ryntra's revenue on the wallet: what was left plus new claims, less what the operator swept — never the operator's own money or the budgets; told above 100 USDC, again per 100 more", () => {
  const left = (prevLeft, prevClaimed, claimed, wallet, reserves) => revenueLeftRaw({ prevLeftRaw: USDC(prevLeft), prevClaimedRaw: USDC(prevClaimed), claimedRaw: USDC(claimed), walletPairRaw: USDC(wallet), reservesRaw: USDC(reserves), owedRaw: 0n });
  assert.equal(left(0, 0, 150, 230, 80), USDC(150));
  assert.equal(left(150, 150, 150, 80, 80), 0n, "swept: the budgets stay");
  assert.equal(left(0, 150, 150, 580, 80), 0n, "the operator's 500 USDC for a Classic ladder after a sweep is not revenue");
  assert.equal(left(0, 150, 170, 600, 80), USDC(20), "only the new claims' revenue counts");
  assert.equal(left(150, 150, 150, 200, 80), USDC(120), "a partial sweep");
  assert.equal(revenueAlertDue({ onWalletRaw: USDC(100), lastAlertRaw: null }), false, "above 100, not at it");
  assert.equal(revenueAlertDue({ onWalletRaw: USDC(100.01), lastAlertRaw: null }), true);
  assert.equal(revenueAlertDue({ onWalletRaw: USDC(180), lastAlertRaw: USDC(101) }), false);
  assert.equal(revenueAlertDue({ onWalletRaw: USDC(201), lastAlertRaw: USDC(101) }), true);
});

test("what waits in Meteora's pools, by its formulas: the migration fee rounded as the program keeps the pool's amount, the surplus's partner share", () => {
  assert.equal(partnerMigrationFeeRaw({ thresholdRaw: USDC(750), feePct: 8, creatorPct: 0 }), USDC(60));
  assert.equal(partnerMigrationFeeRaw({ thresholdRaw: USDC(50), feePct: 30, creatorPct: 0 }), USDC(15));
  assert.equal(partnerSurplusRaw({ reserveRaw: USDC(760), thresholdRaw: USDC(750), creatorPct: 40 }), USDC(4.8), "80 % of 10 to both, the creator's 40 % of that out");
  assert.equal(partnerSurplusRaw({ reserveRaw: USDC(750), thresholdRaw: USDC(750), creatorPct: 40 }), 0n);
  assert.deepEqual(inPoolBudget({ curveRaw: USDC(4), migrationRaw: USDC(15), surplusRaw: 0n, lpRaw: null }), { budgetRaw: USDC(16), bySource: { migration: USDC(15), surplus: 0n, curve: USDC(1), lp: 0n } });
});

test("a budget's ladder moves up after the price held about 10 % above it, keeping its depth", () => {
  const shape = { binStep: 250, topGapBins: 2, depthBins: 19, raiseStepBins: 4 };
  const ladder = { lowerBinId: -10, upperBinId: -2 };
  const seen = { at: 0, marketBinId: 4 };
  const decision = floorRaise({ ladder, marketBinId: 4, holdsToken: false, seen, at: 400, shape });
  assert.deepEqual(decision, { raise: true, ladder: { lowerBinId: -6, upperBinId: 2 } }, "nine steps still");
  assert.equal(floorRaise({ ladder, marketBinId: 3, holdsToken: false, seen: { at: 0, marketBinId: 3 }, at: 400, shape }).raise, false, "three steps up is not yet ten per cent");
  /* The Classic rule is unchanged: one per cent steps, forty-five of them, raised after ten. */
  assert.deepEqual(floorLadder(100), floorLadder(100, CLASSIC_SHAPE));
  assert.equal(binOfPrice(priceOfBin(-7, 250, 6, 6), 250, 6, 6), -7);
});

test("each ladder takes only its own: a budget market its reserve, the operator's ladder none of the budgets or the revenue", () => {
  const wallet = { walletPairRaw: USDC(300), reservesRaw: USDC(60), owedRaw: USDC(10), revenueLeftRaw: USDC(120) };
  assert.equal(walletFreeRaw({ ...wallet, ownReserveRaw: USDC(20) }), USDC(130), "300 − (60 − 20) − 10 − 120");
  assert.equal(walletFreeRaw({ ...wallet, ownReserveRaw: 0n }), USDC(110), "the operator's: 300 − 60 − 10 − 120");
  assert.equal(walletFreeRaw({ ...wallet, walletPairRaw: USDC(100), ownReserveRaw: 0n }), 0n);
  assert.equal(budgetRisk({ price: 1, second: null, seen: [], now: 10, launchedAt: 0, creatorSoldAt: null, lamports: 300_000_000n }).data, "NO_SECOND_NODE");
});

test("a creator watched from the launch: the first read within fifteen minutes of it (SOL-L6)", async () => {
  const { creatorWatchProven, CREATOR_WATCH_GRACE_SECONDS } = await import("./budget.ts");
  assert.equal(creatorWatchProven({ watchFrom: 1_000 + CREATOR_WATCH_GRACE_SECONDS, launchedAt: 1_000 }), true);
  assert.equal(creatorWatchProven({ watchFrom: 1_001 + CREATOR_WATCH_GRACE_SECONDS, launchedAt: 1_000 }), false);
  assert.equal(creatorWatchProven({ watchFrom: null, launchedAt: 1_000 }), false, "never watched");
  assert.equal(creatorWatchProven({ watchFrom: undefined, launchedAt: 1_000 }), false, "a record from before the watch's start was kept");
});
