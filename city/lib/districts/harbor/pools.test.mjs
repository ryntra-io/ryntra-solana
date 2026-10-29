import { test } from "node:test";
import assert from "node:assert/strict";

import { harborOpen } from "./flag.ts";
import { defaultRange, feeShare, HARBOR_HALF_BINS, harborPool, harborPools, rangeText, riskWords } from "./pools.ts";
import { CATALOG } from "./test-fixtures.mjs";

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

test("the Harbor is closed unless the flag says open", () => {
  assert.equal(harborOpen(undefined), false);
  assert.equal(harborOpen(""), false);
  assert.equal(harborOpen("true"), false);
  assert.equal(harborOpen("OPEN"), false);
  assert.equal(harborOpen("open"), true);
  assert.equal(harborOpen(" open "), true);
});

test("the list keeps verified, deep pools of both venues, the most traded first", () => {
  const pools = harborPools(CATALOG);
  assert.deepEqual(
    pools.map((pool) => `${pool.kind}:${pool.pair}`),
    ["dlmm:SOL-USDC", "dlmm:SOL-USDC", "dlmm:TRUMP-USDC", "dlmm:SOL-HYPE", "damm-v2:SOL-USDC"],
  );
  // Unverified pools (ORIGAMI, CUTS, BORDR) never reach the list, however much they trade.
  assert.ok(pools.every((pool) => !/ORIGAMI|CUTS|BORDR/.test(pool.pair)));
  for (let i = 1; i < pools.length; i += 1) assert.ok((pools[i - 1].volume24hUsd ?? 0) >= (pools[i].volume24hUsd ?? 0));
  assert.equal(harborPools(CATALOG, 2).length, 2);
});

test("a pool carries the venue's own figures, with the fees for liquidity net of the venue's share", () => {
  const sol = harborPools(CATALOG)[0];
  assert.equal(sol.address, "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
  assert.equal(sol.x.symbol, "SOL");
  assert.equal(sol.y.symbol, "USDC");
  assert.equal(sol.x.decimals, 9);
  assert.equal(sol.binStepBps, 4);
  close(sol.lpFees24hUsd, sol.fees24hUsd * 0.95);
  close(sol.feePct, 0.04 + 0.0017284);
  const damm = harborPools(CATALOG).at(-1);
  close(damm.lpFees24hUsd, damm.fees24hUsd * 0.8);
  assert.deepEqual(damm.band, { min: 70, max: 440 });
});

test("a pool without a price, a depth or a verified token is not one the card can size", () => {
  const base = CATALOG[0];
  assert.equal(harborPool({ ...base, price: null }), null);
  assert.equal(harborPool({ ...base, tvlUsd: 50_000 }), null);
  assert.equal(harborPool({ ...base, x: { ...base.x, verified: false } }), null);
  assert.equal(harborPool({ ...base, y: { ...base.y, decimals: null } }), null);
  assert.equal(harborPool({ ...base, blacklisted: true }), null);
  assert.equal(harborPool({ ...base, binStepBps: null }), null);
});

test("a DLMM position takes the widest range the engine builds, around the price", () => {
  const sol = harborPools(CATALOG)[0];
  const range = defaultRange(sol);
  assert.equal(range.kind, "bins");
  assert.equal(range.half, HARBOR_HALF_BINS);
  close(range.low, sol.price * 1.0004 ** -34);
  close(range.high, sol.price * 1.0004 ** 34);
  assert.ok(range.downPct > 1.3 && range.downPct < 1.4, `${range.downPct}`);
  assert.equal(rangeText(sol, range), "101.8 – 104.6 USDC");
  assert.equal(riskWords(sol, range), "If SOL moves about 1.4% either way, this stops earning and holds only one coin.");
});

test("a DAMM v2 position takes the pool's own range; the plain curve earns at every price", () => {
  const damm = harborPools(CATALOG).at(-1);
  const band = defaultRange(damm);
  assert.equal(band.kind, "band");
  assert.equal(rangeText(damm, band), "70 – 440 USDC");
  assert.equal(riskWords(damm, band), "If SOL goes below 70 or above 440 USDC, this stops earning and holds only one coin.");
  const curve = defaultRange({ ...damm, band: { min: null, max: null } });
  assert.deepEqual(curve, { kind: "curve" });
  assert.equal(rangeText(damm, curve), "Every price");
  assert.match(riskWords(damm, curve), /^Earns at every price\./);
});

test("what an amount gets is its share of the pool, times what liquidity earned in the day gone", () => {
  const sol = harborPools(CATALOG)[0];
  const share = feeShare(sol, 50);
  close(share.sharePct, (50 / (sol.tvlUsd + 50)) * 100);
  close(share.dayUsd, sol.lpFees24hUsd * (50 / (sol.tvlUsd + 50)));
  assert.equal(feeShare(sol, 0), null);
  assert.equal(feeShare({ ...sol, lpFees24hUsd: null }, 50), null);
});
