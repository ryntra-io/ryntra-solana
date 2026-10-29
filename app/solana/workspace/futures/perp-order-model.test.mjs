import assert from "node:assert/strict";
import test from "node:test";

import {
  accountLeverageAfter,
  bookFill,
  CAREFUL_LEVERAGE,
  clampLeverage,
  decimalInput,
  freeCollateralUsd,
  legPriceOf,
  legResult,
  leverageSteps,
  maxUsdOfLots,
  SDK_FRESH_MS,
  sdkCheck,
  newPerpDraft,
  perpOrderOf,
  sizeAtPercent,
  onlyReduces,
  sizeUnitsOf,
  tierLeverage,
} from "./perp-order-model.ts";

/* SOL on Phoenix: a lot is a thousandth of SOL, a tick a hundredth of a dollar (tickSize 10 × 10^3 / 10^6). */
const SOL = { tickSize: 10, baseLotsDecimals: 3 };
/* A draft starts with no side (PERP-5, spec §9): the tests that build an order say which one they mean. */
const draft = (over) => ({ ...newPerpDraft(50), side: "long", ...over });

test("a decimal as typed: a comma or a point, spaces between thousands", () => {
  assert.equal(decimalInput("1 250,5"), "1250.5");
  assert.equal(decimalInput("0.25"), "0.25");
  assert.equal(decimalInput(".5"), "0.5");
  assert.equal(decimalInput("12."), "12");
  assert.equal(decimalInput("1e3"), null);
  assert.equal(decimalInput("-2"), null);
  assert.equal(decimalInput(""), null);
});

test("the leverage: the tier by the position's size, the picker's steps, a pick inside the market's range", () => {
  const market = { maxLeverage: 20, leverageTiers: [{ maxLeverage: 20, maxSizeUnits: 1_000 }, { maxLeverage: 10, maxSizeUnits: 5_000 }, { maxLeverage: 5, maxSizeUnits: null }] };
  assert.equal(tierLeverage(market, 10), 20);
  assert.equal(tierLeverage(market, -1_000), 20, "a short counts by its size");
  assert.equal(tierLeverage(market, 2_000), 10);
  assert.equal(tierLeverage(market, 9_999_999), 5);
  assert.equal(tierLeverage({ maxLeverage: 8 }, 1), 8, "no tiers sent — the market's highest");
  assert.deepEqual(leverageSteps(20), [1, 2, 3, 5, 10, 20]);
  assert.deepEqual(leverageSteps(5), [1, 2, 3, 5]);
  assert.deepEqual(leverageSteps(null), [1]);
  assert.equal(clampLeverage(50, 20), 20);
  assert.equal(clampLeverage(0, 20), 1);
  assert.equal(clampLeverage(7.4, 20), 7);
  assert.equal(clampLeverage(NaN, 20), CAREFUL_LEVERAGE, "a careful start, not ten");
  assert.equal(clampLeverage(NaN, 1), 1, "never above the market's own highest");
});

test("the most an order may be worth: the SDK's most in lots at the counted price, under the first check's ceiling", () => {
  assert.equal(freeCollateralUsd({ portfolioUsd: 1_270.55, initialMarginUsd: 120.55 }), 1_150);
  assert.equal(freeCollateralUsd({ portfolioUsd: 10, initialMarginUsd: 30 }), 0, "never below nothing");
  assert.equal(freeCollateralUsd({ portfolioUsd: null, initialMarginUsd: 0 }), null);
  /* 3 839 lots of SOL (a thousandth each) at 180 USD: the SDK's most (PERP-4) as dollars. */
  assert.ok(Math.abs(maxUsdOfLots("3839", SOL, 180, null, 50) - 3.839 * 180) < 1e-9);
  assert.ok(Math.abs(maxUsdOfLots("3839", SOL, 180, 20, 50) - 20 / 1.005) < 1e-9, "the ceiling at the worst price the tolerance allows");
  assert.equal(maxUsdOfLots(null, SOL, 180, null, 50), null, "without the SDK's answer the slider waits");
  assert.equal(maxUsdOfLots("1e5", SOL, 180, null, 50), null);
  assert.equal(maxUsdOfLots("10", SOL, null, null, 50), null);
});

test("a market order's fill from the book: the asks for a long, the bids for a short; thin when it cannot fill", () => {
  const book = { asks: [{ price: 100, size: 1 }, { price: 101, size: 2 }], bids: [{ price: 99, size: 1 }, { price: 98, size: 5 }] };
  assert.deepEqual(bookFill("long", 2, book), { averageUsd: 100.5, worstUsd: 101 });
  assert.deepEqual(bookFill("short", 1, book), { averageUsd: 99, worstUsd: 99 });
  assert.equal(bookFill("long", 4, book), "thin");
  assert.equal(bookFill("long", 1, null), null);
});

