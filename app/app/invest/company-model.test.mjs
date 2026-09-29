import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorPoints,
  approxUsd,
  buyCosts,
  changePct,
  CHART_RANGES,
  dayAgoPrice,
  dollars,
  exchangeState,
  formatUnits,
  historyStartsLate,
  isChartRange,
  lineGeometry,
  nearestIndex,
  parseDollars,
  premiumLine,
  RANGE_SOURCE,
  rangePoints,
  truthLine,
  unitsFromRaw,
  unitsPhrase,
} from "./company-model.ts";

/**
 * «Простий»'s company page and purchase (RYN-INVEST-SIMPLE-001, session 2):
 * the words a beginner reads about what the token is, the exchange, the
 * chart's ranges, the shares an amount buys and every cost of a purchase.
 */

const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("the line of truth names what the token is, from the issuer's documents — never «акція Apple»", () => {
  assert.equal(truthLine("xstocks", "Apple", "uk"), "Токен, що відстежує ціну Apple · забезпечений 1:1 · без голосу");
  assert.equal(truthLine("xstocks", "Apple", "en"), "A token that tracks the price of Apple · backed 1:1 · no vote");
  /* A PreStocks token (canon v5.2 §7): not a share, the issuer's fee on every transfer as the chain states it, the issuer's power over the token. */
  assert.equal(truthLine("prestocks", "OpenAI", "uk", 100), "Це не акція OpenAI · комісія емітента 1% на кожен переказ · емітент може заморозити чи забрати токен");
  assert.equal(truthLine("prestocks", "OpenAI", "en", 100), "Not a share in OpenAI · a 1% issuer fee on every transfer · the issuer can freeze or take away the token");
  assert.equal(truthLine("prestocks", "SpaceX", "uk", 50), "Це не акція SpaceX · комісія емітента 0,5% на кожен переказ · емітент може заморозити чи забрати токен");
  assert.equal(truthLine("prestocks", "SpaceX", "en", null), "Not a share in SpaceX · an issuer fee on every transfer · the issuer can freeze or take away the token", "a fee the chain did not state is not given a figure");
  assert.match(truthLine("backpack", "NVIDIA", "uk"), /обмін на акцію через Backpack/);
  assert.match(truthLine("ondo", "Tesla", "uk"), /це не акція$/);
  for (const issuer of ["xstocks", "backpack", "ondo", "prestocks"]) {
    for (const lang of ["en", "uk"]) {
      const line = truthLine(issuer, "Apple", lang);
      /* A listed company's token is a tracker; nothing here calls it the company's share. */
      assert.doesNotMatch(line, /^(Акція|Share)\b/);
      assert.doesNotMatch(line, /справжня акція|real share/i);
      assert.ok(line.split(" · ").length === 3, `${issuer}/${lang} is one line of three short parts`);
    }
  }
});

test("the exchange is open in the issuer's market period and shut in every other", () => {
  assert.equal(exchangeState({ period: "market", exchangeOpen: null }), "open");
  assert.equal(exchangeState({ period: "extended", exchangeOpen: null }), "closed");
  assert.equal(exchangeState({ period: "overnight", exchangeOpen: true }), "closed");
  assert.equal(exchangeState({ period: "closed", exchangeOpen: null }), "closed");
  assert.equal(exchangeState({ period: "unknown", exchangeOpen: true }), "open");
  assert.equal(exchangeState({ period: "unknown", exchangeOpen: false }), "closed");
  /* Nothing known: the page says nothing rather than guess. */
  assert.equal(exchangeState({ period: "unknown", exchangeOpen: null }), null);
});

test("each range reads the candles that fit it and keeps only its own span", () => {
  assert.deepEqual([...CHART_RANGES], ["1d", "1w", "1m", "1y"]);
  assert.equal(RANGE_SOURCE["1d"].timeframe, "15m", "a day of quarter-hour bars: five-minute ones read a pool's single trades as spikes");
  assert.equal(RANGE_SOURCE["1w"].timeframe, "1h");
  assert.equal(RANGE_SOURCE["1m"].timeframe, "4h");
  assert.equal(RANGE_SOURCE["1y"].timeframe, "1d");
  assert.ok(isChartRange("1y") && !isChartRange("5y") && !isChartRange(null));
  const candles = [
    { time: (NOW - 30 * HOUR) / 1000, close: 100 },
    { time: (NOW - 20 * HOUR) / 1000, close: 101 },
    { time: (NOW - 2 * HOUR) / 1000, close: 0 },
    { time: (NOW - HOUR) / 1000, close: 103 },
    { time: (NOW - 10 * HOUR) / 1000, close: 102 },
  ];
  const day = rangePoints(candles, "1d", NOW);
  assert.deepEqual(day.map((point) => point.price), [101, 102, 103], "oldest first, a zero price dropped, yesterday's bar outside the day");
  assert.equal(rangePoints(candles, "1w", NOW).length, 4);
});

