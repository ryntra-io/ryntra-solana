import assert from "node:assert/strict";
import test from "node:test";

import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { swapShareRaw } from "../core/venues/meteora-damm-v2/holder.server.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { sealCosigners, withoutSignaturesOf } from "../liquidity/studio/ticket.ts";
import { LIGHTHOUSE_PROGRAM } from "../solana/limits/model.ts";
import { launchNetwork } from "./config.server.ts";
import { HOLDER_OPEN_TO_PEOPLE, buildHolderPermission, buildLaunchHolder, closedAccountsOf, holderOpenFor, quoteLaunchHolder, readHolderPositions, submitLaunchHolder } from "./holder.server.ts";

/*
 * The holder's entry and its gates, against a store in memory and a connection that answers nothing: every refusal here
 * is decided before the chain is asked. Synthetic keys only.
 */
const owner = Keypair.generate();
const stranger = Keypair.generate();
const TOKEN = "Tokn1111111111111111111111111111111111111111";
const POSITION = Keypair.generate().publicKey.toBase58();
const NFT = Keypair.generate().publicKey.toBase58();

function deps(cluster = "mainnet", extra = {}) {
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
    /* The switch turned off unless a test turns it on: the closed state is the one with a rule to prove. */
    openToPeople: false,
    proven: null,
    ...extra,
  };
}

const provenAs = (wallet) => async () => wallet;

/* The switch itself, pinned: opening the entry to people — or closing it again — is a change of this line and of the
   code's, never a side effect of anything else. */
test("the switch for people reads as released: open since our own security review came out clean (2026-10-11)", () => {
  assert.equal(HOLDER_OPEN_TO_PEOPLE, true);
});

test("with the switch off, mainnet's entry is built only for an operator's wallet the request proved; open to people — for anyone", async () => {
  const o = owner.publicKey.toBase58();
  const s = stranger.publicKey.toBase58();
  /* Named, not proven: the operator's wallet reads closed like every other. */
  assert.equal(await holderOpenFor(deps(), o), false);
  assert.equal(await holderOpenFor(deps(), s), false);
  assert.equal(await holderOpenFor(deps("mainnet", { proven: provenAs(o) }), o), true);
  /* A proof of one wallet opens nothing for another, and a stranger's own proof opens nothing. */
  assert.equal(await holderOpenFor(deps("mainnet", { proven: provenAs(o) }), s), false);
  assert.equal(await holderOpenFor(deps("mainnet", { proven: provenAs(s) }), s), false);
  /* A store that did not answer proves nothing. */
  assert.equal(await holderOpenFor(deps("mainnet", { proven: async () => { throw new Error("store down"); } }), o), false);
  /* The list the admin keeps counts too — for a proven wallet. */
  const d = deps("mainnet", { proven: provenAs(s) });
  await d.store.collection("adminInternalWallets").set(s, { wallet: s, label: "test", addedAt: "2026-10-07T00:00:00.000Z" });
  assert.equal(await holderOpenFor(d, s), true);
  /* Open to people: everyone, no proof asked. */
  let asked = 0;
  const open = deps("mainnet", { openToPeople: true, proven: async () => { asked++; return null; } });
  assert.equal(await holderOpenFor(open, s), true);
  assert.equal(await holderOpenFor(open, o), true);
  assert.equal(asked, 0, "no session read while open");
  assert.equal(await holderOpenFor(deps("devnet"), s), true);
});

test("«Мої позиції» answers open the same for the operator's named wallet and a stranger's — whose a wallet is never leaks", async () => {
  const named = await readHolderPositions(deps(), owner.publicKey.toBase58());
  const other = await readHolderPositions(deps(), stranger.publicKey.toBase58());
  assert.equal(named.ok, true);
  assert.equal(other.ok, true);
  assert.equal(named.positions.open, other.positions.open);
  assert.equal(named.positions.open, false);
  assert.equal((await readHolderPositions(deps("mainnet", { proven: provenAs(owner.publicKey.toBase58()) }), owner.publicKey.toBase58())).positions.open, true);
  assert.equal((await readHolderPositions(deps("mainnet", { openToPeople: true }), stranger.publicKey.toBase58())).positions.open, true);
});

