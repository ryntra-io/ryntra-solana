import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The ladders' window switch, as a stand sets it: read when the store loads, so set before it does.
process.env.NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS = "devnet";
const { useLadder, setLadderEnv } = await import("../../../city/lib/trade/pro-store.ts");
const { badgeOf, decimalOf, inChart, linesOf, setLayer, useChartLayer } = await import("../chart-layer.ts");
const { bpsOfPercent, depositSol, ladderLines, orderRow, percentField, priceAt, shapeOf, signedPercent } = await import("./ladder-view.ts");
const { fillLadder, setLimitTab, useLimitTab } = await import("./tab.ts");

/* The ticket's Limit tab: the per cent the person types, the ladder over the chart, the orders as rows — and the words
   the tab says before a signature. Every figure is the engine's; these only check how the screen puts them. */

test("the distance reads as a per cent both ways: typed with a comma or a point, a sign ignored, nothing for none", () => {
  assert.equal(bpsOfPercent("4"), 400);
  assert.equal(bpsOfPercent("4,5"), 450);
  assert.equal(bpsOfPercent("−12.25 %"), 1225);
  assert.equal(bpsOfPercent("+150"), 15_000);
  for (const text of ["", "0", "abc", "1.234", "4.5.6"]) assert.equal(bpsOfPercent(text), null, text);
  assert.equal(percentField(400), "4");
  assert.equal(percentField(1225), "12.25");
  assert.equal(signedPercent(400, "buy"), "−4%");
  assert.equal(signedPercent(15_000, "sell"), "+150%");
});

test("one price is one rung; anything else is a ladder", () => {
  assert.equal(shapeOf(1), "one");
  assert.equal(shapeOf(8), "ladder");
  assert.equal(shapeOf(null), "ladder");
});

test("the farthest price before a quote: below the price for a buy, above it for a sale", () => {
  assert.equal(priceAt({ price: 100 }, 400, "buy"), 96);
  assert.equal(priceAt({ price: 100 }, 15_000, "sell"), 250);
});

test("a ladder in another coin stands on the chart in dollars, against the coin's price on both sides now", () => {
  // A coin at 0.5 SOL and at $80: a rung at 0.45 SOL is $72.
  assert.equal(inChart(0.45, 0.5, 80), 72);
  assert.equal(inChart(0.45, 0.5, null), null);
  assert.equal(inChart(0, 0.5, 80), null);
  const quote = { market: { price: 0.5 }, rungs: [0.48, 0.47, 0.46, 0.45].map((price, at) => ({ awayBps: 400 + at * 100, price, amountRaw: "1", paysRaw: "1" })) };
  const lines = ladderLines(quote, 80, (usd) => `$${usd.toFixed(2)}`);
  assert.deepEqual(
    lines.map((line) => [line.id, Math.round(line.price * 100) / 100, line.tone, line.tag]),
    [
      ["ladder:0", 76.8, "draft", "$76.80"],
      ["ladder:1", 75.2, "draft", null],
      ["ladder:2", 73.6, "draft", null],
      ["ladder:3", 72, "draft", "$72.00"],
    ],
  );
  assert.deepEqual(ladderLines(quote, null, String), [], "no dollar price — no lines, never lines in the wrong place");
});

test("a level's price is a plain decimal the chart takes, however small the coin", () => {
  assert.equal(decimalOf(72.381234), "72.3812");
  assert.equal(decimalOf(0.0000234567891), "0.0000234568");
  assert.equal(decimalOf(0), null);
  assert.equal(decimalOf(Number.NaN), null);
});

test("each part writes its own slot over the chart; another coin starts clean", () => {
  setLayer("A", "ladder", { lines: [{ id: "ladder:0", price: 1, tone: "draft", tag: "1" }], badge: "Ladder · 1" });
  setLayer("A", "positions", { lines: [{ id: "pos:0", price: 2, tone: "held", tag: null }], badge: null });
  let state = useChartLayer.getState();
  assert.deepEqual(linesOf(state, "A").map((line) => line.id), ["ladder:0", "pos:0"]);
  assert.equal(badgeOf(state, "A"), "Ladder · 1");
  assert.deepEqual(linesOf(state, "B"), []);
  setLayer("A", "ladder", null);
  state = useChartLayer.getState();
  assert.deepEqual(linesOf(state, "A").map((line) => line.id), ["pos:0"], "clearing the ladder leaves the positions");
  assert.equal(badgeOf(state, "A"), null);
  setLayer("B", "ladder", { lines: [{ id: "ladder:0", price: 3, tone: "draft", tag: null }], badge: null });
  assert.deepEqual(linesOf(useChartLayer.getState(), "A"), [], "a new coin drops the old one's lines");
});

