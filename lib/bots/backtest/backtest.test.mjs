import assert from "node:assert/strict";
import test from "node:test";

import { backtest, fitGrid, stressGrid, stressHoldings, walkForward } from "./backtest.ts";
import { candlesOf, coverage, PERIOD_PAGE, poolInstrument } from "./candles.ts";
import { readCandles } from "./candles.server.ts";
import { mintSafety, pairSafety } from "./mint-safety.ts";
import { readPaperTwin, startPaperTwin, stepPaperTwin, twinDifference } from "./paper.ts";
import { NOT_WORTH_SHARE, preflight } from "./preflight.ts";
import { DEFAULT_COSTS, gridCosts, gridHoldings, gridLevels, gridMove, gridStart, gridValue, simulateDca, simulateGrid, simulateHold, simulateLadder } from "./sim.ts";
import { linePath, rangeCandles, trendCandles } from "./fixtures/markets.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const FREE = { ...DEFAULT_COSTS, slippageBps: 0, priorityFeeLamports: 0, solUsd: 0 };
const grid = { lower: 190, upper: 210, levels: 21, side: "both", amountQuote: 1_000 };

test("a grid's levels are one step apart; below the price they hold the quote, above it the base", () => {
  const levels = gridLevels(grid);
  assert.equal(levels.length, 21);
  near(levels[0], 190);
  near(levels[20], 210);
  near(levels[1] / levels[0], levels[20] / levels[19]);
  const start = gridStart(grid, 200, 25);
  for (const level of start.levels) assert.ok(level.price <= 200 ? level.base === 0 && level.quote > 0 : level.quote === 0 && level.base > 0);
  near(gridValue(start), 1_000);
  assert.ok(gridStart({ ...grid, side: "buy" }, 200, 25).levels.every((level) => level.base === 0));
  assert.ok(gridStart({ ...grid, side: "sell" }, 200, 25).levels.every((level) => level.quote === 0));
});

test("a round trip through the levels returns the same tokens and earns the pool's fee both ways", () => {
  const start = gridStart(grid, 200, 25);
  const up = gridMove(start, 211);
  assert.equal(gridHoldings(up).base, 0, "above the grid: all sold");
  const back = gridMove(up, 200);
  near(gridHoldings(back).base, gridHoldings(start).base);
  near(gridHoldings(back).quote, gridHoldings(start).quote);
  assert.equal(back.fills, 20);
  near(gridValue(back), 1_000 + back.fees);
  assert.ok(back.fees > 0);
});

test("a trend walks a grid out of its range: all in the quote, behind holding", () => {
  const result = simulateGrid(linePath(200, 260, 50), grid, FREE);
  assert.equal(result.approximate, true);
  near(result.end.base, 0);
  assert.ok(result.vsHoldUsd < 0, "it sold the base on the way up");
  const ranging = simulateGrid(rangeCandles(), grid, FREE);
  assert.ok(ranging.feesEarnedUsd > 0 && ranging.fills > 20);
});

test("what running a grid costs: two signatures to place, one to close, the priority fee on each, the base it buys", () => {
  const costs = gridCosts(grid, 200, DEFAULT_COSTS);
  near(costs.networkUsd, (15_000 / 1e9) * 200);
  near(costs.priorityUsd, (200_000 / 1e9) * 200);
  /* Ten levels of 21 sit above $200 and hold the base: bought through a 0.25 % pool with 0.3 % slippage. */
  const bought = (1_000 * 10) / 21;
  near(costs.slippageUsd, bought * 0.003);
  near(costs.protocolUsd, bought * 0.0025);
  const rent = gridCosts(grid, 200, DEFAULT_COSTS, 70_000_000);
  near(rent.networkUsd - costs.networkUsd, 14);
});

test("a ladder: a Trigger leg fills past Jupiter's fee, a DLMM leg at its bin and earns half the swap fee", () => {
  const path = linePath(200, 170, 31);
  const legs = [
    { side: "buy", price: 190, amount: 100 },
    { side: "buy", price: 170, amount: 100 },
  ];
  const trigger = simulateLadder(path, { venue: "trigger", legs }, FREE);
  /* 170 is the path's low: Jupiter's 10 bps on top asks 169.83, never reached. */
  assert.equal(trigger.fills, 1);
  const dlmm = simulateLadder(path, { venue: "dlmm", legs }, FREE);
  assert.equal(dlmm.fills, 2);
  near(dlmm.feesEarnedUsd, 200 * 0.0025 * 0.5);
  near(dlmm.end.base, 100 / 190 + 100 / 170);
  /* Each Trigger leg is one signature; a DLMM leg two to place and one to claim. */
  assert.ok(simulateLadder(path, { venue: "dlmm", legs }).costs.networkUsd > simulateLadder(path, { venue: "trigger", legs }).costs.networkUsd);
});

