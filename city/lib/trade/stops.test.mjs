import { test } from "node:test";
import assert from "node:assert/strict";

import { keptStops, makeStop, parseStops, stopReached, stopsKey, stopsToWatch, stopThreshold, stopView, withState } from "./stops.ts";
import { OWNER, USDC_MINT, WIF } from "./limit-fixtures.mjs";

// A stop is watched on this device, never an order at a venue: its line is what the amount brings at the stop's price
// by the limits engine's own arithmetic, and the swap engine's quote for that exact amount is compared with it.

const NOW = Date.parse("2026-10-28T10:00:00.000Z");
const BASE = { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 };
const QUOTE = { mint: USDC_MINT, symbol: "USDC", decimals: 6 };
const SELL = { owner: OWNER, side: "sell", base: BASE, quote: QUOTE, amountRaw: "5000000", price: "2", expiry: "7d" };
const BUY = { owner: OWNER, side: "buy", base: BASE, quote: QUOTE, amountRaw: "25000000", price: "2.5", expiry: "never" };

test("a stop's line: what its amount brings at its price, in the output's raw units", () => {
  // Selling 5 WIF at 2 USDC brings 10 USDC; buying with 25 USDC at 2.5 brings 10 WIF.
  assert.equal(stopThreshold(SELL), "10000000");
  assert.equal(stopThreshold(BUY), "10000000");
  assert.equal(stopThreshold({ ...SELL, amountRaw: "0" }), null);
});

test("a sale's stop is reached when the quote for its amount brings no more than at the stop; a buy's the same way", () => {
  const sell = makeStop(SELL, NOW, "12000000", "s1").stop;
  assert.equal(sell.state, "watching");
  assert.equal(sell.expiresAt, NOW + 7 * 86_400_000);
  assert.equal(stopReached(sell, "10000001"), false);
  assert.equal(stopReached(sell, "10000000"), true);
  assert.equal(stopReached(sell, "9000000"), true);
  // The price rose: 25 USDC now buys fewer WIF than at the stop's price.
  const buy = makeStop(BUY, NOW, "12500000", "b1").stop;
  assert.equal(buy.expiresAt, null);
  assert.equal(stopReached(buy, "11000000"), false);
  assert.equal(stopReached(buy, "9900000"), true);
  assert.equal(stopReached(buy, "not a number"), false);
});

test("a stop already reached at today's price is a market order, and the card says so", () => {
  const sell = makeStop(SELL, NOW, "9500000", "s1");
  assert.equal(sell.ok, false);
  assert.equal(sell.problem.code, "REACHED");
  assert.match(sell.problem.text, /Use Market or set it lower/);
  assert.match(makeStop(BUY, NOW, "9000000", "b2").problem.text, /Use Market or set it higher/);
  assert.equal(makeStop(BUY, NOW, "9000000", "b1").problem.code, "REACHED");
  assert.equal(makeStop({ ...SELL, price: "" }, NOW, null, "x").problem.code, "PRICE");
  assert.equal(makeStop({ ...SELL, price: "0" }, NOW, null, "x").problem.code, "PRICE");
  assert.equal(makeStop({ ...SELL, amountRaw: "0" }, NOW, null, "x").problem.code, "AMOUNT");
  // Without a quote the stop is kept as typed: the first watch decides.
  assert.equal(makeStop(SELL, NOW, null, "s2").ok, true);
});

test("a stop past its time has expired, and only watched ones of this wallet are asked about", () => {
  const sell = makeStop(SELL, NOW, null, "s1").stop;
  const buy = makeStop(BUY, NOW, null, "b1").stop;
  const other = { ...makeStop(SELL, NOW, null, "o1").stop, owner: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" };
  const later = NOW + 8 * 86_400_000;
  assert.equal(stopView(sell, NOW), "watching");
  assert.equal(stopView(sell, later), "expired");
  assert.equal(stopView(buy, later), "watching");
  const reached = withState([sell, buy, other], "b1", { state: "reached", reachedAt: NOW });
  assert.deepEqual(stopsToWatch(reached, OWNER, NOW).map((stop) => stop.id), ["s1"]);
  assert.deepEqual(stopsToWatch(reached, OWNER, later).map((stop) => stop.id), []);
});

test("stops kept on the device read back exactly; anything else is left out, never guessed at", () => {
  const sell = makeStop(SELL, NOW, null, "s1").stop;
  const buy = makeStop(BUY, NOW + 1, null, "b1").stop;
  const text = JSON.stringify([sell, buy, { id: "bad", owner: OWNER, side: "sideways" }, null, 7]);
  assert.deepEqual(parseStops(text), [sell, buy]);
  assert.deepEqual(parseStops("not json"), []);
  assert.deepEqual(parseStops(null), []);
  assert.deepEqual(parseStops(JSON.stringify([{ ...sell, thresholdRaw: "-1" }])), []);
  assert.equal(stopsKey(OWNER), `ryntra.city.stops.v1:${OWNER}`);
});

test("what is kept: the newest first; let-go stops and finished ones a month old are dropped", () => {
  const old = { ...makeStop(SELL, NOW - 40 * 86_400_000, null, "old").stop, state: "done" };
  const gone = { ...makeStop(SELL, NOW, null, "gone").stop, state: "cancelled" };
  const fresh = makeStop(SELL, NOW, null, "fresh").stop;
  const earlier = makeStop(BUY, NOW - 1_000, null, "earlier").stop;
  assert.deepEqual(keptStops([earlier, old, gone, fresh], NOW).map((stop) => stop.id), ["fresh", "earlier"]);
});
