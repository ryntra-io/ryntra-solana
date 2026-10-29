import { test } from "node:test";
import assert from "node:assert/strict";

import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { buildV1Wire, kitInstruction } from "../../../lib/solana/v1-tx.ts";
import { collateralReceipt, expectsFills, orderReceipt, sendCollateral, sendOrder, signatureOfWire, walletSignature } from "./flow.ts";
import { clock, collateralReview, FILL, no, ok, orderReview, OTHER, OWNER, scriptedEngine, wire, wireV0, wireV1 } from "./test-fixtures.mjs";

const SIGNED = wire(9);
const SIGNATURE = signatureOfWire(SIGNED);
const landed = (fills) => ({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, ...(fills === undefined ? {} : { fills }) }], settled: true });

function setup(script, sign = async () => ({ ok: true, signed: SIGNED })) {
  const time = clock();
  const run = scriptedEngine(script);
  const signed = [];
  const deps = {
    engine: run.engine,
    sign: async (unsigned) => {
      signed.push(unsigned);
      return sign(unsigned);
    },
    now: time.now,
    sleep: time.sleep,
    followMs: 20_000,
    followEveryMs: 4_000,
  };
  return { ...run, time, deps, signed };
}

test("a signature's id is the first signature: after the count in legacy bytes, at the tail in v1", () => {
  assert.equal(signatureOfWire(wire(0)), "1".repeat(64));
  assert.match(SIGNATURE, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
  assert.equal(signatureOfWire(wireV1(9)), SIGNATURE);
});

test("the connected wallet's own signature: it must pay for the bytes and have signed them, in legacy, v0 and v1 alike", () => {
  for (const make of [wire, wireV0, wireV1]) {
    assert.equal(walletSignature(make(9), OWNER), SIGNATURE, make.name);
    // Another wallet as the payer, or the payer's signature left empty: no signature of this wallet.
    assert.equal(walletSignature(make(9, OTHER), OWNER), null, make.name);
    assert.equal(walletSignature(make(0), OWNER), null, make.name);
  }
  for (const junk of ["", "not base64 at all %%", Buffer.from([1, 2, 3]).toString("base64"), Buffer.from([0x81, 4, 0, 0]).toString("base64")]) assert.equal(walletSignature(junk, OWNER), null, junk);
});

test("the wallet check reads real transactions as the network does: a web3.js legacy one and a Kit v1 one", () => {
  const owner = new PublicKey(OWNER);
  const transfer = SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(OTHER), lamports: 1 });
  const legacy = new Transaction({ feePayer: owner, recentBlockhash: "11111111111111111111111111111111" }).add(transfer);
  legacy.addSignature(owner, Buffer.alloc(64, 5));
  const legacyWire = legacy.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.equal(walletSignature(legacyWire, OWNER), signatureOfWire(legacyWire));
  assert.equal(walletSignature(legacyWire, OTHER), null);
  const unsigned = Buffer.from(buildV1Wire({ owner: OWNER, instructions: [kitInstruction(transfer)], blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1, limits: { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 65_536, priorityFeeLamports: 0n } }), "base64");
  assert.equal(walletSignature(unsigned.toString("base64"), OWNER), null);
  const signed = Buffer.from(unsigned);
  signed.fill(5, signed.length - 64);
  assert.equal(walletSignature(signed.toString("base64"), OWNER), signatureOfWire(signed.toString("base64")));
  assert.equal(walletSignature(signed.toString("base64"), OTHER), null);
});

test("bytes signed by another wallet than the one connected are never sent", async () => {
  const { deps, routes } = setup({ submitOrder: [ok(landed([FILL]))], submitCollateral: [ok({ results: [], settled: true })] }, async () => ({ ok: true, signed: wire(9, OTHER) }));
  assert.deepEqual(await sendOrder(orderReview(), deps.now(), OWNER, deps), { kind: "refused", code: "NOT_SIGNED", message: null });
  assert.deepEqual(await sendCollateral(collateralReview(), deps.now(), OWNER, deps), { kind: "refused", code: "NOT_SIGNED", message: null });
  assert.equal(routes("submitOrder").length, 0);
  assert.equal(routes("submitCollateral").length, 0);
});

