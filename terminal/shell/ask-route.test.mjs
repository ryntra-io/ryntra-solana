import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, parse } from "../../city/lib/command/parse.ts";
import { askLabel } from "./ask-label.ts";
import { EVERY_GATE, askHref, askRows, foundCoin, gatesFor, planAnswer, stayOn, targetOf, withShelf } from "./ask-route.ts";
import { handOff, takeAsk, useAsk } from "./ask.ts";
import { KIT_PATH, SHELF_IDS, SHELVES } from "./shelves.ts";

/* The agent's line reads a sentence with the city's own reader and opens the shelf that does it — never one that is off,
   and never a signature: the screen it opens is filled, the person confirms there. */

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP", 9e8), tower(BONK, "BONK", 8e8)]);
const NONE = { subject: null };
const read = (text) => parse(text, BOOK, NONE);

const ALL = () => true;
const ONLY = (...ids) => (id) => ids.includes(id);

test("each reading opens its shelf: a coin's trade its screen, a swap the Swap, money the Portfolio or the Swap, agents the Agents", () => {
  assert.deepEqual(targetOf(read("buy JUP for 50")), { shelf: "market", mint: JUP });
  assert.deepEqual(targetOf(read("купити BONK на 0,25 SOL")), { shelf: "market", mint: BONK });
  assert.deepEqual(targetOf(read("swap 1 SOL to JUP")), { shelf: "swap", mint: null });
  assert.deepEqual(targetOf(read("JUP")), { shelf: "market", mint: JUP });
  assert.deepEqual(targetOf(read("my portfolio")), { shelf: "portfolio", mint: null });
  assert.deepEqual(targetOf(read("history")), { shelf: "portfolio", mint: null });
  assert.deepEqual(targetOf(read("bridge")), { shelf: "swap", mint: null });
  assert.deepEqual(targetOf(read("earn")), { shelf: "earn", mint: null });
  assert.deepEqual(targetOf(read("launch $MOON")), { shelf: "launch", mint: null });
  assert.deepEqual(targetOf(read("why is JUP down?")), { shelf: "agents", mint: null });
  assert.deepEqual(targetOf({ kind: "money", place: "paylink", send: null }), null, "a pay link has no place in the terminal yet");
  assert.deepEqual(targetOf({ kind: "learn", chapter: null }), null);
});

test("a plain buy or sell said on the Swap screen stays on it; a limit and a coin still open the coin's screen (QA 19.11)", () => {
  const rows = (text) => askRows(text, BOOK, NONE, ALL, EVERY_GATE);
  assert.deepEqual(stayOn(rows("buy JUP for 50"), "swap", ALL)[0].target, { shelf: "swap", mint: null });
  assert.deepEqual(stayOn(rows("купити BONK на 0,25 SOL"), "swap", ALL)[0].target, { shelf: "swap", mint: null });
  assert.deepEqual(stayOn(rows("buy JUP for 50"), "market", ALL)[0].target, { shelf: "market", mint: JUP }, "elsewhere a buy opens the coin");
  assert.deepEqual(stayOn(rows("JUP"), "swap", ALL)[0].target, { shelf: "market", mint: JUP }, "a coin is its own screen");
  assert.deepEqual(stayOn(rows("buy JUP for 50"), "swap", ONLY("market"))[0].target, { shelf: "market", mint: JUP }, "a Swap shelf that is off takes nothing");
});

test("a reading's address is its shelf's, a coin's screen for a coin, and inside the kit on the kit page", () => {
  assert.equal(askHref({ shelf: "market", mint: JUP }, "live"), `/coin/${JUP}`);
  assert.equal(askHref({ shelf: "swap", mint: null }, "live"), SHELVES.swap.path);
  assert.equal(askHref({ shelf: "agents", mint: null }, "live"), SHELVES.agents.path);
  assert.equal(askHref({ shelf: "market", mint: JUP }, "preview"), `${KIT_PATH}/market`);
  assert.equal(askHref({ shelf: "earn", mint: null }, "preview"), `${KIT_PATH}/earn`);
});

