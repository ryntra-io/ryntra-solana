import { test } from "node:test";
import assert from "node:assert/strict";

import { notionalMicroOf } from "../../../lib/phoenix/orders-model.ts";
import { ticketUrl } from "./engine.ts";
import { cancelAllBody, cancelBody, closeBody, decimalText, draftFor, draftIssue, feeBpsOf, figuresKeyOf, legTicksOf, maxKeyOf, microOf, newDraft, openBody, protectBody, protectIssue, sizeLotsOf, ticketQuery } from "./ticket.ts";
import { orderRows } from "./account.ts";
import { account, BTC, OWNER, PUMP, SOL } from "./test-fixtures.mjs";

const UNITS = { tickSize: SOL.tickSize, baseLotsDecimals: SOL.baseLotsDecimals };
const draft = (changes = {}) => ({ ...newDraft(), ...changes });

test("a draft starts with no side and a careful two times, and keeps the side on another market", () => {
  const fresh = newDraft();
  assert.equal(fresh.side, null);
  assert.equal(fresh.leverage, 2);
  assert.equal(fresh.type, "market");
  const moved = draftFor(PUMP, draft({ side: "short", leverage: 20, size: { kind: "usd", text: "40" }, price: "1" }));
  assert.equal(moved.side, "short");
  assert.equal(moved.leverage, 2);
  assert.deepEqual(moved.size, { kind: "usd", text: "" });
  assert.equal(moved.price, "");
});

test("typed dollars become lots at the price the engine counts them at, never worth more than typed", () => {
  // A market long counts at its worst price: $150 moved 0.5 % up is $150.75, 15075 ticks. $30 buys 199 lots of 0.001.
  const long = sizeLotsOf(draft({ side: "long", size: { kind: "usd", text: "30" } }), SOL, null);
  assert.equal(long, 199n);
  assert.ok(notionalMicroOf(long, 15_075n, UNITS) <= 30_000_000n);
  // With no side yet it is counted as a long: the higher price, the smaller size.
  assert.equal(sizeLotsOf(draft({ size: { kind: "usd", text: "30" } }), SOL, null), 199n);
  // A market short sells at the book: counted at the mark, as the engine does.
  const short = sizeLotsOf(draft({ side: "short", size: { kind: "usd", text: "30" } }), SOL, null);
  assert.equal(short, 200n);
  assert.equal(notionalMicroOf(short, 15_000n, UNITS), 30_000_000n);
  // The first check's ceiling typed exactly stays under it.
  assert.ok(notionalMicroOf(sizeLotsOf(draft({ side: "long", size: { kind: "usd", text: "20" } }), SOL, null), 15_075n, UNITS) <= 20_000_000n);
  // A thousand-dollar BTC long at $67,000 moved to $67,335: 148 lots of 0.0001.
  assert.equal(sizeLotsOf(draft({ side: "long", size: { kind: "usd", text: "1 000" } }), BTC, null), 148n);
  // Negative decimals: a PUMP lot is a hundred coins; at the mark a short's $21 is 50 lots.
  assert.equal(sizeLotsOf(draft({ side: "short", size: { kind: "usd", text: "21" } }), PUMP, null), 50n);
});

test("a comma is a decimal mark, never a thousands separator read as one", () => {
  assert.equal(decimalText("0,5"), "0.5");
  assert.equal(decimalText("30,15"), "30.15");
  assert.equal(decimalText(" 1 000 "), "1000");
  for (const text of ["1,000", "30,149", "12,500", "1,000,000", "1,000.5", "1.5,2", "1,2,3"]) assert.equal(decimalText(text), null, text);
  // A stop typed as «1,000» is no price at all, never a $1 stop.
  assert.equal(legTicksOf("long", "", "1,000", UNITS).bad, "sl");
  assert.equal(microOf("1,000"), null);
});

test("a limit counts the size at its own price, and nothing comes of text that is not an amount", () => {
  assert.equal(sizeLotsOf(draft({ type: "limit", side: "long", price: "100", size: { kind: "usd", text: "30" } }), SOL, null), 300n);
  // A short's limit under the mark is counted at the mark: the book may fill it there.
  assert.equal(sizeLotsOf(draft({ type: "limit", side: "short", price: "100", size: { kind: "usd", text: "30" } }), SOL, null), 200n);
  assert.equal(sizeLotsOf(draft({ type: "limit", side: "short", price: "160", size: { kind: "usd", text: "32" } }), SOL, null), 200n);
  for (const text of ["", "abc", "-5", "1e3", "0", "0.0000001"]) assert.equal(sizeLotsOf(draft({ size: { kind: "usd", text } }), SOL, null), null, text);
  assert.equal(sizeLotsOf(draft({ size: { kind: "usd", text: "30" } }), { ...SOL, markPrice: null }, null), null);
  assert.equal(sizeLotsOf(draft({ size: { kind: "usd", text: "30" } }), { ...SOL, tickSize: null }, null), null);
});

