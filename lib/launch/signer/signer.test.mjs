/**
 * CITY-162 — Launch's signers: the `env` and `kms` adapters behind one interface, the switch and its rollback, the
 * bounds each key signs within, the journal, and a launch's whole submit with its pool payer in KMS. KMS is a local
 * stand-in that answers in KMS's own REST format (`./kms-stub.fixture.mjs`); every key here is a throwaway made for
 * the run — no real key, no real token.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { LOCK_PROGRAM_ID } from "@meteora-ag/met-lock-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../../attribution/registry.ts";
import { createMemoryGuardStore } from "../../guard/store.ts";
import { sealCosigners } from "../../liquidity/studio/ticket.ts";
import { ed25519Valid } from "../../solana/limits/trigger-tx.ts";
import { buildV1Wire, kitInstruction, readV1 } from "../../solana/v1-tx.ts";
import { V1Creation } from "../atomic-lock.server.ts";
import { launchExecutor, launchExecutorAddress, launchNetwork, launchPoolPayer, launchPoolPayerAddress } from "../config.server.ts";
import { submitLaunch } from "../flow.server.ts";
import { anchorDiscriminator, POOL_PAYER_LOCK_INSTRUCTION } from "./bounds.server.ts";
import { envKey } from "./env.server.ts";
import { crc32c, forgetKmsAddresses, forgetKmsTokens, kmsEndpoint, kmsPublicAddress, kmsTokenSource, KMS_KEY_VERSION, SERVICE_ACCOUNT, vercelOidcToken, WIF_PROVIDER } from "./gcp-kms.server.ts";
import { readSignatures, storeJournal } from "./journal.server.ts";
import { STUB_TOKEN, startKmsStub, versionName } from "./kms-stub.fixture.mjs";
import { launchSignerMode } from "./select.server.ts";
import { SignerRefused, signTransaction } from "./signer.server.ts";

/* DLMM's module build does not load under plain Node; its CommonJS build does — the IDL is the same. */
const { IDL: DlmmIdl } = createRequire(import.meta.url)("@meteora-ag/dlmm");

const BLOCKHASH = "11111111111111111111111111111111";
const DEVNET = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const secretOf = (keypair) => JSON.stringify([...keypair.secretKey]);
const memoryJournal = (rows = []) => Object.assign(async (row) => void rows.push(row), { rows });

/** An instruction of a Meteora program as its IDL lays it out: the named accounts, the rest random; `signers` sign. */
function ix(idl, name, named, signers = []) {
  const shape = idl.instructions.find((entry) => entry.name === name);
  assert.ok(shape, name);
  const keys = shape.accounts.map((account) => {
    const pubkey = named[account.name] ?? Keypair.generate().publicKey;
    return { pubkey, isSigner: signers.some((signer) => signer.equals(pubkey)), isWritable: true };
  });
  return new TransactionInstruction({ programId: new PublicKey(idl.address), keys, data: Buffer.from([...shape.discriminator, 0, 0, 0, 0, 0, 0, 0, 0]) });
}

/** The creator's lock as Met Lock lays it out (base, escrow, mint, escrow token, sender, sender token, recipient, …). */
function lockIx(base, creator, mint) {
  const keys = [base, Keypair.generate().publicKey, mint, Keypair.generate().publicKey, creator, Keypair.generate().publicKey, creator, TOKEN_2022_PROGRAM_ID, SystemProgram.programId, Keypair.generate().publicKey, LOCK_PROGRAM_ID].map((pubkey, at) => ({
    pubkey,
    isSigner: at === 0 || at === 4,
    isWritable: [0, 1, 3, 4, 5].includes(at),
  }));
  return new TransactionInstruction({ programId: LOCK_PROGRAM_ID, keys, data: Buffer.from([...anchorDiscriminator(POOL_PAYER_LOCK_INSTRUCTION), 0, 0, 0, 0]) });
}

