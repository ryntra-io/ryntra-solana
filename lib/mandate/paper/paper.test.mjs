/* The agent's week on paper: the mandate's own rules on live prices, the honest result beside plain holding,
   «Start with money» on the same plan, and paper kept apart from money. Nothing here reaches a network, a wallet or a
   key: the prices are a scripted path and Jupiter's recorded answer (`lib/solana/fixtures/jupiter-order-v2-sol-usdc.json`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { budgetFund } from "../budget.ts";
import { agentFeeRaw } from "../fee-rates.ts";
import { netOf } from "../net.ts";
import { planText, PLAN_BOUNDS } from "../plans.ts";
import { AUTOSTOP, steadyRhythm } from "../strategy.ts";
import { MARK_EVERY_MS } from "../tick.server.ts";
import { budgetOf, canGoLive, dayOfWeek, heldOf, paperAgentOf, paperNet, PAPER_DAYS, PAPER_NETWORK_LAMPORTS, routedOf, spentOf, viewOf, weekEnd } from "./model.ts";
import { paperStep } from "./step.server.ts";
import { createMemoryPaperStore, PaperStoreUnavailable } from "./store.ts";
import { createSupabasePaperStore } from "./supabase-store.ts";
import { closePaper, paperIdOf, readPaper, runPaperPass, startPaper } from "./service.server.ts";
import { jupiterPaperReads } from "./reads.server.ts";
import { createPaperQuota, createPaperQuoteCache, paperFetch, PaperQuotaSpent, PAPER_QUOTA, PAPER_START_COST, PAPER_STEP_COST } from "./quota.ts";
import { PAPER_STARTS } from "./store.ts";
import { whoOf } from "./service.server.ts";

const SOL = 1_000_000_000n;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);
const COIN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const KEY = "k".repeat(43);
const ID = paperIdOf(KEY);

/**
 * Scripted live reads: a price path in lamports per whole coin (6 decimals), the route's quote both ways at that price
 * less a spread, and the table's rate for the pair. `fail` makes every read throw from that moment.
 */
function readsOn(path, options = {}) {
  const spreadBps = options.spreadBps ?? 20n;
  const state = { now: T0, buys: [], worths: 0, fail: false };
  const price = () => BigInt(Math.round(path(state.now)));
  const reads = {
    async buy(lamports) {
      if (state.fail) throw new Error("not read");
      state.buys.push(lamports);
      return (lamports * 1_000_000n * (10_000n - spreadBps)) / (price() * 10_000n);
    },
    async worth(coins) {
      if (state.fail) throw new Error("not read");
      state.worths += 1;
      return (coins * price() * (10_000n - spreadBps)) / (1_000_000n * 10_000n);
    },
    async fees() {
      if (state.fail) throw new Error("not read");
      return options.fees ?? { buyBps: 10, sellBps: 10 };
    },
  };
  return { reads, state };
}

function agentOn(overrides = {}) {
  const budget = { perDay: SOL / 10n, perTrade: SOL / 50n, days: 30, ...overrides.budget };
  return {
    id: ID,
    kind: "paper",
    network: "mainnet",
    plan: overrides.plan ?? "steady",
    coin: COIN,
    symbol: "JUP",
    perDayRaw: budget.perDay.toString(),
    perTradeRaw: budget.perTrade.toString(),
    days: budget.days,
    startedAt: T0,
    endsAt: weekEnd(T0, budget.days),
    bornAt: overrides.bornAt ?? null,
    unitRaw: "1000000",
    status: "working",
    trades: [],
    worthRaw: null,
    worthAt: null,
    exitBps: 10,
    updatedAt: T0,
  };
}

/** The paper agent's passes every `every` ms from `from` to `to`, as the cron runs them. */
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

/* ---------------------------------------------------------------- the rules are the mandate's */

test("steady on paper: the mandate's rhythm and day's cap, the fee taken from each buy, the coins the route quotes", async () => {
  const harness = readsOn(() => 2_000_000);
  const { agent, lines } = await run(agentOn(), harness, T0, T0 + 2 * DAY - MINUTE);
  const buys = agent.trades.filter((trade) => trade.status === "ok");
  /* 0.1 SOL a day in trades of 0.02: five buys a day, the first at once (`steadyRhythm`). */
  const { buys: aDay, everyMs } = steadyRhythm(SOL / 50n, SOL / 10n, null);
  assert.equal(aDay, 5);
  assert.equal(buys.length, 10);
  assert.equal(lines[0].did, "bought", "the first paper buy comes at once, as the agent's");
  for (let i = 1; i < buys.length; i += 1) assert.ok(buys[i].at - buys[i - 1].at >= everyMs, "never closer than the rhythm");
  for (const buy of buys) {
    assert.equal(buy.paper, true);
    assert.equal(buy.signature, null, "a paper trade has no signature");
    assert.equal(buy.spentRaw, (SOL / 50n).toString(), "every buy is the trade cap");
    assert.equal(buy.feeRaw, agentFeeRaw(SOL / 50n, 10).toString(), "Ryntra's fee at the pair's rate, from the amount");
  }
  /* The route was asked for the cap less the fee, as Jupiter's program takes it from the input. */
  assert.ok(harness.state.buys.every((asked) => asked === routedOf(SOL / 50n, 10)));
  assert.equal(spentOf(agent), (SOL / 50n) * 10n);
  assert.ok(agent.worthRaw !== null && agent.worthAt !== null, "every coin held is quoted back for the screen");
});

