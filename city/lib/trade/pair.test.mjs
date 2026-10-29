import { test } from "node:test";
import assert from "node:assert/strict";

import { coinMatches, suggestedCoins, walletCoins } from "./pair.ts";
import { choiceOf, payKey, setTradeEnv, useTrade } from "./store.ts";
import { sizingOf, spendMax, startAmount } from "./size.ts";
import { isBase, payAssetFor, payOptionsFor, SOL, unitOf, USDC } from "./tiles.ts";
import { holdingsOf } from "./wallet.ts";
import { memoryAttempts, ORDER, QUOTE, scriptedEngine, signingWallet, signWire, T0, TAKER, testClock, USDT, WSOL } from "./test-fixtures.mjs";

// Any coin for any coin on the trade card: the wallet's coins to pay with, any coin found to be paid in, the shares and
// the exact mints the engine is asked about. No network: the engine answers from its recorded transcripts.

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const NAMELESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const JUP_ASSET = { mint: JUP, symbol: "JUP", name: "Jupiter", decimals: 6, verified: true };
const BONK_FOUND = { mint: BONK, symbol: "BONK", name: "Bonk", decimals: null, verified: true };

const rows = [
  { kind: "NATIVE_SOL", mint: null, spendableRaw: "2400000000", decimals: 9, symbol: "SOL" },
  { kind: "TOKEN", mint: USDC.mint, spendableRaw: "84200000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
  { kind: "TOKEN", mint: JUP, spendableRaw: "120000000", decimals: 6, symbol: "JUPx", catalog: { symbol: "JUP", name: "Jupiter", isVerified: true, icon: "https://static.jup.ag/jup/icon.png" } },
  { kind: "TOKEN", mint: WIF, spendableRaw: "5000000", decimals: 6, symbol: "WIF", name: "dogwifhat", catalog: null },
  { kind: "TOKEN", mint: NAMELESS, spendableRaw: "1", decimals: 0 },
  { kind: "TOKEN", mint: BONK, spendableRaw: "0", decimals: 5, catalog: { symbol: "BONK" } },
];
const HOLDINGS = holdingsOf(TAKER, rows, true, T0);

test("a tower is paid with SOL, USDC or the other coin picked; never with itself, never one coin twice", () => {
  assert.deepEqual(payOptionsFor(WIF, JUP_ASSET), [SOL, USDC, JUP_ASSET]);
  assert.deepEqual(payOptionsFor(JUP, JUP_ASSET), [SOL, USDC]);
  assert.deepEqual(payOptionsFor(WIF, USDC), [SOL, USDC]);
  assert.equal(payAssetFor(WIF, JUP, JUP_ASSET), JUP_ASSET);
  // The other coin is picked by its mint, SOL and USDC by their symbols; a symbol never picks the other coin.
  assert.equal(payAssetFor(WIF, "JUP", JUP_ASSET), SOL);
  assert.equal(payAssetFor(JUP, JUP, JUP_ASSET), SOL);
  assert.equal(payKey(JUP_ASSET), JUP);
  assert.equal(payKey(USDC), "USDC");
  assert.equal(unitOf(JUP_ASSET), "$JUP");
  assert.equal(unitOf(SOL), "SOL");
  assert.ok(isBase(USDC) && !isBase(JUP_ASSET));
});

test("paying with another coin of the wallet: shares of it, a quarter first", () => {
  const max = spendMax({ spendableRaw: "120000000", decimals: 6 }, false, true);
  assert.deepEqual(sizingOf(max, null).chips.map((chip) => chip.amountRaw), ["30000000", "60000000", "90000000", "120000000"]);
  assert.equal(startAmount("buy", JUP_ASSET, max), 30_000_000n);
  assert.ok(sizingOf(null, null).chips.every((chip) => !chip.usable));
});

test("the engine's holdings name the wallet's coins: Jupiter's name first, the mint's own after, never a guess", () => {
  assert.deepEqual(HOLDINGS.names.get(JUP), { symbol: "JUP", name: "Jupiter", verified: true, icon: `/api/spot/icon?mint=${JUP}&u=${encodeURIComponent("https://static.jup.ag/jup/icon.png")}` });
  assert.deepEqual(HOLDINGS.names.get(WIF), { symbol: "WIF", name: "dogwifhat", verified: null, icon: null });
  assert.equal(HOLDINGS.names.has(NAMELESS), false);
  // A coin with nothing to spend is not held.
  assert.equal(HOLDINGS.tokens.has(BONK), false);

  const coins = walletCoins(HOLDINGS, [{ id: WIF, symbol: "WIF", name: "dogwifhat", verified: true, icon: "x" }]);
  assert.deepEqual(coins.map((coin) => coin.asset.symbol), ["SOL", "USDC", "JUP", "WIF", "9xQe…VFin"]);
  assert.equal(coins[0].asset, SOL);
  assert.equal(coins[1].asset, USDC);
  assert.equal(coins[2].amount, "120");
  assert.equal(coins[3].asset.verified, true, "a verified tower vouches for its coin");
  assert.equal(coins[3].asset.icon, `/api/icon/${WIF}`);
  assert.equal(coins[4].asset.verified, null);
  assert.deepEqual(walletCoins(null), []);
});

test("the picker's list answers a ticker, a name, a word of the name, or a pasted mint", () => {
  assert.ok(coinMatches(JUP_ASSET, "ju"));
  assert.ok(coinMatches(JUP_ASSET, "$jup"));
  assert.ok(coinMatches({ mint: WIF, symbol: "WIF", name: "dog wif hat" }, "hat"));
  assert.ok(coinMatches(JUP_ASSET, ` ${JUP} `));
  assert.ok(!coinMatches(JUP_ASSET, WIF));
  assert.ok(!coinMatches(JUP_ASSET, "bonk"));
  assert.ok(coinMatches(JUP_ASSET, ""));
});

test("with nothing typed, the coins to get are SOL, USDC and the busiest verified towers, without the coin traded", () => {
  const towers = [
    { id: WIF, symbol: "WIF", name: "dogwifhat", verified: true, volume24h: 10 },
    { id: BONK, symbol: "$BONK", name: "Bonk", verified: true, volume24h: 50 },
    { id: NAMELESS, symbol: "X", name: "x", verified: false, volume24h: 999 },
    { id: SOL.mint, symbol: "SOL", name: "Solana", verified: true, volume24h: 1000 },
  ];
  const listed = suggestedCoins(towers, new Set([WIF]));
  assert.deepEqual(listed.map((asset) => asset.symbol), ["SOL", "USDC", "BONK"]);
  assert.equal(listed[2].decimals, null, "a coin found to be received has its decimals from the engine's quote");
});

test("the card's choice for any pair: what is spent, in whose units, and the exact mints", () => {
  const tower = { mint: WIF, symbol: "WIF", name: "dogwifhat", icon: null };
  const buy = choiceOf(tower, "buy", HOLDINGS, { pay: JUP, other: JUP_ASSET, typed: "120" });
  assert.equal(buy.pay, JUP_ASSET);
  assert.equal(buy.inputMint, JUP);
  assert.equal(buy.outputMint, WIF);
  assert.equal(buy.spendUnit, "$JUP");
  assert.equal(buy.spendDecimals, 6);
  assert.equal(buy.amountRaw, "120000000");
  assert.equal(buy.sizing.chips[3].on, true);
  assert.equal(buy.key, `buy:${JUP}>${WIF}:120000000`);
  assert.equal(buy.options.length, 3);

  const typed = choiceOf(tower, "buy", HOLDINGS, { pay: JUP, other: JUP_ASSET, typed: "200" });
  assert.equal(typed.problem.kind, "balance");
  assert.equal(typed.problem.text, "You have 120 $JUP. Type that or less.");

  const sell = choiceOf(tower, "sell", HOLDINGS, { pay: BONK, other: BONK_FOUND, typed: "5" });
  assert.equal(sell.inputMint, WIF);
  assert.equal(sell.outputMint, BONK);
  assert.equal(sell.spendUnit, "$WIF");
  assert.equal(sell.spendDecimals, 6);
  assert.equal(sell.amountRaw, "5000000");
  assert.equal(sell.all, true);
});

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene(holdings = HOLDINGS) {
  const scripted = scriptedEngine({ quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }] });
  const clock = testClock(T0 + 1_000);
  const signer = signingWallet(signWire);
  setTradeEnv({
    engine: scripted.engine,
    attempts: memoryAttempts().store,
    now: clock.now,
    sleep: clock.sleep,
    sign: (_connection, wire) => signer.sign(wire),
    wallet: () => ({ connection: { wallet: "Phantom", address: TAKER }, holdings }),
    refreshHoldings: () => {},
  });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", other: null, mode: "market", held: false, typed: "", review: null, done: null, failed: null, unknown: null, optimistic: {}, celebrate: null });
  return scripted;
}