test("the change over a range is measured from its first close", () => {
  assert.ok(Math.abs(changePct(100, 110) - 10) < 1e-9);
  assert.ok(Math.abs(changePct(200, 150) - -25) < 1e-9);
  assert.equal(changePct(null, 10), null);
  assert.equal(changePct(0, 10), null);
});

test("the line keeps the pool's moves and ends at the price on the page", () => {
  /* The deepest pool at $340.88 while the venue's price reads $335.95 (AAPLx, 2026-09-23). */
  const pool = [
    { at: NOW - 2 * HOUR, price: 336.5 },
    { at: NOW - HOUR, price: 339.3 },
    { at: NOW, price: 340.88 },
  ];
  const anchored = anchorPoints(pool, 335.95);
  assert.ok(Math.abs(anchored[2].price - 335.95) < 1e-9, "the line ends at the page's price");
  assert.ok(Math.abs(anchored[0].price / anchored[2].price - 336.5 / 340.88) < 1e-12, "every point keeps its ratio to the last");
  assert.deepEqual(anchorPoints(pool, null), pool, "without a price the pool's own figures stand");
  assert.deepEqual(anchorPoints([], 335.95), []);
});

test("a day is read against the price a day ago as the day's change states it", () => {
  /* −0.91 % on the card: a day ago the price was 337 / 0.9909. */
  assert.ok(Math.abs(dayAgoPrice(337, -0.91) - 337 / 0.9909) < 1e-9);
  assert.equal(dayAgoPrice(337, null), null);
  assert.equal(dayAgoPrice(null, 1), null);
  assert.equal(dayAgoPrice(337, -100), null);
  /* The dotted line sits at that price even when the pool's first bar was one odd trade above it, and the height holds it. */
  const points = [
    { at: NOW - 20 * HOUR, price: 345 },
    { at: NOW - 10 * HOUR, price: 336 },
    { at: NOW, price: 337 },
  ];
  const shape = lineGeometry(points, 300, 100, 10, 340);
  assert.ok(shape.baselineY > shape.ys[0], "the day-ago price is below the odd first bar");
  assert.ok(shape.ys[2] > shape.baselineY, "and the last price is below the day-ago price, as −0.91 % says");
  const outside = lineGeometry(points, 300, 100, 10, 360);
  assert.equal(Math.round(outside.baselineY), 10, "a baseline above every bar becomes the top of the range");
});

test("a history younger than the range is said to start late", () => {
  const young = [{ at: NOW - 90 * DAY, price: 10 }, { at: NOW, price: 12 }];
  assert.equal(historyStartsLate(young, "1y", NOW), true);
  const full = [{ at: NOW - 360 * DAY, price: 10 }, { at: NOW, price: 12 }];
  assert.equal(historyStartsLate(full, "1y", NOW), false);
  assert.equal(historyStartsLate([], "1y", NOW), false);
});

test("the line runs left to right in time and fills the height between the range's low and high", () => {
  const points = [
    { at: NOW - 3 * HOUR, price: 10 },
    { at: NOW - 2 * HOUR, price: 20 },
    { at: NOW, price: 15 },
  ];
  const shape = lineGeometry(points, 300, 100, 10);
  assert.ok(shape);
  assert.deepEqual(shape.xs.map((x) => Math.round(x)), [0, 100, 300], "an hour's gap is a third of the width, not an equal step");
  assert.deepEqual(shape.ys.map((y) => Math.round(y)), [90, 10, 50], "the low sits on the bottom margin, the high on the top one");
  assert.equal(Math.round(shape.baselineY), 90);
  assert.match(shape.line, /^M0\.00 90\.00 L100\.00 10\.00 L300\.00 50\.00$/);
  assert.match(shape.area, / L300 100 L0 100 Z$/);
  const flat = lineGeometry([{ at: NOW - HOUR, price: 5 }, { at: NOW, price: 5 }], 300, 100);
  assert.deepEqual(flat.ys, [50, 50], "a flat range is a flat line through the middle");
  assert.equal(lineGeometry([{ at: NOW, price: 5 }], 300, 100), null, "one price is no line");
  assert.equal(nearestIndex(shape.xs, 300, 0.4), 1);
  assert.equal(nearestIndex(shape.xs, 300, 0.95), 2);
  assert.equal(nearestIndex(shape.xs, 300, -1), 0);
  assert.equal(nearestIndex([], 300, 0.5), -1);
});

