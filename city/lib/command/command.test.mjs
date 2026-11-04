import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aboutSubject, bookOf, cleanNumber, COMMAND_MAX, fit, keyOf, parse, ROWS_MAX, SOL_COIN, suggest, USDC_COIN } from "./parse.ts";
import { DOORS, run } from "./run.ts";
import { isCommandKey, typingIn } from "./keys.ts";

/* CITY-85: the command line reads a sentence into a window and its fields — and nothing it reads ever signs. */

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const FAKE_MINT = "Fake1111111111111111111111111111111111111111";
const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const tower = (id, symbol, mcap, extra = {}) => ({
  id,
  symbol,
  name: symbol === "JUP" ? "Jupiter" : symbol,
  icon: "https://img/x.png",
  district: "core",
  price: 1,
  mcap,
  liquidity: 1e6,
  holders: 1,
  change5m: 0,
  change1h: 0,
  change24h: 0,
  volume24h: 0,
  traders1h: 0,
  organic: 90,
  verified: true,
  launchedAt: null,
  ...extra,
});

const TOWERS = [
  tower(JUP_MINT, "JUP", 1e9),
  tower(BONK_MINT, "BONK", 2e9),
  tower(WIF_MINT, "WIF", 5e8),
  // A copy with a famous ticker that Jupiter did not verify: never named, never bought by a word.
  tower(FAKE_MINT, "JUP", 9e9, { verified: false }),
];
const BOOK = bookOf(TOWERS);
const JUP = BOOK.coins.find((c) => c.mint === JUP_MINT);
const BONK = BOOK.coins.find((c) => c.mint === BONK_MINT);
const WIF = BOOK.coins.find((c) => c.mint === WIF_MINT);
const NONE = { subject: null };
const ON_JUP = { subject: JUP };
const OPEN = { trade: true, spot: true, money: true, earn: true, launch: true };

const read = (text, context = NONE) => parse(text, BOOK, context);

test("the book names only verified towers, best market first, with SOL and USDC always in it", () => {
  assert.deepEqual(
    BOOK.coins.map((c) => c.symbol),
    ["BONK", "JUP", "WIF", "SOL", "USDC"],
  );
  assert.equal(JUP.tower, true);
  assert.equal(JUP.icon, `/api/icon/${JUP_MINT}`);
  assert.ok(!BOOK.coins.some((c) => c.mint === FAKE_MINT), "an unverified copy is never in the book");
});

test("buying: the amount is what is paid, a bare number is dollars — the owner's examples first", () => {
  assert.deepEqual(read("купити SOL на 50"), { kind: "buy", coin: SOL_COIN, view: "spot", amount: "50", pay: "USDC", share: null });
  assert.deepEqual(read("buy SOL for 50"), { kind: "buy", coin: SOL_COIN, view: "spot", amount: "50", pay: "USDC", share: null });
  assert.deepEqual(read("buy $50 of JUP"), { kind: "buy", coin: JUP, view: "spot", amount: "50", pay: "USDC", share: null });
  assert.deepEqual(read("Купи JUP на 20 доларів"), { kind: "buy", coin: JUP, view: "spot", amount: "20", pay: "USDC", share: null });
  assert.deepEqual(read("buy jup for 0.5 sol"), { kind: "buy", coin: JUP, view: "spot", amount: "0.5", pay: "SOL", share: null });
  assert.deepEqual(read("купи bonk на 0,25 SOL"), { kind: "buy", coin: BONK, view: "spot", amount: "0.25", pay: "SOL", share: null });
  assert.deepEqual(read("buy $JUP with usdc"), { kind: "buy", coin: JUP, view: "spot", amount: null, pay: "USDC", share: null });
  assert.deepEqual(read("I want to buy WIF for 15"), { kind: "buy", coin: WIF, view: "spot", amount: "15", pay: "USDC", share: null });
});

test("a count of the coin bought cannot stand in the field that says what is paid: it is left for the person", () => {
  assert.deepEqual(read("buy 100 JUP"), { kind: "buy", coin: JUP, view: "spot", amount: null, pay: null, share: null });
  assert.deepEqual(read("buy 50 SOL"), { kind: "buy", coin: SOL_COIN, view: "spot", amount: null, pay: null, share: null });
  assert.deepEqual(read("купити 2 сол"), { kind: "buy", coin: SOL_COIN, view: "spot", amount: null, pay: null, share: null });
});