/** A launch's creation as the engine builds it: the cover, one pool, the creator's first purchase, the creator's accounts, the lock. */
function creationInstructions({ payer, creator, mint, base, extra = [] }) {
  const quote = Keypair.generate().publicKey;
  return [
    SystemProgram.transfer({ fromPubkey: creator, toPubkey: payer, lamports: 9_000_000 }),
    ix(DynamicBondingCurveIdl, "initialize_virtual_pool_with_token2022", { payer, creator, base_mint: mint, quote_mint: quote }, [payer, mint]),
    createAssociatedTokenAccountIdempotentInstruction(creator, getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022_PROGRAM_ID), creator, mint, TOKEN_2022_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: creator, toPubkey: getAssociatedTokenAddressSync(quote, creator, false, TOKEN_PROGRAM_ID), lamports: 1_000 }),
    createSyncNativeInstruction(getAssociatedTokenAddressSync(quote, creator, false, TOKEN_PROGRAM_ID)),
    ix(DynamicBondingCurveIdl, "swap", { payer: creator, base_mint: mint, quote_mint: quote }, [creator]),
    ...(base ? [lockIx(base, creator, mint)] : []),
    ...extra,
  ];
}

function legacyMessage(instructions, feePayer) {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayer;
  tx.recentBlockhash = BLOCKHASH;
  return tx;
}

const v1Wire = (instructions, owner, priorityFeeLamports = 0n) =>
  buildV1Wire({ owner: owner.toBase58(), instructions: instructions.map(kitInstruction), blockhash: BLOCKHASH, lastValidBlockHeight: 100, limits: { computeUnitLimit: 400_000, loadedAccountsDataSizeLimit: 1 << 20, priorityFeeLamports } });

/** KMS-mode environment for a role, over the stub. */
function kmsEnv(stub, extra = {}) {
  const payer = versionName("pool-payer");
  const executor = versionName("executor");
  return {
    ...DEVNET,
    RYNTRA_LAUNCH_SIGNER: "kms",
    RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY: payer,
    RYNTRA_LAUNCH_POOL_PAYER_ADDRESS: stub.addressOf(payer),
    RYNTRA_LAUNCH_EXECUTOR_KMS_KEY: executor,
    RYNTRA_LAUNCH_EXECUTOR_ADDRESS: stub.addressOf(executor),
    RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint,
    RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN,
    ...extra,
  };
}

async function withStub(run) {
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    await run(stub);
  } finally {
    await stub.close();
  }
}

/* ------------------------------------------------------------------ CRC32C and the endpoint */

test("CRC32C is Castagnoli's, the checksum KMS sends and checks", () => {
  assert.equal(crc32c(Buffer.from("123456789")), 0xe3069283);
  assert.equal(crc32c(new Uint8Array()), 0);
});

test("KMS's endpoint is Google's, or a loopback address for a stand-in — a token never goes to another host", () => {
  assert.equal(kmsEndpoint(undefined), "https://cloudkms.googleapis.com");
  assert.equal(kmsEndpoint("http://127.0.0.1:8081"), "http://127.0.0.1:8081");
  assert.equal(kmsEndpoint("http://localhost:9000/"), "http://localhost:9000");
  for (const other of ["https://kms.example.com", "http://10.0.0.1:80", "https://cloudkms.googleapis.com.evil.io", "http://127.0.0.1:1/v1", "not a url"]) assert.equal(kmsEndpoint(other), null, other);
});

test("the KMS names the deployment is set up with are names the adapter takes", () => {
  for (const key of ["pool-payer", "launch-executor"]) assert.match(`projects/ryntra-513408/locations/us-east4/keyRings/ryntra-signers/cryptoKeys/${key}/cryptoKeyVersions/1`, KMS_KEY_VERSION);
  assert.match("ryntra-signer@ryntra-513408.iam.gserviceaccount.com", SERVICE_ACCOUNT);
  assert.match("projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel-ryntra", WIF_PROVIDER);
  assert.doesNotMatch("projects/ryntra-513408/locations/us-east4/keyRings/ryntra-signers/cryptoKeys/pool-payer", KMS_KEY_VERSION, "a key without its version");
});

/* ------------------------------------------------------------------ the env adapter */

test("env: the key is read once, signs, and gives out only its address", async () => {
  const keypair = Keypair.generate();
  for (const raw of [secretOf(keypair), ` ${getBase58Decoder().decode(keypair.secretKey)}\n`]) {
    const key = envKey(raw);
    assert.equal(key.address, keypair.publicKey.toBase58());
    assert.equal(key.signer.mode, "env");
    const message = Buffer.from("a message");
    assert.ok(ed25519Valid(message, await key.signer.sign(message), keypair.publicKey));
    const shown = JSON.stringify(key) + Object.keys(key.signer).join(",");
    assert.ok(!shown.includes(String(keypair.secretKey[0]) + "," + String(keypair.secretKey[1])), "no key bytes in what the adapter shows");
  }
  assert.equal(envKey(undefined), null);
  assert.equal(envKey("[1,2,3]"), null);
  assert.equal(envKey(getBase58Decoder().decode(keypair.secretKey.slice(0, 32))), null, "half a key is no key");
  const mixed = Uint8Array.from([...keypair.secretKey.slice(0, 32), ...Keypair.generate().publicKey.toBytes()]);
  assert.equal(envKey(JSON.stringify([...mixed])), null, "a seed with another key's public half is no key");
});

