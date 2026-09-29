import assert from "node:assert/strict";
import test from "node:test";

import {
  LANDING_FEED_MAX_STALE_MS,
  LANDING_FEED_TTL_MS,
  SAMPLE_HERO_SERIES,
  baseSymbol,
  changeTone,
  countByCategory,
  expireFeedStatus,
  formatChange,
  formatPrice,
  markRefreshing,
  observedAtFromHeaders,
  selectStripMarkets,
  seriesChange,
  toHeroSeries,
} from "./live-market.ts";

const market = (over = {}) => ({
  marketDisplayName: "BTC-USD",
  fullAssetName: "Bitcoin",
  category: "CRYPTO",
  status: "ONLINE",
  oraclePrice: "63878.9",
  priceChange24h: 0.0188,
  ...over,
});

test("strip rows survive only with an online status, a known category and a real price", () => {
  const rows = selectStripMarkets([
    market(),
    market({ marketDisplayName: "OFF-USD", status: "OFFLINE" }),
    market({ marketDisplayName: "LOWER-USD", status: "online" }),
    market({ marketDisplayName: "PADDED-USD", status: " ONLINE " }),
    market({ marketDisplayName: "MISSING-USD", status: undefined }),
    market({ marketDisplayName: "WEIRD-USD", category: "SOMETHING" }),
    market({ marketDisplayName: "NOPRICE-USD", oraclePrice: null, markPrice: null, lastTradePrice: null }),
    market({ marketDisplayName: "ZERO-USD", oraclePrice: "0" }),
    market({ marketDisplayName: "", oraclePrice: "10" }),
  ]);
  assert.deepEqual(rows.map((row) => row.symbol), ["BTC"]);
  assert.equal(rows[0].name, "Bitcoin");
  assert.equal(rows[0].category, "CRYPTO");
});

test("price falls back oracle → mark → last trade and never invents one", () => {
  const [oracleRow] = selectStripMarkets([market({ oraclePrice: "10", markPrice: "20", lastTradePrice: "30" })]);
  assert.equal(oracleRow.price, 10);
  const [markRow] = selectStripMarkets([market({ oraclePrice: undefined, markPrice: "20", lastTradePrice: "30" })]);
  assert.equal(markRow.price, 20);
  const [tradeRow] = selectStripMarkets([market({ oraclePrice: undefined, markPrice: "x", lastTradePrice: "30" })]);
  assert.equal(tradeRow.price, 30);
  assert.deepEqual(selectStripMarkets([market({ oraclePrice: "NaN", markPrice: "", lastTradePrice: undefined })]), []);
});

test("an unreported or absurd 24h move stays null instead of being painted", () => {
  const [missing] = selectStripMarkets([market({ priceChange24h: undefined })]);
  assert.equal(missing.change, null);
  const [absurd] = selectStripMarkets([market({ priceChange24h: 42 })]);
  assert.equal(absurd.change, null);
  const [real] = selectStripMarkets([market({ priceChange24h: "-0.0202" })]);
  assert.equal(real.change, -0.0202);
});

test("duplicate symbols collapse and recognisable markets lead the ticker", () => {
  const rows = selectStripMarkets([
    market({ marketDisplayName: "CASHCAT-USD", oraclePrice: "0.06" }),
    market({ marketDisplayName: "TSLA-USD", category: "EQUITIES" }),
    market({ marketDisplayName: "BTC-USD" }),
    market({ marketDisplayName: "BTC-USD", fullAssetName: "Duplicate" }),
    market({ marketDisplayName: "SNDK-USD", category: "EQUITIES" }),
  ]);
  assert.deepEqual(rows.map((row) => row.symbol), ["BTC", "TSLA", "CASHCAT", "SNDK"]);
  assert.equal(rows[0].name, "Bitcoin");
});

test("empty and malformed feeds produce no rows at all", () => {
  assert.deepEqual(selectStripMarkets(null), []);
  assert.deepEqual(selectStripMarkets(undefined), []);
  assert.deepEqual(selectStripMarkets([]), []);
});

test("category counts back the honest breakdown line", () => {
  const counts = countByCategory([
    { symbol: "BTC", name: "", category: "CRYPTO", price: 1, change: null },
    { symbol: "TSLA", name: "", category: "EQUITIES", price: 1, change: null },
    { symbol: "SPY", name: "", category: "INDICES", price: 1, change: null },
    { symbol: "GLD", name: "", category: "COMMODITIES", price: 1, change: null },
    { symbol: "SLV", name: "", category: "COMMODITIES", price: 1, change: null },
  ]);
  assert.deepEqual(counts, { CRYPTO: 1, EQUITIES: 1, COMMODITIES: 2, INDICES: 1 });
});

test("prices keep a digit count that suits their magnitude", () => {
  assert.equal(formatPrice(63878.9), "63,879");
  assert.equal(formatPrice(1873.52), "1,873.52");
  assert.equal(formatPrice(323.5), "323.50");
  assert.equal(formatPrice(73.766), "73.766");
  assert.equal(formatPrice(0.1118), "0.1118");
  assert.equal(formatPrice(0.062812), "0.062812");
  assert.equal(formatPrice(0), "—");
  assert.equal(formatPrice(Number.NaN), "—");
});

