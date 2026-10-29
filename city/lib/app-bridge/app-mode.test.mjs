import { test } from "node:test";
import assert from "node:assert/strict";

import { attachAppBridge } from "./page.ts";
import { createFakeApp, fakeAppTransport } from "./mock.ts";
import { setTradeEnv, useTrade } from "../trade/store.ts";
import { APP_WALLET, startWallets, useWallet } from "../trade/wallet.ts";
import { EXECUTED, memoryAttempts, ORDER, QUOTE, scriptedEngine, signWire, T0, TAKER, testClock, USDT } from "../trade/test-fixtures.mjs";
import { TAKER_PRIVATE_KEY_PKCS8 } from "../../../app/api/solana/swap/golden/fixtures.mjs";

// CITY-6b in the city itself: with the page in the app, the trade card's own signing path (the store's default, not a
// stub) reaches the app's wallet through the bridge, and the city's wallet store is the app's. The fake app holds the
// golden transcripts' test key, so it signs exactly the bytes the engine's recorded order expects.

const TAKER_SEED = new Uint8Array(Buffer.from(TAKER_PRIVATE_KEY_PKCS8, "base64").subarray(-32));
const TOWER = { id: USDT, symbol: "USDT", name: "Tether", icon: null, district: "core", price: 1, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 90, verified: true, launchedAt: null };
const HOLDINGS = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map(), complete: true };

const flush = async () => {
  for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const app = createFakeApp({ secretKey: TAKER_SEED, name: "Seed Vault", connected: true });
attachAppBridge({ addEventListener() {}, removeEventListener() {} }, { transport: fakeAppTransport(app) });
await app.ready();
await flush();

function scene() {
  const scripted = scriptedEngine({ quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }] });
  const clock = testClock(T0 + 1_000);
  // Everything but `sign`: the card signs the way it does on ryntra.io.
  setTradeEnv({
    engine: scripted.engine,
    attempts: memoryAttempts().store,
    now: clock.now,
    sleep: clock.sleep,
    wallet: () => ({ connection: { wallet: "Seed Vault", address: TAKER }, holdings: HOLDINGS }),
    refreshHoldings: () => {},
    card: async () => ({ ok: false, code: "UNAVAILABLE" }),
    prove: async () => ({ ok: true }),
  });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", typed: "", review: null, done: null, failed: null, unknown: null, optimistic: {}, celebrate: null, notice: null });
  return scripted;
}

test("a trade in the app: the engine's order bytes go to the app's wallet, the signed bytes to the same execute route", async () => {
  const { routes } = scene();
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  await useTrade.getState().press();
  await flush();

  const asked = app.requests.filter((request) => request.type === "wallet.signTransactions");
  assert.equal(asked.length, 1, "one wallet window");
  assert.deepEqual(asked[0].transactions, [ORDER.order.transactionBase64], "exactly the engine's bytes");
  assert.equal(routes("execute").length, 1);
  assert.equal(JSON.stringify(routes("execute")[0].body).includes(signWire(ORDER.order.transactionBase64).wire), true, "the app's signature over the same bytes is what execute carries");
  assert.equal(useTrade.getState().phase, "done");
});

test("a no in the app's wallet sends nothing and asks no other wallet", async () => {
  const { routes } = scene();
  app.once("wallet.signTransactions", "decline");
  useTrade.getState().openFor(TOWER);
  await flush();
  await useTrade.getState().prepare(true);
  const before = app.requests.length;
  await useTrade.getState().press();
  await flush();
  assert.equal(app.requests.length, before + 1);
  assert.equal(routes("execute").length, 0);
  assert.equal(useTrade.getState().phase, "idle");
  assert.equal(useTrade.getState().notice?.text, "Cancelled in your wallet. Nothing was sent.");
});

test("the city's wallet in the app is the app's: one choice, connected through the bridge, following wallet.changed", async () => {
  const links = [];
  globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  globalThis.document = { addEventListener: (type) => links.push(type), removeEventListener() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    startWallets();
    let state = useWallet.getState();
    assert.deepEqual(state.wallets.map((wallet) => wallet.name), ["Seed Vault"], "only the app's wallet, by the name the app gave");
    assert.deepEqual(state.connection, { wallet: "Seed Vault", address: TAKER, chains: ["solana:mainnet"] }, "the wallet the app already holds");
    assert.deepEqual(links, ["click"], "links that leave the city open outside it");

    await app.changeWallet(false);
    await flush();
    assert.equal(useWallet.getState().connection, null);
    assert.equal(useWallet.getState().wallets[0].name, APP_WALLET);

    const ok = await useWallet.getState().connect(APP_WALLET);
    state = useWallet.getState();
    assert.equal(ok, true);
    assert.equal(state.connection.address, TAKER);
    assert.equal(app.requests.at(-1).type, "wallet.connect");

    app.once("wallet.connect", "decline");
    useWallet.getState().disconnect();
    await flush();
    assert.equal(app.requests.at(-1).type, "wallet.disconnect");
    assert.equal(await useWallet.getState().connect(APP_WALLET), false);
    assert.equal(useWallet.getState().error, null, "closing the wallet is an answer, not an error");
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
    delete globalThis.document;
  }
});
