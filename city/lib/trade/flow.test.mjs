import { test } from "node:test";
import assert from "node:assert/strict";

import { confirmTrade, prepareOrder, recoverTrade, RECOVERY_DEADLINE_MS } from "./flow.ts";
import {
  EXECUTED,
  memoryAttempts,
  ORDER,
  orderWith,
  RECEIPTED,
  RECOVERED,
  recorded,
  scriptedEngine,
  signingWallet,
  signWire,
  T0,
  TAKER,
  testClock,
  USDT,
  WSOL,
} from "./test-fixtures.mjs";

// The trade the transcripts record: 0.01 SOL into USDT for the transcripts' test wallet.
const INTENT = { side: "buy", inputMint: WSOL, outputMint: USDT, amountRaw: "10000000", taker: TAKER };
const SIGNATURE = EXECUTED.signature;

function setup(script, { wallet, walletOutOfTime = false } = {}) {
  const scripted = scriptedEngine(script);
  const attempts = memoryAttempts();
  const clock = testClock(T0 + 1_000);
  const signer = wallet ?? signingWallet(signWire);
  const phases = [];
  // The wallet's time runs out only when a test says so.
  const walletDeadline = () => ({ done: walletOutOfTime ? Promise.resolve() : new Promise(() => {}), cancel: () => {} });
  const deps = { engine: scripted.engine, sign: signer.sign, attempts: attempts.store, now: clock.now, sleep: clock.sleep, walletDeadline, onPhase: (phase) => phases.push(phase) };
  return { ...scripted, attempts, clock, signer, phases, deps };
}

test("the exact order is built for the wallet and checked before any wallet sees it", async () => {
  const { deps, routes } = setup({ order: [{ status: 200, body: ORDER }] });
  const prepared = await prepareOrder(INTENT, deps);
  assert.equal(prepared.kind, "ready");
  assert.equal(prepared.order.order.taker, TAKER);
  assert.deepEqual(routes("order")[0].body.origin, { surface: "SPOT", side: "BUY" });
});

test("an order without the issuer's proof never reaches a wallet", async () => {
  const unsigned = structuredClone(ORDER);
  unsigned.proof = { ...unsigned.proof, status: "UNSIGNED" };
  const { deps } = setup({ order: [{ status: 200, body: unsigned }] });
  const prepared = await prepareOrder(INTENT, deps);
  assert.equal(prepared.kind, "refused");
  assert.equal(prepared.refusal.code, "PROOF_NOT_SIGNED");
});

test("an engine refusal comes back in plain words", async () => {
  const noRoute = recorded("order refused: Jupiter finds no route");
  const { deps } = setup({ order: [noRoute] });
  const prepared = await prepareOrder(INTENT, deps);
  assert.deepEqual(prepared, { kind: "refused", refusal: { code: "ORDER_NO_ROUTE", message: "No route for this pair right now.", retryable: true } });
});

test("a wallet with a signature already out is read back before anything new", async () => {
  const locked = recorded("order refused: the owner holds a signature the server claimed");
  const { deps } = setup({ order: [locked] });
  const prepared = await prepareOrder(INTENT, deps);
  assert.equal(prepared.kind, "locked");
  assert.equal(prepared.attempt.signature, locked.body.error.ownerLock.signature);
  assert.equal(prepared.attempt.state, "SUBMITTED_UNKNOWN");
  assert.equal(prepared.attempt.taker, TAKER);
});

test("one tap: the wallet signs the shown bytes, they are sent once and read back settled", async () => {
  const { deps, routes, signer, attempts, phases } = setup({ execute: [{ status: 200, body: EXECUTED }] });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "settled");
  assert.deepEqual(outcome.trade, { signature: SIGNATURE, inputMint: WSOL, outputMint: USDT, inputRaw: "10000000", outputRaw: "1500000" });
  // The wallet saw exactly the order's bytes; the engine got them back with the signature.
  assert.deepEqual(signer.shown, [ORDER.order.transactionBase64]);
  const sent = routes("execute");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.reviewedTransactionBase64, ORDER.order.transactionBase64);
  assert.equal(sent[0].body.signedTransactionBase64, signWire(ORDER.order.transactionBase64).wire);
  assert.deepEqual(sent[0].body.bundle, ORDER.bundle);
  // Written down before the send, let go once settled.
  assert.deepEqual(attempts.log, ["SIGNED_NOT_SENT", "CLEARED"]);
  assert.deepEqual(phases, ["wallet", "sending"]);
});