test("no shelf on, no row; a row only for a shelf that is on, and only where the engine is open", () => {
  for (const text of ["buy JUP for 50", "swap 1 SOL to JUP", "my portfolio", "earn", "launch", "why is SOL up?"]) {
    assert.deepEqual(askRows(text, BOOK, NONE, () => false, EVERY_GATE), [], text);
  }
  const swapOnly = askRows("swap 1 SOL to JUP", BOOK, NONE, ONLY("swap"), EVERY_GATE);
  assert.deepEqual(swapOnly.map((row) => row.target.shelf), ["swap"]);
  // The question row is the agent's: without the Agents shelf there is none.
  assert.ok(!askRows("why is SOL up?", BOOK, NONE, ONLY("swap"), EVERY_GATE).length);
  assert.deepEqual(askRows("why is SOL up?", BOOK, NONE, ONLY("agents"), EVERY_GATE).map((row) => row.target.shelf), ["agents"]);
  // An engine shut here is never offered, whatever the shelf says.
  assert.deepEqual(askRows("buy JUP for 50", BOOK, NONE, ALL, { ...EVERY_GATE, trade: false }).filter((row) => row.target.shelf === "market" && row.command.kind === "buy"), []);
  for (const row of askRows("JU", BOOK, NONE, ALL, EVERY_GATE)) assert.ok(SHELF_IDS.includes(row.target.shelf), row.key);
});

test("the terminal's gates are the city's: a shelf over the engine behind it", () => {
  const none = gatesFor(() => false, EVERY_GATE);
  for (const [gate, open] of Object.entries(none)) assert.equal(open, false, gate);
  const market = gatesFor(ONLY("market"), EVERY_GATE);
  assert.equal(market.trade, true);
  assert.equal(market.spot, true);
  assert.equal(market.ladder, true);
  assert.equal(market.earn, false);
  const swap = gatesFor(ONLY("swap"), EVERY_GATE);
  assert.equal(swap.trade, true);
  assert.equal(swap.spot, false, "a limit without the coin's screen is not offered");
  assert.equal(swap.money, true);
  assert.equal(gatesFor(ALL, { ...EVERY_GATE, agentTrade: false }).agentTrade, false);
});

test("each row says what it will do, in English and Ukrainian, numbers the language's own way", () => {
  // A bare number is dollars, which the city pays in USDC.
  assert.equal(askLabel(read("buy JUP for 50"), "en"), "Buy JUP · 50 USDC");
  assert.equal(askLabel(read("buy JUP for 0.5 SOL"), "uk"), "Купити JUP · 0,5 SOL");
  assert.equal(askLabel(read("sell all JUP"), "en"), "Sell JUP · 100%");
  assert.equal(askLabel(read("my portfolio"), "uk"), "Мій портфель");
  assert.equal(askLabel(read("launch $MOON"), "en"), "Launch $MOON");
  assert.equal(askLabel(read("чому SOL росте?"), "uk"), "Спитати: «чому SOL росте?»");
  assert.equal(askLabel({ kind: "mint", mint: SOL }, "en"), "Coin So11…1112");
});

test("a reading handed to the screen it opens is taken once, by the screen at that address only", () => {
  const command = read("swap 1 SOL to JUP");
  const ask = handOff("swap", "/swap", command, "swap 1 SOL to JUP");
  assert.equal(useAsk.getState().ask?.id, ask.id);
  assert.equal(takeAsk("/earn"), null, "another screen takes nothing");
  assert.deepEqual(takeAsk("/swap/"), ask, "the address as the router shows it");
  assert.equal(takeAsk("/swap"), null, "once");
  // The Market's list and a coin's screen are one shelf: only the screen the person lands on takes the sentence.
  handOff("market", `/coin/${JUP}`, read("JUP"), "JUP");
  assert.equal(takeAsk(SHELVES.market.path), null, "the list does not take the coin's sentence");
  const second = handOff("market", `/coin/${BONK}?x=1`, read("BONK"), "BONK");
  assert.equal(second.href, `/coin/${BONK}`);
  assert.equal(takeAsk(`/coin/${JUP}`), null, "a newer sentence replaces one not taken");
  assert.equal(takeAsk(`/coin/${BONK}`)?.said, "BONK");
});

/* Release 20.11: «buy ANT for 1 SOL» — the Anthropic share fell out of the market's top at night and the line said
   «ANT is not on the market». The engine's shelf of verified stocks is a book of coins too. */
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const FAKE = "ANTfake1111111111111111111111111111111111111";
const share = (id, symbol, extra = {}) => ({ id, symbol, name: `${symbol} share`, kind: "stock", verified: true, ...extra });
const SHELF = [share(FAKE, "ANT", { verified: false }), share(ANT, "ANT"), share("XsYzw7XHj8K2WHeoeNQVyevMmzjzXfcJ8tQ4FmdN1DL", "ANTx")];