const WIF_TOWER = { id: WIF, symbol: "WIF", name: "dogwifhat", icon: null };

test("paying with a coin of the wallet asks the engine for that coin into the tower, through the same routes", async () => {
  const { routes } = scene();
  useTrade.getState().openFor(WIF_TOWER);
  await flush();
  useTrade.getState().pickCoin(JUP_ASSET);
  await flush();
  const state = useTrade.getState();
  assert.equal(state.pay, JUP);
  assert.equal(state.other, JUP_ASSET);
  assert.equal(state.typed, "30");
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: JUP, outputMint: WIF, amountRaw: "30000000" });
  await state.prepare(false);
  assert.deepEqual(routes("order").at(-1).body.input, { inputMint: JUP, outputMint: WIF, amountRaw: "30000000", taker: TAKER });
  assert.deepEqual(routes("order").at(-1).body.origin, { surface: "SPOT", side: "BUY" });
});

test("selling into any coin found: the sale is priced into that coin; SOL and USDC stay one tap away", async () => {
  const { routes } = scene();
  useTrade.getState().openFor(WIF_TOWER, "sell");
  await flush();
  useTrade.getState().pickCoin(BONK_FOUND);
  await flush();
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: WIF, outputMint: BONK, amountRaw: "5000000" });
  useTrade.getState().setPay("USDC");
  await flush();
  assert.deepEqual(routes("quote").at(-1).body, { inputMint: WIF, outputMint: USDC.mint, amountRaw: "5000000" });
  // Picking the coin traded itself changes nothing.
  useTrade.getState().pickCoin({ mint: WIF, symbol: "WIF", decimals: 6 });
  assert.equal(useTrade.getState().pay, "USDC");
});

