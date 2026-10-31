import { test } from "node:test";
import assert from "node:assert/strict";

import { EXECUTED, memoryAttempts, orderWith, QUOTE, RECOVERED, scriptedEngine, signingWallet, signWire, T0, TAKER, testClock } from "../trade/test-fixtures.mjs";
import { LSTS } from "./lst.ts";
import { useEarn } from "./open.ts";
import { saverChoice, setSaverEnv, useSaver } from "./saver-store.ts";

// The SOL Saver over the swap engine's recorded answers: the very flow of the trade card, with SOL in and an LST out.
// The wallet is a stub signing with the transcripts' test key; nothing touches a network.

const JUPSOL = LSTS[0];
const PHANTOM = { wallet: "Phantom", address: TAKER };
const HOLDINGS = { owner: TAKER, sol: { spendableRaw: "2410000000", decimals: 9 }, tokens: new Map(), complete: true };

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function scene(script = {}) {
  const order = orderWith({ outputMint: JUPSOL.mint });
  const scripted = scriptedEngine({ quote: [{ status: 200, body: QUOTE }], order: [{ status: 200, body: order }], execute: [{ status: 200, body: EXECUTED }], ...script });
  const attempts = memoryAttempts();
  const clock = testClock(T0 + 1_000);
  const signer = signingWallet(signWire);
  const kept = [];
  const busy = [];
  setSaverEnv({
    engine: scripted.engine,
    attempts: attempts.store,
    now: clock.now,
    sleep: clock.sleep,
    sign: (_connection, wire) => {
      busy.push(useEarn.getState().busy);
      return signer.sign(wire);
    },
    wallet: () => ({ connection: PHANTOM, holdings: HOLDINGS }),
    refreshHoldings: () => undefined,
    keep: (owner, lot) => kept.push({ owner, lot }),
  });
  useEarn.setState({ open: true, tab: "shelf", product: "saver", busy: false });
  useSaver.setState({ lst: "jupsol", typed: "0.1", quote: { status: "none" }, exit: null, review: null, phase: "idle", notice: null, done: null, failed: null, unknown: null });
  return { ...scripted, attempts, kept, busy };
}

test("the amount is checked as the trade card checks a buy paid in SOL", () => {
  assert.equal(saverChoice("jupsol", "0.1", HOLDINGS).amountRaw, "100000000");
  assert.equal(saverChoice("jupsol", "0.1", HOLDINGS).outputMint, JUPSOL.mint);
  assert.equal(saverChoice("jupsol", "5", HOLDINGS).problem?.kind, "balance");
});

test("SOL into JupSOL on the trade card's own routes: price, exact order, one signature; the lot is kept in SOL", async () => {
  const { routes, kept, busy } = scene();
  await useSaver.getState().refreshQuote();
  await flush();
  assert.equal(useSaver.getState().quote.status, "ready");
  assert.deepEqual(routes("quote")[0].body, { inputMint: "So11111111111111111111111111111111111111112", outputMint: JUPSOL.mint, amountRaw: "100000000" });
  assert.equal(routes("quote")[1].body.inputMint, JUPSOL.mint, "the spread back to SOL is priced the same way");
  assert.equal(await useSaver.getState().press(), "ok");
  await flush();
  assert.equal(useSaver.getState().review?.order.order.outputMint, JUPSOL.mint, "the first tap builds the order and shows it");
  assert.equal(routes("execute").length, 0);
  await useSaver.getState().press();
  await flush();
  assert.equal(useSaver.getState().phase, "done");
  assert.deepEqual(busy, [true], "the window holds while the wallet signs");
  assert.equal(useEarn.getState().busy, false, "and lets go once it is over");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].owner, TAKER);
  assert.equal(kept[0].lot.mint, JUPSOL.mint);
  assert.equal(kept[0].lot.lamports, EXECUTED.observation.actualInputRaw);
  assert.equal(kept[0].lot.lstRaw, EXECUTED.observation.actualOutputRaw);
});

test("a signature read back by recovery is never kept as a lot: it may be another surface's swap", async () => {
  const { attempts, kept } = scene({ recover: [{ status: 200, body: RECOVERED }] });
  attempts.store.write({ schema: "ryntra.solana.swap-client-attempt", schemaVersion: "1.0.0", requestId: "r1", signature: RECOVERED.signature, taker: TAKER, state: "SUBMITTED_UNKNOWN", recordedAt: new Date(T0).toISOString() });
  await useSaver.getState().recover();
  await flush();
  assert.equal(useSaver.getState().phase, "done");
  assert.equal(kept.length, 0);
  assert.equal(useEarn.getState().busy, false);
});
