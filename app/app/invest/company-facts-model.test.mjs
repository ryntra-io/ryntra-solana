import assert from "node:assert/strict";
import { test } from "node:test";

import { backingPct, buyShare, countShort, dayShort, dividendWord, exchangeShort, moneyChange, moneyShort, monthYear, multiplierWord, pctShort, periodWord, ratioShort, truthTopic, yearRange } from "./company-facts-model.ts";

/* RYN-COMPANY-PAGE-001: the company page's facts at rest, shaped once. */

const nbsp = (text) => text?.replace(/[  ]/g, " ");

test("money reads in the canon's one formatter — трлн / млрд / млн / тис. — and a loss keeps its minus", () => {
  assert.equal(nbsp(moneyShort(5_436_000_000_000, "uk")), "$5,44 трлн");
  assert.equal(moneyShort(5_436_000_000_000, "en"), "$5.44T");
  assert.equal(nbsp(moneyShort(302_950_000_000, "uk")), "$303 млрд");
  assert.equal(nbsp(moneyShort(16_315_000, "uk")), "$16,3 млн");
  assert.equal(nbsp(moneyShort(912_400, "uk")), "$912 тис.");
  assert.equal(moneyShort(41, "en"), "$41");
  assert.equal(nbsp(moneyShort(-142_000_000, "uk")), "−$142 млн");
  assert.equal(moneyShort(null, "uk"), null);
  assert.equal(moneyShort(Number.NaN, "en"), null);
});

test("counts are whole under ten thousand and short above", () => {
  assert.equal(nbsp(countShort(9870, "uk")), "9 870");
  assert.equal(nbsp(countShort(110_440, "uk")), "110 тис.");
  assert.equal(nbsp(countShort(15_694, "uk")), "15,7 тис.");
  assert.equal(countShort(1_234_567, "en"), "1.2M");
  assert.equal(countShort(-1, "en"), null);
});

test("a ratio and a share each keep their own decimals", () => {
  assert.equal(ratioShort(28.46, "uk"), "28,5");
  assert.equal(pctShort(0.1241, "uk"), "0,12%");
  assert.equal(pctShort(100.06, "en"), "100.1%");
});

test("the day's move in dollars carries its sign; a move that rounds to nothing carries none", () => {
  assert.equal(moneyChange(2.72, "en"), "+$2.72");
  assert.equal(moneyChange(-0.41, "uk"), "−$0,41");
  assert.equal(moneyChange(0.00001, "en"), "$0.0000");
});

test("a report's day is the day written on it, whatever the reader's clock", () => {
  assert.equal(dayShort("2026-08-26", "en"), "Aug 26, 2026");
  assert.match(dayShort("2026-08-26", "uk"), /^26 серп\.? 2026/);
  assert.equal(dayShort("not a date", "en"), null);
  assert.equal(monthYear("2025-06-27T10:14:51Z", "en"), "June 2025");
  assert.equal(monthYear("2025-06-27T10:14:51Z", "uk"), "червень 2025");
});

test("the period a filing's figure covers is said after its label", () => {
  assert.equal(periodWord({ value: 1, end: "2026-07-26", basis: "ttm" }, "uk"), "за 12 міс.");
  assert.equal(periodWord({ value: 1, end: "2026-01-25", basis: "fy" }, "en"), "fiscal year");
  assert.equal(periodWord({ value: 1, end: "2026-06-30", basis: "ytd", months: 6 }, "uk"), "за 6 міс.");
  assert.equal(periodWord(null, "en"), null);
});

test("the exchange's short name comes from its MIC, then its filed name, then the SEC's", () => {
  assert.equal(exchangeShort({ mic: "XNAS", name: "Nasdaq Stock Market" }, "Nasdaq"), "Nasdaq");
  assert.equal(exchangeShort({ mic: "ARCX", name: "NYSE Arca" }, null), "NYSE Arca");
  assert.equal(exchangeShort({ mic: "XXXX", name: "Tokyo Stock Exchange" }, null), "Tokyo");
  assert.equal(exchangeShort(null, "NYSE"), "NYSE");
  assert.equal(exchangeShort(null, null), null);
});

test("every issuer has its label's topic and its word for dividends (canon §7)", () => {
  assert.equal(truthTopic("xstocks"), "truthXStocks");
  assert.equal(truthTopic("prestocks"), "truthPreStocks");
  assert.equal(dividendWord("xstocks", "uk"), "Уже в кількості токена");
  assert.equal(dividendWord("ondo", "en"), "Already in the token's price");
  assert.equal(dividendWord("prestocks", "uk"), "Немає");
  assert.equal(multiplierWord(1.0012, "uk"), "×1,0012");
  assert.equal(multiplierWord(1, "en"), null);
});

test("the backing is the issuer's shares held over its tokens out", () => {
  assert.ok(Math.abs(backingPct("185654", "185539.83135639055372") - 100.0615) < 0.001);
  assert.equal(backingPct("10", "0"), null);
  assert.equal(backingPct(null, "5"), null);
});

test("the year's range is the anchored line's low and high, the live price included, and where the price stands", () => {
  const now = Date.UTC(2026, 8, 25);
  const day = 86_400_000;
  const points = [
    { at: now - 400 * day, price: 50 },
    { at: now - 300 * day, price: 90 },
    { at: now - 100 * day, price: 240 },
    { at: now - 10 * day, price: 200 },
  ];
  const range = yearRange(points, 225, now);
  assert.equal(range.low, 90);
  assert.equal(range.high, 240);
  assert.equal(range.lowAt, now - 300 * day);
  assert.ok(Math.abs(range.position - (225 - 90) / 150) < 1e-9);
  assert.equal(range.since, now - 300 * day);
  const above = yearRange(points, 260, now);
  assert.equal(above.high, 260);
  assert.equal(above.highAt, now);
  assert.equal(above.position, 1);
  assert.equal(yearRange(points.slice(0, 1), 225, now), null);
});

test("buying against selling is a share of the trades, and needs both sides", () => {
  assert.equal(buyShare(78_145, 82_637).toFixed(2), "48.60");
  assert.equal(buyShare(0, 0), null);
  assert.equal(buyShare(null, 3), null);
});
