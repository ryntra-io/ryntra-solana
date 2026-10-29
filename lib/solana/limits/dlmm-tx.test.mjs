// Run from repo root: node --test lib/solana/limits/dlmm-tx.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";

import { cosignDlmmPlace, DLMM_DISCRIMINATOR, inspectDlmmTransaction, signedByAll, withDlmmOrderKey } from "./dlmm-tx.ts";
import { DLMM_PROGRAM, LIGHTHOUSE_PROGRAM } from "./model.ts";

const owner = Keypair.generate();
const order = Keypair.generate();
const stranger = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const mintX = new PublicKey("So11111111111111111111111111111111111111112");
const mintY = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const program = new PublicKey(DLMM_PROGRAM);
const any = () => Keypair.generate().publicKey;
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const data = (hex) => Buffer.concat([Buffer.from(hex, "hex"), Buffer.alloc(16)]);

function placeIx({ inPool = pool, payer = owner.publicKey, limitOrder = order.publicKey, amount = 0 } = {}) {
  /* lb_pair, bitmap, reserve, token_mint, limit_order, payer, owner, user_token, sender, token_program, system, event_authority, program */
  return new TransactionInstruction({
    programId: program,
    keys: [meta(inPool, false, true), meta(program), meta(any(), false, true), meta(mintY), meta(limitOrder, true, true), meta(payer, true, true), meta(owner.publicKey), meta(any(), false, true), meta(owner.publicKey, true), meta(TOKEN_PROGRAM_ID), meta(any()), meta(any()), meta(program)],
    data: Buffer.concat([Buffer.from(DLMM_DISCRIMINATOR.place, "hex"), Buffer.from([amount]), Buffer.alloc(15)]),
  });
}

function cancelIx({ refundX } = {}) {
  const ownX = getAssociatedTokenAddressSync(mintX, owner.publicKey, true, TOKEN_PROGRAM_ID);
  const ownY = getAssociatedTokenAddressSync(mintY, owner.publicKey, true, TOKEN_PROGRAM_ID);
  /* lb_pair, bitmap, reserve_x, reserve_y, token_x_mint, token_y_mint, limit_order, owner_token_x, owner_token_y, owner, token_x_program, token_y_program, memo, event_authority, program */
  return new TransactionInstruction({
    programId: program,
    keys: [meta(pool, false, true), meta(program), meta(any(), false, true), meta(any(), false, true), meta(mintX), meta(mintY), meta(order.publicKey, false, true), meta(refundX ?? ownX, false, true), meta(ownY, false, true), meta(owner.publicKey, true), meta(TOKEN_PROGRAM_ID), meta(TOKEN_PROGRAM_ID), meta(any()), meta(any()), meta(program)],
    data: data(DLMM_DISCRIMINATOR.cancel),
  });
}

function closeIx() {
  return new TransactionInstruction({ programId: program, keys: [meta(order.publicKey, false, true), meta(owner.publicKey, true), meta(owner.publicKey, false, true), meta(any()), meta(program)], data: data(DLMM_DISCRIMINATOR.close) });
}

function wire(instructions, signers) {
  const transaction = new Transaction({ feePayer: owner.publicKey, recentBlockhash: "11111111111111111111111111111111" }).add(...instructions);
  if (signers) transaction.sign(...signers);
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

const place = { owner: owner.publicKey.toBase58(), kind: "place", limitOrder: order.publicKey.toBase58(), pool: pool.toBase58() };
const cancel = { owner: owner.publicKey.toBase58(), kind: "cancel", limitOrder: order.publicKey.toBase58() };

test("a placement in the reviewed pool by the wallet passes, and names its pool", () => {
  const verdict = inspectDlmmTransaction(wire([placeIx()]), place);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.pool, pool.toBase58());
});

test("a placement in another pool is refused", () => {
  assert.equal(inspectDlmmTransaction(wire([placeIx({ inPool: any() })]), place).ok, false);
});

test("a cancellation pays back only into the wallet's own token accounts", () => {
  assert.equal(inspectDlmmTransaction(wire([cancelIx(), closeIx()]), cancel).ok, true);
  const tampered = inspectDlmmTransaction(wire([cancelIx({ refundX: getAssociatedTokenAddressSync(mintX, stranger, true) }), closeIx()]), cancel);
  assert.equal(tampered.ok, false);
  assert.match(tampered.reason, /someone else/);
});