test("a dip on paper buys only under the day's high by its drop, its marks read as the agent reads them", async () => {
  /* Flat for six hours, then 10 % down. */
  const path = (now) => (now < T0 + 6 * HOUR ? 2_000_000 : 1_800_000);
  const harness = readsOn(path);
  const plan = planText({ id: "dip", dropBps: 800, exit: null });
  const { agent, lines } = await run(agentOn({ plan }), harness, T0, T0 + 8 * HOUR);
  const firstBuy = lines.find((line) => line.did === "bought");
  assert.ok(firstBuy && firstBuy.at >= T0 + 6 * HOUR, "no buy while the price held its high");
  assert.ok(agent.marks.length > 0 && agent.anchor !== undefined);
  for (let i = 1; i < agent.marks.length; i += 1) assert.ok(agent.marks[i].at - agent.marks[i - 1].at >= MARK_EVERY_MS, "a mark at most every ten minutes");
});

test("its own pause before a buy: what it bought losing 15 % pauses it — and it holds, it sells nothing", async () => {
  /* A slide of 30 % over the first day. */
  const path = (now) => 2_000_000 * (1 - Math.min(0.3, ((now - T0) / DAY) * 0.3));
  const harness = readsOn(path);
  const { agent } = await run(agentOn(), harness, T0, T0 + 2 * DAY);
  assert.equal(agent.status, "paused");
  assert.ok(agent.pausedBy === "loss" || agent.pausedBy === "losses");
  assert.ok(agent.trades.every((trade) => trade.status === "ok"), "no sale on paper while the agent with money holds");
  assert.equal(AUTOSTOP.maxLossBps, 1_500);
});

test("the person's stop on paper pauses it at the stop, as her plan says", async () => {
  const path = (now) => (now < T0 + 3 * HOUR ? 2_000_000 : 1_850_000);
  const harness = readsOn(path);
  const plan = planText({ id: "steady", exit: { takeBps: null, stopBps: PLAN_BOUNDS.stopBps.min } });
  const { agent } = await run(agentOn({ plan }), harness, T0, T0 + 6 * HOUR);
  assert.equal(agent.status, "paused");
  assert.equal(agent.pausedBy, "stop");
});

test("a stock's plan bought only in its exchange's hours waits on paper while the session is not on, as the agent's", async () => {
  const harness = readsOn(() => 2_000_000);
  let session = "closed";
  harness.reads.session = async () => session;
  const plan = planText({ id: "steady", exit: null, hours: true });
  let { agent } = await run(agentOn({ plan }), harness, T0, T0 + HOUR);
  assert.equal(agent.trades.length, 0, "no buy while the exchange is closed");
  session = "open";
  ({ agent } = await run(agent, harness, T0 + 2 * HOUR, T0 + 2 * HOUR));
  assert.equal(agent.trades.length, 1);
  /* No answer at all is a session not known: the buy waits. */
  delete harness.reads.session;
  ({ agent } = await run(agent, harness, T0 + 9 * HOUR, T0 + 10 * HOUR));
  assert.equal(agent.trades.length, 1);
});

test("a price not read is never guessed: the pass waits, and after six hours the paper agent pauses", async () => {
  const harness = readsOn(() => 2_000_000);
  let { agent } = await run(agentOn(), harness, T0, T0);
  assert.equal(agent.trades.length, 1);
  harness.state.fail = true;
  ({ agent } = await run(agent, harness, T0 + 5 * HOUR, T0 + 12 * HOUR, 30 * MINUTE));
  assert.equal(agent.status, "paused");
  assert.equal(agent.pausedBy, "unread");
  assert.equal(agent.trades.length, 1, "nothing bought blind");
  /* Read again: it works again from its next due buy. */
  harness.state.fail = false;
  ({ agent } = await run(agent, harness, T0 + 13 * HOUR, T0 + 14 * HOUR));
  assert.equal(agent.status, "working");
  assert.ok(agent.trades.length > 1);
});

test("a pair the table names no agent fee for is no agent trade: failed paper trades, then its own pause", async () => {
  const harness = readsOn(() => 2_000_000, { fees: { buyBps: null, sellBps: null } });
  const { agent } = await run(agentOn(), harness, T0, T0 + DAY);
  assert.equal(agent.status, "paused");
  assert.equal(agent.pausedBy, "failing");
  assert.ok(agent.trades.every((trade) => trade.status === "failed" && trade.spentRaw === "0"));
});