test("a wallet that says no sends nothing", async () => {
  const { deps, routes, attempts } = setup({}, { wallet: { sign: async () => ({ ok: false, reason: "Phantom refused to sign." }) } });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.deepEqual(outcome, { kind: "cancelled", message: "Phantom refused to sign." });
  assert.equal(routes("execute").length, 0);
  assert.deepEqual(attempts.log, []);
});

test("bytes a wallet changed beyond its own guards are never sent", async () => {
  const changed = {
    sign: async (wire) => {
      const bytes = Buffer.from(signWire(wire).wire, "base64");
      bytes[bytes.length - 1] ^= 0xff;
      return { ok: true, signedWireBase64: bytes.toString("base64") };
    },
  };
  const { deps, routes } = setup({}, { wallet: changed });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "refused");
  assert.equal(outcome.refusal.code, "WALLET_MODIFIED_BYTES");
  assert.equal(routes("execute").length, 0);
});

test("a wallet that never answers is outlived by its bytes: fresh figures, nothing sent", async () => {
  const silent = { sign: () => new Promise(() => {}) };
  const { deps, routes } = setup({ order: [{ status: 200, body: ORDER }] }, { wallet: silent, walletOutOfTime: true });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "review");
  assert.match(outcome.note, /Nothing was sent/);
  assert.equal(routes("execute").length, 0);
});

test("dying bytes are built fresh at the tap and signed when no worse than shown", async () => {
  const { deps, routes, clock, signer } = setup({ order: [{ status: 200, body: ORDER }], execute: [{ status: 200, body: EXECUTED }] });
  // 15 s after the order arrived, less than a wallet's window is left of its 19 s.
  clock.advance(15_000);
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "settled");
  assert.equal(routes("order").length, 1);
  assert.equal(signer.shown.length, 1);
});

test("fresh bytes that are worse than what was shown go back to the card, unsigned", async () => {
  const worse = orderWith({ minReceivedRaw: "1400000" });
  const { deps, routes, clock, signer } = setup({ order: [{ status: 200, body: worse }] });
  clock.advance(15_000);
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.order.order.minReceivedRaw, "1400000");
  assert.equal(signer.shown.length, 0);
  assert.equal(routes("execute").length, 0);
});

test("refused before the send: the signature is let go and fresh figures are shown", async () => {
  const expired = recorded("execute refused before submit: the Review window has closed");
  const { deps, attempts, routes } = setup({ execute: [expired], order: [{ status: 200, body: ORDER }] });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "review");
  assert.deepEqual(attempts.log, ["SIGNED_NOT_SENT", "CLEARED"]);
  assert.equal(routes("execute").length, 1);
});

test("a newer order elsewhere replaced this one: nothing was sent, said plainly", async () => {
  const replaced = recorded("execute refused before submit: a newer order replaced the Review");
  const { deps, attempts } = setup({ execute: [replaced] });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "refused");
  assert.match(outcome.refusal.message, /Nothing was sent/);
  assert.equal(attempts.current, null);
});

test("landed and failed: only the network fee moved", async () => {
  const landed = recorded("execute: the transaction landed and failed on chain");
  const { deps, attempts } = setup({ execute: [landed] });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.deepEqual(outcome, { kind: "failed", signature: SIGNATURE });
  assert.equal(attempts.current, null);
});

