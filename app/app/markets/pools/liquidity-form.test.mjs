import assert from "node:assert/strict";
import test from "node:test";

import { dlmmBins, fromBaseUnits, priceAtOffset, sidesOf, toBaseUnits, typedFromUnits, typedOf } from "./liquidity-form.ts";

test("a typed amount becomes base units exactly, never through a float", () => {
  assert.equal(toBaseUnits("1.5", 9), "1500000000");
  assert.equal(toBaseUnits("0,000001", 6), "1");
  assert.equal(toBaseUnits("123456789.123456789", 9), "123456789123456789");
  assert.equal(toBaseUnits(".5", 6), "500000");
  assert.equal(toBaseUnits("1.0000001", 6), null, "more decimals than the token has");
  assert.equal(toBaseUnits("1e3", 6), null);
  assert.equal(toBaseUnits("", 6), null);
  assert.equal(toBaseUnits("-1", 6), null);
  assert.equal(fromBaseUnits("1500000000", 9), 1.5);
});

test("a number goes back into a field cut to the token's decimals, never rounded up", () => {
  assert.equal(typedOf(1.23456789, 6), "1.234567");
  assert.equal(typedOf(2, 9), "2");
  assert.equal(typedOf(0, 9), "");
  assert.equal(typedOf(Number.NaN, 9), "");
  assert.equal(typedOf(100, 0), "100", "a whole token keeps its zeros");
});

test("«Max» goes into the field from base units exactly", () => {
  assert.equal(typedFromUnits("123456789123456789", 9), "123456789.123456789");
  assert.equal(typedFromUnits("1500000000", 9), "1.5");
  assert.equal(typedFromUnits("5", 6), "0.000005");
  assert.equal(typedFromUnits("100", 0), "100");
  assert.equal(typedFromUnits("0", 6), "");
  assert.equal(toBaseUnits(typedFromUnits("9007199254740993123", 9), 9), "9007199254740993123", "past 2^53 without a float");
});

test("DLMM ranges from the active bin: around holds both tokens; above only the base, below only the quote", () => {
  assert.deepEqual(dlmmBins(100, "narrow", "around"), { lower: 95, upper: 105 });
  assert.deepEqual(dlmmBins(100, "wide", "around"), { lower: 66, upper: 134 });
  const above = dlmmBins(100, "medium", "above");
  assert.deepEqual(above, { lower: 101, upper: 131 });
  const below = dlmmBins(100, "medium", "below");
  assert.deepEqual(below, { lower: 69, upper: 99 });
  for (const width of ["narrow", "medium", "wide"]) for (const place of ["around", "above", "below"]) {
    const { lower, upper } = dlmmBins(-4000, width, place);
    assert.ok(upper - lower + 1 <= 70, "one position holds at most 70 bins");
  }
  assert.deepEqual(sidesOf("above"), { x: true, y: false });
  assert.deepEqual(sidesOf("below"), { x: false, y: true });
  assert.ok(Math.abs(priceAtOffset(100, 4, 10) - 100 * 1.0004 ** 10) < 1e-9);
});

test("a rebalance opens the add form at the preset nearest the old position's width (SOL-2b)", async () => {
  const { widthNear } = await import("./liquidity-form.ts");
  const { halfBinsOfSpan } = await import("../../../../lib/liquidity/catalog/track.ts");
  assert.equal(widthNear(halfBinsOfSpan(1.0025 ** 30, 25)), "medium");
  assert.equal(widthNear(halfBinsOfSpan(1.0025 ** 10, 25)), "narrow");
  assert.equal(widthNear(halfBinsOfSpan(1.0025 ** 68, 25)), "wide");
  assert.equal(widthNear(0), "narrow");
  assert.equal(widthNear(200), "wide");
});
