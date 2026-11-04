import assert from "node:assert/strict";
import test from "node:test";

import { BOLT_START, boltLamports, cleanBolt, cleanSells, defaultTrade, hydrateTrade, readTrade, sanitizeTrade, SELL_START, TRADE_KEY, useTradePrefs, writeTrade } from "./trade.ts";
import { sizingOf, slideAmount, startAmount } from "../trade/size.ts";
import { SOL, USDC } from "../trade/tiles.ts";

/* CITY-87: the trading choices of the settings window — the ⚡ amount and the sale chips — kept on this device and read
   by the trade window's own figures. */

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};

test("a ⚡ amount is a plain SOL decimal between 0.001 and 1,000, written without trailing zeros", () => {
  assert.equal(cleanBolt("0.10"), "0.1");
  assert.equal(cleanBolt("2"), "2");
  assert.equal(cleanBolt(" 0.250 "), "0.25");
  assert.equal(cleanBolt("0.0001"), null, "below the least");
  assert.equal(cleanBolt("1001"), null, "above the most");
  assert.equal(cleanBolt("1,5"), null);
  assert.equal(cleanBolt("-1"), null);
  assert.equal(cleanBolt("0.1234567891"), null, "more places than SOL has");
  assert.equal(boltLamports({ ...defaultTrade(), bolt: "0.25" }), 250_000_000n);
});

test("sale chips are three different whole percentages of your own, smallest first, and MAX always last", () => {
  assert.deepEqual(cleanSells([50, 10, 100, 25]), [10, 25, 50, 100]);
  assert.equal(cleanSells([25, 25, 50, 100]), null);
  assert.equal(cleanSells([0, 25, 50, 100]), null);
  assert.equal(cleanSells([25, 50, 101, 100]), null);
  assert.equal(cleanSells([25, 50, 75]), null);
  assert.equal(cleanSells([25.5, 50, 75, 100]), null);
  assert.equal(cleanSells([10, 25, 50, 75]), null, "a sale that starts at all of it keeps its MAX chip");
});

test("the trading choices are kept on the device and read back; anything else is the start", () => {
  const storage = memoryStorage();
  hydrateTrade(storage);
  assert.deepEqual(useTradePrefs.getState().prefs, defaultTrade());
  assert.equal(useTradePrefs.getState().setBolt("0.5"), true);
  assert.equal(useTradePrefs.getState().setSell(1, 33), true);
  assert.equal(useTradePrefs.getState().setSell(0, 33), false, "two chips the same are refused");
  assert.equal(useTradePrefs.getState().setSell(3, 90), false, "MAX is not the person's to change");
  assert.equal(useTradePrefs.getState().setBolt("lots"), false);
  assert.equal(useTradePrefs.getState().setStyle("sniper"), false, "a style the engine does not take stays closed");
  hydrateTrade(storage);
  assert.deepEqual(useTradePrefs.getState().prefs, { bolt: "0.5", sells: [25, 33, 75, 100], style: "safe" });
  assert.equal(JSON.parse(storage.data.get(TRADE_KEY)).v, 1);
  assert.deepEqual(readTrade(memoryStorage({ [TRADE_KEY]: "{oops" })), defaultTrade());
  assert.deepEqual(sanitizeTrade({ bolt: "0", sells: "all", style: "fast" }), defaultTrade());
  assert.equal(writeTrade({ getItem: () => null, setItem: () => { throw new Error("full"); } }, defaultTrade()), false);
  hydrateTrade(null);
});

test("the trade window reads them: a buy in SOL starts at the ⚡ amount, a sale's chips are the person's own", () => {
  const max = 5_000_000_000n;
  assert.equal(startAmount("buy", SOL, max), 100_000_000n, "0.1 SOL before any choice");
  assert.equal(startAmount("buy", SOL, max, 500_000_000n), 500_000_000n);
  assert.equal(startAmount("buy", SOL, 200_000_000n, 500_000_000n), 50_000_000n, "more than the wallet holds: a quarter of it");
  assert.equal(startAmount("buy", USDC, 100_000_000n, 500_000_000n), 10_000_000n, "a buy in USDC keeps its own start");
  const chips = sizingOf(1_000n, null, [10, 33, 50, 100]).chips;
  assert.deepEqual(chips.map((c) => c.share), [10, 33, 50, 100]);
  assert.deepEqual(chips.map((c) => c.amountRaw), ["100", "330", "500", "1000"]);
  assert.equal(slideAmount(123_456_789n, 33, [10, 33, 50, 100]), 40_740_740n, "a chip's share is exact");
  assert.deepEqual(sizingOf(1_000n, null).chips.map((c) => c.share), [...SELL_START], "25, 50, 75, MAX otherwise");
  assert.equal(BOLT_START, "0.1");
});