test("selling: the amount is of the coin, a share is a share, dollars say what it is paid in and never how much", () => {
  assert.deepEqual(read("sell JUP 100"), { kind: "sell", coin: JUP, view: "spot", amount: "100", into: null, share: null });
  assert.deepEqual(read("sell 100 jup"), { kind: "sell", coin: JUP, view: "spot", amount: "100", into: null, share: null });
  assert.deepEqual(read("sell all JUP"), { kind: "sell", coin: JUP, view: "spot", amount: null, into: null, share: 100 });
  assert.deepEqual(read("продати половину WIF"), { kind: "sell", coin: WIF, view: "spot", amount: null, into: null, share: 50 });
  assert.deepEqual(read("sell 25% bonk"), { kind: "sell", coin: BONK, view: "spot", amount: null, into: null, share: 25 });
  assert.deepEqual(read("sell $50 of JUP"), { kind: "sell", coin: JUP, view: "spot", amount: null, into: "USDC", share: null });
  assert.deepEqual(read("sell jup into sol"), { kind: "sell", coin: JUP, view: "spot", amount: null, into: "SOL", share: null });
  assert.deepEqual(read("sell 2 sol"), { kind: "sell", coin: SOL_COIN, view: "spot", amount: "2", into: null, share: null });
});

test("stops and limits open the coin's Spot window, with the person's own price when said", () => {
  assert.deepEqual(read("стоп на JUP"), { kind: "order", mode: "stop", side: "sell", coin: JUP, price: null });
  assert.deepEqual(read("stop on JUP at $0.8"), { kind: "order", mode: "stop", side: "sell", coin: JUP, price: "0.8" });
  assert.deepEqual(read("стоп JUP по 0,8"), { kind: "order", mode: "stop", side: "sell", coin: JUP, price: "0.8" });
  assert.deepEqual(read("limit buy BONK 0.00002"), { kind: "order", mode: "limit", side: "buy", coin: BONK, price: "0.00002" });
  assert.deepEqual(read("sell WIF limit 3.5"), { kind: "order", mode: "limit", side: "sell", coin: WIF, price: "3.5" });
  assert.deepEqual(read("лімітка на JUP"), { kind: "order", mode: "limit", side: "buy", coin: JUP, price: null });
});

test("the swap: SOL or USDC in, the coin out — or the coin in, SOL or USDC out; the amount is of what is given", () => {
  assert.deepEqual(read("swap 1 SOL to JUP"), { kind: "buy", coin: JUP, view: "swap", amount: "1", pay: "SOL", share: null });
  assert.deepEqual(read("обміняти 100 JUP на USDC"), { kind: "sell", coin: JUP, view: "swap", amount: "100", into: "USDC", share: null });
  assert.deepEqual(read("swap usdc for sol"), { kind: "buy", coin: SOL_COIN, view: "swap", amount: null, pay: "USDC", share: null });
  assert.deepEqual(read("swap 2 sol"), { kind: "sell", coin: SOL_COIN, view: "swap", amount: "2", into: "USDC", share: null });
  assert.deepEqual(read("swap"), { kind: "buy", coin: SOL_COIN, view: "swap", amount: null, pay: null, share: null });
  assert.deepEqual(read("swap BONK to JUP"), { kind: "buy", coin: JUP, view: "swap", amount: null, pay: null, share: null });
});

test("money, earn, launch, the chart and a coin alone open their own windows", () => {
  for (const text of ["мій портфель", "my portfolio", "balance", "show my balances"]) assert.deepEqual(read(text), { kind: "money", place: "portfolio", send: null }, text);
  for (const text of ["history", "історія", "activity"]) assert.equal(read(text).place, "activity", text);
  for (const text of ["top up", "поповнити", "deposit", "receive"]) assert.equal(read(text).place, "topup", text);
  assert.equal(read("pay link").place, "paylink");
  assert.equal(read("bridge").place, "bridge");
  for (const text of ["earn", "пули", "staking"]) assert.deepEqual(read(text), { kind: "earn" }, text);
  assert.deepEqual(read("chart BONK"), { kind: "chart", coin: BONK });
  assert.deepEqual(read("графік jup"), { kind: "chart", coin: JUP });
  assert.deepEqual(read("JUP"), { kind: "coin", coin: JUP });
  assert.deepEqual(read("$bonk"), { kind: "coin", coin: BONK });
  assert.deepEqual(read(JUP_MINT), { kind: "coin", coin: JUP });
  assert.deepEqual(read(ADDRESS), { kind: "mint", mint: ADDRESS });
});

