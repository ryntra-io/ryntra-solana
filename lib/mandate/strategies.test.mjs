/* CITY-193 — the agent's tested strategies: every rule and every bound, the run on history, the practice on paper and the
   agent at work with a plan, on fixtures. Nothing here reaches a network or a real key. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, TransactionInstruction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { planOfEntry, readEntry, registerMandate } from "./book.server.ts";
import { barsOf, paperRun, runPlan, runTimeframe, RUN_COSTS } from "./backtest.ts";
import { testPlan } from "./history.server.ts";
import { tokenAccountOf } from "./human.ts";
import { joinBook } from "./agent-service.server.ts";
import { agentFeeAccount, agentFeeRaw, agentFeeWallet, feeTransferInstruction, uncataloguedFacts } from "./fee.ts";
import { boundedPlan, dayHigh, earlyPick, earlyRefusal, EARLY_FILTER, exitOf, gridLevel, gridSells, launchFactsFrom, PLAN_BOUNDS, planFrom, planText, ruleOf, STEADY } from "./plans.ts";
import { BUDGET_PRESETS } from "./presets.ts";
import { MAINNET_GENESIS, mandateGate } from "./service.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, ssaAddress } from "./ssa.ts";
import { AUTOSTOP, STRATEGIES, steadyRhythm } from "./strategy.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2 } from "./terms.ts";
import { MARK_EVERY_MS, MARK_FRESH_MS, runAgentPass, withMark } from "./tick.server.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 4, 12);

/* ================================================================== the plan as text and its bounds */

test("a plan is a few characters, read back exactly; anything outside the strategies' bounds is not read", () => {
  assert.deepEqual([...STRATEGIES], ["steady", "dip", "grid", "early"]);
  for (const text of ["steady", "dip:800", "grid:500:5", "early:24", "steady,take:2000", "dip:1000,take:2000,stop:1000", "grid:300:10,stop:1500", "early:6,take:50000"]) {
    assert.equal(planText(planFrom(text)), text, text);
  }
  for (const text of ["", "hold", "dip", "dip:299", "dip:5001", "grid:500", "grid:199:5", "grid:500:1", "grid:500:11", "early:0", "early:73", "steady:1", "steady,take:299", "steady,stop:1501", "steady,stop:1000,stop:900", "steady,loss:10", "dip:8.5", "dip:-800", "x".repeat(81), null, 42]) {
    assert.equal(planFrom(text), null, String(text));
  }
  assert.equal(PLAN_BOUNDS.stopBps.max, AUTOSTOP.maxLossBps, "the person's stop is never looser than the autostop");
});

test("a sentence's numbers are drawn into the bounds, never past them", () => {
  assert.deepEqual(boundedPlan({ id: "dip" }), { id: "dip", dropBps: 800, exit: null });
  assert.deepEqual(boundedPlan({ id: "dip", dropBps: 100 }), { id: "dip", dropBps: 300, exit: null });
  assert.deepEqual(boundedPlan({ id: "dip", dropBps: 90_000 }), { id: "dip", dropBps: 5_000, exit: null });
  assert.deepEqual(boundedPlan({ id: "grid", stepBps: 50, levels: 40 }), { id: "grid", stepBps: 200, levels: 10, exit: null });
  assert.deepEqual(boundedPlan({ id: "steady", takeBps: 2_000, stopBps: 4_000 }), { id: "steady", exit: { takeBps: 2_000, stopBps: 1_500 } }, "a stop of 40 % is the autostop's 15 %");
  assert.deepEqual(boundedPlan({ id: "early", maxAgeH: 500 }), { id: "early", maxAgeH: 72, exit: null });
  for (const plan of [boundedPlan({ id: "grid", stepBps: 1e9, levels: -3, takeBps: 1e9 }), boundedPlan({ id: "dip", dropBps: Number.NaN })]) assert.ok(planFrom(planText(plan)), planText(plan));
});

/* ================================================================== the rule at the moment of a buy */