/* ------------------------------------------------------------------ the switch and the rollback */

test("one switch: unset or env — the environment's key, as before; kms — KMS; anything else — nothing signs", async () => {
  await withStub(async (stub) => {
    const old = Keypair.generate();
    const env = { ...kmsEnv(stub), RYNTRA_LAUNCH_POOL_PAYER_SECRET: secretOf(old) };
    assert.equal(launchSignerMode({}), "env");
    assert.equal(launchSignerMode({ RYNTRA_LAUNCH_SIGNER: " KMS " }), "kms");
    assert.equal(launchSignerMode({ RYNTRA_LAUNCH_SIGNER: "vault" }), null);
    const network = launchNetwork(DEVNET);
    /* KMS: the address the deployment names for the KMS key — the environment's secret is not even read. */
    const inKms = launchPoolPayer(env, network);
    assert.equal(inKms.mode, "kms");
    assert.equal(inKms.address, stub.addressOf(versionName("pool-payer")));
    assert.notEqual(inKms.address, old.publicKey.toBase58());
    /* Rollback: one variable back, and the environment's key signs again. */
    for (const back of [{ ...env, RYNTRA_LAUNCH_SIGNER: "env" }, { ...env, RYNTRA_LAUNCH_SIGNER: undefined }]) {
      const inEnv = launchPoolPayer(back, network);
      assert.equal(inEnv.mode, "env");
      assert.equal(inEnv.address, old.publicKey.toBase58());
    }
    /* A mistyped switch falls back to nothing, never to the other adapter. */
    assert.equal(launchPoolPayer({ ...env, RYNTRA_LAUNCH_SIGNER: "kmss" }, network), null);
    assert.equal(launchExecutor({ ...env, RYNTRA_LAUNCH_SIGNER: "kmss" }, network), null);
    /* KMS without what it needs is no key: the version, the address, the way in. */
    for (const name of ["RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY", "RYNTRA_LAUNCH_POOL_PAYER_ADDRESS", "RYNTRA_LAUNCH_KMS_ACCESS_TOKEN"]) assert.equal(launchPoolPayer({ ...env, [name]: undefined }, network), null, name);
    assert.equal(launchPoolPayer({ ...env, RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY: "projects/x/keys/y" }, network), null, "not a key version");
    assert.equal(launchPoolPayer({ ...env, RYNTRA_LAUNCH_KMS_ENDPOINT: "https://kms.example.com" }, network), null, "not Google's endpoint");
    /* The addresses pages read follow the switch on devnet. */
    assert.equal(launchPoolPayerAddress(network, env), inKms.address);
    assert.equal(launchExecutorAddress(network, env), stub.addressOf(versionName("executor")));
  });
});

test("mainnet: only the registry's pool payer and executor are keys — a KMS key for another address is refused, never used", async () => {
  await withStub(async (stub) => {
    const mainnet = launchNetwork({});
    assert.equal(mainnet.cluster, "mainnet");
    assert.equal(launchPoolPayer(kmsEnv(stub), mainnet), null, "a KMS address that is not the registry's");
    assert.equal(launchExecutor(kmsEnv(stub), mainnet), null);
    /* Naming the registry's address is not enough: the KMS key must be that address, or it signs nothing. */
    const registry = ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-launch-pool-payer").address;
    const rows = [];
    const named = launchPoolPayer(kmsEnv(stub, { RYNTRA_LAUNCH_POOL_PAYER_ADDRESS: registry }), mainnet, { journal: memoryJournal(rows) });
    assert.equal(named.address, registry);
    const payer = new PublicKey(registry);
    const creation = legacyMessage(creationInstructions({ payer, creator: Keypair.generate().publicKey, mint: Keypair.generate().publicKey }), payer);
    await assert.rejects(named.signMessage(creation.serializeMessage()), (error) => error instanceof SignerRefused && /not .* the deployment names/.test(error.reason));
    assert.deepEqual(rows.map((row) => row.outcome), ["REFUSED"]);
  });
});

