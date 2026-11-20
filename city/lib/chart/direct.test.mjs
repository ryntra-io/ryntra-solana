import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { fetchCandles } from "./candles.ts";
import { DIRECT_BASE, DIRECT_PER_MINUTE, namedPool, namedPools, readCandlesDirect, readTradesDirect, resetDirect } from "./direct.ts";

/* The chart's spare way: the same source from the person's browser, only after the engine refused, only the
   pool and the interval in the request, and only bars that pass the engine's own check against the price on screen. */

const MINT = "5a6mAmWbL3Na2KhwV1LmmAUSf12Gy1vd3NjqBq24pump";
const QUOTE = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
const POOL = "BEwNJ8qpYk2Kx9bSZcZ3ptAQd7HUfhZ8e2C6Q2KWkkXv";
const NOW = Date.parse("2026-11-19T12:00:00Z");

const asked = [];
let ohlcvPrice = 0.0000968;
let refuse = false;

const answer = (status, body, headers = {}) => ({ status, json: async () => body, headers: { get: (name) => headers[name] ?? null } });
const fake = async (url) => {
  asked.push(url);
  if (refuse) return answer(429, {}, { "retry-after": "20" });
  if (url.includes("/ohlcv/")) {
    const t = Math.floor(NOW / 1000 / 300) * 300;
    return answer(200, { data: { attributes: { ohlcv_list: [0, 1, 2, 3, 4, 5].map((i) => [t - i * 300, ohlcvPrice, ohlcvPrice, ohlcvPrice, ohlcvPrice, 10]) } } });
  }
  if (url.includes("/trades")) {
    return answer(200, { data: [{ attributes: { tx_hash: "sig1", block_timestamp: new Date(NOW - 4_000).toISOString(), tx_from_address: "Wa11et1111111111111111111111111111111111111", to_token_address: MINT, from_token_address: QUOTE, to_token_amount: "1000", from_token_amount: "1", price_to_in_usd: "0.0000968", price_from_in_usd: "1", volume_in_usd: "0.1" } }] });
  }
  return answer(200, {
    data: [
      {
        attributes: { address: POOL, name: "Sparrow / ANTHRP", reserve_in_usd: "19895", volume_usd: { h24: "409152" }, transactions: { m5: { buys: 50, sells: 40 }, h1: { buys: 900, sells: 800 } } },
        relationships: { base_token: { data: { id: `solana_${MINT}` } }, quote_token: { data: { id: `solana_${QUOTE}` } }, dex: { data: { id: "pumpswap" } } },
      },
    ],
  });
};
const deps = { fetch: fake, now: () => NOW };

beforeEach(() => {
  resetDirect();
  asked.length = 0;
  ohlcvPrice = 0.0000968;
  refuse = false;
});

test("the engine's refusal names its pool, and the page reads that pool's bars by its address and interval only", async () => {
  const engine = async () => answer(429, { error: { code: "CANDLES_RATE_LIMITED", message: "busy" }, pool: { address: POOL, side: "base", name: "Sparrow / ANTHRP", dex: "pumpswap" } }, { "retry-after": "12" });
  const refused = await fetchCandles(MINT, "15m", { fetch: engine, now: () => NOW });
  assert.equal(refused.status, "unavailable");
  assert.deepEqual(refused.pool, { address: POOL, side: "base", name: "Sparrow / ANTHRP" });
  const read = await readCandlesDirect(MINT, "15m", refused.pool, 0.0000968, deps);
  assert.equal(read.status, "ready");
  assert.ok(read.candles.length >= 2 && read.candles.every((bar) => bar.time % 900 === 0), "quarter hours from the five minutes");
  assert.deepEqual(asked, [`${DIRECT_BASE}/pools/${POOL}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=base`]);
  /* The same read serves the five minutes: nothing more is asked. */
  assert.equal((await readCandlesDirect(MINT, "5m", refused.pool, 0.0000968, deps)).status, "ready");
  assert.equal(asked.length, 1);
});

