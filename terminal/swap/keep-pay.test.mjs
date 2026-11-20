import assert from "node:assert/strict";
import test from "node:test";
import { createEngine } from "../../city/lib/trade/engine.ts";
import { choiceOf, setTradeEnv, useTrade } from "../../city/lib/trade/store.ts";
import { SOL, USDC } from "../../city/lib/trade/tiles.ts";
import { pickSubject, putFill, useSwapScreen } from "./state.ts";
import { pickPlan, subjectCarry } from "./swap-view.ts";

// Picking a coin on the Swap screen (release check 19.11: 25 USDC became 25 SOL when «You get» changed). The screen's own
// steps over the real trade card: the plan of the pick, what the new coin carries, the card opening on it as the screen's
// ticket does (`useTicket`), and the carried fill written into it. Nothing is priced, ordered or signed.

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const HOLDINGS = {
  owner: TAKER,
  sol: { spendableRaw: "2410000000", decimals: 9 },
  tokens: new Map([
    [JUP, { spendableRaw: "5000000000", decimals: 6 }],
    [USDC.mint, { spendableRaw: "84200000", decimals: 6 }],
  ]),
  complete: true,
};
const coin = (mint, symbol) => ({ mint, symbol, decimals: null, name: symbol, icon: null });
const JUP_ASSET = { mint: JUP, symbol: "JUP", decimals: 6, name: "Jupiter", icon: null };

function scene() {
  const engine = createEngine(async () => ({ ok: false, status: 503, json: async () => ({ error: { code: "UNAVAILABLE" } }) }), { wait: async () => {}, timers: { set: () => 0, clear: () => {} } });
  const wallet = { connection: { wallet: "Phantom", address: TAKER }, holdings: HOLDINGS };
  setTradeEnv({ engine, sign: async () => ({ ok: false, reason: "no" }), wallet: () => wallet, refreshHoldings: () => {}, sleep: async () => {}, now: () => 1_000 });
  useTrade.setState({ open: false, tower: null, phase: "idle", held: false, pay: "SOL", other: null, typed: "", review: null, done: null, failed: null, unknown: null });
  useSwapScreen.setState({ subject: { id: SOL.mint, symbol: "SOL", name: "Solana", icon: null }, side: "buy", fill: null });
}

/** The screen on a coin and side, as its ticket opens it. */
function openOn(mint, symbol, side = "buy") {
  useSwapScreen.setState({ subject: { id: mint, symbol, name: symbol, icon: null }, side, fill: null });
  useTrade.getState().openFor({ id: mint, symbol, name: symbol, icon: null }, side, { view: "swap" });
}

/** What the screen shows: the coin on each field and the amount typed. */
function shown() {
  const card = useTrade.getState();
  const choice = choiceOf(card.tower, card.side, HOLDINGS, { pay: card.pay, typed: card.typed, other: card.other });
  const pay = card.side === "buy" ? choice.pay.mint : card.tower.mint;
  const get = card.side === "buy" ? card.tower.mint : choice.pay.mint;
  return { pay, get, typed: card.typed, side: card.side };
}

/** A coin picked into a field, as `pickInto` does it, then the card following the screen's coin. */
function pick(field, picked) {
  const card = useTrade.getState();
  const choice = choiceOf(card.tower, card.side, HOLDINGS, { pay: card.pay, typed: card.typed, other: card.other });
  const plan = pickPlan({ side: card.side, subject: card.tower.mint, counter: choice.pay.mint, field, picked });
  if (plan.kind === "subject") {
    pickSubject({ id: picked.mint, symbol: picked.symbol, name: picked.name, icon: null }, plan.side, subjectCarry({ field, typed: card.typed, counter: choice.pay }), 1_000);
    const screen = useSwapScreen.getState();
    useTrade.getState().openFor(screen.subject, screen.side, { view: "swap" });
    assert.equal(putFill(screen.fill, 1_000), true);
  } else if (plan.kind === "counter") useTrade.getState().pickCoin(plan.asset);
  return plan.kind;
}

test("25 USDC for SOL, «You get» changed to JUP: still 25 USDC — the coin SOL's ticket showed by default stays", () => {
  scene();
  openOn(SOL.mint, "SOL");
  useTrade.getState().setTyped("25");
  assert.deepEqual(shown(), { pay: USDC.mint, get: SOL.mint, typed: "25", side: "buy" });
  assert.equal(useTrade.getState().pay, "SOL", "the card keeps «SOL» and shows USDC — the trap");
  assert.equal(pick("get", coin(JUP, "JUP")), "subject");
  assert.deepEqual(shown(), { pay: USDC.mint, get: JUP, typed: "25", side: "buy" });
});