test("Lighthouse's memory writes are refused, its assertions allowed", () => {
  const lighthouse = (first) => new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [], data: Buffer.from([first, 0, 0]) });
  assert.equal(inspectDlmmTransaction(wire([placeIx(), lighthouse(4)]), place).ok, true);
  assert.equal(inspectDlmmTransaction(wire([placeIx(), lighthouse(0)]), place).ok, false);
});

test("a third signer is refused", () => {
  const extra = new TransactionInstruction({ programId: program, keys: [meta(any(), true, false)], data: data(DLMM_DISCRIMINATOR.initBinArray) });
  assert.equal(inspectDlmmTransaction(wire([placeIx(), extra]), place).ok, false);
});

test("only real signatures of every signer count as signed", () => {
  assert.equal(signedByAll(wire([placeIx()])), false);
  assert.equal(signedByAll(wire([placeIx()], [owner, order])), true);
  assert.equal(signedByAll(wire([cancelIx(), closeIx()], [owner])), true);
});

/* ------------------------------------------------ the wallet signs first */

const env = { BETA_TOKEN_SECRET: "a-test-secret-of-enough-length" };
const expectOf = (limitOrder) => ({ owner: owner.publicKey.toBase58(), limitOrder, pool: pool.toBase58() });
const blockhash = "11111111111111111111111111111111";

/** What the Review shows: a placement built with a draft account, the order's key seated, nobody's signature. */
function reviewed(instructions = (draft) => [placeIx({ limitOrder: draft })]) {
  const draft = Keypair.generate().publicKey;
  const built = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(...instructions(draft));
  const seated = withDlmmOrderKey(built, draft, env);
  assert.ok(seated);
  return { transaction: seated.transaction, limitOrder: seated.limitOrder, draft };
}

/** The wallet's signature over the bytes it was shown, after any instruction it adds itself. */
function walletSigns(transaction, added = []) {
  const shown = Transaction.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const signed = new Transaction({ feePayer: owner.publicKey, recentBlockhash: shown.recentBlockhash }).add(...shown.instructions, ...added);
  signed.partialSign(owner);
  return signed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

test("the Review's bytes carry no signature, and the order's key is the digest's whatever address sat in its slot", () => {
  const { transaction, limitOrder, draft } = reviewed();
  const bytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const shown = VersionedTransaction.deserialize(bytes);
  assert.equal(shown.message.header.numRequiredSignatures, 2);
  assert.ok(shown.signatures.every((signature) => signature.every((byte) => byte === 0)), "nobody signed before the wallet");
  assert.ok(shown.message.staticAccountKeys.some((key) => key.equals(limitOrder.publicKey)));
  assert.ok(!shown.message.staticAccountKeys.some((key) => key.equals(draft)));
});

test("the relay signs after the wallet, over the exact message the wallet signed", () => {
  const { transaction, limitOrder } = reviewed();
  const signed = walletSigns(transaction);
  const walletSignature = VersionedTransaction.deserialize(Buffer.from(signed, "base64")).signatures[0];
  const cosigned = cosignDlmmPlace(signed, expectOf(limitOrder.publicKey.toBase58()), env);
  assert.equal(cosigned.ok, true, cosigned.reason);
  assert.equal(signedByAll(cosigned.wireBase64), true);
  const relayed = VersionedTransaction.deserialize(Buffer.from(cosigned.wireBase64, "base64"));
  assert.deepEqual(Buffer.from(relayed.signatures[0]), Buffer.from(walletSignature), "the wallet's signature is untouched and first");
});

test("what Phantom adds — Lighthouse assertions and a compute budget — is signed over too", () => {
  const { transaction, limitOrder } = reviewed();
  const added = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([4, 0, 0, 0, 1]) }),
    new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [meta(owner.publicKey)], data: Buffer.from([4, 0, 0]) }),
  ];
  const signed = walletSigns(transaction, added);
  const order = limitOrder.publicKey.toBase58();
  const verdict = inspectDlmmTransaction(signed, { ...place, limitOrder: order });
  assert.equal(verdict.ok, true, verdict.reason);
  const cosigned = cosignDlmmPlace(signed, expectOf(order), env);
  assert.equal(cosigned.ok, true, cosigned.reason);
  assert.equal(signedByAll(cosigned.wireBase64), true);
});

