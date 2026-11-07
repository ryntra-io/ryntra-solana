import { test } from "node:test";
import assert from "node:assert/strict";

import {
  candlesOf,
  candlesUrl,
  DEFAULT_TIMEFRAME,
  fetchCandles,
  loading,
  nextReadMs,
  QUIET_MISSES,
  readCandles,
  refreshMs,
  RETRY_AFTER_MAX_MS,
  RETRY_MAX_MS,
  RETRY_MS,
  retryAfterOf,
  retryDelayMs,
  saysUnavailable,
  settle,
  TIMEFRAMES,
  timeframeFrom,
  whyNoChart,
} from "./candles.ts";

// The tower chart's candles: what `/api/spot/candles` answers, checked before the core chart draws a bar of it.
// No network: the engine's answers are written out here.

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const bar = (time, open, high, low, close, volume) => ({ time, open, high, low, close, ...(volume === undefined ? {} : { volume }) });
const answer = (body, timeframe = "15m") => ({ timeframe, candles: [], pool: { name: "JUP / SOL" }, observedAt: new Date(NOW - 4_000).toISOString(), stale: false, source: "geckoterminal", ...body });

test("the intervals are the engine's own, a quarter hour first, and a stored one is kept only if the engine reads it", () => {
  assert.deepEqual(TIMEFRAMES, ["1m", "5m", "15m", "1h", "4h", "1d"]);
  assert.equal(DEFAULT_TIMEFRAME, "15m");
  assert.equal(timeframeFrom("4h"), "4h");
  assert.equal(timeframeFrom("1s"), "15m", "a second is not read for Solana spot yet");
  assert.equal(timeframeFrom(null), "15m");
  assert.equal(timeframeFrom(42), "15m");
  // A minute's bars are asked again at the floor, a day's at the engine's own ten minutes.
  assert.equal(refreshMs("1m"), 20_000);
  assert.equal(refreshMs("5m"), 45_000);
  assert.equal(refreshMs("1d"), 600_000);
  assert.ok(RETRY_MS < refreshMs("1m"), "a failed read is tried again before the next regular one");
  assert.equal(candlesUrl(JUP, "1h"), `/api/spot/candles?mint=${JUP}&tf=1h`);
});

test("the engine's bars become candles: oldest first, one per open, broken ones left out", () => {
  const candles = candlesOf([
    bar(1_000_000_900, 0.51, 0.52, 0.5, 0.515, 1200),
    bar(1_000_000_000, 0.5, 0.512, 0.495, 0.51, 800),
    bar(1_000_001_800, 0.515, 0.53, 0.51, 0.52),
    // The same open read twice: the later row wins.
    bar(1_000_000_900, 0.51, 0.525, 0.5, 0.52, 1300),
    // A zero, a negative, a non-number, a high under the close, a low over the open, a time that is not whole.
    bar(1_000_002_700, 0, 0.5, 0.4, 0.45),
    bar(1_000_003_600, 0.5, 0.6, -1, 0.55),
    bar(1_000_004_500, "0.5", 0.6, 0.4, 0.55),
    bar(1_000_005_400, 0.5, 0.52, 0.48, 0.53),
    bar(1_000_006_300, 0.5, 0.52, 0.51, 0.515),
    bar(1_000_007_200.5, 0.5, 0.52, 0.48, 0.51),
    null,
    "bar",
  ]);
  assert.deepEqual(
    candles.map((c) => c.time),
    [1_000_000_000, 1_000_000_900, 1_000_001_800],
  );
  assert.deepEqual(candles[1], { time: 1_000_000_900, open: 0.51, high: 0.525, low: 0.5, close: 0.52, volume: 1300 });
  assert.equal("volume" in candles[2], false, "a bar the source gave no volume has none, not a zero");
  assert.deepEqual(candlesOf({ candles: [] }), []);
  assert.deepEqual(candlesOf(undefined), []);
  // A negative or broken volume is not a volume.
  assert.equal("volume" in candlesOf([bar(1, 1, 1, 1, 1, -5)])[0], false);
});

test("a ready answer carries its interval, its pool, its time and whether the source is behind", () => {
  const read = readCandles("15m", 200, answer({ candles: [bar(1_000_000_000, 0.5, 0.51, 0.49, 0.5, 10)] }), NOW);
  assert.equal(read.status, "ready");
  assert.equal(read.timeframe, "15m");
  assert.equal(read.pool, "JUP / SOL");
  assert.equal(read.observedAt, NOW - 4_000);
  assert.equal(read.stale, false);
  assert.equal(read.candles.length, 1);
  const held = readCandles("15m", 200, answer({ candles: [bar(1, 1, 1, 1, 1)], stale: true, pool: null, observedAt: "later" }), NOW);
  assert.equal(held.stale, true);
  assert.equal(held.pool, null);
  assert.equal(held.observedAt, NOW, "a read without a time of its own is as old as now");
  // A clock ahead of ours never makes the age negative.
  assert.equal(readCandles("15m", 200, answer({ candles: [bar(1, 1, 1, 1, 1)], observedAt: new Date(NOW + 60_000).toISOString() }), NOW).observedAt, NOW);
});