test("the order's deposit before the Review: the program's rent for an order and each of its prices", () => {
  assert.equal(depositSol(8).toFixed(3), "0.014");
  assert.equal(depositSol(1).toFixed(4), "0.0071");
});

const ORDER = {
  nftMint: "N1",
  pool: "P",
  coin: { mint: "C", decimals: 6 },
  quote: { mint: "Q", decimals: 6 },
  action: "buy",
  state: "resting",
  prices: 8,
  filledPrices: 0,
  restsIn: "Q",
  paysIn: "C",
  restsRaw: "100000000",
  filledRaw: "0",
  proceedsRaw: "0",
  lowPrice: 69.83,
  highPrice: 72.38,
  filledPrice: null,
  bonus: { mint: "Q", ownerRaw: "0", referralRaw: "0" },
  agent: true,
  agentReady: true,
  agentOffered: true,
  partialPrices: 0,
};

test("an order as its row: a buy reaches down from the nearest price, and only what can be done is offered", () => {
  const row = orderRow(ORDER);
  assert.deepEqual([row.kind, row.side, row.filled, row.of, row.from, row.to, row.inQuote, row.agent, row.actions], ["ladder", "buy", 0, 8, 72.38, 69.83, true, "collects", ["cancel"]]);
  const sale = orderRow({ ...ORDER, action: "sell", prices: 1, restsIn: "C", lowPrice: 150, highPrice: 150, filledPrices: 0, agent: false });
  assert.deepEqual([sale.kind, sale.from, sale.to, sale.inQuote, sale.agent], ["one", 150, 150, false, null]);
  assert.deepEqual(orderRow({ ...ORDER, filledPrices: 3, state: "filling" }).actions, ["take", "cancel"]);
  assert.deepEqual(orderRow({ ...ORDER, state: "taken", action: null }).actions, ["deposit"]);
  assert.deepEqual(orderRow({ ...ORDER, agentReady: false }).actions, ["cancel", "resume"], "a paused agent can be let back in");
  assert.deepEqual(orderRow({ ...ORDER, agentReady: false, agentOffered: false }).actions, ["cancel"]);
});

test("a sentence's ladder brings the Limit tab forward and waits for the coin's market", async () => {
  const COIN = { mint: "Coin111111111111111111111111111111111111111", symbol: "BONK", name: "Bonk", icon: null };
  let release;
  const marketRead = new Promise((resolve) => (release = resolve));
  setLadderEnv({
    engine: {
      market: async () => {
        await marketRead;
        return { ok: true, value: { network: "devnet", pool: "P", coin: { mint: COIN.mint, decimals: 5 }, quote: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }, price: 0.0000001, bonus: { feeBps: 100, ownerBps: 40, referralBps: 10 }, reach: { buyBps: 9_900, sellBps: 990_000 }, placing: true, collector: null, cap: { maxRaw: null, minRungRaw: "2000000" } } };
      },
      quote: async () => ({ ok: false, failure: { code: "UNAVAILABLE", message: "" } }),
      review: async () => ({ ok: false, failure: { code: "UNAVAILABLE", message: "" } }),
      submit: async () => ({ ok: false, failure: { code: "UNAVAILABLE", message: "" } }),
      orders: async () => ({ ok: true, value: [] }),
    },
    sign: async () => null,
    refreshHoldings: () => {},
    quoteDelayMs: 0,
  });
  setLimitTab(COIN.mint, false);
  useLadder.getState().open({ mint: COIN.mint, symbol: COIN.symbol });
  fillLadder(COIN.mint, { said: "sell BONK at 2x", action: "sell", coin: COIN, farBps: 10_000, rungs: 1, amount: "4000", pay: null, share: null });
  const tab = useLimitTab.getState();
  assert.deepEqual([tab.mint, tab.on], [COIN.mint, true]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = useLadder.getState();
  assert.deepEqual([state.action, state.farBps, state.rungs, state.typed], ["sell", 10_000, 1, "4000"]);
  setLadderEnv(null);
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the tab says Ryntra's part and the deposit in one line before the signature, and its terms behind «i»", () => {
  const ticket = read("./LadderTicket.tsx");
  assert.match(ticket, /w\.fee\(pct\(bonus\.referralBps, lang\), deposit\)/, "Ryntra's part of what fills, one line");
  assert.match(ticket, /<ExplainButton label=\{w\.details\}/, "the rest behind «i»");
  for (const row of ["w.dCorridor", "w.dCap", "w.dExact", "w.dDeposit"]) assert.ok(ticket.includes(row), `${row} is behind «i»`);
  assert.equal((ticket.match(/<Action\b/g) ?? []).length, 2, "one amber press on the fields, one after the order is placed");
});