test("a share is that part of the engine's most at this leverage, and waits for it", () => {
  assert.equal(sizeLotsOf(draft({ size: { kind: "share", percent: 25 } }), SOL, "13000"), 3250n);
  assert.equal(sizeLotsOf(draft({ size: { kind: "share", percent: 100 } }), SOL, "13000"), 13000n);
  assert.equal(sizeLotsOf(draft({ size: { kind: "share", percent: 50 } }), SOL, null), null);
  assert.equal(sizeLotsOf(draft({ size: { kind: "share", percent: 50 } }), SOL, "1"), null);
});

test("what stands before a Review: the side, a limit's price, the mark, a size, then TP/SL on their sides", () => {
  assert.equal(draftIssue(draft(), SOL, 200n), "SIDE");
  assert.equal(draftIssue(draft({ side: "long", type: "limit" }), SOL, 200n), "PRICE");
  assert.equal(draftIssue(draft({ side: "long" }), { ...SOL, markPrice: null }, 200n), "MARK");
  assert.equal(draftIssue(draft({ side: "long" }), SOL, null), "SIZE");
  assert.equal(draftIssue(draft({ side: "long" }), { ...SOL, baseLotsDecimals: null }, 200n), "UNITS");
  assert.equal(draftIssue(draft({ side: "long" }), SOL, 200n), null);
});

test("TP/SL: a long's take profit above the mark and its stop below, a short's the other way — the engine's own rule", () => {
  const long = (tp, sl) => draftIssue(draft({ side: "long", tpsl: true, tp, sl }), SOL, 200n);
  const short = (tp, sl) => draftIssue(draft({ side: "short", tpsl: true, tp, sl }), SOL, 200n);
  assert.equal(long("165", "140"), null);
  assert.equal(long("145", ""), "TP_SIDE");
  assert.equal(long("", "155"), "SL_SIDE");
  assert.equal(long("abc", ""), "TP_TEXT");
  assert.equal(long("", "x"), "SL_TEXT");
  assert.equal(short("140", "160"), null);
  assert.equal(short("160", ""), "TP_SIDE");
  assert.equal(short("", "140"), "SL_SIDE");
  // Switched off, the typed legs are not looked at.
  assert.equal(draftIssue(draft({ side: "long", tpsl: false, tp: "1", sl: "999" }), SOL, 200n), null);
});

test("TP/SL ticks round towards the mark: a take profit a hair nearer, a stop a hair sooner", () => {
  // $0.01 ticks: 165.005 is between 16500 and 16501.
  assert.deepEqual(legTicksOf("long", "165.005", "139.995", UNITS), { tp: 16500n, sl: 14000n, bad: null });
  assert.deepEqual(legTicksOf("short", "134.995", "160.005", UNITS), { tp: 13500n, sl: 16000n, bad: null });
  assert.deepEqual(legTicksOf("long", "", "", UNITS), { tp: null, sl: null, bad: null });
  assert.equal(legTicksOf("long", "nope", "", UNITS).bad, "tp");
});

test("a market order goes all at once within its tolerance, with its TP/SL in ticks", () => {
  const body = openBody(OWNER, SOL, draft({ side: "long", leverage: 5, size: { kind: "usd", text: "30" }, tpsl: true, tp: "165", sl: "140" }), 200n);
  assert.deepEqual(body, { kind: "open", owner: OWNER, symbol: "SOL", side: "long", type: "market", tif: "fok", size: "200", slippageBps: 50, tp: "16500", sl: "14000" });
  // A wallet that signs v1 gets that format.
  assert.equal(openBody(OWNER, SOL, draft({ side: "long", size: { kind: "usd", text: "30" } }), 200n, true).format, "v1");
});

