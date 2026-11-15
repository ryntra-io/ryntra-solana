// The fee arithmetic of the DLMM Pro venue, held to the SDK's own encoders and schedulers.
import assert from "node:assert/strict";
import test from "node:test";

import * as sdk from "@meteora-ag/dlmm-pro-sdk";
import { BaseFeeMode, fixedBaseFeeParameters, getBaseFeeNumerator, marketCapSchedulerBaseFeeParameters, timeSchedulerBaseFeeParameters } from "@meteora-ag/dlmm-pro-sdk";
import BN from "bn.js";

const { FEE_SHARES, MAX_FEE_NUMERATOR, basePeriodOf, decodeBaseFee, feeBpsOf, sqrtPriceOfPeriod, totalFeeNumerator, variableFeeCeiling, variableFeeNow, variableFeeNumeratorOf } = await import("./fee.ts");

const Q64 = 1n << 64n;
const bn = (value) => new BN(value.toString());

test("a base fee decodes from the bytes the SDK encodes, in every mode", () => {
  const fixed = fixedBaseFeeParameters(80);
  assert.deepEqual(decodeBaseFee(fixed.baseFeeMode, fixed.data), { kind: "fixed", mode: "fixed", cliffNumerator: 8_000_000n });

  const time = timeSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.TimeSchedulerExponential, startingBaseFeeBps: 5_000, endingBaseFeeBps: 100, numberOfPeriod: 30, totalDuration: 1_800 });
  const decodedTime = decodeBaseFee(time.baseFeeMode, time.data);
  assert.equal(decodedTime.kind, "time");
  assert.equal(decodedTime.mode, "timeExponential");
  assert.equal(decodedTime.cliffNumerator, 500_000_000n);
  assert.equal(decodedTime.periodFrequency, 60n);
  assert.equal(decodedTime.periods, 30);

  const cap = marketCapSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.MarketCapSchedulerExponential, startingBaseFeeBps: 5_000, endingBaseFeeBps: 100, numberOfPeriod: 60, priceMultiple: 4, schedulerExpirationDuration: 86_400 });
  const decodedCap = decodeBaseFee(cap.baseFeeMode, cap.data);
  assert.equal(decodedCap.kind, "marketCap");
  assert.equal(decodedCap.mode, "marketCapExponential");
  assert.equal(decodedCap.cliffNumerator, 500_000_000n);
  /* The price quadruples when its square root doubles: sixty steps of 166 basis points of the square root. */
  assert.equal(decodedCap.sqrtPriceStepBps, 166);
  assert.equal(decodedCap.expirationDuration, 86_400);
  assert.equal(decodedCap.periods, 60);

  const linear = marketCapSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.MarketCapSchedulerLinear, startingBaseFeeBps: 2_000, endingBaseFeeBps: 100, numberOfPeriod: 19, priceMultiple: 2, schedulerExpirationDuration: 600 });
  assert.equal(decodeBaseFee(linear.baseFeeMode, linear.data).mode, "marketCapLinear");
  assert.equal(decodeBaseFee(linear.baseFeeMode, linear.data).reductionFactor, 10_000_000n);
});

test("a mode the release does not have, or a wrong length, is refused — never read as something else", () => {
  assert.throws(() => decodeBaseFee(5, new Array(31).fill(0)), /Unknown base fee mode/);
  assert.throws(() => decodeBaseFee(0, new Array(30).fill(0)), /31 bytes/);
});

