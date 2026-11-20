import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { agedRead, getJson, readMarketTrades, readSpotCandles, readTokenPoolsBody, resetSpotCandleCaches, spotReadsBehind } from "./candles.server.ts";
import { resetJupiterBudget } from "../solana/jupiter-budget.ts";
import { resetSpotMarketCaches } from "./markets.server.ts";
import { ratePauseLeftMs } from "./shared-reads.ts";

/* The chart and the token page asking for one mint at once are one read of the chart source, and after its 429
   nothing is asked of it until its pause ends. */

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "Pool111111111111111111111111111111111111111";

const realFetch = globalThis.fetch;
let gecko = [];
let status = 200;
/* The source's bars, newest first as it answers; empty unless a test sets them. */
let bars = [];
/* While set, the source does not answer until it resolves. */
let gate = null;
/* The catalogue's price of BONK; null — the catalogue does not answer. */
let catalogue = null;
/* A pool's trades as the source answers them: one trade per pool, a second before the read. */
const tradesOfPool = (href) => {
  const pool = href.split("/pools/")[1].split("/")[0];
  return { data: [{ attributes: { tx_hash: `sig-${pool}`, block_timestamp: new Date(Date.now() - 1_000).toISOString(), tx_from_address: "Wa11et1111111111111111111111111111111111111", to_token_address: BONK, from_token_address: USDC, to_token_amount: "100", from_token_amount: "1", price_to_in_usd: "0.01", price_from_in_usd: "1", volume_in_usd: "1" } }] };
};

const poolsBody = {
  data: [
    {
      attributes: { address: POOL, name: "BONK / USDC", reserve_in_usd: "2500000", volume_usd: { h24: "900000" } },
      relationships: { base_token: { data: { id: `solana_${BONK}` } }, quote_token: { data: { id: `solana_${USDC}` } }, dex: { data: { id: "orca" } } },
    },
  ],
};

beforeEach(() => {
  resetSpotCandleCaches();
  resetSpotMarketCaches();
  gecko = [];
  status = 200;
  bars = [];
  gate = null;
  catalogue = null;
  resetJupiterBudget();
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (catalogue !== null && href.includes("/tokens/v2")) {
      const row = { id: BONK, name: "Bonk", symbol: "Bonk", decimals: 5, tags: ["verified"], isVerified: true, usdPrice: catalogue, dev: "Dev1111111111111111111111111111111111111111", stats24h: { priceChange: 1, buyVolume: 1_000_000, sellVolume: 900_000 }, liquidity: 9_000_000, audit: {} };
      return new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!href.startsWith("https://api.geckoterminal.com/")) return new Response("{}", { status: 500 });
    gecko.push(href.replace("https://api.geckoterminal.com/api/v2/networks/solana", ""));
    if (gate) await gate;
    if (status === 429) return new Response("{}", { status: 429, headers: { "retry-after": "12" } });
    if (href.includes("/ohlcv/")) return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: bars } } }), { status: 200 });
    if (href.includes("/trades")) return new Response(JSON.stringify(tradesOfPool(href)), { status: 200 });
    return new Response(JSON.stringify(poolsBody), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the chart and the page's pools asking for one mint at once read its pools once", async () => {
  const [chart, page] = await Promise.all([readTokenPoolsBody(BONK, "chart"), readTokenPoolsBody(BONK, "page")]);
  assert.equal(chart.ok && page.ok, true);
  assert.equal(gecko.length, 1);
});

test("the same chart opened at once is one read of its pool and one of its candles", async () => {
  const answers = await Promise.all([readSpotCandles(BONK, "1h"), readSpotCandles(BONK, "1h"), readSpotCandles(BONK, "1h")]);
  for (const answer of answers) assert.equal(answer.ok, true);
  assert.deepEqual(gecko.map((path) => path.split("?")[0]), [`/tokens/${BONK}/pools`, `/pools/${POOL}/ohlcv/hour`]);
});