test("0.5 SOL for JUP, «You get» changed to BONK: still 0.5 SOL", () => {
  scene();
  openOn(JUP, "JUP");
  useTrade.getState().setPay("SOL");
  useTrade.getState().setTyped("0.5");
  pick("get", coin(BONK, "Bonk"));
  assert.deepEqual(shown(), { pay: SOL.mint, get: BONK, typed: "0.5", side: "buy" });
});

test("100 JUP (a wallet coin) for BONK, «You get» changed to WIF: still 100 JUP", () => {
  scene();
  openOn(BONK, "Bonk");
  useTrade.getState().pickCoin(JUP_ASSET);
  useTrade.getState().setTyped("100");
  assert.deepEqual(shown(), { pay: JUP, get: BONK, typed: "100", side: "buy" });
  pick("get", coin(WIF, "WIF"));
  assert.deepEqual(shown(), { pay: JUP, get: WIF, typed: "100", side: "buy" });
});

test("nothing typed, «You get» changed: the coin that pays stays all the same", () => {
  scene();
  openOn(SOL.mint, "SOL");
  pick("get", coin(JUP, "JUP"));
  const now = shown();
  assert.equal(now.pay, USDC.mint);
  assert.equal(now.get, JUP);
});

test("mirror — selling: «You pay» changed to JUP keeps «You get» (USDC) and starts JUP's own amount, never the same digits", () => {
  scene();
  openOn(SOL.mint, "SOL", "sell");
  useTrade.getState().setTyped("1");
  assert.deepEqual(shown(), { pay: SOL.mint, get: USDC.mint, typed: "1", side: "sell" });
  assert.equal(pick("pay", coin(JUP, "JUP")), "subject");
  const now = shown();
  assert.equal(now.pay, JUP);
  assert.equal(now.get, USDC.mint);
  assert.equal(now.side, "sell");
  assert.notEqual(now.typed, "1");
});

test("mirror — buying: «You pay» changed to SOL keeps «You get» (JUP) and starts SOL's own amount", () => {
  scene();
  openOn(JUP, "JUP");
  useTrade.getState().setPay("USDC");
  useTrade.getState().setTyped("25");
  assert.equal(pick("pay", SOL), "counter");
  const now = shown();
  assert.equal(now.pay, SOL.mint);
  assert.equal(now.get, JUP);
  assert.notEqual(now.typed, "25");
});

test("the coin that pays picked for «You get»: the two change places (the flip), nothing else moves", () => {
  scene();
  openOn(SOL.mint, "SOL");
  useTrade.getState().setTyped("25");
  assert.equal(pick("get", USDC), "flip");
  assert.equal(pick("pay", SOL), "flip");
  // The flip itself is the card's side switch, carrying the value the screen showed (`carriedAmount`): here 0.34 SOL.
  useTrade.getState().setSide("sell", "0.34");
  assert.deepEqual(shown(), { pay: SOL.mint, get: USDC.mint, typed: "0.34", side: "sell" });
  useTrade.getState().setSide("buy", "25");
  assert.deepEqual(shown(), { pay: USDC.mint, get: SOL.mint, typed: "25", side: "buy" });
});

test("subjectCarry: the shown coin by its key, the amount only from «You get»'s pick", () => {
  assert.deepEqual(subjectCarry({ field: "get", typed: "25", counter: USDC }), { pay: "USDC", other: null, amount: "25" });
  assert.deepEqual(subjectCarry({ field: "pay", typed: "25", counter: USDC }), { pay: "USDC", other: null, amount: null });
  assert.deepEqual(subjectCarry({ field: "get", typed: "", counter: SOL }), { pay: "SOL", other: null, amount: null });
  assert.deepEqual(subjectCarry({ field: "get", typed: "0", counter: SOL }), { pay: "SOL", other: null, amount: null });
  assert.deepEqual(subjectCarry({ field: "get", typed: "100", counter: JUP_ASSET }), { pay: JUP, other: JUP_ASSET, amount: "100" });
});

test("a hand pick's carry waits for the card as long as it takes — a result read for minutes first does not make the coin jump", () => {
  scene();
  openOn(SOL.mint, "SOL");
  useTrade.getState().setTyped("25");
  const card = useTrade.getState();
  const choice = choiceOf(card.tower, card.side, HOLDINGS, { pay: card.pay, typed: card.typed, other: card.other });
  pickSubject({ id: JUP, symbol: "JUP", name: "JUP", icon: null }, "buy", subjectCarry({ field: "get", typed: card.typed, counter: choice.pay }), 1_000);
  const fill = useSwapScreen.getState().fill;
  useTrade.getState().openFor({ id: JUP, symbol: "JUP", name: "JUP", icon: null }, "buy", { view: "swap" });
  assert.equal(putFill(fill, 1_000 + 10 * 60_000), true);
  assert.deepEqual(shown(), { pay: USDC.mint, get: JUP, typed: "25", side: "buy" });
});