const at = (price, ago = 0) => ({ at: NOW - ago, price });
const rule = (plan, extra = {}) => ruleOf({ plan, now: NOW, marks: [at(100)], anchor: null, held: [], position: { spent: 0n, worth: 0n }, bornAt: null, ...extra });

test("steady: every buy the rhythm allows is made", () => {
  assert.deepEqual(rule(STEADY), { do: "buy" });
  assert.deepEqual(rule(STEADY, { marks: [] }), { do: "buy" }, "the steady one needs no price");
});

test("dip: a buy only at the drop under the last day's high — and never on a price not read", () => {
  const dip = planFrom("dip:1000");
  assert.deepEqual(rule(dip, { marks: [at(100, HOUR), at(95)] }), { do: "hold", why: "no-dip" });
  assert.deepEqual(rule(dip, { marks: [at(100, HOUR), at(90.01)] }), { do: "hold", why: "no-dip" });
  assert.deepEqual(rule(dip, { marks: [at(100, HOUR), at(90)] }), { do: "buy" });
  assert.deepEqual(rule(dip, { marks: [at(200, DAY + 1), at(100, HOUR), at(95)] }), { do: "hold", why: "no-dip" }, "a high older than a day is not the day's");
  assert.deepEqual(rule(dip, { marks: [] }), { do: "hold", why: "unread" });
  assert.deepEqual(rule(dip, { marks: [at(0)] }), { do: "hold", why: "unread" });
  assert.equal(dayHigh([at(3, 2 * DAY), at(2, HOUR), at(1)], NOW), 2);
});

test("grid: one buy at the deepest open level the price has come down to; a level held is not bought again", () => {
  const grid = planFrom("grid:500:4");
  assert.ok(Math.abs(gridLevel(100, 500, 2) - 90.25) < 1e-9);
  assert.deepEqual(rule(grid, { marks: [at(100)], anchor: 100 }), { do: "buy", level: 0 });
  assert.deepEqual(rule(grid, { marks: [at(100)], anchor: 100, held: [0] }), { do: "hold", why: "no-level" });
  assert.deepEqual(rule(grid, { marks: [at(94)], anchor: 100, held: [0] }), { do: "buy", level: 1 });
  assert.deepEqual(rule(grid, { marks: [at(85)], anchor: 100, held: [0] }), { do: "buy", level: 3 }, "a fall through several levels buys the deepest once");
  assert.deepEqual(rule(grid, { marks: [at(85)], anchor: 100, held: [0, 1, 2, 3] }), { do: "hold", why: "no-level" }, "never more levels than said");
  assert.deepEqual(rule(grid, { marks: [at(101)], anchor: 100 }), { do: "hold", why: "no-level" });
  assert.deepEqual(rule(grid, { marks: [at(100)] }), { do: "buy", level: 0 }, "with no anchor yet, the price now is the anchor");
  assert.deepEqual(gridSells(grid, 100, [0, 1], 100), [1], "a level's coins one step up are offered for sale");
  assert.deepEqual(gridSells(grid, 100, [0, 1], 106), [0, 1]);
});

test("early: the launch the agent picked, only while it is young", () => {
  const early = planFrom("early:6");
  assert.deepEqual(rule(early, { bornAt: null }), { do: "hold", why: "no-coin" });
  assert.deepEqual(rule(early, { bornAt: NOW - 5 * HOUR }), { do: "buy" });
  assert.deepEqual(rule(early, { bornAt: NOW - 6 * HOUR - 1 }), { do: "hold", why: "too-old" });
});