test("the week ends on its seventh day, or with the person's shorter term; a spent budget ends it too", async () => {
  const harness = readsOn(() => 2_000_000);
  let { agent } = await run(agentOn(), harness, T0 + 7 * DAY, T0 + 7 * DAY);
  assert.equal(agent.status, "done");
  assert.equal(agent.doneBy, "week");
  assert.equal(weekEnd(T0, 3), T0 + 3 * DAY);
  assert.equal(weekEnd(T0, 30), T0 + PAPER_DAYS * DAY);
  /* A one-day term: its vault is one day of trades, spent by the evening. */
  ({ agent } = await run(agentOn({ budget: { days: 1 } }), harness, T0, T0 + DAY, 10 * MINUTE));
  assert.equal(agent.status, "done");
  assert.equal(spentOf(agent), budgetFund(budgetOf(agent)));
});

/* ---------------------------------------------------------------- the honest result */

test("the result is the agent's own figure: after every fee, plain holding beside it", async () => {
  const path = (now) => 2_000_000 * (1 + ((now - T0) / DAY) * 0.05);
  const harness = readsOn(path);
  const { agent } = await run(agentOn(), harness, T0, T0 + 2 * DAY);
  const net = paperNet(agent);
  const again = netOf({ trades: agent.trades, heldRaw: heldOf(agent).toString(), worthRaw: agent.worthRaw, exitBps: agent.exitBps, networkRaw: (PAPER_NETWORK_LAMPORTS * BigInt(net.trades)).toString() });
  assert.deepEqual(net, again);
  assert.equal(PAPER_NETWORK_LAMPORTS, 105_000n, "the network's fee of a trade, as the run on history counts it");
  /* Fees taken off: the sale's fee and the network share, never left out. */
  assert.ok(BigInt(net.feesRaw) > 0n);
  const worth = BigInt(agent.worthRaw);
  const exitFee = (worth * 10n + 9_999n) / 10_000n;
  assert.equal(BigInt(net.netRaw), worth - exitFee - spentOf(agent) - PAPER_NETWORK_LAMPORTS * BigInt(net.trades));
  /* Rising prices: holding from the first buy beats buying along the way, and the figures say so. */
  assert.ok(BigInt(net.holdRaw) > BigInt(net.netRaw));
  /* A price not read is no zero. */
  assert.equal(paperNet({ ...agent, worthRaw: null }).netRaw, null);
  const view = viewOf(agent, T0 + 2 * DAY);
  assert.equal(view.paper, true);
  assert.equal(view.day, 3);
  assert.equal(dayOfWeek(agent, T0 + 30 * DAY), PAPER_DAYS);
  assert.equal(view.buyFeesRaw, (agentFeeRaw(SOL / 50n, 10) * BigInt(view.trades)).toString());
  assert.ok(!("id" in view), "the view never carries the store's id");
});

/* ---------------------------------------------------------------- the store keeps what it reads */

test("a stored paper agent reads back exactly, and anything that is not one reads as nothing", async () => {
  const harness = readsOn(() => 2_000_000);
  const { agent } = await run(agentOn({ plan: planText({ id: "grid", stepBps: 500, levels: 5, exit: null }) }), harness, T0, T0 + 3 * HOUR);
  const back = paperAgentOf(JSON.parse(JSON.stringify(agent)));
  assert.deepEqual(back, agent);
  assert.equal(paperAgentOf({ ...agent, kind: "mandate" }), null);
  assert.equal(paperAgentOf({ ...agent, trades: [{ ...agent.trades[0], paper: undefined }] }), null, "a trade not marked paper is not a paper trade");
  assert.equal(paperAgentOf({ ...agent, trades: [{ ...agent.trades[0], signature: "5".repeat(88) }] }), null, "a paper trade never carries a signature");
  assert.equal(paperAgentOf({ ...agent, perTradeRaw: "0" }), null);
  assert.equal(paperAgentOf({ ...agent, plan: "yolo" }), null);
  assert.equal(paperAgentOf({ ...agent, coin: "not a mint" }), null);
});

/* ---------------------------------------------------------------- start, read, end, live */

const WHO = "a".repeat(64);
const startInput = (overrides = {}) => ({ key: KEY, coin: COIN, symbol: "JUP", plan: "steady", perDay: (SOL / 10n).toString(), perTrade: (SOL / 50n).toString(), days: 30, who: WHO, ...overrides });

test("a start: the person's numbers, the first paper buy at once, one week at a time for a key", async () => {
  const store = createMemoryPaperStore();
  const harness = readsOn(() => 2_000_000);
  const deps = { store, reads: () => harness.reads, now: () => T0 };
  const started = await startPaper(startInput(), deps);
  assert.equal(started.ok, true);
  assert.equal(started.already, false);
  assert.equal(started.view.trades, 1, "the first paper buy at once");
  assert.equal(started.view.perDayRaw, (SOL / 10n).toString());
  assert.equal(started.view.days, 30, "the term she wrote — the one «Start with money» signs");
  assert.equal(started.view.endsAt, T0 + 7 * DAY);
  const again = await startPaper(startInput({ plan: "dip:800" }), deps);
  assert.equal(again.ok, true);
  assert.equal(again.already, true, "a second tap shows the week at work, never a second one");
  assert.equal(again.view.plan, "steady");
  assert.equal(store.rows.size, 1);
  const read = await readPaper(KEY, deps);
  assert.equal(read.view.trades, 1);
  assert.deepEqual(await readPaper("short", deps), { ok: false, code: "KEY" });
  assert.deepEqual(await readPaper("x".repeat(43), deps), { ok: true, view: null });
});

