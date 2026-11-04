import assert from "node:assert/strict";
import test from "node:test";

import { bookOf } from "../command/parse.ts";
import { readInstruction } from "../instruct/read.ts";
import { planFrom, planText } from "../../../lib/mandate/plans.ts";
import { pctText, planLine, planRules, signedPct, testedLine } from "./plan-line.ts";
import { readAsk } from "./read.ts";
import { pickLaunch, readRun } from "./runs.ts";
import { AUTOPILOT } from "./words.ts";

/* CITY-193: the strategy said in a sentence, read into a plan, and said back on the card in one line. */

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BOOK = bookOf([{ id: BONK, symbol: "BONK", name: "Bonk", icon: null, mcap: 1e9, liquidity: 1e6, verified: true }]);
const ask = (text) => readAsk(text, BOOK);
const planOf = (text) => {
  const read = ask(text);
  return read && read.kind === "trade" && read.plan ? planText(read.plan) : null;
};

test("«купуй BONK на просіданнях», «торгуй сіткою», «фіксуй +20 %»: the sentence is the plan, in both languages", () => {
  for (const [said, plan] of [
    ["купуй BONK на просіданнях", "dip:800"],
    ["купуй BONK на просіданнях від 12 %", "dip:1200"],
    ["buy the dip on BONK", "dip:800"],
    ["buy the dip -10% BONK", "dip:1000"],
    ["торгуй сіткою", "grid:500:5"],
    ["торгуй BONK сіткою кроком 4 %", "grid:400:5"],
    ["grid BONK step 3% 8 levels", "grid:300:8"],
    ["фіксуй +20 %", "steady,take:2000"],
    ["take profit 25%", "steady,take:2500"],
    ["stop loss 10%", "steady,stop:1000"],
    ["торгуй на 0,1 SOL на день, фіксуй +20 % і стоп -10%", "steady,take:2000,stop:1000"],
    ["купуй BONK на просіданнях, фіксуй +30 %", "dip:800,take:3000"],
    ["купуй нові запуски", "early:24"],
    ["buy new launches early", "early:24"],
    ["торгуй на 1 SOL на день", null],
  ]) {
    assert.equal(planOf(said), plan, said);
  }
});

test("the budget and the coin are read as before beside the plan; an early plan names no tower", () => {
  const both = ask("торгуй BONK на 0,1 SOL на день на просіданнях");
  assert.equal(both.perDaySol, "0.1");
  assert.equal(both.coin.mint, BONK);
  assert.equal(planText(both.plan), "dip:800");
  assert.equal(ask("купуй BONK на просіданнях").perDaySol, null, "a per cent is never a budget");
  assert.equal(ask("купуй нові запуски BONK").coin, null, "the agent picks the launch itself");
  // A figure past the strategies' bounds is drawn into them, never past them.
  assert.equal(planOf("stop loss 40%"), "steady,stop:1500");
  assert.equal(planOf("buy the dip 90%"), "dip:5000");
});

test("a question, a refusal, a stop with no figure or a plain list is not a strategy", () => {
  for (const said of ["як працює сітка?", "what is a grid?", "не купуй на просіданнях", "стоп", "stop", "нові запуски", "trade JUP", "buy $20 of SOL every week", "купуй SOL на $20 щотижня"]) {
    const read = ask(said);
    assert.ok(read === null || read.plan === undefined, said);
  }
  // CITY-176's standing purchases stay CITY-176's.
  assert.notEqual(readInstruction("купуй SOL на $20 щотижня", BOOK, { subject: null }), null);
});

test("the card says the plan in one line, EN and UK; the steady one keeps its rhythm instead", () => {
  const en = AUTOPILOT.en;
  const uk = AUTOPILOT.uk;
  assert.equal(planLine(planFrom("dip:800,take:2000"), en, "en"), "Buys on dips of 8% · takes +20%");
  assert.equal(planLine(planFrom("dip:800,take:2000"), uk, "uk"), "Купує на просіданнях від 8 % · фіксує +20 %");
  assert.equal(planLine(planFrom("grid:250:4"), en, "en"), "Grid · 4 levels 2.5% apart");
  assert.equal(planLine(planFrom("grid:250:4"), uk, "uk"), "Сітка · 4 рівні через 2,5 %");
  assert.equal(planLine(planFrom("early:24,stop:1000"), en, "en"), "New launches that pass the check · stops at −10%");
  assert.equal(planLine(planFrom("steady,take:2000"), uk, "uk"), "Регулярні покупки · фіксує +20 %");
  assert.equal(planLine(planFrom("steady"), en, "en"), null);
  assert.equal(planLine(null, en, "en"), null);
  assert.equal(pctText(1250, "uk"), "12,5");
});

