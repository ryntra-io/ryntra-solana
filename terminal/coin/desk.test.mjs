import assert from "node:assert/strict";
import test from "node:test";

import { CHART_MIN_H, CHART_MIN_W, DESK_EMPTY, DESK_FOLDED_COL, DESK_FOLDED_ROW, DESK_GUTTER, DESK_LIMITS, deskAtPointer, deskByKey, deskClamp, deskDefault, deskGrid, deskWide, readDeskMemory } from "./desk-rules.ts";
import { agoOf, bigTrades, buyShareOf, depthBook, holdersSplit, mergeTape, shortAddress, tradersOf } from "./tape-view.ts";

/* The coin's desk: its measures and the market it lays out, held as they are written. */

// The desk on a 1920 window (rail 228, body gutters 56) and on a 1440 one.
const W1920 = 1636;
const W1440 = 1156;

test("the defaults follow the room: the trades column and the ticket wider on a wider desk, the chart keeps the most", () => {
  assert.equal(deskDefault("tape", W1920, 900), 300);
  assert.equal(deskDefault("ticket", W1920, 900), 380);
  assert.equal(deskDefault("tape", W1440, 730), 252);
  assert.equal(deskDefault("ticket", W1440, 730), 340);
  const grid = deskGrid(DESK_EMPTY, W1920, 900);
  const chart = W1920 - grid.tape - grid.ticket - 2 * DESK_GUTTER;
  assert.ok(chart >= 900, `the chart on a 1920 desk is ${chart} px wide`);
  const small = deskGrid(DESK_EMPTY, W1440, 730);
  assert.ok(W1440 - small.tape - small.ticket - 2 * DESK_GUTTER >= 540, "the chart on a 1440 desk keeps more than half the desk");
  assert.ok(730 - small.bottom - DESK_GUTTER >= CHART_MIN_H + 200, "the bottom panel leaves the chart the height");
});

test("a dragged measure is held between its least and what leaves the chart its least", () => {
  assert.equal(deskClamp("tape", 10, W1920, 900, 380), DESK_LIMITS.tape.min);
  assert.equal(deskClamp("tape", 5_000, W1920, 900, 380), DESK_LIMITS.tape.max);
  // A narrow desk: the ticket at its most still leaves the chart its least.
  const ticket = deskClamp("ticket", 5_000, 1100, 800, 300);
  assert.ok(1100 - ticket - 300 - 2 * DESK_GUTTER >= CHART_MIN_W);
  assert.equal(deskClamp("bottom", 5_000, W1920, 700, 0), 700 - DESK_GUTTER - CHART_MIN_H);
  assert.equal(deskClamp("ticket", null, W1440, 730, 252), 340, "no measure of the person's — the default");
});

test("the pointer and the keys move a measure the way the eye expects", () => {
  // A column to the right of its handle widens as the pointer goes left.
  assert.equal(deskAtPointer("ticket", 1500, 1900), 396);
  assert.equal(deskAtPointer("ticket", 1400, 1900), 496);
  assert.equal(deskAtPointer("bottom", 800, 1040), 236);
  assert.equal(deskByKey("ArrowLeft", 300, 220, 460), 316);
  assert.equal(deskByKey("ArrowDown", 300, 220, 460), 284);
  assert.equal(deskByKey("Home", 300, 220, 460), 220);
  assert.equal(deskByKey("End", 300, 220, 460), 460);
  assert.equal(deskByKey("a", 300, 220, 460), null);
});

test("what the browser kept is read back only as measures of ours; anything else is the default", () => {
  assert.deepEqual(readDeskMemory(null), DESK_EMPTY);
  assert.deepEqual(readDeskMemory("{oops"), DESK_EMPTY);
  assert.deepEqual(readDeskMemory(JSON.stringify({ tape: 280, ticket: 9_999, bottom: "x", folded: { tape: true, bottom: 1 } })), { tape: 280, ticket: null, bottom: null, folded: { tape: true, ticket: false, bottom: false } });
});

test("a folded part keeps its strip, and a narrow desk has no trades column", () => {
  const folded = deskGrid({ ...DESK_EMPTY, folded: { tape: true, ticket: false, bottom: true } }, W1920, 900);
  assert.equal(folded.tape, DESK_FOLDED_COL);
  assert.equal(folded.bottom, DESK_FOLDED_ROW);
  assert.equal(deskWide(1000), false);
  assert.equal(deskGrid(DESK_EMPTY, 1000, 800).tape, 0);
});

