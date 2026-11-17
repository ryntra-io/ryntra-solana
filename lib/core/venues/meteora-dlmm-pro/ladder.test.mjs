// «buy cheaper», «sell higher» as a ladder of a DLMM Pro limit order — held to the SDK's own choice of ticks.
import assert from "node:assert/strict";
import test from "node:test";

import { LIMIT_ORDER_MAX_TICK, limitOrderTicksFromShape, relativeTickFromSlippage } from "@meteora-ag/dlmm-pro-sdk";
import BN from "bn.js";

const { DEFAULT_CORRIDOR_BPS, LadderRefusal, MAX_BUY_REACH_BPS, MAX_LADDER_SPAN, MAX_SELL_REACH_BPS, ladderPlanOf, ladderReachOf, makerShareOf, multipleOfTicks, ticksOfMultiple } = await import("./ladder.ts");
const { FEE_SHARES } = await import("./fee.ts");
const { MAX_SHAPE_COLUMNS, shapeOf } = await import("./shapes.server.ts");
const { MAX_TICK_ID, MIN_TICK_ID, alignTickDown } = await import("./ticks.ts");

/* The rehearsal's launch pool: spacing 100, a price of 0.000005 — tick −122 061 — and a pool of spacing 1 at price 1. */
const LAUNCH = { tickSpacing: 100, tickId: -122_061 };
const TIGHT = { tickSpacing: 1, tickId: 37 };
const refuses = (work, code) => assert.throws(work, (error) => error instanceof LadderRefusal && error.code === code);

/** What the SDK makes of a plan: the ticks and amounts `orders.place` would hand the program. */
function placed(plan, pool, total = 1_000_000n) {
  const shape = shapeOf(plan.shape, { tickSpacing: pool.tickSpacing, tickCurrentId: pool.tickId });
  return limitOrderTicksFromShape({ shape, side: plan.side, totalAmount: new BN(total.toString()), relative: plan.slippageTicks !== null });
}

test("the limits are the program's and the shape's", () => {
  assert.equal(MAX_LADDER_SPAN, MAX_SHAPE_COLUMNS);
  assert.ok(MAX_BUY_REACH_BPS < 10_000 && MAX_SELL_REACH_BPS > 10_000);
  assert.ok(Math.abs(multipleOfTicks(ticksOfMultiple(2)) - 2) < 1e-9);
  assert.ok(Math.abs(ticksOfMultiple(1.0001) - 1) < 1e-9);
});

test("buying token X cheaper is a bid below the price; selling it higher an ask above it", () => {
  const buy = ladderPlanOf({ action: "buy", coin: "x", farBps: 2_000 }, LAUNCH);
  assert.equal(buy.side, "bid");
  assert.equal(buy.restsIn, "y");
  assert.equal(buy.paysIn, "x");
  assert.ok(buy.rungs.every((rung) => rung.tickId < alignTickDown(LAUNCH.tickId, 100) && rung.tickId % 100 === 0));
  const sell = ladderPlanOf({ action: "sell", coin: "x", farBps: 10_000 }, LAUNCH);
  assert.equal(sell.side, "ask");
  assert.equal(sell.restsIn, "x");
  assert.ok(sell.rungs.every((rung) => rung.tickId > LAUNCH.tickId && rung.tickId % 100 === 0));
});

test("where the coin is token Y the sides swap and the person's words do not", () => {
  const buy = ladderPlanOf({ action: "buy", coin: "y", farBps: 2_000 }, LAUNCH);
  assert.equal(buy.side, "ask");
  assert.equal(buy.restsIn, "x");
  assert.equal(buy.paysIn, "y");
  const sell = ladderPlanOf({ action: "sell", coin: "y", farBps: 10_000 }, LAUNCH);
  assert.equal(sell.side, "bid");
  assert.equal(sell.restsIn, "y");
  /* Twice the coin's price is half the pool's: the farthest rung stands about ln 2 ÷ ln 1.0001 ticks below. */
  const far = sell.rungs.at(-1);
  assert.ok(Math.abs(alignTickDown(LAUNCH.tickId, 100) - far.tickId - ticksOfMultiple(2)) <= 50, String(far.tickId));
  assert.ok(Math.abs(far.awayBps - 10_000) < 100, String(far.awayBps));
});

