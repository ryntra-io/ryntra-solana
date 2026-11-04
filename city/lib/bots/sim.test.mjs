import { test } from "node:test";
import assert from "node:assert/strict";

import { bandOf, changedFields, defaultDraft, draftIssues, levelsOf, spread } from "./draft.ts";
import { barsFromCandles, straightBars, ticksOf } from "./path.ts";
import { simulate, tradesOf } from "./sim.ts";
import { preflight, stressTest, POSITION_RENT_SOL } from "./stress.ts";
import { canDoFromDraft, sameCanDo } from "./decode.ts";
import { fitOf, weatherOf, weekSize } from "./weather.ts";
import { recommend } from "./recommend.ts";
import { GOAL_KINDS, GOALS } from "./kinds.ts";

const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
const H = 3_600_000;

/** A price that swings between 90 and 110 around 100, `cycles` times. */
function swings(cycles = 4, perCycle = 24, start = 0) {
  const bars = [];
  let last = 100;
  for (let i = 1; i <= cycles * perCycle; i += 1) {
    const c = 100 + 10 * Math.sin((2 * Math.PI * i) / perCycle);
    bars.push({ t: start + i * H, o: last, c, h: Math.max(last, c), l: Math.min(last, c) });
    last = c;
  }
  return bars;
}

/** A week of hourly bars as a sine of `period` hours and `amp` around 100. */
function sine(period, amp, n = 168) {
  const bars = [];
  let last = 100;
  for (let i = 1; i <= n; i += 1) {
    const c = 100 + amp * Math.sin((2 * Math.PI * i) / period);
    bars.push({ t: i * H, o: last, c, h: Math.max(last, c), l: Math.min(last, c) });
    last = c;
  }
  return bars;
}

/** A quiet week whose last day and a half turns violent without a direction. */
function burst(n = 168) {
  const bars = [];
  let last = 100;
  for (let i = 1; i <= n; i += 1) {
    const c = 100 + (i > n - 40 ? 12 : 2) * Math.sin((2 * Math.PI * i) / 5);
    bars.push({ t: i * H, o: last, c, h: Math.max(last, c), l: Math.min(last, c) });
    last = c;
  }
  return bars;
}

test("the engine's candles become bars, bad ones left out, oldest first", () => {
  const bars = barsFromCandles([
    { time: 20, open: 2, high: 3, low: 1, close: 2.5 },
    { time: 10, open: 1, high: 2, low: 0.5, close: 2 },
    { time: 30, open: 0, high: 3, low: 1, close: 2 },
  ]);
  assert.deepEqual(bars.map((b) => b.t), [10_000, 20_000]);
  assert.deepEqual(ticksOf({ t: 0, o: 1, h: 3, l: 0.5, c: 2 }), [1, 0.5, 3, 2]);
  assert.deepEqual(ticksOf({ t: 0, o: 2, h: 3, l: 0.5, c: 1 }), [2, 3, 0.5, 1]);
});

test("the weather is the engine's: a channel is a range, a climb a trend up, a fall a trend down, a burst chop", () => {
  const range = weatherOf(sine(6, 5));
  assert.equal(range.sky, "range");
  assert.equal(weatherOf(straightBars(100, 140, 0, 168)).sky, "trendUp");
  assert.equal(weatherOf(straightBars(100, 70, 0, 168)).sky, "trendDown");
  assert.equal(weatherOf(burst()).sky, "chop");
  assert.equal(weatherOf(swings().slice(0, 30)), null, "too few bars for the engine to read");
  // How each bot fits is the engine's table; a bot it does not read says nothing.
  assert.equal(fitOf("grid", range), "good");
  assert.equal(fitOf("lpRange", range), "good");
  assert.equal(fitOf("recurring", range), "fair");
  assert.equal(fitOf("grid", weatherOf(straightBars(100, 70, 0, 168))), "poor");
  assert.equal(fitOf("exitLadder", weatherOf(straightBars(100, 140, 0, 168))), "good");
  assert.equal(fitOf("rebalancer", range), "fair");
  assert.equal(fitOf("grid", null), "fair");
  // The week's own size, which sizes a draft.
  const size = weekSize(sine(6, 5));
  assert.ok(size.low >= 95 - 1e-9 && size.low < 96 && size.high <= 105 + 1e-9 && size.high > 104);
  assert.ok(size.dayMovePct > 0);
  assert.equal(weekSize([]), null);
});

test("a grid in a swinging week buys low and sells high, and ends ahead of holding", () => {
  const draft = { ...defaultDraft("grid", SOL, 100, null, 100), lower: 88, upper: 112, levels: 10 };
  const run = simulate(draft, swings());
  const trades = tradesOf(run);
  assert.ok(trades.some((f) => f.side === "buy") && trades.some((f) => f.side === "sell"));
  for (const f of trades) assert.ok(f.price >= 88 - 1e-9 && f.price <= 112 + 1e-9, "every fill on a level of the range");
  assert.equal(run.left, null);
  assert.ok(run.pnlUsd > run.holdPnlUsd, `grid ${run.pnlUsd} vs hold ${run.holdPnlUsd}`);
  assert.ok(run.pnlUsd > 0);
  assert.ok(run.maxDrawdownPct >= 0 && run.maxDrawdownPct < 20);
  assert.equal(run.equity.length, swings().length);
  // Never more than the amount: every buy is paid from what the bot holds.
  let quote = 100;
  for (const f of run.fills) quote += f.side === "sell" ? f.usd : -f.usd;
  assert.ok(Math.abs(quote - run.quote) < 1e-6 && run.quote >= -1e-9);
});

