import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHART_BARS, CHART_DEFAULT, CHART_TIMEFRAMES, chartView } from "./candles.ts";

const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1, final: true });
const read = (last, symbol = "SOL", timeframe = "1h") => ({ symbol, timeframe, last, mark: [], observedAt: 1 });

test("the chart draws Phoenix's own bars, oldest to newest, in a box from 0 to 1", () => {
  const view = chartView(read([bar(2, 150, 156, 149, 155), bar(1, 140, 151, 138, 150)]), "sol", "1h");
  assert.equal(view.candles.length, 2);
  assert.equal(view.high, 156);
  assert.equal(view.low, 138);
  assert.equal(view.last, 155);
  // The oldest on the left, the newest on the right; the lowest wick at the foot, the highest at the top.
  assert.ok(view.candles[0].x < view.candles[1].x);
  assert.equal(view.candles[0].low, 0);
  assert.equal(view.candles[1].high, 1);
  assert.equal(view.candles[1].up, true);
  assert.equal(view.lastAt, (155 - 138) / (156 - 138));
});

test("another market's or another interval's read, or none with a bar, draws nothing", () => {
  const bars = [bar(1, 1, 2, 0.5, 1.5)];
  assert.equal(chartView(read(bars, "BTC"), "SOL", "1h"), null);
  assert.equal(chartView(read(bars, "SOL", "4h"), "SOL", "1h"), null);
  assert.equal(chartView(read([]), "SOL", "1h"), null);
  assert.equal(chartView(read([bar(1, 0, 0, 0, 0), bar(2, Number.NaN, 2, 1, 1)]), "SOL", "1h"), null);
  assert.equal(chartView(null, "SOL", "1h"), null);
});

test("only the newest bars are drawn, and a flat market still has a height", () => {
  const many = Array.from({ length: CHART_BARS + 20 }, (_, index) => bar(index, 10, 11, 9, 10));
  assert.equal(chartView(read(many), "SOL", "1h").candles.length, CHART_BARS);
  const flat = chartView(read([bar(1, 5, 5, 5, 5)]), "SOL", "1h");
  assert.ok(flat.high > 5 && flat.low < 5);
  assert.ok(flat.lastAt > 0 && flat.lastAt < 1);
});

test("a few intervals the engine serves, opening on the hour", () => {
  const engine = readFileSync(new URL("../../../lib/phoenix/market-data.ts", import.meta.url), "utf8");
  for (const tf of CHART_TIMEFRAMES) assert.match(engine, new RegExp(`"${tf}"`));
  assert.equal(CHART_DEFAULT, "1h");
});

test("the wide view leads with the chart, so the full-screen Exchange never stands on an empty frame", () => {
  const window = readFileSync(new URL("../../components/exchange/ExchangeWindow.tsx", import.meta.url), "utf8");
  const columns = window.slice(window.indexOf("function Columns"), window.indexOf("function Stacked"));
  assert.equal(columns.match(/<PriceChart \/>/g)?.length, 2);
  const chart = readFileSync(new URL("../../components/exchange/PriceChart.tsx", import.meta.url), "utf8");
  // Phoenix silent with nothing to draw: the frame goes, it is never left empty.
  assert.match(chart, /if \(!view && read\.status === 'failed'\) return null;/);
});