/* ------------------------------------------------------------------ the kms adapter */

test("kms: the address is read from KMS, the message goes as data with its CRC32C, the signature is checked and journaled", async () => {
  await withStub(async (stub) => {
    const env = kmsEnv(stub);
    const network = launchNetwork(DEVNET);
    const rows = [];
    const payer = launchPoolPayer(env, network, { journal: memoryJournal(rows) });
    assert.equal(await kmsPublicAddress({ keyVersion: versionName("pool-payer"), endpoint: stub.endpoint, token: async () => STUB_TOKEN }), payer.address);
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const creation = legacyMessage(creationInstructions({ payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey }), payer.publicKey);
    const message = creation.serializeMessage();
    const signature = await payer.signMessage(message);
    assert.ok(ed25519Valid(message, signature, payer.publicKey), "the pool payer's own signature");
    const signCall = stub.calls.find((call) => call.method === "POST");
    const sent = JSON.parse(signCall.body);
    assert.deepEqual(Object.keys(sent).sort(), ["data", "dataCrc32c"], "Ed25519 signs the data itself, never a digest");
    assert.equal(Buffer.from(sent.data, "base64").toString("hex"), Buffer.from(message).toString("hex"));
    assert.equal(sent.dataCrc32c, String(crc32c(message)));
    assert.equal(signCall.authorization, `Bearer ${STUB_TOKEN}`);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { ...rows[0], at: "" },
      {
        v: 1,
        cluster: "devnet",
        role: "pool-payer",
        mode: "kms",
        signer: payer.address,
        keyRef: versionName("pool-payer"),
        action: "dbc.initialize_virtual_pool_with_token2022+dbc.swap",
        subject: mint.publicKey.toBase58(),
        messageSha256: sha256(message),
        signature: getBase58Decoder().decode(signature),
        outcome: "SIGNED",
        reason: null,
        at: "",
      },
    );
    /* The address is read once per process: the second signature asks KMS to sign only. */
    const reads = stub.calls.filter((call) => call.url.endsWith("/publicKey")).length;
    await payer.signMessage(message);
    assert.equal(stub.calls.filter((call) => call.url.endsWith("/publicKey")).length, reads);
  });
});

test("kms: an answer that is not exactly right gives no signature — and the refusal is journaled", async () => {
  for (const fault of ["algorithm", "pemCrc", "signatureCrc", "unverified", "otherName", "wrongSignature", "denied"]) {
    await withStub(async (stub) => {
      stub.faults.add(fault);
      const rows = [];
      const payer = launchPoolPayer(kmsEnv(stub), launchNetwork(DEVNET), { journal: memoryJournal(rows) });
      const creation = legacyMessage(creationInstructions({ payer: payer.publicKey, creator: Keypair.generate().publicKey, mint: Keypair.generate().publicKey }), payer.publicKey);
      await assert.rejects(payer.signMessage(creation.serializeMessage()), (error) => error instanceof SignerRefused, fault);
      assert.deepEqual(rows.map((row) => [row.outcome, row.signature]), [["REFUSED", null]], fault);
      if (fault === "denied") assert.match(rows[0].reason, /403 PERMISSION_DENIED/);
      assert.ok(!JSON.stringify(rows).includes(STUB_TOKEN), "a token never reaches the journal");
    });
  }
});

test("kms: a KMS key that is not the address the deployment names signs nothing", async () => {
  await withStub(async (stub) => {
    const rows = [];
    const elsewhere = Keypair.generate().publicKey.toBase58();
    const payer = launchPoolPayer(kmsEnv(stub, { RYNTRA_LAUNCH_POOL_PAYER_ADDRESS: elsewhere }), launchNetwork(DEVNET), { journal: memoryJournal(rows) });
    const creation = legacyMessage(creationInstructions({ payer: payer.publicKey, creator: Keypair.generate().publicKey, mint: Keypair.generate().publicKey }), payer.publicKey);
    await assert.rejects(payer.signMessage(creation.serializeMessage()), /not .* the deployment names/);
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "KMS was never asked to sign");
  });
});

/* ------------------------------------------------------------------ the bounds */

