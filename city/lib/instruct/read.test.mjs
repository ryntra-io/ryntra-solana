import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, SOL_COIN } from "../command/parse.ts";
import { coinChoices, readInstruction } from "./read.ts";
import { missingOf } from "./types.ts";

/* CITY-176: the agent reads one sentence into a standing instruction — and only what it is sure of. */

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const FAKE_MINT = "Fake1111111111111111111111111111111111111111";

const tower = (id, symbol, mcap, extra = {}) => ({ id, symbol, name: symbol === "JUP" ? "Jupiter" : symbol, icon: null, mcap, liquidity: 1e6, verified: true, ...extra });
const BOOK = bookOf([tower(JUP_MINT, "JUP", 1e9), tower(BONK_MINT, "BONK", 2e9), tower(WIF_MINT, "WIF", 5e8), tower(FAKE_MINT, "XYZ", 9e9, { verified: false })]);
const JUP = BOOK.coins.find((c) => c.mint === JUP_MINT);
const BONK = BOOK.coins.find((c) => c.mint === BONK_MINT);
const WIF = BOOK.coins.find((c) => c.mint === WIF_MINT);
const NONE = { subject: null };

const read = (text, context = NONE) => readInstruction(text, BOOK, context);
const pick = (i, keys) => (i ? Object.fromEntries(keys.map((k) => [k, i[k]])) : i);
const recurring = (text, context) => pick(read(text, context), ["kind", "coin", "usd", "cadence", "weekday", "time", "options"]);
const order = (text, context) => pick(read(text, context), ["kind", "mode", "side", "coin", "trigger", "usd", "share", "count", "options"]);
const R = (coin, usd, cadence, weekday = null, options = {}, time = null) => ({ kind: "recurring", coin, usd, cadence, weekday, time, options });
const O = (mode, side, coin, trigger, size = {}, options = {}) => ({ kind: "order", mode, side, coin, trigger, usd: size.usd ?? null, share: size.share ?? null, count: size.count ?? null, options });
const price = (p) => ({ kind: "price", price: p });
const move = (pct) => ({ kind: "move", pct });

test("regular purchases: the coin, the dollars and how often — English and Ukrainian", () => {
  assert.deepEqual(recurring("купуй SOL на $20 щотижня"), R(SOL_COIN, "20", "weekly"));
  assert.deepEqual(recurring("buy $20 of SOL every week"), R(SOL_COIN, "20", "weekly"));
  assert.deepEqual(recurring("buy SOL weekly for 20"), R(SOL_COIN, "20", "weekly"));
  assert.deepEqual(recurring("щодня купуй JUP на 5 доларів"), R(JUP, "5", "daily"));
  assert.deepEqual(recurring("every day buy $5 of BONK"), R(BONK, "5", "daily"));
  assert.deepEqual(recurring("щомісяця купувати SOL на 100"), R(SOL_COIN, "100", "monthly"));
  assert.deepEqual(recurring("dca $50 into SOL weekly"), R(SOL_COIN, "50", "weekly"));
  assert.deepEqual(recurring("купуй WIF на 10 доларів кожного тижня"), R(WIF, "10", "weekly"));
  assert.deepEqual(recurring("buy JUP once a month for $25"), R(JUP, "25", "monthly"));
  assert.deepEqual(recurring("інвестуй $15 у SOL щодня"), R(SOL_COIN, "15", "daily"));
});

test("a weekday and a time said are kept: «every Monday», «щопонеділка», «о 09:30»", () => {
  assert.deepEqual(recurring("buy JUP every monday for $10"), R(JUP, "10", "weekly", 1));
  assert.deepEqual(recurring("щопонеділка купуй SOL на 10"), R(SOL_COIN, "10", "weekly", 1));
  assert.deepEqual(recurring("купуй SOL на $20 щотижня в пʼятницю"), R(SOL_COIN, "20", "weekly", 5));
  assert.deepEqual(recurring("buy $10 of SOL every friday at 09:30"), R(SOL_COIN, "10", "weekly", 5, {}, "09:30"));
});