test("an owner's closed fee account is named on the position; an unread one is not «closed»", () => {
  assert.deepEqual(closedAccountsOf({ ownerAccounts: { token: true, pair: true } }), []);
  assert.deepEqual(closedAccountsOf({ ownerAccounts: { token: false, pair: true } }), ["token"]);
  assert.deepEqual(closedAccountsOf({ ownerAccounts: { token: false, pair: false } }), ["token", "pair"]);
  assert.deepEqual(closedAccountsOf({ ownerAccounts: null }), []);
  assert.deepEqual(closedAccountsOf({}), []);
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

/*
 * The entry's submit against a connection that answers as the chain would: the position is written down — PENDING —
 * before the bytes leave, so an answer lost on the way still leaves the position the wallet signed for.
 */
function chain(d, { send, confirm }) {
  const seen = { pendingAtSend: null, sends: 0 };
  d.connection = {
    async sendRawTransaction() {
      seen.sends++;
      seen.pendingAtSend = await d.store.collection("launchHolderPositions").get(`mainnet:${owner.publicKey.toBase58()}:${POSITION}`);
      return send();
    },
    async confirmTransaction() {
      return confirm();
    },
    async getEpochInfo() {
      return { blockHeight: 50, absoluteSlot: 1_000 };
    },
    async getSignatureStatuses() {
      return { context: { slot: 1_000 }, value: [null] };
    },
  };
  return seen;
}

function ticking(d, stepMs) {
  let at = Date.parse("2026-10-07T12:00:00.000Z");
  d.now = () => new Date((at += stepMs));
}

const signedEntry = async (d) => {
  const { tx, record, store } = built(d);
  await store();
  const copy = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  copy.partialSign(owner);
  return { record, signedWireBase64: copy.serialize().toString("base64") };
};

const positionKey = () => `mainnet:${owner.publicKey.toBase58()}:${POSITION}`;

test("submit: the position is PENDING before the send, then OPEN once the chain confirms", async () => {
  const d = deps();
  const seen = chain(d, { send: async () => "sig", confirm: async () => ({ value: { err: null } }) });
  const { record, signedWireBase64 } = await signedEntry(d);
  const out = await submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), signedWireBase64 });
  assert.equal(out.ok, true);
  assert.equal(out.submit.state, "CONFIRMED");
  assert.equal(seen.sends, 1);
  assert.equal(seen.pendingAtSend?.state, "PENDING", "written before the bytes left");
  assert.equal(seen.pendingAtSend?.position, POSITION);
  assert.equal((await d.store.collection("launchHolderPositions").get(positionKey())).state, "OPEN");
});

test("submit: an answer lost on the way keeps the PENDING position and says PENDING — never a second send", async () => {
  const d = deps();
  ticking(d, 4_000);
  const seen = chain(d, { send: async () => { throw new Error("socket hang up"); }, confirm: async () => ({ value: { err: null } }) });
  const { record, signedWireBase64 } = await signedEntry(d);
  const out = await submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), signedWireBase64 });
  assert.equal(out.ok, true);
  assert.equal(out.submit.state, "PENDING");
  assert.equal(seen.sends, 1);
  assert.equal((await d.store.collection("launchHolderPositions").get(positionKey())).state, "PENDING");
  assert.equal((await submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), signedWireBase64 })).code, "LAUNCH_BUILD_USED");
  assert.equal(seen.sends, 1);
});

test("submit: a refusal before landing removes the PENDING position; a slippage refusal says so", async () => {
  for (const [logs, code] of [[["Program log: custom program error: 0x1"], "LAUNCH_SUBMIT_FAILED"], [["Program log: Error Code: ExceededSlippage"], "LAUNCH_SLIPPAGE"]]) {
    const d = deps();
    const seen = chain(d, {
      send: async () => {
        throw Object.assign(new Error("Transaction simulation failed: Error processing Instruction 2"), { logs });
      },
      confirm: async () => ({ value: { err: null } }),
    });
    const { record, signedWireBase64 } = await signedEntry(d);
    const out = await submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), signedWireBase64 });
    assert.equal(out.code, code);
    assert.equal(seen.pendingAtSend?.state, "PENDING");
    assert.equal(await d.store.collection("launchHolderPositions").get(positionKey()), undefined);
  }
});