test("leaving the range: stop keeps, sell all goes to USDC, wait holds still, rebuild trades on around the new price", () => {
  const base = { ...defaultDraft("grid", SOL, 100, null, 100), lower: 85, upper: 115, levels: 6 };
  const fall = [...swings(1, 12), ...straightBars(100, 70, 12 * H, 24), ...straightBars(70, 100, 36 * H, 24)];
  const stop = simulate({ ...base, exit: "stop" }, fall);
  assert.equal(stop.state, "stopped");
  assert.equal(stop.left.side, "below");
  assert.ok(stop.base > 0, "stop keeps the coin it holds");
  const sell = simulate({ ...base, exit: "sellAll" }, fall);
  assert.equal(sell.state, "stopped");
  assert.ok(sell.base < 1e-12 && sell.fills.some((f) => f.note === "exit"));
  const wait = simulate({ ...base, exit: "wait" }, fall);
  assert.equal(wait.state, "running", "the price came back into the range");
  const rebuild = simulate({ ...base, exit: "rebuild" }, fall);
  assert.ok(rebuild.fills.some((f) => f.note === "rebuild"));
  assert.ok(tradesOf(rebuild).length > tradesOf(stop).length);
});

test("ladders: a buy ladder fills its steps on the way down, an exit ladder sells its parts on the way up", () => {
  const buy = defaultDraft("buyLadder", SOL, 100, null, 100);
  const down = simulate({ ...buy, steps: 4, firstPct: 2, lastPct: 20 }, straightBars(100, 75, 0));
  assert.equal(tradesOf(down).filter((f) => f.side === "buy").length, 4);
  assert.ok(down.quote < 1e-6);
  const exit = defaultDraft("exitLadder", SOL, 100, null, 100);
  const up = simulate({ ...exit, steps: 4, firstPct: 5, lastPct: 20 }, straightBars(100, 130, 0));
  assert.equal(tradesOf(up).filter((f) => f.side === "sell").length, 4);
  assert.equal(up.state, "done");
  assert.ok(up.base < 1e-9 && up.endUsd > 100);
  assert.deepEqual(spread(2, 8, 4), [2, 4, 6, 8]);
  const levels = levelsOf({ ...buy, steps: 3, firstPct: 10, lastPct: 30 }, 100);
  assert.deepEqual(levels.map((l) => Math.round(l)), [70, 80, 90]);
  assert.deepEqual(bandOf({ ...exit, steps: 2, firstPct: 10, lastPct: 20 }, 100), { lower: 85, upper: 120 * 1.05 });
});

test("a recurring buy is a reminder answered with a tap, never more than its amount", () => {
  const draft = { ...defaultDraft("recurring", SOL, 100, null, 100), everyHours: 24, buys: 5 };
  const run = simulate(draft, swings(7));
  const taps = tradesOf(run);
  assert.equal(taps.length, 5);
  assert.ok(taps.every((f) => f.note === "tap" && f.side === "buy"));
  assert.ok(taps.every((f, i) => i === 0 || f.t - taps[i - 1].t >= 24 * H));
  assert.ok(Math.abs(taps.reduce((a, f) => a + f.usd, 0) - 100) < 1e-6);
  const smart = simulate({ ...draft, kind: "smartDca" }, swings(7));
  assert.ok(tradesOf(smart).reduce((a, f) => a + f.usd, 0) <= 100 + 1e-6);
});

test("a rebalancer keeps its split, a price alert only alerts, a signal trades on the cross", () => {
  const rebal = simulate({ ...defaultDraft("rebalancer", SOL, 100, null, 100), targetPct: 50, driftPct: 2 }, swings());
  assert.ok(tradesOf(rebal).length > 0);
  const end = (rebal.base * rebal.endPrice) / rebal.endUsd;
  assert.ok(Math.abs(end * 100 - 50) <= 2 + 1e-6);
  const alert = simulate({ ...defaultDraft("priceAlert", SOL, 100, null, 100), movePct: -8 }, swings());
  assert.equal(tradesOf(alert).length, 0, "an alert sells nothing by itself");
  assert.ok(alert.alerts.length >= 1);
  assert.ok(Math.abs(alert.pnlUsd - alert.holdPnlUsd) < 1e-9);
  const signal = simulate(defaultDraft("signal", SOL, 100, null, 100), swings(4));
  assert.ok(tradesOf(signal).length >= 2);
});