test("the pool payer signs a launch's creation — legacy or v1, with the lock — and nothing else, each refusal with its reason", async () => {
  const keypair = Keypair.generate();
  const network = launchNetwork(DEVNET);
  const rows = [];
  const payer = launchPoolPayer({ ...DEVNET, RYNTRA_LAUNCH_POOL_PAYER_SECRET: secretOf(keypair) }, network, { journal: memoryJournal(rows) });
  const creator = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const base = Keypair.generate().publicKey;
  const at = (instructions) => ({ payer: payer.publicKey, creator, mint, base: null, ...instructions });
  /* Allowed: the engine's own shapes. */
  const legacy = legacyMessage(creationInstructions(at({})), payer.publicKey).serializeMessage();
  assert.ok(ed25519Valid(legacy, await payer.signMessage(legacy), payer.publicKey));
  const v1 = readV1(Buffer.from(v1Wire(creationInstructions(at({ base })), payer.publicKey), "base64")).messageBytes;
  assert.ok(ed25519Valid(v1, await payer.signMessage(v1), payer.publicKey));
  assert.equal(rows.at(-1).action, "dbc.initialize_virtual_pool_with_token2022+dbc.swap+lock.create_vesting_escrow_v2");
  /* Refused: anything else. */
  const stranger = Keypair.generate().publicKey;
  const refused = async (message, pattern, label) => {
    await assert.rejects(payer.signMessage(message), (error) => error instanceof SignerRefused && pattern.test(error.reason), label);
  };
  const legacyWith = (extra, feePayer = payer.publicKey) => legacyMessage(creationInstructions(at({ extra })), feePayer).serializeMessage();
  await refused(legacyWith([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: stranger, lamports: 1 })]), /a transfer out of the pool payer/, "a transfer out");
  await refused(legacyWith([ix(DynamicBondingCurveIdl, "swap", { payer: payer.publicKey }, [payer.publicKey])]), /a trade that names the pool payer/, "the payer trades");
  await refused(legacyWith([ix(DynamicBondingCurveIdl, "initialize_virtual_pool_with_spl_token", { payer: payer.publicKey }, [payer.publicKey])]), /more than one pool/, "two pools");
  await refused(legacyWith([ix(DynamicBondingCurveIdl, "claim_trading_fee", {}, [])]), /claim_trading_fee is not in a launch's creation/, "another DBC instruction");
  await refused(legacyWith([new TransactionInstruction({ programId: stranger, keys: [], data: Buffer.from([1]) })]), /is not in a launch's creation/, "another program");
  await refused(legacyWith([createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, getAssociatedTokenAddressSync(mint, stranger, false, TOKEN_2022_PROGRAM_ID), stranger, mint, TOKEN_2022_PROGRAM_ID)]), /funds or owns/, "an account the payer funds");
  await refused(legacyWith([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })]), /compute-budget/, "a priority price");
  await refused(legacyWith([SystemProgram.assign({ accountPubkey: creator, programId: stranger })]), /other than a transfer/, "another System instruction");
  await refused(legacyMessage([SystemProgram.transfer({ fromPubkey: creator, toPubkey: payer.publicKey, lamports: 1 })], payer.publicKey).serializeMessage(), /opens no pool/, "no pool");
  await refused(legacyWith([], creator), /does not ask this key to sign|not the pool payer/, "another fee payer");
  await refused(readV1(Buffer.from(v1Wire(creationInstructions(at({})), payer.publicKey, 5_000n), "base64")).messageBytes, /priority fee/, "a v1 priority fee");
  await refused(Buffer.from("not a message at all"), /not a transaction message/, "bytes that are no message");
  assert.equal(rows.filter((row) => row.outcome === "REFUSED").length, 12);
  assert.ok(rows.filter((row) => row.outcome === "REFUSED").every((row) => row.signature === null && row.reason));
});

