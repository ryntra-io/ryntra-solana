import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeJupiterOrder } from "./quotes.ts";
import { buildSwapQuoteReview, SwapQuoteReviewSchema, verifySwapQuoteReview } from "./swap-review.ts";

const raw = JSON.parse(readFileSync("lib/solana/fixtures/jupiter-order-v2-sol-usdc.json", "utf8"));

function order(access = "production") {
  return normalizeJupiterOrder(raw, {
    access,
    latencyMs: 118,
    observedAt: "2026-08-27T10:00:00.000Z",
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  });
}

test("a fresh quote review is hash-bound and explicitly not executed", () => {
  const review = buildSwapQuoteReview(order(), new Date("2026-08-27T10:00:01.000Z"));
  assert.equal(review.schema, "ryntra.solana.swap-quote-review");
  assert.equal(review.schemaVersion, "1.0.0");
  assert.equal(review.state, "FRESH");
  assert.equal(review.execution, "NOT_EXECUTED");
  assert.match(review.quoteDigest, /^0x[0-9a-f]{64}$/);
  assert.match(review.reviewDigest, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(review.limitations, ["QUOTE_ONLY", "NO_SIGNATURE", "NO_EXECUTION", "NO_RECEIPT"]);
  assert.doesNotThrow(() => SwapQuoteReviewSchema.parse(review));
  assert.deepEqual(verifySwapQuoteReview(review), review);

  const keys = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      walk(child);
    }
  };
  walk(review);
  for (const forbidden of ["signature", "transactionHash", "actualInput", "actualOutput", "outcomeReceipt"]) {
    assert.ok(!keys.includes(forbidden), `${forbidden} cannot exist before execution`);
  }
});

test("material fee or amount drift changes the quote digest", () => {
  const baseline = buildSwapQuoteReview(order(), new Date("2026-08-27T10:00:01.000Z"));
  const changedAmount = buildSwapQuoteReview({ ...order(), outAmountRaw: "104496" }, new Date("2026-08-27T10:00:01.000Z"));
  const changedFee = buildSwapQuoteReview(
    { ...order(), platformFee: { ...order().platformFee, basisPoints: 3 } },
    new Date("2026-08-27T10:00:01.000Z"),
  );
  assert.notEqual(changedAmount.quoteDigest, baseline.quoteDigest);
  assert.notEqual(changedFee.quoteDigest, baseline.quoteDigest);
  assert.notEqual(changedAmount.reviewDigest, baseline.reviewDigest);
  assert.notEqual(changedFee.reviewDigest, baseline.reviewDigest);
});

test("every rendered or execution-material provider field is digest-bound", () => {
  const baselineOrder = order();
  const baseline = buildSwapQuoteReview(baselineOrder, new Date("2026-08-27T10:00:01.000Z"));
  const payer = "11111111111111111111111111111111";
  const mutations = [
    { signatureFeePayer: payer },
    { priorityFeePayer: payer },
    { rentFeePayer: payer },
    { gasless: !baselineOrder.gasless },
    { guaranteedPrice: !baselineOrder.guaranteedPrice },
    { jitOptimized: !baselineOrder.jitOptimized },
    { inUsdValue: "0.10000001" },
    { outUsdValue: "0.10000002" },
    { swapUsdValue: "0.10000003" },
    { source: { ...baselineOrder.source, label: baselineOrder.source.label + " · changed" } },
  ];
  for (const mutation of mutations) {
    const changed = buildSwapQuoteReview({ ...baselineOrder, ...mutation }, new Date("2026-08-27T10:00:01.000Z"));
    assert.notEqual(changed.quoteDigest, baseline.quoteDigest, `quote digest ignored ${Object.keys(mutation)[0]}`);
    assert.notEqual(changed.reviewDigest, baseline.reviewDigest, `review digest ignored ${Object.keys(mutation)[0]}`);
  }
});

test("review verification recomputes both digest layers", () => {
  const review = buildSwapQuoteReview(order(), new Date("2026-08-27T10:00:01.000Z"));
  assert.throws(
    () => verifySwapQuoteReview({ ...review, quote: { ...review.quote, quotedOutputRaw: "104496" } }),
    /quote digest does not match/i,
  );
  assert.throws(
    () => verifySwapQuoteReview({ ...review, state: "STALE" }),
    /review digest does not match/i,
  );
});

test("expired and explicitly degraded reviews are never fresh", () => {
  const expired = buildSwapQuoteReview(order(), new Date("2026-08-27T10:00:15.000Z"));
  assert.equal(expired.state, "STALE");

  const degraded = buildSwapQuoteReview(order("degraded"), new Date("2026-08-27T10:00:01.000Z"));
  assert.equal(degraded.state, "PROVIDER_DEGRADED");
});