test("a regular purchase with something missing or said two ways leaves it for the taps", () => {
  assert.deepEqual(recurring("купуй SOL щотижня"), R(SOL_COIN, null, "weekly"));
  assert.equal(missingOf(read("купуй SOL щотижня")), "size");
  assert.deepEqual(recurring("купуй SOL регулярно на $20"), R(SOL_COIN, "20", null));
  assert.equal(missingOf(read("купуй SOL регулярно на $20")), "cadence");
  assert.deepEqual(recurring("buy SOL daily and weekly for 10"), R(SOL_COIN, "10", null, null, { cadences: ["daily", "weekly"] }));
  assert.deepEqual(recurring("купуй щотижня на $20"), R(null, "20", "weekly"));
  assert.equal(missingOf(read("купуй щотижня на $20")), "coin");
  // Over JUP's window, «every week for $20» means JUP.
  assert.deepEqual(recurring("купуй щотижня на $20", { subject: JUP }), R(JUP, "20", "weekly"));
});

test("money the agent does not take, and numbers that could mean two things, are never guessed into dollars", () => {
  assert.equal(read("buy SOL every week for 50 eur").usd, null);
  assert.equal(read("купуй SOL на 50 гривень щотижня").usd, null);
  assert.equal(read("купуй SOL на 1,000 щотижня").usd, null);
  assert.deepEqual(recurring("buy 2 SOL every week"), R(SOL_COIN, null, "weekly"), "a count of the coin is not what is paid");
  assert.equal(read("buy SOL every week for 0.5 sol").usd, null, "a regular purchase is paid in dollars");
});

test("limits: a buy below the price, a sale above it — with the price or the move said", () => {
  assert.deepEqual(order("купи JUP, якщо впаде до 0,7"), O("limit", "buy", JUP, price("0.7")));
  assert.equal(missingOf(read("купи JUP, якщо впаде до 0,7")), "size");
  assert.deepEqual(order("buy JUP if it drops to $0.7 for 50"), O("limit", "buy", JUP, price("0.7"), { usd: "50" }));
  assert.deepEqual(order("купи JUP на $50, якщо впаде до 0,7"), O("limit", "buy", JUP, price("0.7"), { usd: "50" }));
  assert.deepEqual(order("buy BONK if it dips 10%"), O("limit", "buy", BONK, move(10)));
  assert.deepEqual(order("продай WIF, якщо виросте до 3,5"), O("limit", "sell", WIF, price("3.5")));
  assert.deepEqual(order("sell half my JUP when it rises 20%"), O("limit", "sell", JUP, move(20), { share: 50 }));
  assert.deepEqual(order("limit buy BONK 0.00002"), O("limit", "buy", BONK, price("0.00002")));
  assert.deepEqual(order("take profit on WIF at 4"), O("limit", "sell", WIF, price("4")));
  assert.deepEqual(order("купи SOL на 100 доларів, якщо подешевшає на 5 %"), O("limit", "buy", SOL_COIN, move(5), { usd: "100" }));
});

test("stops: a sale below the price, a buy above it — the owner's examples first", () => {
  assert.deepEqual(order("продай половину BONK, якщо впаде на 10 %"), O("stop", "sell", BONK, move(10), { share: 50 }));
  assert.deepEqual(order("стоп на JUP по 0,8"), O("stop", "sell", JUP, price("0.8")));
  assert.equal(missingOf(read("стоп на JUP по 0,8")), "size");
  assert.deepEqual(order("stop loss on all my WIF at 2.5"), O("stop", "sell", WIF, price("2.5"), { share: 100 }));
  assert.deepEqual(order("sell 100 JUP if it falls below 0.6"), O("stop", "sell", JUP, price("0.6"), { count: "100" }));
  assert.deepEqual(order("купи SOL на $30, якщо виросте до 200"), O("stop", "buy", SOL_COIN, price("200"), { usd: "30" }));
  assert.deepEqual(order("stop on JUP at -10%"), O("stop", "sell", JUP, move(10)));
  assert.deepEqual(order("продай усе WIF якщо впаде на 15 відсотків"), O("stop", "sell", WIF, move(15), { share: 100 }));
  assert.deepEqual(order("стоп на JUP"), O("stop", "sell", JUP, null));
  assert.equal(missingOf(read("стоп на JUP")), "trigger");
});

