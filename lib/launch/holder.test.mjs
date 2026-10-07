import assert from "node:assert/strict";
import test from "node:test";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import { swapShareRaw } from "../core/venues/meteora-damm-v2/holder.server.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork } from "./config.server.ts";
import { buildHolderPermission, buildLaunchHolder, holderOpenFor, quoteLaunchHolder, submitLaunchHolder } from "./holder.server.ts";

/*
 * The holder's entry and its gates, against a store in memory and a connection that answers nothing: every refusal here
 * is decided before the chain is asked. Synthetic keys only.
 */
const owner = Keypair.generate();
const stranger = Keypair.generate();
const TOKEN = "Tokn1111111111111111111111111111111111111111";
const POSITION = Keypair.generate().publicKey.toBase58();
const NFT = Keypair.generate().publicKey.toBase58();

function deps(cluster = "mainnet") {
  const network = cluster === "mainnet" ? launchNetwork({}) : launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
  return {
    network,
    /* Nothing listens here: a test that reached the chain would fail, not pass. */
    connection: new Connection("http://127.0.0.1:9", "confirmed"),
    store: createMemoryGuardStore(),
    now: () => new Date("2026-10-07T12:00:00.000Z"),
    second: null,
    adopt: null,
    env: { RYNTRA_INTERNAL_WALLETS: owner.publicKey.toBase58() },
  };
}

test("on mainnet the entry is open only to the operator's own wallets; the stand is open", async () => {
  const d = deps();
  assert.equal(await holderOpenFor(d, owner.publicKey.toBase58()), true);
  assert.equal(await holderOpenFor(d, stranger.publicKey.toBase58()), false);
  /* The list the admin keeps counts too. */
  await d.store.collection("adminInternalWallets").set(stranger.publicKey.toBase58(), { wallet: stranger.publicKey.toBase58(), label: "test", addedAt: "2026-10-07T00:00:00.000Z" });
  assert.equal(await holderOpenFor(d, stranger.publicKey.toBase58()), true);
  assert.equal(await holderOpenFor(deps("devnet"), stranger.publicKey.toBase58()), true);
});

test("a wallet the entry is not open to gets LAUNCH_HOLDER_CLOSED for the quote, the build and «Увімкнути» — before the chain", async () => {
  const d = deps();
  const input = { wallet: stranger.publicKey.toBase58(), input: "pair", amountRaw: "1000000", slippageBps: 100 };
  assert.equal((await quoteLaunchHolder(d, TOKEN, input)).code, "LAUNCH_HOLDER_CLOSED");
  assert.equal((await buildLaunchHolder(d, TOKEN, input)).code, "LAUNCH_HOLDER_CLOSED");
  await d.store.collection("launchHolderPositions").set(`mainnet:${stranger.publicKey.toBase58()}:${POSITION}`, {
    cluster: "mainnet", wallet: stranger.publicKey.toBase58(), token: TOKEN, pool: TOKEN, position: POSITION, nftMint: NFT, state: "OPEN",
    enteredAt: "2026-10-07T10:00:00.000Z", entrySignature: "x", validUntil: "0", input: "pair", enteredRaw: "1", enteredPairRaw: "1", feeRaw: "0", granted: true, pairDollar: true,
  });
  assert.equal((await buildHolderPermission(d, TOKEN, { wallet: stranger.publicKey.toBase58(), position: POSITION, action: "grant" })).code, "LAUNCH_HOLDER_CLOSED");
  /* «Відкликати» is the owner's whatever the gate says: it goes on to the chain (here — nothing answers). */
  const revoke = await buildHolderPermission(d, TOKEN, { wallet: stranger.publicKey.toBase58(), position: POSITION, action: "revoke" });
  assert.notEqual(revoke.code, "LAUNCH_HOLDER_CLOSED");
});

function built(d, overrides = {}) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = new PublicKey(Keypair.generate().publicKey).toBase58();
  const wire = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  const record = {
    id: "a".repeat(32), cluster: "mainnet", token: TOKEN, wallet: owner.publicKey.toBase58(), kind: "entry", pool: TOKEN, position: POSITION, nftMint: NFT,
    wireBase64: wire, validUntil: "100", createdAt: "2026-10-07T11:59:00.000Z", expiresAt: "2026-10-07T12:01:00.000Z",
    input: "pair", amountRaw: "1000000", enteredPairRaw: "1000000", feeRaw: "0", granted: true, ...overrides,
  };
  return { tx, record, store: () => d.store.collection("launchHolderBuilds").set(`mainnet:${record.id}`, record) };
}

test("the signed entry must be the built bytes, for its wallet, in time, once", async () => {
  const d = deps();
  const { tx, record, store } = built(d);
  await store();
  const signed = (t) => {
    const copy = Transaction.from(t.serialize({ requireAllSignatures: false, verifySignatures: false }));
    copy.partialSign(owner);
    return copy.serialize().toString("base64");
  };
  const submit = (body) => submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), ...body });

  assert.equal((await submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: stranger.publicKey.toBase58(), signedWireBase64: signed(tx) })).code, "WALLET_MISMATCH");
  const other = new Transaction().add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: stranger.publicKey, lamports: 1_000_000_000 }));
  other.feePayer = owner.publicKey;
  other.recentBlockhash = tx.recentBlockhash;
  assert.equal((await submit({ signedWireBase64: signed(other) })).code, "LAUNCH_SIGNED_OTHER_BYTES", "another transfer is not the entry");
  assert.equal((await submit({ signedWireBase64: record.wireBase64 })).code, "LAUNCH_SIGNED_OTHER_BYTES", "unsigned bytes are refused");
  /* Sent once: the mark of the first send refuses a second. */
  await d.store.collection("launchHolderSends").set(`mainnet:${record.id}`, { cluster: "mainnet", id: record.id, at: "2026-10-07T12:00:00.000Z" });
  assert.equal((await submit({ signedWireBase64: signed(tx) })).code, "LAUNCH_BUILD_USED");

  const late = deps();
  const old = built(late, { expiresAt: "2026-10-07T11:59:30.000Z" });
  await old.store();
  assert.equal((await submitLaunchHolder(late, TOKEN, { buildId: old.record.id, wallet: owner.publicKey.toBase58(), signedWireBase64: signed(old.tx) })).code, "LAUNCH_BUILD_EXPIRED");
  assert.equal((await submitLaunchHolder(late, "Othr1111111111111111111111111111111111111111", { buildId: old.record.id, wallet: owner.publicKey.toBase58(), signedWireBase64: signed(old.tx) })).code, "LAUNCH_NOT_FOUND", "a build of another token");
});

test("the part of a one-coin deposit swapped leaves both sides at the pool's ratio", () => {
  for (const [deposit, reserve] of [[100_000_000n, 1_000_000_000n], [5_000_000_000n, 15_000_000_000n], [1n, 10n ** 12n]]) {
    const s = swapShareRaw(deposit, reserve);
    assert.ok(s >= 0n && s <= deposit / 2n, "less than half: the swap itself moves the price");
    /* (x − s)·R ≈ s·(R + s) */
    const left = (deposit - s) * reserve;
    const right = s * (reserve + s);
    assert.ok(left >= right && left - right <= 2n * reserve + 2n * s + 2n, `${deposit}/${reserve}`);
  }
  assert.equal(swapShareRaw(0n, 100n), 0n);
  assert.equal(swapShareRaw(100n, 0n), 0n);
});
