import { test } from "node:test";
import assert from "node:assert/strict";

import { orderRow, sortOrders, stopRow } from "./orders-view.ts";
import { makeStop } from "./stops.ts";
import { orderView, OWNER, USDC_MINT, WIF } from "./limit-fixtures.mjs";
import { spotOpen, tradeOpen } from "./gates.ts";

// «My orders» as the panel writes them, and the two switches over trading in the city.

const TOKENS = { [WIF]: { symbol: "WIF", decimals: 6 }, [USDC_MINT]: { symbol: null, decimals: null } };

test("an open order says what it buys, at what price, in whose unit — and can be cancelled", () => {
  const row = orderRow(orderView(), TOKENS);
  assert.equal(row.coin, "$WIF");
  assert.equal(row.unit, "USDC", "the quote's name is known without a read");
  assert.equal(row.amount, "10");
  assert.equal(row.price, "2.47525");
  assert.equal(row.state, "Open");
  assert.equal(row.tone, "live");
  assert.equal(row.canCancel, true);
  assert.equal(row.filledPct, null);
});

test("a part-filled order says how much filled; an order being placed or cancelled cannot be cancelled again", () => {
  const partial = orderRow(orderView({ state: "PARTIAL", filledInputRaw: "10000000" }), TOKENS);
  assert.equal(partial.state, "Part filled");
  assert.equal(partial.filledPct, 40);
  assert.equal(orderRow(orderView({ state: "CANCELLING" }), TOKENS).canCancel, false);
  assert.equal(orderRow(orderView({ state: "PLACING" }), TOKENS).canCancel, false);
  const failed = orderRow(orderView({ state: "FAILED", canCancel: false }), TOKENS);
  assert.equal(failed.tone, "danger");
  assert.equal(failed.open, false);
});

test("an order found only at the venue is priced by its own two amounts; an unnamed coin by its address", () => {
  const venue = orderRow(orderView({ fillPrice: null, side: "sell", inputMint: WIF, outputMint: USDC_MINT, makingRaw: "4000000", takingRaw: "10000000" }), TOKENS);
  assert.equal(venue.price, "2.5");
  assert.equal(venue.amount, "4");
  const bare = orderRow(orderView({ baseMint: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }), {});
  assert.equal(bare.coin, "9xQe…VFin");
  assert.equal(bare.amount, null);
});

test("open orders first; then the latest closed ones, newest first", () => {
  const list = [
    orderView({ key: "a", state: "FILLED", updatedAt: "2026-10-27T10:00:00.000Z" }),
    orderView({ key: "b", state: "OPEN" }),
    orderView({ key: "c", state: "CANCELLED", updatedAt: "2026-10-28T09:00:00.000Z" }),
    orderView({ key: "d", state: "FILLED", canClaim: true }),
  ];
  const sorted = sortOrders(list, 1);
  assert.deepEqual(sorted.open.map((order) => order.key), ["b", "d"]);
  assert.deepEqual(sorted.closed.map((order) => order.key), ["c"]);
});

test("a stop of this device says what it does, when, and until when", () => {
  const now = Date.parse("2026-10-28T10:00:00.000Z");
  const stop = makeStop({ owner: OWNER, side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" }, now, null, "s1").stop;
  const row = stopRow(stop, now);
  assert.equal(row.spends, "5 $WIF");
  assert.equal(row.unit, "USDC");
  assert.equal(row.state, "Watching");
  assert.equal(row.until, "until 4 Nov");
  assert.equal(stopRow({ ...stop, state: "reached" }, now).state, "Reached");
  assert.equal(stopRow(stop, now + 8 * 86_400_000).view, "expired");
});

test("trading stays open unless switched off;", () => {
  assert.equal(tradeOpen(undefined), true);
  assert.equal(tradeOpen("open"), true);
  assert.equal(tradeOpen("closed"), false);
  assert.equal(spotOpen(undefined), false);
  assert.equal(spotOpen("closed"), false);
  assert.equal(spotOpen("true"), false);
  assert.equal(spotOpen("open"), true);
});
