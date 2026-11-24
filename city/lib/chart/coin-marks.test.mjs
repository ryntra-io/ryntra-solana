import { test } from "node:test";
import assert from "node:assert/strict";

import { coinMarks, CREATOR_MOST, mergeMarks, OWN_MOST, sameMarks, tradeMarkId } from "./coin-marks.ts";
import { readTokenMarks } from "./marks.ts";

/* The marks on a coin's candles: the person's own trades, the creator's, the move to a DEX. */

const ME = "Me11111111111111111111111111111111111111111";
const DEV = "Dev1111111111111111111111111111111111111111";
const ANY = "Any1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-11-20T10:00:00Z");
const words = {
  youBought: (usd) => `You bought ${usd}`,
  youSold: (usd) => `You sold ${usd}`,
  creatorBought: (usd) => `Creator bought ${usd}`,
  creatorSold: (usd) => `Creator sold ${usd}`,
  listed: "Moved to a DEX",
};
const usd = (value) => `$${value}`;
let n = 0;
const trade = (wallet, side, secondsAgo, more = {}) => ({ signature: `sig${(n += 1)}`, at: new Date(NOW - secondsAgo * 1000).toISOString(), side, wallet, tokenAmount: 1, usd: 25, priceUsd: 0.0001234567, capUsd: null, ...more });
const marks = (input) => coinMarks({ owner: null, engine: [], phone: false, words, usd, ...input });

test("no wallet: none of the trades is the person's", () => {
  assert.deepEqual(marks({ trades: [trade(ME, "buy", 10), trade(ANY, "sell", 5)] }), []);
});

test("the wallet's own buys and sales are its marks, at their prices on a desk", () => {
  const buy = trade(ME, "buy", 60, { usd: 40 });
  const sell = trade(ME, "sell", 10, { usd: 12 });
  const got = marks({ trades: [sell, trade(ANY, "buy", 30), buy], owner: ME });
  assert.deepEqual(got.map((one) => [one.id, one.side, one.own, one.label]), [
    [tradeMarkId(buy), "buy", true, "You bought $40"],
    [tradeMarkId(sell), "sell", true, "You sold $12"],
  ]);
  assert.equal(got[0].kind, "trade");
  assert.equal(got[0].price, "0.000123457", "six significant digits, no exponent");
  assert.equal(got[0].t, NOW - 60_000);
});

test("on a phone no mark carries a price: they stand along the foot of the plot, never over the candles", () => {
  const got = marks({ trades: [trade(ME, "buy", 10), trade(DEV, "sell", 5, { labels: ["creator"] })], owner: ME, phone: true, engine: [{ kind: "dex", t: NOW / 1000 - 100, usd: null, pct: null }] });
  assert.equal(got.length, 3);
  assert.ok(got.every((one) => one.price === null));
});

test("the creator's trades from the tape, at their prices; the engine's past the tape on their time alone, never twice", () => {
  const sold = trade(DEV, "sell", 30, { labels: ["creator", "top-holder"], usd: 900 });
  const engine = [
    { kind: "creator-sell", t: Math.floor((NOW - 30_000) / 1000), usd: 900, pct: 2 },
    { kind: "creator-buy", t: Math.floor((NOW - 3_600_000) / 1000), usd: 500, pct: null },
    { kind: "big-buy", t: Math.floor((NOW - 50_000) / 1000), usd: 5_000, pct: null },
  ];
  const got = marks({ trades: [sold], engine });
  assert.deepEqual(got.map((one) => [one.side, one.own, one.label, one.price === null]), [
    ["buy", false, "Creator bought $500", true],
    ["sell", false, "Creator sold $900", false],
  ]);
});

test("the person's own trade is theirs even when they are the creator; a trade is one mark", () => {
  const mine = trade(DEV, "buy", 20, { labels: ["creator"] });
  const got = marks({ trades: [mine], owner: DEV });
  assert.equal(got.length, 1);
  assert.equal(got[0].own, true);
  assert.equal(got[0].label, "You bought $25");
});

test("the move to a DEX is an event on its moment, without a price", () => {
  const t = Math.floor((NOW - 7_200_000) / 1000);
  const got = marks({ trades: [], engine: [{ kind: "dex", t, usd: null, pct: null }, { kind: "liquidity-drop", t, usd: null, pct: -60 }] });
  assert.deepEqual(got, [{ id: `dex:${t}`, kind: "event", t: t * 1000, price: null, side: null, label: "Moved to a DEX", own: false }]);
});

test("a trade without a dollar sum is named without one; one without a time is no mark", () => {
  const got = marks({ trades: [trade(ME, "sell", 5, { usd: null }), { ...trade(ME, "buy", 1), at: "soon" }], owner: ME });
  assert.deepEqual(got.map((one) => one.label), ["You sold"]);
});

test("the newest own and creator trades are marked, a bounded number of each", () => {
  const many = Array.from({ length: OWN_MOST + 5 }, (_, i) => trade(ME, "buy", i + 1));
  const dev = Array.from({ length: CREATOR_MOST + 5 }, (_, i) => trade(DEV, "sell", i + 1, { labels: ["creator"] }));
  const got = marks({ trades: [...many, ...dev], owner: ME });
  assert.equal(got.filter((one) => one.own).length, OWN_MOST);
  assert.equal(got.filter((one) => !one.own).length, CREATOR_MOST);
  assert.ok(got.every((one, i) => i === 0 || one.t >= got[i - 1].t), "oldest first");
});

test("merging keeps the first list's mark for a trade both name, and the same marks are the same", () => {
  const own = [{ id: "trade:a:buy", kind: "trade", t: 2, price: "1", side: "buy", label: "You bought $5", own: true }];
  const big = [{ id: "trade:a:buy", kind: "trade", t: 2, price: "1", side: "buy", label: "Buy $5", own: false }, { id: "trade:b:sell", kind: "trade", t: 1, price: "1", side: "sell", label: "Sell $9", own: false }];
  const got = mergeMarks(own, big);
  assert.deepEqual(got.map((one) => one.id), ["trade:b:sell", "trade:a:buy"]);
  assert.equal(got[1].own, true);
  assert.equal(sameMarks(got, mergeMarks(own, big)), true);
  assert.equal(sameMarks(got, own), false);
});

test("the engine's marks are read as it found them; a failed read is none", () => {
  const t = 1_700_000_000;
  assert.deepEqual(readTokenMarks(200, { marks: [{ kind: "creator-buy", t, usd: 5 }, { kind: "rug", t }, { kind: "dex", t: "x" }] }), [{ kind: "creator-buy", t, usd: 5, pct: null }]);
  assert.deepEqual(readTokenMarks(200, { none: { code: "NOT_LISTED" } }), []);
  assert.equal(readTokenMarks(429, {}), null);
});
