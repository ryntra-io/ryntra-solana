import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, fit, keyOf } from "../command/parse.ts";
import { DOORS, run } from "../command/run.ts";
import { readInstruction } from "../instruct/read.ts";
import { agentCard, cardFile } from "../launch/cards.ts";
import { cardFace, postText } from "../launch/card-words.ts";
import { autopilotNetwork } from "./flag.ts";
import { lamports, presetFor, proposal, rhythmOf, tickerFrom } from "./plan.ts";
import { readAsk } from "./read.ts";

/* CITY-175: the agent on its word — «trade 1 SOL a day», «launch me a token» — read, proposed and opened. */

const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BOOK = bookOf([{ id: JUP_MINT, symbol: "JUP", name: "Jupiter", icon: null, mcap: 1e9, liquidity: 1e6, verified: true }]);
const ask = (text) => readAsk(text, BOOK);
const T = (perDaySol, said, coin = null) => ({ kind: "trade", said, perDaySol, coin });

test("«trade 1 SOL a day»: the agent to trade, with the day's budget only when it is said in SOL", () => {
  for (const [said, sol] of [
    ["торгуй на 1 SOL на день", "1"],
    ["Торгуй на 0,5 SOL щодня", "0.5"],
    ["trade 1 SOL a day", "1"],
    ["trade for me with 0.25 sol per day", "0.25"],
    ["let my agent trade 0.1 SOL daily", "0.1"],
    ["запусти бота на 0,5 SOL", "0.5"],
    ["запусти агента на 1 сол на день", "1"],
    ["launch an agent with 0.25 SOL a day", "0.25"],
    ["агенте, торгуй на 1sol на день", "1"],
    ["торгуй за мене", null],
    ["trade for me", null],
    ["запусти бота", null],
    ["trade $50 a day for me", null],
    ["торгуй на 1 SOL на тиждень", null],
    ["торгуй на 1 або 2 SOL на день", null],
    ["торгуй на 100 гривень на день", null],
  ]) {
    assert.deepEqual(ask(said), T(sol, said), said);
  }
});

test("a question, a refusal, a plain trade of a coin or a standing instruction is not the agent's ask", () => {
  for (const said of [
    "how does the agent trade?",
    "чи може агент торгувати сам?",
    "не торгуй на 1 SOL",
    "don't trade for me",
    "trade JUP",
    "торгувати JUP",
    "buy $20 of SOL every week",
    "купуй SOL на $20 щотижня",
    "launch $MOON",
    "запуск",
    "нові запуски",
    "",
  ]) {
    assert.equal(ask(said), null, said);
  }
  // The regular-purchase reader leaves «trade» to the agent: never read into a purchase of SOL.
  assert.equal(readInstruction("торгуй на 1 SOL щодня", BOOK, { subject: null }), null);
  assert.equal(readInstruction("trade 1 SOL daily", BOOK, { subject: null }), null);
  assert.notEqual(readInstruction("купуй SOL на $20 щотижня", BOOK, { subject: null }), null);
});

test("«launch me a token»: the agent to prepare a launch, with the name and the ticker when said", () => {
  assert.deepEqual(ask("запусти мені токен"), { kind: "launch", said: "запусти мені токен", name: null, symbol: null });
  assert.deepEqual(ask("launch me a token"), { kind: "launch", said: "launch me a token", name: null, symbol: null });
  assert.deepEqual(ask("launch me a coin called Neon Fox"), { kind: "launch", said: "launch me a coin called Neon Fox", name: "Neon Fox", symbol: null });
  assert.deepEqual(ask("запусти токен Moon Cat $MOON"), { kind: "launch", said: "запусти токен Moon Cat $MOON", name: "Moon Cat", symbol: "MOON" });
  assert.deepEqual(ask("створи мемкоїн для мене"), { kind: "launch", said: "створи мемкоїн для мене", name: null, symbol: null });
  // An agent or a bot is never a token to launch.
  assert.equal(ask("launch a bot").kind, "trade");
});

test("the budget is never more than said: the largest one at or under it, and a note when more was said", () => {
  assert.deepEqual(presetFor("1"), { preset: "large", capped: true });
  assert.deepEqual(presetFor("0.5"), { preset: "large", capped: false });
  assert.deepEqual(presetFor("0.3"), { preset: "medium", capped: false });
  assert.deepEqual(presetFor("0.25"), { preset: "medium", capped: false });
  assert.deepEqual(presetFor("0.1"), { preset: "small", capped: false });
  assert.deepEqual(presetFor("0.05"), { preset: null, capped: false });
  assert.deepEqual(presetFor(null), { preset: null, capped: false });
  assert.equal(lamports("0.25"), 250_000_000n);
  assert.equal(lamports("1"), 1_000_000_000n);
  assert.deepEqual(rhythmOf("large"), { buys: 5, everyHours: 4.8, perTrade: 0.1, perDay: 0.5, days: 30 });
});