test("send: the recipient and the amount as said, the amount only beside its coin", () => {
  assert.deepEqual(read(`send 0.5 SOL to ${ADDRESS}`), { kind: "money", place: "send", send: { to: ADDRESS, amount: "0.5", asset: SOL_COIN } });
  assert.deepEqual(read(`надіслати 10 USDC на friend.skr`), { kind: "money", place: "send", send: { to: "friend.skr", amount: "10", asset: USDC_COIN } });
  assert.deepEqual(read(`send 5 to ${ADDRESS}`), { kind: "money", place: "send", send: { to: ADDRESS, amount: null, asset: null } });
  assert.deepEqual(read(`send 100 BONK to ${ADDRESS}`).send, { to: ADDRESS, amount: "100", asset: BONK });
});

test("the launch: the ticker and the name when said; «new launches» is a question, not a launch", () => {
  assert.deepEqual(read("launch"), { kind: "launch", symbol: null, name: null });
  assert.deepEqual(read("запусти мені токен"), { kind: "launch", symbol: null, name: null });
  assert.deepEqual(read("launch $MOON"), { kind: "launch", symbol: "MOON", name: null });
  assert.deepEqual(read("запусти токен Moon Cat $MOON"), { kind: "launch", symbol: "MOON", name: "Moon Cat" });
  assert.deepEqual(read("launch Moon"), { kind: "launch", symbol: "MOON", name: "Moon" });
  assert.deepEqual(read("create a meme coin"), { kind: "launch", symbol: null, name: null });
  assert.equal(read("нові запуски").kind, "ask");
  assert.equal(read("launch $TOOLONGTICKER1").symbol, null);
});

test("a price or what a sale brings in is never read as how much: «sell SOL for 50» does not sell 50 SOL", () => {
  assert.deepEqual(read("продай SOL на 50"), { kind: "sell", coin: SOL_COIN, view: "spot", amount: null, into: "USDC", share: null });
  assert.deepEqual(read("sell SOL for 50"), { kind: "sell", coin: SOL_COIN, view: "spot", amount: null, into: "USDC", share: null });
  assert.deepEqual(read("sell JUP for 100 WIF"), { kind: "sell", coin: JUP, view: "spot", amount: null, into: null, share: null }, "another coin's count");
  assert.deepEqual(read("sell JUP for 0.5 sol"), { kind: "sell", coin: JUP, view: "spot", amount: null, into: "SOL", share: null });
  // A price said beside «buy» or «sell» is a limit at that price, never a market order of that size.
  assert.deepEqual(read("купи JUP по 0.5"), { kind: "order", mode: "limit", side: "buy", coin: JUP, price: "0.5" });
  assert.deepEqual(read("buy JUP at 0.5"), { kind: "order", mode: "limit", side: "buy", coin: JUP, price: "0.5" });
  assert.deepEqual(read("продай 100 JUP по 0.8"), { kind: "order", mode: "limit", side: "sell", coin: JUP, price: "0.8" });
  assert.deepEqual(read("стоп USDC 0.99").price, null, "USDC's own price cannot be said in dollars");
  // The coin named, not the one on screen: «sell 2 SOL at 150» over JUP's window is a limit on SOL.
  assert.deepEqual(read("sell 2 SOL at 150", ON_JUP), { kind: "order", mode: "limit", side: "sell", coin: SOL_COIN, price: "150" });
  assert.deepEqual(read("buy 1 sol at 150", ON_JUP), { kind: "order", mode: "limit", side: "buy", coin: SOL_COIN, price: "150" });
  assert.deepEqual(read("stop 2 SOL at 120", ON_JUP), { kind: "order", mode: "stop", side: "sell", coin: SOL_COIN, price: "120" });
  assert.deepEqual(read("buy 50 usdc of SOL at 140"), { kind: "order", mode: "limit", side: "buy", coin: SOL_COIN, price: "140" });
  // A price said in SOL or another coin is never written as dollars.
  for (const text of ["sell JUP at 0.002 sol", "stop JUP at 0.002 sol", "limit sell BONK at 0.0000002 SOL", "buy WIF at 3 JUP"]) {
    assert.equal(read(text).kind, "order", text);
    assert.equal(read(text).price, null, text);
  }
  assert.deepEqual(read("swap SOL to 100 JUP"), { kind: "buy", coin: JUP, view: "swap", amount: null, pay: "SOL", share: null }, "the count of what is got");
});