test("the rungs are spread evenly in percent, nearest first, each on its own tick, never more than 25", () => {
  const plan = ladderPlanOf({ action: "buy", coin: "x", farBps: 5_000 }, LAUNCH);
  assert.equal(plan.rungs.length, LIMIT_ORDER_MAX_TICK);
  assert.equal(new Set(plan.rungs.map((rung) => rung.tickId)).size, plan.rungs.length);
  const gaps = plan.rungs.slice(1).map((rung, index) => plan.rungs[index].tickId - rung.tickId);
  assert.ok(gaps.every((gap) => gap > 0), "nearest first");
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 100, `gaps differ by more than a spacing: ${gaps}`);
  assert.ok(plan.rungs.every((rung, index) => index === 0 || rung.awayBps > plan.rungs[index - 1].awayBps));
  assert.equal(plan.nearBps, plan.rungs[0].awayBps);
  assert.equal(plan.farBps, plan.rungs.at(-1).awayBps);
  assert.ok(Math.abs(plan.farBps - 5_000) < 60, String(plan.farBps));
  /* Fewer ticks than rungs asked for: every tick once, none twice. */
  const narrow = ladderPlanOf({ action: "sell", coin: "x", farBps: 500, rungs: 25 }, LAUNCH);
  assert.ok(narrow.rungs.length >= 4 && narrow.rungs.length <= 6, String(narrow.rungs.length));
  assert.equal(new Set(narrow.rungs.map((rung) => rung.tickId)).size, narrow.rungs.length);
});

test("one rung stands at the farthest price: «sell at 2x»", () => {
  const plan = ladderPlanOf({ action: "sell", coin: "x", farBps: 10_000, rungs: 1 }, LAUNCH);
  assert.equal(plan.rungs.length, 1);
  assert.ok(Math.abs(plan.rungs[0].tickId - alignTickDown(LAUNCH.tickId, 100) - ticksOfMultiple(2)) <= 50);
  assert.equal(plan.shape.minTickId, plan.shape.maxTickId);
});

test("the nearest price is the caller's when it names one", () => {
  const plan = ladderPlanOf({ action: "sell", coin: "x", nearBps: 5_000, farBps: 20_000, rungs: 4 }, LAUNCH);
  assert.equal(plan.rungs.length, 4);
  assert.ok(Math.abs(plan.nearBps - 5_000) < 80, String(plan.nearBps));
  assert.ok(Math.abs(plan.farBps - 20_000) < 200, String(plan.farBps));
});

test("more the farther from the price: whole weights that rise", () => {
  const plan = ladderPlanOf({ action: "sell", coin: "x", farBps: 10_000, rungs: 5, spread: "further" }, LAUNCH);
  assert.deepEqual(plan.rungs.map((rung) => rung.weight), [1, 2, 3, 4, 5]);
  const even = ladderPlanOf({ action: "sell", coin: "x", farBps: 10_000, rungs: 5 }, LAUNCH);
  assert.deepEqual(even.rungs.map((rung) => rung.weight), [1, 1, 1, 1, 1]);
});

test("the SDK places exactly the plan's ticks, with the plan's proportions", () => {
  for (const [intent, pool] of [
    [{ action: "buy", coin: "x", farBps: 3_000 }, LAUNCH],
    [{ action: "sell", coin: "x", farBps: 40_000, spread: "further" }, LAUNCH],
    [{ action: "buy", coin: "y", farBps: 1_000, rungs: 7 }, LAUNCH],
    [{ action: "sell", coin: "y", farBps: 300 }, TIGHT],
    [{ action: "buy", coin: "x", farBps: 6_000, rungs: 25, corridorBps: null }, TIGHT],
  ]) {
    const plan = ladderPlanOf(intent, pool);
    const total = 25_000_000n;
    const picked = placed(plan, pool, total);
    const aligned = alignTickDown(pool.tickId, pool.tickSpacing);
    const ticks = picked.ticks.map((tick) => (plan.slippageTicks === null ? tick.id : aligned + tick.id * pool.tickSpacing));
    assert.deepEqual([...ticks].sort((a, b) => a - b), plan.rungs.map((rung) => rung.tickId).sort((a, b) => a - b), JSON.stringify(intent));
    const weight = plan.rungs.reduce((sum, rung) => sum + rung.weight, 0);
    const unit = total / BigInt(weight);
    for (const rung of plan.rungs) {
      const at = ticks.indexOf(rung.tickId);
      assert.equal(picked.ticks[at].amount.toString(), (unit * BigInt(rung.weight)).toString());
    }
    /* What stays unspent of a budget is less than the sum of the weights, in atoms. */
    assert.ok(total - BigInt(picked.amount.toString()) < BigInt(weight));
  }
});

