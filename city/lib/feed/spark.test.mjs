import assert from "node:assert/strict";
import test from "node:test";

import { advance, emptyFeed } from "./feed.ts";
import { HISTORY_MAX, HOUR, remember, sparkPath, sparkPoints } from "./spark.ts";

/* CITY-66: the mover's small line — only real reads, joined straight. */

const NOW = Date.parse("2026-10-28T12:00:00Z");
const MIN = 60_000;

test("the hour's line: the price an hour and five minutes ago as the changes imply, and now", () => {
  const points = sparkPoints({ price: 110, change5m: 10, change1h: 10, change24h: 0 }, "1h", NOW);
  assert.deepEqual(
    points.map(([t]) => (t - NOW) / MIN),
    [-60, -5, 0],
  );
  assert.ok(Math.abs(points[0][1] - 100) < 1e-9);
  assert.ok(Math.abs(points[1][1] - 100) < 1e-9);
  assert.equal(points[2][1], 110);
});

test("the day's line adds the price a day ago; the city's own reads in the window join it in time order", () => {
  const history = [
    [NOW - 30 * HOUR, 1],
    [NOW - 3 * HOUR, 95],
    [NOW - 2 * MIN, 109],
    [NOW + MIN, 999],
  ];
  const points = sparkPoints({ price: 110, change5m: 0, change1h: 10, change24h: 100 }, "24h", NOW, history);
  assert.deepEqual(
    points.map(([t]) => (t - NOW) / MIN),
    // No five-minute point: a change of exactly zero is what the read writes when Jupiter gave none.
    [-24 * 60, -180, -60, -2, 0],
  );
  assert.ok(Math.abs(points[0][1] - 55) < 1e-9);
});

test("no price, or a change of −100% or worse, gives no point for it; fewer than two points, no line", () => {
  assert.equal(sparkPoints({ price: 0, change5m: 1, change1h: 1, change24h: 1 }, "1h", NOW), null);
  const points = sparkPoints({ price: 5, change5m: NaN, change1h: -100, change24h: -150 }, "24h", NOW);
  assert.equal(points, null);
  assert.equal(sparkPoints({ price: 5, change5m: NaN, change1h: 25, change24h: -150 }, "24h", NOW).length, 2);
});

test("the path spans the box: oldest at the left edge, newest at the right, the high at the top", () => {
  const path = sparkPath([[0, 1], [50, 3], [100, 2]], 64, 22, 1);
  assert.equal(path, "1.0,21.0 32.0,1.0 63.0,11.0");
  assert.equal(sparkPath([[0, 5], [10, 5]], 64, 22), "1.5,11.0 62.5,11.0");
  assert.equal(sparkPath([[0, 5]], 64, 22), "");
});

test("the reads kept per tower: newest added, older than a day and a bit let go, at most a bounded number", () => {
  let h = remember(undefined, NOW, 2);
  assert.deepEqual(h, [[NOW, 2]]);
  h = remember(h, NOW, 3);
  assert.deepEqual(h, [[NOW, 3]], "the same read time replaces");
  h = remember([[NOW - 26 * HOUR, 1], [NOW - HOUR, 2]], NOW, 3);
  assert.deepEqual(h, [[NOW - HOUR, 2], [NOW, 3]]);
  assert.deepEqual(remember([[NOW - HOUR, 2]], NOW, NaN), [[NOW - HOUR, 2]]);
  let long = [];
  for (let k = 0; k < HISTORY_MAX + 50; k += 1) long = remember(long, NOW + k * MIN, 1 + k);
  assert.equal(long.length, HISTORY_MAX);
});

test("a mover's line grows with each read of the city", () => {
  const id = "Bonk".padEnd(44, "1");
  const tower = (price, change1h) => ({ id, symbol: "BONK", name: "Bonk", icon: null, district: "strip", price, mcap: 1e9, liquidity: 1e7, holders: 1, change5m: 0.5, change1h, change24h: 0, volume24h: 0, traders1h: 1, organic: 90, verified: true, launchedAt: null });
  const shown = new Set(["gainers"]);
  let memory = advance(emptyFeed(), { now: NOW - 2 * MIN, city: { towers: [tower(1, 1)], readAt: NOW - 2 * MIN, live: true }, launches: null, pools: null }, shown);
  memory = advance(memory, { now: NOW - MIN, city: { towers: [tower(1.05, 1.5)], readAt: NOW - MIN, live: true }, launches: null, pools: null }, shown);
  memory = advance(memory, { now: NOW, city: { towers: [tower(1.12, 12)], readAt: NOW, live: true }, launches: null, pools: null }, shown);
  const [event] = memory.events;
  assert.equal(event.line, "+12.0% · 1h");
  assert.deepEqual(
    event.spark.map(([t]) => (t - NOW) / MIN),
    [-60, -5, -2, -1, 0],
  );
});
