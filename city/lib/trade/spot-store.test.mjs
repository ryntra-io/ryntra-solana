import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanPrice, engineAmount, enginePrice, ownOrders, reviewKey, setSpotEnv, useSpot } from "./spot-store.ts";
import { makeStop, stopsKey } from "./stops.ts";
import { setTradeEnv, useTrade } from "./store.ts";
import { INTENT, orderView, OWNER, review, scriptedLimits, stubWallet, USDC_MINT, WIF } from "./limit-fixtures.mjs";
import { memoryAttempts, QUOTE, scriptedEngine } from "./test-fixtures.mjs";

// The Limit and Stop ticket and «My orders» end to end over stubs: the limits engine and the swap engine answer from
// scripts, the wallet signs stand-ins, the device's storage is a map. Nothing here touches a network or a real wallet.

const NOW = Date.parse("2026-10-28T10:00:00.000Z");
const PHANTOM = { wallet: "Phantom", address: OWNER };
const HOLDINGS = { owner: OWNER, sol: { spendableRaw: "2400000000", decimals: 9 }, tokens: new Map([[WIF, { spendableRaw: "5000000", decimals: 6 }], [USDC_MINT, { spendableRaw: "84200000", decimals: 6 }]]), complete: true, at: NOW };

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function memoryStorage() {
  const map = new Map();
  return { map, read: (key) => map.get(key) ?? null, write: (key, value) => map.set(key, value) };
}

function scene(script = {}, { open = true, wallet = stubWallet(), quote = [{ status: 200, body: QUOTE }] } = {}) {
  const limits = scriptedLimits({ market: [{ status: 200, body: { price: 2.6, quoteUsd: 1 } }], review: [{ status: 200, body: { review: review() } }], orders: [{ status: 200, body: { orders: [], tokens: {}, complete: true } }], submit: [{ status: 200, body: { state: "OPEN", signature: "sigPlace", settled: true } }], ...script });
  const swap = scriptedEngine({ quote });
  const storage = memoryStorage();
  const reads = [];
  let n = 0;
  setSpotEnv({ api: limits.api, engine: swap.engine, sign: (_c, wire) => wallet.sign(wire), now: () => NOW, open, storage, wallet: () => ({ connection: PHANTOM }), refreshHoldings: (delays) => reads.push(delays), later: () => {}, id: () => `id-${++n}` });
  setTradeEnv({ engine: swap.engine, attempts: memoryAttempts().store, now: () => NOW, sleep: async () => {}, wallet: () => ({ connection: PHANTOM, holdings: HOLDINGS }), refreshHoldings: () => {} });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", other: null, mode: "market", held: false, typed: "", review: null, done: null, notice: null });
  useSpot.getState().reset();
  useSpot.setState({ orders: null, cancelling: null, ordersNotice: null, stops: [], stopsOwner: null, expiry: "7d" });
  return { limits, swap, storage, wallet, reads };
}

test("the price and amount go to the engine as plain decimals, a comma read as the point", () => {
  assert.equal(cleanPrice("2,5"), "2.5");
  assert.equal(cleanPrice("1.2.3x"), "1.23");
  assert.equal(enginePrice("2."), "2");
  assert.equal(enginePrice(".5"), "0.5");
  assert.equal(enginePrice("0"), null);
  assert.equal(enginePrice(""), null);
  assert.equal(engineAmount("25000000", 6), "25");
  assert.equal(engineAmount("0", 6), null);
});

