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
  // Phoenix silent with nothing ever read: the frame goes, it is never left empty.
  assert.match(chart, /if \(!read\.value && read\.status === 'failed'\) return null;/);
  // Our chart, not a drawing (30.10): the core chart on Phoenix's own feed.
  const core = readFileSync(new URL("../../components/exchange/CoreChart.tsx", import.meta.url), "utf8");
  assert.match(core, /<RyntraChart/);
  assert.match(core, /new FuturesChartFeed\(/);
});

test("the forming bar follows the live mark between the reads of the bars (30.10)", () => {
  const bars = [bar(1, 140, 151, 138, 150), bar(2, 150, 156, 149, 155)];
  const still = chartView(read(bars), "SOL", "1h");
  const rising = chartView(read(bars), "SOL", "1h", CHART_BARS, 160);
  assert.equal(still.last, 155);
  assert.equal(rising.last, 160);
  assert.equal(rising.high, 160, "a new high stretches the box");
  const falling = chartView(read(bars), "SOL", "1h", CHART_BARS, 130);
  assert.equal(falling.low, 130);
  assert.equal(falling.candles.at(-1).up, false, "below its open the forming bar turns red");
  assert.deepEqual(chartView(read(bars), "SOL", "1h", CHART_BARS, null), still, "no mark — the bars as read");
});

test("the core feed gets the read with its forming bar at the live mark (30.10)", async () => {
  const { withLiveMark } = await import("./candles.ts");
  const candles = read([bar(1, 140, 151, 138, 150), bar(2, 150, 156, 149, 155)]);
  assert.equal(withLiveMark(candles, null), candles);
  const moved = withLiveMark(candles, 160);
  assert.equal(moved.last.find((b) => b.t === 2).c, 160);
  assert.equal(moved.last.find((b) => b.t === 2).h, 160);
  assert.equal(moved.last.find((b) => b.t === 1).c, 150, "older bars stay as read");
});
