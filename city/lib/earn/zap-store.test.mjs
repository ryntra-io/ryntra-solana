import { test } from "node:test";
import assert from "node:assert/strict";

import { EXECUTED, memoryAttempts, orderWith, scriptedEngine, signingWallet, signWire, T0, TAKER, testClock } from "../trade/test-fixtures.mjs";
import { LSTS } from "./lst.ts";
import { useEarn } from "./open.ts";
import { setZapEnv, useZap, ZAP_MARGIN_PCT, zapKey, zapLamports } from "./zap-store.ts";

// The first half of a copy's Zap over the swap engine's recorded answers: the trade card's own flow, SOL in and the
// pier's other coin out. The wallet is a stub signing with the transcripts' test key; nothing touches a network.

const JUPSOL = LSTS[0];
const PHANTOM = { wallet: "Phantom", address: TAKER };
const LEG = { mint: JUPSOL.mint, symbol: JUPSOL.symbol, decimals: 9, lamports: 100_000_000n };

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene(script = {}) {
  const order = orderWith({ outputMint: JUPSOL.mint });
  const scripted = scriptedEngine({ order: [{ status: 200, body: order }], execute: [{ status: 200, body: EXECUTED }], ...script });
  const attempts = memoryAttempts();
  const clock = testClock(T0 + 1_000);
  const signer = signingWallet(signWire);
  const busy = [];
  const reads = [];
  const sleeps = [];
  setZapEnv({
    engine: scripted.engine,
    attempts: attempts.store,
    now: clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      return clock.sleep(ms);
    },
    sign: (_connection, wire) => {
      busy.push(useEarn.getState().busy);
      return signer.sign(wire);
    },
    refreshHoldings: (delays) => reads.push(delays),
  });
  useEarn.setState({ open: true, tab: "shelf", product: "captain", busy: false });
  useZap.getState().reset();
  return { ...scripted, attempts, busy, reads, sleeps };
}

test("a little over what is missing, never less", () => {
  assert.equal(zapLamports(0n), 0n);
  assert.equal(zapLamports(-5n), 0n);
  assert.equal(zapLamports(100n), 100n + ZAP_MARGIN_PCT);
  assert.equal(zapLamports(1_000_000_000n), 1_030_000_000n);
  assert.equal(zapLamports(1n), 2n, "rounded up");
});

test("the missing coin on the trade card's own routes: the exact order first, one signature, then the wallet read again", async () => {
  const { routes, busy, reads } = scene();
  await useZap.getState().prepare(PHANTOM, LEG);
  await flush();
  assert.deepEqual(routes("order")[0].body.input, { inputMint: "So11111111111111111111111111111111111111112", outputMint: JUPSOL.mint, amountRaw: "100000000", taker: TAKER });
  assert.equal(useZap.getState().review?.key, zapKey(TAKER, LEG));
  assert.equal(routes("execute").length, 0, "nothing is sent before the person taps");

  await useZap.getState().press(PHANTOM, LEG);
  await flush();
  assert.deepEqual(busy, [true], "the window holds while the wallet signs");
  assert.equal(useEarn.getState().busy, false);
  assert.equal(useZap.getState().done?.signature, EXECUTED.observation.signature);
  assert.equal(reads.length, 1, "the wallet is read again for the add");
  assert.equal(routes("execute").length, 1);
});

test("just after a purchase landed nothing is bought again until the wallet's reads are in", async () => {
  const { routes } = scene();
  await useZap.getState().prepare(PHANTOM, LEG);
  await flush();
  await useZap.getState().press(PHANTOM, LEG);
  await flush();
  // The clock's sleep resolves at once in the test: wind back to the moment right after landing.
  useZap.setState({ settling: true });
  await useZap.getState().prepare(PHANTOM, { ...LEG, lamports: 50_000_000n });
  await useZap.getState().press(PHANTOM, { ...LEG, lamports: 50_000_000n });
  await flush();
  assert.equal(routes("order").length, 1);
  assert.equal(routes("execute").length, 1);
});

test("an order refused is said, and not asked again by itself", async () => {
  const { routes } = scene({ order: [{ status: 422, body: { error: { code: "INSUFFICIENT_FUNDS", message: "Not enough SOL." } } }] });
  await useZap.getState().prepare(PHANTOM, LEG);
  await flush();
  assert.equal(useZap.getState().notice?.tone, "error");
  await useZap.getState().prepare(PHANTOM, LEG);
  await flush();
  assert.equal(routes("order").length, 1);
});
