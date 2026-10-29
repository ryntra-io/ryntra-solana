// Run from repo root: node --test app/solana/workspace/spot/limit-orders-view.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isOpenLimit, limitFillMarkers, limitOrderBaseAmount, limitOrderLines, limitOrderPrice, openLimitCount } from "./limit-orders-view.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const tokens = { [SOL]: { symbol: "SOL", decimals: 9 }, [USDC]: { symbol: "USDC", decimals: 6 }, [JUP]: { symbol: "JUP", decimals: 6 } };

function order(overrides = {}) {
  return {
    key: "mainnet:w:trigger:o1",
    venue: "trigger",
    order: "o1",
    side: "buy",
    baseMint: SOL,
    quoteMint: USDC,
    inputMint: USDC,
    outputMint: SOL,
    makingRaw: "5200000",
    takingRaw: "48941177",
    filledInputRaw: "0",
    filledOutputRaw: "0",
    ryntraFeeRaw: "0",
    ryntraBps: 10,
    fillPrice: null,
    state: "OPEN",
    placeSignature: null,
    cancelSignature: null,
    fills: [],
    createdAt: "2026-10-16T08:09:37Z",
    updatedAt: "2026-10-16T08:09:37Z",
    throughRyntra: true,
    canCancel: true,
    canClaim: false,
    pool: null,
    ...overrides,
  };
}

test("an order's price is its reviewed fill price, else its two amounts' ratio", () => {
  assert.equal(limitOrderPrice(order({ fillPrice: 106.14 }), tokens), 106.14);
  assert.equal(Math.round(limitOrderPrice(order(), tokens) * 100) / 100, 106.25);
  const sell = order({ side: "sell", inputMint: SOL, outputMint: USDC, makingRaw: "100000000", takingRaw: "11000000" });
  assert.equal(Math.round(limitOrderPrice(sell, tokens) * 100) / 100, 110);
  assert.equal(limitOrderPrice(order({ baseMint: "unknown" }), tokens), null);
  /* SOL and the dollars are priced without the catalogue. */
  assert.equal(Math.round(limitOrderPrice(order(), {}) * 100) / 100, 106.25);
  assert.equal(Math.round(limitOrderBaseAmount(order(), tokens) * 1e6) / 1e6, 0.048941);
});

test("only waiting orders count and draw, each market its own", () => {
  const orders = [order(), order({ key: "b", state: "FILLED" }), order({ key: "c", state: "CANCELLED" }), order({ key: "d", baseMint: JUP })];
  assert.equal(openLimitCount(orders), 2);
  assert.equal(openLimitCount(orders, SOL), 1);
  assert.equal(isOpenLimit({ state: "CANCELLING" }), true);
  assert.equal(isOpenLimit({ state: "EXPIRED" }), false);
});

test("an open order is a dashed line at its price in dollars, coloured by side, scaled for the capitalisation", () => {
  const lines = limitOrderLines({
    orders: [order({ fillPrice: 106.14 }), order({ key: "s", side: "sell", fillPrice: 120 }), order({ key: "f", state: "FILLED", fillPrice: 100 })],
    tokens,
    baseMint: SOL,
    quoteUsd: (mint) => (mint === USDC ? 1 : null),
    capFactor: null,
    label: (o, amount) => `${o.side} ${amount?.toFixed(4)}`,
  });
  assert.deepEqual(lines.map((line) => [line.price, line.color, line.style]), [[106.14, "up", "dashed"], [120, "down", "dashed"]]);
  assert.equal(lines[0].title, "buy 0.0489");
  const cap = limitOrderLines({ orders: [order({ fillPrice: 100 })], tokens, baseMint: SOL, quoteUsd: () => 1, capFactor: 1000, label: () => "" });
  assert.equal(cap[0].price, 100_000);
});

test("an order priced in an asset whose dollar price is unknown draws no line rather than a wrong one", () => {
  const lines = limitOrderLines({ orders: [order({ quoteMint: SOL, fillPrice: 0.01 })], tokens, baseMint: SOL, quoteUsd: () => null, capFactor: null, label: () => "" });
  assert.deepEqual(lines, []);
});

test("a fill is a mark on its candle, below for a buy and above for a sale", () => {
  const filled = order({ state: "FILLED", fills: [{ signature: "s", inputRaw: "1", outputRaw: "2", feeRaw: "0", at: "2026-10-16T08:13:01Z" }] });
  const sold = order({ key: "x", side: "sell", fills: [{ signature: "t", inputRaw: "1", outputRaw: "2", feeRaw: "0", at: "2026-10-16T09:00:00Z" }] });
  const marks = limitFillMarkers([filled, sold, order({ key: "y", baseMint: JUP, fills: filled.fills })], SOL, "Limit");
  assert.deepEqual(marks.map((m) => [m.time, m.position, m.color]), [[Date.parse("2026-10-16T08:13:01Z") / 1000, "belowBar", "up"], [Date.parse("2026-10-16T09:00:00Z") / 1000, "aboveBar", "down"]]);
});

test("the workspace reads the orders once and hands them to the chart, the ticket and «My orders»", () => {
  const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
  const workspace = read("./spot-workspace.tsx");
  assert.match(workspace, /useLimitOrders\(owner, generation\)/);
  assert.match(workspace, /<SpotChart[^>]*limits=\{limits\}/);
  /* B16: the open orders' count stands on the account's «Ордери» panel. */
  assert.match(workspace, /const ordersCount = openLimitCount\(limits\.orders\);/);
  assert.match(workspace, /orders: \{ title: `\$\{text\("Orders"\)\}\$\{ordersCount > 0 \? ` · \$\{ordersCount\}` : ""\}`/);
  assert.match(workspace, /<TradingState[^>]*limits=\{limits\}/);
  /* On the core's chart (CH-17) the open limits are levels and the filled ones marks, both in the chart's `marks`. */
  assert.match(read("./spot-chart.tsx"), /levels\.push\(\{ id: line\.id, kind: "level"/);
  assert.match(read("./spot-chart.tsx"), /marks=\{chartMarks\}/);
  assert.doesNotMatch(read("./my-orders.tsx"), /readLimitOrders/);
});
