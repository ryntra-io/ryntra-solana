// Run from repo root: node --test lib/plans/builder-defaults.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { carriedBudget, carriedCondition, startingPrice } from "./builder-defaults.ts";

/**
 * The UX audit of 2026-09-16 found the builder saying "prefilled with the
 * reference price" on a stock with no reference, and a `100` invented when
 * every price was missing. The starting price names its source or is absent.
 */
test("the reference price is the starting price when the issuer publishes one", () => {
  assert.deepEqual(startingPrice({ reference: { perShare: 755 }, tokenPerShareUsd: 752.68 }), { perShare: 755, source: "reference" });
});

test("without a reference, the token's per-share market price is used and named as such", () => {
  assert.deepEqual(startingPrice({ reference: { perShare: null }, tokenPerShareUsd: 23.76 }), { perShare: 23.76, source: "token-per-share" });
});

test("a token whose units are unknown has no per-share starting price, and nothing is invented", () => {
  assert.equal(startingPrice({ reference: { perShare: null }, tokenPerShareUsd: null }), null);
  assert.equal(startingPrice({ reference: { perShare: 0 }, tokenPerShareUsd: 0 }), null);
});

test("a budget from the asset page is carried only as a plain positive money figure", () => {
  assert.equal(carriedBudget("1000"), 1000);
  assert.equal(carriedBudget("250.50"), 250.5);
  assert.equal(carriedBudget(null), null);
  assert.equal(carriedBudget(""), null);
  assert.equal(carriedBudget("0"), null);
  assert.equal(carriedBudget("-5"), null);
  assert.equal(carriedBudget("1,000"), null);
  assert.equal(carriedBudget("abc"), null);
});

test("a condition carried from the analysis card keeps its metric, window and rule, and rounds the figure down to two significant figures", () => {
  assert.deepEqual(carriedCondition("dex_volume_usd:24h:gte:3119876"), { metric: "dex_volume_usd", window: "24h", operator: "gte", threshold: 3_100_000 });
  assert.deepEqual(carriedCondition("dex_volume_usd:7d:gte:703689"), { metric: "dex_volume_usd", window: "7d", operator: "gte", threshold: 700_000 });
  assert.deepEqual(carriedCondition("whale_net_flow_usd:24h:gt:-9814"), { metric: "whale_net_flow_usd", window: "24h", operator: "gt", threshold: -9_800 });
  assert.deepEqual(carriedCondition("whale_wallet_count:24h:gte:3"), { metric: "whale_wallet_count", window: "24h", operator: "gte", threshold: 3 });
  /* The structure card carries a point-in-time rule: the top-ten share at most the next whole percent, or an authority renounced (1.6.0). */
  assert.deepEqual(carriedCondition("top10_holder_share_pct:now:lte:81"), { metric: "top10_holder_share_pct", window: "now", operator: "lte", threshold: 81 });
  assert.deepEqual(carriedCondition("mint_authority:now:lte:0"), { metric: "mint_authority", window: "now", operator: "lte", threshold: 0 });
  assert.equal(carriedCondition("dex_volume_usd:30d:gte:1"), null, "a window outside the registry is nothing");
  assert.equal(carriedCondition("dex_volume_usd:24h:eq:1"), null);
  assert.equal(carriedCondition("<script>:24h:gte:1"), null);
  assert.equal(carriedCondition(null), null);
});
