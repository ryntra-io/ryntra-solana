import assert from "node:assert/strict";
import test from "node:test";

import { adx, atr, atrRatio, bandShare, ema, trueRanges, wilder } from "./indicators.ts";
import { marketWeather, WEATHER_BOTS, WEATHER_MIN_BARS } from "./weather.ts";
import { chopCandles, rangeCandles, trendCandles } from "../backtest/fixtures/markets.mjs";

test("true range reaches back to the previous close; Wilder smooths from the mean of a period", () => {
  const bars = [
    { t: 0, o: 10, h: 11, l: 9, c: 10 },
    { t: 1, o: 13, h: 14, l: 12.5, c: 13 },
  ];
  assert.deepEqual(trueRanges(bars), [2, 4]);
  assert.deepEqual(wilder([1, 2, 3, 4], 2), [Number.NaN, 1.5, 2.25, 3.125]);
  assert.deepEqual(ema([2, 4, 6], 2).slice(1), [3, 5]);
  assert.ok(Number.isNaN(atr(bars, 14)[1]), "too few bars — no ATR, never a guess");
});

test("ADX is high and +DI leads on a steady rise; low on a sideways market", () => {
  const up = adx(trendCandles("up")).at(-1);
  assert.ok(up.adx > 25, `ADX ${up.adx}`);
  assert.ok(up.plusDi > up.minusDi);
  const down = adx(trendCandles("down")).at(-1);
  assert.ok(down.minusDi > down.plusDi);
  assert.ok(adx(rangeCandles()).at(-1).adx < 20);
  assert.ok(Number.isNaN(adx(trendCandles("up").slice(0, 20)).at(-1).adx));
});

test("a channel keeps its closes inside the band; a steady climb leaves it; chop swings past its norm", () => {
  assert.ok(bandShare(rangeCandles(), 100) >= 0.8);
  assert.ok(bandShare(trendCandles("up"), 100) < 0.5);
  assert.ok(atrRatio(chopCandles(), 100) > 1.25);
  assert.ok(atrRatio(rangeCandles(), 100) <= 1.25);
});

test("trend, range and chop, each with one plain line and a fit for every kind of bot", () => {
  const trend = marketWeather(trendCandles("up"));
  assert.deepEqual([trend.kind, trend.direction], ["trend", "up"]);
  assert.equal(trend.fit.grid.fit, "poor");
  assert.equal(trend.fit.grid.line.uk, "тренд угору — сітка зараз погано підходить");
  assert.equal(trend.line.uk, "Тренд угору");

  const down = marketWeather(trendCandles("down"));
  assert.deepEqual([down.kind, down.direction, down.fit.ladder_sell.fit], ["trend", "down", "poor"]);

  const range = marketWeather(rangeCandles());
  assert.equal(range.kind, "range");
  assert.deepEqual([range.fit.grid.fit, range.fit.range_lp.fit], ["good", "good"]);
  assert.equal(range.fit.grid.line.uk, "боковик — сітка зараз добре підходить");

  const chop = marketWeather(chopCandles());
  assert.equal(chop.kind, "chop");
  assert.equal(chop.fit.dca.fit, "good");

  for (const weather of [trend, range, chop]) assert.deepEqual(Object.keys(weather.fit).sort(), [...WEATHER_BOTS].sort());
});

test("too few bars is no weather", () => {
  assert.equal(marketWeather(rangeCandles().slice(0, WEATHER_MIN_BARS - 1)), null);
});