test("with the switch shut, the ticket asks the engine for nothing and places nothing", async () => {
  const { limits, swap, storage } = scene({}, { open: false });
  await useSpot.getState().readMarket({ side: "buy", baseMint: WIF, quoteMint: USDC_MINT, mode: "limit" });
  await useSpot.getState().reviewOrder(INTENT);
  useSpot.getState().setStop({ side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" }, null);
  await useSpot.getState().readOrders(true);
  await useSpot.getState().watchStops();
  assert.equal(limits.calls.length, 0);
  assert.equal(swap.calls.length, 0);
  assert.equal(storage.map.size, 0);
  assert.equal(useSpot.getState().phase, "idle");
});

test("a limit: the price starts empty beside the market's, the Review is asked once, one signature places it", async () => {
  const { limits, reads } = scene();
  useSpot.setState({ price: "9" });
  await useSpot.getState().readMarket({ side: "buy", baseMint: WIF, quoteMint: USDC_MINT, mode: "limit" });
  assert.equal(useSpot.getState().price, "", "never a price the person did not type: one at the market fills at once");
  assert.equal(useSpot.getState().market.price, 2.6);
  useSpot.getState().setPrice("2,5");
  assert.equal(useSpot.getState().price, "2.5");

  await useSpot.getState().reviewOrder(INTENT);
  let state = useSpot.getState();
  assert.equal(state.review.review.takingRaw, "10000000");
  assert.equal(limits.routes("submit").length, 0, "a Review never opens the wallet");

  // While the wallet is open the trade card is held.
  const held = [];
  const stop = useTrade.subscribe((trade) => held.push(trade.held));
  await useSpot.getState().placeOrder(INTENT, { coin: "$WIF", unit: "USDC" });
  stop();
  state = useSpot.getState();
  assert.equal(state.phase, "placed");
  assert.equal(state.placed.signature, "sigPlace");
  assert.equal(state.placed.coin, "$WIF");
  assert.ok(held.includes(true));
  assert.equal(useTrade.getState().held, false);
  assert.equal(limits.routes("submit").length, 1);
  assert.equal(limits.routes("orders").length, 1, "«My orders» is read again after a placement");
  assert.equal(reads.length, 1);
});

test("a Review for another price is not placed: the order on screen must be the order typed", async () => {
  const { limits } = scene();
  await useSpot.getState().reviewOrder(INTENT);
  await useSpot.getState().placeOrder({ ...INTENT, price: "2.4" });
  assert.equal(limits.routes("submit").length, 0);
  useSpot.getState().setPrice("2.4");
  assert.equal(useSpot.getState().review, null, "a new price lets the old Review go");
});

test("a stop's price starts empty; a stop is kept on this device; the watch reaches it and opens its sale", async () => {
  const reachedQuote = structuredClone(QUOTE);
  reachedQuote.order.outAmountRaw = "9000000";
  const { storage, swap } = scene({}, { quote: [{ status: 200, body: reachedQuote }] });
  useSpot.setState({ price: "9" });
  await useSpot.getState().readMarket({ side: "sell", baseMint: WIF, quoteMint: USDC_MINT, mode: "stop" });
  assert.equal(useSpot.getState().price, "");

  const input = { side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" };
  useSpot.getState().setStop(input, "12000000");
  assert.equal(useSpot.getState().phase, "set");
  const kept = JSON.parse(storage.map.get(stopsKey(OWNER)));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].thresholdRaw, "10000000");

  const reached = await useSpot.getState().watchStops();
  assert.equal(reached.length, 1);
  assert.deepEqual(swap.routes("quote").at(-1).body, { inputMint: WIF, outputMint: USDC_MINT, amountRaw: "5000000" });
  assert.equal(useSpot.getState().stops[0].state, "reached");
  assert.equal((await useSpot.getState().watchStops()).length, 0, "a reached stop is not asked about again");

  // The sale opens on the card at the market price, for the person to read and sign: nothing is signed by itself.
  useSpot.getState().openSale(reached[0]);
  await flush();
  const trade = useTrade.getState();
  assert.equal(trade.open, true);
  assert.equal(trade.side, "sell");
  assert.equal(trade.mode, "market");
  assert.equal(trade.pay, "USDC");
  assert.equal(trade.typed, "5");
  assert.match(trade.notice.text, /Stop reached at 2 USDC/);
  assert.equal(swap.routes("order").length, 0);

  // The sale settles: the stop is done.
  useTrade.setState({ done: { trade: { signature: "s", inputMint: WIF, outputMint: USDC_MINT, inputRaw: "5000000", outputRaw: "9000000" }, side: "sell", tower: trade.tower, pay: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, decimals: {} } });
  assert.equal(useSpot.getState().stops[0].state, "done");
});

test("a stop already reached at the price now is not kept: the card says to use the market", () => {
  const { storage } = scene();
  const input = { side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" };
  useSpot.getState().setStop(input, "9000000");
  assert.equal(useSpot.getState().phase, "idle");
  assert.match(useSpot.getState().notice.text, /Use Market or set it lower/);
  assert.equal(storage.map.size, 0);
});

test("«My orders»: read from the engine; Cancel is signed once and the list is read again", async () => {
  const { limits, wallet } = scene({
    orders: [{ status: 200, body: { orders: [orderView()], tokens: { [WIF]: { symbol: "WIF", decimals: 6 } }, complete: true } }],
    cancel: [{ status: 200, body: { transactionBase64: "CCCC", requestId: "c1" } }],
    submit: [{ status: 200, body: { state: "CANCELLED", signature: "sigCancel", settled: true } }],
  });
  await useSpot.getState().readOrders();
  let state = useSpot.getState();
  assert.equal(state.orders.status, "ready");
  assert.equal(state.orders.list.length, 1);
  // Read again only when asked, or when old.
  await useSpot.getState().readOrders();
  assert.equal(limits.routes("orders").length, 1);

  await useSpot.getState().cancelOrder(orderView());
  state = useSpot.getState();
  assert.equal(state.cancelling, null);
  assert.match(state.ordersNotice.text, /Order cancelled/);
  assert.deepEqual(wallet.shown, ["CCCC"]);
  assert.equal(limits.routes("submit")[0].body.kind, "cancel");
  assert.equal(limits.routes("orders").length, 2);
});

test("orders that cannot be read are said to be unavailable, never an empty list", async () => {
  scene({ orders: [{ status: 503, body: { error: { code: "TRIGGER_BUSY", message: "busy" } } }] });
  await useSpot.getState().readOrders(true);
  assert.equal(useSpot.getState().orders.status, "failed");
});

test("a stop is let go from «My orders», and another wallet's stops are never shown", () => {
  const { storage } = scene();
  const mine = makeStop({ owner: OWNER, side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" }, NOW, null, "s1").stop;
  const theirs = { ...mine, id: "t1", owner: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" };
  storage.map.set(stopsKey(OWNER), JSON.stringify([mine, theirs]));
  useSpot.getState().loadStops();
  assert.deepEqual(useSpot.getState().stops.map((stop) => stop.id), ["s1"]);
  useSpot.getState().cancelStop("s1");
  assert.deepEqual(useSpot.getState().stops, []);
});

const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

test("a Review belongs to its wallet: another wallet connected after it never signs those bytes", async () => {
  const { limits, wallet } = scene();
  await useSpot.getState().reviewOrder(INTENT);
  assert.ok(useSpot.getState().review);
  assert.notEqual(reviewKey(INTENT), reviewKey({ ...INTENT, owner: OTHER }));
  setSpotEnv({ wallet: () => ({ connection: { wallet: "Phantom", address: OTHER } }) });
  await useSpot.getState().placeOrder({ ...INTENT, owner: OTHER });
  assert.equal(limits.routes("submit").length, 0);
  assert.deepEqual(wallet.shown, [], "the wallet never opened");
  assert.equal(useSpot.getState().phase, "idle");
});

test("«My orders» read for one wallet are never the next wallet's", async () => {
  scene({ orders: [{ status: 200, body: { orders: [orderView()], tokens: {}, complete: true } }] });
  await useSpot.getState().readOrders(true);
  const read = useSpot.getState().orders;
  assert.equal(ownOrders(read, OWNER)?.list.length, 1);
  assert.equal(ownOrders(read, OTHER), null);
  assert.equal(ownOrders(read, null), null);
});

test("while a limit's signature is out the card holds: no other coin, amount or stop's sale lands on it", () => {
  scene();
  const jup = { mint: JUP, symbol: "JUP", name: "Jupiter", icon: null };
  useTrade.setState({ open: true, tower: jup, side: "buy", phase: "idle", held: true, pay: "SOL", other: null, mode: "limit", typed: "", notice: null });
  useTrade.getState().setTyped("3");
  useTrade.getState().setPay("USDC");
  useTrade.getState().setShare(75);
  useTrade.getState().pickCoin({ mint: WIF, symbol: "WIF", decimals: 6 });
  const stop = makeStop({ owner: OWNER, side: "sell", base: { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 }, quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, amountRaw: "5000000", price: "2", expiry: "7d" }, NOW, null, "s1").stop;
  useSpot.getState().openSale(stop);
  const trade = useTrade.getState();
  assert.equal(trade.tower.mint, JUP);
  assert.equal(trade.typed, "");
  assert.equal(trade.pay, "SOL");
  assert.equal(trade.other, null);
  assert.equal(trade.mode, "limit");
  assert.equal(trade.notice, null);
});