test("a coin found to be paid in is not one to pay with: buying falls back to SOL until the wallet holds it", async () => {
  const { routes } = scene();
  useTrade.getState().openFor(WIF_TOWER, "sell");
  await flush();
  useTrade.getState().pickCoin(BONK_FOUND);
  await flush();
  useTrade.getState().setSide("buy");
  await flush();
  assert.equal(useTrade.getState().pay, "SOL");
  assert.equal(routes("quote").at(-1).body.inputMint, WSOL);
});

test("another coin on the same card keeps the side, the way to trade and what pays", async () => {
  scene();
  useTrade.getState().openFor(WIF_TOWER);
  await flush();
  useTrade.getState().pickCoin(JUP_ASSET);
  useTrade.setState({ mode: "limit" });
  useTrade.getState().openFor({ id: USDT, symbol: "USDT", name: "Tether", icon: null }, "buy", { mode: "limit" });
  await flush();
  const state = useTrade.getState();
  assert.equal(state.tower.mint, USDT);
  assert.equal(state.mode, "limit");
  assert.equal(state.pay, JUP);
});

test("away from Market the card never builds or signs a market order", async () => {
  const { routes, engine } = scene();
  void engine;
  useTrade.getState().openFor(WIF_TOWER, "buy", { mode: "limit" });
  await flush();
  await useTrade.getState().prepare(true);
  assert.equal(await useTrade.getState().press(), "ok");
  assert.equal(routes("order").length, 0);
  useTrade.getState().setMode("market");
  await useTrade.getState().prepare(false);
  assert.equal(routes("order").length, 1);
});

test("a limit's signature out holds the card: it cannot be closed, switched or replaced", async () => {
  scene();
  useTrade.getState().openFor(WIF_TOWER, "buy", { mode: "limit" });
  await flush();
  useTrade.setState({ held: true });
  useTrade.getState().close();
  useTrade.getState().setSide("sell");
  useTrade.getState().setMode("market");
  useTrade.getState().openFor({ id: USDT, symbol: "USDT", name: "Tether", icon: null });
  const state = useTrade.getState();
  assert.equal(state.open, true);
  assert.equal(state.side, "buy");
  assert.equal(state.mode, "limit");
  assert.equal(state.tower.mint, WIF);
  useTrade.setState({ held: false });
});
