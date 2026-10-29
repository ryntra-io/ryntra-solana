import { test } from "node:test";
import assert from "node:assert/strict";

import { decimalsOf, figuresOf, orderMatchesQuote, orderMatchesReview, orderWarnings, warningLine } from "./figures.ts";
import { ORDER, ORDER_NO_FEE, QUOTE, USDT, orderWith } from "./test-fixtures.mjs";

test("the card's figures are the engine's: what you get, the least, the fee, the route, the impact", () => {
  const figures = figuresOf(QUOTE.order, decimalsOf(QUOTE, USDT), "quote");
  assert.equal(figures.get, "1.5");
  assert.equal(figures.minimum, "1.492");
  assert.equal(figures.fee, "0.5%");
  assert.equal(figures.route, "Whirlpool");
  assert.equal(figures.impact, "<0.01%");
  assert.equal(figures.slippage, "0.5%");
  // A price alone never claims a deposit: only the exact order knows the wallet.
  assert.equal(figures.depositSol, null);
});

test("Ryntra's fee is the engine's own figure; none is drawn as none", () => {
  assert.equal(figuresOf(ORDER_NO_FEE.order, 6, "order").fee, null);
  const meme = orderWith({ ryntraFee: { ...ORDER.order.ryntraFee, basisPoints: 100 } });
  assert.equal(figuresOf(meme.order, 6, "order").fee, "1%");
  const major = orderWith({ ryntraFee: { ...ORDER.order.ryntraFee, basisPoints: 10 } });
  assert.equal(figuresOf(major.order, 6, "order").fee, "0.1%");
});

test("the order states Solana's fee and a new token account's one-time deposit", () => {
  const figures = figuresOf(orderWith({ rentFeeLamports: "2039280" }).order, 6, "order");
  assert.equal(figures.networkSol, "0.000006");
  assert.equal(figures.depositSol, "0.002039");
});

test("decimals are the engine's chain reads, or unknown", () => {
  assert.equal(decimalsOf(QUOTE, USDT), 6);
  assert.equal(decimalsOf(QUOTE, "nope"), null);
});

test("the wallet opens in the same tap only on an order no worse than the price shown", () => {
  assert.equal(orderMatchesQuote(QUOTE.order, ORDER), true);
  // A new token account's deposit is not a worse price.
  assert.equal(orderMatchesQuote(QUOTE.order, orderWith({ rentFeeLamports: "2039280" })), true);
  assert.equal(orderMatchesQuote(QUOTE.order, orderWith({ minReceivedRaw: "1400000" })), false);
  assert.equal(orderMatchesQuote(QUOTE.order, orderWith({ platformFee: { ...ORDER.order.platformFee, basisPoints: 100 } })), false);
  assert.equal(orderMatchesQuote(QUOTE.order, orderWith({ inAmountRaw: "20000000" })), false);
});

test("an engine warning over the order is read before the wallet opens", () => {
  const warned = structuredClone(ORDER);
  warned.policy.verdict.findings = warned.policy.verdict.findings.map((finding) =>
    finding.rule === "PRICE_IMPACT_DISCLOSED" ? { ...finding, outcome: "REVIEW" } : finding,
  );
  assert.deepEqual(orderWarnings(warned), ["PRICE_IMPACT_DISCLOSED"]);
  assert.equal(orderMatchesQuote(QUOTE.order, warned), false);
  assert.equal(orderMatchesReview(warned, warned), true);
  assert.equal(orderMatchesReview(ORDER, warned), false);
  assert.equal(warningLine("PRICE_IMPACT_DISCLOSED", warned), "This size moves the price.");
});

test("a fresh order for a reviewed one must be the same swap, no worse", () => {
  assert.equal(orderMatchesReview(ORDER, ORDER), true);
  assert.equal(orderMatchesReview(ORDER, orderWith({ minReceivedRaw: "1500000" })), true);
  assert.equal(orderMatchesReview(ORDER, orderWith({ minReceivedRaw: "1492499" })), false);
  assert.equal(orderMatchesReview(ORDER, orderWith({ totalFeeBasisPoints: 60 })), false);
});

test("slippage warnings name the 3% line", () => {
  assert.equal(warningLine("SLIPPAGE_BOUNDED", ORDER), "Check the least you get.");
  assert.equal(warningLine("SLIPPAGE_BOUNDED", orderWith({ minReceivedRaw: "1400000" })), "The price may move more than 3% before it lands.");
  assert.equal(warningLine("SOMETHING_NEW", ORDER), "Check this swap before you sign.");
});
