import assert from "node:assert/strict";
import test from "node:test";

import { networkOf, viewOf } from "./agent-service.server.ts";
import { exitRate, netOf } from "./net.ts";
import { AGENT_FEE_CEILING_BPS } from "./fee-rates.ts";
import { CALM_PACE, calmPlan, planFrom, planText, boundedPlan } from "./plans.ts";
import { decide, steadyRhythm } from "./strategy.ts";
import { runPlan } from "./backtest.ts";
import { BUDGET_PRESETS } from "./presets.ts";

/* CITY-197: the agent's result after every fee, plain holding beside it, and the calm pace of the default strategies. */

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 17, 30);
const trade = (at, spent, received, extra = {}) => ({ at, status: "ok", signature: `s${at}`, spentRaw: String(spent), receivedRaw: received === null ? null : String(received), reason: null, ...extra });

/* Two buys of 0.01 SOL: the first brought 1,000 coins, the second 800 (the price rose). 1,800 coins worth 0.0216 SOL now. */
const TRADES = [trade(T0 - 6 * H, 10_000_000, 1_000), trade(T0 - 2 * H, 10_000_000, 800)];

test("after every fee: the exit's fee and the network SOL she put in are taken off what the coins are worth", () => {
  const net = netOf({ trades: TRADES, heldRaw: "1800", worthRaw: "21600000", exitBps: 100, networkRaw: "10000000" });
  assert.equal(net.trades, 2);
  assert.equal(net.spentRaw, "20000000");
  // 21.6m − 1 % exit (216 000) − 20m spent − 10m network = −8 616 000: the network top-up is a real cost.
  assert.equal(net.netRaw, "-8616000");
  assert.equal(net.feesRaw, "10216000");
  // Holding: 20m at the first buy's price (1,000 per 10m) = 2,000 coins × 12 000 a coin, less the exit fee, less 20m.
  assert.equal(net.holdRaw, String(24_000_000 - 240_000 - 20_000_000));
  // Without the network SOL the agent's own result still carries the exit fee.
  assert.equal(netOf({ trades: TRADES, heldRaw: "1800", worthRaw: "21600000", exitBps: 100 }).netRaw, "1384000");
});

test("a span carries its share of the network: the days add up to the whole", () => {
  const all = { trades: TRADES, heldRaw: "1800", worthRaw: "21600000", exitBps: 0, networkRaw: "10000000" };
  const first = netOf({ ...all, span: { since: T0 - 7 * H, until: T0 - 5 * H } });
  const second = netOf({ ...all, span: { since: T0 - 3 * H, until: T0 } });
  assert.equal(first.trades, 1);
  assert.equal(BigInt(first.netRaw) + BigInt(second.netRaw), BigInt(netOf(all).netRaw));
  // A span with nothing done did nothing — a measured zero.
  assert.deepEqual(netOf({ ...all, span: { since: 0, until: 1 } }), { trades: 0, spentRaw: "0", netRaw: "0", holdRaw: "0", feesRaw: "0" });
});

test("not read is never zero: unread worth, coins or a trade in flight leave the result null", () => {
  assert.equal(netOf({ trades: TRADES, heldRaw: "1800", worthRaw: null }).netRaw, null);
  assert.equal(netOf({ trades: TRADES, heldRaw: null, worthRaw: "1" }).holdRaw, null);
  assert.equal(netOf({ trades: [...TRADES, trade(T0 - H, 10_000_000, null)], heldRaw: "1800", worthRaw: "21600000" }).netRaw, null);
  assert.equal(netOf({ trades: [...TRADES, { ...trade(T0 - H, 0, null), status: "failed", unsettledRaw: "10000000" }], heldRaw: "1800", worthRaw: "21600000" }).netRaw, null);
});

test("the exit is counted at the pair's rate, or at the highest the agent may carry when it was not read", () => {
  assert.equal(exitRate(50), 50);
  assert.equal(exitRate(null), AGENT_FEE_CEILING_BPS);
  assert.equal(exitRate(99_999), AGENT_FEE_CEILING_BPS);
  assert.ok(BigInt(netOf({ trades: TRADES, heldRaw: "1800", worthRaw: "21600000" }).netRaw) <= BigInt(netOf({ trades: TRADES, heldRaw: "1800", worthRaw: "21600000", exitBps: 10 }).netRaw));
});