test("the exit comes first: at the take it stops, at the stop it stops, and a worth not read is no buy", () => {
  const plan = planFrom("dip:800,take:2000,stop:1000");
  const spent = 1_000_000n;
  assert.equal(exitOf(plan.exit, { spent, worth: 1_199_999n }), null);
  assert.equal(exitOf(plan.exit, { spent, worth: 1_200_000n }), "take");
  assert.equal(exitOf(plan.exit, { spent, worth: 900_001n }), null);
  assert.equal(exitOf(plan.exit, { spent, worth: 900_000n }), "stop");
  assert.equal(exitOf(plan.exit, { spent: 0n, worth: 0n }), null, "nothing bought, nothing to take");
  assert.deepEqual(rule(plan, { marks: [at(100, HOUR), at(50)], position: { spent, worth: 1_300_000n } }), { do: "exit", why: "take" }, "a dip deeper than ever still does not buy past the take");
  assert.deepEqual(rule(plan, { marks: [at(100, HOUR), at(50)], position: { spent, worth: null } }), { do: "hold", why: "unread" });
  assert.deepEqual(rule(planFrom("steady,take:2000"), { position: { spent, worth: 1_050_000n } }), { do: "buy" });
});

/* ================================================================== early: the city's risk filter */

const launch = (extra = {}) => ({
  mint: "Launch1111111111111111111111111111111111111",
  symbol: "NEW",
  liquidityUsd: 40_000,
  marketCapUsd: 90_000,
  holders: 400,
  top10Pct: 18,
  devPct: 2,
  creatorLaunches: 2,
  creatorGraduated: 1,
  auditRead: true,
  notices: [],
  firstPoolAt: new Date(NOW - 2 * HOUR).toISOString(),
  volumeH1Usd: 20_000,
  ...extra,
});

test("early's filter: every bar refuses on its own, and a fact not read never passes", () => {
  assert.equal(earlyRefusal(launch(), NOW, 24), null);
  const cases = [
    [{ auditRead: false }, "audit"],
    [{ notices: ["MINT_AUTHORITY"] }, "notices"],
    [{ notices: ["FREEZE_AUTHORITY"] }, "notices"],
    [{ firstPoolAt: null }, "age"],
    [{ firstPoolAt: new Date(NOW - 25 * HOUR).toISOString() }, "age"],
    [{ firstPoolAt: new Date(NOW + HOUR).toISOString() }, "age"],
    [{ liquidityUsd: EARLY_FILTER.minLiquidityUsd - 1 }, "liquidity"],
    [{ liquidityUsd: null }, "liquidity"],
    [{ marketCapUsd: 19_999 }, "cap"],
    [{ holders: 99 }, "holders"],
    [{ holders: null }, "holders"],
    [{ top10Pct: 30.1 }, "top10"],
    [{ top10Pct: null }, "top10"],
    [{ devPct: 10.5 }, "dev"],
    [{ devPct: null }, "dev"],
    [{ creatorLaunches: 40, creatorGraduated: 3 }, "creator"],
  ];
  for (const [extra, why] of cases) assert.equal(earlyRefusal(launch(extra), NOW, 24), why, JSON.stringify(extra));
  assert.equal(earlyRefusal(launch({ creatorLaunches: 40, creatorGraduated: 4 }), NOW, 24), null, "a creator whose launches reach a DEX is not a serial launcher");
  assert.equal(earlyRefusal(launch({ creatorLaunches: null }), NOW, 24), null);
});

test("early's pick: of those that pass, the one most traded in the last hour; none when none passes", () => {
  const rows = [launch({ mint: "A", volumeH1Usd: 5_000 }), launch({ mint: "B", volumeH1Usd: 90_000, holders: 10 }), launch({ mint: "C", volumeH1Usd: 50_000 })];
  assert.equal(earlyPick(rows, NOW).mint, "C");
  assert.equal(earlyPick([launch({ auditRead: false })], NOW), null);
  const row = { ...launch(), windows: { h1: { volumeUsd: 7 } }, volumeH1Usd: undefined };
  assert.equal(launchFactsFrom(row).volumeH1Usd, 7);
  assert.deepEqual(launchFactsFrom({ ...row, notices: undefined }).notices, ["not-read"], "notices not read never pass");
});

/* ================================================================== the run on history */