test("the agent's launch proposal keeps the person's words and fills the rest within the sheet's rules", () => {
  assert.equal(tickerFrom("Neon Fox"), "FOX");
  assert.equal(tickerFrom("Neon Falcon"), "FALCON");
  assert.equal(tickerFrom("A B"), "AB");
  assert.equal(tickerFrom("Moon"), "MOON");
  assert.equal(tickerFrom("Космічний кіт"), "");
  assert.deepEqual(proposal({ name: "Moon Cat", symbol: "MOON" }, 3), { name: "Moon Cat", symbol: "MOON", seed: 3 });
  assert.deepEqual(proposal({ name: null, symbol: "MOON" }, 3), { name: "Moon", symbol: "MOON", seed: 3 });
  assert.equal(proposal({ name: "Космічний кіт", symbol: null }, 1).symbol, "COIN");
  for (let seed = 0; seed < 40; seed += 1) {
    const p = proposal({ name: null, symbol: null }, seed);
    assert.match(p.symbol, /^[A-Z0-9]{2,10}$/, p.name);
    assert.ok(p.name.length > 0 && p.name.length <= 32);
  }
  assert.notDeepEqual(proposal({ name: null, symbol: null }, 1), proposal({ name: null, symbol: null }, 2));
});

test("the line opens the agent's card only where its switches are open; its door only opens the card", () => {
  const trade = { kind: "autopilot", ask: T("1", "trade 1 SOL a day") };
  const launch = { kind: "autopilot", ask: { kind: "launch", said: "launch me a token", name: null, symbol: null } };
  const gates = { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true };
  assert.equal(fit(trade, gates), null);
  assert.equal(fit(trade, { ...gates, agentTrade: true }), trade);
  assert.equal(fit(launch, { ...gates, agentLaunch: true }), launch);
  assert.equal(fit(launch, { ...gates, agentLaunch: true, launch: false }), null);
  assert.equal(keyOf(trade), "autopilot:trade");
  assert.ok(DOORS.includes("openAutopilot"));
  const calls = [];
  run(trade, Object.fromEntries(DOORS.map((name) => [name, (...args) => calls.push([name, ...args])])));
  assert.deepEqual(calls, [["openAutopilot", trade.ask]]);
  assert.equal(autopilotNetwork("devnet"), "devnet");
  assert.equal(autopilotNetwork("mainnet"), "mainnet");
  assert.equal(autopilotNetwork("Mainnet"), null);
  assert.equal(autopilotNetwork(undefined), null);
});

test("the agent's share card says what its own trades did, test money marked so", () => {
  const coin = { token: "Coin111111111111111111111111111111111111111", symbol: "TRYN", logo: false };
  assert.equal(agentCard({ coin, trades: 0, spentRaw: "0", worthRaw: "0", tag: "devnet" }), null);
  assert.equal(agentCard({ coin, trades: 2, spentRaw: "100000000", worthRaw: null, tag: "devnet" }), null);
  const card = agentCard({ coin, trades: 2, spentRaw: "100000000", worthRaw: "112000000", tag: "devnet" });
  assert.equal(card.multiple, 1.12);
  assert.equal(card.up, true);
  assert.equal(cardFile(card), "ryntra-tryn-agent.png");
  const en = cardFace(card, "en");
  assert.equal(en.hero, "1.1×");
  assert.equal(en.unit, "+0.01 SOL");
  assert.equal(en.tag, "DEVNET");
  assert.match(en.line, /\$TRYN · 2 trades/);
  assert.match(postText(card, "uk"), /^DEVNET · Мій агент на Ryntra: 1,1× на \$TRYN/);
  const down = cardFace(agentCard({ coin, trades: 1, spentRaw: "100000000", worthRaw: "90000000", tag: null }), "en");
  assert.equal(down.tone, "flare");
  assert.equal(down.unit, "−0.01 SOL");
});

test("what the agent earned keeps its small digits and is never rounded up", async () => {
  const { solText } = await import("./plan.ts");
  assert.equal(solText(0.0117, "en"), "0.0117");
  assert.equal(solText(0.31179, "uk"), "0,3117");
  assert.equal(solText(1.23456, "en"), "1.234");
  assert.equal(solText(12.345, "en"), "12.34");
  assert.equal(solText(0.3, "en"), "0.3");
  assert.equal(solText(0, "en"), "0");
});

test("the coin the agent buys on mainnet: one tower named by its ticker, never SOL or USDC, never two", () => {
  const jup = BOOK.coins.find((coin) => coin.mint === JUP_MINT);
  assert.deepEqual(ask("торгуй JUP на 0,1 SOL на день"), T("0.1", "торгуй JUP на 0,1 SOL на день", jup));
  assert.deepEqual(ask("trade $JUP 0.1 SOL a day"), T("0.1", "trade $JUP 0.1 SOL a day", jup));
  assert.equal(ask("trade 0.1 SOL a day").coin, null, "SOL is what it pays with");
  assert.equal(ask("trade USDC for me").coin, null);
});

test("the coins the agent offers on mainnet: towers only — no SOL, no staked SOL under another name, no dollar coin", async () => {
  const { agentCoins } = await import("../command/parse.ts");
  const towers = ["JUP", "JITOSOL", "BNSOL", "USDT", "PYUSD", "BONK", "PUMP", "WIF", "POPCAT"].map((symbol, i) => ({ id: `${symbol}${"1".repeat(40 - symbol.length)}`, symbol, name: symbol, icon: null, mcap: 1e9 - i, liquidity: 1e6, verified: true }));
  assert.deepEqual(agentCoins(bookOf(towers)).map((c) => c.symbol), ["JUP", "BONK", "PUMP", "WIF"]);
});