test("the size: USD at the counted price or the asset itself", () => {
  assert.equal(sizeUnitsOf({ size: "100", unit: "usd" }, 200), 0.5);
  assert.equal(sizeUnitsOf({ size: "0,5", unit: "coin" }, null), 0.5);
  assert.equal(sizeUnitsOf({ size: "100", unit: "usd" }, null), null);
  assert.equal(sizeUnitsOf({ size: "abc", unit: "coin" }, 1), null);
});

test("the account's leverage after — a flip counted on its new side — and a leg's result", () => {
  /* 5 SOL long at 100 among 500 USD of positions on a 100 USD account. */
  assert.equal(accountLeverageAfter(500, 5, 5, 100, 100), 10, "an addition");
  assert.equal(accountLeverageAfter(500, 5, -2, 100, 100), 3, "a cut");
  assert.equal(accountLeverageAfter(500, 1, -3, 100, 100), 6, "1 long, sell 3 — 2 short: 400 + 200");
  assert.equal(accountLeverageAfter(500, 5, 1, 100, 0), null);
  assert.equal(onlyReduces(5, -2), true);
  assert.equal(onlyReduces(1, -3), false, "a flip adds the new side");
  assert.equal(onlyReduces(0, -1), false);
  assert.deepEqual(legResult("long", 100, 110, 2, 10), { usd: 20, percent: 100 });
  assert.deepEqual(legResult("short", 100, 110, 2, 5), { usd: -20, percent: -50 });
});

