import assert from "node:assert/strict";
import test from "node:test";

import { SPOT_TIMEFRAMES, TIMEFRAME_SOURCE, candlesDescribe, chooseSpotPool, isSpotTimeframe, normalizeCandles, withLivePrice } from "./candles.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USWS = "USWS1111111111111111111111111111111111111111";

/* Shapes recorded from GeckoTerminal's `/tokens/{mint}/pools` on 2026-09-11. */
function pool(address, name, base, quote, reserve, createdAt, dex = "raydium") {
  return {
    attributes: { address, name, reserve_in_usd: String(reserve), pool_created_at: createdAt, volume_usd: { h24: "1000" } },
    relationships: {
      base_token: { data: { id: `solana_${base}` } },
      quote_token: { data: { id: `solana_${quote}` } },
      dex: { data: { id: dex } },
    },
  };
}

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

test("SOL charts from SOL / USDC on the base side, never from a deeper meme pool where SOL is the quote", () => {
  /* The exact case that chose wrong: a week-old USWS/SOL pool out-reserved the
     Raydium SOL/USDC pool, and the SOL chart became eight candles of a meme. */
  const body = {
    data: [
      pool("Czfq", "SOL / USDC", SOL, USDC, 23_800_191, "2022-01-01T00:00:00Z", "orca"),
      pool("58oQ", "SOL / USDC", SOL, USDC, 27_384_452, "2021-03-29T10:05:48Z"),
      pool("4TDt", "USWS / SOL", USWS, SOL, 34_918_333, "2026-09-05T00:00:00Z", "pumpswap"),
    ],
  };
  const chosen = chooseSpotPool(body, SOL);
  assert.equal(chosen.reason, null);
  assert.equal(chosen.pool.address, "58oQ", "the deeper of the two qualifying SOL/USDC pools");
  assert.equal(chosen.pool.side, "base");
  assert.equal(chosen.pool.dex, "raydium");
});

test("a meme charts from its SOL or USDC pool; a pool against another meme only where it has no such market", () => {
  const body = {
    data: [
      pool("m1", "BONK / USWS", BONK, USWS, 90_000_000, "2026-01-01T00:00:00Z"),
      pool("m2", "BONK / SOL", BONK, SOL, 2_000_000, "2024-01-01T00:00:00Z"),
      pool("m3", "BONK / USDC", BONK, USDC, 400_000, "2024-01-01T00:00:00Z"),
    ],
  };
  const chosen = chooseSpotPool(body, BONK);
  assert.equal(chosen.pool.address, "m2", "a deep major pool wins over any meme quote; between SOL and USDC pools that traded alike, depth decides");
  const memeOnly = chooseSpotPool({ data: [pool("m1", "BONK / USWS", BONK, USWS, 90_000_000, "2026-01-01T00:00:00Z")] }, BONK);
  assert.equal(memeOnly.pool.address, "m1", "a coin paired only with another coin charts from that pool — its market");
  assert.equal(memeOnly.market, true, "said as its market, so its bars are drawn only against a known price");
  assert.equal(chosen.market, undefined);
});

test("a young coin charts from its own market: the pool it trades in most, over the floor, whatever its pair", () => {
  /* Recorded 19.11.2026: Sparrow traded on PumpSwap against ANTHRP ($19.9K, $409K a day) while its SOL pools held $54 and
     $41; Lucia was still on its pump.fun curve against DCTY. Both had no chart. */
  const SPARROW = "5a6mAmWbL3Na2KhwV1LmmAUSf12Gy1vd3NjqBq24pump";
  const ANTHRP = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
  const busy = (row, volume) => ({ ...row, attributes: { ...row.attributes, volume_usd: { h24: String(volume) } } });
  const body = {
    data: [
      busy(pool("anth", "Sparrow / ANTHRP", SPARROW, ANTHRP, 19_895, "2026-11-19T00:00:00Z", "pumpswap"), 409_152),
      busy(pool("orca", "Sparrow / SOL", SPARROW, SOL, 54, "2026-11-19T00:00:00Z", "orca"), 7_877),
      busy(pool("met", "Sparrow / SOL", SPARROW, SOL, 41, "2026-11-19T00:00:00Z", "meteora"), 1_060),
    ],
  };
  const chosen = chooseSpotPool(body, SPARROW);
  assert.equal(chosen.pool.address, "anth");
  assert.equal(chosen.pool.side, "base");
  const dust = chooseSpotPool({ data: [busy(pool("d", "X / SOL", USWS, SOL, 120, "2026-11-19T00:00:00Z"), 500)] }, USWS);
  assert.deepEqual(dust, { pool: null, reason: "THIN" }, "under the floor even a coin's only pool is no market");
  assert.deepEqual(chooseSpotPool({ data: [busy(pool("s", "SOL / USWS", SOL, USWS, 90_000_000, "2026-01-01T00:00:00Z"), 9_000_000)] }, SOL), { pool: null, reason: "NO_MAJOR_QUOTE" }, "SOL keeps its rule alone");
});

