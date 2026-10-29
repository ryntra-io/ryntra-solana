// Run from repo root: node --test lib/ring/weight.test.mjs
/*
 * CITY-50 «Ринг · агенти»: weight classes by the price of the brain. A class is read from one standard match at the
 * pinned provider's price; the review's examples (27.10) land in their classes; a model past the heavy ceiling or
 * without a price is never offered; each class's key limit stays under the gateway's ceiling.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { MATCH, WEIGHT_BOUNDS, KEY_LIMIT_USD, matchCostMicroUsd, weightOf } = await import("./weight.ts");
const { KEY_LIMIT_MAX_USD } = await import("../models/keys.ts");
const { WEIGHTS } = await import("./contract.ts");

/** Prices as the catalog keeps them: dollars per 1M tokens. */
const priced = (input, output, overrides = []) => ({ prices: { inputPerMillionUsd: input, outputPerMillionUsd: output, reasoningPerMillionUsd: null, cacheReadPerMillionUsd: null, overrides } });

test("one standard match is 20 moves of 2 000 tokens: 1 800 read and 200 written", () => {
  assert.equal(MATCH.moves * (MATCH.inputPerMove + MATCH.outputPerMove), 40_000);
  // $3 in, $15 out: 20 × (1 800 × 3 + 200 × 15) µ$ = $0.168.
  assert.equal(matchCostMicroUsd(priced(3, 15)), 168_000);
  assert.equal(matchCostMicroUsd(priced(0, 0)), 0, "a free model is a known zero");
  assert.equal(matchCostMicroUsd(priced(null, 15)), null, "an unknown price is never zero");
  assert.equal(matchCostMicroUsd(priced(3, null)), null);
});

test("the cost is rounded up per move, so an estimate never understates", () => {
  // 1 800 × 0.0000011 + 200 × 0.0000011 = 0.0022 µ$ a move → 1 µ$ a move → 20 µ$.
  assert.equal(matchCostMicroUsd(priced(0.0000011, 0.0000011)), 20);
});

test("the classes: light under $0.04, middle under $0.24, heavy up to $2.00, nothing above", () => {
  assert.deepEqual([...WEIGHTS], ["light", "middle", "heavy"]);
  assert.equal(weightOf(0), "light");
  assert.equal(weightOf(WEIGHT_BOUNDS.light - 1), "light");
  assert.equal(weightOf(WEIGHT_BOUNDS.light), "middle");
  assert.equal(weightOf(WEIGHT_BOUNDS.middle - 1), "middle");
  assert.equal(weightOf(WEIGHT_BOUNDS.middle), "heavy");
  assert.equal(weightOf(WEIGHT_BOUNDS.heavy), "heavy");
  assert.equal(weightOf(WEIGHT_BOUNDS.heavy + 1), null, "past the heavy ceiling a model is not offered");
  for (const odd of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(weightOf(odd), null, String(odd));
});

test("the review's examples land in their classes (two agents: light ≈ $0.02, middle ≈ $0.25–0.32, heavy ≈ $0.64–1.60)", () => {
  // Two agents a match at a blended price (0.9 × in + 0.1 × out) per 1M tokens equal to the input price, as the review reckons.
  const forTwo = (perMillion) => 2 * matchCostMicroUsd(priced(perMillion, perMillion));
  assert.equal(weightOf(forTwo(0.25) / 2), "light");
  assert.ok(Math.abs(forTwo(0.25) - 20_000) <= 40, "≈ $0.02 for two");
  for (const perMillion of [3.125, 4]) assert.equal(weightOf(forTwo(perMillion) / 2), "middle", `${perMillion}`);
  for (const perMillion of [8, 20]) assert.equal(weightOf(forTwo(perMillion) / 2), "heavy", `${perMillion}`);
  // The same with real-looking pairs of prices.
  assert.equal(weightOf(matchCostMicroUsd(priced(0.25, 1.25))), "light");
  assert.equal(weightOf(matchCostMicroUsd(priced(3, 15))), "middle");
  assert.equal(weightOf(matchCostMicroUsd(priced(5, 25))), "heavy");
  assert.equal(weightOf(matchCostMicroUsd(priced(15, 75))), "heavy");
  assert.equal(weightOf(matchCostMicroUsd(priced(150, 600))), null);
});

test("a prompt-size override is read at the size of one move's prompt", () => {
  // Above 200 000 prompt tokens the price doubles; a move's 1 800 never reaches it.
  assert.equal(matchCostMicroUsd(priced(3, 15, [{ minPromptTokens: 200_000, inputPerMillionUsd: 6, outputPerMillionUsd: 22.5, reasoningPerMillionUsd: null, cacheReadPerMillionUsd: null }])), 168_000);
  // From 1 000 tokens up it is already the dearer tier.
  assert.equal(matchCostMicroUsd(priced(3, 15, [{ minPromptTokens: 1_000, inputPerMillionUsd: 6, outputPerMillionUsd: 22.5, reasoningPerMillionUsd: null, cacheReadPerMillionUsd: null }])), 20 * (1_800 * 6 + 200 * 22.5));
});

test("each class's key limit is a positive dollar sum under the gateway's ceiling, rising with the class", () => {
  for (const weight of WEIGHTS) {
    assert.ok(KEY_LIMIT_USD[weight] > 0 && KEY_LIMIT_USD[weight] <= KEY_LIMIT_MAX_USD, weight);
  }
  assert.ok(KEY_LIMIT_USD.light < KEY_LIMIT_USD.middle && KEY_LIMIT_USD.middle < KEY_LIMIT_USD.heavy);
  // Each limit pays for at least ten matches of the dearest agent of its class.
  assert.ok(KEY_LIMIT_USD.light * 1e6 >= 10 * WEIGHT_BOUNDS.light);
  assert.ok(KEY_LIMIT_USD.middle * 1e6 >= 10 * WEIGHT_BOUNDS.middle);
  assert.ok(KEY_LIMIT_USD.heavy * 1e6 >= 10 * WEIGHT_BOUNDS.heavy);
});