test("DCA buys on its schedule, paying slippage, the pool and the network each time", () => {
  const result = simulateDca(linePath(100, 100, 24), { everyBars: 6, amountQuote: 50 }, DEFAULT_COSTS);
  assert.equal(result.fills, 4);
  near(result.costs.slippageUsd, 4 * 0.15);
  near(result.costs.protocolUsd, 4 * 0.125);
  assert.ok(result.vsHoldUsd < 0, "a flat market: DCA only pays its costs");
});

test("the worst drawdown is the deepest fall from a high", () => {
  const path = [...linePath(200, 100, 11), ...linePath(100, 200, 11).slice(1)].map((bar, i) => ({ ...bar, t: i }));
  const hold = simulateHold(path, 1_000, FREE);
  near(hold.maxDrawdownPct, 50);
  near(hold.maxDrawdownUsd, 500);
});

test("the dollar stress test: «якщо SOL −30 %: ~$X»", () => {
  const plain = stressHoldings({ base: 1, price: 200 }, "SOL");
  near(plain.lossUsd, 60);
  assert.equal(plain.line.uk, "Якщо SOL −30 %: ~−$60");
  assert.equal(plain.line.en, "If SOL falls 30%: ~−$60");
  /* A buying grid buys on the way down: it loses more than its base alone would. */
  const start = gridStart({ ...grid, side: "buy" }, 200, 0);
  const stressed = stressGrid(start, "SOL");
  assert.ok(stressed.lossUsd > 0 && stressed.lossUsd < 1_000 * 0.3);
  near(stressed.priceTo, 140);
});

test("walk-forward: each window's grid is fitted on the window before it only", () => {
  const candles = rangeCandles(300);
  const wf = walkForward(candles, { bot: "grid", grid }, FREE);
  assert.equal(wf.folds.length, 4);
  const size = Math.floor(300 / 5);
  const fitted = fitGrid(candles.slice(0, size), grid);
  assert.deepEqual(wf.folds[0].setting.grid, fitted);
  assert.equal(wf.folds[0].from, candles[size].t);
  near(wf.pnlUsd, wf.folds.reduce((sum, fold) => sum + fold.result.pnlUsd, 0));
  assert.equal(walkForward(candles.slice(0, 30), { bot: "grid", grid }), null, "too short to cut");
});

test("a backtest labels a grid «приблизно», and carries holding, walk-forward and stress beside it", () => {
  const candles = trendCandles("down", 168);
  const run = backtest(candles, { bot: "grid", grid: { ...grid, lower: 150, upper: 210 } }, { period: "7d", symbol: "SOL" });
  assert.deepEqual(run.label, { uk: "приблизно", en: "approximate" });
  assert.equal(run.coverage, 1);
  assert.ok(run.hold && run.walkForward && run.stress.lossUsd >= 0);
  const dca = backtest(candles, { bot: "dca", dca: { everyBars: 24, amountQuote: 20 } }, { period: "7d", symbol: "SOL" });
  assert.equal(dca.label, null);
  near(dca.stress.lossUsd, dca.result.end.base * dca.result.end.price * 0.3);
});

test("the paper twin runs another setting on the same candles, each candle once", () => {
  const candles = rangeCandles(200);
  const wide = { ...grid, lower: 180, upper: 220 };
  let twin = startPaperTwin(wide, candles[0], FREE);
  twin = stepPaperTwin(twin, candles.slice(0, 120));
  twin = stepPaperTwin(twin, candles.slice(100));
  const once = stepPaperTwin(startPaperTwin(wide, candles[0], FREE), candles);
  assert.deepEqual(twin.state, once.state);
  assert.equal(twin.lastT, candles.at(-1).t);
  const twinJson = JSON.parse(JSON.stringify(twin));
  assert.deepEqual(readPaperTwin(twinJson), readPaperTwin(twin), "kept as JSON and read back");
  const live = simulateGrid(candles, grid, FREE);
  near(twinDifference(twin, live.endUsd), readPaperTwin(twin).valueUsd - live.endUsd);
});

