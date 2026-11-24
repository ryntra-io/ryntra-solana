// Run from repo root: node --test terminal/shell/hints.test.mjs
//
// Every ready sentence the terminal offers — under the agent's line on the home page, the kit's, the Agents screen's
// questions — opens what it says; and the two sentences the live site got wrong now open what they say: a term reaches
// Recurring buys as said, a buy on a fall is a limit under the price on the coin's screen.
import assert from "node:assert/strict";
import test from "node:test";

import { bookOf } from "../../city/lib/command/parse.ts";
import { AGENTS } from "../agents/words.ts";
import { MARKET } from "../market/words.ts";
import { askLabel } from "./ask-label.ts";
import { EVERY_GATE, askHref, askRows, conditionUnsure, modelWanted, pricedRow } from "./ask-route.ts";
import { KIT } from "./kit/words.ts";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const ANT = "ANTxRyntraTestMintAAAAAAAAAAAAAAAAAAAAAAAAA";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP", 9e8), tower(MET, "MET", 8e8), tower(ANT, "ANT", 7e8)]);
const ALL = () => true;
const first = (said) => askRows(said, BOOK, { subject: null }, ALL, EVERY_GATE)[0] ?? null;
/** Where a sentence leads, as the table in the pull request writes it. */
const opens = (said) => {
  const row = first(said);
  return row ? `${row.command.kind} ${askHref(row.target, "live")}` : "none";
};

test("every ready sentence opens what it says (home, kit, Agents), in English and Ukrainian", () => {
  for (const lang of ["en", "uk"]) {
    const m = MARKET[lang];
    const k = KIT[lang];
    const a = AGENTS[lang];
    const table = [
      [m.sayTradeDaily("JUP"), "autopilot /agent?ai=trader"],
      [m.sayDips("JUP"), "autopilot /agent?ai=trader"],
      [m.sayLaunch, "launch /launch"],
      [m.sayBuy("JUP"), `buy /coin/${JUP}`],
      [m.sayLimit("JUP", "0.5"), `order /coin/${JUP}`],
      [m.sayChart("JUP"), `chart /coin/${JUP}`],
      [m.sayEarn("SOL"), "earn /earn"],
      [k.say1, "autopilot /agent?ai=trader"],
      [k.say2, "autopilot /agent?ai=trader"],
      [k.say3, "launch /launch"],
      // A question to Ryntra is the Agents screen's: answered there.
      [a.askToday("SOL"), "ask /agent"],
      [a.askWhy("JUP"), "ask /agent"],
      [a.askRisk("MET"), "ask /agent"],
      [a.askMarket, "ask /agent"],
    ];
    for (const [said, where] of table) assert.equal(opens(said), where, `${lang}: «${said}»`);
    // «Find new coins» reads as a question; the hint itself hands the line the market's new coins (`newCoinsRow`).
    assert.equal(first(m.sayScout).command.kind, "ask");
    // A daily trade, the dips and the kit's sentences carry their coin and plan to the card, never a sum of ours.
    for (const said of [m.sayTradeDaily("JUP"), k.say1]) assert.deepEqual([first(said).command.ask.coin.symbol, first(said).command.ask.perDaySol], ["JUP", null], said);
    assert.equal(first(m.sayDips("JUP")).command.ask.plan.id, "dip");
    assert.equal(first(k.say2).command.ask.plan.id, "dip");
    assert.equal(first(m.sayLimit("JUP", "0.5")).command.price, "0.5");
  }
});

test("a term reaches Recurring buys as said: 7 days for a week, 3 for three days, 30 for a month; no model is asked", () => {
  const cases = [
    ["trade JUP for me with 1 SOL a day for a week", 7],
    ["торгуй JUP за мене на 1 SOL на день на тиждень", 7],
    ["trade JUP with 1 SOL a day for 3 days", 3],
    ["торгуй JUP на 1 SOL на день на 3 дні", 3],
    ["trade MET 1 SOL a day for a month", 30],
    ["торгуй MET на 1 SOL на день на місяць", 30],
  ];
  for (const [said, days] of cases) {
    const row = first(said);
    assert.equal(opens(said), "autopilot /agent?ai=trader", said);
    assert.equal(row.command.ask.perDaySol, "1", said);
    assert.equal(row.command.ask.days, days, said);
    assert.equal(modelWanted(said, row), false, `${said}: the line's own rules read it`);
  }
  assert.equal("days" in first("trade JUP for me with 1 SOL a day").command.ask, false, "no term said: the card's own 30 days");
});

test("a buy on a fall is a limit under the price on the coin's screen, with the per cent and the sum; a sale on a rise — over it", () => {
  const ant = first("buy ANT if it drops 5%");
  assert.equal(opens("buy ANT if it drops 5%"), `order /coin/${ANT}`);
  assert.deepEqual([ant.command.mode, ant.command.side, ant.command.off], ["limit", "buy", -500]);
  assert.equal(modelWanted("buy ANT if it drops 5%", ant), false);
  assert.equal(askLabel(ant.command, "en"), "Buy ANT 5% lower");
  const jup = first("купи JUP на 1 SOL, якщо впаде на 10 %");
  assert.equal(opens("купи JUP на 1 SOL, якщо впаде на 10 %"), `order /coin/${JUP}`);
  assert.deepEqual([jup.command.off, jup.command.amount, jup.command.pay], [-1000, "1", "SOL"]);
  assert.equal(askLabel(jup.command, "uk"), "Купити JUP на 10% дешевше");
  const sell = first("sell JUP if it rises 20%");
  assert.deepEqual([sell.command.mode, sell.command.side, sell.command.off], ["limit", "sell", 2000]);
  assert.equal(askLabel(sell.command, "en"), "Sell JUP 20% higher");
  assert.equal(askLabel(first("продай JUP, якщо впаде на 10 %").command, "uk"), "Стоп на JUP на 10% нижче");

  // The price is worked out from the price now when the line hands it over: in dollars, or in SOL for a sum in SOL.
  const prices = { [ANT]: 400, [JUP]: 0.8, [SOL]: 160 };
  const priceOf = (mint) => prices[mint] ?? null;
  assert.equal(pricedRow(ant, priceOf, SOL).command.price, "380");
  assert.equal(pricedRow(jup, priceOf, SOL).command.price, "0.0045");
  assert.equal(pricedRow(ant, () => null, SOL).command.price, null, "a price the line does not know is left for the person");
  const plain = first("buy JUP for 50");
  assert.equal(pricedRow(plain, priceOf, SOL), plain, "any other row is as it was");
});

test("what the terminal cannot rest is asked back — «which action?» — and never sent to a screen that does another", () => {
  for (const said of ["buy JUP if it rises 5%", "buy JUP if it drops", "купи JUP, якщо SOL впаде на 10 %", "buy JUP when I get paid"]) {
    assert.equal(conditionUnsure(said, BOOK, { subject: null }), true, said);
    assert.notEqual(first(said)?.command.kind, "autopilot", `${said}: not Recurring buys`);
  }
  for (const said of ["buy ANT if it drops 5%", "buy JUP for 50", "why is JUP down?"]) assert.equal(conditionUnsure(said, BOOK, { subject: null }), false, said);
});