const bars = (closes, start = NOW - closes.length * HOUR, step = HOUR) => closes.map((c, n) => ({ t: start + n * step, o: n ? closes[n - 1] : c, h: Math.max(c, n ? closes[n - 1] : c), l: Math.min(c, n ? closes[n - 1] : c), c }));
const SMALL = { perTrade: 0.02, perDay: 0.1, days: 30 };
const FREE = { feeBps: 0, slippageBps: 0, networkSol: 0 };

test("the run keeps the mandate's caps and rhythm: never more than the day's budget, never sooner than the steady spacing", () => {
  const flat = bars(Array.from({ length: 72 }, () => 1));
  const run = runPlan(STEADY, flat, SMALL, { costs: FREE });
  const { everyMs } = steadyRhythm(20_000_000n, 100_000_000n);
  assert.equal(everyMs, 4.8 * HOUR);
  assert.equal(run.buys, 15, "three days at five buys a day");
  assert.ok(Math.abs(run.spentSol - 0.3) < 1e-9);
  assert.equal(run.resultPct, 0);
  assert.equal(run.holdPct, 0);
  const buys = run.trades.filter((t) => t.side === "buy");
  for (let n = 1; n < buys.length; n += 1) assert.ok(buys[n].at - buys[n - 1].at >= everyMs);
  const short = runPlan(STEADY, flat, { ...SMALL, days: 1 }, { costs: FREE });
  assert.equal(short.buys, 5, "the mandate's end ends the buying");
});

test("the run counts what a trade costs: Ryntra's fee, the route and the network", () => {
  const run = runPlan(STEADY, bars([1, 1, 1, 1, 1, 1]), SMALL);
  assert.equal(run.buys, 2);
  const keep = 1 - (RUN_COSTS.feeBps + RUN_COSTS.slippageBps) / 10_000;
  assert.ok(Math.abs(run.resultPct - ((keep * 0.04 - 0.04 - 2 * RUN_COSTS.networkSol) / 0.04) * 100) < 1e-9);
  assert.ok(run.resultPct < 0, "flat prices with costs are a small loss, said so");
});

test("dip against steady on the same fall and bounce: it buys only the fall, and stands against holding", () => {
  const vee = [...Array.from({ length: 24 }, () => 1), ...Array.from({ length: 24 }, (_, n) => 1 - (n + 1) * 0.01), ...Array.from({ length: 24 }, (_, n) => 0.76 + (n + 1) * 0.01)];
  const dip = runPlan(planFrom("dip:1000"), bars(vee), SMALL, { costs: FREE });
  const steady = runPlan(STEADY, bars(vee), SMALL, { costs: FREE });
  assert.ok(dip.buys > 0 && dip.buys < steady.buys);
  assert.ok(dip.trades.every((t) => t.side === "buy" && t.price <= 0.9 + 1e-9), "never above the drop");
  assert.ok(dip.resultPct > steady.resultPct);
  assert.ok(Math.abs(dip.holdPct - (vee.at(-1) / vee[0] - 1) * 100) < 1e-9, "holding is the same money in at the first open");
  const none = runPlan(planFrom("dip:1000"), bars(Array.from({ length: 48 }, () => 1)), SMALL, { costs: FREE });
  assert.deepEqual([none.buys, none.resultPct, none.holdPct], [0, null, null], "the rule never fired: no figure is made up");
});

test("grid on the run: holds its levels where the engine cannot sell; sells one step up where it can", () => {
  const wave = [1, 0.97, 0.94, 0.92, 0.9, 0.93, 0.96, 1, 1.02, 0.97, 0.94, 1].flatMap((c) => [c, c, c, c, c, c]);
  const plan = planFrom("grid:500:3");
  const holds = runPlan(plan, bars(wave), SMALL, { costs: FREE });
  assert.equal(holds.sells, 0);
  assert.deepEqual(holds.trades.map((t) => t.level), [0, 1, 2]);
  const sells = runPlan(plan, bars(wave), SMALL, { costs: FREE, sells: true });
  assert.ok(sells.sells > 0);
  assert.ok(sells.gotSol > 0);
  assert.ok(sells.buys > holds.buys, "a level sold opens again");
});

