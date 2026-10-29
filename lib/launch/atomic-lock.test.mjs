import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { sealCosigners } from "../liquidity/studio/ticket.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { buildV1Wire, kitInstruction, readV1 } from "../solana/v1-tx.ts";
import { composeAtomicCreation, readSignedV1 } from "./atomic-lock.server.ts";
import { launchNetwork } from "./config.server.ts";
import { submitLaunch } from "./flow.server.ts";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BLOCKHASH = "11111111111111111111111111111111";

/* The launch's four signers: the pool payer pays, the creator signs first, the new mint and the escrow's base after. */
const poolPayer = Keypair.generate();
const creator = Keypair.generate();
const mint = Keypair.generate();
const base = Keypair.generate();

/** One v1 creation with its lock: the creator's transfer to the payer, then instructions the mint and the base sign. */
function v1Creation() {
  const instructions = [
    SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1_000 }),
    SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: poolPayer.publicKey, lamports: 0 }),
    SystemProgram.transfer({ fromPubkey: base.publicKey, toPubkey: creator.publicKey, lamports: 0 }),
  ];
  return buildV1Wire({ owner: poolPayer.publicKey.toBase58(), instructions: instructions.map(kitInstruction), blockhash: BLOCKHASH, lastValidBlockHeight: 100, limits: { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 1 << 20, priorityFeeLamports: 0n } });
}

test("the wallet's v1 bytes: the creator signs first, then the mint and the base; anything else is refused", async () => {
  const { V1Creation } = await import("./atomic-lock.server.ts");
  const wire = v1Creation();
  const messageSha256 = sha256(readV1(Buffer.from(wire, "base64")).messageBytes);
  const wallet = new V1Creation(Buffer.from(wire, "base64"));
  wallet.partialSign(creator);
  const signed = Buffer.from(wallet.serialize()).toString("base64");
  assert.equal(readSignedV1(wire, messageSha256, creator.publicKey.toBase58(), [mint, base], poolPayer.publicKey).code, "SIGNATURE_MISSING", "unsigned bytes");
  const read = readSignedV1(signed, messageSha256, creator.publicKey.toBase58(), [mint, base], poolPayer.publicKey);
  assert.equal(read.ok, true);
  const after = readV1(read.creation.serialize());
  for (const key of [creator, mint, base]) {
    const at = after.signers.indexOf(key.publicKey.toBase58());
    assert.ok(ed25519Valid(after.messageBytes, after.signatures[at], key.publicKey), `${at}: a real signature`);
  }
  assert.equal(after.signatures[0], null, "the pool payer signs last, after the attempt is claimed");
  assert.equal(readSignedV1(signed, "0".repeat(64), creator.publicKey.toBase58(), [mint, base], poolPayer.publicKey).code, "SIGNED_OTHER_BYTES", "another message");
  const legacy = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: poolPayer.publicKey, lamports: 1 }));
  legacy.feePayer = poolPayer.publicKey;
  legacy.recentBlockhash = BLOCKHASH;
  assert.equal(readSignedV1(legacy.serialize({ requireAllSignatures: false }).toString("base64"), messageSha256, creator.publicKey.toBase58(), [], null).code, "SIGNED_OTHER_BYTES", "legacy bytes are not the v1 built");
});

