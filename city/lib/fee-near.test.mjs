// Run from repo root: node --test city/lib/fee-near.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { feeNear, pairLamports, usdLamports } from "./fee-near.ts";

// CITY-243: «Claim» warns in one line when the network's fee comes close to the sum; the sum and the claim stay as built.

test("a fee far under the sum says nothing; from half of it, close; from all of it, over", () => {
  assert.equal(feeNear(1_000_000, 10_000), null);
  assert.equal(feeNear(1_000_000, 499_999), null);
  assert.equal(feeNear(1_000_000, 500_000), "near");
  assert.equal(feeNear(1_000_000, 999_999), "near");
  assert.equal(feeNear(1_000_000, 1_000_000), "over");
  assert.equal(feeNear(20_000n, "105000"), "over");
});

test("a sum or a fee not known — or nothing to claim — never guesses", () => {
  assert.equal(feeNear(null, 5_000), null);
  assert.equal(feeNear(1_000, null), null);
  assert.equal(feeNear(0, 5_000), null);
  assert.equal(feeNear(1_000, 0), null);
  assert.equal(feeNear("not a number", 5_000), null);
});

test("a pair's raw sum in lamports: SOL as it is, dollars at SOL's price, anything else unknown", () => {
  assert.equal(pairLamports("2500000", { symbol: "SOL", decimals: 9, dollar: false }, null), 2_500_000);
  // $0.02 of USDC at $200 a SOL: 0.0001 SOL.
  assert.equal(Math.round(pairLamports("20000", { symbol: "USDC", decimals: 6, dollar: true }, 200)), 100_000);
  assert.equal(pairLamports("20000", { symbol: "USDC", decimals: 6, dollar: true }, null), null);
  assert.equal(pairLamports("20000", { symbol: "JUP", decimals: 6, dollar: false }, 200), null);
  assert.equal(Math.round(usdLamports(0.02, 200)), 100_000);
  assert.equal(usdLamports(null, 200), null);
});

test("a claim of two cents in USDC with a network fee of 0.000105 SOL at $200: over", () => {
  const sum = pairLamports("20000", { symbol: "USDC", decimals: 6, dollar: true }, 200);
  assert.equal(feeNear(sum, 105_000), "over");
  assert.equal(feeNear(sum, 60_000), "near");
  assert.equal(feeNear(sum, 5_000), null);
});