test("an unclear send is read back by its signature, never sent again", async () => {
  const unanswered = recorded("execute: Jupiter does not answer and the chain has not seen it");
  const { deps, routes, attempts, phases } = setup({
    execute: [unanswered],
    recover: [{ status: 200, body: { state: "PENDING", signature: SIGNATURE, reason: "Not yet." } }, { status: 200, body: RECOVERED }],
  });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "settled");
  assert.equal(outcome.trade.outputRaw, "1500000");
  assert.equal(routes("execute").length, 1);
  assert.equal(routes("recover").length, 2);
  assert.deepEqual(routes("recover")[0].body, { owner: TAKER, signature: SIGNATURE, requestId: ORDER.order.requestId });
  assert.deepEqual(attempts.log, ["SIGNED_NOT_SENT", "SUBMITTED_UNKNOWN", "CLEARED"]);
  assert.deepEqual(phases, ["wallet", "sending", "checking"]);
});

test("a send whose answer was lost is treated as possibly sent", async () => {
  const { deps, routes, attempts } = setup({ execute: ["network"], recover: [{ status: 200, body: RECEIPTED }] });
  const outcome = await confirmTrade({ intent: INTENT, order: ORDER, receivedAt: T0 + 1_000 }, deps);
  assert.equal(outcome.kind, "settled");
  assert.equal(routes("execute").length, 1);
  assert.deepEqual(attempts.log, ["SIGNED_NOT_SENT", "SUBMITTED_UNKNOWN", "CLEARED"]);
});

const ATTEMPT = {
  schema: "ryntra.solana.swap-client-attempt",
  schemaVersion: "1.0.0",
  requestId: "golden-order-0001",
  signature: SIGNATURE,
  taker: TAKER,
  state: "SUBMITTED_UNKNOWN",
  recordedAt: new Date(T0).toISOString(),
};

test("reading back: what the chain says decides, and a never-sent signature is let go", async () => {
  for (const [body, kind] of [
    [{ state: "UNKNOWN_TO_CHAIN", signature: SIGNATURE, reason: "Never seen." }, "nothing"],
    [{ state: "EXPIRED_AFTER_SUBMIT", signature: SIGNATURE, blockhashValid: false, lastValidBlockHeight: "1" }, "nothing"],
    [{ state: "EXPIRED_BEFORE_SUBMIT", signature: SIGNATURE, blockhashValid: false, lastValidBlockHeight: "1" }, "nothing"],
    [{ state: "FAILED", signature: SIGNATURE, reason: "Failed.", chainError: null }, "failed"],
    [RECOVERED, "settled"],
    [RECEIPTED, "settled"],
  ]) {
    const { deps, attempts } = setup({ recover: [{ status: 200, body }] });
    attempts.store.write(ATTEMPT);
    const outcome = await recoverTrade(ATTEMPT, deps, { inputMint: WSOL, outputMint: USDT });
    assert.equal(outcome.kind, kind, body.state);
    assert.equal(attempts.current, null, body.state);
  }
});

test("reading back keeps the signature while the outcome is unknown", async () => {
  const { deps, attempts, routes } = setup({ recover: [{ status: 200, body: { state: "PENDING", signature: SIGNATURE, reason: "Not yet." } }] });
  attempts.store.write(ATTEMPT);
  const outcome = await recoverTrade(ATTEMPT, deps);
  assert.equal(outcome.kind, "unknown");
  assert.equal(attempts.current, ATTEMPT);
  // Every few seconds, for as long as a blockhash could still carry it, then it stops asking.
  assert.ok(routes("recover").length >= RECOVERY_DEADLINE_MS / 3_000);
  assert.ok(routes("recover").length <= RECOVERY_DEADLINE_MS / 3_000 + 2);

  const seen = setup({ recover: [{ status: 200, body: { state: "SEEN_WITHOUT_RECORD", signature: SIGNATURE, reason: "Seen." } }] });
  seen.attempts.store.write(ATTEMPT);
  assert.equal((await recoverTrade(ATTEMPT, seen.deps)).kind, "unknown");
  assert.equal(seen.attempts.current, ATTEMPT);

  const unreachable = setup({ recover: ["network"] });
  unreachable.attempts.store.write(ATTEMPT);
  const lost = await recoverTrade(ATTEMPT, unreachable.deps);
  assert.equal(lost.kind, "unknown");
  assert.equal(unreachable.routes("recover").length, 2);
  assert.equal(unreachable.attempts.current, ATTEMPT);
});
