import assert from "node:assert/strict";
import test from "node:test";

import { bookOf } from "../command/parse.ts";

import { budgetLines } from "./plan-line.ts";
import { budgetFor, rhythmOf } from "./plan.ts";
import { readAsk } from "./read.ts";
import { AUTOPILOT } from "./words.ts";

/*
 * The agent's card says the budget as the person said it. «trade 0.1 SOL a day on JUP» is a day's budget of
 * 0.1 SOL; 0.02 SOL is one trade. The headline carries the day's budget, one trade's size stands on its own line.
 */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BOOK = bookOf([
  { id: JUP, symbol: "JUP", name: "Jupiter", icon: null, mcap: 1e9, liquidity: 1e6, verified: true },
  { id: BONK, symbol: "BONK", name: "Bonk", icon: null, mcap: 1e9, liquidity: 1e6, verified: true },
]);

/** The card's two lines for a sentence, the way the proposal reads it: the day as said, her trade's rhythm. */
function card(said, lang) {
  const read = readAsk(said, BOOK);
  assert.equal(read?.kind, "trade", said);
  const budget = budgetFor(read.perDaySol);
  const plan = read.plan ?? null;
  const rhythm = budget ? rhythmOf(budget, plan?.pace ?? null) : null;
  return budgetLines(rhythm, plan, AUTOPILOT[lang], lang);
}

test("«trade 0.1 SOL a day on JUP»: the headline is the day's 0.1 SOL as said, half of it a trade on its own line", () => {
  const en = card("trade 0.1 SOL a day on JUP", "en");
  assert.equal(en.headline, "Trades up to 0.1 SOL a day for you");
  assert.equal(en.size, "0.05 SOL a trade · 2 buys a day");
  assert.doesNotMatch(en.headline, /0\.05/u, "one trade is never the day");
  const uk = card("торгуй на 0,1 SOL на день JUP", "uk");
  assert.equal(uk.headline, "Торгує за тебе до 0,1 SOL на день");
  assert.equal(uk.size, "0,05 SOL за угоду · 2 покупки на день");
});

test("«1 SOL a day» reads as 1 SOL — never cut to a budget of Ryntra's — in both languages", () => {
  const en = card("trade 1 SOL a day", "en");
  assert.equal(en.headline, "Trades up to 1 SOL a day for you");
  assert.equal(en.size, "0.5 SOL a trade · 2 buys a day");
  const uk = card("торгуй на 1 SOL на день", "uk");
  assert.equal(uk.headline, "Торгує за тебе до 1 SOL на день");
  assert.equal(uk.size, "0,5 SOL за угоду · 2 покупки на день");
  assert.equal(card("trade 250 SOL a day", "en").headline, "Trades up to 250 SOL a day for you");
});

test("a grid and a dip: the day's budget stays in the headline; their buys a day are a ceiling", () => {
  const grid = card("торгуй JUP сіткою на 0,1 SOL на день", "uk");
  assert.equal(grid.headline, "Торгує за тебе до 0,1 SOL на день");
  assert.equal(grid.size, "0,05 SOL за угоду · до 2 покупок на день");
  const dip = card("buy the dip on JUP with 0.5 SOL a day", "en");
  assert.equal(dip.headline, "Trades up to 0.5 SOL a day for you");
  assert.equal(dip.size, "0.25 SOL a trade · up to 2 buys a day");
});

test("her own trade sets the rhythm, and no budget at all", () => {
  // Her trade of 0.02 in 0.1 a day: five buys.
  const full = budgetLines(rhythmOf({ perDay: 100_000_000n, perTrade: 20_000_000n, days: 30 }), null, AUTOPILOT.en, "en");
  assert.deepEqual(full, { headline: "Trades up to 0.1 SOL a day for you", size: "0.02 SOL a trade · 5 buys a day" });
  assert.equal(budgetLines(rhythmOf({ perDay: 100_000_000n, perTrade: 20_000_000n, days: 30 }), null, AUTOPILOT.uk, "uk").size, "0,02 SOL за угоду · 5 покупок на день");
  assert.deepEqual(budgetLines(null, null, AUTOPILOT.en, "en"), { headline: "Trades for you within a budget", size: null });
  assert.equal(budgetLines(null, null, AUTOPILOT.uk, "uk").headline, "Торгує за тебе в межах бюджету");
});
