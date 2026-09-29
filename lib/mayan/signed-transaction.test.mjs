import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { checkSignedCrossSwapTransaction, wireHash } from "./signed-transaction.ts";

const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

function unsignedOrder(owner) {
  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: new PublicKey("11111111111111111111111111111111"), lamports: 1 })],
  }).compileToV0Message([]);
  return new VersionedTransaction(message);
}

const toBase64 = (tx) => Buffer.from(tx.serialize()).toString("base64");

test("the owner's honest signature over the reviewed bytes clears, and yields the transaction id", () => {
  const owner = Keypair.generate();
  const unsigned = unsignedOrder(owner);
  const reviewed = toBase64(unsigned);
  const signed = VersionedTransaction.deserialize(unsigned.serialize());
  signed.sign([owner]);
  const check = checkSignedCrossSwapTransaction({ reviewedWireBase64: reviewed, reviewedWireHash: wireHash(reviewed), signedWireBase64: toBase64(signed), owner: owner.publicKey.toBase58() });
  assert.equal(check.ok, true);
  assert.equal(check.comparison, "EXACT");
  assert.match(check.signature, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
});

test("unsigned bytes, a stranger's signature, foreign reviewed bytes and a changed message are each refused by name", () => {
  const owner = Keypair.generate();
  const stranger = Keypair.generate();
  const unsigned = unsignedOrder(owner);
  const reviewed = toBase64(unsigned);
  const hash = wireHash(reviewed);

  const blank = checkSignedCrossSwapTransaction({ reviewedWireBase64: reviewed, reviewedWireHash: hash, signedWireBase64: reviewed, owner: owner.publicKey.toBase58() });
  assert.equal(blank.ok, false);
  assert.equal(blank.code, "OWNER_SIGNATURE_MISSING");

  const forged = VersionedTransaction.deserialize(unsigned.serialize());
  forged.addSignature(owner.publicKey, stranger.secretKey.slice(0, 64));
  const bad = checkSignedCrossSwapTransaction({ reviewedWireBase64: reviewed, reviewedWireHash: hash, signedWireBase64: toBase64(forged), owner: owner.publicKey.toBase58() });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "OWNER_SIGNATURE_INVALID");

  const other = checkSignedCrossSwapTransaction({ reviewedWireBase64: toBase64(unsignedOrder(stranger)), reviewedWireHash: hash, signedWireBase64: reviewed, owner: owner.publicKey.toBase58() });
  assert.equal(other.ok, false);
  assert.equal(other.code, "REVIEWED_BYTES_MISMATCH");

  const changed = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: stranger.publicKey, lamports: 1_000_000 })],
    }).compileToV0Message([]),
  );
  changed.sign([owner]);
  const swapped = checkSignedCrossSwapTransaction({ reviewedWireBase64: reviewed, reviewedWireHash: hash, signedWireBase64: toBase64(changed), owner: owner.publicKey.toBase58() });
  assert.equal(swapped.ok, false);
  assert.equal(swapped.code, "WALLET_MODIFIED_BYTES");
});