test("a share out of the market's top: the line opens its page with the amount — by its real address, never a copy's", () => {
  const book = withShelf(BOOK, SHELF);
  for (const said of ["buy ANT for 1 SOL", "buy 1 SOL of ANT", "купи ANT на 1 SOL", "купити ANT на 1 SOL"]) {
    const first = askRows(said, book, NONE, ALL, EVERY_GATE)[0];
    assert.equal(first?.command.kind, "buy", said);
    assert.equal(first.command.coin.mint, ANT, said);
    assert.equal(first.command.amount, "1", said);
    assert.equal(first.command.pay, "SOL", said);
    assert.equal(askHref(first.target, "live"), `/coin/${ANT}`, said);
  }
  // Without the shelf the line knows no ANT: the sentence is a question, the model's reading is asked.
  assert.equal(askRows("buy ANT for 1 SOL", BOOK, NONE, ALL, EVERY_GATE)[0]?.command.kind, "ask");
});

test("the shelf never takes the market's ticker, an unverified or copied coin never joins, other kinds stay out", () => {
  const listed = bookOf([tower(JUP, "JUP", 9e8), tower(BONK, "BONK", 8e8), tower("ANTmarket111111111111111111111111111111111", "ANT", 1e6)]);
  assert.equal(withShelf(listed, SHELF).coins.find((coin) => coin.symbol === "ANT").mint, "ANTmarket111111111111111111111111111111111");
  const book = withShelf(BOOK, [share(FAKE, "ANT", { copyOf: "ANT" }), share(FAKE, "ANT", { verified: false }), { ...share(FAKE, "ANT"), kind: "meme" }]);
  assert.equal(book, BOOK);
  assert.equal(askRows("buy ANT for 1 SOL", book, NONE, ALL, EVERY_GATE)[0]?.command.kind, "ask");
});

test("the model's reading knows the shelf too; an unknown ticker is still «which coin?»", () => {
  const draft = { understood: true, ask: "none", action: "trade", coin: "ANT", strategy: "none", cadence: "none", name: "", symbol: "", numbers: [{ name: "perTradeSol", value: 1 }] };
  const plain = planAnswer(draft, "buy ANT for 1 SOL", BOOK, ALL, EVERY_GATE);
  assert.equal(plain?.kind, "clarify");
  assert.equal(plain.need, "coin");
  const known = planAnswer(draft, "buy ANT for 1 SOL", withShelf(BOOK, SHELF), ALL, EVERY_GATE);
  assert.equal(known?.kind, "row");
  assert.ok(JSON.stringify(known.row.command).includes(ANT), "the plan stands on the share's real address");
  assert.ok(!JSON.stringify(known.row.command).includes(FAKE));
  const unknown = planAnswer({ ...draft, coin: "ZZQX" }, "buy ZZQX for 1 SOL", withShelf(BOOK, SHELF), ALL, EVERY_GATE);
  assert.equal(unknown?.kind, "clarify");
  assert.equal(unknown.need, "coin");
});

test("a token search names a coin only when exactly one verified coin wears that ticker as its own", () => {
  const row = (mint, symbol, extra = {}) => ({ mint, symbol, name: symbol, isVerified: true, isSuspicious: false, ownTicker: true, ...extra });
  assert.equal(foundCoin("ANT", [row(FAKE, "ANT", { isVerified: false }), row(ANT, "ANT"), row("Other111111111111111111111111111111111111111", "ANTX")])?.mint, ANT);
  assert.equal(foundCoin("$ant", [row(ANT, "ANT")])?.mint, ANT);
  assert.equal(foundCoin("ANT", [row(ANT, "ANT"), row(FAKE, "ANT")]), null, "two verified — which one is asked");
  assert.equal(foundCoin("ANT", [row(FAKE, "ANT", { isSuspicious: true })]), null);
  assert.equal(foundCoin("ANT", [row(FAKE, "ANT", { ownTicker: false })]), null);
  assert.equal(foundCoin("ZZQX", [row(ANT, "ANT")]), null);
});
