import { test } from "node:test";
import assert from "node:assert/strict";

import { marketsOf } from "./markets.ts";
import { buy, buyRefusal, carryOracle, emptyBook, GONE, MAX_OPEN, parseBook, recordOf, resetCash, sell, settle, START_USD, valueOf, verdictOf, VOID_AFTER_MS } from "./practice.ts";
import { discoverEvents } from "./test-fixtures.mjs";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const DAY = 86_400_000;
const at = new Date(NOW).toISOString();
const markets = marketsOf(discoverEvents(NOW), NOW);
const btc = markets.find((m) => m.eventId === "ev-btc");
const gold = markets.find((m) => m.eventId === "ev-gold");

test("Practice starts with a thousand practice dollars and nothing open", () => {
  const book = emptyBook();
  assert.equal(book.cash, START_USD);
  assert.equal(START_USD, 1000);
  assert.deepEqual(recordOf(book).open, []);
});

test("a buy takes the venue's price: $100 on Yes at 58¢ is 172.41 shares that win $172.41", () => {
  const got = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 100, readAt: at }, NOW);
  assert.equal(got.ok, true);
  assert.equal(got.book.cash, 900);
  assert.equal(got.holding.label, "Yes");
  assert.equal(got.holding.cost, 100);
  assert.ok(Math.abs(got.holding.shares - 172.413793) < 1e-6);
  assert.equal(Math.floor(got.holding.shares * 100) / 100, 172.41);
  const again = buy(got.book, { market: btc, sideId: "ev-btc-yes", spendUsd: 25, readAt: at }, NOW + 1000);
  assert.equal(recordOf(again.book).open.length, 1, "a second buy of the same side adds to its holding");
  assert.equal(recordOf(again.book).open[0].cost, 125);
  assert.equal(again.book.cash, 875);
  const no = buy(again.book, { market: btc, sideId: "ev-btc-no", spendUsd: 10, readAt: at }, NOW + 2000);
  assert.equal(recordOf(no.book).open.length, 2, "the other side is a holding of its own");
});

test("a buy is refused with a reason: no amount, no cash, a stale price, a close in minutes, a decided side, too many open", () => {
  const book = emptyBook();
  const input = { market: btc, sideId: "ev-btc-yes", spendUsd: 10, readAt: at };
  assert.equal(buyRefusal(book, { ...input, spendUsd: 0 }, NOW), "amount");
  assert.equal(buyRefusal(book, { ...input, spendUsd: Number.NaN }, NOW), "amount");
  assert.equal(buyRefusal(book, { ...input, spendUsd: 0.004 }, NOW), "amount", "less than a cent buys nothing");
  assert.equal(buyRefusal(book, { ...input, spendUsd: 1001 }, NOW), "cash");
  assert.equal(buyRefusal(book, input, NOW + 3 * 60_000), "delayed");
  assert.equal(buyRefusal(book, { ...input, readAt: null }, NOW), "delayed");
  assert.equal(buyRefusal(book, { ...input, market: { ...btc, closes: new Date(NOW + 60_000).toISOString() } }, NOW), "closing");
  assert.equal(buyRefusal(book, { ...input, sideId: "nope" }, NOW), "side");
  assert.equal(buyRefusal(book, { ...input, market: gold, sideId: "ev-gold-yes" }, NOW), "price", "98.5% is all but decided");
  let full = book;
  for (let i = 0; i < MAX_OPEN; i++) full = buy(full, { ...input, spendUsd: 1, market: { ...btc, marketId: `m-${i}`, eventId: `e-${i}` } }, NOW).book;
  assert.equal(buyRefusal(full, input, NOW), "full");
  assert.equal(buyRefusal(full, { ...input, market: { ...btc, marketId: "m-3", eventId: "e-3" } }, NOW), null, "adding to a holding already open is fine");
  const refused = buy(book, { ...input, spendUsd: 0 }, NOW);
  assert.deepEqual(refused, { ok: false, why: "amount" });
});

test("a holding is worth its shares at the side's price now; the profit or loss is against its cost", () => {
  const { holding } = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 100, readAt: at }, NOW);
  assert.deepEqual(valueOf(holding, 0.58), { value: 100, pnl: 0, pct: 0 });
  assert.deepEqual(valueOf(holding, 0.7243), { value: 124.88, pnl: 24.88, pct: 24.9 });
  assert.deepEqual(valueOf(holding, 0.29), { value: 50, pnl: -50, pct: -50 });
});

