import assert from "node:assert/strict";
import test from "node:test";

import { getBase58Decoder } from "@solana/kit";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { SolanaSubmitRpcError } from "../solana/submit-rpc.ts";
import { ATTEMPT_GRACE_MS, armPaymentAttempt, attemptInFlight, payPaused, payerSignatureOf, readPaymentAttempt, releasePaymentAttempt, sendCertainlyRefused } from "./attempt.ts";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const LIFE = new Date(NOW.getTime() + 60_000).toISOString();
const arm = (store, intentId, signature, now = NOW) => armPaymentAttempt(store, { requestId: "req1", intentId, signature, intentExpiresAt: LIFE, now });

test("one payment on its way per request: a second intent is refused while the first can still land", async () => {
  const store = createMemoryGuardStore();
  const first = await arm(store, "intent-a", "sigA");
  assert.equal(first.ok, true);
  assert.deepEqual(await arm(store, "intent-a", "sigA"), { ok: false, code: "ALREADY_SUBMITTED", signature: "sigA" }, "the same bytes again are the same payment");
  assert.deepEqual(await arm(store, "intent-b", "sigB"), { ok: false, code: "PAYMENT_IN_FLIGHT", signature: "sigA" }, "a retry after a lost answer is not a second payment");
  /* Past the bytes' life and the margin the clock says nothing: only the chain may free the request (supervisor 25.10). */
  const later = new Date(Date.parse(LIFE) + ATTEMPT_GRACE_MS + 1);
  assert.equal(attemptInFlight(await readPaymentAttempt(store, "req1"), later), true, "a slow network must not make a sent payment payable again");
  assert.deepEqual(await arm(store, "intent-b", "sigB", later), { ok: false, code: "PAYMENT_IN_FLIGHT", signature: "sigA" });
});

test("a send the node refused before it took the bytes frees the request at once", async () => {
  const store = createMemoryGuardStore();
  const armed = await arm(store, "intent-a", "sigA");
  assert.equal(await releasePaymentAttempt(store, armed.attempt), true);
  assert.equal(attemptInFlight(await readPaymentAttempt(store, "req1"), NOW), false);
  assert.equal((await arm(store, "intent-b", "sigB")).ok, true);
});

test("two arms at once: exactly one wins", async () => {
  const store = createMemoryGuardStore();
  const results = await Promise.all([arm(store, "intent-a", "sigA"), arm(store, "intent-b", "sigB")]);
  assert.equal(results.filter((result) => result.ok).length, 1);
});

test("what is certainly not sent: a preflight refusal or an HTTP 4xx; a timeout or a 5xx is unknown", () => {
  assert.equal(sendCertainlyRefused(new SolanaSubmitRpcError({ code: -32002, message: "Transaction simulation failed" })), true);
  assert.equal(sendCertainlyRefused(new SolanaSubmitRpcError({ code: -32003, message: "signature verification failure" })), true);
  assert.equal(sendCertainlyRefused(new Error("node.example answered HTTP 429 to sendTransaction")), true);
  assert.equal(sendCertainlyRefused(new Error("node.example answered HTTP 502 to sendTransaction")), false);
  assert.equal(sendCertainlyRefused(new Error("node.example answered HTTP 408 to sendTransaction")), false, "a proxy's timeout may have forwarded the bytes");
  assert.equal(sendCertainlyRefused(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), false);
  assert.equal(sendCertainlyRefused(new SolanaSubmitRpcError({ code: -32005, message: "Node is behind" })), false);
  assert.equal(sendCertainlyRefused(new SolanaSubmitRpcError({ code: -32002, message: "Transaction simulation failed", data: { err: "AlreadyProcessed" } })), false, "already processed is landed, not refused");
});

test("the payer's signature is read from the signed bytes; unsigned bytes have none", () => {
  const payer = Keypair.generate();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey("11111111111111111111111111111112"), lamports: 1 }));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.equal(payerSignatureOf(unsigned, payer.publicKey.toBase58()), null);
  tx.sign(payer);
  const signed = tx.serialize().toString("base64");
  assert.equal(payerSignatureOf(signed, payer.publicKey.toBase58()), getBase58Decoder().decode(tx.signature));
  assert.equal(payerSignatureOf(signed, Keypair.generate().publicKey.toBase58()), null, "not a signer of these bytes");
  assert.equal(payerSignatureOf("not a transaction", payer.publicKey.toBase58()), null);
});

test("the operator's stop: PAUSED stops; unset is open, as before", () => {
  assert.equal(payPaused({ RYNTRA_PAY_STATE: "PAUSED" }), true);
  assert.equal(payPaused({ RYNTRA_PAY_STATE: " paused " }), true);
  assert.equal(payPaused({}), false);
  assert.equal(payPaused({ RYNTRA_PAY_STATE: "OPEN" }), false);
});