test("money the line does not take, and thousands written with a space or a point, are left out — never read as dollars or as 1", () => {
  for (const text of ["купи JUP на 50 гривень", "buy JUP 50 eur", "buy JUP грн 50", "buy JUP for 1 000", "buy JUP 1.000", "buy JUP for 50 usdt"]) {
    const got = read(text);
    assert.equal(got.kind, "buy", text);
    assert.equal(got.amount, null, text);
  }
  assert.equal(read("sell 1 500 JUP").amount, null, "«1 500» is not 500 and not 1");
  assert.equal(read("buy JUP for 1 000.50").amount, null, "«1 000.50» is not 1");
});

test("an address or a word the city does not know is never replaced by the coin on screen", () => {
  for (const text of [`sell all ${ADDRESS}`, `buy ${ADDRESS} for 50`, `stop ${ADDRESS} 0.8`, "buy x.skr 50"]) {
    assert.equal(read(text, ON_JUP).kind, "ask", text);
  }
});

test("the words of a sentence name a coin only when written as one: «buy me JUP» is JUP, «buy ME» is ME", () => {
  const ME_MINT = "MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u";
  const SEND_MINT = "SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa";
  const book = bookOf([...TOWERS, tower(ME_MINT, "ME", 3e9), tower(SEND_MINT, "SEND", 3e9)]);
  const ME = book.coins.find((c) => c.mint === ME_MINT);
  const at = (text) => parse(text, book, NONE);
  assert.equal(at("buy me JUP for 50").coin.mint, JUP_MINT);
  assert.equal(at("show me the JUP chart").coin.mint, JUP_MINT);
  assert.equal(at(`send 5 JUP to ${ADDRESS}`).send.asset.mint, JUP_MINT);
  assert.deepEqual(at("buy ME"), { kind: "buy", coin: ME, view: "spot", amount: null, pay: null, share: null });
  assert.deepEqual(at("$me"), { kind: "coin", coin: ME });
  assert.equal(at("BUY ME JUP FOR 50").coin.mint, JUP_MINT, "a sentence typed in capitals is not a sentence of tickers");
  assert.equal(at("BUY ME JUP FOR 50").amount, "50");
  assert.equal(parse("BUY ME 50", book, { subject: JUP }).kind, "ask", "in capitals, a ticker that is also a word is never replaced by the coin on screen");
});

test("a condition, a refusal or an agent is Ryntra's to answer, never a window opened on it", () => {
  for (const text of ["buy JUP if it drops to 0.5", "купи JUP якщо впаде", "не купуй JUP", "never sell JUP", "don't buy BONK", "запусти бота", "launch agent to trade 1 SOL a day", "launch a bot"]) {
    assert.equal(read(text).kind, "ask", text);
  }
});

test("a question is Ryntra's, whatever it mentions", () => {
  for (const text of ["why is JUP falling", "should I buy JUP", "buy JUP?", "що з BONK?", "чи варто купити WIF", "what's rising today", "JUP will pump tomorrow", "hello"]) {
    assert.deepEqual(read(text), { kind: "ask", question: text }, text);
  }
});

test("the coin on screen answers «buy 50» and «stop 0.8» — but never stands in for a ticker the city does not know", () => {
  assert.deepEqual(read("buy 50", ON_JUP), { kind: "buy", coin: JUP, view: "spot", amount: "50", pay: "USDC", share: null });
  assert.deepEqual(read("sell all", ON_JUP), { kind: "sell", coin: JUP, view: "spot", amount: null, into: null, share: 100 });
  assert.deepEqual(read("stop 0.8", ON_JUP), { kind: "order", mode: "stop", side: "sell", coin: JUP, price: "0.8" });
  assert.deepEqual(read("chart", ON_JUP), { kind: "chart", coin: JUP });
  assert.equal(read("buy XYZ 50", ON_JUP).kind, "ask");
  assert.equal(read("buy XYZ for 50 sol").kind, "ask");
  assert.equal(read("stop on XYZ", ON_JUP).kind, "ask");
  assert.equal(read("swap 1 SOL to XYZ").kind, "ask");
  assert.equal(read("buy 50").kind, "ask", "no coin on screen and none named");
});

test("a number that could mean two things is left out, never rounded into one", () => {
  assert.equal(cleanNumber("1,000"), null);
  assert.equal(cleanNumber("0,5"), "0.5");
  assert.equal(cleanNumber("0"), null);
  assert.equal(cleanNumber("007"), "7");
  // «.5» is not read as 5, «50k» not as 50, «-5» not as 5, «1,000» not as 1.
  assert.equal(read("buy JUP for .5 sol").amount, null);
  assert.equal(read("buy JUP 50k").amount, null);
  assert.equal(read("buy JUP -5").amount, null);
  assert.equal(read("buy JUP 1,000").amount, null);
  assert.equal(read("buy JUP 1.000.000").amount, null);
});