const trade = (signature, at, side, usd, wallet = "W1", price = 100) => ({ signature, at, side, wallet, tokenAmount: usd / price, usd, priceUsd: price, capUsd: null });

test("a fresh read lays over the trades on screen: newest first, each once, the new ones lit", () => {
  const first = mergeTape([], [trade("b", "2026-11-18T00:00:02Z", "buy", 10), trade("a", "2026-11-18T00:00:01Z", "sell", 5)]);
  assert.deepEqual(first.trades.map((t) => t.signature), ["b", "a"]);
  assert.equal(first.fresh.size, 0, "a first read lights nothing");
  const next = mergeTape(first.trades, [trade("c", "2026-11-18T00:00:03Z", "buy", 7), trade("b", "2026-11-18T00:00:02Z", "buy", 10)]);
  assert.deepEqual(next.trades.map((t) => t.signature), ["c", "b", "a"]);
  assert.deepEqual([...next.fresh], ["c"]);
});

test("the traders of the read: dollars bought and sold by wallet, the most traded first; the buyers' share", () => {
  const trades = [trade("1", "2026-11-18T00:00:01Z", "buy", 100, "A"), trade("2", "2026-11-18T00:00:02Z", "sell", 40, "A"), trade("3", "2026-11-18T00:00:03Z", "buy", 500, "B")];
  const traders = tradersOf(trades);
  assert.deepEqual(traders.map((t) => [t.wallet, t.bought, t.sold, t.net, t.trades]), [["B", 500, 0, 500, 1], ["A", 100, 40, 60, 2]]);
  assert.equal(buyShareOf(trades), 600 / 640);
  assert.equal(buyShareOf([]), null);
});

test("the largest trades past the floor are the candles' marks, five at most, oldest first", () => {
  const trades = Array.from({ length: 8 }, (_, i) => trade(`s${i}`, `2026-11-18T00:00:0${i}Z`, i % 2 ? "sell" : "buy", 1_000 + i * 100));
  trades.push(trade("small", "2026-11-18T00:00:09Z", "buy", 999));
  const marks = bigTrades(trades);
  assert.equal(marks.length, 5);
  assert.deepEqual(marks.map((m) => m.id), ["trade:s3:sell", "trade:s4:buy", "trade:s5:sell", "trade:s6:buy", "trade:s7:sell"]);
  assert.equal(marks[0].price, 100);
});

test("a wallet short, an age short, the programs' holdings apart from the people's", () => {
  assert.equal(shortAddress("MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa"), "MfDu…GVWa");
  const now = Date.parse("2026-11-18T01:00:00Z");
  assert.deepEqual(agoOf("2026-11-18T00:59:48Z", now), { unit: "s", n: 12 });
  assert.deepEqual(agoOf("2026-11-18T00:56:00Z", now), { unit: "m", n: 4 });
  assert.deepEqual(agoOf("2026-11-17T21:00:00Z", now), { unit: "h", n: 4 });
  assert.equal(agoOf("not a time", now), null);
  const split = holdersSplit([{ owner: "P", amount: 1, sharePct: 20, labels: ["program"], change: null, trades: 0 }, { owner: "H", amount: 1, sharePct: 2, labels: [], change: null, trades: 0 }]);
  assert.deepEqual([split.programs.map((h) => h.owner), split.people.map((h) => h.owner)], [["P"], ["H"]]);
});