test("a paused span is skipped and the run carries on", () => {
  const bars = swings(4);
  const all = simulate({ ...defaultDraft("grid", SOL, 100, null, 100), lower: 88, upper: 112 }, bars);
  const half = simulate({ ...defaultDraft("grid", SOL, 100, null, 100), lower: 88, upper: 112 }, bars, { active: (t) => t < 48 * H });
  assert.ok(half.fills.length < all.fills.length);
  assert.equal(half.equity.length, 47);
  assert.equal(simulate(defaultDraft("grid", SOL, 100, null), bars, { active: () => false }), null);
});

test("defaults fit the weather, and a draft says what is wrong with it", () => {
  const weather = weatherOf(swings());
  const grid = defaultDraft("grid", SOL, 100, weather);
  assert.ok(grid.lower < weather.low && grid.upper > weather.high);
  assert.deepEqual(draftIssues(grid), []);
  assert.deepEqual(draftIssues({ ...grid, amountUsd: 5, upper: grid.lower }), ["amount", "range"]);
  assert.deepEqual(draftIssues({ ...defaultDraft("signal", SOL, 100, null), slow: 5, fast: 9 }), ["signal"]);
  assert.deepEqual(changedFields(grid, { ...grid, levels: 16, copiedFrom: { strategyId: "a", versionId: "b" } }), ["levels"]);
});

test("the stress test and the start's cost, in dollars and SOL", () => {
  const grid = { ...defaultDraft("grid", SOL, 100, null, 100), lower: 80, upper: 120, levels: 10 };
  const rows = stressTest(grid, 100);
  assert.deepEqual(rows.map((r) => r.movePct), [-30, -15, 15, 30]);
  const down = rows[0];
  assert.ok(Math.abs(down.holdUsd - 70) < 1e-6);
  const up = rows.at(-1);
  assert.ok(up.botUsd < up.holdUsd, "a grid sells on the way up and misses some of the climb");
  assert.deepEqual(preflight(grid), { startSignatures: 1, perTrade: 0, networkSol: 0.0001, depositSol: POSITION_RENT_SOL });
  assert.equal(preflight(defaultDraft("recurring", SOL, 100, null)).perTrade, 1);
  assert.equal(preflight(defaultDraft("buyLadder", SOL, 100, null)).depositSol, 0);
});

test("«What this bot can do» is read from the draft and names where the money sits", () => {
  const grid = canDoFromDraft(defaultDraft("grid", SOL, 100, null, 250));
  assert.deepEqual([grid.pair, grid.maxUsd, grid.custody, grid.withdraw, grid.close, grid.tradesAlone, grid.standalone, grid.exit, grid.source], ["SOL/USDC", 250, "position", "wallet", "withdraw", true, true, "wait", "draft"]);
  const ladder = canDoFromDraft(defaultDraft("buyLadder", SOL, 100, null));
  assert.deepEqual([ladder.custody, ladder.withdraw, ladder.close], ["order", "wallet", "cancel"], "orders on the chain, only the wallet cancels them");
  const dca = canDoFromDraft(defaultDraft("recurring", SOL, 100, null));
  assert.deepEqual([dca.custody, dca.tradesAlone, dca.standalone, dca.exit], ["wallet", false, false, null]);
  assert.equal(sameCanDo(grid, { ...grid, source: "transaction" }), true);
  assert.equal(sameCanDo(grid, { ...grid, maxUsd: 251 }), false);
});

test("every goal recommends one of its own bots, with reasons", () => {
  for (const goal of GOALS) {
    for (const bars of [swings(), sine(6, 5), burst(), straightBars(100, 70, 0, 168), straightBars(100, 140, 0, 168)]) {
      const r = recommend(goal, weatherOf(bars));
      assert.ok(GOAL_KINDS[goal].includes(r.kind), `${goal} → ${r.kind}`);
      assert.ok(r.reasons.length >= 2 && r.reasons.length <= 3);
      assert.equal(r.reasons[0].id, "goal");
    }
  }
  // The weather only chooses between a goal's bots, by the engine's fit.
  assert.equal(recommend("swings", weatherOf(sine(6, 5))).kind, "grid");
  assert.equal(recommend("accumulate", weatherOf(sine(6, 5))).kind, "buyLadder", "a channel suits a ladder of buys");
  assert.equal(recommend("accumulate", weatherOf(burst())).kind, "recurring", "chop suits buying on a schedule");
  assert.equal(recommend("accumulate", weatherOf(straightBars(100, 140, 0, 168))).kind, "recurring");
  assert.equal(recommend("profit", weatherOf(straightBars(100, 140, 0, 168))).kind, "exitLadder");
  assert.equal(recommend("profit", weatherOf(straightBars(100, 70, 0, 168))).kind, "priceAlert", "no exit ladder into a fall");
  assert.equal(recommend("balance", null).kind, "rebalancer");
  const reason = recommend("swings", weatherOf(sine(6, 5))).reasons[1];
  assert.deepEqual(reason, { id: "weather", sky: "range", fit: "good" });
});