test("a meme charts from the pool it trades in most, not from a side pool against USDC (B15)", () => {
  /* Bonk on 2026-10-17: the chart read a BONK/USDC pool whose last trade was 18 minutes old while BONK/SOL traded every second. */
  const busy = (row, volume) => ({ ...row, attributes: { ...row.attributes, volume_usd: { h24: String(volume) } } });
  const body = {
    data: [
      busy(pool("usdc", "BONK / USDC", BONK, USDC, 3_000_000, "2024-01-01T00:00:00Z", "meteora"), 40_000),
      busy(pool("sol", "BONK / SOL", BONK, SOL, 1_500_000, "2023-01-01T00:00:00Z", "orca"), 4_000_000),
    ],
  };
  assert.equal(chooseSpotPool(body, BONK).pool.address, "sol", "the busier pool is the market, even when shallower");
  /* SOL itself keeps its rule: against a stable on the base side, whatever trades more elsewhere. */
  const sol = {
    data: [
      busy(pool("sol-usdc", "SOL / USDC", SOL, USDC, 20_000_000, "2021-01-01T00:00:00Z"), 1_000_000),
      busy(pool("bonk-sol", "BONK / SOL", BONK, SOL, 30_000_000, "2023-01-01T00:00:00Z"), 90_000_000),
    ],
  };
  assert.equal(chooseSpotPool(sol, SOL).pool.address, "sol-usdc");
});

test("the chart's last bar closes at the page's one last price; a price far off, a clock behind or no price leave it as read (B15)", () => {
  const bar = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1 });
  const candles = [bar(3_600, 100), bar(7_200, 104)];
  const same = withLivePrice(candles, 104.11, 7_200 + 1_000, 3_600);
  assert.equal(same.length, 2);
  assert.deepEqual(same[1], { time: 7_200, open: 104, high: 104.11, low: 104, close: 104.11, volume: 1 }, "the bar of the moment closes at the live price");
  const next = withLivePrice(candles, 103, 10_800 + 5, 3_600);
  assert.equal(next.length, 3, "a new bar opens from the last close when the source has not drawn the moment's bar yet");
  assert.deepEqual(next[2], { time: 10_800, open: 104, high: 104, low: 103, close: 103, volume: 0 });
  assert.deepEqual(withLivePrice(candles, 200, 7_300, 3_600), candles, "a price outside the band is not drawn");
  assert.deepEqual(withLivePrice(candles, null, 7_300, 3_600), candles);
  assert.deepEqual(withLivePrice(candles, 104.11, 3_700, 3_600), candles, "a clock behind the bars changes nothing");
  assert.deepEqual(withLivePrice([], 1, 7_300, 3_600), []);
  assert.notEqual(withLivePrice(candles, 104.11, 7_300, 3_600), candles, "a copy, never the caller's array");
});

test("USDC is priced as the quote of a major pool, and a tokenized stock from its USDC pool", () => {
  const usdc = chooseSpotPool({ data: [pool("58oQ", "SOL / USDC", SOL, USDC, 27_384_452, "2021-03-29T10:05:48Z")] }, USDC);
  assert.equal(usdc.pool.address, "58oQ");
  assert.equal(usdc.pool.side, "quote", "USDC is the quote side, and the read prices that side");
  const stock = chooseSpotPool(
    { data: [pool("s1", "NVDAx / USDC", NVDAX, USDC, 2_101_476, "2025-07-01T00:00:00Z", "raydium-clmm"), pool("s2", "NVDAx / USDT", NVDAX, USDT, 3_000_000, "2025-07-01T00:00:00Z")] },
    NVDAX,
  );
  assert.equal(stock.pool.address, "s2", "both are stable quotes on the base side; depth decides");
});

test("thin and quiet pools are refused with their reason rather than charted", () => {
  const thin = chooseSpotPool({ data: [pool("t", "X / SOL", USWS, SOL, 200, "2026-01-01T00:00:00Z")] }, USWS);
  assert.deepEqual(thin, { pool: null, reason: "THIN" });
  const quiet = { ...pool("q", "X / SOL", USWS, SOL, 50_000, "2026-01-01T00:00:00Z") };
  quiet.attributes = { ...quiet.attributes, volume_usd: { h24: "0" } };
  assert.deepEqual(chooseSpotPool({ data: [quiet] }, USWS), { pool: null, reason: "QUIET" });
  assert.deepEqual(chooseSpotPool({ data: [pool("a", "X / Y", USWS, USDC, 10, "2026-01-01T00:00:00Z")] }, SOL), { pool: null, reason: "NO_POOL" });
  assert.deepEqual(chooseSpotPool({}, SOL), { pool: null, reason: "NO_POOL" });
  assert.deepEqual(chooseSpotPool(null, SOL), { pool: null, reason: "NO_POOL" });
});

