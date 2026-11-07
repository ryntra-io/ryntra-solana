import { test } from "node:test";
import assert from "node:assert/strict";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG, addReview } from "../districts/harbor/test-fixtures.mjs";
import {
  PIER_MIN_LAMPORTS,
  PIER_RESERVE_LAMPORTS,
  STYLE_HALF,
  depthSol,
  feesSol24h,
  otherInSol,
  pierCosts,
  pierMinimum,
  pierRestBody,
  pierZapBody,
  pierOf,
  pierRange,
  pierSplit,
  solPiers,
  rangePrices,
  solShort,
  unitsShort,
  zapFeePct,
  zapFigures,
  zapFit,
  zapMax,
} from "./pier.ts";
import { SOL, SOL_USDC, USDC, lstPool, zapReview } from "./pier-fixtures.mjs";

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const holdings = (sol, tokens = {}, complete = true) => ({
  owner: OWNER,
  sol: sol === null ? null : { spendableRaw: String(sol), decimals: 9 },
  tokens: new Map(Object.entries(tokens).map(([mint, raw]) => [mint, { spendableRaw: String(raw), decimals: mint === USDC ? 6 : 9 }])),
  complete,
  at: 1,
});

test("only DLMM pools of SOL against an LST or USDC are piers", () => {
  const piers = solPiers([...harborPools(CATALOG), lstPool()]);
  assert.ok(piers.length >= 2);
  for (const pier of piers) {
    assert.equal(pier.pool.kind, "dlmm");
    assert.ok(pier.sol.mint === SOL);
    assert.ok(pier.other.mint === USDC || pier.lst);
  }
  // SOL-HYPE, TRUMP-USDC and the DAMM v2 SOL-USDC pool are not piers.
  assert.ok(!piers.some((p) => /HYPE|TRUMP/.test(p.pool.pair)));
  assert.equal(pierOf({ ...lstPool(), kind: "damm-v2", binStepBps: null }), null);
});

test("a pier knows which side is SOL and what the other coin is worth in SOL", () => {
  const lst = pierOf(lstPool());
  assert.equal(lst.pair, "lst");
  assert.equal(lst.solSide, "y");
  assert.equal(lst.lst.id, "jitosol");
  assert.equal(otherInSol(lst), 1.2603);
  const usdc = pierOf(SOL_USDC);
  assert.equal(usdc.pair, "usdc");
  assert.equal(usdc.solSide, "x");
  assert.ok(Math.abs(otherInSol(usdc) - 1 / SOL_USDC.price) < 1e-12);
});

test("fees and depth are said in SOL at the venue's own SOL price", () => {
  const pier = pierOf(lstPool());
  const solUsd = pier.sol.priceUsd;
  assert.ok(Math.abs(feesSol24h(pier) - 864.5 / solUsd) < 1e-9);
  assert.ok(Math.abs(depthSol(pier) - 12_400_000 / solUsd) < 1e-6);
  assert.equal(feesSol24h(pierOf(lstPool({ lpFees24hUsd: null }))), null);
});

test("the three styles narrow the range around the price", () => {
  const pier = pierOf(lstPool());
  const calm = pierRange(pier, "calm");
  const balanced = pierRange(pier, "balanced");
  const dense = pierRange(pier, "dense");
  assert.equal(calm.half, 34);
  assert.ok(calm.upPct > balanced.upPct && balanced.upPct > dense.upPct);
  assert.ok(calm.low < pier.pool.price && calm.high > pier.pool.price);
  // One-basis-point bins: 34 bins reach about a third of a per cent.
  assert.ok(Math.abs(calm.upPct - 0.34) < 0.01);
  assert.ok(STYLE_HALF.dense < STYLE_HALF.balanced);
});

test("an amount of SOL goes in as half SOL and half the other coin, never rounded up", () => {
  const pier = pierOf(lstPool());
  const split = pierSplit(pier, 1_000_000_000n);
  assert.equal(split.solLamports, 500_000_000n);
  assert.equal(split.y, "500000000");
  // 0.5 SOL of JitoSOL at 1.2603 SOL each.
  assert.equal(split.x, String(Math.floor((0.5 / 1.2603) * 1e9)));
  const usdc = pierOf(SOL_USDC);
  const s2 = pierSplit(usdc, 2_000_000_000n);
  assert.equal(s2.x, "1000000000");
  assert.equal(BigInt(s2.y), BigInt(Math.floor(SOL_USDC.price * 1e6)));
  assert.equal(pierSplit(pier, 0n), null);
});

test("a Zap needs SOL only: what goes in and the SOL kept aside", () => {
  assert.equal(zapFit(1_000_000_000n, null), true, "a wallet not read yet fits; the engine has the last word");
  assert.equal(zapFit(1_000_000_000n, holdings(5e9)), true, "no other coin is needed");
  assert.equal(zapFit(1_000_000_000n, holdings(1_000_000_000n + PIER_RESERVE_LAMPORTS)), true);
  assert.equal(zapFit(1_000_000_000n, holdings(1_000_000_000n + PIER_RESERVE_LAMPORTS - 1n)), false);
  assert.equal(zapMax(holdings(3_000_000_000)), 3_000_000_000n - PIER_RESERVE_LAMPORTS);
  assert.equal(zapMax(holdings(10_000)), 0n);
  assert.equal(zapMax(null), null);
});

