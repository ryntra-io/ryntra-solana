import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { DEPTH_BANDS, depthLines, dollarEdges, hasEdges, poolOfCoin, positionLines } = await import("./pool-layer.ts");
const { linesOf, setLayer, useChartLayer } = await import("./chart-layer.ts");

/* The pool over a coin's chart: which pool is a coin's, its liquidity as strips at the chart's prices, and
   the edges of the wallet's own positions as lines — through the same layer the ticket's ladder draws on. */

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const pool = (address, x, y, tvlUsd, over = {}) => ({ kind: "dlmm", address, x: { mint: x, symbol: "X", verified: true }, y: { mint: y, symbol: "Y", verified: true }, tvlUsd, volume24hUsd: 1, fees24hUsd: 1, feeTvl24hPct: 1, baseFeePct: 0.04, feePct: 0.04, binStepBps: 4, createdAt: null, page: "https://app.meteora.ag/dlmm/x", ...over });

/** SOL against USDC at 150, step 4 bps: 300 USDC on every bin under the price, 2 SOL on every bin over it. */
function answer(half = 40) {
  const bins = [];
  for (let offset = -half; offset <= half; offset += 1) bins.push({ offset, id: offset, price: 150 * 1.0004 ** offset, x: offset >= 0 ? "2000000000" : "0", y: offset <= 0 ? "300000000" : "0" });
  return { venue: "dlmm", pool: "P", x: { mint: SOL, decimals: 9 }, y: { mint: USDC, decimals: 6 }, stepBps: 4, activeId: 0, price: 150, bins, market: { price: null, gapPct: null }, rent: null, at: "2026-11-17T09:00:00.000Z" };
}

test("a coin's pool, for a chart in dollars: the deepest DLMM pool against a dollar; else, for a coin that is not SOL, against SOL", () => {
  const LST = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
  const pools = [
    pool("A", SOL, USDC, 5_000_000),
    pool("B", SOL, USDC, 9_000_000),
    pool("C", JUP, SOL, 20_000_000),
    pool("D", SOL, USDC, 50_000_000, { kind: "damm-v2" }),
    pool("E", SOL, USDC, 60_000_000, { x: { mint: SOL, symbol: "SOL", verified: false } }),
    pool("F", LST, SOL, 90_000_000),
    pool("G", JUP, USDC, 1_000_000),
  ];
  assert.deepEqual([poolOfCoin(pools, SOL).pool.address, poolOfCoin(pools, SOL).side], ["B", "x"], "a staked SOL against SOL says nothing of SOL's dollar price");
  assert.deepEqual([poolOfCoin(pools, USDC).pool.address, poolOfCoin(pools, USDC).side], ["B", "y"]);
  assert.deepEqual([poolOfCoin(pools, JUP).pool.address, poolOfCoin(pools, JUP).side], ["G", "x"], "a dollar pool before a deeper pool against SOL");
  assert.deepEqual([poolOfCoin(pools.filter((entry) => entry.address !== "G"), JUP).pool.address], ["C"]);
  assert.deepEqual([poolOfCoin(pools, LST).pool.address, poolOfCoin(pools, LST).side], ["F", "x"]);
  assert.equal(poolOfCoin([pool("F", LST, SOL, 90_000_000)], SOL), null);
  assert.equal(poolOfCoin(pools, "none"), null);
  assert.equal(poolOfCoin([], SOL), null);
});