test("a sum of dollars is read the way each language writes it, never past the cents", () => {
  assert.equal(parseDollars("25", "uk"), 25);
  assert.equal(parseDollars("$25", "en"), 25);
  assert.equal(parseDollars("25,50", "uk"), 25.5);
  assert.equal(parseDollars("1 000", "uk"), 1000);
  assert.equal(parseDollars("1,000.50", "en"), 1000.5);
  assert.equal(parseDollars("1,000", "en"), 1000, "an English thousands comma is not a decimal point");
  assert.equal(parseDollars("25.505", "en"), null);
  assert.equal(parseDollars("abc", "en"), null);
  assert.equal(parseDollars("0", "en"), null);
  assert.equal(parseDollars("", "uk"), null);
});

test("the button says a whole sum without cents and a sum with cents with them", () => {
  assert.equal(dollars(25, "en-US"), "$25");
  assert.equal(dollars(25.5, "en-US"), "$25.50");
  assert.equal(dollars(25.5, "uk-UA"), "$25,50");
  assert.match(dollars(1000, "uk-UA"), /^\$1\s000$/u);
});

test("the shares an amount buys are counted in the wallet's own unit", () => {
  /* 0.0787 AAPLx at eight decimals, no multiplier. */
  assert.equal(unitsFromRaw("7870000", 8, null), 0.0787);
  /* A scaled mint at ×10 counts ten scaled units per raw one (NFLXx). */
  assert.equal(unitsFromRaw("1000000", 8, 10), 0.1);
  assert.equal(unitsFromRaw(null, 8, null), null);
  assert.equal(unitsFromRaw("12", null, null), null);
  assert.equal(formatUnits(0.07871234, "en-US"), "0.0787");
  assert.equal(formatUnits(0.07871234, "uk-UA"), "0,0787");
  assert.match(formatUnits(0.00002, "en-US"), /^< 0\.0001$/);
});

test("the Ukrainian noun follows the number; English says «of a share» below one", () => {
  assert.equal(unitsPhrase(0.0787, "share", "Apple", "uk", "uk-UA"), "0,0787 частки Apple");
  assert.equal(unitsPhrase(1, "share", "Apple", "uk", "uk-UA"), "1 частка Apple");
  assert.equal(unitsPhrase(2, "share", "Apple", "uk", "uk-UA"), "2 частки Apple");
  assert.equal(unitsPhrase(5, "share", "Apple", "uk", "uk-UA"), "5 часток Apple");
  assert.equal(unitsPhrase(0.52, "token", "OpenAI", "uk", "uk-UA"), "0,52 токена OpenAI");
  assert.equal(unitsPhrase(0.0787, "share", "Apple", "en", "en-US"), "0.0787 of a share");
  assert.equal(unitsPhrase(2.5, "share", "Apple", "en", "en-US"), "2.5 shares");
  assert.equal(unitsPhrase(0.3, "token", "OpenAI", "en", "en-US"), "0.3 of a token");
});

test("all costs are the venue's own dollar gap, never less than the stated fees, plus the network", () => {
  const base = { spendUsd: 25, inUsdValue: "25.00", outUsdValue: "24.93", totalFeeBasisPoints: 25, priceImpactPct: "0.02", signatureFeeLamports: "5000", priorityFeeLamports: "45000", rentFeeLamports: "0", solUsd: 150 };
  const costs = buyCosts(base);
  /* $0.07 inside the route and 50,000 lamports at $150 a SOL. */
  assert.ok(Math.abs(costs.totalUsd - 0.0775) < 1e-9, `got ${costs.totalUsd}`);
  assert.equal(costs.accountUsd, null);
  /* A price that moved in the person's favour is not a negative cost: the stated fee and impact stand. */
  const favour = buyCosts({ ...base, outUsdValue: "25.40" });
  assert.ok(Math.abs(favour.totalUsd - (0.0625 + 0.005 + 0.0075)) < 1e-9, `got ${favour.totalUsd}`);
  /* Without the venue's dollar values the fees and impact are the estimate. */
  const stated = buyCosts({ ...base, inUsdValue: null, outUsdValue: null });
  assert.ok(Math.abs(stated.totalUsd - (0.0675 + 0.0075)) < 1e-9);
  /* A quote with no network figure still pays one signature. */
  const quoteOnly = buyCosts({ ...base, signatureFeeLamports: "0", priorityFeeLamports: "0" });
  assert.ok(Math.abs(quoteOnly.totalUsd - (0.07 + 0.00075)) < 1e-9);
  /* The reserve of a new token account is said apart, in dollars. */
  const opening = buyCosts({ ...base, rentFeeLamports: "2039280" });
  assert.ok(Math.abs(opening.accountUsd - 0.305892) < 1e-9);
  assert.equal(buyCosts({ ...base, rentFeeLamports: "2039280", solUsd: null }).accountUsd, null);
});