test("a sentence longer than a command is cut to one, and nothing in it runs", () => {
  const long = `buy JUP ${"very ".repeat(60)}50`;
  const got = read(long);
  assert.equal(got.kind, "buy");
  assert.equal(got.amount, null, "the number past the cut is not read");
  assert.ok(COMMAND_MAX <= 140);
});

test("the deployment's switches: a shut window is not offered; a limit where Spot is shut opens the coin, never a pretend order", () => {
  const order = read("stop JUP 0.8");
  assert.deepEqual(fit(order, { ...OPEN, spot: false }), { kind: "coin", coin: JUP });
  assert.equal(fit(read("buy JUP"), { ...OPEN, trade: false }), null);
  assert.equal(fit(read("my portfolio"), { ...OPEN, money: false }), null);
  assert.equal(fit(read("earn"), { ...OPEN, earn: false }), null);
  assert.equal(fit(read("launch"), { ...OPEN, launch: false }), null);
  assert.deepEqual(fit(read("JUP"), { trade: false, spot: false, money: false, earn: false, launch: false }), { kind: "coin", coin: JUP });
});

test("the list under the field: the command first, coins and places as a word is typed, Ryntra last", () => {
  assert.deepEqual(suggest("", BOOK, NONE, OPEN), []);
  const buy = suggest("buy jup 20", BOOK, NONE, OPEN);
  assert.equal(buy[0].command.kind, "buy");
  assert.equal(buy.at(-1).command.kind, "ask");
  const ju = suggest("ju", BOOK, NONE, OPEN);
  assert.deepEqual(ju.map((r) => r.key), [`coin:${JUP_MINT}`, "ask"]);
  const port = suggest("port", BOOK, NONE, OPEN);
  assert.deepEqual(port.map((r) => r.key), ["money:portfolio", "ask"]);
  assert.deepEqual(suggest("порт", BOOK, NONE, { ...OPEN, money: false }).map((r) => r.key), ["ask"]);
  const one = suggest("b", BOOK, NONE, OPEN);
  assert.deepEqual(one.map((r) => r.key), [`coin:${BONK_MINT}`], "one letter: no question yet");
  for (const text of ["s", "why", "buy sol 5", "launch"]) assert.ok(suggest(text, BOOK, NONE, OPEN).length <= ROWS_MAX);
  assert.equal(new Set(suggest("sol", BOOK, NONE, OPEN).map((r) => r.key)).size, suggest("sol", BOOK, NONE, OPEN).length, "no row twice");
  assert.equal(keyOf({ kind: "ask", question: "x" }), "ask");
});

test("Ryntra is asked about the coin on screen only when the question is about it", () => {
  assert.equal(aboutSubject("is it risky?", "JUP"), true);
  assert.equal(aboutSubject("What is happening with JUP today, and why?", "JUP"), true);
  assert.equal(aboutSubject("Що з нею?", "JUP"), true);
  assert.equal(aboutSubject("What is rising on Solana today, and why?", "JUP"), false);
});