test("empty and failed answers say what they are, never an empty chart", () => {
  // The engine's reasons for a market without a chart.
  for (const code of ["NO_POOL", "NO_MAJOR_QUOTE", "THIN", "QUIET", "STALE", "PRICE_MISMATCH"]) {
    assert.deepEqual(readCandles("1h", 404, { error: { code: `CANDLES_${code}`, message: "…" } }, NOW), { status: "none", code });
  }
  assert.deepEqual(readCandles("1h", 404, { error: { code: "CANDLES_SOMETHING_NEW" } }, NOW), { status: "none", code: null });
  assert.deepEqual(readCandles("1h", 404, null, NOW), { status: "none", code: null });
  // An answer with no usable bar is a market without a chart, said as such.
  assert.deepEqual(readCandles("1h", 200, answer({ candles: [] }, "1h"), NOW), { status: "none", code: "EMPTY" });
  assert.deepEqual(readCandles("1h", 200, answer({ candles: [bar(1, 0, 0, 0, 0)] }, "1h"), NOW), { status: "none", code: "EMPTY" });
  // The source, not the market: the last bars stay.
  assert.deepEqual(readCandles("1h", 429, { error: { code: "RATE_LIMITED" } }, NOW), { status: "unavailable", reason: "busy" });
  assert.deepEqual(readCandles("1h", 503, { error: { code: "CANDLES_UPSTREAM" } }, NOW), { status: "unavailable", reason: "failed" });
  assert.deepEqual(readCandles("1h", 200, "not json", NOW), { status: "unavailable", reason: "failed" });
  // An answer for another interval (the person switched while it travelled) is not this interval's.
  assert.deepEqual(readCandles("1h", 200, answer({ candles: [bar(1, 1, 1, 1, 1)] }, "4h"), NOW), { status: "unavailable", reason: "failed" });
  // Each reason has one sentence; an unknown one reads as no pool.
  for (const code of ["NO_POOL", "NO_MAJOR_QUOTE", "THIN", "QUIET", "STALE", "PRICE_MISMATCH", "EMPTY"]) assert.match(whyNoChart(code), /\.$/);
  assert.equal(whyNoChart(null), whyNoChart("NO_POOL"));
});

test("a read never throws: a network down is offline, a page that is not JSON failed", async () => {
  const deps = (fetch) => ({ fetch, now: () => NOW });
  const asked = [];
  const ok = await fetchCandles(JUP, "15m", deps(async (url) => (asked.push(url), { status: 200, json: async () => answer({ candles: [bar(1, 1, 1, 1, 1)] }) })));
  assert.equal(ok.status, "ready");
  assert.deepEqual(asked, [candlesUrl(JUP, "15m")]);
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(async () => Promise.reject(new TypeError("Failed to fetch")))), { status: "unavailable", reason: "offline" });
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(async () => ({ status: 200, json: async () => JSON.parse("<html>") }))), { status: "unavailable", reason: "failed" });
  // A 404 page that is not JSON is still a market without a chart.
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(async () => ({ status: 404, json: async () => JSON.parse("") }))), { status: "none", code: null });
});

test("the window keeps the last good bars through a blink, drops them for a market without a chart, and never shows another market's", () => {
  const ready = readCandles("15m", 200, answer({ candles: [bar(1, 1, 1, 1, 1)] }), NOW);
  let state = loading(JUP, "15m", null);
  assert.deepEqual(state, { mint: JUP, timeframe: "15m", status: "loading", last: null, code: null, misses: 0 });
  state = settle(state, ready);
  assert.equal(state.status, "ready");
  assert.equal(state.last, ready);
  // The source blinked: the bars stay, marked stale.
  const blink = settle(state, { status: "unavailable", reason: "busy" });
  assert.equal(blink.status, "unavailable");
  assert.equal(blink.last.stale, true);
  assert.deepEqual(blink.last.candles, ready.candles);
  // Read again for the same market and interval: the bars stay on screen while it loads.
  assert.equal(loading(JUP, "15m", blink).last, blink.last);
  // Another interval or another market starts from an empty frame.
  assert.equal(loading(JUP, "1h", blink).last, null);
  assert.equal(loading("So11111111111111111111111111111111111111112", "15m", blink).last, null);
  // A market without a chart says why and holds no bars.
  const none = settle(state, { status: "none", code: "THIN" });
  assert.deepEqual([none.status, none.last, none.code], ["none", null, "THIN"]);
  // Nothing read yet and the source is down: nothing to show, and nothing invented.
  assert.equal(settle(loading(JUP, "15m", null), { status: "unavailable", reason: "offline" }).last, null);
});