test("the run stops where the agent would: the person's take, the person's stop and the autostop", () => {
  const up = bars([1, 1.1, 1.3, 1.5, 1.7, 2, 2.2].flatMap((c) => [c, c, c, c, c]));
  const take = runPlan(planFrom("steady,take:2000"), up, SMALL, { costs: FREE });
  assert.equal(take.exit?.why, "take");
  assert.ok(take.trades.every((t) => t.at <= take.exit.at));
  const sold = runPlan(planFrom("steady,take:2000"), up, SMALL, { costs: FREE, sells: true });
  assert.equal(sold.heldSol, 0, "where the engine sells, the take is sold");
  const down = bars(Array.from({ length: 60 }, (_, n) => 1 - n * 0.006));
  const stop = runPlan(planFrom("steady,stop:500"), down, SMALL, { costs: FREE });
  assert.equal(stop.exit?.why, "stop");
  const auto = runPlan(STEADY, down, SMALL, { costs: FREE });
  assert.ok(auto.paused && ["loss", "losses"].includes(auto.paused.why), "the autostop holds in every strategy");
  assert.ok(auto.worstPct < 0);
});

/* ================================================================== practice without money */

test("the paper agent runs the same rules on the candles since it started, each seen only once it closed", () => {
  const start = NOW - 10 * HOUR;
  const series = bars(Array.from({ length: 24 }, () => 1), NOW - 24 * HOUR);
  const paper = { plan: "steady", coin: "C", symbol: "C", startedAt: start, bornAt: null };
  const run = paperRun(STEADY, paper, series, SMALL, NOW, { costs: FREE, barMs: HOUR });
  assert.ok(run.fromMs >= start - HOUR);
  assert.equal(run.buys, 3, "ten hours at one buy each 4.8 h, the first at once");
  const again = paperRun(STEADY, paper, series, SMALL, NOW, { costs: FREE, barMs: HOUR });
  assert.deepEqual(again, run, "two reads of the paper agent agree");
  assert.equal(paperRun(STEADY, { ...paper, startedAt: NOW }, series, SMALL, NOW, { barMs: HOUR }).buys, 1, "started now: the steady one's first buy at once, at the last close");
  assert.equal(paperRun(STEADY, { ...paper, startedAt: NOW + HOUR }, series, SMALL, NOW, { barMs: HOUR }).buys, 0, "no candle it has not seen close");
});

test("the candles a run reads: finer for a young practice, priced and closed bars only", () => {
  assert.deepEqual(runTimeframe(null, NOW), { timeframe: "1h", barMs: HOUR });
  assert.equal(runTimeframe(NOW - HOUR, NOW).timeframe, "5m");
  assert.equal(runTimeframe(NOW - 2 * DAY, NOW).timeframe, "15m");
  assert.equal(runTimeframe(NOW - 5 * DAY, NOW).timeframe, "1h");
  const sec = (ms) => ms / 1000;
  const got = barsOf(
    [
      { time: sec(NOW - 2 * HOUR), open: 1, high: 1, low: 1, close: 1 },
      { time: sec(NOW - 3 * HOUR), open: 1, high: 2, low: 1, close: 2 },
      { time: sec(NOW - 3 * HOUR), open: 1, high: 2, low: 1, close: 2 },
      { time: sec(NOW - HOUR + 1000), open: 1, high: 1, low: 1, close: 1 },
      { time: sec(NOW - 4 * HOUR), open: 0, high: 1, low: 1, close: 1 },
    ],
    HOUR,
    NOW,
  );
  assert.deepEqual(got.map((b) => b.t), [NOW - 3 * HOUR, NOW - 2 * HOUR], "sorted, one per open, unpriced and still open bars left out");
});