test("the step of a market-cap schedule: the cliff at the first price, back to it when the price falls back, settled before the opening and after its time", () => {
  const cap = marketCapSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.MarketCapSchedulerExponential, startingBaseFeeBps: 5_000, endingBaseFeeBps: 100, numberOfPeriod: 60, priceMultiple: 4, schedulerExpirationDuration: 86_400 });
  const schedule = decodeBaseFee(cap.baseFeeMode, cap.data);
  const init = Q64 * 7n;
  const at = (point, sqrtPrice) => basePeriodOf(schedule, { point, activationPoint: 1_000n, initSqrtPrice: init, sqrtPrice });
  assert.equal(at(1_000n, init), 0);
  assert.equal(at(1_000n, init - 1n), 0, "below the first price the fee is the cliff");
  assert.equal(at(999n, init * 3n), 60, "before the pool opens the program reads the settled fee");
  assert.equal(at(1_000n + 86_400n, init), 0, "the last second of the schedule still follows the price");
  assert.equal(at(1_000n + 86_401n, init), 60, "after its time the schedule is settled whatever the price");
  assert.equal(at(2_000n, init * 2n), 60, "at four times the first price it is settled");
  /* Each step starts exactly where `sqrtPriceOfPeriod` says, and one unit below is the step before. */
  for (const period of [1, 2, 17, 59, 60]) {
    const edge = sqrtPriceOfPeriod(schedule, init, period);
    assert.equal(at(2_000n, edge), period);
    assert.equal(at(2_000n, edge - 1n), period - 1);
  }
});

test("the step is the one the SDK's own scheduler charges for", () => {
  const cap = marketCapSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.MarketCapSchedulerExponential, startingBaseFeeBps: 5_000, endingBaseFeeBps: 100, numberOfPeriod: 60, priceMultiple: 4, schedulerExpirationDuration: 86_400 });
  const schedule = decodeBaseFee(cap.baseFeeMode, cap.data);
  const init = Q64 * 3n;
  const numeratorAt = (sqrtPrice) => BigInt(getBaseFeeNumerator(cap, bn(5_000n), bn(1_000n), bn(init), bn(sqrtPrice)).toString());
  let last = numeratorAt(init);
  assert.equal(last, 500_000_000n);
  for (let period = 1; period <= 60; period += 1) {
    const edge = sqrtPriceOfPeriod(schedule, init, period);
    const here = numeratorAt(edge);
    assert.ok(here < last, `step ${period} charges less than the step before`);
    assert.equal(numeratorAt(edge - 1n), last, `one unit below step ${period} is still the step before`);
    last = here;
  }
  /* The settled fee: at least the 1 % asked for, by less than a basis point over. */
  assert.ok(last >= 10_000_000n && last < 10_100_000n, String(last));

  const time = timeSchedulerBaseFeeParameters({ baseFeeMode: BaseFeeMode.TimeSchedulerLinear, startingBaseFeeBps: 9_900, endingBaseFeeBps: 75, numberOfPeriod: 180, totalDuration: 1_800 });
  const timeSchedule = decodeBaseFee(time.baseFeeMode, time.data);
  const stepAt = (point) => basePeriodOf(timeSchedule, { point, activationPoint: 100n, initSqrtPrice: init, sqrtPrice: init });
  assert.equal(stepAt(100n), 0);
  assert.equal(stepAt(109n), 0);
  assert.equal(stepAt(110n), 1);
  assert.equal(stepAt(100n + 1_800n), 180);
  assert.equal(stepAt(10n ** 12n), 180);
  assert.equal(stepAt(99n), 180);
});

test("the variable fee: control × volatility² over 10¹¹, rounded up", () => {
  assert.equal(variableFeeNumeratorOf(0, 350_000), 0n);
  assert.equal(variableFeeNumeratorOf(2_000_000, 0), 0n);
  assert.equal(variableFeeNumeratorOf(1, 1), 1n, "any fee above zero is at least one");
  assert.equal(variableFeeNumeratorOf(2_000_000, 350_000), 2_450_000n);
  assert.equal(variableFeeCeiling({ initialized: false, maxVolatilityAccumulator: 350_000, variableFeeControl: 2_000_000, filterPeriod: 10, decayPeriod: 120, reductionFactor: 5_000 }), 0n);
});

