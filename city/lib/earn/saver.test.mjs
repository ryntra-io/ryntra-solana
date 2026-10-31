import { test } from "node:test";
import assert from "node:assert/strict";

import { costOf, entryCostPct, exitSpreadPct, lamportsFromText, yearAtRate } from "./saver.ts";

const rate = { lamports: "1100000000", supply: "1000000000" }; // 1 LST = 1.1 SOL

test("the way in and the way back are measured against the LST's worth in SOL", () => {
  // 1 SOL in, 0.9 LST out = 0.99 SOL of worth: 1 % lost on the way in.
  assert.ok(Math.abs(entryCostPct(1_000_000_000n, 900_000_000n, rate) - 1) < 1e-9);
  // 0.9 LST back gives 0.985 SOL against 0.99 of worth: about 0.505 % spread.
  assert.ok(Math.abs(exitSpreadPct(900_000_000n, 985_000_000n, rate) - 0.50505) < 1e-4);
  assert.equal(entryCostPct(1n, 1n, null), null);
  assert.equal(exitSpreadPct(0n, 1n, rate), null);
});

test("the network's cost adds the signature and priority fees, and on an order the account deposit", () => {
  const priced = { signatureFeeLamports: "5000", priorityFeeLamports: "10000", rentFeeLamports: "2039280" };
  assert.equal(costOf(priced, "quote"), 15_000n);
  assert.equal(costOf(priced, "order"), 2_054_280n);
  assert.equal(costOf({ signatureFeeLamports: "x", priorityFeeLamports: "" }, "order"), null);
});

test("SOL typed as people type it", () => {
  assert.equal(lamportsFromText("1.5"), 1_500_000_000n);
  assert.equal(lamportsFromText("0,25"), 250_000_000n);
  assert.equal(lamportsFromText("0"), null);
  assert.equal(lamportsFromText("abc"), null);
});

test("a year at the last epoch's rate, only when the rate was read", () => {
  assert.equal(yearAtRate(1_000_000_000n, 6.2), 62_000_000n);
  assert.equal(yearAtRate(1_000_000_000n, null), null);
  assert.equal(yearAtRate(null, 6), null);
});