test("pre-flight: rent that comes back, rent that does not, the network, the minimum and the SOL reserve", () => {
  const rent = [
    { what: "position", direction: "pay", lamports: "57000000", refundable: true },
    { what: "bin_arrays", direction: "pay", lamports: "71000000", refundable: false },
  ];
  const check = preflight({ amountUsd: 500, solUsd: 200, rent, networkFeeLamports: "110000", walletLamports: "2000000000" });
  assert.equal(check.rentRefundableLamports, 57_000_000);
  assert.equal(check.rentKeptLamports, 71_000_000);
  assert.equal(check.solNeededLamports, 57_000_000 + 71_000_000 + 110_000 + 500_000);
  near(check.lostUsd, ((71_000_000 + 110_000) / 1e9) * 200);
  assert.equal(check.notWorthIt, true, "$14.2 lost on $500 is past 2 %");
  assert.equal(preflight({ amountUsd: 5_000, solUsd: 200, rent, networkFeeLamports: 110_000 }).notWorthIt, false);
  assert.equal(preflight({ amountUsd: 500, solUsd: 200, rent, networkFeeLamports: 110_000, notWorthShare: 0.05 }).notWorthIt, false);
  assert.equal(NOT_WORTH_SHARE, 0.02);
  const short = preflight({ amountUsd: 500, solUsd: 200, rent, networkFeeLamports: 110_000, walletLamports: 100_000_000 });
  assert.deepEqual(short.refusals, ["SOL_SHORT"]);
  const legs = preflight({ amountUsd: 12, solUsd: 200, rent: [], networkFeeLamports: 5_000, venue: "trigger", legsUsd: [6, 4, 2] });
  assert.deepEqual([legs.belowMinimum, legs.refusals], [[1, 2], ["BELOW_VENUE_MINIMUM"]]);
  assert.deepEqual(preflight({ amountUsd: 12, solUsd: 200, rent: [], networkFeeLamports: 5_000, venue: "dlmm", bins: 51 }).refusals, ["TOO_MANY_BINS"]);
});

test("the mint filter leaves out Token-2022 mints that can take, stop or tax the tokens — and what it did not read", () => {
  const clean = { program: "spl-token-2022", freeze_authority: null, permanent_delegate: null, transfer_hook: null, transfer_fee: null };
  assert.deepEqual(mintSafety(clean), { ok: true, reasons: [] });
  assert.deepEqual(
    mintSafety({ ...clean, freeze_authority: "F".repeat(32), permanent_delegate: "D".repeat(32), transfer_hook: { program: "H".repeat(32), authority: null }, transfer_fee: { in_force: null, in_force_why: null } }).reasons,
    ["permanent_delegate", "transfer_hook", "freeze_authority", "transfer_fee"],
  );
  /* USDC: a classic SPL mint with a freeze authority stays in. */
  assert.equal(mintSafety({ ...clean, program: "spl-token", freeze_authority: "F".repeat(32) }).ok, true);
  assert.deepEqual(mintSafety(null), { ok: false, reasons: ["not_read"] });
  assert.deepEqual(pairSafety(clean, null), { ok: false, reasons: ["not_read"] });
});

test("candles from the gateway's page: numbers, oldest first, one per open; a bar that is not a candle is dropped", () => {
  const bars = [
    { t: 2, o: "101", h: "103", l: "100", c: "102", v: null, turnover: null, trades: null },
    { t: 1, o: "100", h: "102", l: "99", c: "101", v: null, turnover: null, trades: null },
    { t: 3, o: "102", h: "101", l: "100", c: "102", v: null, turnover: null, trades: null },
    { t: 4, o: "x", h: "1", l: "1", c: "1", v: null, turnover: null, trades: null },
  ];
  assert.deepEqual(candlesOf(bars).map((bar) => bar.t), [1, 2]);
  assert.equal(poolInstrument("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"), "solana:pool:5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
  assert.equal(poolInstrument("not a pool"), null);
  assert.equal(coverage(trendCandles("up", 84), "7d"), 0.5);
  assert.ok(Object.values(PERIOD_PAGE).every((page) => page.bars <= 1_500 && page.bars * page.barMs === page.days * 86_400_000));
});

test("the gateway's candles: not read without its address, unknown for an instrument it does not record", async () => {
  assert.deepEqual(await readCandles("solana:pool:x", "7d", { env: {} }), { ok: false, reason: "NO_GATEWAY" });
  const env = { MD_GATEWAY_URL: "https://md.example" };
  const asked = [];
  const answer = (status, body) => async (url) => {
    asked.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  assert.deepEqual(await readCandles("solana:pool:x", "30d", { env, fetchImpl: answer(404, {}) }), { ok: false, reason: "UNKNOWN_INSTRUMENT" });
  assert.match(asked[0], /^https:\/\/md\.example\/v1\/history\?instrument=solana%3Apool%3Ax&resolution=1h&load=init&limit=720$/);
  const page = {
    bars: [{ t: 1, o: "100", h: "102", l: "99", c: "101", v: null, turnover: null, trades: null }],
    more: { forward: false, backward: false },
    gaps: [],
    display_step: "0.01",
    multiplier_version: null,
    status: { state: "live", at: 9, age_ms: 0, source: { label: "Solana swaps" } },
  };
  const read = await readCandles("solana:pool:x", "180d", { env, fetchImpl: answer(200, page) });
  assert.deepEqual(read, { ok: true, candles: [{ t: 1, o: 100, h: 102, l: 99, c: 101 }], at: 9 });
  assert.match(asked[1], /resolution=4h&load=init&limit=1080/);
  assert.deepEqual(await readCandles("solana:pool:x", "7d", { env, fetchImpl: answer(200, { bars: "no" }) }), { ok: false, reason: "MALFORMED" });
});