test("a market long with TP/SL as the route builds it, rounded toward the side each guards", () => {
  const made = perpOrderOf({ draft: draft({ size: "1,5", unit: "coin", tpsl: true, tp: "210.005", sl: "170.005" }), units: SOL, markUsd: 186.42, maxUsd: 10_000, heldUnits: 0 });
  assert.deepEqual(made.order, { kind: "open", side: "long", type: "market", tif: "fok", size: "1500", slippageBps: 50, tp: "21000", sl: "17001" });
  assert.equal(made.sizeUnits, 1.5);
  const short = perpOrderOf({ draft: draft({ side: "short", size: "1", unit: "coin", tpsl: true, tp: "170.005", sl: "210.005" }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 });
  assert.deepEqual(short.order, { kind: "open", side: "short", type: "market", tif: "fok", size: "1000", slippageBps: 50, tp: "17001", sl: "21000" });
});

test("USD becomes lots at the mark, down to a whole lot; the asset as typed becomes lots exactly; a limit's price in ticks", () => {
  assert.equal(perpOrderOf({ draft: draft({ size: "0,123", unit: "coin" }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 }).order.size, "123");
  const made = perpOrderOf({ draft: draft({ size: "100" }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 });
  assert.equal(made.order.size, "536", "100 / 186.42 = 0.53642… SOL — 536 lots, never more than typed");
  const limit = perpOrderOf({ draft: draft({ type: "limit", price: "180,123", size: "100" }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 });
  assert.deepEqual(limit.order, { kind: "open", side: "long", type: "limit", tif: "gtc", size: "555", price: "18012" });
  const sellLimit = perpOrderOf({ draft: draft({ side: "short", type: "limit", price: "190.001", size: "1", unit: "coin" }), units: SOL, markUsd: 186.42, maxUsd: null, heldUnits: 0 });
  assert.equal(sellLimit.order.price, "19001", "a sell's limit up — never under what was typed");
});

test("what blocks a draft: a size under a lot or a dollar, over the most, legs on the wrong side, an empty price", () => {
  const order = (over, extra = {}) => perpOrderOf({ draft: draft(over), units: SOL, markUsd: 186.42, maxUsd: 1_000, heldUnits: 0, ...extra });
  assert.equal(order({ size: "" }), null, "nothing typed — nothing to say");
  assert.deepEqual(order({ size: "x" }), { block: "SIZE" });
  assert.deepEqual(order({ size: "0.0001", unit: "coin" }), { block: "MINIMUM" });
  assert.deepEqual(order({ size: "0.5" }), { block: "MINIMUM" }, "under a dollar");
  assert.deepEqual(order({ size: "1200" }), { block: "OVER_MAX" });
  assert.deepEqual(order({ size: "100", tpsl: true, tp: "180" }), { block: "TP_SIDE" });
  assert.deepEqual(order({ size: "100", tpsl: true, sl: "190" }), { block: "SL_SIDE" });
  /* The side is checked on the tick: a take profit a fraction above the mark that rounds down onto it is refused here. */
  assert.deepEqual(perpOrderOf({ draft: draft({ size: "100", tpsl: true, tp: "100.009" }), units: SOL, markUsd: 100.005, maxUsd: null, heldUnits: 0 }), { block: "TP_SIDE" });
  /* The first check's ceiling has its own word, and a sell counts at the mark when that is above its limit. */
  assert.deepEqual(order({ size: "30" }, { ceilingUsd: 20 }), { block: "CEILING" });
  assert.deepEqual(order({ side: "short", type: "limit", price: "150", size: "0.12", unit: "coin" }, { ceilingUsd: 20 }), { block: "CEILING" }, "0.12 × the mark 186.42 > 20");
  assert.ok("order" in order({ side: "short", type: "limit", price: "150", size: "0.1", unit: "coin" }, { ceilingUsd: 20 }));
  assert.equal(order({ size: "100", tpsl: false, tp: "180" }).order.tp, null, "legs off — what was typed in them is not sent");
  assert.equal(order({ type: "limit", price: "", size: "100" }), null);
  assert.deepEqual(order({ type: "limit", price: "abc", size: "100" }), { block: "PRICE" });
});

test("reduce-only: a market order against the position held, never more than it", () => {
  const order = (over, held) => perpOrderOf({ draft: draft({ reduceOnly: true, ...over }), units: SOL, markUsd: 186.42, maxUsd: 1, heldUnits: held });
  assert.deepEqual(order({ side: "short", size: "1", unit: "coin" }, 2.5).order, { kind: "reduce", size: "1000", slippageBps: 50 });
  assert.deepEqual(order({ side: "long", size: "1", unit: "coin" }, 2.5), { block: "REDUCE_SIDE" });
  assert.deepEqual(order({ side: "short", size: "3", unit: "coin" }, 2.5), { block: "REDUCE_OVER" });
  assert.deepEqual(order({ side: "short", size: "1", unit: "coin" }, 0), { block: "REDUCE_NONE" });
  assert.deepEqual(order({ side: "short", size: "0.0001", unit: "coin" }, 2.5), { block: "LOT" }, "reduce-only has no dollar minimum, only a lot");
  assert.deepEqual(order({ side: "short", type: "limit", price: "190", size: "1", unit: "coin" }, 2.5), { block: "REDUCE_LIMIT" });
});

test("the slider's share as the size, down to the lot", () => {
  assert.equal(sizeAtPercent(50, 1_000, 186.42, "usd", SOL), "499.97", "2.682 SOL at the mark, down to the cent");
  assert.equal(sizeAtPercent(100, 1_000, 186.42, "coin", SOL), "5.364");
  assert.equal(sizeAtPercent(25, null, 186.42, "usd", SOL), "");
  assert.equal(sizeAtPercent(0, 1_000, 186.42, "usd", SOL), "");
  /* «100 %» is never over the most. */
  const made = perpOrderOf({ draft: draft({ size: sizeAtPercent(100, 1_000, 186.42, "usd", SOL) }), units: SOL, markUsd: 186.42, maxUsd: 1_000, heldUnits: 0 });
  assert.ok("order" in made);
});

test("no side is imposed: a draft with neither long nor short builds nothing and says so (PERP-5)", () => {
  const empty = { ...newPerpDraft(50) };
  assert.equal(empty.side, null, "a new ticket greets nobody with «Long»");
  assert.equal(perpOrderOf({ draft: empty, units: SOL, markUsd: 186.42, maxUsd: 1_000, heldUnits: 0 }), null, "nothing typed — nothing to say");
  assert.deepEqual(perpOrderOf({ draft: { ...empty, size: "100" }, units: SOL, markUsd: 186.42, maxUsd: 1_000, heldUnits: 0 }), { block: "SIDE" });
});

test("the time in force within the SDK: a market order's FOK or IOC, a limit's resting or post-only (PERP-5)", () => {
  const made = (over, extra = {}) => perpOrderOf({ draft: draft(over), units: SOL, markUsd: 186.42, maxUsd: 10_000, heldUnits: 0, ...extra });
  assert.equal(made({ size: "100" }).order.tif, "fok", "a market order is all at once or nothing, as it has always been");
  assert.equal(made({ size: "100", tif: "ioc" }).order.tif, "ioc");
  assert.equal(made({ type: "limit", price: "180", size: "100" }).order.tif, "gtc");
  assert.equal(made({ type: "limit", price: "180", size: "100", tif: "post_only" }).order.tif, "post_only");
  /* A time in force the type does not take falls back to the type's own, never travels as asked. */
  assert.equal(made({ size: "100", tif: "post_only" }).order.tif, "fok");
  assert.equal(made({ type: "limit", price: "180", size: "100", tif: "ioc" }).order.tif, "gtc");
  /* A post-only order that would cross the book is refused here, as Phoenix's own program refuses it. */
  const best = { bid: 186.3, ask: 186.5 };
  assert.deepEqual(made({ type: "limit", price: "186.6", size: "100", tif: "post_only" }, { best }), { block: "POST_ONLY_CROSS" });
  assert.equal(made({ type: "limit", price: "186.2", size: "100", tif: "post_only" }, { best }).order.price, "18620", "under the best ask it only rests");
  assert.deepEqual(made({ side: "short", type: "limit", price: "186.2", size: "1", unit: "coin", tif: "post_only" }, { best }), { block: "POST_ONLY_CROSS" });
  /* Without a fresh book nothing is guessed: the server reads the book again and refuses it there. */
  assert.ok("order" in made({ type: "limit", price: "186.6", size: "100", tif: "post_only" }));
});

test("a TP/SL in the three units: a price, a share of the margin, or dollars — each becoming one price (PERP-5)", () => {
  /* 2 SOL long entered at 100 at 5×: the margin is 40 USD, so 50 % of it is 20 USD — 10 USD a coin. */
  assert.equal(legPriceOf({ leg: "tp", side: "long", unit: "usd", value: 20, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 110);
  assert.equal(legPriceOf({ leg: "sl", side: "long", unit: "usd", value: 20, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 90);
  assert.equal(legPriceOf({ leg: "tp", side: "short", unit: "usd", value: 20, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 90);
  assert.equal(legPriceOf({ leg: "tp", side: "long", unit: "percent", value: 50, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 110);
  assert.equal(legPriceOf({ leg: "sl", side: "short", unit: "percent", value: 50, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 110);
  assert.equal(legPriceOf({ leg: "tp", side: "long", unit: "price", value: 123.45, entryUsd: 100, sizeUnits: 2, leverage: 5 }), 123.45);
  assert.equal(legPriceOf({ leg: "sl", side: "long", unit: "usd", value: 1_000, entryUsd: 100, sizeUnits: 2, leverage: 5 }), null, "a loss past the whole price is no price");
  assert.equal(legPriceOf({ leg: "tp", side: "long", unit: "percent", value: 50, entryUsd: 0, sizeUnits: 2, leverage: 5 }), null);
  /* The result of a leg and the price it sits at are each other's inverse, on the same margin. */
  const price = legPriceOf({ leg: "tp", side: "long", unit: "percent", value: 25, entryUsd: 186.42, sizeUnits: 1.5, leverage: 4 });
  assert.ok(Math.abs(legResult("long", 186.42, price, 1.5, 4).percent - 25) < 1e-9);
  /*
   * The ticket sends the price the unit comes to, on the very figures the hint under the field shows — the price the
   * order would fill at and the margin Phoenix holds: a stop at «20 %» of the margin at 10× is 2 % under the entry.
   */
  const made = perpOrderOf({ draft: draft({ size: "1", unit: "coin", tpsl: true, legUnit: "percent", sl: "20" }), units: SOL, markUsd: 200, maxUsd: 10_000, heldUnits: 0, legEntryUsd: 200, legLeverage: 10 });
  assert.equal(made.order.sl, "19600");
  assert.equal(made.order.tp, null);
  /* Without them a leg in another unit is counted on the order's own price at one times — never on a guess of leverage. */
  const bare = perpOrderOf({ draft: draft({ size: "1", unit: "coin", tpsl: true, legUnit: "percent", sl: "20" }), units: SOL, markUsd: 200, maxUsd: 10_000, heldUnits: 0 });
  assert.equal(bare.order.sl, "16000", "20 % of the margin at one times is a fifth of the price");
  /* The entry a leg is counted on is the ticket's, not the mark: a fill one per cent above the mark moves both legs. */
  const atFill = perpOrderOf({ draft: draft({ size: "1", unit: "coin", tpsl: true, legUnit: "usd", tp: "10" }), units: SOL, markUsd: 200, maxUsd: 10_000, heldUnits: 0, legEntryUsd: 202, legLeverage: 10 });
  assert.equal(atFill.order.tp, "21200", "202 + 10 USDC on one coin");
});

test("new risk goes to Review only on the SDK's fresh check of this size; a cut never waits (PERP-4)", () => {
  const risk = (over) => sdkCheck({ addsRisk: true, failed: false, answered: true, hasOrder: true, ageMs: 1_000, ...over });
  assert.equal(risk({}), "ok");
  assert.equal(risk({ answered: false, ageMs: null }), "CHECKING", "not come yet");
  assert.equal(risk({ failed: true }), "UNCHECKED", "the read failed: never open on no check");
  assert.equal(risk({ hasOrder: false }), "UNCHECKED", "answered without figures — a market or a position the SDK cannot count — is no endless «checking»");
  assert.equal(risk({ ageMs: SDK_FRESH_MS + 1 }), "CHECKING", "an old answer is not this moment's");
  assert.equal(risk({ ageMs: -5 }), "CHECKING");
  /* A cut or a close goes on whatever the check says. */
  assert.equal(sdkCheck({ addsRisk: false, failed: true, answered: false, hasOrder: false, ageMs: null }), "ok");
});