test("a v1 build submits as one transaction: the lock is the creation's, LOCKED when it lands", async () => {
  const { V1Creation } = await import("./atomic-lock.server.ts");
  const env = { BETA_TOKEN_SECRET: "a-server-key-long-enough" };
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const now = new Date("2026-10-25T12:00:00.000Z");
  const store = createMemoryGuardStore();
  const sent = [];
  const connection = {
    sendRawTransaction: async (bytes) => {
      sent.push(Uint8Array.from(bytes));
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const wire = v1Creation();
  const id = "e".repeat(32);
  await store.collection("launchBuilds").set(`devnet:${id}`, {
    id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "micro", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
    metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "1000",
    messageSha256: sha256(readV1(Buffer.from(wire, "base64")).messageBytes),
    format: "v1",
    lock: { schedule: "6m-12m", escrow: base.publicKey.toBase58(), amountRaw: "1", cliffAt: 0, endsAt: 0, messageSha256: "", inCreation: true },
    split: null, cosign: sealCosigners([{ index: 0, key: mint }, { index: 0, key: base }], env), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
  });
  const wallet = new V1Creation(Buffer.from(wire, "base64"));
  wallet.partialSign(creator);
  const deps = { network, connection, store, poolPayer, origin: "https://ryntra.io", now: () => now, env };
  const result = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: Buffer.from(wallet.serialize()).toString("base64"), signedLockWireBase64: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sent.length, 1, "one transaction: the creation with its lock");
  const landed = readV1(sent[0]);
  for (const key of [poolPayer, creator, mint, base]) {
    const at = landed.signers.indexOf(key.publicKey.toBase58());
    assert.ok(ed25519Valid(landed.messageBytes, landed.signatures[at], key.publicKey), `${key.publicKey.toBase58()} signed`);
  }
  assert.equal(sha256(landed.messageBytes), sha256(readV1(Buffer.from(wire, "base64")).messageBytes), "the message the creator signed");
  assert.deepEqual([result.state, result.lock?.state, result.lock?.signature], ["LAUNCHED", "LOCKED", result.signature], "the lock is the creation's: same signature");
});

test("the pool payer stays whole: the creator's transfer is set from the simulation of the exact v1 bytes", async () => {
  const payer = poolPayer.publicKey;
  const creation = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: payer, lamports: 10_000 }),
    SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: payer, lamports: 0 }),
  );
  creation.feePayer = payer;
  creation.recentBlockhash = BLOCKHASH;
  const lock = new Transaction().add(SystemProgram.transfer({ fromPubkey: base.publicKey, toPubkey: creator.publicKey, lamports: 0 }));
  /* A node whose simulation charges the payer 15 000 lamports (three signatures and rent) and credits it the transfer. */
  const simulated = [];
  const connection = {
    getBalance: async () => 1_000_000,
    _rpcRequest: async (method, [wire]) => {
      assert.equal(method, "simulateTransaction");
      const read = readV1(Buffer.from(wire, "base64"));
      const covered = read.view.instructions[0].data.readBigUInt64LE(4);
      simulated.push({ covered, units: read.view.config.computeUnitLimit });
      return { result: { value: { err: null, unitsConsumed: 120_000, accounts: [{ lamports: Number(1_000_000n - 15_000n + covered) }, { lamports: Number(1_000_000n - covered - 3_000n) }] } } };
    },
  };
  const composed = await composeAtomicCreation(connection, { creation, lock, creator: creator.publicKey.toBase58(), payer, validUntil: 100 });
  assert.equal(composed.ok, true, JSON.stringify(composed));
  assert.deepEqual(simulated.map((entry) => entry.covered), [10_000n, 15_000n], "the creator hands over what the payer spends on these bytes");
  assert.equal(simulated[1].units, 154_000, "the units from the simulation, with a margin");
  assert.equal(composed.coveredLamports, "15000");
  assert.equal(composed.creatorSpendLamports, "18000");
  const bad = { ...connection, _rpcRequest: async () => ({ result: { value: { err: { InstructionError: [1, "Custom"] }, accounts: [] } } }) };
  assert.equal((await composeAtomicCreation(bad, { creation, lock, creator: creator.publicKey.toBase58(), payer, validUntil: 100 })).ok, false, "bytes that do not simulate build nothing");
  const noRaw = { getBalance: async () => 0 };
  assert.equal((await composeAtomicCreation(noRaw, { creation, lock, creator: creator.publicKey.toBase58(), payer, validUntil: 100 })).ok, false);
  const other = new Transaction().add(SystemProgram.transfer({ fromPubkey: mint.publicKey, toPubkey: payer, lamports: 0 }));
  other.recentBlockhash = BLOCKHASH;
  assert.equal((await composeAtomicCreation(connection, { creation: other, lock, creator: creator.publicKey.toBase58(), payer, validUntil: 100 })).ok, false, "a creation that does not open with the creator's transfer");
});
