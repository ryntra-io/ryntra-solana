import { test } from "node:test";
import assert from "node:assert/strict";

import { checkInstrument, checkStatus, loadLikeEngine } from "@ryntra/core/adapters/testing";

import { readCandles } from "./candles.ts";
import { marketOf, PRICE_BASIS, resolutionOf, timeframeOf, TowerFeed } from "./feed.ts";

// From the engine's answer to the bars the core chart draws: a tower's read goes through the city's checks into the
// core chart's feed (CH-17), and the chart loads it the way its engine does. No network, a clock that stands.

const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const SECONDS = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400 };

const tower = { id: POPCAT, symbol: "POPCAT", name: "Popcat", icon: null, district: "strip", price: 0.4512, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h: 3.2, volume24h: 0, traders1h: 0, organic: 90, verified: true, launchedAt: null };

/** The engine's answer for one interval: `count` bars ending at the bar before now, prices around 0.45, dollar volume. */
function engineAnswer(timeframe, count) {
  const size = SECONDS[timeframe];
  const end = Math.floor(NOW / 1000 / size) * size;
  const candles = [];
  let close = 0.44;
  for (let i = count; i >= 1; i -= 1) {
    const open = close;
    close = open * (1 + Math.sin(i) * 0.008);
    candles.push({ time: end - i * size, open, high: Math.max(open, close) * 1.003, low: Math.min(open, close) * 0.997, close, volume: 5_000 + i });
  }
  return { timeframe, candles, pool: { name: "POPCAT / SOL" }, observedAt: new Date(NOW - 3_000).toISOString(), stale: false };
}

function feedWith(...timeframes) {
  const feed = new TowerFeed(marketOf(tower), () => NOW);
  for (const timeframe of timeframes) {
    const read = readCandles(timeframe, 200, engineAnswer(timeframe, 90), NOW);
    feed.put(read.timeframe, read.candles, read.observedAt, read.stale, read.pool);
  }
  return feed;
}

test("a tower is the feed's market: a stock on Stock Avenue, the tower's price seeding the step", async () => {
  assert.deepEqual(marketOf(tower), { mint: POPCAT, symbol: "POPCAT", stock: false, capFactor: null, reference: 0.4512 });
  assert.equal(marketOf({ ...tower, district: "avenue" }).stock, true);
  assert.equal(marketOf({ ...tower, price: 0 }).reference, null);
  assert.equal(marketOf({ ...tower, price: Number.NaN }).reference, null);
  const instrument = await feedWith().source.instrument(POPCAT);
  assert.deepEqual(checkInstrument(instrument), []);
  assert.deepEqual(instrument.bases, [PRICE_BASIS], "the tower chart draws the price");
  for (const timeframe of Object.keys(SECONDS)) assert.equal(timeframeOf(resolutionOf(timeframe)), timeframe);
});

test("the engine's bars load into the core chart whole, at every interval, with their source and age", async () => {
  const feed = feedWith(...Object.keys(SECONDS));
  const instrument = await feed.source.instrument(POPCAT);
  const harness = { source: feed.source, instrument: POPCAT, audience: "customer", replay: null, truth: null };
  for (const timeframe of Object.keys(SECONDS)) {
    const problems = [];
    const { bars, pages } = await loadLikeEngine(harness, instrument, resolutionOf(timeframe), PRICE_BASIS, problems, 40);
    assert.deepEqual(problems, [], timeframe);
    assert.equal(bars.length, 90, `${timeframe}: every bar of the read`);
    assert.deepEqual(checkStatus(pages[0].status, "customer", timeframe), []);
    assert.match(pages[0].status.source.label, /^GeckoTerminal · POPCAT \/ SOL/);
    assert.equal(pages[0].status.age_ms, 3_000);
    // The candle's numbers are the engine's, on the step: open of the first bar.
    const first = engineAnswer(timeframe, 90).candles[0];
    assert.equal(bars[0].t, first.time * 1000);
    assert.equal(Number(bars[0].o).toFixed(4), first.open.toFixed(4));
    // Volume: the engine's dollars as the turnover, the coins at the bar's typical price.
    assert.equal(bars[0].turnover, first.volume.toFixed(2));
  }
});

test("the tower's live price closes the newest bar; an interval not read yet waits for its read", async () => {
  const feed = feedWith("15m");
  feed.live(0.4612, NOW);
  const page = await feed.source.history({ instrument: POPCAT, resolution: resolutionOf("15m"), basis: PRICE_BASIS, load: "init", limit: 500, timestamp: null });
  const newest = page.bars.at(-1);
  assert.equal(Number(newest.c), 0.4612, "the bar of the moment closes at the tower's price");
  assert.equal(newest.t, Math.floor(NOW / 1000 / 900) * 900 * 1000);
  // The hour has not been read: history waits for the read, and gets it when it comes.
  const waiting = feed.source.history({ instrument: POPCAT, resolution: resolutionOf("1h"), basis: PRICE_BASIS, load: "init", limit: 500, timestamp: null });
  const read = readCandles("1h", 200, engineAnswer("1h", 30), NOW);
  feed.put(read.timeframe, read.candles, read.observedAt, read.stale, read.pool);
  assert.equal((await waiting).bars.length, 31, "the hour's 30 bars and the one the live price opened");
  feed.dispose();
});

test("a stale read keeps the age of the last good one, and says it is stale", async () => {
  const feed = feedWith("15m");
  const read = readCandles("15m", 200, { ...engineAnswer("15m", 90), stale: true, observedAt: new Date(NOW).toISOString() }, NOW);
  // As the window puts a read that came from a blink: no time of its own.
  feed.put(read.timeframe, read.candles, null, true, read.pool);
  const page = await feed.source.history({ instrument: POPCAT, resolution: resolutionOf("15m"), basis: PRICE_BASIS, load: "init", limit: 10, timestamp: null });
  assert.equal(page.status.state, "stale");
  assert.equal(page.status.age_ms, 3_000, "aged from the last good read");
  feed.dispose();
});
