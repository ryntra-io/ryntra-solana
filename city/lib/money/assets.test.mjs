import { test } from "node:test";
import assert from "node:assert/strict";

import { assetsOf, formatAmount, formatUsd, portfolioOf, readAge, sendable, valueOf } from "./assets.ts";
import { USDC } from "./test-fixtures.mjs";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ODD = "Odd1111111111111111111111111111111111111111";

const rows = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "2400000000", spendableRaw: "2390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "150" } },
  { kind: "TOKEN", mint: USDC, amountRaw: "12500000", spendableRaw: "12500000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
  { kind: "TOKEN", mint: BONK, amountRaw: "1000000000", spendableRaw: "1000000000", decimals: 5, catalog: { symbol: "Bonk", isVerified: true, usdPrice: "0.00002" } },
  { kind: "TOKEN", mint: ODD, amountRaw: "5", spendableRaw: "5", decimals: 0, catalog: { isSuspicious: true } },
  // Not whole: left out, never guessed.
  { kind: "TOKEN", mint: "Bad1", amountRaw: "x", spendableRaw: "x", decimals: 6 },
  { kind: "TOKEN", mint: "Empty", amountRaw: "0", spendableRaw: "0", decimals: 6 },
];

test("the engine's holdings rows become coins with the engine's names and prices", () => {
  const assets = assetsOf(rows);
  assert.deepEqual(assets.map((a) => a.id), ["native:sol", USDC, BONK, ODD]);
  assert.deepEqual([assets[0].symbol, assets[0].verified, assets[0].usdPrice], ["SOL", true, 150]);
  assert.deepEqual([assets[1].name, assets[1].spendableRaw], ["USD Coin", "12500000"]);
  assert.equal(assets[3].symbol, "Odd1…1111");
  assert.deepEqual([assets[3].usdPrice, assets[3].suspicious, assets[3].verified], [null, true, false]);
});

test("the portfolio: SOL first, then by value; a coin without a price stays out of the total and is counted", () => {
  const portfolio = portfolioOf(assetsOf(rows));
  assert.deepEqual(portfolio.rows.map((r) => r.asset.symbol), ["SOL", "USDC", "Bonk", "Odd1…1111"]);
  assert.equal(portfolio.rows[0].valueUsd, 360);
  assert.ok(Math.abs(portfolio.totalUsd - (360 + 12.5 + 0.2)) < 1e-9);
  assert.equal(portfolio.unpriced, 1);
  assert.equal(portfolio.rows[2].amount, "10,000");
  assert.deepEqual(portfolioOf([]), { rows: [], totalUsd: null, unpriced: 0 });
});

test("what can be sent: a spendable balance, SOL first, a suspicious coin last", () => {
  assert.deepEqual(sendable(assetsOf(rows)).map((a) => a.symbol), ["SOL", "USDC", "Bonk", "Odd1…1111"]);
  assert.equal(valueOf({ amountRaw: "1", decimals: 0, usdPrice: null }), null);
});

test("dollars, amounts and ages as the window writes them", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.004), "<$0.01");
  assert.equal(formatUsd(12.4), "$12.40");
  assert.equal(formatUsd(12_345.6), "$12,346");
  assert.equal(formatUsd(2_500_000), "$2.5M");
  assert.equal(formatAmount("2390000000", 9), "2.39");
  assert.equal(formatAmount("1234567891", 6), "1,234.5678");
  assert.equal(formatAmount("1", 9), "<0.000001");
  assert.equal(formatAmount("12500000", 6), "12.5");
  assert.equal(readAge(0, 5_000), "just now");
  assert.equal(readAge(0, 40_000), "40s ago");
  assert.equal(readAge(0, 180_000), "3 min ago");
});