test("candles must describe the asset on screen: recent, and at the market's own price", () => {
  const nowMs = Date.parse("2026-09-11T12:00:00Z");
  const bar = (secondsAgo, close) => ({ time: Math.floor(nowMs / 1000) - secondsAgo, open: close, high: close, low: close, close });
  assert.deepEqual(candlesDescribe([bar(600, 99.8)], 100, nowMs), { ok: true });
  assert.deepEqual(candlesDescribe([bar(600, 99.8)], null, nowMs), { ok: true }, "an unpriced asset cannot be cross-checked, and is not refused for that");
  assert.deepEqual(candlesDescribe([bar(600, 0.0000029)], 219.76, nowMs), { ok: false, reason: "PRICE_MISMATCH" }, "a pump.fun copy's pool is not NVIDIA's chart");
  assert.deepEqual(candlesDescribe([bar(600, 140)], 100, nowMs), { ok: false, reason: "PRICE_MISMATCH" });
  assert.deepEqual(candlesDescribe([bar(4 * 86_400, 100)], 100, nowMs), { ok: false, reason: "STALE" });
  assert.deepEqual(candlesDescribe([], 100, nowMs), { ok: false, reason: "EMPTY" });
});

test("candles arrive newest first as strings and leave oldest first, numeric, deduped and without broken bars", () => {
  const body = {
    data: {
      attributes: {
        ohlcv_list: [
          [1789084800, "98.58", "99.38", "98.56", "99.38", "357627.15"],
          [1789081200, 99.1, 99.5, 98.9, 98.6, 100],
          [1789081200, 99.2, 99.6, 99.0, 98.7, 101],
          [1789077600, 0, 99.5, 98.9, 98.6, 100],
          [1789074000, 99.1, 98.0, 98.9, 98.6, 100],
          ["x", 1, 1, 1, 1],
          [1789070400, 99.1, 99.5, 98.9, 98.6],
        ],
      },
    },
  };
  const candles = normalizeCandles(body);
  assert.deepEqual(candles.map((candle) => candle.time), [1789070400, 1789081200, 1789084800]);
  assert.equal(candles[1].open, 99.2, "the later duplicate of a timestamp wins");
  assert.equal(candles[0].volume, undefined, "a bar without volume says so rather than reading zero");
  assert.equal(candles[2].close, 99.38);
  assert.deepEqual(normalizeCandles({ data: { attributes: {} } }), []);
  assert.deepEqual(normalizeCandles(null), []);
});

test("every timeframe the page offers maps to a source read, and only those", () => {
  assert.deepEqual([...SPOT_TIMEFRAMES], ["1m", "5m", "15m", "1h", "4h", "1d"]);
  for (const timeframe of SPOT_TIMEFRAMES) {
    assert.ok(isSpotTimeframe(timeframe));
    assert.ok(TIMEFRAME_SOURCE[timeframe].seconds > 0);
  }
  assert.equal(isSpotTimeframe("1w"), false);
  assert.equal(TIMEFRAME_SOURCE["4h"].path, "hour");
  assert.equal(TIMEFRAME_SOURCE["4h"].aggregate, 4);
  assert.equal(TIMEFRAME_SOURCE["1d"].seconds, 86_400);
});

test("candles from the raw-unit chart source are brought onto the scaled unit the page prices; a multiplier of one or none leaves them alone", async () => {
  const { rescaleCandles } = await import("./candles.ts");
  const raw = [{ time: 600, open: 758.1, high: 760, low: 750, close: 758.1, volume: 1000 }];
  assert.deepEqual(rescaleCandles(raw, 10), [{ time: 600, open: 75.81, high: 76, low: 75, close: 75.81, volume: 1000 }], "NFLXx at ×10: the raw close of 758.1 is 75.81 on screen; the dollar volume does not move");
  assert.deepEqual(rescaleCandles(raw, 1), raw);
  assert.deepEqual(rescaleCandles(raw, null), raw);
  assert.deepEqual(rescaleCandles(raw, 0), raw, "a broken multiplier changes nothing");
  assert.deepEqual(candlesDescribe(rescaleCandles(raw, 10), 75.78, 600_000 + 1_000), { ok: true }, "the rescaled close agrees with the venue's price");
});