test("bars read before stay through a long refusal for rate, stated stale (hours, not half an hour)", async () => {
  const first = await readSpotCandles(BONK, "1h");
  assert.equal(first.ok && first.stale, false);
  status = 429;
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3_600_000;
  try {
    const later = await readSpotCandles(BONK, "1h");
    assert.equal(later.ok, true, "two hours on, the last bars are still answered");
    assert.equal(later.stale, true);
  } finally {
    Date.now = realNow;
  }
});

test("a spent minute's budget says how long until it has a call again", async () => {
  let refused = null;
  for (let i = 0; i < 30 && !refused; i += 1) {
    const read = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/p${i}/trades`);
    if (!read.ok) refused = read;
  }
  assert.ok(refused, "the budget ran out within thirty calls");
  assert.equal(refused.code, "RATE_LIMITED");
  assert.ok(refused.retryAfterMs >= 1_000 && refused.retryAfterMs <= 60_000);
});

test("bars older than three of their interval's cache times are stated stale wherever they were kept", () => {
  const read = { ok: true, timeframe: "1h", candles: [], pool: {}, observedAt: new Date(1_000_000).toISOString(), stale: false, source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" } };
  assert.equal(agedRead(read, "1h", 1_000_000 + 60_000).stale, false);
  assert.equal(agedRead(read, "1h", 1_000_000 + 7 * 60_000).stale, true);
});

test("after the chart source's 429 nothing is asked of it until the pause ends; a chart read before stays, stated stale", async () => {
  const first = await readSpotCandles(BONK, "1m");
  assert.equal(first.ok && first.stale, false);
  status = 429;
  const refused = await getJson("https://api.geckoterminal.com/api/v2/networks/solana/pools/x/trades");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RATE_LIMITED");
  assert.ok(ratePauseLeftMs("geckoterminal") > 11_000, "the source's own twelve seconds");
  const asked = gecko.length;
  const paused = await getJson("https://api.geckoterminal.com/api/v2/networks/solana/pools/y/trades");
  assert.equal(paused.ok, false);
  assert.equal(paused.code, "RATE_LIMITED");
  assert.ok(paused.retryAfterMs > 0);
  assert.equal(gecko.length, asked, "no call inside the pause");
});

/* Fewer reads, nobody waiting on one. */

const bar = (secondsAgo, price) => [Math.floor(Date.now() / 1000 / 300) * 300 - secondsAgo, price, price, price, price, 10];

test("the six intervals cost the source four reads: the quarter hours ride the five minutes, the four hours the hours", async () => {
  bars = Array.from({ length: 40 }, (_, i) => bar(i * 300, 0.01));
  for (const tf of ["1m", "5m", "15m", "1h", "4h", "1d"]) assert.equal((await readSpotCandles(BONK, tf)).ok, true, tf);
  const ohlcv = gecko.filter((path) => path.includes("/ohlcv/")).map((path) => path.split("/ohlcv/")[1].split("&limit")[0]);
  assert.deepEqual(ohlcv, ["minute?aggregate=1", "minute?aggregate=5", "hour?aggregate=1", "day?aggregate=1"]);
  const quarter = await readSpotCandles(BONK, "15m");
  assert.ok(quarter.ok && quarter.candles.every((candle) => candle.time % 900 === 0), "quarter-hour bars open on the quarter");
});

test("bars held past fresh are answered at once, stated stale, and read again behind the answer", async () => {
  bars = [bar(0, 0.01), bar(300, 0.01)];
  assert.equal((await readSpotCandles(BONK, "5m")).ok, true);
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60_000;
  let open;
  gate = new Promise((resolve) => (open = resolve));
  try {
    const before = gecko.length;
    const held = await readSpotCandles(BONK, "5m");
    assert.equal(held.ok && held.stale, true, "the held bars, said as stale, while the source has not answered");
    const behind = spotReadsBehind();
    assert.ok(behind, "a read runs behind the answer");
    open();
    gate = null;
    await behind;
    assert.ok(gecko.length > before, "and asked the source");
    const fresh = await readSpotCandles(BONK, "5m");
    assert.equal(fresh.ok && fresh.stale, false);
  } finally {
    Date.now = realNow;
  }
});

test("held bars that no longer agree with the market price are not answered, at once or through a refusal", async () => {
  catalogue = 0.01;
  bars = [bar(0, 0.01), bar(300, 0.01)];
  assert.equal((await readSpotCandles(BONK, "5m")).ok, true);
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60_000;
  try {
    catalogue = 0.02;
    status = 429;
    const read = await readSpotCandles(BONK, "5m");
    assert.equal(read.ok, false, "bars at half the price on screen are not drawn");
    assert.equal(read.code, "RATE_LIMITED");
  } finally {
    Date.now = realNow;
  }
});

test("an interval refused with nothing held stands on a finer read's bars, gathered and stated stale", async () => {
  bars = Array.from({ length: 36 }, (_, i) => bar(i * 300, 0.01));
  assert.equal((await readSpotCandles(BONK, "5m")).ok, true);
  status = 429;
  const hour = await readSpotCandles(BONK, "1h");
  assert.equal(hour.ok, true, "the hour from the five minutes held");
  assert.equal(hour.stale, true);
  assert.ok(hour.candles.length >= 3 && hour.candles.every((candle) => candle.time % 3_600 === 0));
});

test("a refusal with nothing held names the pool the chart would read, for the person's browser", async () => {
  assert.equal((await readTokenPoolsBody(BONK)).ok, true);
  status = 429;
  const refused = await readSpotCandles(BONK, "1h");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RATE_LIMITED");
  assert.equal(refused.pool?.address, POOL);
});

test("a coin's own market pool is drawn only against a known market price; with none it is a blink, asked again", async () => {
  const OTHER = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
  const saved = poolsBody.data.splice(0);
  poolsBody.data.push({
    attributes: { address: POOL, name: "BONK / ANTHRP", reserve_in_usd: "19895", volume_usd: { h24: "409152" } },
    relationships: { base_token: { data: { id: `solana_${BONK}` } }, quote_token: { data: { id: `solana_${OTHER}` } }, dex: { data: { id: "pumpswap" } } },
  });
  bars = Array.from({ length: 10 }, (_, i) => bar(i * 300, 0.01));
  try {
    /* The catalogue is not reachable here (every non-source read answers 500): no price to check the market pool's bars against. */
    const read = await readSpotCandles(BONK, "5m");
    assert.equal(read.ok, false);
    assert.equal(read.code, "UNREACHABLE", "not drawn, and not remembered as a verdict");
    assert.equal(read.pool?.address, POOL, "the pool is named for the browser, which checks against the price on screen");
  } finally {
    poolsBody.data.splice(0, poolsBody.data.length, ...saved);
  }
});

test("a coin's trades are read from its two busiest pools now, merged newest first", async () => {
  const SECOND = "Bus22222222222222222222222222222222222222222";
  const THIRD = "Bus33333333333333333333333333333333333333333";
  const busy = (address, m5, h24) => ({
    attributes: { address, name: "BONK / USDC", reserve_in_usd: "1000000", volume_usd: { h24: String(h24) }, transactions: { m5: { buys: m5, sells: 0 }, h1: { buys: m5 * 10, sells: 0 } } },
    relationships: { base_token: { data: { id: `solana_${BONK}` } }, quote_token: { data: { id: `solana_${USDC}` } }, dex: { data: { id: "meteora" } } },
  });
  poolsBody.data.push(busy(SECOND, 60, 10), busy(THIRD, 20, 90_000_000), busy("Bus44444444444444444444444444444444444444444", 3, 1_000));
  try {
    const read = await readMarketTrades(BONK);
    assert.equal(read.ok, true);
    assert.deepEqual(read.pools.map((pool) => pool.address), [SECOND, THIRD], "the five minutes' trades decide, not the day's dollars");
    assert.equal(read.bodies.length, 2);
    assert.deepEqual(gecko.filter((path) => path.includes("/trades")).map((path) => path.split("/")[2]).sort(), [SECOND, THIRD].sort(), "the request names the pool only");
  } finally {
    poolsBody.data.splice(1);
  }
});
