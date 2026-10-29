import { test } from "node:test";
import assert from "node:assert/strict";

import { feeText, reviewTerms, termsLine } from "./terms.ts";
import { orderReview } from "./test-fixtures.mjs";

test("before signing, one line holds the size, the leverage after, the liquidation price and the fee — every one the Review's", () => {
  const review = orderReview({ fees: { takerRate: 0.00035, makerRate: 0.00005, venueUsd: 0.0106, venueLiquidity: "taker", builderBps: 2, builderUsd: 0.006 } });
  const terms = reviewTerms(review);
  assert.deepEqual(terms, { size: "0.2 SOL", leverage: "4.8×", liquidation: "$117.90", fee: "$0.02" });
  assert.equal(termsLine(terms), "0.2 SOL · 4.8× · Liq. $117.90 · Fee $0.02");
});

test("the fee is totalled as the web terminal totals it: taking liquidity now pays both, resting pays on the fill", () => {
  const fees = (changes) => ({ kind: "open", type: "market", fees: { takerRate: 0.00035, makerRate: 0.00005, venueUsd: 0.5, venueLiquidity: "taker", builderBps: 2, builderUsd: 0.25, ...changes } });
  assert.equal(feeText(fees({})), "$0.75");
  assert.equal(feeText(fees({ builderBps: 0, builderUsd: 0 })), "$0.50");
  assert.equal(feeText(fees({ venueLiquidity: "maker", venueUsd: 0.05 })), "$0.05 on fill");
  assert.equal(feeText(fees({ venueLiquidity: "mixed", venueUsd: null, builderUsd: null })), "on fill");
  assert.equal(feeText(fees({ venueUsd: null, builderUsd: null })), "on fill");
  // A Review from before `venueLiquidity`: a plain limit is decided on the fill.
  assert.equal(feeText({ kind: "open", type: "limit", fees: { venueUsd: 0.5, builderBps: 0, builderUsd: null } }), "on fill");
});

test("a whole close leaves no leverage and no liquidation to show; Phoenix's word stands where it has no price", () => {
  const close = reviewTerms(orderReview({ kind: "reduce", after: { ...orderReview().after, positionUnits: "0", liquidationUsd: null, liquidationStatus: "no_position", leverage: null } }));
  assert.equal(termsLine(close), "0.2 SOL · Fee $0.01");
  const danger = reviewTerms(orderReview({ after: { ...orderReview().after, liquidationUsd: null, liquidationStatus: "already_liquidatable" } }));
  assert.equal(danger.liquidation, "now");
  // Nothing the engine did not send is filled in.
  assert.equal(reviewTerms(orderReview({ after: null })).liquidation, null);
  assert.equal(reviewTerms(orderReview({ kind: "protect", tif: null, sizeUnits: "0" })), null);
  assert.equal(reviewTerms(orderReview({ kind: "cancel", tif: null, sizeUnits: "0" })), null);
});
