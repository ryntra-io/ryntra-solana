import { test } from "node:test";
import assert from "node:assert/strict";

import { loading, QUIET_MISSES, settle } from "./candles.ts";
import { chartRead, hasPricedTrade, joinCandles, tradeCandles, wantsTrades, YOUNG_TIMEFRAME } from "./young.ts";

/* A coin a minute old: its chart is drawn from its own trades until the chart source has a bar of it. */

const MINT = "Young1111111111111111111111111111111111111";
const NOW = Date.parse("2026-11-20T10:00:30Z");
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();
const trade = (secondsAgo, priceUsd, usd = 10) => ({ at: at(secondsAgo), priceUsd, usd });
const none = settle(loading(MINT, "1m", null), { status: "none", code: "NO_POOL" });
const read = (data, trades, more = {}) => chartRead({ data, mint: MINT, timeframe: "1m", trades, drawing: false, joined: false, stale: false, now: NOW, ...more });

test("the chart of trades opens on the finest interval", () => {
  assert.equal(YOUNG_TIMEFRAME, "1m");
});

test("not one trade: nothing to draw — «No chart yet» stays", () => {
  assert.equal(hasPricedTrade([]), false);
  assert.equal(wantsTrades(none, MINT, []), false);
  assert.equal(read(none, []), null);
  assert.equal(read(none, [trade(5, null)]), null, "a trade without a price is no bar");
});

test("one trade: one bar at its price", () => {
  const got = read(none, [trade(5, 0.00012, 40)]);
  assert.ok(got);
  assert.equal(got.status, "ready");
  assert.equal(got.timeframe, "1m");
  assert.equal(got.candles.length, 1);
  const [bar] = got.candles;
  assert.deepEqual([bar.open, bar.high, bar.low, bar.close, bar.volume], [0.00012, 0.00012, 0.00012, 0.00012, 40]);
  assert.equal(bar.time, Math.floor((NOW - 5000) / 60_000) * 60);
  assert.equal(got.observedAt, NOW - 5000, "as old as the newest trade");
  assert.equal(got.pool, null);
});

test("several trades within a minute: one bar, opened at the first, closed at the last, high and low between", () => {
  /* Newest first, as the tape holds them. */
  const trades = [trade(2, 0.0002, 5), trade(10, 0.00009, 7), trade(20, 0.00025, 3), trade(28, 0.0001, 1)];
  const got = read(none, trades);
  assert.equal(got.candles.length, 1);
  const [bar] = got.candles;
  assert.deepEqual([bar.open, bar.high, bar.low, bar.close, bar.volume], [0.0001, 0.00025, 0.00009, 0.0002, 16]);
});

test("trades over three minutes: a bar a minute, oldest first, an empty minute no bar", () => {
  const trades = [trade(-200, 3, 1), trade(-90, 2, 1), trade(-20, 1, 1)];
  const bars = tradeCandles(trades, "1m");
  assert.deepEqual(bars.map((bar) => bar.close), [1, 2, 3]);
  assert.equal(bars[2].time - bars[1].time, 60);
  assert.equal(bars[1].time - bars[0].time, 120, "the empty minute between is no bar");
  assert.ok(bars.every((bar, i) => i === 0 || bar.time > bars[i - 1].time));
  assert.equal(tradeCandles(trades, "15m").length, 1, "a coarser interval gathers them");
});

test("a read on its way is waited for — unless the trades are already drawn, which then stay", () => {
  const waiting = loading(MINT, "1m", null);
  assert.equal(read(waiting, [trade(5, 1)]), null);
  assert.ok(read(waiting, [trade(5, 1)], { drawing: true }));
});

test("the engine unavailable for good draws the trades too; unavailable a moment does not", () => {
  let data = loading(MINT, "1m", null);
  data = settle(data, { status: "unavailable", reason: "failed" });
  assert.equal(read(data, [trade(5, 1)]), null);
  for (let i = 1; i < QUIET_MISSES; i += 1) data = settle(data, { status: "unavailable", reason: "failed" });
  assert.ok(read(data, [trade(5, 1)]));
});

test("another coin's read is not this coin's", () => {
  const other = settle(loading("Other111111111111111111111111111111111111", "1m", null), { status: "none", code: "NO_POOL" });
  assert.equal(read(other, [trade(5, 1)]), null);
});

test("the engine's own bars are drawn as they are while the chart never stood on trades", () => {
  const engine = settle(loading(MINT, "1m", null), { status: "ready", timeframe: "1m", candles: [{ time: Math.floor(NOW / 60_000) * 60 - 60, open: 1, high: 1, low: 1, close: 1 }], pool: "X / SOL", observedAt: NOW, stale: false, source: "GeckoTerminal" });
  const got = read(engine, [trade(1, 1.1)]);
  assert.equal(got, engine.last);
});

test("the source wakes: its bars carry the chart, the newer trades after them — no jump, no step back", () => {
  const minute = Math.floor(NOW / 60_000) * 60;
  const trades = [trade(5, 1.3, 2), trade(65, 1.2, 2), trade(125, 1.1, 2)];
  const before = read(none, trades);
  /* The source has the two older minutes, its own figures for them. */
  const source = [
    { time: minute - 120, open: 1.05, high: 1.12, low: 1.0, close: 1.1, volume: 50 },
    { time: minute - 60, open: 1.1, high: 1.25, low: 1.1, close: 1.2, volume: 60 },
  ];
  const woke = settle(loading(MINT, "1m", null), { status: "ready", timeframe: "1m", candles: source, pool: "X / SOL", observedAt: NOW, stale: false, source: "GeckoTerminal" });
  const after = read(woke, trades, { joined: true });
  assert.deepEqual(after.candles.map((bar) => bar.time), [minute - 120, minute - 60, minute]);
  assert.deepEqual(after.candles.slice(0, 2), source, "where both have a bar, the source's stands");
  assert.equal(after.candles.at(-1).close, before.candles.at(-1).close, "the newest price on screen does not move");
  assert.equal(after.pool, "X / SOL");
  /* With the source's newest bar the newest minute, the trades add nothing. */
  assert.deepEqual(joinCandles([...source, { time: minute, open: 1.2, high: 1.3, low: 1.2, close: 1.29 }], tradeCandles(trades, "1m")).length, 3);
  assert.deepEqual(joinCandles([], tradeCandles(trades, "1m")).map((bar) => bar.close), [1.1, 1.2, 1.3]);
});

test("a failed read of the trades says so on the bars it drew", () => {
  assert.equal(read(none, [trade(5, 1)], { stale: true }).stale, true);
});