/* «Перевірка» for a PreStocks token (canon v5.2 §7, §12; RYN-PRESTOCKS-001): read against the venue's quote of $10 of OpenAI on 2026-09-25 — 10 USDC in, 4,956,563 raw out (the venue quotes what arrives after the mint's 1 %), the venue's own dollar values $9.9983 and $9.8265, the route's 10 bps. */
test("a PreStocks purchase: what arrives is the quote through the multiplier, never cut by the fee a second time; all costs hold the issuer's 1 % and name it on its own line", () => {
  const quote = { spendUsd: 10, inUsdValue: "9.99834580445001", outUsdValue: "9.826547047809152", totalFeeBasisPoints: 10, priceImpactPct: "-0.01718271802165456", signatureFeeLamports: "5000", priorityFeeLamports: "0", rentFeeLamports: "0", solUsd: 200, issuerFeeBasisPoints: 100 };
  /* «Отримаєш»: 0.004956563 base tokens × 1.4861347 = 0.0073661 tokens as the wallet shows them. */
  const units = unitsFromRaw("4956563", 9, 1.4861347);
  assert.ok(Math.abs(units - 0.00736612) < 1e-7, `got ${units}`);
  assert.equal(unitsPhrase(units, "token", "OpenAI", "uk", "uk-UA"), "0,0074 токена OpenAI");
  const costs = buyCosts(quote);
  /* The venue's own gap ($0.1718) holds the issuer's $0.10, the route's fee and the pool's spread; plus one signature at $200 a SOL. */
  assert.ok(Math.abs(costs.totalUsd - (9.99834580445001 - 9.826547047809152 + 0.001)) < 1e-9, `got ${costs.totalUsd}`);
  assert.ok(Math.abs(costs.issuerFeeUsd - 0.1) < 1e-12);
  assert.equal(approxUsd(costs.issuerFeeUsd, "uk-UA"), "≈ $0,10");
  /* Without the venue's dollar values the floor counts the issuer's basis points too: 110 bps of $10. */
  const floor = buyCosts({ ...quote, inUsdValue: null, outUsdValue: null, priceImpactPct: "0" });
  assert.ok(Math.abs(floor.totalUsd - (0.11 + 0.001)) < 1e-9, `got ${floor.totalUsd}`);
  /* A mint that withholds nothing names no issuer's fee. */
  assert.equal(buyCosts({ ...quote, issuerFeeBasisPoints: null }).issuerFeeUsd, null);
  assert.equal(buyCosts({ ...quote, issuerFeeBasisPoints: 0 }).issuerFeeUsd, null);
});

test("a private company's one number: its price against PreStocks' valuation, whole from ten up, one decimal below, no tone", () => {
  assert.equal(premiumLine(30.16, "PreStocks", "uk"), "на 30% дорожче за оцінку PreStocks");
  assert.equal(premiumLine(30.16, "PreStocks", "en"), "30% above PreStocks' valuation");
  assert.equal(premiumLine(-21.34, "PreStocks", "uk"), "на 21% дешевше за оцінку PreStocks");
  assert.equal(premiumLine(-1.3387, "PreStocks", "uk"), "на 1,3% дешевше за оцінку PreStocks");
  assert.equal(premiumLine(-1.3387, "PreStocks", "en"), "1.3% below PreStocks' valuation");
  assert.equal(premiumLine(9.97, "PreStocks", "uk"), "на 10% дорожче за оцінку PreStocks", "a figure that rounds to ten is said whole");
  assert.equal(premiumLine(0.02, "PreStocks", "uk"), "≈ як оцінка PreStocks");
  assert.equal(premiumLine(null, "PreStocks", "uk"), null, "nothing when the server states none");
  assert.equal(premiumLine(Number.NaN, "PreStocks", "en"), null);
});

test("a cost prints as an approximation, and a real but tiny one never as zero", () => {
  assert.equal(approxUsd(0.0775, "en-US"), "≈ $0.08");
  assert.equal(approxUsd(0.0775, "uk-UA"), "≈ $0,08");
  assert.equal(approxUsd(0.004, "en-US"), "< $0.01");
});
