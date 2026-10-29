import assert from "node:assert/strict";
import test from "node:test";

import { checkInstrument, checkLive, checkPage, checkStatus, compatibleContract, loadLikeEngine } from "@ryntra/core/adapters/testing";

import { CAP_BASIS, PRICE_BASIS, SpotChartFeed, onTick, resolutionOf, tickFor, timeframeOf } from "./core-chart-source.ts";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 };
/* A Tuesday, 12:00:00 UTC — every timeframe's boundary lies on whole minutes from it. */
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

/** GeckoTerminal-shaped candles (unix seconds, dollar volume), oldest first, ending at the bucket before `NOW`. */
function candles(timeframe, count, price = 0.0000231) {
  const size = SECONDS[timeframe];
  const end = Math.floor(NOW / 1000 / size) * size;
  const out = [];
  let close = price;
  for (let i = count; i >= 1; i -= 1) {
    const open = close;
    close = open * (1 + Math.sin(i) * 0.01);
    out.push({ time: end - i * size, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1_000 + i * 10 });
  }
  return out;
}

function feedOf({ capFactor = 88_000_000_000_000, clock = { now: NOW } } = {}) {
  const feed = new SpotChartFeed({ mint: BONK, symbol: "BONK", stock: false, capFactor, reference: 0.0000231 }, () => clock.now);
  for (const timeframe of Object.keys(SECONDS)) feed.put(timeframe, candles(timeframe, 120), NOW - 5_000, false, "BONK / SOL");
  return { feed, clock };
}

test("the price step follows the price's size, and a price prints on it without an exponent", () => {
  assert.equal(tickFor(104.11), "0.01");
  assert.equal(tickFor(0.1408), "0.0001");
  assert.equal(tickFor(0.000003012), "0.000000001");
  assert.equal(onTick(0.000003012, "0.000000001"), "0.000003012");
  assert.equal(onTick(104.116, "0.01"), "104.12");
  assert.equal(onTick(1_234_567_890.4, "1"), "1234567890");
  for (const timeframe of Object.keys(SECONDS)) assert.equal(timeframeOf(resolutionOf(timeframe)), timeframe);
  assert.equal(timeframeOf({ kind: "time", unit: "second", span: 1 }), null);
});

test("the instrument is whole, with the market cap as a second basis only where there is a supply to count it on", async () => {
  const { feed } = feedOf();
  assert.ok(compatibleContract("ryntra.chart/2.0", feed.source.contract));
  const instrument = await feed.source.instrument(BONK);
  assert.deepEqual(checkInstrument(instrument), []);
  assert.equal(instrument.kind, "spot");
  assert.equal(instrument.bases.length, 2);
  const plain = new SpotChartFeed({ mint: BONK, symbol: "BONK", stock: true, capFactor: null, reference: 212 }, () => NOW);
  const stock = await plain.source.instrument(BONK);
  assert.equal(stock.kind, "stock");
  assert.deepEqual(stock.bases, [PRICE_BASIS]);
  await assert.rejects(plain.source.instrument("SOL"));
});

test("every timeframe loads the way the engine loads it, in both bases, with state, source and age", async () => {
  const { feed } = feedOf();
  const instrument = await feed.source.instrument(BONK);
  const harness = { source: feed.source, instrument: BONK, audience: "customer", replay: null, truth: null };
  for (const timeframe of Object.keys(SECONDS)) {
    for (const basis of [PRICE_BASIS, CAP_BASIS]) {
      const problems = [];
      const { bars, pages } = await loadLikeEngine(harness, instrument, resolutionOf(timeframe), basis, problems, 50);
      assert.deepEqual(problems, [], `${timeframe} ${basis.measure}`);
      assert.equal(bars.length, 120, `${timeframe} ${basis.measure}: every bar the read had, across pages`);
      assert.ok(pages.length >= 3, "pages of 50 cover 120 bars");
      const status = pages[0].status;
      assert.deepEqual(checkStatus(status, "customer", timeframe), []);
      assert.equal(status.state, "delayed");
      assert.equal(status.age_ms, 5_000);
      assert.match(status.source.label, /^GeckoTerminal · BONK \/ SOL$/);
      if (basis.measure === "market_cap") {
        assert.equal(pages[0].display_step, "1");
        assert.ok(Number(bars[0].c) > 1_000_000, "the cap is the price times the supply");
      } else assert.equal(pages[0].display_step, "0.00000001");
      assert.ok(status.delay_ms > 0, "the delay Ryntra's server keeps a read for");
    }
  }
});