test("⌘K and Ctrl+K in any keyboard layout; never while the keyboard is in another field", () => {
  const key = (over) => ({ key: "k", code: "KeyK", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(isCommandKey(key({ metaKey: true })), true);
  assert.equal(isCommandKey(key({ ctrlKey: true })), true);
  assert.equal(isCommandKey(key({ ctrlKey: true, key: "л" })), true, "a Ukrainian layout");
  assert.equal(isCommandKey(key({})), false);
  assert.equal(isCommandKey(key({ ctrlKey: true, shiftKey: true })), false);
  const field = { closest: (selector) => (selector.includes("input") ? {} : null), isContentEditable: false };
  const own = { closest: (selector) => (selector === "[data-city-command]" ? {} : null), isContentEditable: false };
  const canvas = { closest: () => null, isContentEditable: false };
  assert.equal(typingIn(field), true);
  assert.equal(typingIn(own), false, "the command line's own field closes it");
  assert.equal(typingIn(canvas), false);
  assert.equal(typingIn(null), false);
});

/* ------------------------------------------------------------------------------------------------ Never a signature */

/** Every sentence the tests read, through every door: what each one knocked on. */
const SENTENCES = [
  "купити SOL на 50",
  "buy $50 of JUP",
  "buy jup for 0.5 sol",
  "sell all JUP",
  "sell JUP 100",
  "стоп на JUP по 0,8",
  "limit buy BONK 0.00002",
  "swap 1 SOL to JUP",
  "обміняти 100 JUP на USDC",
  "мій портфель",
  "history",
  "top up",
  `send 0.5 SOL to ${ADDRESS}`,
  "pay link",
  "bridge",
  "earn",
  "запусти токен Moon Cat $MOON",
  "chart BONK",
  "JUP",
  ADDRESS,
  "why is JUP falling",
];

function recordingDoors() {
  const calls = [];
  const doors = Object.fromEntries(DOORS.map((name) => [name, (...args) => calls.push([name, ...args])]));
  return { doors, calls };
}

test("every command only opens a window, fills its fields or asks Ryntra — in that order", () => {
  for (const text of SENTENCES) {
    const { doors, calls } = recordingDoors();
    run(read(text), doors);
    assert.ok(calls.length >= 1, text);
    for (const [name] of calls) assert.match(name, /^(open|fill|ask)[A-Z]/, `${text}: ${name}`);
    const first = calls[0][0];
    assert.match(first, /^(open|ask)/, `${text}: the window opens before anything is written in it`);
  }
  const { doors, calls } = recordingDoors();
  run(read("купити SOL на 50"), doors);
  assert.deepEqual(calls, [
    ["openTrade", SOL_COIN, "buy", "spot", "market"],
    ["fillPay", "USDC"],
    ["fillAmount", "50"],
  ]);
  const order = recordingDoors();
  run(read("stop JUP at 0.8"), order.doors);
  assert.deepEqual(order.calls, [
    ["openTrade", JUP, "sell", "spot", "stop"],
    ["fillPay", "USDC"],
    ["fillPrice", "0.8"],
  ]);
  assert.deepEqual(
    DOORS.filter((name) => !/^(open|fill|ask)[A-Z]/.test(name)),
    [],
    "no door is anything but opening, filling or asking",
  );
});

/** The calls that move money or ask the wallet, anywhere in the city's stores. */
const SIGNING =
  /\b(press|prepare|renew|again|recover|recoverQuietly|reviewSend|confirmSend|acceptLookalike|acceptFresh|resumeSend|newSend|reviewBridge|confirmBridge|quoteBridge|followOrder|newBridge|pickDeposit|reviewOrder|placeOrder|setStop|cancelStop|cancelOrder|openSale|watchStops|signTransaction|signAllTransactions|signMessage|sendTransaction|sendRawTransaction|citySigner|shareCard|setPhase|setStep)\s*\(/;

/**
 * Every method the command line's code calls, reviewed: the stores' openers and field setters, the city's own reads, and
 * plain JavaScript. A call that is not here — a new store action — fails until someone has looked at what it does.
 */
const REVIEWED = new Set([
  // the trade window: open it, write its fields — never press, prepare or place
  "openFor", "setPay", "setTyped", "setShare", "setPrice",
  // Money: open it on a tab, read the wallet as its window does, write Send's fields, pick Send's way
  "follow", "setSendAsset", "setTo", "setAmount", "setWay",
  // the launch sheet, the chart, the city, Ryntra's panel, the side panels
  "openSheet", "setDraft", "closeSheet", "open", "close", "select", "show", "hide", "ask", "closePanel",
  // the doors, the words and the line's own state
  "openTrade", "openCoin", "openChart", "openMint", "openMoney", "openEarn", "openLaunch", "askRyntra",
  // the agent's card and «My instructions» (CITY-176): they open and show; the person signs in the card
  "openInstruction", "openInstructions", "openList", "readInstruction",
  // the agent on its word (CITY-175): it reads the ask and opens its card; the person signs in the card
  "openAutopilot", "readAsk", "presetFor", "rhythmOf", "wordsNow", "trades",
  // the Dollar Saver on its word (CITY-192): it reads the coin and the amount and opens the card; the person signs there
  "openDollar", "readDollarAsk", "fromAsk", "rateText", "earnWords",
  "fillPay", "fillAmount", "fillShare", "fillPrice", "fillSend", "gatesNow",
  "buy", "sell", "order", "chart", "share", "launchAs",
  "getState", "setState", "subscribe",
  // the page and plain JavaScript
  "preventDefault", "stopImmediatePropagation", "addEventListener", "removeEventListener", "focus", "closest", "assign",
  "slice", "at", "trim", "push", "min", "max", "map", "find", "filter", "join", "has", "keys", "replace",
  "toUpperCase", "toLowerCase", "then", "catch", "split", "test", "exec", "forEach", "some", "includes", "startsWith",
  "values", "entries", "set", "get", "findIndex", "flatMap", "sort",
]);

test("the command line's code names no call that moves money or asks the wallet", () => {
  const files = [
    "./parse.ts",
    "./run.ts",
    "./doors.ts",
    "./store.ts",
    "./keys.ts",
    "../../components/command/CommandLayer.tsx",
    "../../components/command/AskInWindow.tsx",
  ];
  for (const file of files) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, SIGNING, file);
    assert.doesNotMatch(code, /from ['"][^'"]*(wallet\/signer|city-signer|signer)['"]/, `${file} imports no signer`);
    const called = new Set([...code.matchAll(/\.([A-Za-z_]+)\(/g)].map((m) => m[1]));
    const unreviewed = [...called].filter((name) => !REVIEWED.has(name));
    assert.deepEqual(unreviewed, [], `${file} calls what nobody has reviewed for the command line`);
  }
});

/* The real doors on the city's real stores, the wallet and every engine a spy: a command never reaches a signature. */

const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PHANTOM = { wallet: "Phantom", address: TAKER };
const HOLDINGS = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map([[JUP_MINT, { spendableRaw: "5000000000", decimals: 6 }]]), complete: true };

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("every sentence through the city's own doors: windows open and fill, the wallet is never asked, the command asks for no order", async () => {
  const signed = [];
  const routes = [];
  const fetched = [];
  const { setTradeEnv, useTrade } = await import("../trade/store.ts");
  const { setSpotEnv, useSpot, pairKey } = await import("../trade/spot-store.ts");
  const { setMoneyEnv, useMoneyStore } = await import("../money/store.ts");
  const { useMoney } = await import("../money/open.ts");
  const { useCity } = await import("../city/store.ts");
  const { useLaunch } = await import("../launch/district.ts");
  const { useAssistant } = await import("../assistant/store.ts");
  const { useEarn } = await import("../earn/open.ts");
  const { useHarbor } = await import("../districts/harbor/store.ts");
  const { useTowerChart } = await import("../chart/store.ts");
  const { createEngine } = await import("../trade/engine.ts");
  const { cityDoors } = await import("./doors.ts");

  const spySign = async (_connection, wire) => {
    signed.push(wire);
    return { ok: false, code: "REJECTED" };
  };
  // The engine answers a price and nothing else: an order or an execute asked for would be recorded here.
  const engine = createEngine(
    async (url) => {
      routes.push(url.split("/").at(-1));
      return { ok: false, status: 503, json: async () => ({ error: { code: "UNAVAILABLE" } }) };
    },
    { wait: async () => {}, timers: { set: () => 0, clear: () => {} } },
  );
  const wallet = { connection: PHANTOM, holdings: HOLDINGS };
  setTradeEnv({ engine, sign: spySign, wallet: () => wallet, refreshHoldings: () => {}, sleep: async () => {}, now: () => 1_000 });
  setSpotEnv({ sign: spySign, wallet: () => wallet, open: true, refreshHoldings: () => {} });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: false, status: 503, json: async () => ({}) };
  };
  setMoneyEnv({
    sign: spySign,
    fetch: async (url) => {
      fetched.push(String(url));
      return { ok: false, status: 503, json: async () => ({}) };
    },
    connection: () => PHANTOM,
    storage: () => null,
    open: true,
  });
  useLaunch.setState({ status: "ready", preset: { id: "x" }, network: "devnet", stub: true });
  useCity.getState().setSnapshot({ towers: TOWERS, source: "live", fetchedAt: new Date(0).toISOString() });

  try {
    for (const text of SENTENCES) {
      const command = fit(parse(text, BOOK, NONE), OPEN);
      run(command, cityDoors);
      // The Spot ticket settles on its pair as it opens; here the test is the ticket.
      const trade = useTrade.getState();
      if (trade.open && trade.tower && trade.mode !== "market") {
        const pay = trade.pay === "USDC" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "So11111111111111111111111111111111111111112";
        useSpot.setState({ priceFor: `${trade.mode}|${pairKey(trade.side, trade.tower.mint, pay)}`, phase: "idle" });
      }
      await flush();
      assert.equal(signed.length, 0, `${text}: the wallet was never asked`);
      assert.ok(!routes.some((route) => route !== "quote"), `${text}: only a price was asked, never an order (${routes.join(", ")})`);
      assert.ok(["idle", "preparing"].includes(useTrade.getState().phase) || !useTrade.getState().open, `${text}: the card waits for the person`);
      assert.equal(useTrade.getState().review, null, `${text}: no order stands ready to sign`);
      assert.equal(useMoneyStore.getState().send.phase, "idle", `${text}: Send waits for the person`);
      assert.equal(useMoneyStore.getState().send.review, null, `${text}: no transfer stands reviewed`);
      assert.ok(["idle", "reviewing"].includes(useSpot.getState().phase), `${text}: no limit or stop is out or set (${useSpot.getState().phase})`);
      assert.equal(useSpot.getState().stops.length, 0, `${text}: no stop was set on this device`);
      assert.ok(!fetched.some((url) => /(execute|order|send|transfer|bridge|deposit|stop|launch\/(build|create|submit))/i.test(url)), `${text}: nothing but reads was asked (${fetched.join(", ")})`);
      assert.equal(useLaunch.getState().phase, null, `${text}: no launch started`);
    }

    // What the sentences opened and filled, as the person would see it.
    run(fit(parse("купити SOL на 50", BOOK, NONE), OPEN), cityDoors);
    await flush();
    assert.equal(useTrade.getState().open, true);
    assert.equal(useTrade.getState().tower.mint, SOL_COIN.mint);
    assert.equal(useTrade.getState().pay, "USDC");
    assert.equal(useTrade.getState().typed, "50");

    run(fit(parse("stop JUP at 0.8", BOOK, NONE), OPEN), cityDoors);
    assert.equal(useTrade.getState().mode, "stop");
    assert.equal(useTrade.getState().side, "sell");
    useSpot.setState({ priceFor: `stop|${pairKey("sell", JUP_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}`, phase: "idle" });
    await flush();
    assert.equal(useSpot.getState().price, "0.8");
    assert.equal(useCity.getState().selectedId, JUP_MINT, "the camera goes to the tower the window is about");

    run(fit(parse(`send 0.5 SOL to ${ADDRESS}`, BOOK, NONE), OPEN), cityDoors);
    await flush();
    assert.equal(useMoney.getState().open, true);
    assert.equal(useMoney.getState().tab, "send");
    assert.equal(useMoneyStore.getState().send.to, ADDRESS);

    run(fit(parse("запусти токен Moon Cat $MOON", BOOK, NONE), OPEN), cityDoors);
    assert.equal(useLaunch.getState().sheet, true);
    assert.equal(useLaunch.getState().draft.symbol, "MOON");
    assert.equal(useLaunch.getState().draft.name, "Moon Cat");

    run(fit(parse("chart BONK", BOOK, NONE), OPEN), cityDoors);
    assert.equal(useTowerChart.getState().mint, BONK_MINT);
    run(fit(parse("earn", BOOK, NONE), OPEN), cityDoors);
    assert.equal(useEarn.getState().open || useHarbor.getState().open, true, "Earn's window, or the Harbor where Earn's switch is shut");
    run(fit(parse("why is JUP falling", BOOK, NONE), OPEN), cityDoors);
    assert.equal(useAssistant.getState().open, true);
    await flush();
    assert.equal(signed.length, 0);

    // A price waiting for its ticket is let go when the person changes the side, and never lands in a later command.
    useSpot.setState({ priceFor: null, price: "" });
    run(fit(parse("stop JUP at 0.7", BOOK, NONE), OPEN), cityDoors);
    useTrade.getState().setSide("buy");
    useSpot.setState({ priceFor: `stop|${pairKey("buy", JUP_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}`, phase: "idle" });
    await flush();
    assert.equal(useSpot.getState().price, "", "a buy stop never gets the sell stop's price");
    useSpot.setState({ priceFor: null, price: "" });
    run(fit(parse("stop JUP at 0.6", BOOK, NONE), OPEN), cityDoors);
    run(fit(parse("лімітка на JUP", BOOK, NONE), OPEN), cityDoors);
    useSpot.setState({ priceFor: `limit|${pairKey("buy", JUP_MINT, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}`, phase: "idle" });
    await flush();
    assert.equal(useSpot.getState().price, "", "the limit opened after never gets the stop's price");

    // A card whose signature is out is never written into or replaced.
    useTrade.setState({ open: true, tower: { mint: WIF_MINT, symbol: "WIF", name: "WIF", icon: null }, phase: "wallet", typed: "3", pay: "SOL" });
    run(fit(parse("buy JUP 999", BOOK, NONE), OPEN), cityDoors);
    run(fit(parse("buy 999", BOOK, { subject: WIF }), OPEN), cityDoors);
    assert.equal(useTrade.getState().tower.mint, WIF_MINT);
    assert.equal(useTrade.getState().typed, "3");
    assert.equal(useTrade.getState().pay, "SOL");
    assert.equal(signed.length, 0);
  } finally {
    globalThis.fetch = savedFetch;
    useTrade.setState({ open: false, tower: null, phase: "idle" });
  }
});
