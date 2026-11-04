import { test } from "node:test";
import assert from "node:assert/strict";

import { pierOf } from "./pier.ts";
import { HISTORY_MIN_BARS, closesOf, historyPicture, pierSeries, plotOf } from "./pier-history.ts";
import { SOL_USDC, closes, lstPool } from "./pier-fixtures.mjs";

const lst = pierOf(lstPool());
const usdc = pierOf(SOL_USDC);
const answer = (candles) => ({ timeframe: "4h", candles });

test("an LST pier's price is the LST's close over SOL's, bar by bar", () => {
  const sol = closesOf(answer(closes(180, 190, 60, 0)));
  const jito = closesOf(answer(closes(180 * 1.25, 190 * 1.26, 60, 0)));
  // A bar SOL has and the LST does not is left out.
  jito.delete([...jito.keys()][3]);
  const series = pierSeries(lst, sol, jito);
  assert.equal(series.length, 59);
  assert.ok(Math.abs(series[0].p - 1.25) < 1e-9);
  assert.ok(Math.abs(series.at(-1).p - 1.26) < 1e-9);
});

test("a SOL–USDC pier's price is SOL's own line; USDC is not read", () => {
  const series = pierSeries(usdc, closesOf(answer(closes(150, 180, 60, 0))), null);
  assert.equal(series[0].p, 150);
  assert.equal(series.at(-1).p, 180);
});

test("bad bars and other answers are not a series", () => {
  assert.equal(closesOf(null).size, 0);
  assert.equal(closesOf({ candles: [{ time: 1, open: 0, high: 1, low: 1, close: 1 }] }).size, 0);
  assert.equal(pierSeries(lst, closesOf(answer(closes(180, 190, 60, 0))), null).length, 0);
});

test("a calm range stays in longer than a dense one, and a move costs against holding", () => {
  const sol = closesOf(answer(closes(150, 180)));
  const series = pierSeries(usdc, sol, null);
  const calm = historyPicture(usdc, series, "calm", 1_000_000_000n);
  const dense = historyPicture(usdc, series, "dense", 1_000_000_000n);
  assert.ok(calm.inRange >= dense.inRange);
  assert.ok(calm.inRange > 0 && calm.inRange <= 1);
  // SOL rose 20 %: a range that sold SOL on the way up is behind just holding, in SOL.
  assert.ok(calm.vsHoldSol < 0);
  assert.ok(calm.vsHoldPct < 0);
  assert.ok(Math.abs(calm.movePct - 20) < 1.5);
  assert.equal(calm.days, 30);
  // Without an amount, only the per cent.
  assert.equal(historyPicture(usdc, series, "calm", null).vsHoldSol, null);
});

test("an LST pier that never moved stays in range and level with holding", () => {
  const series = pierSeries(lst, closesOf(answer(closes(180, 180, 180, 0))), closesOf(answer(closes(180 * 1.2603, 180 * 1.2603, 180, 0))));
  const picture = historyPicture(lst, series, "dense", 2_000_000_000n);
  assert.equal(picture.inRange, 1);
  assert.ok(Math.abs(picture.vsHoldSol) < 1e-9);
});

test("too short a past is no picture", () => {
  const series = pierSeries(usdc, closesOf(answer(closes(150, 151, HISTORY_MIN_BARS - 1, 0))), null);
  assert.equal(historyPicture(usdc, series, "calm", null), null);
});

test("the plot keeps the band and every price inside the box, and lights the runs in range", () => {
  const series = pierSeries(usdc, closesOf(answer(closes(150, 180))), null);
  const picture = historyPicture(usdc, series, "balanced", 1_000_000_000n);
  const plot = plotOf(picture, 300, 80);
  assert.ok(plot.line.startsWith("M0.0,"));
  assert.ok(plot.bandTop >= 0 && plot.bandBottom <= 80 && plot.bandTop < plot.bandBottom);
  assert.ok(plot.lit.length >= 1);
  assert.ok(Math.abs(plot.end.x - 300) < 1e-9);
});
