// Run from repo root: node --test lib/plans/decimal-input.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { decimalReadingDiffers, parseDecimalInput } from "./decimal-input.ts";

/**
 * The regression the UX audit of 2026-09-16 reproduced on the plan builder:
 * `0,5` → 5 and `10,50` → 1050 through a parser that dropped the comma, and an
 * empty field that became zero. A money field reads the comma as the person
 * meant it and refuses what it cannot read without guessing.
 */
test("a comma is a decimal separator, never dropped", () => {
  assert.equal(parseDecimalInput("0,5"), 0.5);
  assert.equal(parseDecimalInput("10,50"), 10.5);
  assert.equal(parseDecimalInput("682,29"), 682.29);
  assert.equal(parseDecimalInput("1,234"), 1.234);
});

test("a point is a decimal separator too, and a trailing or leading one is fine while typing", () => {
  assert.equal(parseDecimalInput("0.5"), 0.5);
  assert.equal(parseDecimalInput("12."), 12);
  assert.equal(parseDecimalInput(".5"), 0.5);
  assert.equal(parseDecimalInput("1000"), 1000);
});

test("an empty or blank field is null, not zero", () => {
  assert.equal(parseDecimalInput(""), null);
  assert.equal(parseDecimalInput("   "), null);
});

test("grouping characters are dropped, in either convention", () => {
  assert.equal(parseDecimalInput("1 000,50"), 1000.5);
  assert.equal(parseDecimalInput("1 000"), 1000);
  assert.equal(parseDecimalInput("1'000.25"), 1000.25);
  assert.equal(parseDecimalInput("1,234.56"), 1234.56);
  assert.equal(parseDecimalInput("1.234,56"), 1234.56);
  assert.equal(parseDecimalInput("1,000,000"), 1_000_000);
  assert.equal(parseDecimalInput("1.000.000,5"), 1_000_000.5);
  assert.equal(parseDecimalInput("$10.50"), 10.5);
  assert.equal(parseDecimalInput("1,5%"), 1.5);
});

test("what cannot be read without guessing is refused, never turned into another number", () => {
  assert.equal(parseDecimalInput("1,2,3"), null);
  assert.equal(parseDecimalInput("1,23.45"), null);
  assert.equal(parseDecimalInput("1.2.3,4"), null);
  assert.equal(parseDecimalInput("12,34,5"), null);
  assert.equal(parseDecimalInput("abc"), null);
  assert.equal(parseDecimalInput("10 USD"), null);
  assert.equal(parseDecimalInput("-5"), null);
  assert.equal(parseDecimalInput("1e3"), null);
});

test("the reading is shown only when a person could read the text differently", () => {
  assert.equal(decimalReadingDiffers("10,50"), true);
  assert.equal(decimalReadingDiffers("1 000"), true);
  assert.equal(decimalReadingDiffers("1,234.56"), true);
  assert.equal(decimalReadingDiffers("10.50"), false);
  assert.equal(decimalReadingDiffers("1000"), false);
  assert.equal(decimalReadingDiffers(""), false);
  assert.equal(decimalReadingDiffers("abc"), false);
});