test("a test runs only on the city's own candles: none read, no figure", async () => {
  const plan = planFrom("dip:800");
  assert.deepEqual(await testPlan({ coin: "C", plan, preset: "small", since: null, bornAt: null }, { candles: async () => ({ ok: false }), now: () => NOW }), { ok: false, code: "NO_HISTORY" });
  const few = Array.from({ length: 10 }, (_, n) => ({ time: (NOW - (n + 2) * HOUR) / 1000, open: 1, high: 1, low: 1, close: 1 }));
  assert.deepEqual(await testPlan({ coin: "C", plan, preset: "small", since: null, bornAt: null }, { candles: async () => ({ ok: true, candles: few }), now: () => NOW }), { ok: false, code: "TOO_YOUNG" });
  const many = Array.from({ length: 100 }, (_, n) => ({ time: (NOW - (n + 2) * HOUR) / 1000, open: 1, high: 1, low: 1, close: 1 }));
  const asked = [];
  const answer = await testPlan({ coin: "C", plan: STEADY, preset: "small", since: null, bornAt: null }, { candles: async (mint, tf) => (asked.push(tf), { ok: true, candles: many }), now: () => NOW });
  assert.equal(answer.ok && answer.mode, "history");
  assert.equal(answer.result.bars, 100);
  const paper = await testPlan({ coin: "C", plan: STEADY, preset: "small", since: NOW - 2 * HOUR, bornAt: null }, { candles: async (mint, tf) => (asked.push(tf), { ok: true, candles: many }), now: () => NOW });
  assert.equal(paper.ok && paper.mode, "paper");
  assert.deepEqual(asked, ["1h", "5m"]);
});

/* ================================================================== the agent at work with a plan */

const human = Keypair.generate().publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const pool = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(9n);
const vault = ssaAddress.vault(settings, 0);
const policy = ssaAddress.policy(settings, 1n);
const budget = tokenAccountOf(vault, NATIVE_MINT);
const receiver = tokenAccountOf(human, coin);
const gate = { open: true, network: "devnet", pool, agent };
const medium = BUDGET_PRESETS.medium;
const RECORD = { owner: human.toBase58(), settings: settings.toBase58(), vault: vault.toBase58(), policy: policy.toBase58(), budget: budget.toBase58(), perTrade: medium.perTrade.toString(), perDay: medium.perDay.toString(), expiresAt: String(Math.floor((NOW + 29 * DAY) / 1000)) };

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers) => Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(1)]);
const policyData = (onSettings, signers) => Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...onSettings.toBytes(), ...u64(1), 255, ...u64(0), ...u64(0), ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), ...u16(1), ...new Array(64).fill(0), ...agentFeeAccount(NATIVE_MINT).toBytes()]);
const tokenData = (mint, owner) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Array(101).fill(0)]);
const mintData = () => Uint8Array.from({ length: 82 }, (_, n) => (n === 44 ? 6 : n === 45 ? 1 : 0));

function chain() {
  const accounts = new Map([
    [policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(settings, [agent]), lamports: 1, executable: false }],
    [settings.toBase58(), { owner: SSA_PROGRAM_ID, data: settingsData([human]), lamports: 1, executable: false }],
    [receiver.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, human), lamports: 1, executable: false }],
    [coin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: mintData(), lamports: 1, executable: false }],
    [agentFeeAccount(NATIVE_MINT).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, agentFeeWallet()), lamports: 1, executable: false }],
  ]);
  const sent = [];
  return {
    sent,
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async () => ({ value: { amount: String(medium.budget) } }),
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => (sent.push(bytes), "sent"),
    getBlockHeight: async () => 1_000_000,
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 90_000, fee: 5_000 } }),
  };
}

function swap2(amount) {
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[0] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[4] = { pubkey: budget, isSigner: false, isWritable: true };
  keys[5] = { pubkey: receiver, isSigner: false, isWritable: true };
  keys[10] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(1n, 16);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
}