test("a sale returns the shares at the fresh price: part of a holding, or all of it", () => {
  const bought = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 100, readAt: at }, NOW);
  const id = bought.holding.id;
  const half = sell(bought.book, { holdingId: id, fraction: 0.5, p: 0.7, readAt: at }, NOW + 1000);
  assert.equal(half.ok, true);
  assert.equal(half.back, 60.34);
  assert.equal(half.book.cash, 960.34);
  const left = recordOf(half.book).open[0];
  assert.equal(left.cost, 50);
  assert.ok(Math.abs(left.shares - 86.206897) < 1e-5);
  assert.equal(recordOf(half.book).closed[0].state, "sold");
  const rest = sell(half.book, { holdingId: id, fraction: 1, p: 0.7, readAt: at }, NOW + 2000);
  assert.equal(recordOf(rest.book).open.length, 0);
  assert.equal(rest.book.cash, 1020.68, "each sale rounds its own cents");
  assert.deepEqual(sell(rest.book, { holdingId: id, fraction: 1, p: 0.7, readAt: at }, NOW), { ok: false, why: "holding" }, "nothing left to sell");
  assert.deepEqual(sell(bought.book, { holdingId: id, fraction: 1, p: null, readAt: at }, NOW), { ok: false, why: "price" }, "no fresh price, no sale");
  assert.deepEqual(sell(bought.book, { holdingId: id, fraction: 1, p: 0.6, readAt: at }, NOW + 5 * 60_000), { ok: false, why: "delayed" });
  assert.deepEqual(sell(bought.book, { holdingId: id, fraction: 0, p: 0.6, readAt: at }, NOW), { ok: false, why: "amount" });
});

test("the venue's word settles a holding: a win pays a dollar a share, a loss nothing, void the cost back", () => {
  const bought = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 100, readAt: at }, NOW);
  const h = bought.holding;
  const resolved = (winner) => ({ id: "ev-btc-m", status: "resolved", outcomes: [{ id: "ev-btc-yes", winner: winner === "yes" }, { id: "ev-btc-no", winner: winner === "no" }] });
  assert.equal(verdictOf(h, resolved("yes"), NOW), "won");
  assert.equal(verdictOf(h, resolved("no"), NOW), "lost");
  assert.equal(verdictOf(h, { id: "ev-btc-m", status: "open", outcomes: [{ id: "ev-btc-yes", winner: null }] }, NOW), "pending");
  assert.equal(verdictOf(h, null, NOW), "pending");
  assert.equal(verdictOf(h, GONE, NOW), "pending", "a market with a close waits for its close");
  assert.equal(verdictOf(h, null, Date.parse(h.closes) + VOID_AFTER_MS + 1), "void");
  assert.equal(verdictOf({ ...h, closes: null }, GONE, NOW), "void", "an event the venue no longer has, with no close");
  assert.equal(settle(bought.book, h.id, "won", NOW).cash, 900 + 172.41);
  assert.equal(settle(bought.book, h.id, "lost", NOW).cash, 900);
  assert.equal(settle(bought.book, h.id, "void", NOW).cash, 1000);
  assert.equal(settle(bought.book, h.id, "pending", NOW), bought.book);
  const won = settle(bought.book, h.id, "won", NOW);
  assert.equal(settle(won, h.id, "won", NOW), won, "settled once");
});

test("spent out with nothing open, the practice dollars start again", () => {
  let book = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 1000, readAt: at }, NOW).book;
  assert.equal(recordOf(book).canReset, false, "something is still open");
  assert.equal(resetCash(book), book);
  book = settle(book, recordOf(book).open[0].id, "lost", NOW);
  assert.equal(recordOf(book).canReset, true);
  const again = resetCash(book);
  assert.equal(again.cash, START_USD);
  assert.equal(again.resets, 1);
  assert.equal(recordOf(again).closed.length, 1, "the history stays");
});

test("the saved book reads back; a holding that does not read is dropped alone", () => {
  const book = buy(emptyBook(), { market: btc, sideId: "ev-btc-yes", spendUsd: 25, readAt: at }, NOW).book;
  const round = parseBook(JSON.parse(JSON.stringify(book)));
  assert.deepEqual(round, book);
  const broken = { ...book, holdings: [...book.holdings, { id: "x" }, book.holdings[0], { ...book.holdings[0], id: "y", image: "javascript:x" }] };
  assert.equal(parseBook(broken).holdings.length, 1);
  for (const bad of [null, "x", {}, { v: 2, cash: 1, resets: 0, holdings: [] }, { v: 1, cash: -1, resets: 0, holdings: [] }]) assert.equal(parseBook(bad), null);
});

test("the paper Oracle's book carries over: points become dollars, open calls become holdings", () => {
  const oracle = {
    v: 1,
    points: 940,
    resets: 0,
    calls: [
      { id: "c1", eventId: "ev-btc", marketId: "ev-btc-m", outcomeId: "ev-btc-yes", question: "Will Bitcoin close October above $120,000?", market: null, side: "Yes", p: 0.4, stake: 50, pays: 125, at: NOW - DAY, closes: new Date(NOW + 4 * DAY).toISOString(), readAt: at, venues: [], counts: true, state: "open", settledAt: null },
      { id: "c2", eventId: "e2", marketId: "m2", outcomeId: "o2", question: "Settled", market: null, side: "No", p: 0.5, stake: 10, pays: 20, at: NOW - 3 * DAY, closes: null, readAt: at, venues: [], counts: true, state: "hit", settledAt: NOW - DAY },
      { id: "c3", state: "open" },
    ],
  };
  const book = carryOracle(oracle);
  assert.equal(book.cash, 940);
  assert.equal(book.carried, true);
  assert.equal(book.holdings.length, 1, "settled and unreadable calls stay behind");
  assert.equal(book.holdings[0].shares, 125);
  assert.equal(book.holdings[0].cost, 50);
  assert.equal(book.holdings[0].label, "Yes");
  assert.equal(carryOracle(null), null);
  assert.equal(carryOracle({ v: 2 }), null);
});