test("the rules behind «Details»: what decides, the rhythm as a ceiling, the exit as the engine can keep it", () => {
  const en = AUTOPILOT.en;
  const lines = planRules(planFrom("dip:800,take:2000"), en, "en", { buys: 5, perTrade: "0.02" }, false);
  assert.deepEqual(lines, [en.ruleDip("8"), en.ruleCeiling(5, "0.02"), en.ruleExit(false), en.ruleSame]);
  assert.match(en.ruleExit(false), /coming/, "selling on mainnet is said to be coming, never promised");
  assert.match(AUTOPILOT.uk.ruleExit(true), /одним дотиком/);
  assert.deepEqual(planRules(planFrom("steady"), en, "en", null, false), []);
});

test("the run on history in one line, signed and without a promise; nothing when it did not run", () => {
  const en = AUTOPILOT.en;
  const run = { fromMs: 0, toMs: 12 * 86_400_000, resultPct: 4.24, holdPct: -3.1 };
  assert.equal(testedLine(run, en, "en"), "Last 12 days: +4.2% · holding −3.1%");
  assert.equal(testedLine(run, AUTOPILOT.uk, "uk"), "Останні 12 дн.: +4,2 % · тримання −3,1 %");
  assert.equal(testedLine({ ...run, resultPct: null, holdPct: null }, en, "en"), "Last 12 days: the rule never fired");
  assert.equal(testedLine(null, en, "en"), null);
  assert.equal(signedPct(0.04, "en"), "0%");
  assert.equal(signedPct(-12.34, "en"), "−12%");
  for (const lang of ["en", "uk"]) {
    const all = JSON.stringify(Object.values(AUTOPILOT[lang]).map((v) => (typeof v === "function" ? v.toString() : v)));
    assert.doesNotMatch(all, /guarantee|гарант|x1000|1000x|прибуток гарант/iu, "no promise of profit in the agent's words");
  }
  assert.match(en.testedNote, /not a promise/);
});

test("the card's reads: the run's answer is taken only in its own shape; the early pick through the same filter", async () => {
  const answer = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const input = { coin: BONK, plan: planFrom("dip:800"), preset: "small" };
  assert.equal(await readRun(input, answer(422, { error: { code: "NO_HISTORY" } })), null);
  assert.equal(await readRun(input, answer(200, { result: { nope: 1 } })), null);
  assert.equal(await readRun(input, async () => { throw new Error("offline"); }), null);
  const asked = [];
  const run = await readRun({ ...input, since: 1_700_000_000_000 }, async (url) => (asked.push(url), new Response(JSON.stringify({ result: { bars: 10, buys: 2 } }))));
  assert.equal(run.buys, 2);
  assert.match(asked[0], /^\/api\/bots\/mandate\/test\?coin=Dez.*&plan=dip%3A800&preset=small&since=1700000000000$/);
  const now = Date.UTC(2026, 10, 4, 12);
  const row = (mint, extra = {}) => ({ mint, symbol: mint.slice(0, 4), icon: null, liquidityUsd: 40_000, marketCapUsd: 90_000, holders: 400, top10Pct: 18, devPct: 2, creatorLaunches: 1, creatorGraduated: 0, auditRead: true, notices: [], firstPoolAt: new Date(now - 3_600_000).toISOString(), windows: { h1: { volumeUsd: 1_000 } }, ...extra });
  const pulse = { rows: [row("Bad1111111111111111111111111111111111111111", { notices: ["MINT_AUTHORITY"], windows: { h1: { volumeUsd: 1e9 } } }), row("Good111111111111111111111111111111111111111"), "junk"] };
  const picked = await pickLaunch(24, answer(200, pulse), now);
  assert.equal(picked.mint, "Good111111111111111111111111111111111111111", "the most traded launch failed the check: not picked");
  assert.equal(picked.bornAt, now - 3_600_000);
  assert.equal(await pickLaunch(24, answer(200, { rows: [pulse.rows[0]] }), now), null);
  assert.equal(await pickLaunch(24, answer(503, {}), now), null);
});
