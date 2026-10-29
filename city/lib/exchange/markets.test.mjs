import { test } from "node:test";
import assert from "node:assert/strict";

import { clampLeverage, leverageSteps, marketFacts, marketForTower, marketMatchesText, marketRows, tradable, unitsOf } from "./markets.ts";
import { BTC, GOLD, MARKETS, PUMP, SOL } from "./test-fixtures.mjs";

const tower = (symbol, verified = true) => ({ symbol, verified });

test("a tower gets «Trade futures» only when Phoenix lists its very symbol, and only for a coin Jupiter verified", () => {
  assert.equal(marketForTower(tower("SOL"), MARKETS.markets), SOL);
  assert.equal(marketForTower(tower("$sol"), MARKETS.markets), SOL);
  assert.equal(marketForTower(tower("Pump"), MARKETS.markets), PUMP);
  // An unverified pool that borrows a ticker never gets a perpetual's button.
  assert.equal(marketForTower(tower("SOL", false), MARKETS.markets), null);
  // No such market, or a ticker that only contains one.
  assert.equal(marketForTower(tower("BONK"), MARKETS.markets), null);
  assert.equal(marketForTower(tower("SOLX"), MARKETS.markets), null);
  assert.equal(marketForTower(tower(""), MARKETS.markets), null);
  assert.equal(marketForTower(tower("SOL"), []), null);
});

test("the picker lists what trades now first, then the day's volume, and finds a market by its name", () => {
  assert.deepEqual(marketRows(MARKETS.markets).map((market) => market.symbol), ["BTC", "SOL", "PUMP", "GOLD"]);
  assert.equal(tradable(GOLD), false);
  assert.equal(tradable(SOL), true);
  assert.equal(tradable({ status: "active", state: "paused" }), false);
  assert.equal(marketMatchesText(BTC, "bitc"), true);
  assert.equal(marketMatchesText(BTC, "sol"), false);
  assert.equal(marketMatchesText(BTC, ""), true);
});

test("the market strip is the engine's: the day's move, and who pays the funding only where the mark agrees", () => {
  const facts = marketFacts(SOL, { symbol: "SOL", ratePercent: 0.0012, at: 1, periodSeconds: 3600, observedAt: 2 });
  assert.equal(facts.mark, 150);
  assert.equal(facts.index, 149.9);
  assert.ok(Math.abs(facts.changePercent - 2.5010) < 0.001);
  assert.deepEqual(facts.funding, { ratePercent: 0.0012, payer: "long", periodSeconds: 3600 });
  // A positive rate while the mark stands under the index: the side is not said.
  assert.equal(marketFacts({ ...SOL, markPrice: 149 }, { symbol: "SOL", ratePercent: 0.0012, at: 1, periodSeconds: 3600, observedAt: 2 }).funding.payer, null);
  // Another market's funding is not this one's; none read is none shown.
  assert.equal(marketFacts(BTC, { symbol: "SOL", ratePercent: 0.0012, at: 1, periodSeconds: 3600, observedAt: 2 }).funding, null);
  assert.equal(marketFacts({ ...SOL, prevDayMarkPrice: null }, null).changePercent, null);
});

test("leverage: the usual steps up to the market's highest, a careful two to start, never past the top", () => {
  assert.deepEqual(leverageSteps(20), [1, 2, 3, 5, 10, 20]);
  assert.deepEqual(leverageSteps(25), [1, 2, 3, 5, 10, 20, 25]);
  assert.deepEqual(leverageSteps(null), [1]);
  assert.equal(clampLeverage(50, 20), 20);
  assert.equal(clampLeverage(0, 20), 1);
  assert.equal(clampLeverage(Number.NaN, 20), 2);
  assert.equal(clampLeverage(3, null), 1);
});

test("a market's units: whole and sane, or none", () => {
  assert.deepEqual(unitsOf(SOL), { tickSize: 10, baseLotsDecimals: 3 });
  assert.deepEqual(unitsOf(PUMP), { tickSize: 2, baseLotsDecimals: -2 });
  assert.equal(unitsOf({ tickSize: null, baseLotsDecimals: 3 }), null);
  assert.equal(unitsOf({ tickSize: 1.5, baseLotsDecimals: 3 }), null);
  assert.equal(unitsOf({ tickSize: 10, baseLotsDecimals: 40 }), null);
  assert.equal(unitsOf(null), null);
});