test("the holder's wallet signs the entry first: the position NFT's key signs after, over the exact message the wallet signed", async () => {
  const env = { BETA_TOKEN_SECRET: "a-server-key-long-enough" };
  const nft = Keypair.generate();
  /* The entry as built: paid and signed by the wallet, the new position's NFT signing beside it — its slot emptied for the wallet. */
  const entry = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    SystemProgram.transfer({ fromPubkey: nft.publicKey, toPubkey: owner.publicKey, lamports: 0 }),
  );
  entry.feePayer = owner.publicKey;
  entry.recentBlockhash = Keypair.generate().publicKey.toBase58();
  entry.partialSign(nft);
  const presigned = Buffer.from(entry.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  const unsigned = withoutSignaturesOf(presigned, [nft.publicKey.toBase58()]);
  assert.ok(Transaction.from(Buffer.from(unsigned, "base64")).signatures.every((entry) => entry.signature === null || entry.signature.every((byte) => byte === 0)), "the wallet sees no signature but its own slot to fill");
  const lighthouse = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE_PROGRAM), keys: [{ pubkey: owner.publicKey, isSigner: false, isWritable: false }], data: Buffer.from("0604030053969c00000000000403000001000000000000000000", "hex") });
  /* What the wallet returns: the built message with its own signature — and, as Phantom does, its own assertion after the rest. */
  const walletSigns = (wire, { add = [], signer = owner } = {}) => {
    const seen = Transaction.from(Buffer.from(wire, "base64"));
    const signed = new Transaction().add(...seen.instructions, ...add);
    signed.feePayer = seen.feePayer;
    signed.recentBlockhash = seen.recentBlockhash;
    signed.partialSign(signer);
    return signed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  };
  const setup = async (cosign) => {
    const d = deps();
    d.env = env;
    const sent = [];
    d.connection = {
      async sendRawTransaction(bytes) {
        sent.push(Transaction.from(bytes));
        return "sig";
      },
      async confirmTransaction() {
        return { value: { err: null } };
      },
    };
    const record = {
      id: "e".repeat(32), cluster: "mainnet", token: TOKEN, wallet: owner.publicKey.toBase58(), kind: "entry", pool: TOKEN, position: POSITION, nftMint: nft.publicKey.toBase58(),
      wireBase64: unsigned, validUntil: "100", createdAt: "2026-10-07T11:59:00.000Z", expiresAt: "2026-10-07T12:01:00.000Z",
      input: "pair", amountRaw: "1000000", enteredPairRaw: "1000000", feeRaw: "0", granted: true, cosign,
    };
    await d.store.collection("launchHolderBuilds").set(`mainnet:${record.id}`, record);
    const submit = (signedWireBase64) => submitLaunchHolder(d, TOKEN, { buildId: record.id, wallet: owner.publicKey.toBase58(), signedWireBase64 });
    return { d, sent, submit };
  };
  const sealed = sealCosigners([{ index: 0, key: nft }], env);

  {
    const { sent, submit } = await setup(sealed);
    assert.equal((await submit(unsigned)).code, "LAUNCH_SIGNED_OTHER_BYTES", "the wallet's signature is not there");
    const forged = Transaction.from(Buffer.from(walletSigns(unsigned), "base64"));
    forged.signatures[0].signature = Buffer.from(Keypair.generate().secretKey.subarray(0, 64));
    assert.equal((await submit(forged.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"))).code, "LAUNCH_SIGNED_OTHER_BYTES", "a signature that is not the wallet's");
    const extra = SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: owner.publicKey, lamports: 1 });
    assert.equal((await submit(walletSigns(unsigned, { add: [extra] }))).code, "LAUNCH_SIGNED_OTHER_BYTES", "a signer the entry was not built with");
    assert.equal(sent.length, 0, "nothing was sent on a refusal");
  }
  {
    const { d, submit } = await setup(sealed);
    d.env = { BETA_TOKEN_SECRET: "another-server-key-long" };
    assert.equal((await submit(walletSigns(unsigned))).code, "LAUNCH_BUILD_EXPIRED", "a key sealed with another key does not open");
  }
  {
    const { submit } = await setup(`${sealed.slice(0, -2)}AA`);
    assert.equal((await submit(walletSigns(unsigned))).code, "LAUNCH_BUILD_EXPIRED", "a doctored seal does not open");
  }

  /* Accepted: the wallet signed first with its own assertion; the NFT signs after, over exactly what the wallet signed. */
  const { sent, submit } = await setup(sealed);
  const signed = walletSigns(unsigned, { add: [lighthouse] });
  const out = await submit(signed);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(sent.length, 1);
  const [landed] = sent;
  assert.ok(landed.verifySignatures(true), "the wallet and the NFT — every signature real");
  const wallet = Transaction.from(Buffer.from(signed, "base64"));
  assert.equal(landed.serializeMessage().toString("base64"), wallet.serializeMessage().toString("base64"), "the message the wallet signed, its assertion with it");
  assert.equal(Buffer.from(landed.signatures[0].signature).toString("base64"), Buffer.from(wallet.signatures[0].signature).toString("base64"), "the wallet's own signature is the one sent");
});