test("the candles answer, as the route composes it, is the contract's shape on the wire (1.11.0)", async () => {
  const { SpotCandlesResponseSchema, SpotPoolSchema } = await import("../api/v1/contract.ts");
  const chosen = chooseSpotPool({ data: [pool("58oQ", "SOL / USDC", SOL, USDC, 27_384_452, "2021-03-29T10:05:48Z")] }, SOL);
  assert.equal(SpotPoolSchema.safeParse(chosen.pool).success, true);
  const candles = normalizeCandles({ data: { attributes: { ohlcv_list: [[1789084800, "98.58", "99.38", "98.56", "99.38", "357627.15"], [1789081200, 99.1, 99.5, 98.9, 98.6]] } } });
  const answer = { timeframe: "1h", candles, pool: chosen.pool, observedAt: new Date(1789085000_000).toISOString(), stale: false, source: { label: "GeckoTerminal", url: "https://www.geckoterminal.com" } };
  const wire = (value) => JSON.parse(JSON.stringify(value));
  assert.equal(SpotCandlesResponseSchema.safeParse(wire(answer)).success, true);
  assert.equal(SpotCandlesResponseSchema.safeParse(wire({ ...answer, candles: candles.slice(-1), limit: 1, available: candles.length })).success, true);
  /* A bar without volume is absent on the wire, never a zero. */
  assert.equal("volume" in wire(answer).candles[0], false);
});

test("four source reads serve the six intervals: quarter hours from five minutes, four hours from hours", async () => {
  const { SOURCE_READ, TIMEFRAME_READ, TIMEFRAME_LIMIT, candlesOfTimeframe, groupCandles, ohlcvPath } = await import("./candles.ts");
  assert.deepEqual(new Set(SPOT_TIMEFRAMES.map((tf) => TIMEFRAME_READ[tf].read)), new Set(["m1", "m5", "h1", "d1"]));
  for (const tf of SPOT_TIMEFRAMES) {
    const { read, group } = TIMEFRAME_READ[tf];
    assert.equal(SOURCE_READ[read].seconds * group, TIMEFRAME_SOURCE[tf].seconds, `${tf} is whole bars of its read`);
  }
  /* Twelve five-minute bars from 00:00: four quarter hours, each opening at its first bar and closing at its last. */
  const five = Array.from({ length: 12 }, (_, i) => ({ time: 1_794_960_000 + i * 300, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 2 }));
  const quarters = candlesOfTimeframe(five, "15m");
  assert.equal(quarters.length, 4);
  assert.deepEqual(quarters[0], { time: 1_794_960_000, open: 10, high: 13, low: 9, close: 12.5, volume: 6 });
  assert.equal(quarters[3].time, 1_794_960_000 + 2_700);
  /* A bar without volume keeps none rather than a zero. */
  assert.equal(groupCandles([{ time: 0, open: 1, high: 1, low: 1, close: 1 }], 900)[0].volume, undefined);
  /* The window: the newest bars of the interval only. */
  const many = Array.from({ length: 1000 }, (_, i) => ({ time: i * 300, open: 1, high: 1, low: 1, close: 1 }));
  assert.equal(candlesOfTimeframe(many, "5m").length, TIMEFRAME_LIMIT["5m"]);
  assert.equal(candlesOfTimeframe(many, "15m").length, 300);
  /* The request names the pool and the interval, nothing else. */
  assert.equal(ohlcvPath({ address: "Pool1", side: "quote" }, "h1"), "/pools/Pool1/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=quote");
});

test("a young coin's bars are counted from its trades: first price opens, last closes, dollars are the volume", async () => {
  const { candlesFromTrades } = await import("./candles.ts");
  const at = (s) => new Date(s * 1000).toISOString();
  const trades = [
    { at: at(130), priceUsd: 3, usd: 5 },
    { at: at(65), priceUsd: 4, usd: 1 },
    { at: at(61), priceUsd: 2, usd: 10 },
    { at: at(10), priceUsd: 1, usd: null },
    { at: at(20), priceUsd: null, usd: 7 },
    { at: "not a time", priceUsd: 9, usd: 9 },
  ];
  assert.deepEqual(candlesFromTrades(trades, 60), [
    { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { time: 60, open: 2, high: 4, low: 2, close: 4, volume: 11 },
    { time: 120, open: 3, high: 3, low: 3, close: 3, volume: 5 },
  ]);
  assert.deepEqual(candlesFromTrades([], 60), []);
  assert.deepEqual(candlesFromTrades(trades, 0), []);
});
