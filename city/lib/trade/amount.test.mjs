import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanAmountInput, typedAmount } from "./amount.ts";
import { SOL, USDC } from "./tiles.ts";

test("the field keeps digits, one point and its commas as typed", () => {
  assert.equal(cleanAmountInput("12,5"), "12,5");
  assert.equal(cleanAmountInput("1,000"), "1,000");
  assert.equal(cleanAmountInput(" 1a.2.3 "), "1.23");
  assert.equal(cleanAmountInput("$40"), "40");
  assert.equal(cleanAmountInput("9".repeat(40)).length, 24);
});

test("a typed amount becomes an exact raw amount", () => {
  assert.equal(typedAmount("", SOL, null), null);
  assert.equal(typedAmount(".", SOL, null), null);
  assert.deepEqual(typedAmount("2.5", SOL, null), { ok: true, amountRaw: "2500000000" });
  assert.equal(typedAmount("37", USDC, null).amountRaw, "37000000");
  // Half-typed: «5.» and «.5» are read as the person means them.
  assert.equal(typedAmount("5.", USDC, null).amountRaw, "5000000");
  assert.equal(typedAmount(".5", USDC, null).amountRaw, "500000");
});

test("what is wrong with a typed amount, in plain words", () => {
  assert.deepEqual(typedAmount("0", SOL, null), { ok: false, problem: { kind: "zero", text: "Type an amount above zero." } });
  assert.deepEqual(typedAmount("0.000", USDC, null).problem.kind, "zero");
  assert.deepEqual(typedAmount("1.1234567", USDC, null), { ok: false, problem: { kind: "decimals", text: "USDC has at most 6 digits after the point." } });
  assert.equal(typedAmount("1.5", { symbol: "$BONK", decimals: 0 }, null).problem.text, "$BONK comes in whole numbers only.");
});

test("never more than the wallet holds", () => {
  const balance = { spendableRaw: "2400000000", decimals: 9 };
  assert.equal(typedAmount("2.4", SOL, balance).ok, true);
  assert.deepEqual(typedAmount("2.5", SOL, balance), { ok: false, problem: { kind: "balance", text: "You have 2.4 SOL. Type that or less." } });
  assert.equal(typedAmount("1", USDC, { spendableRaw: "0", decimals: 6 }).problem.kind, "balance");
  // SOL: the balance given is what may be spent once the network is paid, and the sentence says so.
  assert.deepEqual(typedAmount("2.4", SOL, { spendableRaw: "2395616440", decimals: 9 }, true), { ok: false, problem: { kind: "balance", text: "Up to 2.395 SOL: the rest pays the network." } });
});

test("one comma and no point is the decimal comma; any other comma is refused, never guessed", () => {
  assert.equal(typedAmount("12,5", SOL, null).amountRaw, "12500000000");
  assert.equal(typedAmount("0,125", SOL, null).amountRaw, "125000000");
  assert.equal(typedAmount(",5", USDC, null).amountRaw, "500000");
  assert.equal(typedAmount("1,", USDC, null).amountRaw, "1000000");
  assert.equal(typedAmount("1,00", USDC, null).amountRaw, "1000000");
  assert.equal(typedAmount(",", USDC, null), null);
  const refused = { ok: false, problem: { kind: "format", text: "Type the amount with a point and no commas, like 1000 or 2.5." } };
  // «1,000»: a thousand, or one? Never read as 1.
  assert.deepEqual(typedAmount("1,000", USDC, null), refused);
  assert.deepEqual(typedAmount("25,000", SOL, null), refused);
  assert.deepEqual(typedAmount("1,000,000", USDC, null), refused);
  assert.deepEqual(typedAmount("1,000.5", USDC, null), refused);
  assert.deepEqual(typedAmount("1.5,", USDC, null), refused);
  assert.deepEqual(typedAmount("1,,5", USDC, null), refused);
});
