// Run from repo root: node --test city/lib/trade/top-up.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { offersTopUp, problemLine } from "./top-up.ts";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* CITY-239: an empty wallet on the tower's ticket. «Add SOL» stood beside «Up to 0 SOL: the rest pays the network.»
   and «You have 0 USDC. Type that or less.»; Limit and Stop kept a dead button. */

test("the top-up is offered to a connected wallet that buys with nothing, and to no one else", () => {
  const empty = { connected: true, side: "buy", max: "0", moneyOpen: true };
  assert.equal(offersTopUp(empty), true);
  assert.equal(offersTopUp({ ...empty, connected: false }), false, "a guest connects first");
  assert.equal(offersTopUp({ ...empty, side: "sell" }), false, "an empty Sell has its own line");
  assert.equal(offersTopUp({ ...empty, max: "1" }), false, "the smallest balance still trades");
  assert.equal(offersTopUp({ ...empty, max: null }), false, "a balance not read yet is unknown, never empty");
  assert.equal(offersTopUp({ ...empty, moneyOpen: false }), false, "with Money shut there is nowhere to send the person");
});

test("beside «Add…» the balance's own sentence is not said; any other fault of the amount stays", () => {
  const balance = { kind: "balance", text: "Up to 0 SOL: the rest pays the network." };
  const format = { kind: "format", text: "Type a number, like 2.5." };
  assert.equal(problemLine(balance, true), null);
  assert.equal(problemLine(balance, false), balance.text, "a wallet with something in it is told how much");
  assert.equal(problemLine(format, true), format.text);
  assert.equal(problemLine({ kind: "zero", text: "Type an amount above zero." }, true), "Type an amount above zero.");
  assert.equal(problemLine(null, true), null);
  assert.equal(problemLine(undefined, false), null);
});

test("the market ticket, the limit and the stop all ask the one rule and open Money's top-up", () => {
  const market = read("../../components/trade/TradeSheet.tsx");
  const spot = read("../../components/trade/SpotTicket.tsx");
  for (const [name, file] of [["market", market], ["limit and stop", spot]]) {
    assert.match(file, /offersTopUp\(\{ connected: Boolean\(connection\), side, max: choice\.sizing\.max, moneyOpen: MONEY_OPEN \}\)/u, `${name}: the one rule`);
    assert.match(file, /onClick=\{\(\) => openMoney\('topup'\)\}/u, `${name}: Money's top-up`);
    assert.match(file, /problemLine\(/u, `${name}: the line beside the action`);
  }
  // The same words on all three: «Add SOL», «Add USDC».
  assert.match(spot, /\{t\.addOf\(unit\)\}/u);
  assert.match(market, /\{w\.addOf\(choice\.spendUnit\)\}/u);
  // The limit's and the stop's order is built as before: the rule only chooses the button and the line.
  assert.match(spot, /await useSpot\.getState\(\)\.placeOrder\(intent, \{ coin, unit \}\)/u);
  assert.match(spot, /await useSpot\.getState\(\)\.setStop\(/u);
});