test("the volatility a swap would start with: kept inside the filter, decayed after it, forgotten after the decay, reset after an hour", () => {
  const config = { initialized: true, maxVolatilityAccumulator: 350_000, variableFeeControl: 2_000_000, filterPeriod: 10, decayPeriod: 120, reductionFactor: 5_000 };
  const price = Q64 * 5n;
  /* A reference one tick's worth below the price: 20 000 × (1.0001 − 1) = 2 ticks of the program's measure. */
  const reference = (price * 10_000n) / 10_001n;
  const state = { sqrtPriceReference: reference, lastSignificantSwapTimestamp: 1_000n, lastReferenceTimestamp: 1_000n, volatilityAccumulator: 100_000, volatilityReference: 40_000 };

  const inside = variableFeeNow(config, state, price, 1_005n);
  assert.equal(inside.sqrtPriceReference, reference, "inside the filter the reference stays");
  assert.equal(inside.volatilityReference, 40_000);
  assert.ok(inside.volatilityAccumulator > 40_000, "the distance from the reference is added to what was remembered");

  const decayed = variableFeeNow(config, state, price, 1_050n);
  assert.equal(decayed.sqrtPriceReference, price, "after the filter the reference moves to the price");
  assert.equal(decayed.volatilityReference, 50_000, "and half the accumulator is remembered");
  assert.equal(decayed.volatilityAccumulator, 50_000);
  assert.equal(decayed.numerator, variableFeeNumeratorOf(config.variableFeeControl, 50_000));

  const forgotten = variableFeeNow(config, state, price, 1_200n);
  assert.equal(forgotten.volatilityReference, 0);
  assert.equal(forgotten.numerator, 0n);

  const reset = variableFeeNow(config, { ...state, lastSignificantSwapTimestamp: 9_000n }, price, 1_000n + 3_601n);
  assert.equal(reset.volatilityReference, 0, "a reference older than an hour starts again even while swaps keep coming");

  const capped = variableFeeNow(config, { ...state, sqrtPriceReference: price / 2n }, price, 1_005n);
  assert.equal(capped.volatilityAccumulator, 350_000);
  assert.equal(capped.numerator, variableFeeCeiling(config));

  assert.equal(variableFeeNow({ ...config, initialized: false }, state, price, 1_005n).numerator, 0n, "a pool without a dynamic fee has none");
});

test("base and variable together never pass 99 %; basis points to two decimals", () => {
  assert.equal(totalFeeNumerator(500_000_000n, 2_000_000n), 502_000_000n);
  assert.equal(totalFeeNumerator(989_000_000n, 5_000_000n), MAX_FEE_NUMERATOR);
  assert.equal(feeBpsOf(10_000_000n), 100);
  assert.equal(feeBpsOf(400_000n), 4);
  assert.equal(feeBpsOf(7_500_060n), 75);
  assert.equal(feeBpsOf(23_364_500n), 233.64);
});

test("who gets a fee, and the most a fee can be, are the SDK's own constants — an upgrade that moves one fails here", () => {
  assert.equal(FEE_SHARES.protocolOfLiquidityBps, sdk.MM_PROTOCOL_FEE_BPS);
  assert.equal(FEE_SHARES.protocolOfLiquidityLaunchBps, sdk.MM_LAUNCH_POOL_PROTOCOL_FEE_BPS);
  assert.equal(FEE_SHARES.protocolOfOrdersBps, sdk.LIMIT_ORDER_PROTOCOL_FEE_BPS);
  assert.equal(FEE_SHARES.referralOfProtocolBps, sdk.HOST_FEE_BPS);
  assert.equal(FEE_SHARES.referralOfOrderFeeBps, sdk.LIMIT_ORDER_REFERRAL_FEE_BPS);
  assert.equal(FEE_SHARES.partnerOfProtocolCeilingBps, sdk.MAX_PARTNER_FEE_BPS);
  assert.equal(MAX_FEE_NUMERATOR, BigInt(sdk.MAX_FEE_NUMERATOR.toString()));
  assert.equal(1_000_000_000n, BigInt(sdk.FEE_DENOMINATOR.toString()), "the denominator the venue's basis points are read over");
});

test("who gets a fee is Meteora's rule, written once", () => {
  assert.deepEqual({ ...FEE_SHARES }, { protocolOfLiquidityBps: 1_000, protocolOfLiquidityLaunchBps: 2_000, protocolOfOrdersBps: 5_000, referralOfProtocolBps: 2_000, referralOfOrderFeeBps: 2_000, partnerOfProtocolCeilingBps: 5_000 });
});