test("bytes that do something other than the Review are never signed for the order", () => {
  const { transaction, limitOrder } = reviewed();
  const order = limitOrder.publicKey.toBase58();
  /* Another amount in the same order account. */
  const tampered = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(placeIx({ limitOrder: limitOrder.publicKey, amount: 9 }));
  tampered.partialSign(owner);
  const changed = cosignDlmmPlace(tampered.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expectOf(order), env);
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "SIGNED_MISMATCH");
  /* The right bytes, asked for under another order's address. */
  assert.equal(cosignDlmmPlace(walletSigns(transaction), expectOf(any().toBase58()), env).code, "SIGNED_MISMATCH");
  /* Another server secret derives another key. */
  assert.equal(cosignDlmmPlace(walletSigns(transaction), expectOf(order), { BETA_TOKEN_SECRET: "another-secret-of-enough-length" }).code, "SIGNED_MISMATCH");
});

test("bytes the order's key already signed before the wallet are the old flow and are refused", () => {
  const presigned = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(placeIx());
  presigned.partialSign(order);
  presigned.partialSign(owner);
  const answer = cosignDlmmPlace(presigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expectOf(order.publicKey.toBase58()), env);
  assert.equal(answer.code, "SIGNED_MISMATCH");
});

test("without the wallet's signature, or without the server's secret, nothing goes out", () => {
  const { transaction, limitOrder } = reviewed();
  const unsigned = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.equal(cosignDlmmPlace(unsigned, expectOf(limitOrder.publicKey.toBase58()), env).code, "NOT_SIGNED");
  assert.equal(cosignDlmmPlace(walletSigns(transaction), expectOf(limitOrder.publicKey.toBase58()), {}).code, "ORDER_KEY_UNAVAILABLE");
  const draft = Keypair.generate().publicKey;
  assert.equal(withDlmmOrderKey(new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(placeIx({ limitOrder: draft })), draft, { BETA_TOKEN_SECRET: "short" }), null);
});

test("a loaded-accounts data limit up to 64 MiB is a wallet's own; above it is refused", () => {
  const limit = (bytes) => { const body = Buffer.alloc(5); body[0] = 4; body.writeUInt32LE(bytes, 1); return new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: body }); };
  assert.equal(inspectDlmmTransaction(wire([limit(64 * 1024 * 1024), placeIx()]), place).ok, true);
  assert.equal(inspectDlmmTransaction(wire([limit(64 * 1024 * 1024 + 1), placeIx()]), place).ok, false);
});

test("the order's key does not depend on the draft that sat in its slot", () => {
  const built = (draft) => new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(placeIx({ limitOrder: draft }));
  const first = Keypair.generate().publicKey;
  const second = Keypair.generate().publicKey;
  const placeShared = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash });
  for (const ix of built(first).instructions) placeShared.add(ix);
  const other = new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash });
  for (const ix of placeShared.instructions) other.add(new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((key) => (key.pubkey.equals(first) ? { ...key, pubkey: second } : key)) }));
  assert.equal(withDlmmOrderKey(placeShared, first, env).limitOrder.publicKey.toBase58(), withDlmmOrderKey(other, second, env).limitOrder.publicKey.toBase58());
});

test("a compute budget a wallet puts in front of the order is signed over too", () => {
  const { transaction, limitOrder } = reviewed();
  const shown = Transaction.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const signedTx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: shown.recentBlockhash }).add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }), ...shown.instructions);
  signedTx.partialSign(owner);
  const cosigned = cosignDlmmPlace(signedTx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expectOf(limitOrder.publicKey.toBase58()), env);
  assert.equal(cosigned.ok, true, cosigned.reason);
});

test("the lane's own reading runs before the order's key signs: a Lighthouse memory write is refused", () => {
  const { transaction, limitOrder } = reviewed();
  const write = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [], data: Buffer.from([0, 0, 0]) });
  const answer = cosignDlmmPlace(walletSigns(transaction, [write]), expectOf(limitOrder.publicKey.toBase58()), env);
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /assertion/);
});
