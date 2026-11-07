// Run from repo root: node --test lib/ring/duel/market.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const { MoveRejected, recordLog, verifyLog } = await import("../judge/index.ts");
const { T0, marketConfig } = await import("./testing/kit.mjs");

const ID = "market-test-1";
const m = (side, size = side === "hold" ? 0 : 1, thought = "") => ({ side, size, thought });
const round = (n, a, b, faults = [null, null]) => ({ round: n, moves: [a, b], faults });
const play = (cfg, pairs) => recordLog(d.market, ID, cfg, pairs.map(([a, b], i) => ({ at: T0 + i, input: round(i + 1, a, b) })));

describe("Market Replay", () => {
  test("an order fills at the next bar's open, never on a bar the agent has not seen", () => {
    const cfg = marketConfig({ steps: 2, lookback: 3 });
    let state = d.market.start(cfg, ID);
    const view = d.marketSeatView(state, 0);
    assert.equal(view.bars.length, 3);
    state = d.market.step(state, round(1, m("buy"), m("hold")));
    const price = cfg.bars[3][0];
    assert.equal(state.steps[0].price, price);
    assert.equal(state.units[0], d.fix((1000 * (1 - 0.001)) / price));
    assert.equal(state.cash[0], 0);
    assert.equal(d.marketSeatView(state, 0).bars.length, 4);
  });

  test("more equity at the last close wins; the replay derives the same numbers", () => {
    const cfg = marketConfig({ steps: 3, lookback: 4 });
    const log = play(cfg, [
      [m("buy"), m("hold")],
      [m("hold"), m("hold")],
      [m("hold"), m("hold")],
    ]);
    const last = cfg.bars.at(-1)[3];
    const units = d.fix((1000 * 0.999) / cfg.bars[4][0]);
    assert.equal(log.result.reason, "equity");
    assert.deepEqual(log.result.equity, [d.fix(units * last), 1000]);
    assert.equal(log.result.winner, units * last > 1000 ? 0 : 1);
    assert.equal(verifyLog(d.market, log).ok, true);
  });

  test("the same orders are a draw; a fault loses", () => {
    const cfg = marketConfig({ steps: 2, lookback: 2 });
    assert.deepEqual(play(cfg, [[m("buy", 0.5), m("buy", 0.5)], [m("sell", 0.25), m("sell", 0.25)]]).result.winner, null);
    const faulted = recordLog(d.market, ID, cfg, [{ at: T0, input: round(1, m("buy"), null, [null, "timeout"]) }]);
    assert.deepEqual([faulted.result.winner, faulted.result.reason], [0, "fault"]);
  });

  test("selling part of a position pays the fee on what was sold", () => {
    const cfg = marketConfig({ steps: 2, lookback: 2 });
    let state = d.market.start(cfg, ID);
    state = d.market.step(state, round(1, m("buy"), m("hold")));
    const units = state.units[0];
    state = d.market.step(state, round(2, m("sell", 0.5), m("hold")));
    const sold = d.fix(units * 0.5);
    assert.equal(state.units[0], d.fix(units - sold));
    assert.equal(state.cash[0], d.fix(sold * cfg.bars[3][0] * 0.999));
  });

  test("the engine refuses bad configs and bad orders", () => {
    const cfg = marketConfig({ steps: 2, lookback: 2 });
    assert.throws(() => d.market.start({ ...cfg, bars: cfg.bars.slice(1) }, ID), MoveRejected);
    assert.throws(() => d.market.start({ ...cfg, bars: [[1, 0.5, 0.4, 1], ...cfg.bars.slice(1)] }, ID), MoveRejected);
    assert.throws(() => d.market.start({ ...cfg, feeBps: 1_000 }, ID), MoveRejected);
    const state = d.market.start(cfg, ID);
    assert.throws(() => d.market.step(state, round(1, m("buy", 1.5), m("hold"))), MoveRejected);
    assert.throws(() => d.market.step(state, round(1, m("hold", 0.5), m("hold"))), MoveRejected);
    assert.throws(() => d.market.step(state, round(1, m("short"), m("hold"))), MoveRejected);
  });

  test("a seat's view never holds a bar ahead or the other's orders", () => {
    const cfg = marketConfig({ steps: 3, lookback: 4 });
    let state = d.market.start(cfg, ID);
    state = d.market.step(state, round(1, m("buy", 0.3, "my plan"), m("sell", 0, "their plan")));
    const view = d.marketSeatView(state, 1);
    assert.equal(view.bars.length, 5);
    assert.deepEqual(view.history, [{ step: 1, mine: { side: "sell", size: 0 }, price: cfg.bars[4][0] }]);
    assert.ok(!JSON.stringify(view).includes("plan"));
  });
});

describe("the hidden stretch", () => {
  const HOUR = 3_600_000;
  const candles = Array.from({ length: 60 }, (_, i) => ({ t: T0 + i * HOUR, o: 150 + i, h: 152 + i, l: 149 + i, c: 151 + i }));

  test("rebased to open at 100, times kept aside", () => {
    const seg = d.pickSegment(candles, 32, "solana:pool:x", () => 10);
    assert.equal(seg.bars.length, 32);
    assert.equal(seg.bars[0][0], 100);
    assert.deepEqual(seg.source, { instrument: "solana:pool:x", from: candles[10].t, to: candles[41].t, base: 160 });
    assert.ok(!JSON.stringify(seg.bars).includes(String(T0)));
  });

  test("no stretch from too few bars or across a gap", () => {
    assert.equal(d.pickSegment(candles.slice(0, 10), 32, "x", () => 0), null);
    const gap = candles.filter((_, i) => i !== 20);
    assert.equal(d.pickSegment(gap, 32, "x", () => 0), null);
    assert.throws(() => d.pickSegment(candles, 32, "x", () => 99), RangeError);
  });
});