test("a limit rests at its price, never with a tolerance or TP/SL; a draft with an issue builds nothing", () => {
  const body = openBody(OWNER, SOL, draft({ side: "short", type: "limit", price: "160.004", size: { kind: "usd", text: "32" }, tpsl: true, tp: "150" }), 200n);
  // A short's limit rounds up: never sold under the typed price.
  assert.deepEqual(body, { kind: "open", owner: OWNER, symbol: "SOL", side: "short", type: "limit", tif: "gtc", size: "200", price: "16001" });
  assert.equal(openBody(OWNER, SOL, draft({ side: "long", type: "limit", price: "150.009", size: { kind: "usd", text: "30" } }), 200n).price, "15000");
  assert.equal(openBody(OWNER, SOL, draft(), 200n), null);
  assert.equal(openBody(OWNER, SOL, draft({ side: "long" }), null), null);
});

test("a close names no size of the page's: the engine closes what Phoenix holds", () => {
  assert.deepEqual(closeBody(OWNER, "SOL"), { kind: "reduce", owner: OWNER, symbol: "SOL", size: "1", close: true, slippageBps: 50 });
});

test("a position's TP/SL are set anew, both empty lifts them, and their sides are checked at the mark", () => {
  assert.deepEqual(protectBody(OWNER, SOL, "long", "170", "135"), { kind: "protect", owner: OWNER, symbol: "SOL", tp: "17000", sl: "13500" });
  assert.deepEqual(protectBody(OWNER, SOL, "long", "", ""), { kind: "protect", owner: OWNER, symbol: "SOL", tp: null, sl: null });
  assert.equal(protectBody(OWNER, SOL, "long", "x", ""), null);
  assert.equal(protectIssue("long", SOL, "170", "135"), null);
  assert.equal(protectIssue("long", SOL, "140", ""), "TP_SIDE");
  assert.equal(protectIssue("short", SOL, "", "140"), "SL_SIDE");
  assert.equal(protectIssue("long", { ...SOL, markPrice: null }, "", ""), null);
  assert.equal(protectIssue("long", { ...SOL, markPrice: null }, "170", ""), "MARK");
});

test("the ticket's question is the route's: lots and ticks, the leverage within the market, the fees in bps", () => {
  const query = ticketQuery(OWNER, SOL, draft({ side: "long", leverage: 50 }), 200n, feeBpsOf(SOL, 2));
  assert.deepEqual(query, { wallet: OWNER, symbol: "SOL", side: "long", type: "market", leverage: 20, slippageBps: 50, feeBps: 5.5, sizeLots: "200", limitTicks: null, reduceOnly: false });
  const url = new URL(ticketUrl(query), "https://ryntra.io");
  assert.equal(url.pathname, "/api/solana/futures/ticket");
  assert.deepEqual(Object.fromEntries(url.searchParams), { wallet: OWNER, symbol: "SOL", side: "long", type: "market", leverage: "20", slippageBps: "50", feeBps: "5.5", size: "200" });
  // No wallet, no side, or a limit without its price: nothing to ask.
  assert.equal(ticketQuery(null, SOL, draft({ side: "long" }), 200n, 0), null);
  assert.equal(ticketQuery(OWNER, SOL, draft(), 200n, 0), null);
  assert.equal(ticketQuery(OWNER, SOL, draft({ side: "long", type: "limit" }), 200n, 0), null);
  // The most is keyed by the question without its size.
  const without = { ...query, sizeLots: null };
  assert.equal(maxKeyOf(query), maxKeyOf(without));
  assert.notEqual(figuresKeyOf(query), figuresKeyOf(without));
  assert.equal(feeBpsOf({ takerRate: null }, null), 0);
});

test("a cancel names the order as the engine lists it: a plain one by its number, a TP/SL leg by its index, or all of a market", () => {
  const [plain, leg] = orderRows(account());
  assert.deepEqual(cancelBody(OWNER, plain), { kind: "cancel", owner: OWNER, symbol: "SOL", order: "101" });
  // The leg of a position's TP/SL goes with its pair: the conditional index, never a sequence number.
  assert.deepEqual(cancelBody(OWNER, leg, true), { kind: "cancelConditional", owner: OWNER, symbol: "SOL", index: 3, format: "v1" });
  // A row that cannot be named alone builds nothing: «Cancel all» of its market still takes it.
  assert.equal(cancelBody(OWNER, { symbol: "SOL", cancel: null }), null);
  assert.deepEqual(cancelAllBody(OWNER, "SOL"), { kind: "cancelAll", owner: OWNER, symbol: "SOL" });
});
