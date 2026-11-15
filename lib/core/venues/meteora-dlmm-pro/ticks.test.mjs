// Prices and ticks of the DLMM Pro venue, held to the SDK's own tick arithmetic.
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TICK_ID as SDK_MAX_TICK, MIN_TICK_ID as SDK_MIN_TICK, LIMIT_ORDER_MAX_TICK, MAX_TICKS_PER_ARRAY, MAX_TICK_SPACING as SDK_MAX_SPACING, POSITION_MAX_RANGE, getSqrtPriceFromTickId, isUsableTickId, tickIdFromSqrtPrice, tickIndexFromId } from "@meteora-ag/dlmm-pro-sdk";
import BN from "bn.js";

const { MAX_ORDER_TICKS, MAX_POSITION_RANGES, MAX_TICK_ID, MAX_TICK_SPACING, MIN_TICK_ID, TICKS_PER_ARRAY, alignTickDown, isUsableTick, isqrt, newTicksPerInstruction, priceOfSqrtX64, splitRangesForGrowth, sqrtPriceX64OfPrice, tickArrayIndexOf } = await import("./ticks.ts");

test("the venue's limits are the program's, as the SDK reads them from the IDL", () => {
  assert.equal(MIN_TICK_ID, SDK_MIN_TICK);
  assert.equal(MAX_TICK_ID, SDK_MAX_TICK);
  assert.equal(MAX_TICK_SPACING, SDK_MAX_SPACING);
  assert.equal(MAX_POSITION_RANGES, POSITION_MAX_RANGE);
  assert.equal(MAX_ORDER_TICKS, LIMIT_ORDER_MAX_TICK);
  assert.equal(TICKS_PER_ARRAY, MAX_TICKS_PER_ARRAY);
});

test("the integer square root is exact, rounded down", () => {
  for (const value of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, (1n << 128n) - 1n, 1n << 128n, 10n ** 40n + 7n]) {
    const root = isqrt(value);
    assert.ok(root * root <= value && (root + 1n) * (root + 1n) > value, String(value));
  }
  assert.throws(() => isqrt(-1n));
});

test("a price a person names lands on the tick the program would read it at", () => {
  /* $5 000 of market cap for a billion coins of six decimals against USDC: the rehearsal's first price. */
  const sqrtPrice = sqrtPriceX64OfPrice("0.000005", 6, 6);
  const tick = tickIdFromSqrtPrice(new BN(sqrtPrice.toString()));
  assert.equal(tick, -122_067);
  assert.ok(BigInt(getSqrtPriceFromTickId(tick).toString()) <= sqrtPrice && BigInt(getSqrtPriceFromTickId(tick + 1).toString()) > sqrtPrice, "the tick's own price is the highest at or below the price named");
  assert.equal(alignTickDown(tick, 100), -122_100);
  /* Decimals move the price between atoms and whole tokens. */
  assert.equal(sqrtPriceX64OfPrice("1", 9, 9), 1n << 64n);
  assert.equal(sqrtPriceX64OfPrice("4", 6, 6), 2n << 64n);
  assert.ok(Math.abs(priceOfSqrtX64(sqrtPriceX64OfPrice("0.05", 9, 6), 9, 6) - 0.05) < 1e-12);
  assert.ok(Math.abs(priceOfSqrtX64(sqrtPrice, 6, 6) - 0.000005) < 1e-15);
  for (const bad of ["", "abc", "-1", "1e-6", "0", "0.0"]) assert.throws(() => sqrtPriceX64OfPrice(bad, 6, 6), undefined, bad);
});

test("alignment and tick arrays follow the SDK, below zero too", () => {
  for (const spacing of [1, 4, 64, 100, 256]) {
    for (const tick of [-443_636, -122_061, -12_801, -12_800, -129, -128, -1, 0, 1, 127, 128, 12_799, 12_800, 443_636]) {
      assert.equal(tickArrayIndexOf(tick, spacing), tickIndexFromId(tick, spacing), `tick ${tick}, spacing ${spacing}`);
      const aligned = alignTickDown(tick, spacing);
      assert.ok(aligned <= tick && tick - aligned < spacing && aligned % spacing === 0);
      assert.equal(isUsableTick(tick, spacing), isUsableTickId(tick, spacing));
    }
  }
  assert.equal(isUsableTick(100, 0), false);
  assert.equal(isUsableTick(100, 257), false);
  assert.equal(isUsableTick(443_700, 100), false);
});

test("ranges are split so that no instruction grows a tick array past what the program lets it", () => {
  const contiguous = Array.from({ length: 45 }, (_, index) => ({ tickLowerId: index * 100, tickUpperId: (index + 1) * 100 }));
  /* Forty-five ranges side by side share their ticks: 46 new ticks, one tick array, one instruction. */
  assert.deepEqual(splitRangesForGrowth(contiguous, 100, false), [contiguous]);
  assert.equal(newTicksPerInstruction(false), 63);
  assert.equal(newTicksPerInstruction(true), 52);
  /* Forty-five ranges that share no tick are ninety new ticks in one array of spacing 1: more than one instruction may add. */
  const apart = Array.from({ length: 45 }, (_, index) => ({ tickLowerId: index * 2, tickUpperId: index * 2 + 1 }));
  const groups = splitRangesForGrowth(apart, 1, false);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flat(), apart, "every range is kept, in the order given");
  assert.equal(new Set(groups[0].flatMap((range) => [range.tickLowerId, range.tickUpperId])).size, 62);
  assert.equal(splitRangesForGrowth(apart, 1, true).length, 2);
  assert.equal(new Set(splitRangesForGrowth(apart, 1, true)[0].flatMap((range) => [range.tickLowerId, range.tickUpperId])).size, 52);
  /* Ticks the pool already has cost no growth. */
  const known = new Set(apart.flatMap((range) => [range.tickLowerId, range.tickUpperId]));
  assert.equal(splitRangesForGrowth(apart, 1, false, known).length, 1);
  assert.deepEqual(splitRangesForGrowth([], 1, false), []);
});
