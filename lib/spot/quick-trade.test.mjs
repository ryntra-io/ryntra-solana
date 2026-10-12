import assert from "node:assert/strict";
import test from "node:test";

import {
  QUICK_BUY_DEFAULT_USD,
  QUICK_BUY_STORAGE_KEY,
  quickBuyAmount,
  quickShareRaw,
  quickSum,
  quickSumLabel,
  readQuickSums,
  writeQuickSums,
} from "./quick-trade.ts";

test("the default quick sums are the plan's four, from small to large", () => {
  assert.deepEqual([...QUICK_BUY_DEFAULT_USD], [10, 50, 100, 500]);
  assert.equal(QUICK_BUY_STORAGE_KEY, "ryntra.quick-buy.v1");
});

test("a quick sum is whole cents from $1 to the purchase's ceiling", () => {
  assert.equal(quickSum("1"), 1);
  assert.equal(quickSum("1,5", "uk"), 1.5);
  assert.equal(quickSum("1,5"), null, "in English a comma groups thousands");
  assert.equal(quickSum("1,000"), 1000);
  assert.equal(quickSum("1,000.50"), 1000.5);
  assert.equal(quickSum("1 000,50", "uk"), 1000.5);
  assert.equal(quickSum("$25.75"), 25.75);
  assert.equal(quickSum("1 250"), 1250);
  assert.equal(quickSum(0.99), null, "under the minimum purchase");
  assert.equal(quickSum("0"), null);
  assert.equal(quickSum("2000000"), null, "over the ceiling");
  assert.equal(quickSum("1.234"), null, "a third decimal is not a typed sum");
  assert.equal(quickSum("abc"), null);
  assert.equal(quickSum(""), null);
  assert.equal(quickSum(Number.NaN), null);
});

test("stored sums are read back sorted; anything else is the defaults", () => {
  assert.deepEqual([...readQuickSums(writeQuickSums([100, 1, 20, 5]))], [1, 5, 20, 100]);
  assert.deepEqual([...readQuickSums(null)], [10, 50, 100, 500]);
  assert.deepEqual([...readQuickSums("{")], [10, 50, 100, 500]);
  assert.deepEqual([...readQuickSums(JSON.stringify({ sums: [1, 2, 3] }))], [10, 50, 100, 500], "three sums are not four");
  assert.deepEqual([...readQuickSums(JSON.stringify({ sums: [1, 2, 3, 0.5] }))], [10, 50, 100, 500], "a sum under $1 drops the set");
  assert.deepEqual([...readQuickSums(JSON.stringify([10, 50, 100, 500]))], [10, 50, 100, 500]);
});

test("a quick sum in a dollar stablecoin is typed as it is", () => {
  const usdc = { symbol: "USDC", decimals: 6, dollar: true };
  assert.equal(quickBuyAmount(10, usdc, null), "10");
  assert.equal(quickBuyAmount(1.5, usdc, null), "1.5");
  assert.equal(quickBuyAmount(0, usdc, null), null);
});

test("a quick sum in SOL is the sum at the wallet's SOL price, rounded down, never without a price", () => {
  const sol = { symbol: "SOL", decimals: 9, dollar: false };
  assert.equal(quickBuyAmount(10, sol, 149), "0.067114");
  assert.equal(quickBuyAmount(100, sol, 200), "0.5");
  assert.equal(quickBuyAmount(10, sol, null), null);
  assert.equal(quickBuyAmount(10, sol, 0), null);
  /* Never more than the person chose. */
  const amount = Number(quickBuyAmount(10, sol, 149));
  assert.ok(amount * 149 <= 10);
});

test("chip labels read in the page's language", () => {
  assert.equal(quickSumLabel(10, "en"), "$10");
  assert.equal(quickSumLabel(1.5, "en"), "$1.50");
  assert.equal(quickSumLabel(1000, "en"), "$1,000");
  assert.equal(quickSumLabel(10_050, "en"), "$10,050", "short only where short is exact");
  assert.equal(quickSumLabel(12_500, "en"), "$12.5K");
  assert.equal(quickSumLabel(1.5, "uk"), "$1,50");
  assert.equal(quickSumLabel(25_000, "en"), "$25K");
  assert.match(quickSumLabel(25_000, "uk"), /^\$25\s?тис\.$/);
  assert.equal(quickSumLabel(25_000, "en", true), "$25,000");
});

test("a quick share of a position rounds down and 100 % is all of it", () => {
  assert.equal(quickShareRaw(1001n, 25), 250n);
  assert.equal(quickShareRaw(1001n, 50), 500n);
  assert.equal(quickShareRaw(1001n, 100), 1001n);
  assert.equal(quickShareRaw(0n, 50), 0n);
  assert.equal(quickShareRaw(100n, 0), 0n);
});