test("a cold coin's pool is chosen by the engine's own rule from its pools, read by its public address", async () => {
  const read = await readCandlesDirect(MINT, "1h", null, 0.0000968, deps);
  assert.equal(read.status, "ready");
  assert.equal(asked[0], `${DIRECT_BASE}/tokens/${MINT}/pools?page=1`);
  assert.ok(asked[1].startsWith(`${DIRECT_BASE}/pools/${POOL}/ohlcv/hour?`));
});

test("bars that miss the price on screen are not drawn, and without a price nothing is read", async () => {
  ohlcvPrice = 0.5;
  assert.equal((await readCandlesDirect(MINT, "5m", { address: POOL, side: "base", name: null }, 0.0000968, deps)).status, "unavailable");
  asked.length = 0;
  assert.equal((await readCandlesDirect(MINT, "5m", { address: POOL, side: "base", name: null }, null, deps)).status, "unavailable");
  assert.equal(asked.length, 0, "no price, no read");
});

test("the source's refusal pauses this browser's reads, and the minute's budget is kept under the source's", async () => {
  refuse = true;
  assert.equal((await readCandlesDirect(MINT, "1m", { address: POOL, side: "base", name: null }, 0.0000968, deps)).status, "unavailable");
  const after = asked.length;
  refuse = false;
  assert.equal((await readCandlesDirect(MINT, "1h", { address: POOL, side: "base", name: null }, 0.0000968, deps)).status, "unavailable");
  assert.equal(asked.length, after, "nothing is asked inside the source's pause");
  resetDirect();
  asked.length = 0;
  /* Twenty-five different pools in one minute: the browser asks at most its budget. */
  for (let i = 0; i < DIRECT_PER_MINUTE + 5; i += 1) {
    const address = `${POOL.slice(0, -1)}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24]}`;
    await readCandlesDirect(MINT, i < 24 ? "1m" : "1h", { address, side: "base", name: null }, 0.0000968, deps);
  }
  assert.equal(asked.length, DIRECT_PER_MINUTE);
});

test("a refused trades read names its pools; the page reads their trades by address and merges them", async () => {
  assert.deepEqual(namedPools({ error: {}, pools: [POOL, "not an address", POOL] }), [POOL, POOL].slice(0, 2));
  assert.deepEqual(namedPools({ error: {} }), []);
  const trades = await readTradesDirect(MINT, [POOL], 0.0000968, deps);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, "buy");
  assert.deepEqual(asked, [`${DIRECT_BASE}/pools/${POOL}/trades`], "the pool's address only");
  assert.equal(namedPool({ pool: { address: "short", side: "base" } }), null);
  /* Trades that miss the price on screen (a stock's raw units) are not shown; without a price nothing is read. */
  resetDirect();
  assert.equal(await readTradesDirect(MINT, [POOL], 0.00968, deps), null);
  asked.length = 0;
  assert.equal(await readTradesDirect(MINT, [POOL], null, deps), null);
  assert.equal(asked.length, 0);
});

test("a cold coin's trade pools are chosen once and kept: the polls after the first ask only for trades", async () => {
  await readTradesDirect(MINT, [], 0.0000968, deps);
  const now = { fetch: fake, now: () => NOW + 25_000 };
  await readTradesDirect(MINT, [], 0.0000968, now);
  assert.equal(asked.filter((url) => url.includes("/tokens/")).length, 1);
});

test("this browser's bars past their interval's time are said stale; past half an hour they are no bars", async () => {
  const pool = { address: POOL, side: "base", name: null };
  assert.equal((await readCandlesDirect(MINT, "5m", pool, 0.0000968, deps)).stale, false);
  refuse = true;
  const later = await readCandlesDirect(MINT, "5m", pool, 0.0000968, { fetch: fake, now: () => NOW + 60_000 });
  assert.equal(later.status, "ready");
  assert.equal(later.stale, true);
  const gone = await readCandlesDirect(MINT, "5m", pool, 0.0000968, { fetch: fake, now: () => NOW + 31 * 60_000 });
  assert.equal(gone.status, "unavailable");
});