test("a start refuses what the agent would not take, and a coin it cannot price", async () => {
  const store = createMemoryPaperStore();
  const harness = readsOn(() => 2_000_000);
  const deps = { store, reads: () => harness.reads, now: () => T0 };
  for (const bad of [{ key: "short" }, { coin: "nope" }, { plan: "yolo" }, { perTrade: "0" }, { perTrade: (SOL).toString() }, { days: 0 }, { plan: "early:24" }, { who: undefined }, { who: "1.2.3.4" }]) {
    const answer = await startPaper(startInput(bad), deps);
    assert.equal(answer.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(await startPaper(startInput(), { ...deps, reads: () => readsOn(() => 1, { fees: { buyBps: null, sellBps: null } }).reads }), { ok: false, code: "PAIR" });
  const dark = readsOn(() => 2_000_000);
  dark.state.fail = true;
  assert.deepEqual(await startPaper(startInput(), { ...deps, reads: () => dark.reads }), { ok: false, code: "NO_PRICE" });
  assert.equal(store.rows.size, 0);
});

test("«Start with money» marks the paper live and stops it; it stays as it was, and the paper's trades go nowhere", async () => {
  const store = createMemoryPaperStore();
  const harness = readsOn(() => 2_000_000);
  let now = T0;
  const deps = { store, reads: () => harness.reads, now: () => now };
  await startPaper(startInput(), deps);
  now = T0 + 2 * HOUR;
  const live = await closePaper(KEY, "live", deps);
  assert.equal(live.view.status, "live");
  assert.equal(live.view.liveAt, now);
  assert.equal(live.view.trades, 1);
  assert.equal(canGoLive(store.rows.get(ID).agent), false);
  /* Asked again, or ended after: the same answer. */
  assert.equal((await closePaper(KEY, "ended", deps)).view.status, "live");
  /* A week taken live is no longer at work: the cron leaves it, a new week may start for the key. */
  assert.equal((await store.due("mainnet", 10)).length, 0);
  const next = await startPaper(startInput({ plan: "dip:800" }), deps);
  assert.equal(next.already, false);
  assert.equal(next.view.plan, "dip:800");
});

test("the cron's pass trades every paper agent at work once, and a pass that lost the race writes nothing", async () => {
  const store = createMemoryPaperStore();
  const harness = readsOn(() => 2_000_000);
  let now = T0;
  const deps = { store, reads: () => harness.reads, now: () => now };
  await startPaper(startInput(), deps);
  await startPaper(startInput({ key: "q".repeat(43) }), deps);
  now = T0 + 5 * HOUR;
  harness.state.now = now;
  const lines = await runPaperPass(deps);
  assert.deepEqual(lines.map((line) => line.did), ["bought", "bought"]);
  /* Two passes on the same versions: the second one's writes are refused. */
  const due = await store.due("mainnet", 10);
  const stale = due.map((row) => ({ ...row }));
  now += 5 * HOUR;
  harness.state.now = now;
  await runPaperPass(deps);
  const racing = { ...deps, store: { ...store, due: async () => stale } };
  const raced = await runPaperPass(racing);
  assert.ok(raced.every((line) => line.did === "raced"));
});

/* ---------------------------------------------------------------- the database's store, through its functions' answers */

test("the database's store reads each function's own answer; a missing function is a store not open", async () => {
  const agent = agentOn();
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push([fn, args]);
    if (fn === "agent_paper_get") return { ok: true, data: { ok: true, row: { doc: agent, version: 3 } } };
    if (fn === "agent_paper_start") return { ok: true, data: { ok: true, answer: "started" } };
    if (fn === "agent_paper_put") return { ok: true, data: { ok: true, written: args.p_version === 3, version: 4 } };
    if (fn === "agent_paper_due") return { ok: true, data: { ok: true, rows: [{ doc: agent, version: 3 }, { doc: { kind: "mandate" }, version: 1 }] } };
    return { ok: false, error: "rpc failed" };
  };
  const store = createSupabasePaperStore(rpc);
  assert.equal((await store.get(ID)).version, 3);
  assert.equal(await store.start(agent, 10), "started");
  assert.equal(await store.put(agent, 3), 4);
  assert.equal(await store.put(agent, 2), null);
  assert.equal((await store.due("mainnet", 10)).length, 1, "a row that does not read is left out");
  assert.equal(calls.find(([fn]) => fn === "agent_paper_put")[1].p_status, "working");
  const missing = createSupabasePaperStore(async () => ({ ok: false, error: "Could not find the function public.agent_paper_get" }));
  await assert.rejects(missing.get(ID), PaperStoreUnavailable);
  const tampered = createSupabasePaperStore(async () => ({ ok: true, data: { ok: true, row: { doc: { ...agent, id: "0".repeat(64) }, version: 1 } } }));
  await assert.rejects(tampered.get(ID), PaperStoreUnavailable, "another id's row is no answer");
});

/* ---------------------------------------------------------------- the live reads, on Jupiter's recorded answer */

test("the live reads ask Jupiter's quote both ways and the table's rate for the pair — nothing is built", async () => {
  const recorded = JSON.parse(readFileSync(new URL("../../solana/fixtures/jupiter-order-v2-sol-usdc.json", import.meta.url), "utf8"));
  const USDC = recorded.outputMint;
  const asked = [];
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams;
    asked.push({ path: new URL(url).pathname, input: query.get("inputMint"), output: query.get("outputMint"), amount: query.get("amount"), taker: query.get("taker") });
    /* The recorded answer, at its own rate, for the amount asked. */
    const amount = BigInt(query.get("amount"));
    const forward = query.get("inputMint") === recorded.inputMint;
    const out = forward ? (amount * BigInt(recorded.outAmount)) / BigInt(recorded.inAmount) : (amount * BigInt(recorded.inAmount)) / BigInt(recorded.outAmount);
    return new Response(JSON.stringify({ ...recorded, inputMint: query.get("inputMint"), outputMint: query.get("outputMint"), inAmount: amount.toString(), outAmount: out.toString() }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const selection = { ok: true, access: "production", tier: "pro", authorizationHeaders: () => ({}) };
  const sides = async (mint) => ({ mint, verified: true, tags: [], firstPoolAt: "2024-01-01T00:00:00Z" });
  const reads = jupiterPaperReads(USDC, { selection, fetchImpl, sides, now: () => T0 });
  assert.equal(await reads.buy(1_000_000n), BigInt(recorded.outAmount));
  assert.equal(await reads.worth(BigInt(recorded.outAmount)), 1_000_000n);
  assert.deepEqual(await reads.fees(), { buyBps: 10, sellBps: 10 });
  assert.ok(asked.every((call) => call.path.endsWith("/order") && call.taker === null), "a quote without a taker: nothing is built, nothing is signed");
  assert.deepEqual(asked.map((call) => [call.input, call.output]), [[recorded.inputMint, USDC], [USDC, recorded.inputMint]]);
});

/* ---------------------------------------------------------------- paper and money never mix */

const PAPER_DIR = new URL("./", import.meta.url);
const sourceOf = (name) => readFileSync(new URL(name, PAPER_DIR), "utf8");
const SOURCES = readdirSync(PAPER_DIR).filter((name) => name.endsWith(".ts"));

test("the rules are imported from the mandate, never copied", () => {
  const step = sourceOf("step.server.ts");
  assert.match(step, /import \{[^}]*\bexitOf\b[^}]*\bruleOf\b[^}]*\} from "\.\.\/plans\.ts"/);
  assert.match(step, /import \{[^}]*\bautostop\b[^}]*\bdecide\b[^}]*\} from "\.\.\/strategy\.ts"/);
  assert.match(step, /import \{[^}]*\bwithMark\b[^}]*\} from "\.\.\/tick\.server\.ts"/);
  assert.match(sourceOf("model.ts"), /import \{ netOf[^}]*\} from "\.\.\/net\.ts"/);
  for (const name of SOURCES) {
    const source = sourceOf(name);
    assert.doesNotMatch(source, /function (decide|autostop|ruleOf|exitOf|netOf|steadyRhythm|withMark)\b/, `${name} copies a rule`);
  }
});

