// Run from repo root: node --test lib/solana/treasury/create-key.test.mjs
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test from "node:test";

import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { ed25519Valid } from "../limits/trigger-tx.ts";
import { buildV1Wire, kitInstruction, readV1, withV1Signature } from "../v1-tx.ts";

import { createTreasuryKey, signAfterWallet } from "./create-key.client.ts";
import { buildCreate } from "./squads.server.ts";

const person = Keypair.generate();
const wallet = person.publicKey.toBase58();

/** A create as the server builds it now: the browser's seed key named, nobody's signature in. */
async function built() {
  const key = await createTreasuryKey();
  const created = buildCreate({ wallet, createKey: new PublicKey(key.address), members: [{ address: wallet, initiate: true, vote: true, execute: true }], threshold: 1, timeLockSeconds: 0, programTreasury: Keypair.generate().publicKey });
  const tx = new Transaction({ feePayer: person.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 });
  tx.add(...created.groups[0].instructions);
  return { key, unsigned: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
}

const walletSigns = (wire) => {
  const tx = Transaction.from(Buffer.from(wire, "base64"));
  tx.partialSign(person);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
};

test("the seed key signs after the wallet, over exactly what the wallet signed — and then every signature is real", async () => {
  const { key, unsigned } = await built();
  const unsignedTx = Transaction.from(Buffer.from(unsigned, "base64"));
  assert.ok(unsignedTx.signatures.every((entry) => entry.signature === null), "the wallet is asked to sign bytes nobody has signed");
  const after = await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: walletSigns(unsigned), wallet, key });
  assert.equal(after.ok, true, JSON.stringify(after));
  const complete = Transaction.from(Buffer.from(after.signedWireBase64, "base64"));
  assert.ok(complete.verifySignatures(true), "the wallet's and the seed key's signatures both hold");
  assert.equal(Buffer.compare(complete.serializeMessage(), unsignedTx.serializeMessage()), 0, "the message is the reviewed one");
});

test("nothing is signed here when the wallet did not sign, or signed other bytes", async () => {
  const { key, unsigned } = await built();
  const unsignedReply = await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: unsigned, wallet, key });
  assert.equal(unsignedReply.ok, false);
  const other = Transaction.from(Buffer.from(unsigned, "base64"));
  other.add(SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const changed = await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: walletSigns(other.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")), wallet, key });
  assert.equal(changed.ok, false, "a transfer the Review never showed");
});

test("a transaction that does not name the seed key comes back as the wallet signed it", async () => {
  const key = await createTreasuryKey();
  const tx = new Transaction({ feePayer: person.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const signed = walletSigns(wire);
  const after = await signAfterWallet({ expectedWireBase64: wire, signedWireBase64: signed, wallet, key });
  assert.deepEqual(after, { ok: true, signedWireBase64: signed });
});

/** The wallet's v1 signature, as a wallet that signs v1 returns it. */
const walletSignsV1 = (wire) => {
  const bytes = Buffer.from(wire, "base64");
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(person.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return Buffer.from(withV1Signature(bytes, wallet, sign(null, readV1(bytes).messageBytes, key))).toString("base64");
};

test("v1 bytes: the seed key signs after the wallet, over the same message — refused when the wallet did not sign or added a Compute Budget instruction", async () => {
  const key = await createTreasuryKey();
  const created = buildCreate({ wallet, createKey: new PublicKey(key.address), members: [{ address: wallet, initiate: true, vote: true, execute: true }], threshold: 1, timeLockSeconds: 0, programTreasury: Keypair.generate().publicKey });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const v1 = (instructions) => buildV1Wire({ owner: wallet, instructions: instructions.map(kitInstruction), blockhash, lastValidBlockHeight: 1, limits: { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 4 * 1024 * 1024, priorityFeeLamports: 0n } });
  const unsigned = v1(created.groups[0].instructions);
  const after = await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: walletSignsV1(unsigned), wallet, key });
  assert.equal(after.ok, true, JSON.stringify(after));
  const read = readV1(Buffer.from(after.signedWireBase64, "base64"));
  assert.deepEqual(Buffer.from(read.messageBytes), Buffer.from(readV1(Buffer.from(unsigned, "base64")).messageBytes), "the message is the reviewed one");
  read.signers.forEach((signer, at) => assert.ok(read.signatures[at] && ed25519Valid(read.messageBytes, read.signatures[at], new PublicKey(signer)), `signature ${at}`));
  assert.equal(read.signers[0], wallet, "the wallet's slot first");

  assert.equal((await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: unsigned, wallet, key })).ok, false, "the wallet did not sign");
  const budget = v1([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ...created.groups[0].instructions]);
  assert.equal((await signAfterWallet({ expectedWireBase64: unsigned, signedWireBase64: walletSignsV1(budget), wallet, key })).ok, false, "a Compute Budget instruction on v1");
});