const feeOf = (amount) => agentFeeRaw(amount, 100);
/** The pool's price: lamports for one whole coin (six decimals); 0.05 SOL buys 47 000 base units at the start. */
const P0 = 1_064_000_000n;
const pricedVenue = (price) => ({
  buy: async (_mandate, amount) => ({ instruction: swap2(amount - feeOf(amount)), fee: feeTransferInstruction({ budgetMint: NATIVE_MINT, budgetAccount: budget, vault, fee: feeOf(amount), decimals: 9 }), feeSides: { input: null, output: uncataloguedFacts(coin.toBase58()), nowMs: NOW }, setup: [], promisedOut: 1n }),
  received: async () => 47_000n,
  worth: async (_mandate, amount) => (amount * price.now) / 1_000_000n,
});

async function stand(plan, extra = {}) {
  const store = createMemoryGuardStore();
  const connection = chain();
  const parsed = planFrom(plan);
  const joined = await registerMandate({ record: RECORD, strategy: parsed.id, plan: parsed, said: plan, ...extra }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW });
  assert.equal(joined.ok, true, joined.reason);
  const key = envKey(JSON.stringify([...agentPair.secretKey])).signer;
  const price = { now: P0 };
  const pass = (now) => runAgentPass({ gate, store, connection, key, journal: async () => {}, venue: pricedVenue(price), now: () => now });
  return { store, connection, price, pass, entry: () => readEntry(store, RECORD.policy) };
}

test("the book keeps the plan: an entry of before is the steady one, a plan that disagrees is refused", async () => {
  const { entry } = await stand("dip:1000,take:2000");
  assert.equal((await entry()).plan, "dip:1000,take:2000");
  assert.equal(planText(planOfEntry(await entry())), "dip:1000,take:2000");
  assert.equal(planOfEntry({ strategy: "steady" }), STEADY);
  assert.equal(planOfEntry({ strategy: "dip", plan: "garbage" }), STEADY, "a plan not read trades as the steady one");
  const store = createMemoryGuardStore();
  const refused = await registerMandate({ record: RECORD, strategy: "grid", plan: planFrom("dip:800"), said: null }, gate, { store, connection: chain(), receiveMint: async () => coin, now: () => NOW });
  assert.equal(refused.ok, false);
  const noLaunch = await registerMandate({ record: RECORD, strategy: "early", plan: planFrom("early:24"), said: null }, gate, { store, connection: chain(), receiveMint: async () => coin, now: () => NOW });
  assert.match(noLaunch.reason, /launch/);
});

test("dip at work: the agent marks the price, holds at the high and buys the drop — its trade the same cap", async () => {
  const { pass, price, entry, connection } = await stand("dip:1000");
  assert.deepEqual(await pass(NOW), [{ policy: RECORD.policy, did: "waited" }], "at the high: no buy");
  assert.equal(connection.sent.length, 0);
  assert.deepEqual((await entry()).marks.map((m) => m.price), [Number(P0)]);
  await pass(NOW + MARK_EVERY_MS - 1);
  assert.equal((await entry()).marks.length, 1, "a mark at most every ten minutes");
  price.now = (P0 * 95n) / 100n;
  assert.deepEqual(await pass(NOW + MARK_EVERY_MS), [{ policy: RECORD.policy, did: "waited" }], "5 % is not the 10 % said");
  price.now = (P0 * 90n) / 100n;
  assert.deepEqual(await pass(NOW + 2 * MARK_EVERY_MS), [{ policy: RECORD.policy, did: "bought" }]);
  assert.equal(connection.sent.length, 1);
  assert.equal((await entry()).trades[0].spentRaw, medium.perTrade.toString(), "a strategy never changes a buy's size");
  assert.deepEqual(await pass(NOW + 3 * MARK_EVERY_MS), [{ policy: RECORD.policy, did: "waited" }], "the rhythm still spaces the buys");
  assert.equal(connection.sent.length, 1);
});