test("said without a direction or with two prices: the price now decides, or the taps offer exactly what was said", () => {
  assert.deepEqual(order("sell JUP when it hits 1.2"), O(null, "sell", JUP, price("1.2")));
  assert.deepEqual(order("купи JUP якщо впаде до 0.7 або 0.6"), O("limit", "buy", JUP, null, {}, { prices: ["0.7", "0.6"] }));
  assert.equal(missingOf(read("купи JUP якщо впаде до 0.7 або 0.6")), "trigger");
  assert.equal(read("buy JUP when it moves 10%").trigger, null, "a move without its direction is asked for");
  assert.deepEqual(order("sell JUP at 1.5 limit"), O("limit", "sell", JUP, price("1.5")));
  assert.deepEqual(order("sell 2 sol if it drops to 120"), O("stop", "sell", SOL_COIN, price("120"), { count: "2" }));
  assert.deepEqual(order("buy JUP if it drops"), O("limit", "buy", JUP, null));
});

test("not a standing instruction: plain trades, questions, refusals, conditions without an action, agents", () => {
  for (const text of [
    "buy SOL for 50",
    "sell all JUP",
    "купити SOL на 50",
    "my portfolio",
    "чи варто купувати SOL щотижня?",
    "should I buy JUP if it drops?",
    "не купуй SOL щотижня",
    "never sell JUP if it drops",
    "sell JUP unless it rises",
    "if JUP drops to 0.7",
    "продавай SOL щотижня",
    "buy JUP every week if it drops",
    "запусти бота, який купує SOL щотижня",
    "",
  ]) {
    assert.equal(read(text), null, text);
  }
});

test("a ticker the city has no tower for is never replaced by another coin — not even the one on screen", () => {
  assert.equal(read("купуй XYZ щотижня на $10"), null, "an unverified copy's ticker is not a coin");
  assert.equal(read("buy $MOON if it drops 10%", { subject: JUP }), null);
  assert.equal(read("стоп на ABCD по 0,8", { subject: JUP }), null);
  // Two coins to buy in one sentence is two instructions: Ryntra's to answer.
  assert.equal(read("buy JUP and BONK every week for $10"), null);
});

test("shouting and a coin's own name read the same as the ticker", () => {
  assert.deepEqual(recurring("BUY $20 OF SOL EVERY WEEK"), R(SOL_COIN, "20", "weekly"));
  assert.deepEqual(order("STOP ON JUP AT 0.8"), O("stop", "sell", JUP, price("0.8")));
  assert.deepEqual(recurring("купуй jupiter на $10 щотижня"), R(JUP, "10", "weekly"));
});

test("the coins offered when none was said: the one on screen first, then SOL and the city's best — never USDC", () => {
  assert.deepEqual(coinChoices(BOOK, NONE).map((c) => c.symbol), ["SOL", "BONK", "JUP", "WIF"]);
  assert.deepEqual(coinChoices(BOOK, { subject: WIF }).map((c) => c.symbol), ["WIF", "SOL", "BONK", "JUP"]);
});

test("the sentence is kept as said, cut to one line", () => {
  assert.equal(read("  купуй SOL на $20 щотижня ").said, "купуй SOL на $20 щотижня");
  assert.ok(read(`купуй SOL на $20 щотижня ${"x".repeat(300)}`) === null || read(`купуй SOL на $20 щотижня ${"x".repeat(300)}`).said.length <= 140);
});
