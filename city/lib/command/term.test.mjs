// Run from repo root: node --test city/lib/command/term.test.mjs
//
// The term said with an agent's budget — «for a week», «на тиждень», «for 3 days», «на місяць» — reaches the card as it
// was said; the mandate's own term (30 days) stands only when no term was said. A budget's own span is never a term.
import assert from "node:assert/strict";
import test from "node:test";

import { readAsk } from "../autopilot/read.ts";
import { budgetFor } from "../autopilot/plan.ts";
import { bookOf } from "./parse.ts";
import { termSaid } from "./term.ts";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP", 9e8), tower(MET, "MET", 8e8)]);

test("a term is read into days, English and Ukrainian, and the rest of the sentence keeps the budget's words", () => {
  const cases = [
    ["trade JUP for me with 1 SOL a day for a week", 7, "trade JUP for me with 1 SOL a day"],
    ["trade JUP with 1 SOL a day for 3 days", 3, "trade JUP with 1 SOL a day"],
    ["trade JUP 1 SOL a day for 2 weeks", 14, "trade JUP 1 SOL a day"],
    ["trade MET 1 SOL a day for a month", 30, "trade MET 1 SOL a day"],
    ["trade MET 1 SOL a day for the next 10 days", 10, "trade MET 1 SOL a day"],
    ["торгуй JUP за мене на 1 SOL на день на тиждень", 7, "торгуй JUP за мене на 1 SOL на день"],
    ["торгуй JUP на 0,5 SOL на день на 3 дні", 3, "торгуй JUP на 0,5 SOL на день"],
    ["торгуй MET на 1 SOL на день на місяць", 30, "торгуй MET на 1 SOL на день"],
    ["торгуй MET щодня на 1 SOL протягом тижня", 7, "торгуй MET щодня на 1 SOL"],
    ["торгуй JUP на 1 SOL щодня впродовж 2 тижнів", 14, "торгуй JUP на 1 SOL щодня"],
    ["торгуй JUP 1 SOL в день на два тижні", 14, "торгуй JUP 1 SOL в день"],
    ["торгуй JUP 1 SOL /день на тиждень", 7, "торгуй JUP 1 SOL /день"],
  ];
  for (const [said, days, rest] of cases) assert.deepEqual(termSaid(said), { days, rest }, said);
});

test("a budget's own span, a day's budget, two terms or none is no term", () => {
  for (const said of [
    "trade JUP 1 SOL a day",
    "торгуй на 1 SOL на день",
    "trade 1 SOL a week",
    "торгуй на 1 SOL на тиждень",
    "торгуй на 1 SOL на 3 дні",
    "buy JUP for 10 USDC",
    "trade JUP for me every day",
    "trade MET 1 SOL a day for 3 days, 2 weeks",
    "trade MET 1 SOL a day for 3 days for a week",
    "trade JUP for days",
    "",
  ]) assert.equal(termSaid(said), null, said);
});

test("the agent's own reading carries the term to the card: 7 days for a week, 30 — only when no term was said", () => {
  const week = readAsk("trade JUP for me with 1 SOL a day for a week", BOOK);
  assert.equal(week.kind, "trade");
  assert.equal(week.perDaySol, "1");
  assert.equal(week.days, 7);
  assert.equal(week.coin.symbol, "JUP");
  const uk = readAsk("торгуй JUP за мене на 1 SOL на день на тиждень", BOOK);
  assert.equal(uk.perDaySol, "1");
  assert.equal(uk.days, 7);
  const three = readAsk("trade JUP with 1 SOL a day for 3 days", BOOK);
  assert.equal(three.perDaySol, "1", "the term's figure is no budget");
  assert.equal(three.days, 3);
  assert.equal(readAsk("торгуй MET на 1 SOL на день на місяць", BOOK).days, 30);
  const none = readAsk("trade JUP for me with 1 SOL a day", BOOK);
  assert.equal(none.perDaySol, "1");
  assert.equal("days" in none, false);
  // A budget a week is still not a day's: the card asks for the day, as before.
  assert.equal(readAsk("торгуй JUP на 1 SOL на тиждень", BOOK).perDaySol, null);

  // The card's budget: the term as said; the mandate's own 30 days only without one.
  assert.equal(budgetFor(week.perDaySol, null, { days: week.days }).days, 7);
  assert.equal(budgetFor(three.perDaySol, null, { days: three.days }).days, 3);
  assert.equal(budgetFor(none.perDaySol, null, { days: none.days ?? null }).days, 30);
});
