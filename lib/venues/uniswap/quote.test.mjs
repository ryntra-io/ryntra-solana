// Run from repo root: node --test lib/venues/uniswap/quote.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteUniswapV3, V3_FEE_TIERS, UNISWAP_V3_QUOTER_V2 } from "./quote.ts";

const now = () => 1_000_000;
const word = (n) => "0x" + n.toString(16).padStart(64, "0");

// fee tier is the 4th ABI word of calldata (selector + tokenIn + tokenOut + amountIn + fee + limit)
const feeOf = (data) => Number(BigInt("0x" + data.slice(2 + 8 + 64 * 3, 2 + 8 + 64 * 4)));

test("best tier wins: quotes across tiers, highest amountOut selected, fee reported in bps", async () => {
  const call = async (to, data) => {
    assert.equal(to, UNISWAP_V3_QUOTER_V2);
    const fee = feeOf(data);
    if (fee === 500) return word(105n);
    if (fee === 3000) return word(120n);
    throw new Error("execution reverted");
  };
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, call, now);
  assert.equal(r.status, "quoted");
  assert.equal(r.quote.amountOut, 120n);
  assert.equal(r.quote.feeTierBps, 30); // 3000 hundredths-of-bip = 30 bps
  assert.equal(r.quote.observedAt, 1_000_000);
});

test("INVARIANT: all tiers reverting = no-liquidity (checked and empty), never a fake price", async () => {
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, async () => { throw new Error("execution reverted"); }, now);
  assert.equal(r.status, "no-liquidity");
});

test("INVARIANT: transport failure = error (could NOT check) — distinct from an empty market", async () => {
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, async () => { throw new Error("fetch failed"); }, now);
  assert.equal(r.status, "error");
});

test("mixed: network failure on some tiers but a real quote on another still quotes", async () => {
  const call = async (_to, data) => {
    const fee = feeOf(data);
    if (fee === 500) return word(99n);
    throw new Error("fetch failed");
  };
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, call, now);
  assert.equal(r.status, "quoted");
  assert.equal(r.quote.feeTierBps, 5);
});

test("mixed: reverts + network failures with no success = error, not no-liquidity", async () => {
  const call = async (_to, data) => {
    const fee = feeOf(data);
    if (fee === 500 || fee === 3000) throw new Error("execution reverted");
    throw new Error("timeout");
  };
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, call, now);
  assert.equal(r.status, "error"); // we cannot honestly claim the market is empty
});

test("degenerate input: zero amount never issues calls", async () => {
  let calls = 0;
  const r = await quoteUniswapV3("0xaa", "0xbb", 0n, async () => { calls++; return word(1n); }, now);
  assert.equal(r.status, "no-liquidity");
  assert.equal(calls, 0);
});

test("empty or short return data is unusable, treated as revert", async () => {
  const r = await quoteUniswapV3("0xaa", "0xbb", 100n, async () => "0x", now);
  assert.equal(r.status, "no-liquidity");
});

test("tiers are the canonical v3 set", () => {
  assert.deepEqual([...V3_FEE_TIERS], [100, 500, 3000, 10000]);
});