test("her sales count in the whole: the SOL they brought, after their own fee", () => {
  const net = netOf({ trades: TRADES, heldRaw: "900", worthRaw: "10800000", gotRaw: "10000000", exitBps: 0 });
  assert.equal(net.netRaw, "800000");
});

test("the agent's view carries the honest result, its day and the network of its budget", () => {
  const entry = {
    v: 1,
    cluster: "devnet",
    record: { owner: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", settings: "s", vault: "v", policy: "p", budget: "b", perTrade: "20000000", perDay: "100000000", expiresAt: "0" },
    preset: "small",
    strategy: "steady",
    said: null,
    receiveMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    status: "working",
    trades: TRADES,
    createdAt: T0 - 7 * H,
    updatedAt: T0,
  };
  assert.equal(networkOf(entry), BUDGET_PRESETS.small.agentFee.toString());
  const view = viewOf(entry, 21_600_000n, null, null, { now: T0 }, { exitBps: 100 });
  assert.equal(view.net.netRaw, "-8616000");
  assert.equal(view.day.netRaw, view.net.netRaw, "both trades were today");
  assert.equal(view.day.holdRaw, view.net.holdRaw);
  // The old figure is kept beside it, unchanged.
  assert.equal(view.result.earnedRaw, "1600000");
});

test("the calm pace: one regular buy a day by default, at most two for a strategy that waits; the caps never change", () => {
  assert.deepEqual(CALM_PACE, { steady: 1, dip: 2, grid: 2, early: 2 });
  assert.equal(calmPlan({ id: "steady", exit: null }).pace, 1);
  assert.equal(calmPlan({ id: "dip", dropBps: 800, exit: null }).pace, 2);
  assert.equal(calmPlan({ id: "steady", exit: null, pace: 3 }).pace, 3, "a pace said stays");
  // The plan's text carries it, and reads back; an old text has none.
  assert.equal(planText(calmPlan({ id: "dip", dropBps: 800, exit: { takeBps: 2000, stopBps: null } })), "dip:800,take:2000,pace:2");
  assert.deepEqual(planFrom("dip:800,take:2000,pace:2"), { id: "dip", dropBps: 800, exit: { takeBps: 2000, stopBps: null }, pace: 2 });
  assert.equal(planFrom("steady").pace, undefined);
  assert.equal(planFrom("steady,pace:0"), null);
  assert.equal(planFrom("steady,pace:25"), null);
  assert.equal(planFrom("steady,pace:1,pace:2"), null);
  assert.equal(planFrom("steady,pace:1,take:2000"), null, "the pace comes last");
  assert.equal(boundedPlan({ id: "steady", pace: 99 }).pace, 24);
  // A ceiling under the caps' rhythm, never over it.
  const perTrade = BUDGET_PRESETS.small.perTrade;
  const perDay = BUDGET_PRESETS.small.perDay;
  assert.equal(steadyRhythm(perTrade, perDay).buys, 5);
  assert.equal(steadyRhythm(perTrade, perDay, 1).buys, 1);
  assert.equal(steadyRhythm(perTrade, perDay, 1).everyMs, 86_400_000);
  assert.equal(steadyRhythm(perTrade, perDay, 24).buys, 5, "no pace buys more often than the caps allow");
});

test("the agent keeps the pace: after its one buy of the day it waits a day", () => {
  const base = { strategy: "steady", perTrade: 20_000_000n, perDay: 100_000_000n, expiresAt: BigInt(Math.floor(T0 / 1000) + 86_400 * 30), budgetLeft: 100_000_000n, now: T0 };
  const one = [trade(T0 - 6 * H, 20_000_000, 1_000)];
  assert.equal(decide({ ...base, trades: one }).action, "buy", "without a pace — five a day, every 4.8 h");
  const paced = decide({ ...base, trades: one, pace: 1 });
  assert.equal(paced.action, "wait");
  assert.equal(paced.until, T0 - 6 * H + 86_400_000);
});

test("the run on history keeps the same pace: fewer buys, the same caps", () => {
  const bars = Array.from({ length: 72 }, (_, k) => ({ t: T0 + k * H, o: 1, h: 1, l: 1, c: 1 }));
  const budget = { perTrade: 0.02, perDay: 0.1, days: 30 };
  const fast = runPlan({ id: "steady", exit: null }, bars, budget);
  const calm = runPlan(calmPlan({ id: "steady", exit: null }), bars, budget);
  assert.ok(calm.buys < fast.buys);
  assert.equal(calm.buys, 3, "one a day over three days");
});