test("costs and the minimum come from the Review", () => {
  const costs = pierCosts(addReview());
  assert.equal(costs.rent, 128_000_000n);
  assert.equal(costs.rentBack, 57_000_000n);
  assert.equal(costs.network, 10_000n);
  assert.equal(costs.lost, 71_010_000n);
  // What never comes back stays within a twentieth: 0.0710 SOL lost → at least 1.42 SOL.
  assert.equal(pierMinimum(costs), 1_420_200_000n);
  assert.equal(pierMinimum(null), PIER_MIN_LAMPORTS);
  const cheap = pierCosts(addReview({ preview: { ...addReview().preview, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }] } }));
  assert.equal(pierMinimum(cheap), PIER_MIN_LAMPORTS);
});

test("the Zap asks the engine for the SOL and the style's bins around the price; the rest keeps what the wallet held", () => {
  const pier = pierOf(lstPool());
  const body = pierZapBody(pier, OWNER, 1_000_000_000n, "dense");
  assert.deepEqual(body, { action: "zap_in", venue: "meteora-dlmm", request: { pool: pier.pool.address, owner: OWNER, amountIn: "1000000000", half: STYLE_HALF.dense, slippageBps: 100 } });
  assert.deepEqual(pierRestBody(pier.pool.address, OWNER, "42").request, { pool: pier.pool.address, owner: OWNER, otherBefore: "42" });
});

test("a Zap's figures: what goes in, the swap and its floor, Ryntra's fee on Jupiter only, one approval", () => {
  const pier = pierOf(lstPool());
  const figures = zapFigures(zapReview(), pier);
  assert.deepEqual(figures.amounts, ["0.3963 JitoSOL", "0.5 SOL"]);
  assert.equal(figures.route, "jupiter");
  assert.equal(figures.labels, "Meteora DLMM → Sanctum");
  assert.equal(figures.swapInSol, "0.5 SOL");
  assert.equal(figures.swapFloor, "0.3943 JitoSOL");
  assert.equal(figures.feePct, "0.1%");
  assert.equal(figures.feeSol, "0.0005");
  assert.equal(figures.transactions, 2);
  assert.equal(figures.rentBack, true);
  const pool = zapFigures(zapReview({}, { route: "pool" }), pier);
  assert.equal(pool.feePct, null, "the pool's own swap carries no Ryntra fee");
  assert.equal(zapFeePct(zapReview({}, { route: "pool" })), null);
  const rest = zapFigures(zapReview({}, { rest: true }), pier);
  assert.equal(rest.backSol, solShort(502_039_280n + 495_500_000n + 1_280_000n), "the wrapped SOL, the swap's least and the ledger's deposit");
  assert.deepEqual(rest.amounts, []);
  assert.equal(pierCosts(zapReview()).network, 40_000n);
});

test("SOL figures read short", () => {
  assert.equal(solShort(1_234_567_890n), "1.235");
  assert.equal(solShort(50_000_000n), "0.05");
  assert.equal(solShort(-0.00213), "−0.00213");
  assert.equal(solShort(null), "—");
});

test("a range keeps the places that tell its two prices apart", () => {
  assert.deepEqual(rangePrices(1.25829, 1.26232), { low: "1.2583", high: "1.2623" });
  assert.deepEqual(rangePrices(181.234, 186.91), { low: "181.23", high: "186.91" });
  assert.deepEqual(rangePrices(1.26025, 1.26035), { low: "1.26025", high: "1.26035" });
  assert.equal(unitsShort(1_586_923_748n, 9), "1.587");
});

test("a goal is a shape the engine builds, and even stays the body it always was (CITY-210)", async () => {
  const { GOAL_SHAPE, PIER_GOALS, defaultGoal, pierZapBody } = await import("./pier.ts");
  const { LIQUIDITY_SHAPES } = await import("../../../lib/liquidity/studio/contract.ts");
  for (const goal of PIER_GOALS) assert.ok(LIQUIDITY_SHAPES.includes(GOAL_SHAPE[goal]));
  assert.equal(new Set(PIER_GOALS.map((goal) => GOAL_SHAPE[goal])).size, PIER_GOALS.length);
  assert.equal(defaultGoal("lst"), "near");
  assert.equal(defaultGoal("usdc"), "even");
  const pier = { pool: { address: "pool" } };
  assert.equal("shape" in pierZapBody(pier, "owner", 1n, "balanced").request, false);
  assert.equal("shape" in pierZapBody(pier, "owner", 1n, "balanced", "even").request, false);
  assert.equal(pierZapBody(pier, "owner", 1n, "balanced", "near").request.shape, "curve");
  assert.equal(pierZapBody(pier, "owner", 1n, "balanced", "edges").request.shape, "bid_ask");
});