test("the corridor is a multiple of the spacing the SDK takes, 1 % unless named, none for fixed ticks", () => {
  const plan = ladderPlanOf({ action: "buy", coin: "x", farBps: 2_000 }, LAUNCH);
  assert.equal(plan.corridorBps, DEFAULT_CORRIDOR_BPS);
  assert.equal(plan.slippageTicks, 100);
  const band = relativeTickFromSlippage({ currentTickId: LAUNCH.tickId, tickSpacing: 100, slippageTicks: plan.slippageTicks });
  assert.equal(band.spacingAlignedMaxTickId - band.spacingAlignedMinTickId, 200);
  assert.equal(ladderPlanOf({ action: "buy", coin: "x", farBps: 2_000, corridorBps: 500 }, TIGHT).slippageTicks, 488);
  assert.equal(ladderPlanOf({ action: "buy", coin: "x", farBps: 2_000, corridorBps: 0 }, TIGHT).slippageTicks, 0);
  const fixed = ladderPlanOf({ action: "buy", coin: "x", farBps: 2_000, corridorBps: null }, LAUNCH);
  assert.equal(fixed.slippageTicks, null);
  assert.equal(fixed.corridorBps, null);
});

test("what cannot be placed as asked is refused, never bent", () => {
  refuses(() => ladderPlanOf({ action: "hold", coin: "x", farBps: 100 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "buy", coin: "z", farBps: 100 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "buy", coin: "x", farBps: 0 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "buy", coin: "x", farBps: 10_000 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "buy", coin: "x", farBps: 12.5 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: MAX_SELL_REACH_BPS + 1 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", nearBps: 600, farBps: 500 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 500, rungs: 26 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 500, rungs: 0 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 500, spread: "curve" }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 500, corridorBps: 5_000 }, LAUNCH), "BAD_INPUT");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 500 }, { tickSpacing: 0, tickId: 0 }), "BAD_INPUT");
  /* Past the program's last tick, and wider than a shape is worked out over. */
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 20_000 }, { tickSpacing: 100, tickId: MAX_TICK_ID - 500 }), "TOO_FAR");
  refuses(() => ladderPlanOf({ action: "buy", coin: "x", farBps: 9_000 }, { tickSpacing: 100, tickId: MIN_TICK_ID + 500 }), "TOO_FAR");
  refuses(() => ladderPlanOf({ action: "sell", coin: "x", farBps: 400_000 }, TIGHT), "TOO_WIDE");
});

test("a slider's end is what the pool can take", () => {
  assert.equal(ladderReachOf("buy", "x", LAUNCH), MAX_BUY_REACH_BPS);
  assert.equal(ladderReachOf("sell", "x", LAUNCH), MAX_SELL_REACH_BPS);
  /* Spacing 1: ten thousand ticks either way — about ×2,7 up and −63 % down. */
  const up = ladderReachOf("sell", "x", TIGHT);
  const down = ladderReachOf("buy", "x", TIGHT);
  assert.ok(up > 17_000 && up < 17_300, String(up));
  assert.ok(down > 6_300 && down < 6_340, String(down));
  /* And a ladder to that end is placed, not refused. */
  for (const [action, reach] of [["sell", up], ["buy", down]]) {
    const plan = ladderPlanOf({ action, coin: "x", farBps: reach }, TIGHT);
    assert.equal(plan.rungs.length, 25);
    assert.equal(placed(plan, TIGHT).ticks.length, 25);
  }
  /* Near the program's last tick there is nowhere left to go. */
  assert.equal(ladderReachOf("sell", "x", { tickSpacing: 100, tickId: MAX_TICK_ID - 50 }), 0);
  assert.ok(ladderReachOf("buy", "y", { tickSpacing: 100, tickId: MAX_TICK_ID - 5_000 }) < 4_000);
});

test("a maker keeps half the pool's fee on what it filled; Ryntra's referral takes a fifth of that half", () => {
  assert.deepEqual(makerShareOf(100, false), { makerBps: 50, ownerBps: 50, referralBps: 0 });
  assert.deepEqual(makerShareOf(100, true), { makerBps: 50, ownerBps: 40, referralBps: 10 });
  assert.deepEqual(makerShareOf(106.14, true), { makerBps: 53.07, ownerBps: 42.46, referralBps: 10.61 });
  assert.equal(FEE_SHARES.protocolOfOrdersBps, 5_000);
  assert.equal(FEE_SHARES.referralOfOrderFeeBps, 2_000);
});
