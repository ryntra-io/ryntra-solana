import assert from "node:assert/strict";
import test from "node:test";

import { bookOf } from "../command/parse.ts";
import { calmPlan, STEADY } from "../../../lib/mandate/plans.ts";
import { budgetLines } from "./plan-line.ts";
import { presetFor, rhythmOf } from "./plan.ts";
import { readAsk } from "./read.ts";
import { AUTOPILOT } from "./words.ts";

/*
 * CITY-216: the agent's card says the budget as the person said it. «trade 0.1 SOL a day on JUP» is a day's budget of
 * 0.1 SOL; 0.02 SOL is one trade. The headline carries the day's budget, one trade's size stands on its own line.
 */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BOOK = bookOf([
  { id: JUP, symbol: "JUP", name: "Jupiter", icon: null, mcap: 1e9, liquidity: 1e6, verified: true },
  { id: BONK, symbol: "BONK", name: "Bonk", icon: null, mcap: 1e9, liquidity: 1e6, verified: true },
]);

/** The card's two lines for a sentence, the way the proposal reads it: the preset said, at the plan's calm pace. */
function card(said, lang) {
  const read = readAsk(said, BOOK);
  assert.equal(read?.kind, "trade", said);
  const { preset } = presetFor(read.perDaySol);
  const plan = read.plan ?? null;
  const rhythm = preset ? rhythmOf(preset, calmPlan(plan ?? STEADY).pace ?? null) : null;
  return budgetLines(rhythm, plan, AUTOPILOT[lang], lang);
}

test("«trade 0.1 SOL a day on JUP»: the headline is the day's 0.1 SOL, the trade's 0.02 SOL on its own line", () => {
  const en = card("trade 0.1 SOL a day on JUP", "en");
  assert.equal(en.headline, "Trades up to 0.1 SOL a day for you");
  assert.equal(en.size, "0.02 SOL a trade · 1 buy a day");
  assert.doesNotMatch(en.headline, /0\.02/u, "one trade is never the day");
  const uk = card("торгуй на 0,1 SOL на день JUP", "uk");
  assert.equal(uk.headline, "Торгує за тебе до 0,1 SOL на день");
  assert.equal(uk.size, "0,02 SOL за угоду · 1 покупка на день");
});

test("«0.5 a day»: 0.5 SOL in the headline, 0.1 SOL a trade under it, in both languages", () => {
  const en = card("trade 0.5 SOL a day", "en");
  assert.equal(en.headline, "Trades up to 0.5 SOL a day for you");
  assert.equal(en.size, "0.1 SOL a trade · 1 buy a day");
  const uk = card("торгуй на 0,5 SOL на день", "uk");
  assert.equal(uk.headline, "Торгує за тебе до 0,5 SOL на день");
  assert.equal(uk.size, "0,1 SOL за угоду · 1 покупка на день");
});

test("a grid and a dip: the day's budget stays in the headline; their buys a day are a ceiling", () => {
  const grid = card("торгуй BONK сіткою на 0,1 SOL на день", "uk");
  assert.equal(grid.headline, "Торгує за тебе до 0,1 SOL на день");
  assert.equal(grid.size, "0,02 SOL за угоду · до 2 покупок на день");
  const gridEn = card("grid BONK step 3% 0.25 SOL a day", "en");
  assert.equal(gridEn.headline, "Trades up to 0.25 SOL a day for you");
  assert.equal(gridEn.size, "0.05 SOL a trade · up to 2 buys a day");
  const dip = card("buy the dip on BONK with 0.1 SOL a day", "en");
  assert.equal(dip.headline, "Trades up to 0.1 SOL a day for you");
  assert.equal(dip.size, "0.02 SOL a trade · up to 2 buys a day");
  const dipUk = card("купуй BONK на просіданнях на 0,5 SOL на день", "uk");
  assert.equal(dipUk.headline, "Торгує за тебе до 0,5 SOL на день");
  assert.equal(dipUk.size, "0,1 SOL за угоду · до 2 покупок на день");
});

test("the full rhythm of the caps and no budget at all", () => {
  // A signed agent without a calm pace keeps every buy the caps allow: five of 0.02 in 0.1 a day.
  const full = budgetLines(rhythmOf("small"), null, AUTOPILOT.en, "en");
  assert.deepEqual(full, { headline: "Trades up to 0.1 SOL a day for you", size: "0.02 SOL a trade · 5 buys a day" });
  assert.equal(budgetLines(rhythmOf("small"), null, AUTOPILOT.uk, "uk").size, "0,02 SOL за угоду · 5 покупок на день");
  assert.deepEqual(budgetLines(null, null, AUTOPILOT.en, "en"), { headline: "Trades for you within a budget", size: null });
  assert.equal(budgetLines(null, null, AUTOPILOT.uk, "uk").headline, "Торгує за тебе в межах бюджету");
});