test("no paper file reaches the agent's book, its signer, a key or a transaction", () => {
  for (const name of SOURCES) {
    const source = sourceOf(name);
    for (const banned of [/book\.server/, /signer\.server/, /run\.server/, /agent-service\.server/, /sale\.server/, /freeze\.server/, /process\.env\.(?!RYNTRA_AGENT_PAPER)/, /\bKeypair\b/, /sendTransaction|sendRawTransaction|VersionedTransaction/]) {
      if (name === "wire.server.ts" && String(banned) === String(/process\.env\.(?!RYNTRA_AGENT_PAPER)/)) continue;
      assert.doesNotMatch(source, banned, `${name}: ${banned}`);
    }
  }
});

test("the migration: two private tables and six gated functions, nothing else touched; the switch and the cron stand", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261120190100_agent_paper_week_v1.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gmu, "");
  assert.deepEqual([...code.matchAll(/create table ([\w.]+)/gu)].map((m) => m[1]), ["private.agent_paper_weeks", "private.agent_paper_starts"]);
  const fns = [...code.matchAll(/create function (public\.\w+)\(/gu)].map((m) => m[1]).sort();
  assert.deepEqual(fns, ["public.agent_paper_admit", "public.agent_paper_due", "public.agent_paper_get", "public.agent_paper_purge", "public.agent_paper_put", "public.agent_paper_start"]);
  assert.equal((code.match(/perform private\.beta_check_secret\(p_secret\)/gu) ?? []).length, fns.length, "every function asks for the app's secret");
  assert.equal((code.match(/security definer/gu) ?? []).length, fns.length);
  assert.equal((code.match(/set search_path = ''/gu) ?? []).length, fns.length);
  assert.equal((code.match(/force row level security/gu) ?? []).length, 2, "both tables: row level security forced");
  assert.doesNotMatch(code, /\b(drop|alter table (?!private\.agent_paper_(weeks|starts)\b)|truncate)\b/iu);
  /* The admission and the start count under one lock of the network: two at once never both pass a count. */
  const bodyOf = (fn) => code.slice(code.indexOf(`create function public.${fn}(`), code.indexOf("$$;", code.indexOf(`create function public.${fn}(`)));
  for (const fn of ["agent_paper_admit", "agent_paper_start"]) {
    const body = bodyOf(fn);
    const lock = body.indexOf("perform pg_advisory_xact_lock(hashtextextended('agent_paper:' || p_network, 0));");
    assert.ok(lock > 0, `${fn} takes the network's lock`);
    assert.ok(lock < body.indexOf("count(*)"), `${fn} locks before it counts`);
  }
  /* The ledger keeps an HMAC and a time, a day at most — never an address. */
  assert.match(code, /create table private\.agent_paper_starts \(\s*who text not null check \(who ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
  assert.match(bodyOf("agent_paper_admit"), /delete from private\.agent_paper_starts s where s\.network = p_network and s\.at < v_now - interval '1 day'/u);
  assert.doesNotMatch(code, /mandate|agentSignatures|guard/iu, "nothing of the agent's book");
  const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/agent-paper" && cron.schedule === "*/5 * * * *"));
  const cron = readFileSync(new URL("../../../app/api/cron/agent-paper/route.ts", import.meta.url), "utf8");
  assert.match(cron, /decideBearerAuth/);
  assert.match(cron, /if \(!paperOpen\(\)\)/);
  const route = readFileSync(new URL("../../../app/api/bots/mandate/paper/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/if \(!paperOpen\(\)\) return failure\(404, "PAPER_CLOSED"/gu) ?? []).length, 2, "both doors closed by the switch");
  assert.match(sourceOf("wire.server.ts"), /RYNTRA_AGENT_PAPER\?\.trim\(\)\.toLowerCase\(\) === "open"/);
});

/* ---------------------------------------------------------------- paper's own budget of Jupiter (the 21.11 review) */

const windowOf = (fields) => ({ limit: null, remaining: null, resetAt: null, observedAt: null, low: false, ...fields });

test("paper spends only from the top half of the key's window, and only its own share of it", () => {
  let now = T0;
  let window = windowOf({ limit: 600, remaining: 400, observedAt: T0, resetAt: T0 + 30_000 });
  const quota = createPaperQuota({ now: () => now, budget: () => window, note: () => {} });
  /* A fifth of 600 is paper's share; what is left above money's half is 400 − 300. */
  assert.equal(quota.room(), 100);
  window = windowOf({ limit: 600, remaining: 310, observedAt: T0, resetAt: T0 + 30_000 });
  assert.equal(quota.room(), 10, "ten above the half");
  for (let ask = 0; ask < 10; ask += 1) assert.equal(quota.take(), true);
  assert.equal(quota.room(), 0, "paper's own asks since the observation count against the top");
  assert.equal(quota.take(), false);
  assert.equal(quota.refusals(), 1);
  window = windowOf({ limit: 600, remaining: 290, observedAt: T0, resetAt: T0 + 30_000 });
  assert.equal(quota.room(), 0, "under the half: never a quote for paper");
  window = windowOf({ limit: 600, remaining: 590, observedAt: T0, resetAt: T0 + 30_000, low: true });
  assert.equal(quota.room(), 0, "a window low for background work is closed to paper");
  /* An old observation or a passed reset says nothing about the window now: paper's share alone bounds it. */
  now = T0 + 61_000;
  window = windowOf({ limit: 600, remaining: 290, observedAt: T0, resetAt: T0 + 30_000 });
  assert.equal(quota.room(), 120);
  /* A window never observed: ten asks a minute. */
  const blind = createPaperQuota({ now: () => now, budget: () => windowOf({}), note: () => {} });
  for (let ask = 0; ask < PAPER_QUOTA.blind; ask += 1) assert.equal(blind.take(), true);
  assert.equal(blind.take(), false);
  now += PAPER_QUOTA.windowMs + 1;
  assert.equal(blind.room(), PAPER_QUOTA.blind, "its own asks leave the window after a minute");
});

test("Jupiter refusing one of paper's asks stands paper down until the reset, or a minute; every answer reaches the shared ledger", () => {
  let now = T0;
  const told = [];
  const quota = createPaperQuota({ now: () => now, budget: () => windowOf({}), note: (headers, at) => told.push([headers.get("x-ratelimit-remaining"), at]) });
  quota.note(new Headers({ "x-ratelimit-remaining": "40", "x-ratelimit-current": "20" }), 200);
  assert.deepEqual(told, [["40", T0]]);
  assert.equal(quota.room(), PAPER_QUOTA.blind);
  quota.note(new Headers({ "retry-after": "5" }), 429);
  assert.equal(quota.room(), 0);
  now = T0 + 5_001;
  assert.equal(quota.room(), PAPER_QUOTA.blind);
  quota.note(new Headers(), 429);
  now += 59_000;
  assert.equal(quota.room(), 0, "no reset named: a minute");
  now += 1_001;
  assert.equal(quota.room(), PAPER_QUOTA.blind);
});

test("paper's fetch asks nothing beyond its budget, and tells the budget every answer", async () => {
  let room = 1;
  const noted = [];
  const quota = { room: () => room, take: () => (room > 0 ? (room -= 1, true) : false), note: (headers, status) => noted.push(status), refusals: () => 0 };
  const asked = [];
  const base = async (url) => (asked.push(String(url)), new Response("{}", { status: 200, headers: { "x-ratelimit-remaining": "9" } }));
  const ask = paperFetch(quota, base);
  await ask("https://api.jup.ag/swap/v2/order?a=1");
  await assert.rejects(ask("https://api.jup.ag/swap/v2/order?a=2"), PaperQuotaSpent);
  assert.deepEqual(asked, ["https://api.jup.ag/swap/v2/order?a=1"], "the refused ask was never sent");
  assert.deepEqual(noted, [200]);
});

test("the same quote within a minute is asked once; a failure is never kept", async () => {
  let now = T0;
  const cache = createPaperQuoteCache({ now: () => now });
  let asks = 0;
  const ask = async () => (asks += 1, 7n);
  assert.equal(await cache.get("q", 60_000, ask), 7n);
  assert.equal(await cache.get("q", 60_000, ask), 7n);
  assert.equal(asks, 1);
  now += 60_000;
  await cache.get("q", 60_000, ask);
  assert.equal(asks, 2, "after its minute it is asked again");
  await assert.rejects(cache.get("bad", 60_000, async () => { throw new Error("no"); }));
  assert.equal(await cache.get("bad", 60_000, ask), 7n, "a failed read is asked again at once");
  const small = createPaperQuoteCache({ now: () => now, max: 2 });
  for (const key of ["a", "b", "c"]) await small.get(key, 60_000, ask);
  assert.equal(small.size(), 2, "bounded");
});

test("the live reads on the deployment: each quote and the coin's facts within paper's budget, the same quote asked once", async () => {
  const recorded = JSON.parse(readFileSync(new URL("../../solana/fixtures/jupiter-order-v2-sol-usdc.json", import.meta.url), "utf8"));
  const USDC = recorded.outputMint;
  let fetched = 0;
  const fetchImpl = async (url) => {
    fetched += 1;
    const query = new URL(url).searchParams;
    return new Response(JSON.stringify({ ...recorded, inputMint: query.get("inputMint"), outputMint: query.get("outputMint"), inAmount: query.get("amount") }), { status: 200, headers: { "content-type": "application/json" } });
  };
  let sided = 0;
  const sides = async (mint) => (sided += 1, { mint, verified: true, tags: [], firstPoolAt: "2024-01-01T00:00:00Z" });
  const selection = { ok: true, access: "production", tier: "pro", authorizationHeaders: () => ({}) };
  const quota = createPaperQuota({ now: () => T0, budget: () => windowOf({}), note: () => {} });
  const cache = createPaperQuoteCache({ now: () => T0 });
  const reads = jupiterPaperReads(USDC, { selection, fetchImpl, sides, now: () => T0, quota, cache });
  await reads.buy(1_000_000n);
  await reads.buy(1_000_000n);
  await reads.fees();
  await reads.fees();
  assert.equal(fetched, 1, "one quote asked for two reads of it");
  assert.equal(sided, 2, "the facts read once: SOL's side and the coin's");
  assert.equal(quota.room(T0), PAPER_QUOTA.blind - 2, "a quote and the facts: two asks of paper's budget");
  for (let ask = quota.room(T0); ask > 0; ask -= 1) quota.take(T0);
  await assert.rejects(reads.worth(5n), PaperQuotaSpent);
  assert.equal(fetched, 1, "past paper's budget nothing reaches Jupiter");
});

test("a start's caller is an HMAC of the proven wallet under the server's key — never the address, never the network", () => {
  const wallet = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  const who = whoOf(`wallet:${wallet}`, "server-key");
  assert.match(who, /^[0-9a-f]{64}$/u);
  assert.equal(whoOf(`wallet:${wallet}`, "server-key"), who);
  assert.notEqual(whoOf(`wallet:${wallet}`, "another-key"), who);
  assert.notEqual(whoOf("203.0.113.8", "server-key"), who);
  /* The door names the caller (`./door.test.mjs` plays it): the proven wallet, never the body, never the address. */
  const door = sourceOf("door.server.ts");
  assert.match(door, /who: whoOf\(`wallet:\$\{proof\.address\}`, deps\.secret\)/);
  assert.match(door, /case "LIMITED":\s*return refused\(429, "PAPER_LIMITED"/u);
  const route = readFileSync(new URL("../../../app/api/bots/mandate/paper/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /paperWhoOf|who: /u);
  assert.match(sourceOf("wire.server.ts"), /env\.BETA_APP_SECRET\?\.trim\(\) \?\? ""/);
});

test("starts are admitted by the store's ledger before a single quote: three an hour, eight a day, 240 an hour for everyone", async () => {
  let now = T0;
  const store = createMemoryPaperStore({ now: () => now });
  const harness = readsOn(() => 2_000_000);
  let opened = 0;
  const deps = { store, reads: () => (opened += 1, harness.reads), now: () => now };
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((ch) => ch.repeat(43));
  for (const key of keys.slice(0, PAPER_STARTS.perHour)) assert.equal((await startPaper(startInput({ key }), deps)).ok, true);
  const opens = opened;
  assert.deepEqual(await startPaper(startInput({ key: keys[3] }), deps), { ok: false, code: "LIMITED" });
  assert.equal(opened, opens, "a refused start asks Jupiter nothing");
  assert.equal((await startPaper(startInput({ key: keys[3], who: "b".repeat(64) }), deps)).ok, true, "another caller is not held by this one");
  /* A start whose reads failed still counts: it spent quotes. */
  now = T0 + HOUR + 1;
  harness.state.fail = true;
  assert.equal((await startPaper(startInput({ key: keys[4] }), deps)).code, "NO_PRICE");
  harness.state.fail = false;
  assert.equal((await startPaper(startInput({ key: keys[5] }), deps)).ok, true);
  assert.equal((await startPaper(startInput({ key: keys[6] }), deps)).ok, true);
  assert.equal((await startPaper(startInput({ key: keys[7] }), deps)).code, "LIMITED", "three attempts this hour, the failed one among them");
  now = T0 + 2 * HOUR + 2;
  assert.equal((await startPaper(startInput({ key: keys[7] }), deps)).ok, true);
  assert.equal((await startPaper(startInput({ key: keys[8] }), deps)).ok, true, "the eighth attempt of the day");
  assert.equal((await startPaper(startInput({ key: keys[9] }), deps)).code, "LIMITED", "eight a day");
  now = T0 + 25 * HOUR;
  assert.equal(await store.admit(WHO, "mainnet", 2_000), "ok", "the ledger forgets after a day");
  /* Everyone's hour, and a full store, straight from the ledger. */
  const crowd = createMemoryPaperStore({ now: () => now });
  for (let at = 0; at < PAPER_STARTS.allPerHour; at += 1) assert.equal(await crowd.admit(at.toString(16).padStart(64, "0"), "mainnet", 2_000), "ok");
  assert.equal(await crowd.admit("f".repeat(64), "mainnet", 2_000), "busy", "everyone together, not this wallet");
  assert.equal(await store.admit("c".repeat(64), "mainnet", 1), "full");
});

test("a start paper's share of Jupiter cannot hold waits: nothing admitted, nothing asked", async () => {
  const store = createMemoryPaperStore({ now: () => T0 });
  const harness = readsOn(() => 2_000_000);
  let opened = 0;
  const quota = { room: () => PAPER_START_COST - 1, take: () => false, note: () => {}, refusals: () => 0 };
  assert.deepEqual(await startPaper(startInput(), { store, quota, reads: () => (opened += 1, harness.reads), now: () => T0 }), { ok: false, code: "BUSY" });
  assert.equal(opened, 0);
  assert.equal(store.starts.length, 0, "a start that waited for quotes is no attempt");
  /* Refused an ask on the way: said as paper busy, never as a coin without a price. */
  let refused = 0;
  const spending = { room: () => 100, take: () => true, note: () => {}, refusals: () => refused };
  const dry = { ...harness.reads, fees: async () => { refused += 1; throw new PaperQuotaSpent(); } };
  assert.deepEqual(await startPaper(startInput(), { store, quota: spending, reads: () => dry, now: () => T0 }), { ok: false, code: "BUSY" });
  assert.equal(store.rows.size, 0);
});

test("the cron's pass stops where paper's share runs out: the rest keep their place, nothing is written as a price not read", async () => {
  let now = T0;
  const store = createMemoryPaperStore({ now: () => now });
  const harness = readsOn(() => 2_000_000);
  const deps = { store, reads: () => harness.reads, now: () => now };
  for (const ch of ["p", "q", "r"]) await startPaper(startInput({ key: ch.repeat(43) }), deps);
  now = T0 + 5 * HOUR;
  harness.state.now = now;
  const before = new Map([...store.rows].map(([id, row]) => [id, row.version]));
  /* Room for one whole step, then none. */
  let room = PAPER_STEP_COST;
  const quota = { room: () => room, take: () => true, note: () => {}, refusals: () => 0 };
  const reads = () => ({ ...harness.reads, worth: async (coins) => (room = 0, harness.reads.worth(coins)) });
  const lines = await runPaperPass({ ...deps, quota, reads });
  assert.deepEqual(lines.map((line) => line.did), ["bought", "held"]);
  const changed = [...store.rows].filter(([id, row]) => row.version !== before.get(id));
  assert.equal(changed.length, 1, "only the agent the pass reached was written");
  /* A step refused an ask midway is dropped, not counted as a price not read. */
  now += 5 * HOUR;
  harness.state.now = now;
  let refused = 0;
  const midway = { room: () => 100, take: () => true, note: () => {}, refusals: () => refused };
  const dry = () => ({ ...harness.reads, worth: async () => { refused += 1; throw new PaperQuotaSpent(); } });
  const held = await runPaperPass({ ...deps, quota: midway, reads: dry });
  assert.deepEqual(held.map((line) => line.did), ["held"]);
  assert.ok([...store.rows.values()].every((row) => row.agent.unreadSince === undefined), "no clock towards an unread pause started");
});
