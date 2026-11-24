/* «Сітка» and «Сигнали» on paper: the week the bot runs at live prices before «Start with money» — the same
   rule the agent with money runs. The grid buys a level the price comes down to, sells it one step above at the route's
   quote less Ryntra's fee, and buys it again when the price comes back down; a «cross» signal buys while its fast average
   leads and sells everything once it falls under. The result counts what the sales would have brought. A scripted path
   stands in for the route; no network, no wallet, no key. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { agentFeeRaw } from "../fee-rates.ts";
import { costOf, gotOf, heldOf, paperAgentOf, paperNet, viewOf, weekEnd } from "./model.ts";
import { paperStep } from "./step.server.ts";
import { paperIdOf } from "./service.server.ts";

const SOL = 1_000_000_000n;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const COIN = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const ID = paperIdOf("g".repeat(43));
const SELL_BPS = 10;

/** The route on a scripted path: a whole coin (1 000 000 base units) fetches `path(now)` lamports, less a small spread. */
function readsOn(path) {
  const state = { now: T0 };
  const price = () => BigInt(Math.round(path(state.now)));
  return {
    state,
    reads: {
      buy: async (lamports) => (lamports * 1_000_000n * 9_980n) / (price() * 10_000n),
      worth: async (coins) => (coins * price() * 9_980n) / (1_000_000n * 10_000n),
      fees: async () => ({ buyBps: 10, sellBps: SELL_BPS }),
    },
  };
}

function agentOn(plan) {
  const budget = { perDay: SOL / 10n, perTrade: SOL / 50n, days: 30 };
  return {
    id: ID,
    kind: "paper",
    network: "mainnet",
    plan,
    coin: COIN,
    symbol: "MET",
    perDayRaw: budget.perDay.toString(),
    perTradeRaw: budget.perTrade.toString(),
    days: budget.days,
    startedAt: T0,
    endsAt: weekEnd(T0, budget.days),
    bornAt: null,
    unitRaw: "1000000",
    status: "working",
    trades: [],
    worthRaw: null,
    worthAt: null,
    exitBps: 10,
    updatedAt: T0,
  };
}

async function run(agent, harness, from, to, every = 5 * MINUTE) {
  const lines = [];
  for (let at = from; at <= to; at += every) {
    harness.state.now = at;
    const step = await paperStep(agent, harness.reads, at);
    agent = step.agent;
    lines.push({ at, did: step.did });
  }
  return { agent, lines };
}

const P0 = 2_000_000;

test("the grid on paper: buys a level on the way down, sells it one step up, buys it again — the result counts the sales", async () => {
  /* At P0, down 6 % at 6 h, 1 % over P0 at 12 h, up 6 % at 18 h, down 6 % again at 24 h. */
  const path = (now) => (now < T0 + 6 * HOUR ? P0 : now < T0 + 12 * HOUR ? P0 * 0.94 : now < T0 + 18 * HOUR ? P0 * 1.01 : now < T0 + 24 * HOUR ? P0 * 1.06 : P0 * 0.94);
  const harness = readsOn(path);
  const { agent, lines } = await run(agentOn("grid:500:5,sell:1"), harness, T0, T0 + 26 * HOUR);
  /* Level 1 goes at 12 h — one step over its buy — and level 0 at 18 h; at exactly its line the spread keeps it. */
  assert.deepEqual(lines.filter((line) => line.did === "sold").map((line) => Math.floor((line.at - T0) / HOUR)), [12, 18]);
  const buys = agent.trades.filter((trade) => trade.status === "ok");
  assert.deepEqual(buys.map((trade) => trade.level), [0, 1, 1], "level 0 at once, level 1 on the way down, level 1 again once it was sold");
  assert.deepEqual(agent.sales.map((sale) => [sale.why, sale.level]), [["grid", 1], ["grid", 0]]);
  for (const sale of agent.sales) {
    assert.equal(sale.paper, true);
    assert.equal(sale.signature, null, "nothing is sold: a paper sale has no signature");
    assert.ok(BigInt(sale.gotRaw) > BigInt(sale.costRaw), "a level sold one step up brings back more than it cost");
    const quote = BigInt(sale.gotRaw) + BigInt(sale.feeRaw);
    assert.equal(sale.feeRaw, agentFeeRaw(quote, SELL_BPS).toString(), "Ryntra's fee at the pair's rate, from what she receives");
  }
  assert.ok(lines.some((line) => line.did === "sold"));
  /* What it holds now: the second buy of level 1 only. */
  assert.equal(heldOf(agent).toString(), buys[2].receivedRaw);
  assert.equal(costOf(agent).toString(), buys[2].spentRaw);
  const net = paperNet(agent);
  assert.ok(net.netRaw !== null);
  const view = viewOf(agent, T0 + 26 * HOUR);
  assert.equal(view.sells, 2);
  assert.equal(view.gotRaw, gotOf(agent).toString());
});

test("a grid that only buys keeps its levels on paper, as before: no sale, no level bought twice", async () => {
  const path = (now) => (now < T0 + 6 * HOUR ? P0 : now < T0 + 12 * HOUR ? P0 * 0.94 : now < T0 + 18 * HOUR ? P0 : now < T0 + 24 * HOUR ? P0 * 1.06 : P0 * 0.94);
  const { agent, lines } = await run(agentOn("grid:500:5"), readsOn(path), T0, T0 + 30 * HOUR);
  assert.equal(agent.sales, undefined);
  assert.ok(!lines.some((line) => line.did === "sold"));
  assert.deepEqual(agent.trades.filter((trade) => trade.status === "ok").map((trade) => trade.level), [0, 1]);
  assert.equal(viewOf(agent, T0 + 30 * HOUR).sells, undefined, "the view of a paper week of before is unchanged");
});

test("a «cross» signal on paper buys while the fast average leads and sells everything once it falls under", async () => {
  /* Rising for three hours, then falling. */
  const path = (now) => (now < T0 + 3 * HOUR ? P0 * (1 + (now - T0) / (30 * HOUR)) : P0 * 1.1 * (1 - (now - T0 - 3 * HOUR) / (20 * HOUR)));
  const harness = readsOn(path);
  const { agent } = await run(agentOn("signal:cross:2:3"), harness, T0, T0 + 6 * HOUR);
  const buys = agent.trades.filter((trade) => trade.status === "ok");
  assert.ok(buys.length >= 1, "it bought while the fast average led");
  assert.ok(buys.every((buy) => buy.at < T0 + 3 * HOUR + 30 * MINUTE), "no buy once the price turned");
  assert.equal(agent.sales.length, 1);
  assert.equal(agent.sales[0].why, "signal");
  assert.equal(heldOf(agent), 0n, "everything sold");
  assert.equal(agent.worthRaw, "0");
});

test("a paper week with sales reads back exactly; a sale that does not read makes no agent", async () => {
  const harness = readsOn((now) => (now < T0 + 6 * HOUR ? P0 : now < T0 + 12 * HOUR ? P0 * 0.94 : P0 * 1.01));
  const { agent } = await run(agentOn("grid:500:5,sell:1"), harness, T0, T0 + 13 * HOUR);
  assert.equal(agent.sales.length, 1);
  assert.deepEqual(paperAgentOf(JSON.parse(JSON.stringify(agent))), agent);
  assert.equal(paperAgentOf({ ...agent, sales: [{ ...agent.sales[0], signature: "x" }] }), null);
  assert.equal(paperAgentOf({ ...agent, sales: [{ ...agent.sales[0], why: "stop" }] }), null);
  assert.equal(paperAgentOf({ ...agent, sales: "none" }), null);
});