test("the pool's liquidity as strips: its bins gathered into bands at the chart's prices, each as long as what lies on it", () => {
  const lines = depthLines(answer(), "x", 152);
  assert.ok(lines.length > 0 && lines.length <= DEPTH_BANDS, String(lines.length));
  assert.ok(lines.every((line) => line.tone === "depth" && line.tag === null && line.weight > 0 && line.weight <= 1));
  assert.equal(Math.max(...lines.map((line) => line.weight)), 1);
  /* The chart's dollars: a bin 1 % over the pool's price stands 1 % over the coin's dollar price. */
  const prices = lines.map((line) => line.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.ok(prices[0] > 152 * 1.0004 ** -41 && prices.at(-1) < 152 * 1.0004 ** 41);
  assert.equal(new Set(lines.map((line) => line.id)).size, lines.length);
  /* The other coin's chart reads the same pool turned over: a higher pool price is a lower price of the second coin. */
  const turned = depthLines(answer(), "y", 1);
  assert.equal(turned.length, lines.length);
  assert.ok(turned[0].price > turned.at(-1).price);
  assert.ok(Math.abs(turned[0].price - 1.0004 ** 38) < 0.01);
  /* Nothing is drawn without the coin's dollar price, or on a pool nothing lies in. */
  assert.deepEqual(depthLines(answer(), "x", null), []);
  const empty = answer();
  assert.deepEqual(depthLines({ ...empty, bins: empty.bins.map((bin) => ({ ...bin, x: "0", y: "0" })) }, "x", 152), []);
  assert.equal(depthLines(answer(3), "x", 152).length, 7, "a few bins are each their own band");
});

test("the edges of the wallet's positions: drawn only where the pool prices the coin in dollars, as those very prices", () => {
  const LST = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
  const view = (address, x, y, lower, upper, price = null) => ({ address, pool: "P", x: { mint: x }, y: { mint: y }, lower, upper, price });
  const tag = (usd) => usd.toFixed(2);
  const views = [view("one", SOL, USDC, 141, 159, 150), view("curve", SOL, USDC, null, null, 150), view("other", JUP, USDC, 1, 2, 1.5), view("lst", LST, SOL, 1.2584, 1.2622, 1.2603), view("old", SOL, USDC, 120, 130)];
  /* The pool's price of a year ago, or none at all, moves nothing: an edge in dollars is the dollar price itself. */
  assert.deepEqual(positionLines(views, SOL, tag).map((line) => [line.id, line.tone, line.tag, line.price]), [
    ["position:one:low", "held", "141.00", 141],
    ["position:one:high", "held", "159.00", 159],
    ["position:old:low", "held", "120.00", 120],
    ["position:old:high", "held", "130.00", 130],
  ]);
  assert.ok(positionLines(views, SOL, tag).every((line) => line.weight === undefined));
  /* A staked SOL against SOL says nothing of a dollar price: no line on SOL's chart, none on the staked coin's. */
  assert.equal(dollarEdges(view("lst", LST, SOL, 1.2584, 1.2622), SOL), null);
  assert.equal(dollarEdges(view("lst", LST, SOL, 1.2584, 1.2622), LST), null);
  assert.deepEqual(positionLines([view("lst", LST, SOL, 1.2584, 1.2622)], SOL, tag), []);
  /* The dollar's own chart is not the place for a SOL position's edges; a pool with the dollar first turns over. */
  assert.equal(dollarEdges(view("one", SOL, USDC, 141, 159), USDC), null);
  assert.deepEqual(dollarEdges(view("turned", USDC, JUP, 0.5, 2), JUP), { low: 0.5, high: 2 });
  /* The switch stands for a position only when it has edges to draw. */
  assert.deepEqual([hasEdges(views[0], SOL), hasEdges(views[1], SOL), hasEdges(views[2], SOL), hasEdges(views[3], SOL)], [true, false, false, false]);
});

test("the strips and the edges stand on the chart beside the ladder, each in its own slot", () => {
  useChartLayer.setState({ mint: null, slots: {} });
  setLayer(SOL, "ladder", { lines: [{ id: "ladder:0", price: 140, tone: "draft", tag: "140" }], badge: "Ladder · 1" });
  setLayer(SOL, "liquidity", { lines: depthLines(answer(3), "x", 152), badge: null });
  setLayer(SOL, "positions", { lines: [{ id: "position:one:low", price: 143, tone: "held", tag: "143" }], badge: null });
  const ids = linesOf(useChartLayer.getState(), SOL).map((line) => line.id);
  assert.equal(ids[0], "ladder:0");
  assert.equal(ids[1], "position:one:low");
  assert.equal(ids.length, 9);
  setLayer(SOL, "liquidity", null);
  assert.equal(linesOf(useChartLayer.getState(), SOL).length, 2);
});

test("the chart draws a weighted line as a strip by the scale, never as a rule across the plot or a tag", () => {
  const source = readFileSync(new URL("./CoinChart.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(line\.weight !== undefined\) \{[\s\S]*?var\(--plot-left\) \+ var\(--plot-width\) - \$\{long\}px[\s\S]*?continue;/);
  assert.match(source, /depth: 'var\(--lilac\)'/);
});