test("the executor signs its list only, legacy, as fee payer — the chain's own check, again on the bytes the key is handed", async () => {
  await withStub(async (stub) => {
    const network = launchNetwork(DEVNET);
    const rows = [];
    const executor = launchExecutor(kmsEnv(stub), network, { dlmm: DlmmIdl, journal: memoryJournal(rows) });
    assert.equal(executor.mode, "kms");
    const self = executor.publicKey;
    const token = Keypair.generate().publicKey;
    const usdc = Keypair.generate().publicKey;
    const own = (mint, program) => getAssociatedTokenAddressSync(mint, self, true, program);
    const claim = ix(DynamicBondingCurveIdl, "claim_trading_fee", { base_mint: token, quote_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: own(usdc, TOKEN_PROGRAM_ID), fee_claimer: self }, [self]);
    /* The way the chain's `prepare` signs: the fresh keys first, then the executor's signer over the same message. */
    const nft = Keypair.generate();
    const migration = ix(DynamicBondingCurveIdl, "migration_damm_v2", { payer: self, first_position_nft_mint: nft.publicKey }, [self, nft.publicKey]);
    const tx = legacyMessage([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), migration], self);
    tx.signatures = [];
    tx.partialSign(nft);
    await signTransaction(executor, tx);
    assert.ok(tx.verifySignatures(), "every signature real: the fresh key's and the executor's");
    assert.equal(rows.at(-1).action, "dbc.migration_damm_v2");
    const steps = ix(DlmmIdl, "rebalance_liquidity", { token_x_mint: token, token_y_mint: usdc, user_token_x: own(token, TOKEN_2022_PROGRAM_ID), user_token_y: own(usdc, TOKEN_PROGRAM_ID), owner: self, rent_payer: self }, [self]);
    for (const allowed of [claim, steps]) await executor.signMessage(legacyMessage([allowed], self).serializeMessage());
    const stranger = Keypair.generate().publicKey;
    const refusals = [
      [legacyMessage([SystemProgram.transfer({ fromPubkey: self, toPubkey: stranger, lamports: 1 })], self), /not on the executor's list/],
      [legacyMessage([ix(DynamicBondingCurveIdl, "claim_trading_fee", { base_mint: token, quote_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID), fee_claimer: self }, [self])], self), /not the executor's own/],
      [legacyMessage([claim], stranger), /does not ask this key to sign|not the executor/],
    ];
    for (const [message, pattern] of refusals) await assert.rejects(executor.signMessage(message.serializeMessage()), (error) => error instanceof SignerRefused && pattern.test(error.reason));
    const v1 = readV1(Buffer.from(v1Wire([claim], self), "base64")).messageBytes;
    await assert.rejects(executor.signMessage(v1), /legacy transactions only/);
    /* Without DLMM's IDL the executor's steps are on no list: refused, never signed blind. */
    const blind = launchExecutor(kmsEnv(stub), network, { journal: memoryJournal() });
    await assert.rejects(blind.signMessage(legacyMessage([steps], self).serializeMessage()), /not on the executor's list/);
  });
});

/* ------------------------------------------------------------------ the journal */

test("the journal keeps one row per signature in the store, public data only; no row — no signature", async () => {
  const keypair = Keypair.generate();
  const store = createMemoryGuardStore();
  const lines = [];
  const network = launchNetwork(DEVNET);
  const env = { ...DEVNET, RYNTRA_LAUNCH_POOL_PAYER_SECRET: secretOf(keypair) };
  const payer = launchPoolPayer(env, network, { journal: storeJournal(() => store, (line) => lines.push(line)) });
  const message = legacyMessage(creationInstructions({ payer: payer.publicKey, creator: Keypair.generate().publicKey, mint: Keypair.generate().publicKey }), payer.publicKey).serializeMessage();
  const signature = await payer.signMessage(message);
  const rows = await readSignatures(store, "devnet", "pool-payer");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signature, getBase58Decoder().decode(signature));
  assert.equal(rows[0].messageSha256, sha256(message));
  assert.equal(JSON.parse(lines[0]).event, "launch.signature");
  const everything = JSON.stringify(rows) + lines.join("");
  assert.ok(!everything.includes(secretOf(keypair)) && !everything.includes(getBase58Decoder().decode(keypair.secretKey)), "no key in the journal");
  /* A journal that cannot write: the key signs, but the signature never leaves — nothing is sent without its row. */
  const broken = launchPoolPayer(env, network, { journal: async () => { throw new Error("store down"); } });
  await assert.rejects(broken.signMessage(message), /store down/);
  /* No journal at all: the signer signs nothing. */
  await assert.rejects(launchPoolPayer(env, network).signMessage(message), /no signing journal/);
});

/* ------------------------------------------------------------------ credentials */