test("only a real move borrows a risk colour", () => {
  assert.equal(changeTone(0.0188), "up");
  assert.equal(changeTone(-0.0202), "down");
  assert.equal(changeTone(0.0001), "flat");
  assert.equal(changeTone(null), "flat");
  assert.equal(formatChange(0.0188), "+1.88%");
  assert.equal(formatChange(-0.0202), "−2.02%");
  assert.equal(formatChange(null), null);
});

test("base symbols drop the quote leg", () => {
  assert.equal(baseSymbol("TSLA-USD"), "TSLA");
  assert.equal(baseSymbol("TSLA"), "TSLA");
});

test("the hero series is finite, strictly ascending and deduplicated", () => {
  const points = toHeroSeries([
    { openTime: 300, close: "3" },
    { openTime: 100, close: "1" },
    { openTime: 200, close: "bad" },
    { openTime: 100, close: "1.5" },
    { openTime: Number.NaN, close: "9" },
    { openTime: 400, close: "0" },
    { openTime: 500, close: "5" },
  ]);
  assert.deepEqual(points, [
    { time: 100, value: 1.5 },
    { time: 300, value: 3 },
    { time: 500, value: 5 },
  ]);
  assert.deepEqual(toHeroSeries(null), []);
});

test("the hero series stays bounded for rendering", () => {
  const long = Array.from({ length: 900 }, (_, index) => ({ openTime: index + 1, close: String(index + 1) }));
  const points = toHeroSeries(long);
  assert.equal(points.length, 120);
  assert.equal(points[points.length - 1].value, 900);
});

test("series change reads a real elapsed-time window", () => {
  const points = [
    { time: 1_000, value: 100 },
    { time: 4_600, value: 110 },
    { time: 91_000, value: 121 },
  ];
  assert.equal(Number(seriesChange(points).toFixed(4)), 0.1);
  assert.equal(Number(seriesChange(points, 90_000).toFixed(4)), 0.21);
  const onlyTwentyThreeHours = Array.from({ length: 24 }, (_, index) => ({
    time: 10_000 + index * 3_600,
    value: 100 + index,
  }));
  assert.equal(seriesChange(onlyTwentyThreeHours), null);
  assert.equal(seriesChange([{ time: 1, value: 1 }]), null);
  assert.equal(seriesChange([]), null);
});
test("series change uses the latest observation before a sparse cutoff", () => {
  const points = [
    { time: 1_000, value: 100 },
    { time: 50_000, value: 110 },
    { time: 91_000, value: 121 },
  ];
  assert.equal(Number(seriesChange(points).toFixed(4)), 0.21);
});

test("a refresh demotes prior live data before the provider responds", () => {
  assert.equal(markRefreshing("live"), "stale");
  assert.equal(markRefreshing("loading"), "loading");
  assert.equal(markRefreshing("sample"), "sample");
  assert.equal(markRefreshing("unavailable"), "unavailable");
});
test("cache headers produce a bounded observation time", () => {
  const receivedAt = 2_000_000;
  assert.equal(observedAtFromHeaders("30", null, receivedAt), 1_970_000);
  assert.equal(
    observedAtFromHeaders(null, new Date(1_900_000).toUTCString(), receivedAt),
    1_900_000,
  );
  assert.equal(observedAtFromHeaders("bad", "not-a-date", receivedAt), receivedAt);
  assert.equal(
    observedAtFromHeaders(null, new Date(receivedAt + 60_000).toUTCString(), receivedAt),
    receivedAt,
  );
});

test("a received feed expires deterministically at its TTL", () => {
  const observedAt = 1_000;
  assert.equal(
    expireFeedStatus("live", observedAt, observedAt + LANDING_FEED_TTL_MS - 1),
    "live",
  );
  assert.equal(
    expireFeedStatus("live", observedAt, observedAt + LANDING_FEED_TTL_MS),
    "stale",
  );
  assert.equal(expireFeedStatus("live", null, observedAt), "stale");
  assert.equal(expireFeedStatus("sample", null, observedAt), "sample");
  assert.equal(
    expireFeedStatus("stale", observedAt, observedAt + LANDING_FEED_MAX_STALE_MS - 1),
    "stale",
  );
  assert.equal(
    expireFeedStatus("stale", observedAt, observedAt + LANDING_FEED_MAX_STALE_MS),
    "unavailable",
  );
  assert.equal(
    expireFeedStatus("live", observedAt, observedAt + LANDING_FEED_MAX_STALE_MS),
    "unavailable",
  );
});

test("the fallback series is deterministic — no clock, no randomness", () => {
  assert.equal(SAMPLE_HERO_SERIES.length, 168);
  let previous = -Infinity;
  for (const point of SAMPLE_HERO_SERIES) {
    assert.ok(Number.isFinite(point.value) && point.value > 0);
    assert.ok(point.time > previous, "sample times must strictly ascend");
    previous = point.time;
  }
  assert.equal(SAMPLE_HERO_SERIES[0].time, 1_780_000_000);
  const source = SAMPLE_HERO_SERIES.map((point) => point.value).join(",");
  assert.doesNotMatch(source, /NaN|Infinity/);
});
