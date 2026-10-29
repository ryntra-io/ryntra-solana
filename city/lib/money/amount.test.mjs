import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanAmount, readAmount, shareOf } from "./amount.ts";

const USDC = { spendableRaw: "12500000", decimals: 6, symbol: "USDC" };
const SOL = { spendableRaw: "1000000000", decimals: 9, symbol: "SOL" };

test("a keyboard's amount becomes a plain decimal", () => {
  assert.equal(cleanAmount("1,5"), "1.5");
  assert.equal(cleanAmount(" 1 000.25 "), "1000.25");
  assert.equal(cleanAmount("1.2.3"), "1.23");
  assert.equal(cleanAmount("$12a"), "12");
});

test("an amount is the coin's own units, raw, within what can be spent", () => {
  assert.deepEqual(readAmount("2.5", USDC), { ok: true, raw: "2500000" });
  assert.deepEqual(readAmount(".5", USDC), { ok: true, raw: "500000" });
  assert.deepEqual(readAmount("3.", USDC), { ok: true, raw: "3000000" });
  assert.deepEqual(readAmount("12.5", USDC), { ok: true, raw: "12500000" });
  assert.deepEqual(readAmount("0.000000001", SOL), { ok: true, raw: "1" });
});

test("every amount that is not one says why", () => {
  assert.equal(readAmount("", USDC).problem, "EMPTY");
  assert.equal(readAmount("1", null).problem, "NO_BALANCE");
  assert.equal(readAmount("0", USDC).problem, "ZERO");
  assert.equal(readAmount("0.000", USDC).problem, "ZERO");
  const precise = readAmount("1.0000001", USDC);
  assert.equal(precise.problem, "TOO_PRECISE");
  assert.match(precise.text, /6 decimal places/);
  const over = readAmount("12.500001", USDC);
  assert.equal(over.problem, "OVER_BALANCE");
  assert.equal(over.text, "More than you can send: 12.5 USDC.");
});

test("a share of what can be spent is written back exactly, never rounded up", () => {
  assert.equal(shareOf("12500000", 6, 1n, 1n), "12.5");
  assert.equal(shareOf("12500000", 6, 1n, 2n), "6.25");
  assert.equal(shareOf("3", 6, 1n, 4n), "");
  assert.equal(shareOf("7", 0, 1n, 2n), "3");
  assert.equal(shareOf("x", 6, 1n, 2n), "");
});