test("the Review's exact bytes are signed once and relayed once; a landed market order with its fills is filled", async () => {
  const { deps, routes, signed } = setup({ submitOrder: [ok(landed([FILL]))] });
  const review = orderReview();
  let onSigned = null;
  const sent = await sendOrder(review, deps.now(), OWNER, { ...deps, onSigned: (signature) => (onSigned = signature) });
  assert.equal(sent.kind, "sent");
  assert.deepEqual(signed, [review.transaction.wireBase64]);
  assert.equal(onSigned, SIGNATURE);
  assert.deepEqual(routes("submitOrder").map((call) => call.args), [["order-ticket-1", [SIGNED]]]);
  const receipt = orderReceipt(review, sent.relay);
  assert.equal(receipt.outcome, "filled");
  assert.equal(receipt.signature, SIGNATURE);
  assert.ok(Math.abs(receipt.fills.averageUsd - 150.02) < 1e-9);
  assert.equal(receipt.fills.feeUsd, 0.0106);
  // Nothing was read again: the relay already had the chain's answer and Phoenix's fills.
  assert.equal(routes("orderStatus").length, 0);
});

test("a wallet that says no sends nothing, and a Review too old to sign never opens the wallet", async () => {
  const refused = setup({ submitOrder: [ok(landed([FILL]))] }, async () => ({ ok: false }));
  assert.deepEqual(await sendOrder(orderReview(), refused.deps.now(), OWNER, refused.deps), { kind: "refused", code: "WALLET_REFUSED", message: null });
  assert.equal(refused.routes("submitOrder").length, 0);
  const old = setup({ submitOrder: [ok(landed([FILL]))] });
  const at = old.deps.now();
  old.time.pass(25_000);
  assert.deepEqual(await sendOrder(orderReview(), at, OWNER, old.deps), { kind: "aged" });
  assert.equal(old.signed.length, 0);
  assert.equal(old.routes("submitOrder").length, 0);
});

test("bytes that aged out while the wallet was open are not sent", async () => {
  const run = setup({ submitOrder: [ok(landed([FILL]))] });
  run.deps.sign = async () => {
    run.time.pass(31_000);
    return { ok: true, signed: SIGNED };
  };
  assert.deepEqual(await sendOrder(orderReview(), run.deps.now(), OWNER, run.deps), { kind: "aged" });
  assert.equal(run.routes("submitOrder").length, 0);
});

test("the engine's refusals before its send mean nothing moved; an expired ticket asks for a fresh Review", async () => {
  for (const code of ["ORDERS_CLOSED", "CANARY_LIMIT", "WALLET_MISMATCH", "SIGNED_MISMATCH", "RATE_LIMITED"]) {
    const { deps } = setup({ submitOrder: [no(code, "the engine's words")] });
    assert.deepEqual(await sendOrder(orderReview(), deps.now(), OWNER, deps), { kind: "refused", code, message: "the engine's words" }, code);
  }
  const expired = setup({ submitOrder: [no("TICKET_EXPIRED")] });
  assert.deepEqual(await sendOrder(orderReview(), expired.deps.now(), OWNER, expired.deps), { kind: "aged" });
});

test("a relay whose answer was lost is never sent again: the chain and Phoenix's record are asked instead", async () => {
  const { deps, routes } = setup({
    submitOrder: [no("NETWORK")],
    orderStatus: [ok({ results: [{ signature: SIGNATURE, state: "UNKNOWN", reason: null }] }), ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: null }] }), ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, fills: [FILL] }] })],
  });
  const sent = await sendOrder(orderReview(), deps.now(), OWNER, deps);
  assert.equal(sent.kind, "sent");
  assert.equal(routes("submitOrder").length, 1);
  assert.equal(routes("orderStatus").length, 3);
  assert.deepEqual(routes("orderStatus")[0].args, [OWNER, SIGNATURE]);
  assert.equal(orderReceipt(orderReview(), sent.relay).outcome, "filled");
});

