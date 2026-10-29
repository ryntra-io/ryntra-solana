import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { checkInstrument, checkLive, checkStatus, compatibleContract, loadLikeEngine } from "@ryntra/core/adapters/testing";

import { ArcusChartFeed, PRICE_BASIS, READ_FRESH_MS, STREAM_SILENT_MS, onTick, resolutionOf, stepOf, timeframeOf } from "./arcus-chart-source.ts";

const SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 };
/* A Tuesday, 12:00:00 UTC — every interval's boundary lies on whole minutes from it. */
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const MARKET = { market: "BTC-USD", tick: "0.1", lot: "0.00001", minNotional: "10" };

/** Arcus-shaped candles (openTime in microseconds, decimal strings), oldest first, the newest opening at `NOW`. */
function candles(tf, count, price = 81_900) {
  const size = SECONDS[tf];
  const end = Math.floor(NOW / 1000 / size) * size;
  const out = [];
  let close = price;
  for (let i = count - 1; i >= 0; i -= 1) {
    const open = close;
    close = open * (1 + Math.sin(i) * 0.002);
    out.push({ openTime: (end - i * size) * 1_000_000, open: String(open), high: String(Math.max(open, close) * 1.001), low: String(Math.min(open, close) * 0.999), close: String(close), volume: String(1 + i / 10), isFinal: i > 0 });
  }
  return out;
}

function feedOf(clock = { now: NOW }) {
  const feed = new ArcusChartFeed(MARKET, () => clock.now);
  for (const tf of Object.keys(SECONDS)) feed.put(tf, candles(tf, 120), NOW - 5_000);
  return { feed, clock };
}

test("the intervals, the steps and prices on them, without an exponent", () => {
  for (const tf of Object.keys(SECONDS)) assert.equal(timeframeOf(resolutionOf(tf)), tf);
  assert.equal(timeframeOf({ kind: "time", unit: "second", span: 1 }), null);
  assert.equal(onTick(81_900.04, "0.1"), "81900.0");
  assert.equal(onTick(0.000012345, "0.0000001"), "0.0000123");
  assert.equal(stepOf("1e-5"), "0.01", "an exponent is no step");
  assert.equal(stepOf(undefined, "0.0001"), "0.0001");
});

test("the instrument is a whole perpetual on Arcus, with the venue's steps", async () => {
  const { feed } = feedOf();
  assert.ok(compatibleContract("ryntra.chart/2.0", feed.source.contract));
  const instrument = await feed.source.instrument("BTC-USD");
  assert.deepEqual(checkInstrument(instrument), []);
  assert.equal(instrument.kind, "perp");
  assert.equal(instrument.tick, "0.1");
  assert.equal(instrument.min_notional, "10");
  await assert.rejects(feed.source.instrument("ETH-USD"));
  feed.describe({ tick: "1" });
  assert.equal(feed.instrument.tick, "1");
  feed.dispose();
});

test("every interval loads the way the engine loads it, delayed while only the REST read stands", async () => {
  const { feed } = feedOf();
  const instrument = await feed.source.instrument("BTC-USD");
  const harness = { source: feed.source, instrument: "BTC-USD", audience: "customer", replay: null, truth: null };
  for (const tf of Object.keys(SECONDS)) {
    const problems = [];
    const { bars, pages } = await loadLikeEngine(harness, instrument, resolutionOf(tf), PRICE_BASIS, problems, 50);
    assert.deepEqual(problems, [], tf);
    assert.equal(bars.length, 120, `${tf}: every bar the read had, across pages`);
    const status = pages[0].status;
    assert.deepEqual(checkStatus(status, "customer", tf), []);
    assert.equal(status.state, "delayed");
    assert.equal(status.age_ms, 5_000);
    assert.equal(status.source.label, "Arcus");
    assert.equal(pages[0].display_step, "0.1");
  }
  feed.dispose();
});