test("a stale read says so; a timeframe not read yet is waited for and can be given up", async () => {
  const clock = { now: NOW };
  const feed = new SpotChartFeed({ mint: BONK, symbol: "BONK", stock: false, capFactor: null, reference: 0.0000231 }, () => clock.now);
  const request = { instrument: BONK, resolution: resolutionOf("1h"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 };
  const pending = feed.source.history(request);
  feed.put("1h", candles("1h", 10), NOW - 600_000, true);
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

test("the live price closes the bar of the moment, at most once a second, and a changed older bar comes as a correction", async () => {
  const { feed, clock } = feedOf({ capFactor: null });
  const instrument = await feed.source.instrument(BONK);
  const first = await feed.source.history({ instrument: BONK, resolution: resolutionOf("1m"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 });
  const newest = first.bars.at(-1).t;
  const events = [];
  const stop = feed.source.subscribe({ instrument: BONK, resolution: resolutionOf("1m"), basis: PRICE_BASIS }, (event) => events.push(event));

  /* The moment's minute has no bar from the source yet: the live price opens it from the last close. */
  clock.now = NOW + 10_000;
  const lastClose = Number(first.bars.at(-1).c);
  feed.live(lastClose * 1.01, clock.now);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "bar");
  assert.equal(events[0].bar.t, NOW);
  assert.equal(events[0].bar.c, onTick(lastClose * 1.01, "0.00000001"));

  /* A second price within the second waits, and goes out once the second is over. */
  clock.now = NOW + 10_300;
  feed.live(lastClose * 1.02, clock.now);
  assert.equal(events.length, 1, "held for the rest of the second");
  clock.now = NOW + 11_100;
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(events.length, 2);
  assert.equal(events[1].bar.t, NOW);
  assert.equal(events[1].bar.c, onTick(lastClose * 1.02, "0.00000001"));

  /* A new read in which a bar the screen holds changed: the screen is told to reload, never changed silently. */
  const next = candles("1m", 120);
  next[100] = { ...next[100], close: next[100].close * 1.05, high: next[100].high * 1.05 };
  clock.now = NOW + 20_000;
  feed.put("1m", next, clock.now, false);
  const correction = events.find((event) => event.type === "corrected");
  assert.ok(correction, "a correction");
  assert.equal(correction.correction.instrument, BONK);
  assert.ok(correction.correction.from < newest + 60_000);
  assert.deepEqual(checkLive(instrument, events.filter((event) => event.type !== "corrected"), newest, "customer"), []);
  stop();
  feed.dispose();
});

test("the market cap's bars are the price's bars times the supply, on whole dollars", async () => {
  const { feed } = feedOf({ capFactor: 1_000_000 });
  const instrument = await feed.source.instrument(BONK);
  const request = { instrument: BONK, resolution: resolutionOf("1h"), basis: CAP_BASIS, load: "init", timestamp: null, limit: 500 };
  const cap = await feed.source.history(request);
  const price = await feed.source.history({ ...request, basis: PRICE_BASIS });
  assert.deepEqual(checkPage(instrument, request, cap, "customer"), []);
  const at = cap.bars.length - 1;
  assert.equal(cap.bars[at].c, onTick(Number(price.bars[at].c) * 1_000_000, "1"));
});

test("a price far under the first step keeps its bars: the step follows the smallest price read", async () => {
  const feed = new SpotChartFeed({ mint: BONK, symbol: "BONK", stock: false, capFactor: null, reference: 0.001 }, () => NOW);
  assert.equal(feed.tick, "0.000001");
  const cheap = candles("1h", 20, 0.0000004);
  feed.put("1h", cheap, NOW - 1_000, false);
  const page = await feed.source.history({ instrument: BONK, resolution: resolutionOf("1h"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 });
  assert.equal(page.bars.length, 20, "no bar rounds to nothing");
  assert.equal(page.display_step, tickFor(Math.min(...cheap.map((c) => c.low))));
  const first = page.bars[0];
  assert.ok(Math.abs(Number(first.c) / cheap[0].close - 1) < 0.001, "the price within a tenth of a percent, not rounded to the old step");
});

test("a failed read keeps the time of the last good one, and the market's cap comes in when the page reads it", async () => {
  const clock = { now: NOW };
  const feed = new SpotChartFeed({ mint: BONK, symbol: "BONK", stock: false, capFactor: null, reference: 0.0000231 }, () => clock.now);
  feed.put("1h", candles("1h", 10), NOW - 30_000, false);
  clock.now = NOW + 120_000;
  feed.put("1h", candles("1h", 10), null, true);
  const request = { instrument: BONK, resolution: resolutionOf("1h"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 };
  const page = await feed.source.history(request);
  assert.equal(page.status.state, "stale");
  assert.equal(page.status.age_ms, 150_000, "aged from the last good read, not from the failure");
  await assert.rejects(feed.source.history({ ...request, basis: CAP_BASIS }));
  feed.describe({ capFactor: 1_000 });
  assert.equal((await feed.source.history({ ...request, basis: CAP_BASIS })).status.derived, true, "the cap is ours, counted from the price");
});

test("the last state of a bar goes out before the next one opens, and a bar the live price opened has no volume yet", async () => {
  const { feed, clock } = feedOf({ capFactor: null });
  await feed.source.history({ instrument: BONK, resolution: resolutionOf("1m"), basis: PRICE_BASIS, load: "init", timestamp: null, limit: 500 });
  const events = [];
  const stop = feed.source.subscribe({ instrument: BONK, resolution: resolutionOf("1m"), basis: PRICE_BASIS }, (event) => events.push(event));
  clock.now = NOW + 10_000;
  feed.live(0.0000235, clock.now);
  assert.equal(events.at(-1).bar.v, null);
  assert.equal(events.at(-1).bar.turnover, null);
  clock.now = NOW + 10_200;
  feed.live(0.0000236, clock.now);
  const held = events.length;
  clock.now = NOW + 60_500;
  feed.live(0.0000237, clock.now);
  const after = events.slice(held);
  assert.equal(after[0].bar.t, NOW, "the closing state of the minute first");
  assert.equal(after[0].bar.c, onTick(0.0000236, feed.tick));
  assert.equal(after[1].bar.t, NOW + 60_000, "then the next minute");
  stop();
  feed.dispose();
});

test("one broken wick does not make every price print ten zeros, and the cap's supply moves the bars only when it truly moved", () => {
  const feed = new SpotChartFeed({ mint: BONK, symbol: "SOL", stock: false, capFactor: 1_000, reference: 152 }, () => NOW);
  const bars = candles("1h", 5, 152).map((candle, index) => (index === 2 ? { ...candle, low: 0.0000001 } : candle));
  feed.put("1h", bars, NOW - 1_000, false);
  assert.equal(feed.tick, "0.01");
  feed.describe({ capFactor: 1_000.0004 });
  feed.describe({ capFactor: 1_002 });
  feed.put("1h", bars, NOW - 1_000, false);
  assert.equal(feed.tick, "0.01");
});