test("a dip never buys on an old price: the newest mark must be fresh", async () => {
  const marks = await withMark([], NOW, async () => P0);
  assert.equal(marks.length, 1);
  assert.equal(await withMark(marks, NOW + 1, async () => assert.fail("not read twice in ten minutes")), marks);
  assert.equal(await withMark(marks, NOW + MARK_EVERY_MS, async () => { throw new Error("no answer"); }), marks, "a quote not read adds nothing");
  const { pass, price, store, connection } = await stand("dip:1000");
  await pass(NOW);
  price.now = (P0 * 80n) / 100n;
  const blind = { ...pricedVenue(price), worth: async () => { throw new Error("no answer"); } };
  const lines = await runAgentPass({ gate, store, connection, key: envKey(JSON.stringify([...agentPair.secretKey])).signer, journal: async () => {}, venue: blind, now: () => NOW + MARK_FRESH_MS + 1 });
  assert.deepEqual(lines, [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 0);
});

test("grid at work: a level at a time, written on the trade", async () => {
  const { pass, price, entry } = await stand("grid:500:3");
  assert.deepEqual(await pass(NOW), [{ policy: RECORD.policy, did: "bought" }], "the first level is the price it starts at");
  assert.equal((await entry()).anchor, Number(P0));
  assert.equal((await entry()).trades[0].level, 0);
  const later = NOW + 5 * HOUR;
  assert.deepEqual(await pass(later), [{ policy: RECORD.policy, did: "waited" }], "the price is still at the held level");
  price.now = (P0 * 94n) / 100n;
  assert.deepEqual(await pass(later + MARK_EVERY_MS), [{ policy: RECORD.policy, did: "bought" }]);
  assert.deepEqual((await entry()).trades.map((t) => t.level), [0, 1]);
});

test("the person's exit at work: at +20 % the agent stops buying and says why; at its stop the same", async () => {
  const take = await stand("steady,take:2000");
  assert.deepEqual(await take.pass(NOW), [{ policy: RECORD.policy, did: "bought" }]);
  take.price.now = (P0 * 125n) / 100n;
  assert.deepEqual(await take.pass(NOW + HOUR), [{ policy: RECORD.policy, did: "paused" }], "even between buys");
  assert.equal((await take.entry()).pausedBy, "take");
  assert.deepEqual(await take.pass(NOW + 6 * HOUR), [], "a take is not lifted on its own");
  const stop = await stand("steady,stop:1000");
  await stop.pass(NOW);
  stop.price.now = (P0 * 89n) / 100n;
  assert.deepEqual(await stop.pass(NOW + 5 * HOUR), [{ policy: RECORD.policy, did: "paused" }]);
  assert.equal((await stop.entry()).pausedBy, "stop", "the person's stop before the autostop's 15 %");
  assert.equal(stop.connection.sent.length, 1);
});

test("early at work: the launch's first hours only, then it stops buying", async () => {
  const early = await stand("early:24", { bornAt: NOW - 23 * HOUR });
  assert.deepEqual(await early.pass(NOW), [{ policy: RECORD.policy, did: "bought" }]);
  assert.deepEqual(await early.pass(NOW + 2 * HOUR), [{ policy: RECORD.policy, did: "paused" }]);
  assert.equal((await early.entry()).pausedBy, "late");
});

test("early on mainnet: the city's pick is checked again on the server — a launch that fails the filter never joins", async () => {
  const mainnet = mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet" });
  const store = { ...createMemoryGuardStore(), durability: "DURABLE_SINGLE_WRITER" };
  const connection = { getGenesisHash: async () => MAINNET_GENESIS, getAccountInfo: async () => assert.fail("not on chain before the filter") };
  const ask = { record: RECORD, strategy: "early", plan: planFrom("early:24"), said: "купуй нові запуски", coin: coin.toBase58() };
  assert.match((await joinBook(ask, mainnet, { store, connection, launchFacts: async () => null, now: () => NOW })).reason, /not a new launch/);
  assert.match((await joinBook(ask, mainnet, { store, connection, launchFacts: async () => launch({ top10Pct: 60 }), now: () => NOW })).reason, /top10/);
});