test("an interval not read yet is waited for and can be given up; an old read is stale", async () => {
  const clock = { now: NOW };
  const feed = new ArcusChartFeed(MARKET, () => clock.now);
  const request = { instrument: "BTC-USD", resolution: resolutionOf("1h"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 };
  const pending = feed.source.history(request);
  feed.put("1h", candles("1h", 10), NOW - READ_FRESH_MS - 1);
  const page = await pending;
  assert.equal(page.bars.length, 10);
  assert.equal(page.status.state, "stale");
  const controller = new AbortController();
  const waiting = feed.source.history({ ...request, resolution: resolutionOf("4h") }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  await assert.rejects(feed.source.history({ ...request, resolution: { kind: "time", unit: "second", span: 1 } }));
  feed.dispose();
});

test("a live candle alone is no history: the chart waits for the whole read", async () => {
  const feed = new ArcusChartFeed(MARKET, () => NOW);
  const request = { instrument: "BTC-USD", resolution: resolutionOf("1m"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 };
  const all = candles("1m", 30);
  feed.tick("1m", all.at(-1));
  let settled = false;
  const pending = feed.source.history(request).then((page) => { settled = true; return page; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, "one candle from the stream does not answer history");
  feed.put("1m", all, NOW);
  const page = await pending;
  assert.equal(page.bars.length, 30);
  feed.dispose();
});

test("the stream: live while frames come, a bar at most once a second, an older change as a correction, stale when it goes", async () => {
  const { feed, clock } = feedOf();
  const instrument = await feed.source.instrument("BTC-USD");
  const first = await feed.source.history({ instrument: "BTC-USD", resolution: resolutionOf("1m"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 });
  const newest = first.bars.at(-1);
  const events = [];
  const stop = feed.source.subscribe({ instrument: "BTC-USD", resolution: resolutionOf("1m"), basis: PRICE_BASIS }, (event) => events.push(event));

  /* A live candle of the newest minute: it goes out at once, and the state is live. */
  clock.now = NOW + 10_000;
  const live = { openTime: newest.t * 1000, open: newest.o, high: String(Number(newest.h) + 50), low: newest.l, close: String(Number(newest.c) + 40), volume: "3", isFinal: false };
  feed.tick("1m", live);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "bar");
  assert.equal(events[0].status.state, "live");
  assert.ok(feed.live);

  /* A second update within the second waits, and goes out once the second is over. */
  clock.now = NOW + 10_300;
  feed.tick("1m", { ...live, close: String(Number(newest.c) + 45) });
  assert.equal(events.length, 1, "held for the rest of the second");
  clock.now = NOW + 11_100;
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(events.length, 2);
  assert.equal(events[1].bar.c, onTick(Number(newest.c) + 45, "0.1"));

  /* The next minute opens at once. */
  clock.now = NOW + 61_000;
  feed.tick("1m", { ...live, openTime: (newest.t + 60_000) * 1000, open: events[1].bar.c, close: events[1].bar.c });
  assert.equal(events.at(-1).bar.t, newest.t + 60_000);
  assert.deepEqual(checkLive(instrument, events.filter((event) => event.type === "bar"), newest.t, "customer"), []);

  /* A late change of a minute already passed: the screen is told to reload it, never changed silently. */
  feed.tick("1m", { ...live, close: String(Number(newest.c) + 70) });
  const correction = events.find((event) => event.type === "corrected");
  assert.ok(correction, "a correction");
  assert.equal(correction.correction.from, newest.t);

  /* The stream closes: the chart is told at once; with an old read it is stale. */
  clock.now = NOW + 61_000 + STREAM_SILENT_MS + READ_FRESH_MS;
  feed.down();
  assert.equal(events.at(-1).type, "status");
  assert.equal(events.at(-1).status.state, "stale");
  assert.equal(feed.live, false);
  stop();
  feed.dispose();
});

test("the demo terminal draws the core's chart and nothing of the older one", () => {
  const terminal = readFileSync(new URL("./terminal.tsx", import.meta.url), "utf8");
  assert.match(terminal, /import \{ RyntraChart \} from "@ryntra\/core\/chart";/);
  assert.match(terminal, /<RyntraChart[\s\S]*trading=\{trading\}[\s\S]*onDraftMove=\{onDraftMove\}/, "the ticket's plan as draft lines on the core's trading layer");
  assert.match(terminal, /state: "draft"/);
  assert.match(terminal, /useMemo\(\(\) => \(\{ view: PRICE_BASIS, marks: \[\], levels \}\), \[levels\]\)/, "open trades as levels, never dragged");
  assert.match(terminal, /import "@ryntra\/core\/ui\.css";/, "the chart's icon buttons and screen-reader text");
  assert.doesNotMatch(terminal, /ProChart|lightweight-charts|lib\/chart\//);
});
