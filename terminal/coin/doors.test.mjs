import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf, fit, parse } from "../../city/lib/command/parse.ts";
import { run } from "../../city/lib/command/run.ts";
import { createEngine } from "../../city/lib/trade/engine.ts";
import { pairKey, setSpotEnv, useSpot } from "../../city/lib/trade/spot-store.ts";
import { setTradeEnv, useTrade } from "../../city/lib/trade/store.ts";
import { coinDoors } from "./doors.ts";

/* A sentence handed to a coin's screen fills its ticket through the trade card's own setters — and never builds an
   order, asks the wallet or sends anything. The real stores; the engine and the wallet are spies. */

const snapshot = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const BOOK = bookOf(snapshot.towers);
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const HOLDINGS = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map([[JUP, { spendableRaw: "5000000000", decimals: 6 }], [USDC, { spendableRaw: "84200000", decimals: 6 }]]), complete: true };
const OPEN = { trade: true, spot: true, money: false, earn: false, launch: false, instruct: false };

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene() {
  const routes = [];
  const signed = [];
  const engine = createEngine(
    async (url) => {
      routes.push(url.split("/").at(-1));
      return { ok: false, status: 503, json: async () => ({ error: { code: "UNAVAILABLE" } }) };
    },
    { wait: async () => {}, timers: { set: () => 0, clear: () => {} } },
  );
  const spy = async (_connection, wire) => (signed.push(wire), { ok: false, reason: "no" });
  const wallet = { connection: { wallet: "Phantom", address: TAKER }, holdings: HOLDINGS };
  setTradeEnv({ engine, sign: spy, wallet: () => wallet, refreshHoldings: () => {}, sleep: async () => {}, now: () => 1_000 });
  setSpotEnv({ sign: spy, wallet: () => wallet, open: true, refreshHoldings: () => {} });
  useTrade.setState({ open: false, tower: null, phase: "idle", held: false, pay: "SOL", other: null, typed: "", review: null, done: null, failed: null, unknown: null });
  useSpot.getState().reset();
  return { routes, signed };
}

const said = (text, mint) => run(fit(parse(text, BOOK, { subject: null }), OPEN), coinDoors(mint));

test("«buy … for 10 USDC» on the coin's screen: its ticket on buying, paid in USDC, the amount written — nothing signed, no order asked", async () => {
  const { routes, signed } = scene();
  said("Купи JUP на 10 USDC", JUP);
  await flush();
  const card = useTrade.getState();
  assert.equal(card.tower?.mint, JUP);
  assert.equal(card.side, "buy");
  assert.equal(card.pay, "USDC");
  assert.equal(card.typed, "10");
  assert.equal(card.review, null);
  assert.equal(signed.length, 0);
  assert.ok(routes.every((route) => route === "quote"), routes.join(","));
});

test("«sell half» fills the sale with half of what the wallet holds", async () => {
  scene();
  said("Sell half of my JUP", JUP);
  await flush();
  const card = useTrade.getState();
  assert.equal(card.side, "sell");
  assert.equal(card.typed, "2500");
});

test("a limit said aloud waits for its field, then writes the price; another way chosen meanwhile lets it go", async () => {
  scene();
  said("Buy JUP at 0.25", JUP);
  const card = useTrade.getState();
  assert.equal(card.mode, "limit");
  assert.equal(card.pay, "USDC", "a price said aloud is dollars");
  assert.equal(useSpot.getState().price, "");
  useSpot.setState({ priceFor: `limit|${pairKey("buy", JUP, USDC)}`, phase: "idle" });
  await flush();
  assert.equal(useSpot.getState().price, "0.25");

  scene();
  said("Buy JUP at 0.25", JUP);
  useTrade.getState().setMode("market");
  useSpot.setState({ priceFor: `limit|${pairKey("buy", JUP, USDC)}`, phase: "idle" });
  await flush();
  assert.equal(useSpot.getState().price, "", "the price was the limit's, and the limit was let go");
});

test("a sentence about another coin, or a ticket under a signature, is never written into", async () => {
  scene();
  said("Купи SOL на 10 USDC", JUP);
  assert.equal(useTrade.getState().open, false, "the screen of JUP does not open SOL's ticket");

  scene();
  useTrade.getState().openFor({ id: JUP, symbol: "JUP", name: "Jupiter", icon: null }, "buy");
  useTrade.setState({ phase: "wallet", typed: "1" });
  said("Sell half of my JUP", JUP);
  assert.equal(useTrade.getState().side, "buy");
  assert.equal(useTrade.getState().typed, "1", "a signature out keeps the ticket as it is");
  useTrade.setState({ phase: "idle" });
});

test("the chart and the coin itself need nothing opened: the screen is them already", () => {
  scene();
  const doors = coinDoors(SOL);
  assert.doesNotThrow(() => said("Покажи графік SOL", SOL));
  assert.equal(useTrade.getState().open, false);
  for (const name of ["openChart", "openCoin", "openMint", "openMoney", "openEarn", "openLaunch", "askRyntra", "openAutopilot", "openLadder"]) assert.equal(typeof doors[name], "function", name);
});
