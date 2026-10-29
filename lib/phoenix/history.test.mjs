// Run from repo root: node --test lib/phoenix/history.test.mjs
//
// PERP-5 — a wallet's own history on Phoenix (spec §11.1–§11.2): the fills, the orders and the funding settlements, each
// parsed from Phoenix's own public answer. Pure: nothing here reads the network.
import assert from "node:assert/strict";
import test from "node:test";

import { fundingHistoryFrom, isHistoryKind, orderHistoryFrom, tradesFrom } from "./history.ts";

test("the kinds one route serves", () => {
  for (const kind of ["trades", "orders", "funding"]) assert.equal(isHistoryKind(kind), true);
  for (const bad of ["fills", "", null, 1, "TRADES"]) assert.equal(isHistoryKind(bad), false);
});

/* Phoenix states a fill's size in base lots: SOL's lot is a thousandth, GOLD's a hundredth. */
const DECIMALS = { sol: 3, gold: 2 };
const decimalsOf = (symbol) => DECIMALS[symbol.toLowerCase()] ?? null;

test("the fills: the size from Phoenix's own lots, newest first, one market when asked, and the result and the fees summed", () => {
  const raw = {
    data: [
      { signature: "A", marketSymbol: "SOL", timestamp: 1_700_000_000, baseLotsDelta: "600", price: "150.02", fees: "0.0032", realizedPnl: "1.5", liquidity: "taker", tradeType: "market", fillId: "f1" },
      { signature: "B", marketSymbol: "SOL", timestamp: 1_700_000_900, baseLotsDelta: "-400", price: "151.00", fees: "0.0010", realizedPnl: "-0.5", liquidity: "maker", tradeType: "limit", fillId: "f2" },
      { signature: "C", marketSymbol: "GOLD", timestamp: 1_700_000_500, baseLotsDelta: "100", price: "2600", fees: "0.1", realizedPnl: "0", liquidity: "taker", tradeType: "market", fillId: "f3" },
      { signature: "D", marketSymbol: "SOL", timestamp: 1_700_000_100, baseLotsDelta: "0", price: "150", fees: "0", realizedPnl: "0", liquidity: "taker", tradeType: "market" },
    ],
  };
  const all = tradesFrom(raw, "W", null, 9, decimalsOf);
  /* 600 lots of SOL is 0.6 SOL, 100 lots of GOLD is one ounce — the market's own decimals, never the figure as sent. */
  assert.deepEqual(
    all.trades.map((row) => row.sizeUnits),
    [0.4, 1, 0.6],
  );
  /* A market whose decimals did not come keeps the fill without a size: lots are never printed as coins. */
  assert.equal(tradesFrom(raw, "W", null, 9, () => null).trades[0].sizeUnits, null);
  assert.deepEqual(all.trades.map((row) => row.id), ["f2", "f3", "f1"], "newest first; a fill that moved nothing is no fill");
  assert.deepEqual(all.trades.map((row) => row.side), ["sell", "buy", "buy"]);
  assert.equal(all.trades[0].liquidity, "maker");
  assert.equal(Math.round(all.realizedPnlUsd * 100), 100);
  assert.equal(Math.round(all.feesUsd * 1e4), 1_042, "every market read, each fee as Phoenix wrote it");
  assert.equal(all.observedAt, 9);
  const one = tradesFrom(raw, "W", "sol", 9, decimalsOf);
  assert.deepEqual(one.trades.map((row) => row.id), ["f2", "f1"], "the market, however it is spelled");
  /* A row without a time or a price is a fact not known: left out, never a zero. */
  assert.deepEqual(tradesFrom({ data: [{ marketSymbol: "SOL", baseLotsDelta: "1", price: "0" }] }, "W", null, 1, decimalsOf).trades, []);
  assert.deepEqual(tradesFrom(null, "W", null, 1), { wallet: "W", symbol: null, trades: [], realizedPnlUsd: null, feesUsd: null, observedAt: 1 });
  /* A fee Phoenix did not send leaves the sum unknown rather than smaller than it is. */
  assert.equal(tradesFrom({ data: [{ marketSymbol: "SOL", timestamp: 1, baseLotsDelta: "1", price: "1" }] }, "W", null, 1, decimalsOf).feesUsd, null);
});

test("the orders: what became of each, newest ending first", () => {
  const raw = {
    data: [
      { orderSequenceNumber: "77", marketSymbol: "SOL", status: "filled", side: "bid", price: "150", baseQty: "1", filledBaseQty: "1", remainingBaseQty: "0", placedAt: 1_700_000_000, completedAt: 1_700_000_100 },
      { orderSequenceNumber: "78", marketSymbol: "SOL", status: "cancelled", side: "ask", price: "160", baseQty: "2", filledBaseQty: "0.5", remainingBaseQty: "1.5", isReduceOnly: true, isStopLoss: true, placedAt: 1_700_000_050, completedAt: 1_700_000_900 },
      { orderSequenceNumber: "79", marketSymbol: "GOLD", status: "active", side: "bid", price: "2600", baseQty: "1", filledBaseQty: "0", remainingBaseQty: "1", placedAt: 1_700_000_200 },
    ],
  };
  const read = orderHistoryFrom(raw, "W", null, 2);
  assert.deepEqual(read.orders.map((row) => row.id), ["SOL:78", "GOLD:79", "SOL:77"]);
  assert.deepEqual(read.orders[0], {
    id: "SOL:78",
    symbol: "SOL",
    status: "cancelled",
    side: "sell",
    priceUsd: 160,
    sizeUnits: 2,
    filledUnits: 0.5,
    leftUnits: 1.5,
    reduceOnly: true,
    stop: true,
    placedAt: 1_700_000_050_000,
    endedAt: 1_700_000_900_000,
  });
  assert.deepEqual(orderHistoryFrom(raw, "W", "GOLD", 2).orders.map((row) => row.id), ["GOLD:79"]);
  assert.deepEqual(orderHistoryFrom({}, "W", null, 2).orders, []);
});

test("the funding settlements: paid and received each on its own, by Phoenix's own sign", () => {
  const raw = {
    events: [
      { timestamp: "2026-10-25T10:00:00Z", symbol: "SOL", fundingPayment: "-0.42", fundingRatePercentage: "0.0031", positionSize: "10", positionSide: "long" },
      { timestamp: "2026-10-26T10:00:00Z", symbol: "SOL", fundingPayment: "0.17", fundingRatePercentage: "-0.0012", positionSize: "10", positionSide: "long" },
      { timestamp: "2026-10-26T11:00:00Z", symbol: "GOLD", fundingPayment: "0", fundingRatePercentage: "0", positionSize: "1", positionSide: "short" },
      { timestamp: "2026-10-26T12:00:00Z", symbol: "SOL", fundingPayment: "0.01", fundingRatePercentage: "9", positionSize: "10", positionSide: "long" },
    ],
  };
  const read = fundingHistoryFrom(raw, "W", null, 3);
  assert.equal(read.events.length, 3, "a settlement of nothing is not a settlement");
  assert.equal(read.events[0].symbol, "SOL", "newest first");
  assert.equal(read.events[0].ratePercent, null, "nine per cent a period is a unit misread, not a rate");
  assert.equal(Math.round(read.paidUsd * 100), 42);
  assert.equal(Math.round(read.receivedUsd * 100), 18);
  assert.deepEqual(fundingHistoryFrom(raw, "W", "GOLD", 3).events, []);
  assert.deepEqual(fundingHistoryFrom({ events: [] }, "W", null, 3), { wallet: "W", symbol: null, events: [], paidUsd: null, receivedUsd: null, observedAt: 3 });
});
