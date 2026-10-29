import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { chartPlan, momentOf, nearestAt, pointsOf, RANGE_ASK, RANGE_ASKS, RANGES, within, xAt } from "./chart.ts";
import { readDetail } from "./detail.ts";
import { readDiscover } from "./markets.ts";
import { emptyBook } from "./practice.ts";
import { CHART_RETRIES, forgetReads, setPredictEnv, usePredict } from "./store.ts";
import { chartBody, discoverBody, eventBody } from "./test-fixtures.mjs";

/*
 * «Графік не працює». On prod the busiest markets answered no bars at every
 * resolution. The chart now works on every market's real history: each pill asks its bar size and, where the venue
 * keeps none, the next size that still covers the range; then the same outcome at the other venues the engine
 * matched; and a series still being built is asked again a little later. Every point drawn is a venue's close.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let now = Date.parse("2026-10-29T12:00:00.000Z");
let charts = {};
let reads = [];
const ok = (value) => ({ ok: true, status: 200, value });
const no = (code = "PROVIDER_UNAVAILABLE") => ({ ok: false, failure: { code, message: "x" } });

const engine = {
  discover: async () => ok(readDiscover(discoverBody(now))),
  event: async (id, card) => ok(readDetail(eventBody(id, { now }), card)),
  chart: async (outcomeId, ask) => {
    const key = `${outcomeId}:${typeof ask === "string" ? ask : ask.resolution}`;
    reads.push(key);
    const answer = charts[key];
    return typeof answer === "function" ? answer() : (answer ?? ok([]));
  },
};
const line = (from, to, stepMs, count = 20) => Array.from({ length: count }, (_, i) => ({ t: now - (count - 1 - i) * stepMs, p: from + ((to - from) * i) / (count - 1) }));

beforeEach(() => {
  now = Date.parse("2026-10-29T12:00:00.000Z");
  charts = {};
  reads = [];
  forgetReads();
  setPredictEnv({ engine, storage: { load: () => null, save: () => undefined }, now: () => now });
  usePredict.setState({ open: true, mode: "practice", page: { kind: "markets" }, tab: "trending", tabs: [{ id: "trending", label: "Trending", category: null }], search: null, lists: {}, detail: { status: "idle" }, chart: null, range: "1D", action: "buy", side: null, amount: 25, fraction: 1, book: emptyBook(), hydrated: true, notice: null, bought: null });
});

async function openPage(eventId) {
  await usePredict.getState().loadList();
  usePredict.getState().openMarket(eventId);
  await usePredict.getState().loadDetail();
  // loadDetail starts the chart: let it run its plan.
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

test("every pill has a first ask and a coarser one that still covers its range", () => {
  for (const r of RANGES) {
    assert.equal(RANGE_ASK[r], RANGE_ASKS[r][0]);
    assert.ok(RANGE_ASKS[r].length >= 2, r);
  }
  assert.deepEqual(RANGE_ASK["1D"], { resolution: "5m", countBack: 288 });
  assert.deepEqual(RANGE_ASKS["1D"][1], { resolution: "1h", countBack: 24 });
  const plan = chartPlan("o", ["k", "o", "p"], "1W");
  assert.deepEqual(
    plan.map((s) => `${s.outcomeId}:${s.ask.resolution}`),
    ["o:1h", "o:1d", "k:1h", "k:1d", "p:1h", "p:1d"],
    "the market's own outcome first, then the matched venues; never itself twice",
  );
});

test("a coarser size keeps only the points of the range asked", () => {
  const points = [{ t: now - 3 * DAY, p: 0.4 }, { t: now - 20 * HOUR, p: 0.5 }, { t: now - HOUR, p: 0.55 }];
  assert.deepEqual(within(points, "1D", now).map((p) => p.p), [0.5, 0.55]);
  assert.equal(within(points, "ALL", now).length, 3);
  assert.equal(within([{ t: now - 3 * DAY, p: 0.4 }], "1D", now).length, 0, "a market quiet all day draws no line made up for it");
});

test("the engine's bars read as chances, in time order; cents read as a chance too", () => {
  assert.equal(pointsOf(chartBody("o", now, { count: 3, stepMs: HOUR })).length, 3);
  assert.deepEqual(pointsOf({ chart: { bars: [{ t: 3, c: 0.6 }, { t: 1, c: 0.5 }, { t: 2, c: 0.55 }] } }).map((p) => p.p), [0.5, 0.55, 0.6]);
  assert.deepEqual(pointsOf({ chart: { bars: [{ t: 2, c: 58 }, { t: 1, c: 0.5 }, { t: 3, c: 140 }] } }), [{ t: 1, p: 0.5 }, { t: 2, p: 0.58 }]);
  assert.equal(pointsOf({ nope: true }), null);
});

test("1D draws five-minute bars where the venue has them", async () => {
  charts["ev-btc-yes:5m"] = ok(line(0.52, 0.58, 5 * 60_000, 288));
  await openPage("ev-btc");
  const chart = usePredict.getState().chart;
  assert.equal(chart.status, "ready");
  assert.equal(chart.points.length, 288);
  assert.deepEqual(reads, ["ev-btc-yes:5m"]);
});

test("no five-minute bars: the day is drawn from hourly bars", async () => {
  charts["ev-btc-yes:1h"] = ok(line(0.5, 0.58, HOUR, 24));
  await openPage("ev-btc");
  const chart = usePredict.getState().chart;
  assert.equal(chart.status, "ready");
  assert.equal(chart.points.length, 24);
  assert.deepEqual(reads, ["ev-btc-yes:5m", "ev-btc-yes:1h"]);
});

test("a market whose own venue keeps no history is drawn from the venue the engine matched", async () => {
  // The Fed's 25 bps bracket on Polymarket has no bars; Kalshi's matched outcome has them.
  charts["k-hike25-yes:5m"] = ok(line(0.7, 0.765, 5 * 60_000, 200));
  await openPage("ev-fed");
  const st = usePredict.getState();
  assert.equal(st.detail.detail.marketId, "fed-hike25", "the bracket the card led with");
  assert.equal(st.chart.status, "ready");
  assert.equal(st.chart.points.length, 200);
  assert.deepEqual(reads, ["fed-hike25-yes:5m", "fed-hike25-yes:1h", "k-hike25-yes:5m"]);
});

test("every pill works on the real history: 1W, 1M and All each ask their own size", async () => {
  charts["ev-btc-yes:5m"] = ok(line(0.52, 0.58, 5 * 60_000, 288));
  charts["ev-btc-yes:1h"] = ok(line(0.45, 0.58, HOUR, 168));
  charts["ev-btc-yes:1d"] = ok(line(0.3, 0.58, DAY, 120));
  await openPage("ev-btc");
  for (const [range, count] of [["1W", 168], ["1M", 32], ["ALL", 120]]) {
    usePredict.getState().setRange(range);
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    const chart = usePredict.getState().chart;
    assert.equal(chart.key, `ev-btc-yes:${range}`);
    assert.equal(chart.status, "ready", range);
    assert.equal(chart.points.length, count, `${range}: the range's own points`);
  }
});

test("a series AGG is still building is asked again a little later, and drawn once it comes", async () => {
  let calls = 0;
  charts["ev-btc-yes:5m"] = () => (++calls > 1 ? ok(line(0.52, 0.58, 5 * 60_000, 50)) : ok([]));
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    await openPage("ev-btc");
    for (let i = 0; i < 30; i++) await new Promise((r) => realTimeout(r, 0));
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  assert.equal(usePredict.getState().chart.status, "ready");
  assert.equal(usePredict.getState().chart.points.length, 50);
});

test("no history anywhere says so once; an engine that does not answer is an error to try again", async () => {
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    await openPage("ev-sol");
    for (let i = 0; i < 40; i++) await new Promise((r) => realTimeout(r, 0));
    let chart = usePredict.getState().chart;
    assert.equal(chart.status, "ready");
    assert.equal(chart.points.length, 0, "an empty line, never a made-up one");
    assert.equal(reads.length, 2 * (CHART_RETRIES + 1), "asked a bounded number of times");
    for (const key of ["ev-sol-yes:5m", "ev-sol-yes:1h"]) charts[key] = no();
    reads = [];
    usePredict.getState().setRange("1W");
    usePredict.getState().setRange("1D");
    for (let i = 0; i < 20; i++) await new Promise((r) => realTimeout(r, 0));
    chart = usePredict.getState().chart;
    assert.equal(chart.status, "error");
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test("a finger on the chart stands on the nearest point in time, where the line passes", () => {
  const points = [{ t: 0, p: 0.1 }, { t: 10, p: 0.2 }, { t: 90, p: 0.3 }, { t: 100, p: 0.4 }];
  assert.equal(nearestAt(points, 0), 0);
  assert.equal(nearestAt(points, 0.04), 0);
  assert.equal(nearestAt(points, 0.06), 1);
  assert.equal(nearestAt(points, 0.5), 1, "by time, not by count: half way is still the second point");
  assert.equal(nearestAt(points, 0.97), 3);
  assert.equal(nearestAt(points, 2), 3);
  assert.equal(xAt(points, 2), 0.9);
  assert.equal(xAt(points, 3), 1);
  assert.match(momentOf(Date.parse("2026-10-29T15:05:00Z"), "1W"), /Oct 29/);
});