test("the pool's bins as a book in dollars: asks above the price, bids under it, totals outwards", () => {
  // SOL (X, 9 decimals) against USDC (Y, 6 decimals) at 150 USDC a SOL; the coin is SOL at $150.
  const bins = [
    { offset: -2, id: 98, price: 149, x: "0", y: "300000000" },
    { offset: -1, id: 99, price: 149.5, x: "0", y: "100000000" },
    { offset: 0, id: 100, price: 150, x: "1000000000", y: "150000000" },
    { offset: 1, id: 101, price: 150.5, x: "2000000000", y: "0" },
    { offset: 2, id: 102, price: 151, x: "1000000000", y: "0" },
  ];
  const answer = { venue: "dlmm", pool: "P", x: { mint: "SOL", decimals: 9 }, y: { mint: "USDC", decimals: 6 }, stepBps: 33, activeId: 100, price: 150, bins, market: { price: 150, gapPct: 0 }, rent: null, at: "2026-11-18T00:00:00Z" };
  const book = depthBook(answer, "x", 150, 14);
  assert.deepEqual(book.asks.map((r) => [r.price, r.usd, r.total]), [[150.5, 300, 300], [151, 150, 450]]);
  assert.deepEqual(book.bids.map((r) => [r.price, r.usd, r.total]), [[149.5, 100, 100], [149, 300, 400]]);
  assert.equal(book.asks.at(-1).share, 1);
  // An empty bin is no level of the book: only what holds something stands.
  const holes = depthBook({ ...answer, bins: [...bins, { offset: 3, id: 103, price: 151.5, x: "0", y: "0" }, { offset: -3, id: 97, price: 148.5, x: "0", y: "1" }] }, "x", 150, 14);
  assert.deepEqual(holes.asks.map((r) => r.price), [150.5, 151]);
  assert.deepEqual(holes.bids.map((r) => r.price), [149.5, 149]);
  // The coin as Y: the pool's «above» is the coin's «below».
  const flipped = depthBook({ ...answer, x: { mint: "USDC", decimals: 6 }, y: { mint: "COIN", decimals: 9 }, price: 1 / 150 }, "y", 150, 14);
  assert.ok(flipped.asks.length && flipped.bids.length);
  assert.deepEqual(depthBook(answer, "x", null), { asks: [], bids: [] });
});

test("«Tick» is a bar a trade from the trades read, in order, a millisecond apart in one second; the market cap is the trade's", async () => {
  const { TICK, TickSource, tickBars } = await import("./tick-source.ts");
  const trades = [
    { signature: "c", at: "2026-11-18T00:00:02Z", side: "buy", wallet: "W", tokenAmount: 2, usd: 20, priceUsd: 10, capUsd: 1000 },
    { signature: "a", at: "2026-11-18T00:00:01Z", side: "sell", wallet: "W", tokenAmount: 1, usd: 9, priceUsd: 9, capUsd: null },
    { signature: "b", at: "2026-11-18T00:00:01Z", side: "buy", wallet: "W", tokenAmount: 1, usd: 9.5, priceUsd: 9.5, capUsd: 950 },
    { signature: "x", at: "2026-11-18T00:00:03Z", side: "buy", wallet: "W", tokenAmount: 1, usd: null, priceUsd: null, capUsd: null },
  ];
  const bars = tickBars(trades, "price", null);
  const t0 = Date.parse("2026-11-18T00:00:01Z");
  assert.deepEqual(bars.map((b) => [b.t - t0, b.c]), [[0, "9"], [1, "9.5"], [1000, "10"]]);
  assert.equal(bars[0].o, bars[0].h);
  assert.deepEqual(tickBars(trades, "market_cap", 100).map((b) => b.c), ["900", "950", "1000"], "a trade's own cap, else its price times the supply");

  // Through the source: time intervals go to the base; a tick's history is the bars, live bars only after them.
  const asked = [];
  const base = {
    contract: "ryntra.chart/2.6",
    instrument: async () => ({ id: "M", resolutions: [{ kind: "time", unit: "minute", span: 1 }] }),
    history: async (r) => (asked.push(r.resolution.kind), { bars: [] }),
    subscribe: () => () => {},
    series: async () => [],
    seriesHistory: async () => ({}),
    marks: async () => ({ marks: [] }),
    book: async () => null,
  };
  const now = () => Date.parse("2026-11-18T00:00:10Z");
  const tick = new TickSource(base, () => "0.01", now);
  tick.put(trades.slice(1));
  const basis = { kind: "last", measure: "price", in: "USD", adjustment: "raw", outcome: null };
  const instrument = await tick.source.instrument("M");
  assert.deepEqual(instrument.resolutions.at(-1), TICK);
  await tick.source.history({ instrument: "M", resolution: { kind: "time", unit: "minute", span: 1 }, basis, load: "init", timestamp: null, limit: 10 });
  assert.deepEqual(asked, ["time"]);
  const page = await tick.source.history({ instrument: "M", resolution: TICK, basis, load: "init", timestamp: null, limit: 10 });
  assert.equal(page.bars.length, 2);
  assert.equal(page.display_step, "0.01");
  assert.deepEqual(page.bars.map((b) => b.c), ["9.00", "9.50"], "on the price step");
  assert.equal(page.status.state, "delayed");
  const heard = [];
  const stop = tick.source.subscribe({ instrument: "M", resolution: TICK, basis }, (event) => heard.push(event.bar.c));
  tick.put(trades);
  assert.deepEqual(heard, ["10.00"], "only the trade after what history gave");
  stop();
});