test("credentials: Vercel's OIDC token, exchanged at Google's STS, the service account impersonated with the KMS scope; kept until a minute before it ends", async () => {
  forgetKmsTokens();
  const provider = "projects/123456789/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-ryntra";
  const account = "launch-signer@ryntra-test.iam.gserviceaccount.com";
  const calls = [];
  let now = Date.parse("2026-11-01T10:00:00.000Z");
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://sts.googleapis.com/v1/token") return new Response(JSON.stringify({ access_token: "federated", expires_in: 3600 }), { status: 200 });
    if (url.startsWith("https://iamcredentials.googleapis.com/")) return new Response(JSON.stringify({ accessToken: `impersonated-${calls.length}`, expireTime: new Date(now + 900_000).toISOString() }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const env = { RYNTRA_LAUNCH_KMS_WIF_PROVIDER: provider, RYNTRA_LAUNCH_KMS_SERVICE_ACCOUNT: account };
  const source = kmsTokenSource(env, { fetch: fetcher, now: () => now, oidcToken: async () => "vercel-oidc" });
  assert.equal(await source(), "impersonated-2");
  const sts = new URLSearchParams(calls[0].init.body);
  assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(sts.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(sts.get("audience"), `//iam.googleapis.com/${provider}`);
  assert.equal(sts.get("subject_token"), "vercel-oidc");
  assert.equal(sts.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
  assert.equal(sts.get("requested_token_type"), "urn:ietf:params:oauth:token-type:access_token");
  assert.equal(calls[1].url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:generateAccessToken`);
  assert.equal(calls[1].init.headers.authorization, "Bearer federated");
  assert.deepEqual(JSON.parse(calls[1].init.body).scope, ["https://www.googleapis.com/auth/cloudkms"]);
  assert.equal(await source(), "impersonated-2", "kept");
  now += 15 * 60_000;
  assert.equal(await source(), "impersonated-4", "renewed near its end");
  /* No OIDC token here (a preview without it, a local server): no KMS token, and no signature. */
  forgetKmsTokens();
  await assert.rejects(kmsTokenSource(env, { fetch: fetcher, oidcToken: async () => null })(), /no OIDC token/);
  /* Nothing configured, or malformed: no way in, and the kms adapter is not here. */
  assert.equal(kmsTokenSource({}), null);
  assert.equal(kmsTokenSource({ ...env, RYNTRA_LAUNCH_KMS_SERVICE_ACCOUNT: "someone@gmail.com" }), null);
  assert.equal(await kmsTokenSource({ RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: " handed " })(), "handed");
});

test("Vercel's OIDC token is read where Vercel puts it: the request's header first, then the environment", async () => {
  const slot = Symbol.for("@vercel/request-context");
  const before = globalThis[slot];
  try {
    globalThis[slot] = { get: () => ({ headers: { "x-vercel-oidc-token": "from-header" } }) };
    assert.equal(await vercelOidcToken({ VERCEL_OIDC_TOKEN: "from-env" }), "from-header");
    globalThis[slot] = undefined;
    assert.equal(await vercelOidcToken({ VERCEL_OIDC_TOKEN: "from-env" }), "from-env");
    assert.equal(await vercelOidcToken({}), null);
  } finally {
    globalThis[slot] = before;
  }
});

/* ------------------------------------------------------------------ a launch's submit with the pool payer in KMS */

test("a launch submits with its pool payer in KMS: the creator first, the fresh keys, KMS last — one row in the journal", async () => {
  await withStub(async (stub) => {
    const env = { ...kmsEnv(stub), BETA_TOKEN_SECRET: "a-server-key-long-enough" };
    const network = launchNetwork(env);
    const store = createMemoryGuardStore();
    const payer = launchPoolPayer(env, network, { journal: storeJournal(() => store, () => undefined) });
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const base = Keypair.generate();
    const wire = v1Wire(creationInstructions({ payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey, base: base.publicKey }), payer.publicKey);
    const now = new Date("2026-11-01T12:00:00.000Z");
    const sent = [];
    const connection = {
      sendRawTransaction: async (bytes) => {
        sent.push(Uint8Array.from(bytes));
        return "sig";
      },
      confirmTransaction: async () => ({ value: { err: null } }),
    };
    const id = "c".repeat(32);
    await store.collection("launchBuilds").set(`devnet:${id}`, {
      id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "micro", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
      metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "9000000",
      messageSha256: sha256(readV1(Buffer.from(wire, "base64")).messageBytes),
      format: "v1",
      lock: { schedule: "6m-12m", escrow: base.publicKey.toBase58(), amountRaw: "1", cliffAt: 0, endsAt: 0, messageSha256: "", inCreation: true },
      split: null, cosign: sealCosigners([{ index: 0, key: mint }, { index: 0, key: base }], env), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
    });
    const wallet = new V1Creation(Buffer.from(wire, "base64"));
    wallet.partialSign(creator);
    const deps = { network, connection, store, poolPayer: payer, origin: "https://ryntra.io", now: () => now, env };
    const result = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: Buffer.from(wallet.serialize()).toString("base64"), signedLockWireBase64: null });
    assert.equal(result.ok, true, JSON.stringify(result));
    const landed = readV1(sent[0]);
    for (const key of [payer.publicKey, creator.publicKey, mint.publicKey, base.publicKey]) {
      const at = landed.signers.indexOf(key.toBase58());
      assert.ok(ed25519Valid(landed.messageBytes, landed.signatures[at], key), `${key.toBase58()} signed`);
    }
    const rows = await readSignatures(store, "devnet", "pool-payer");
    assert.deepEqual(rows.map((row) => [row.mode, row.outcome, row.signature, row.subject]), [["kms", "SIGNED", result.signature, mint.publicKey.toBase58()]]);
    /* The same build again: refused as used before KMS is asked a second time. */
    const second = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: Buffer.from(wallet.serialize()).toString("base64"), signedLockWireBase64: null });
    assert.equal(second.ok, false);
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 1);
  });
});

test("a launch whose pool payer refuses or cannot sign sends nothing and counts against no limit", async () => {
  await withStub(async (stub) => {
    stub.faults.add("denied");
    const env = { ...kmsEnv(stub), BETA_TOKEN_SECRET: "a-server-key-long-enough" };
    const network = launchNetwork(env);
    const store = createMemoryGuardStore();
    const payer = launchPoolPayer(env, network, { journal: storeJournal(() => store, () => undefined) });
    const creator = Keypair.generate();
    const mint = Keypair.generate();
    const wire = v1Wire(creationInstructions({ payer: payer.publicKey, creator: creator.publicKey, mint: mint.publicKey }), payer.publicKey);
    const now = new Date("2026-11-01T12:00:00.000Z");
    const sent = [];
    const id = "d".repeat(32);
    await store.collection("launchBuilds").set(`devnet:${id}`, {
      id, cluster: "devnet", creator: creator.publicKey.toBase58(), preset: "classic", token: mint.publicKey.toBase58(), pool: mint.publicKey.toBase58(), config: mint.publicKey.toBase58(), pairMint: mint.publicKey.toBase58(),
      metadataUri: "https://ryntra.io/api/launch/metadata/x", name: "Moon Cat", symbol: "MCAT", firstBuyInRaw: "0", firstBuyOutRaw: "0", payerCoveredLamports: "9000000",
      messageSha256: sha256(readV1(Buffer.from(wire, "base64")).messageBytes), format: "v1", lock: null, split: null,
      cosign: sealCosigners([{ index: 0, key: mint }], env), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), validUntil: "100",
    });
    const wallet = new V1Creation(Buffer.from(wire, "base64"));
    wallet.partialSign(creator);
    const deps = { network, connection: { sendRawTransaction: async (bytes) => void sent.push(bytes) }, store, poolPayer: payer, origin: "https://ryntra.io", now: () => now, env };
    const result = await submitLaunch(deps, { buildId: id, creator: creator.publicKey.toBase58(), signedWireBase64: Buffer.from(wallet.serialize()).toString("base64"), signedLockWireBase64: null });
    assert.deepEqual([result.ok, result.code], [false, "SUBMIT_FAILED"]);
    assert.equal(sent.length, 0, "nothing reached the network");
    assert.equal((await store.collection("launchAttempts").valuesWithPrefix("solana:devnet:")).length, 0, "no attempt counted");
    assert.equal((await store.collection("launches").valuesWithPrefix("solana:devnet:")).length, 0, "no launch written");
    assert.deepEqual((await readSignatures(store, "devnet")).map((row) => row.outcome), ["REFUSED"]);
  });
});

test("the Met Lock discriminator the bounds hold is the program's own", () => {
  assert.deepEqual(anchorDiscriminator(POOL_PAYER_LOCK_INSTRUCTION), [181, 155, 104, 183, 182, 128, 35, 47]);
});

test("the signers' sources never name a key's value, and the old Keypair loaders are gone", async () => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../config.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /Keypair\.fromSecretKey|keypairOf/, "the key is read only by the env adapter");
  const chain = readFileSync(new URL("../autopilot-chain.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(chain, /tx\.sign\(executor/, "the executor signs only through its signer");
  const flow = readFileSync(new URL("../flow.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(flow, /partialSign\(deps\.poolPayer\)/, "the pool payer signs only through its signer");
});
