// Run from repo root: node --test lib/solana/limits/trigger-tx.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { VersionedTransaction } from "@solana/web3.js";

import { TRIGGER_V1_PROGRAM } from "./model.ts";
import { decodeInitializeOrder, inspectTriggerTransaction, signedByFeePayer } from "./trigger-tx.ts";

/* Unsigned transactions Jupiter's createOrder and cancelOrder returned on 2026-10-15 (keyless; nothing was signed or sent). */
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/trigger-v1-2026-10-15.json", import.meta.url), "utf8"));
const maker = fixtures.maker;

function createExpectation(name, overrides = {}) {
  const request = fixtures[name].request;
  return {
    kind: "create",
    owner: maker,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    makingRaw: request.params.makingAmount,
    takingRaw: request.params.takingAmount,
    feeAccount: request.feeAccount ?? null,
    feeBps: request.params.feeBps ? Number(request.params.feeBps) : null,
    ...overrides,
  };
}

test("Jupiter's own order transactions pass as reviewed", () => {
  for (const name of ["buyWithFee", "buyNoFee", "sellSolWithFee"]) {
    const verdict = inspectTriggerTransaction(fixtures[name].transaction, createExpectation(name));
    assert.equal(verdict.ok, true, `${name}: ${verdict.reason}`);
    assert.equal(verdict.order, fixtures[name].order);
  }
  const cancel = inspectTriggerTransaction(fixtures.cancel.transaction, { kind: "cancel", owner: fixtures.cancel.maker, order: fixtures.cancel.order });
  assert.equal(cancel.ok, true, cancel.reason);
});

test("an order whose amounts, tokens, fee or owner differ from the review is refused", () => {
  const tx = fixtures.buyWithFee.transaction;
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyWithFee", { takingRaw: "199999999" })).ok, false);
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyWithFee", { outputMint: fixtures.sellSolWithFee.request.outputMint })).ok, false);
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyWithFee", { feeBps: 50 })).ok, false);
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyWithFee", { feeAccount: null, feeBps: null })).ok, false);
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyWithFee", { owner: fixtures.cancel.maker })).ok, false);
  /* A fee the review did not name. */
  assert.equal(inspectTriggerTransaction(tx, createExpectation("buyNoFee")).ok, false);
});

test("a cancellation of another order, or a creation passed off as one, is refused", () => {
  assert.equal(inspectTriggerTransaction(fixtures.cancel.transaction, { kind: "cancel", owner: fixtures.cancel.maker, order: fixtures.buyNoFee.order }).ok, false);
  assert.equal(inspectTriggerTransaction(fixtures.buyNoFee.transaction, { kind: "cancel", owner: maker, order: fixtures.buyNoFee.order }).ok, false);
});

test("an instruction outside the list refuses the whole transaction", () => {
  const transaction = VersionedTransaction.deserialize(Buffer.from(fixtures.buyNoFee.transaction, "base64"));
  /* Point the order instruction at another program: the same bytes, a program the list does not name. */
  const keys = transaction.message.staticAccountKeys;
  const orderIx = transaction.message.compiledInstructions.find((ix) => keys[ix.programIdIndex].toBase58() === TRIGGER_V1_PROGRAM);
  const systemIndex = keys.findIndex((key) => key.toBase58() === "11111111111111111111111111111111");
  orderIx.programIdIndex = systemIndex;
  const tampered = Buffer.from(transaction.serialize()).toString("base64");
  assert.equal(inspectTriggerTransaction(tampered, createExpectation("buyNoFee")).ok, false);
});

test("the order's terms decode from the instruction", () => {
  const transaction = VersionedTransaction.deserialize(Buffer.from(fixtures.buyWithFee.transaction, "base64"));
  const keys = transaction.message.staticAccountKeys;
  const orderIx = transaction.message.compiledInstructions.find((ix) => keys[ix.programIdIndex].toBase58() === TRIGGER_V1_PROGRAM);
  const params = decodeInitializeOrder(orderIx.data);
  assert.equal(params.makingRaw, "20000000");
  assert.equal(params.takingRaw, "200000000");
  assert.equal(params.feeBps, 10);
  assert.equal(params.expiredAt, null);
});

test("garbage is refused, not thrown", () => {
  assert.equal(inspectTriggerTransaction("not base64 at all", createExpectation("buyNoFee")).ok, false);
});

test("a cancellation that refunds to someone else's account is refused", () => {
  const transaction = VersionedTransaction.deserialize(Buffer.from(fixtures.cancel.transaction, "base64"));
  const keys = transaction.message.staticAccountKeys;
  const cancelIx = transaction.message.compiledInstructions.find((ix) => keys[ix.programIdIndex].toBase58() === TRIGGER_V1_PROGRAM);
  /* Point the refund (account 4) at the order account itself: any account but the maker's own. */
  cancelIx.accountKeyIndexes[4] = cancelIx.accountKeyIndexes[2];
  const tampered = Buffer.from(transaction.serialize()).toString("base64");
  const verdict = inspectTriggerTransaction(tampered, { kind: "cancel", owner: fixtures.cancel.maker, order: fixtures.cancel.order });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /someone else/);
});

test("bytes without the wallet's real signature are not signed", () => {
  /* Jupiter's unsigned transaction carries 64 zero bytes; random bytes are no better. */
  assert.equal(signedByFeePayer(fixtures.buyNoFee.transaction), false);
  const transaction = VersionedTransaction.deserialize(Buffer.from(fixtures.buyNoFee.transaction, "base64"));
  transaction.signatures[0] = Uint8Array.from({ length: 64 }, (_, index) => index + 1);
  assert.equal(signedByFeePayer(Buffer.from(transaction.serialize()).toString("base64")), false);
});

test("a signature made by the fee payer's key is accepted", async () => {
  const { Keypair, TransactionMessage, SystemProgram } = await import("@solana/web3.js");
  const payer = Keypair.generate();
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })] }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  assert.equal(signedByFeePayer(Buffer.from(transaction.serialize()).toString("base64")), true);
});
