import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { delayMs, detailsOf, fetchCandles, isDelayed, loading, newerRead, readsDirect, settle } from "./candles.ts";
import { DIRECT_BASE, readCandlesDirect, resetDirect } from "./direct.ts";
import { setLang } from "../i18n/lang.ts";

/* «Delayed 5h» on the bots' charts and SOL's page while «Recurring» drew the same JUP live. The engine reads
   the source from the platform's shared addresses, which the source refuses for hours; the platform's data cache kept
   answering its last good copy, and the engine answered it, stated stale, for up to six hours. The page read the pool
   itself only when the engine had no bars at all. Now held bars that are really behind are followed by the browser's
   own read of the same pool, and «Delayed» stands only over bars really behind their interval. */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const POOL = "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg";
const NOW = Date.parse("2026-11-23T12:00:00Z");
const FIVE_HOURS = 5 * 3_600_000;
const PRICE = 0.42;

const answer = (status, body) => ({ status, json: async () => body, headers: { get: () => null } });
/** Five-minute bars ending `endsAt`, every one at `price`, newest first as the source answers. */
const sourceBars = (endsAt, price) => {
  const t = Math.floor(endsAt / 1000 / 300) * 300;
  return Array.from({ length: 36 }, (_, i) => [t - i * 300, price, price, price, price, 10]);
};
/** The engine's answer as `/api/spot/candles` gives it: quarter hours, the pool it read, when it read them. */
const engineBody = (observedAt, stale) => {
  const t = Math.floor(observedAt / 1000 / 900) * 900;
  return {
    timeframe: "15m",
    candles: Array.from({ length: 12 }, (_, i) => ({ time: t - (11 - i) * 900, open: 0.4, high: 0.4, low: 0.4, close: 0.4, volume: 5 })),
    pool: { address: POOL, side: "base", name: "JUP / SOL", dex: "meteora", reserveUsd: 900000, volume24hUsd: 300000 },
    observedAt: new Date(observedAt).toISOString(),
    stale,
    source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" },
  };
};

const asked = [];
const source = async (url) => {
  asked.push(url);
  return answer(200, { data: { attributes: { ohlcv_list: sourceBars(NOW, PRICE) } } });
};

beforeEach(() => {
  resetDirect();
  asked.length = 0;
  setLang("en");
});

test("the engine's copy five hours old is followed by the browser's own read, and the chart is fresh", async () => {
  // The stale answer as production gave it on 23.11.
  const engine = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - FIVE_HOURS, true)), now: () => NOW });
  assert.equal(engine.status, "ready");
  assert.equal(engine.stale, true);
  assert.deepEqual(engine.ref, { address: POOL, side: "base", name: "JUP / SOL" }, "the answer names the pool it read");
  assert.equal(isDelayed(engine, NOW), true, "five hours behind is a delay");
  assert.equal(readsDirect(engine, "none", null, NOW), true, "held bars hours old: the page reads the pool itself");

  const own = await readCandlesDirect(JUP, "15m", engine.ref, PRICE, { fetch: source, now: () => NOW });
  assert.deepEqual(asked, [`${DIRECT_BASE}/pools/${POOL}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=base`], "the pool the engine named, by address and interval only");
  const shown = newerRead(engine, own);
  assert.equal(shown, own, "the browser's bars are newer");

  const data = settle(loading(JUP, "15m", null), shown);
  assert.equal(data.status, "ready");
  assert.equal(data.last.observedAt, NOW);
  assert.equal(isDelayed(data.last, NOW), false, "no «Delayed»");
  assert.ok(!detailsOf(data, NOW).includes("Delayed"));
});

test("when the browser cannot read the pool either, the engine's bars stay and say how far behind they are", async () => {
  const engine = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - FIVE_HOURS, true)), now: () => NOW });
  const refused = await readCandlesDirect(JUP, "15m", engine.ref, PRICE, { fetch: async () => answer(429, {}), now: () => NOW });
  const shown = newerRead(engine, refused);
  assert.equal(shown, engine);
  const data = settle(loading(JUP, "15m", null), shown);
  assert.equal(isDelayed(data.last, NOW), true);
  assert.ok(detailsOf(data, NOW).includes("Delayed"), "a real delay is said");
});

test("bars the browser reads that miss the price on screen are not drawn over the engine's", async () => {
  const engine = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - FIVE_HOURS, true)), now: () => NOW });
  const own = await readCandlesDirect(JUP, "15m", engine.ref, 4.2, { fetch: source, now: () => NOW });
  assert.equal(own.status, "unavailable");
  assert.equal(newerRead(engine, own), engine);
});

test("a copy a few seconds past fresh is no delay and reads nothing more", async () => {
  // Held past its time, stated stale, but within two of its interval's cache times: the engine is reading behind it.
  const engine = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - 50_000, true)), now: () => NOW });
  assert.equal(engine.stale, true);
  assert.equal(isDelayed(engine, NOW), false);
  assert.equal(readsDirect(engine, "engine", engine, NOW), false);
  // Fresh bars of the engine: never a read of the browser's own.
  const fresh = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - 4_000, false)), now: () => NOW });
  assert.equal(readsDirect(fresh, "none", null, NOW), false);
});

test("a delay is two of the interval's cache times, never under a minute — the engine's own fresh", () => {
  assert.equal(delayMs("1m"), 60_000);
  assert.equal(delayMs("15m"), 90_000);
  assert.equal(delayMs("1h"), 240_000);
  assert.equal(delayMs("1d"), 1_200_000);
  const read = { stale: true, observedAt: NOW - 91_000, timeframe: "15m" };
  assert.equal(isDelayed(read, NOW), true);
  assert.equal(isDelayed({ ...read, stale: false }, NOW), false, "bars nobody called stale are not delayed");
});

test("a refusal reads the pool when the screen's bars are none, the browser's own, or engine bars fallen behind", async () => {
  const refused = { status: "unavailable", reason: "busy", http: 429 };
  const engineBars = await fetchCandles(JUP, "15m", { fetch: async () => answer(200, engineBody(NOW - 30_000, false)), now: () => NOW });
  assert.equal(readsDirect(refused, "none", null, NOW), true);
  assert.equal(readsDirect(refused, "direct", engineBars, NOW), true);
  assert.equal(readsDirect(refused, "engine", engineBars, NOW), false, "the engine's recent bars stay a moment");
  assert.equal(readsDirect(refused, "engine", engineBars, NOW + FIVE_HOURS), true, "…not for hours");
  assert.equal(readsDirect({ status: "unavailable", reason: "offline" }, "none", null, NOW), false, "the engine unreached is no reason to read the source");
  assert.equal(readsDirect({ status: "none", code: "QUIET" }, "none", null, NOW), false, "whether a market has a chart is the engine's to say");
});