test("an answer the chain never gives stays pending: the receipt never claims the position is open", async () => {
  const { deps, routes } = setup({ submitOrder: [no("HTTP_504")], orderStatus: [ok({ results: [{ signature: SIGNATURE, state: "UNKNOWN", reason: null }] })] });
  const sent = await sendOrder(orderReview(), deps.now(), OWNER, deps);
  assert.equal(orderReceipt(orderReview(), sent.relay).outcome, "pending");
  // Every four seconds for twenty: five reads, then the receipt waits for «Check again».
  assert.equal(routes("orderStatus").length, 5);
});

test("the engine's outcome of a landed order: partly filled, resting, TP/SL set, cancelled, failed", () => {
  const half = { ...FILL, sizeUnits: 0.1 };
  assert.equal(orderReceipt(orderReview({ tif: "ioc" }), landed([half])).outcome, "partial");
  // A resting limit landed with nothing filled is placed; a market order that filled nothing is cancelled.
  assert.equal(orderReceipt(orderReview({ type: "limit", tif: "gtc" }), landed([])).outcome, "accepted");
  assert.equal(orderReceipt(orderReview({ type: "limit", tif: "gtc" }), landed(undefined)).outcome, "accepted");
  assert.equal(orderReceipt(orderReview({ tif: "ioc" }), landed([])).outcome, "cancelled");
  // A market order landed before Phoenix showed its fills is still pending: it does not claim either way.
  assert.equal(orderReceipt(orderReview(), landed(undefined)).outcome, "pending");
  assert.equal(orderReceipt(orderReview({ kind: "protect", tif: null, sizeUnits: "0" }), landed(undefined)).outcome, "set");
  assert.equal(orderReceipt(orderReview({ kind: "cancelAll", tif: null, sizeUnits: "0" }), landed(undefined)).outcome, "cancelled");
  const failed = orderReceipt(orderReview(), { results: [{ signature: SIGNATURE, state: "FAILED", reason: "slippage" }], settled: false });
  assert.deepEqual([failed.outcome, failed.reason], ["failed", "slippage"]);
  assert.equal(expectsFills(orderReview()), true);
  assert.equal(expectsFills(orderReview({ kind: "reduce" })), true);
  assert.equal(expectsFills(orderReview({ type: "limit", tif: "gtc" })), false);
  assert.equal(expectsFills(orderReview({ kind: "protect", tif: null })), false);
});

test("a collateral move is signed and relayed once; the receipt states the USDC the chain says it moved", async () => {
  const { deps, routes } = setup({
    submitCollateral: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null }], settled: true })],
    collateralStatus: [ok({ results: [{ signature: SIGNATURE, state: "LANDED", reason: null, usdcMoved: "-25000000" }] })],
  });
  const sent = await sendCollateral(collateralReview(), deps.now(), OWNER, deps);
  assert.equal(sent.kind, "sent");
  assert.deepEqual(routes("submitCollateral")[0].args, ["collateral-ticket-1", [SIGNED]]);
  // Landed without its figure: the chain is read once more for the amount, never the Review's expectation.
  assert.equal(routes("collateralStatus").length, 1);
  assert.deepEqual(collateralReceipt(sent.relay), { outcome: "done", signature: SIGNATURE, reason: null, movedMicro: 25_000_000n });
  const refused = setup({ submitCollateral: [no("ACTIONS_CLOSED")] });
  assert.equal((await sendCollateral(collateralReview(), refused.deps.now(), OWNER, refused.deps)).kind, "refused");
  assert.equal(collateralReceipt({ results: [{ signature: SIGNATURE, state: "FAILED", reason: "x" }], settled: false }).outcome, "failed");
});
