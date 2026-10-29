// Run from repo root: node --test lib/solana/limits/model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { USDC_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import {
  TRIGGER_V1_JUPITER_FEE_BPS,
  crossesMarket,
  distanceFromMarketPercent,
  dlmmIsAskSide,
  dlmmPoolPrice,
  effectiveTriggerPrice,
  impliedPrice,
  limitAmounts,
  rawToDecimal,
  scaledDecimal,
  triggerFeePlan,
  triggerFeeRaw,
  typedPrice,
} from "./model.ts";

const SOL_USDC = { baseMint: WRAPPED_SOL_MINT, baseDecimals: 9, quoteMint: USDC_MINT, quoteDecimals: 6 };

test("decimals parse exactly and refuse anything but a plain positive decimal", () => {
  assert.equal(scaledDecimal("1.5", 6), 1_500_000n);
  assert.equal(scaledDecimal("0.0000001", 6), 0n);
  assert.equal(scaledDecimal(".25", 2), 25n);
  assert.equal(scaledDecimal("1e3", 6), null);
  assert.equal(scaledDecimal("-1", 6), null);
  assert.equal(scaledDecimal("1,5", 6), null);
  assert.equal(rawToDecimal(1_500_000n, 6), "1.5");
  assert.equal(rawToDecimal("100", 0), "100");
  assert.equal(rawToDecimal(5n, 9), "0.000000005");
});

test("a buy spends the quote and asks for the base the price gives, rounded up in the person's favour", () => {
  const amounts = limitAmounts({ pair: SOL_USDC, side: "buy", amount: "20", price: "100" });
  assert.deepEqual(amounts, {
    inputMint: USDC_MINT,
    outputMint: WRAPPED_SOL_MINT,
    makingRaw: "20000000",
    takingRaw: "200000000",
  });
  /* 10 USDC at 3 USDC per SOL: 3.333… SOL, the last lamport rounded up — the order never fills below the price. */
  assert.equal(limitAmounts({ pair: SOL_USDC, side: "buy", amount: "10", price: "3" }).takingRaw, "3333333334");
});

test("a sell gives the base and asks for the quote the price gives", () => {
  const amounts = limitAmounts({ pair: SOL_USDC, side: "sell", amount: "0.1", price: "250.5" });
  assert.deepEqual(amounts, {
    inputMint: WRAPPED_SOL_MINT,
    outputMint: USDC_MINT,
    makingRaw: "100000000",
    takingRaw: "25050000",
  });
  assert.equal(Math.round(impliedPrice(SOL_USDC, "sell", amounts.makingRaw, amounts.takingRaw) * 10) / 10, 250.5);
});

test("an empty, zero or malformed order has no amounts", () => {
  assert.equal(limitAmounts({ pair: SOL_USDC, side: "buy", amount: "0", price: "100" }), null);
  assert.equal(limitAmounts({ pair: SOL_USDC, side: "buy", amount: "10", price: "0" }), null);
  assert.equal(limitAmounts({ pair: SOL_USDC, side: "sell", amount: "abc", price: "100" }), null);
  /* A sell that asks for a fraction of a unit asks for one whole unit. */
  assert.equal(limitAmounts({ pair: SOL_USDC, side: "sell", amount: "0.000000001", price: "0.0001" }).takingRaw, "1");
});

test("the fee plan charges the pair's rate only into a proved referral token account", () => {
  const account = "Ref1111111111111111111111111111111111111111";
  assert.deepEqual(triggerFeePlan({ flow: "MAJOR", stablePair: false, referralTokenAccount: account }), {
    reason: "RYNTRA",
    ryntraBps: 10,
    jupiterBps: 0,
    feeBpsParam: 10,
    feeAccount: account,
  });
  assert.equal(triggerFeePlan({ flow: "TRENDING", stablePair: false, referralTokenAccount: account }).ryntraBps, 50);
  assert.equal(triggerFeePlan({ flow: "MEME", stablePair: false, referralTokenAccount: account }).ryntraBps, 100);
  const none = triggerFeePlan({ flow: "MEME", stablePair: false, referralTokenAccount: null });
  assert.equal(none.reason, "NO_FEE_ACCOUNT");
  assert.equal(none.ryntraBps, 0);
  assert.equal(none.jupiterBps, TRIGGER_V1_JUPITER_FEE_BPS.normal);
  assert.equal(none.feeAccount, null);
  const stable = triggerFeePlan({ flow: "STABLE", stablePair: true, referralTokenAccount: account });
  assert.equal(stable.reason, "FLOW_FREE");
  assert.equal(stable.jupiterBps, TRIGGER_V1_JUPITER_FEE_BPS.stable);
  assert.equal(stable.feeBpsParam, null);
});

test("the fee is the rate of what the order delivers, as measured on a filled mainnet order", () => {
  /* A filled mainnet order: taking 6 518 397 450 000 at 81 bps paid 52 799 019 345. */
  assert.equal(triggerFeeRaw("6518397450000", 81), "52799019345");
  assert.equal(triggerFeeRaw("25050000", 10), "25050");
});

test("the fee moves the price the order fills at, against the person", () => {
  assert.ok(effectiveTriggerPrice(100, "buy", 100) < 100);
  assert.ok(effectiveTriggerPrice(100, "sell", 100) > 100);
  assert.equal(effectiveTriggerPrice(100, "sell", 0), 100);
});

test("a limit across the market is flagged, and the distance is signed", () => {
  assert.equal(crossesMarket("buy", 101, 100), true);
  assert.equal(crossesMarket("buy", 99, 100), false);
  assert.equal(crossesMarket("sell", 99, 100), true);
  assert.equal(crossesMarket("sell", 101, 100), false);
  assert.equal(distanceFromMarketPercent(95, 100), -5);
});

test("a DLMM pool's orientation decides the side and the price", () => {
  assert.equal(dlmmIsAskSide("sell", true), true);
  assert.equal(dlmmIsAskSide("buy", true), false);
  assert.equal(dlmmIsAskSide("sell", false), false);
  assert.equal(dlmmIsAskSide("buy", false), true);
  assert.equal(dlmmPoolPrice(4, false), 0.25);
});

test("a price is pre-filled with six significant digits and keeps an integer's own zeros", () => {
  assert.equal(typedPrice(108900), "108900");
  assert.equal(typedPrice(110000.4), "110000");
  assert.equal(typedPrice(105.869198), "105.869");
  assert.equal(typedPrice(0.00001234567), "0.0000123457");
  assert.equal(typedPrice(1e-20), "");
  assert.equal(typedPrice(Number.NaN), "");
});
