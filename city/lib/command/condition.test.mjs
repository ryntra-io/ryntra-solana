// Run from repo root: node --test city/lib/command/condition.test.mjs
//
// A buy or a sale said with a condition opens the order that rests on the coin's screen — a limit under the price for a
// buy on a fall, over it for a sale on a rise, a stop under it for a sale on a fall — with the per cent and the amount
// said. What the terminal cannot rest is «which action?», never a screen that does something else.
import assert from "node:assert/strict";
import test from "node:test";

import { priceOff, readCondition } from "./condition.ts";
import { bookOf } from "./parse.ts";
import { DOORS, run } from "./run.ts";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const ANT = "ANTxRyntraTestMintAAAAAAAAAAAAAAAAAAAAAAAAA";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP", 9e8), tower(MET, "MET", 8e8), tower(ANT, "ANT", 7e8)]);
const coin = (mint) => BOOK.coins.find((c) => c.mint === mint);
const read = (text, subject = null) => readCondition(text, BOOK, { subject });

test("a buy on a fall is a limit under the price; a sale on a rise — over it; a sale on a fall — a stop", () => {
  assert.deepEqual(read("buy ANT if it drops 5%"), {
    kind: "order",
    command: { kind: "order", mode: "limit", side: "buy", coin: coin(ANT), price: null, off: -500, amount: null, pay: "USDC", share: null },
  });
  assert.deepEqual(read("купи JUP, якщо впаде на 10 %"), {
    kind: "order",
    command: { kind: "order", mode: "limit", side: "buy", coin: coin(JUP), price: null, off: -1000, amount: null, pay: "USDC", share: null },
  });
  assert.deepEqual(read("sell JUP if it rises 20%").command, { kind: "order", mode: "limit", side: "sell", coin: coin(JUP), price: null, off: 2000, amount: null, pay: "USDC", share: null });
  assert.deepEqual(read("продай MET, якщо подорожчає на 15%").command.off, 1500);
  assert.deepEqual(read("sell JUP if it falls 10%").command, { kind: "order", mode: "stop", side: "sell", coin: coin(JUP), price: null, off: -1000, amount: null, pay: "USDC", share: null });
  assert.equal(read("якщо JUP впаде на 10%, продай половину").command.mode, "stop");
});

test("the amount and what pays are the line's own reading; the coin may stand in the condition or on the screen", () => {
  const sol = read("buy JUP for 1 SOL if it drops 5%").command;
  assert.equal(sol.amount, "1");
  assert.equal(sol.pay, "SOL");
  const dollars = read("купи JUP на 50 USDC, якщо впаде на 10 %").command;
  assert.deepEqual([dollars.amount, dollars.pay, dollars.off], ["50", "USDC", -1000]);
  const first = read("якщо JUP впаде на 10 %, купи на 1 SOL").command;
  assert.deepEqual([first.coin.symbol, first.amount, first.pay, first.off], ["JUP", "1", "SOL", -1000]);
  const half = read("sell half my JUP if it rises 20%").command;
  assert.deepEqual([half.share, half.amount], [50, null]);
  const here = read("buy if it drops 5%", coin(MET)).command;
  assert.equal(here.coin.symbol, "MET");
  // A price said after «to»: a limit at that price in dollars; a sum in SOL cannot stand beside it.
  const to = read("buy JUP for 1 SOL if it drops to 0.8").command;
  assert.deepEqual([to.price, to.off, to.pay, to.amount], ["0.8", undefined, "USDC", null]);
  assert.equal(read("продай JUP, коли подорожчає до 1,2").command.price, "1.2");
});

test("what the terminal cannot rest is «which action?»: a buy on a rise, no level, another coin, another kind of condition", () => {
  for (const text of [
    "buy JUP if it rises 5%",
    "buy JUP if it drops",
    "buy JUP if MET drops 5%",
    "buy JUP when I get paid",
    "купи JUP, якщо SOL впаде на 10 %",
    "buy XYZ if it drops 5%",
    "buy JUP if it drops 500%",
  ]) assert.deepEqual(read(text), { kind: "unsure" }, text);
});

test("a sentence without a condition, a question or a refusal is not this reader's", () => {
  for (const text of ["buy JUP for 50", "buy JUP 15% cheaper", "should I buy JUP if it drops 5%?", "what if JUP drops 5%", "не купуй JUP, якщо впаде", "trade JUP for me every day", "if JUP drops 5%"]) {
    assert.equal(read(text), null, text);
  }
});

test("the price from the price now: a figure a person would type, in dollars or in SOL", () => {
  assert.equal(priceOff(1, -500), "0.95");
  assert.equal(priceOff(0.8123, -1000), "0.7311");
  assert.equal(priceOff(0.00002345, -500), "0.00002228");
  assert.equal(priceOff(150, 2000), "180");
  assert.equal(priceOff(1234.5, -500), "1173");
  // In SOL: a JUP at $0.80 under SOL at $160, 5% lower.
  assert.equal(priceOff(0.8, -500, 160), "0.00475");
  assert.equal(priceOff(null, -500), null);
  assert.equal(priceOff(1, -500, 0), null);
});

test("the coin's screen is filled in a person's order: the ticket, what pays, the amount, then the price", () => {
  const calls = [];
  const doors = Object.fromEntries(DOORS.map((name) => [name, (...args) => calls.push([name, ...args])]));
  run({ ...read("buy JUP for 1 SOL if it drops 5%").command, price: "0.00475" }, doors);
  assert.deepEqual(calls, [
    ["openTrade", coin(JUP), "buy", "spot", "limit"],
    ["fillPay", "SOL"],
    ["fillAmount", "1"],
    ["fillPrice", "0.00475"],
  ]);
  calls.length = 0;
  run(read("sell half my JUP if it rises 20%").command, doors);
  assert.deepEqual(calls, [
    ["openTrade", coin(JUP), "sell", "spot", "limit"],
    ["fillPay", "USDC"],
    ["fillShare", 50],
  ]);
});