// CITY-215: the first chart on a phone met a 429 and said «Chart unavailable» for ~20 s. Now a failed read is tried
// again in silence, never before the engine's Retry-After, and the line shows only after a few failed tries in a row.

test("a refused read is tried again quietly: sooner first, then less often, never before Retry-After", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map((misses) => retryDelayMs(misses)), [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  assert.equal(RETRY_MS, 2_000);
  assert.equal(RETRY_MAX_MS, 30_000);
  // The engine asked for a pause: it is waited out; a longer one than the backoff wins, a shorter one does not.
  assert.equal(retryDelayMs(1, 12_000), 12_000);
  assert.equal(retryDelayMs(4, 3_000), 16_000);
  // A pause beyond reason is not waited whole: the chart asks again by the minute.
  assert.equal(retryDelayMs(1, 3_600_000), RETRY_AFTER_MAX_MS);
  assert.equal(retryDelayMs(1, Number.NaN), 2_000);
  assert.equal(retryDelayMs(1, -5), 2_000);
  // After an answer, the interval's own cadence; after a failure, the quiet retry.
  assert.equal(nextReadMs({ status: "none", code: "THIN" }, 0, "1m"), refreshMs("1m"));
  assert.equal(nextReadMs({ status: "unavailable", reason: "busy", retryAfterMs: 9_000 }, 1, "1d"), 9_000);
  assert.equal(nextReadMs({ status: "unavailable", reason: "offline" }, 2, "1d"), 4_000);
  assert.ok(retryDelayMs(1) < refreshMs("1m"), "a failed read is tried again before the next regular one");
});

test("Retry-After is read in both of HTTP's forms", () => {
  assert.equal(retryAfterOf("7", NOW), 7_000);
  assert.equal(retryAfterOf(" 0 ", NOW), 0);
  assert.equal(retryAfterOf(new Date(NOW + 15_000).toUTCString(), NOW), 15_000);
  assert.equal(retryAfterOf(new Date(NOW - 15_000).toUTCString(), NOW), 0);
  assert.equal(retryAfterOf(null, NOW), null);
  assert.equal(retryAfterOf("", NOW), null);
  assert.equal(retryAfterOf("soon", NOW), null);
});

test("a 429 carries the engine's Retry-After to the next try; an answer without one carries nothing", async () => {
  const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });
  const deps = (status, map) => ({ fetch: async () => ({ status, json: async () => ({ error: { code: "RATE_LIMITED" } }), headers: headers(map) }), now: () => NOW });
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(429, { "retry-after": "20" })), { status: "unavailable", reason: "busy", retryAfterMs: 20_000 });
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(503, { "retry-after": "3" })), { status: "unavailable", reason: "failed", retryAfterMs: 3_000 });
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(429, {})), { status: "unavailable", reason: "busy" });
  // A 404 is a market without a chart whatever the headers say.
  assert.deepEqual(await fetchCandles(JUP, "15m", deps(404, { "retry-after": "5" })), { status: "none", code: null });
});

test("«Chart unavailable» only after a few failed reads in a row with no bars; one good read starts the count again", () => {
  const busy = { status: "unavailable", reason: "busy" };
  let state = loading(JUP, "15m", null);
  for (let i = 1; i < QUIET_MISSES; i += 1) {
    state = settle(state, busy);
    assert.equal(state.misses, i);
    assert.equal(saysUnavailable(state), false, `try ${i} failed: the frame still only waits`);
    // The next try starts on the same market and interval: the count is kept.
    state = loading(JUP, "15m", state);
    assert.equal(state.misses, i);
  }
  state = settle(state, busy);
  assert.equal(saysUnavailable(state), true, "several tries failed: now it says so");
  // The bars come: the count starts again, and a later blink keeps them on screen without a word.
  state = settle(state, readCandles("15m", 200, answer({ candles: [bar(1, 1, 1, 1, 1)] }), NOW));
  assert.equal(state.misses, 0);
  state = settle(state, busy);
  assert.equal(saysUnavailable(state), false);
  // Another market or interval counts from nothing.
  assert.equal(loading(JUP, "1h", state).misses, 0);
  // A market without a chart is no failure.
  assert.equal(settle(state, { status: "none", code: "THIN" }).misses, 0);
});
