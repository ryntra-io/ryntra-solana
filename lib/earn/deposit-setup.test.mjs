/* CITY-204 — a first deposit into Jupiter Lend: the jlToken account and wrapped SOL around the API's own deposit. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { WSOL, withDepositSetup } from "./deposit-setup.ts";

const LEND = new PublicKey("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const owner = Keypair.generate().publicKey;
const shareMint = Keypair.generate().publicKey;
const blockhash = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

/** A deposit shaped as the API answers it: legacy, one instruction of 17 accounts — signer, depositor, recipient, … */
function apiDeposit(asset, { extra = [], payer = owner } = {}) {
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(asset, owner, true), isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(shareMint, owner, true), isSigner: false, isWritable: true },
    { pubkey: asset, isSigner: false, isWritable: false },
    ...Array.from({ length: 13 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true })),
  ];
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight: 0 }).add(new TransactionInstruction({ programId: LEND, keys, data: Buffer.from([242, 1, 2, 3, 4, 5, 6, 7, 8]) }), ...extra);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
const read = (wire) => Transaction.from(Buffer.from(wire, "base64"));

test("USDC: the jlToken account is made first, the deposit is the API's byte for byte", () => {
  const wire = apiDeposit(USDC);
  const out = withDepositSetup(wire, { owner: owner.toBase58(), assetMint: USDC.toBase58(), shareMint: shareMint.toBase58(), amountRaw: 20_000_000n, heldWsolRaw: null });
  assert.deepEqual(out.added, ["share-account"]);
  const tx = read(out.wireBase64);
  assert.equal(tx.instructions.length, 2);
  assert.equal(tx.recentBlockhash, blockhash, "the API's blockhash");
  assert.ok(tx.feePayer.equals(owner));
  const [create, deposit] = tx.instructions;
  assert.ok(create.keys[1].pubkey.equals(getAssociatedTokenAddressSync(shareMint, owner, true)), "her own jlToken account");
  assert.ok(create.keys[2].pubkey.equals(owner));
  assert.deepEqual(Buffer.from(deposit.data), Buffer.from(read(wire).instructions[0].data));
  assert.deepEqual(deposit.keys.map((k) => k.pubkey.toBase58()), read(wire).instructions[0].keys.map((k) => k.pubkey.toBase58()));
  assert.ok(Buffer.from(out.wireBase64, "base64").length <= 1232);
});

test("SOL: wrapped first — her own account, exactly the amount — and unwrapped after when it held none", () => {
  const wire = apiDeposit(WSOL);
  const out = withDepositSetup(wire, { owner: owner.toBase58(), assetMint: WSOL.toBase58(), shareMint: shareMint.toBase58(), amountRaw: 700_000_000n, heldWsolRaw: 0n });
  assert.deepEqual(out.added, ["share-account", "wrap", "unwrap-empty"]);
  const tx = read(out.wireBase64);
  const wsolAccount = getAssociatedTokenAddressSync(WSOL, owner, true);
  assert.equal(tx.instructions.length, 6);
  const transfer = tx.instructions[2];
  assert.ok(transfer.programId.equals(SystemProgram.programId));
  assert.ok(transfer.keys[0].pubkey.equals(owner) && transfer.keys[1].pubkey.equals(wsolAccount), "her SOL into her own wrapped account");
  assert.equal(transfer.data.readBigUInt64LE(4), 700_000_000n);
  const close = tx.instructions[5];
  assert.ok(close.programId.equals(TOKEN_PROGRAM_ID));
  assert.ok(close.keys[0].pubkey.equals(wsolAccount) && close.keys[1].pubkey.equals(owner), "the rent back to her");
  assert.ok(Buffer.from(out.wireBase64, "base64").length <= 1232, `${Buffer.from(out.wireBase64, "base64").length} bytes`);
  /* She held wrapped SOL already, or it was not read: wrapped and deposited, never closed. */
  assert.deepEqual(withDepositSetup(wire, { owner: owner.toBase58(), assetMint: WSOL.toBase58(), shareMint: shareMint.toBase58(), amountRaw: 1n, heldWsolRaw: 5n }).added, ["share-account", "wrap"]);
  assert.deepEqual(withDepositSetup(wire, { owner: owner.toBase58(), assetMint: WSOL.toBase58(), shareMint: shareMint.toBase58(), amountRaw: 1n, heldWsolRaw: null }).added, ["share-account", "wrap"]);
});

test("anything not as it must be leaves the API's bytes untouched", () => {
  const usdc = { owner: owner.toBase58(), assetMint: USDC.toBase58(), shareMint: shareMint.toBase58(), amountRaw: 1n, heldWsolRaw: null };
  const two = apiDeposit(USDC, { extra: [SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 1 })] });
  assert.equal(withDepositSetup(two, usdc).wireBase64, two, "a second instruction");
  const other = apiDeposit(USDC);
  assert.equal(withDepositSetup(other, { ...usdc, owner: Keypair.generate().publicKey.toBase58() }).wireBase64, other, "another wallet");
  assert.equal(withDepositSetup(other, { ...usdc, shareMint: Keypair.generate().publicKey.toBase58() }).wireBase64, other, "a recipient that is not her jlToken account");
  assert.equal(withDepositSetup("not base64 of a transaction", usdc).wireBase64, "not base64 of a transaction");
});
