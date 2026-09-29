import assert from "node:assert/strict";
import test from "node:test";

import { priceKeyFor, readSwapUnitPrices, usdValueOfRaw } from "./price.ts";

/**
 * What an amount is worth, and the two ways that answer can be wrong.
 *
 * `RYN-SWAP-PREMIUM-001`. The figure decides nothing — the signed minimum comes
 * from the quote — so the failure mode worth guarding is not "no price" but
 * "confidently wrong price", in either the key or the arithmetic.
 */

const answer = (coins) => async () =>
  ({ ok: true, json: async () => ({ coins }) });

const NOW = Date.UTC(2026, 8, 10, 18, 0, 0);
const at = (secondsAgo) => Math.floor(NOW / 1000) - secondsAgo;

test("every side is keyed by its own chain and its own address, never another chain's", () => {
  /* The whole reason this source was chosen. USDG on Robinhood Chain is priced
     as USDG on Robinhood Chain — the chain answers to `robinhood`, verified
     live 2026-09-10 — rather than borrowed from a token sharing its symbol on
     a chain somebody has heard of. */
  assert.equal(priceKeyFor({ network: "robinhood", asset: "USDG" }), "robinhood:0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  assert.equal(priceKeyFor({ network: "base", asset: "USDC" }), "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(priceKeyFor({ network: "ethereum", asset: "USDC" }), "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(priceKeyFor({ network: "solana", asset: "SOL" }), "solana:So11111111111111111111111111111111111111112");

  /* A chain's own coin has no contract, and all three EVM chains pay gas in
     their own ETH — so each is asked about its own, never about Ethereum's. */
  for (const network of ["base", "ethereum", "robinhood"]) {
    assert.equal(priceKeyFor({ network, asset: "ETH" }), `${network}:0x0000000000000000000000000000000000000000`);
  }

  /* A token outside the catalogue is its own address on its own chain. */
  assert.equal(
    priceKeyFor({ network: "solana", asset: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }),
    "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  );
  /* And something that is not an asset is not a key, which is the same answer
     as no price rather than a guess. */
  assert.equal(priceKeyFor({ network: "robinhood", asset: "USDC" }), null, "Robinhood Chain has no USDC to price");
  assert.equal(priceKeyFor({ network: "solana", asset: "not-a-mint" }), null);
});

test("a price nobody is confident in, or nobody has refreshed, is no price at all", async () => {
  const coins = {
    "solana:So11111111111111111111111111111111111111112": { price: 100, confidence: 0.99, timestamp: at(30) },
    "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { price: 1, confidence: 0.4, timestamp: at(30) },
    "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { price: 1, confidence: 0.99, timestamp: at(7200) },
    "robinhood:0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168": { price: 0, confidence: 0.99, timestamp: at(30) },
  };
  const prices = await readSwapUnitPrices(
    [
      { network: "solana", asset: "SOL" },
      { network: "base", asset: "USDC" },
      { network: "ethereum", asset: "USDC" },
      { network: "robinhood", asset: "USDG" },
    ],
    { fetchImpl: answer(coins), now: () => NOW },
  );
  assert.deepEqual(prices.map((row) => `${row.network}:${row.asset}`), ["solana:SOL"]);
  assert.equal(prices[0].usd, 100);
});

test("an unreachable source costs a line and nothing else", async () => {
  const thrown = await readSwapUnitPrices([{ network: "solana", asset: "SOL" }], {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(thrown, [], "a transport failure is no price, never an error the form has to handle");

  const refused = await readSwapUnitPrices([{ network: "solana", asset: "SOL" }], {
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.deepEqual(refused, []);

  const nonsense = await readSwapUnitPrices([{ network: "solana", asset: "SOL" }], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ coins: "not an object" }) }),
  });
  assert.deepEqual(nonsense, []);
});

test("a token worth a millionth of a cent is worth what it is worth", () => {
  /* The first version carried the price at six decimal places, which is plenty
     for a dollar and useless for BONK: $0.000002692 rounds to three
     micro-dollars, so a million BONK read $3.00 against a true $2.69 — eleven
     per cent out, under an amount, with no sign anything was wrong. */
  const bonk = usdValueOfRaw("100000000000", 5, 0.000002692230767041595);
  assert.ok(Math.abs(bonk - 2.692230767) < 0.000001, `a million BONK is $2.69, got ${bonk}`);

  /* And the ordinary end of the range stays exact to the cent. */
  assert.equal(usdValueOfRaw("5000000", 6, 1), 5);
  assert.equal(usdValueOfRaw("1500000000", 9, 100), 150);
  assert.ok(Math.abs(usdValueOfRaw("400000000000000000", 18, 2465) - 986) < 0.0001);

  /* Nothing is guessed from a malformed input. */
  assert.equal(usdValueOfRaw("12.5", 6, 1), null);
  assert.equal(usdValueOfRaw("100", 6, 0), null);
  assert.equal(usdValueOfRaw("100", -1, 1), null);
  assert.equal(usdValueOfRaw("100", 6, Number.NaN), null);
});
