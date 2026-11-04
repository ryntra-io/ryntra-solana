// Run from repo root: node --test lib/solana/treasury/service.test.mjs
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import test from "node:test";

import * as multisig from "@sqds/multisig";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { ed25519Valid } from "../limits/trigger-tx.ts";
import { LIGHTHOUSE_PROGRAM as LIGHTHOUSE } from "../wallet-modification.ts";
import { V1_PREFIX, buildV1Wire, instructionsOfView, kitInstruction, readV1, withV1Signature } from "../v1-tx.ts";
import { buildTreasury, submitTreasury, treasuryNetwork } from "./service.server.ts";
import { buildCreate, readTreasury, tokenHeld } from "./squads.server.ts";

const person = Keypair.generate();
const wallet = person.publicKey.toBase58();
const second = Keypair.generate().publicKey.toBase58();
const programTreasury = Keypair.generate().publicKey;

const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/* A treasury already on chain, with the person as its one member: what a top-up reads. */
const createKey = Keypair.generate().publicKey;
const [treasuryPda] = multisig.getMultisigPda({ createKey });
const [treasuryVault] = multisig.getVaultPda({ multisigPda: treasuryPda, index: 0 });
const [treasuryData] = multisig.accounts.Multisig.fromArgs({
  createKey,
  configAuthority: PublicKey.default,
  threshold: 1,
  timeLock: 0,
  transactionIndex: 0,
  staleTransactionIndex: 0,
  rentCollector: treasuryVault,
  bump: 255,
  members: [{ key: person.publicKey, permissions: { mask: 7 } }],
}).serialize();

/**
 * A node that answers what a build reads: Squads' program config, a treasury (and any `accounts` given), SOL by address
 * (`balances`, else `lamports`), the wallet's USDC, a blockhash and the chain's tip; `send` and `logs` — how its
 * preflight refuses.
 */
function stubConnection({ lamports = 5_000_000_000, balances = new Map(), usdcRaw = "0", accounts = new Map(), send = "Transaction simulation failed: the test node lands nothing", logs = ["Program log: refused"], sent = [], creations = new Map() } = {}) {
  const [configPda] = multisig.getProgramConfigPda({});
  const [data] = multisig.accounts.ProgramConfig.fromArgs({ authority: PublicKey.default, multisigCreationFee: 0, treasury: programTreasury, reserved: Array(64).fill(0) }).serialize();
  /* The wallet's USDC account, as its own bytes say it: only when a test names an amount. */
  const holders = usdcRaw === "0" ? [] : [person.publicKey];
  const tokenAccount = (address) => {
    const holder = holders.find((owner) => address.equals(getAssociatedTokenAddressSync(USDC_DEVNET, owner, true)));
    if (!holder) return null;
    const bytes = Buffer.alloc(165);
    USDC_DEVNET.toBuffer().copy(bytes, 0);
    holder.toBuffer().copy(bytes, 32);
    bytes.writeBigUInt64LE(BigInt(usdcRaw), 64);
    return { data: bytes, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280, executable: false, rentEpoch: 0 };
  };
  const info = (address) =>
    tokenAccount(address) ??
    (address.equals(configPda)
      ? { data, owner: multisig.PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 }
      : address.equals(treasuryPda)
        ? { data: treasuryData, owner: multisig.PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 }
        : accounts.has(address.toBase58())
          ? /* An account given as bytes is Squads'; one given as { data, owner, executable } is whoever owns it. */
            Buffer.isBuffer(accounts.get(address.toBase58()))
            ? { data: accounts.get(address.toBase58()), owner: multisig.PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 }
            : { lamports: 1, rentEpoch: 0, executable: false, ...accounts.get(address.toBase58()) }
          : null);
  return {
    getAccountInfo: async (address) => info(address),
    /* A multisig's history: its creation only, as `creations` gives it (address → signed wire), else nothing. */
    getSignaturesForAddress: async (address) => (creations.has(address.toBase58()) ? [{ signature: `created-${address.toBase58()}` }] : []),
    _rpcRequest: async (method, [signature]) => {
      const address = method === "getTransaction" ? String(signature).replace(/^created-/, "") : "";
      return { result: creations.has(address) ? { meta: { err: null }, transaction: [creations.get(address), "base64"] } : null };
    },
    getMultipleAccountsInfo: async (keys) => keys.map(info),
    getBalance: async (address) => balances.get(address.toBase58()) ?? lamports,
    /* The network's rent rate: 5,080 lamports a byte (an empty account, 128 bytes, is 650,240). */
    getMinimumBalanceForRentExemption: async (bytes) => (128 + bytes) * 5_080,
    /* Some mainnet nodes refuse this: the treasury reads a token account's own bytes instead. */
    getTokenAccountBalance: async () => {
      throw new Error("getTokenAccountBalance is refused by this node");
    },
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1_150 }),
    getEpochInfo: async () => ({ blockHeight: 1_000, absoluteSlot: 2_000 }),
    getRecentPerformanceSamples: async () => [{ numSlots: 150, samplePeriodSecs: 60 }],
    /* The node's preflight refuses: nothing lands in a test, and the send says so at once. */
    sendRawTransaction: async (bytes) => {
      sent.push(Buffer.from(bytes));
      throw Object.assign(new Error(send), { logs });
    },
  };
}

/** `sent` — the bytes the node was handed, in order. */
function deps(node = {}) {
  let now = Date.parse("2026-10-20T12:00:00Z");
  const sent = [];
  return { network: "devnet", connection: stubConnection({ ...node, sent }), store: createMemoryGuardStore(), now: () => new Date(now), advance: (ms) => (now += ms), sent };
}

/* The new multisig's seed key, as the browser makes it: the server gets its public half only. */
const seed = Keypair.generate();
const createRequest = {
  kind: "create",
  wallet,
  createKey: seed.publicKey.toBase58(),
  members: [
    { address: wallet, initiate: true, vote: true, execute: true },
    { address: second, initiate: false, vote: true, execute: false },
  ],
  threshold: 2,
  timeLockSeconds: 86_400,
};

test("the network comes from the deployment's one variable; without it the treasury is not served", () => {
  assert.equal(treasuryNetwork({}), null);
  assert.equal(treasuryNetwork({ NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" }), "devnet");
  assert.equal(treasuryNetwork({ NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" }), "mainnet");
});

test("a create's build: one transaction nobody has signed yet — the wallet first, the browser's seed key after; Squads asks no fee and Ryntra none", async () => {
  const d = deps();
  const built = await buildTreasury(d, createRequest);
  assert.equal(built.ok, true, JSON.stringify(built));
  const { build } = built;
  assert.equal(build.network, "solana:devnet");
  assert.equal(build.unsignedWireBase64.length, 1);
  assert.equal(build.review.kind, "create");
  assert.equal(build.review.creationFeeLamports, "0");
  assert.deepEqual(build.review.rules, { threshold: 2, voters: 2, members: 2, timeLockSeconds: 86_400 });
  const tx = Transaction.from(Buffer.from(build.unsignedWireBase64[0], "base64"));
  assert.equal(tx.feePayer.toBase58(), wallet, "the wallet pays");
  assert.equal(tx.signatures.length, 2);
  assert.equal(tx.signatures.filter((entry) => entry.signature !== null).length, 0, "no signature before the wallet's: Phantom blocks bytes another key has signed");
  assert.ok(tx.signatures.some((entry) => entry.publicKey.equals(seed.publicKey)), "the browser's seed key co-signs");
  /* The loaded-data limit Phantom asks for, then Squads' own: nothing of Ryntra's rides along. */
  const [limit, ...rest] = tx.instructions;
  assert.ok(limit.programId.equals(ComputeBudgetProgram.programId));
  assert.deepEqual([...limit.data], [4, 0, 0, 0, 1], "16 MiB");
  assert.ok(rest.length > 0 && rest.every((instruction) => instruction.programId.equals(multisig.PROGRAM_ID)));
  assert.equal(build.networkCostLamports, "10000");
});

test("a create needs the browser's seed key, unused: none, or one that already seeded a multisig, is refused before any bytes", async () => {
  const { createKey: _, ...noKey } = createRequest;
  const missing = await buildTreasury(deps(), noKey);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "VALIDATION_ERROR");
  const [taken] = multisig.getMultisigPda({ createKey: seed.publicKey });
  const used = await buildTreasury(deps({ accounts: new Map([[taken.toBase58(), treasuryData]]) }), createRequest);
  assert.equal(used.ok, false);
  assert.equal(used.code, "VALIDATION_ERROR");
  assert.match(used.message, /already used/);
});

test("an agent's wallet is built on the browser's seed key too: named, unsigned, its address the seed's", async () => {
  const agentSeed = Keypair.generate();
  const request = { kind: "createAgent", wallet, createKey: agentSeed.publicKey.toBase58(), agent: second, timeLockSeconds: 600, asset: "USDC", amountRaw: "5000000", period: "day", destinations: [wallet] };
  const built = await buildTreasury(deps(), request);
  assert.equal(built.ok, true, JSON.stringify(built));
  const [expected] = multisig.getMultisigPda({ createKey: agentSeed.publicKey });
  assert.equal(built.build.review.multisig, expected.toBase58());
  const tx = Transaction.from(Buffer.from(built.build.unsignedWireBase64[0], "base64"));
  assert.ok(tx.signatures.some((entry) => entry.publicKey.equals(agentSeed.publicKey)), "the seed key co-signs");
  assert.ok(tx.signatures.every((entry) => entry.signature === null), "nobody has signed before the wallet");
  const { createKey: _, ...noKey } = request;
  assert.equal((await buildTreasury(deps(), noKey)).ok, false);
});

test("a build with incomplete rules is refused with the rule it breaks", async () => {
  const refused = await buildTreasury(deps(), { ...createRequest, threshold: 3 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "VALIDATION_ERROR");
  assert.ok(refused.issues.some((issue) => issue.code === "THRESHOLD_RANGE"));
  const agent = await buildTreasury(deps(), { kind: "createAgent", wallet, agent: second, timeLockSeconds: 600, asset: "USDC", amountRaw: "500000000", period: "day", destinations: [wallet] });
  assert.equal(agent.ok, false);
  assert.ok(agent.issues.some((issue) => issue.code === "LIMIT_AGENT_CAP"));
});

test("a submit sends only the bytes it built, signed by the wallet it built them for, once", async () => {
  const d = deps();
  const { build } = await buildTreasury(d, createRequest);
  const signed = Transaction.from(Buffer.from(build.unsignedWireBase64[0], "base64"));
  signed.partialSign(person, seed);
  const signedWire = signed.serialize().toString("base64");

  const other = await submitTreasury(d, { buildId: build.buildId, wallet: second, signedWireBase64: [signedWire] });
  assert.equal(other.code, "WALLET_MISMATCH");

  /* The same message with one more instruction the wallet did not get to show: refused before anything is sent. */
  const tampered = Transaction.from(Buffer.from(build.unsignedWireBase64[0], "base64"));
  tampered.add(SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: new PublicKey(second), lamports: 1 }));
  tampered.partialSign(person);
  const changed = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [tampered.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")] });
  assert.equal(changed.code, "TREASURY_SIGNED_OTHER_BYTES");

  const unsigned = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [build.unsignedWireBase64[0]] });
  assert.equal(unsigned.code, "TREASURY_SIGNED_OTHER_BYTES", "a missing signature");

  const missing = await submitTreasury(d, { buildId: "0".repeat(32), wallet, signedWireBase64: [signedWire] });
  assert.equal(missing.code, "TREASURY_BUILD_NOT_FOUND");

  /* The real one goes out once: the stub node refuses the send, and the second press finds the build used. */
  const first = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [signedWire] });
  assert.equal(first.code, "TREASURY_SUBMIT_FAILED");
  const again = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [signedWire] });
  assert.equal(again.code, "TREASURY_BUILD_USED");
  /* What reached the node: the message the wallet signed, the wallet's signature first and the seed key's after it, both real. */
  assert.equal(d.sent.length, 1);
  const out = VersionedTransaction.deserialize(d.sent[0]);
  assert.deepEqual(Buffer.from(out.message.serialize()), Buffer.from(signed.serializeMessage()));
  assert.equal(out.message.staticAccountKeys[0].toBase58(), wallet);
  out.message.staticAccountKeys.slice(0, out.message.header.numRequiredSignatures).forEach((signer, at) => assert.ok(ed25519Valid(out.message.serialize(), out.signatures[at], signer), `signature ${at}`));
});

/** A Lighthouse assertion as Phantom adds one (account info), on one account. */
const guard = (account, isSigner = false) => new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: account, isSigner, isWritable: false }], data: Buffer.from("0604030053969c00000000000403000001000000000000000000", "hex") });

/** These keys' signatures in a v1 wire — the wallet's, as a wallet that signs v1 returns it; the seed's, as the browser adds it. */
const signedV1By = (wire, keys = [person]) => {
  let bytes = Buffer.from(wire, "base64");
  for (const key of keys) {
    const signature = sign(null, readV1(bytes).messageBytes, createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(key.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" }));
    bytes = Buffer.from(withV1Signature(bytes, key.publicKey.toBase58(), signature));
  }
  return bytes.toString("base64");
};
const LIMITS = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 16 * 1024 * 1024 };

test("a wallet that signs v1 gets v1 bytes: the limits in the message's config, no Compute Budget instruction, the createKey's slot empty", async () => {
  const d = deps();
  const built = await buildTreasury(d, { ...createRequest, format: "v1" });
  assert.equal(built.ok, true, JSON.stringify(built));
  const bytes = Buffer.from(built.build.unsignedWireBase64[0], "base64");
  assert.equal(bytes[0], V1_PREFIX);
  const read = readV1(bytes);
  assert.equal(read.view.payer, wallet);
  assert.equal(read.signers.length, 2);
  assert.ok(read.signatures.every((signature) => signature === null), "nobody has signed yet");
  assert.deepEqual(read.view.config, { ...LIMITS, priorityFeeLamports: 0n, heapSize: null });
  assert.ok(read.view.instructions.every((instruction) => instruction.programId === multisig.PROGRAM_ID.toBase58()));
  assert.equal(built.build.networkCostLamports, "10000", "no priority fee: the network's two signatures");

  /* The wallet signs; the seed key after it, over the same message; what reaches the node is v1 and whole. */
  const walletOnly = await submitTreasury(d, { buildId: built.build.buildId, wallet, signedWireBase64: [signedV1By(built.build.unsignedWireBase64[0])] });
  assert.equal(walletOnly.code, "TREASURY_SIGNED_OTHER_BYTES", "the seed key's signature is missing");
  const first = await submitTreasury(d, { buildId: built.build.buildId, wallet, signedWireBase64: [signedV1By(built.build.unsignedWireBase64[0], [person, seed])] });
  assert.equal(first.code, "TREASURY_SUBMIT_FAILED");
  assert.equal(d.sent.length, 1);
  const out = readV1(d.sent[0]);
  assert.deepEqual(Buffer.from(out.messageBytes), Buffer.from(read.messageBytes));
  assert.equal(out.signers[0], wallet);
  out.signers.forEach((signer, at) => assert.ok(out.signatures[at] && ed25519Valid(out.messageBytes, out.signatures[at], new PublicKey(signer)), `signature ${at}`));
});

test("on a v1 create, a guard naming the createKey is refused; Phantom's guard on the wallet and a config it left without limits go out", async () => {
  const d = deps();
  const { build } = await buildTreasury(d, { ...createRequest, format: "v1" });
  const read = readV1(Buffer.from(build.unsignedWireBase64[0], "base64"));
  const [, createKey$] = read.signers;
  const built = instructionsOfView(read.view).instructions;
  const reply = (extra, limits = { ...LIMITS, priorityFeeLamports: 0n }) => signedV1By(buildV1Wire({ owner: wallet, instructions: [...built, ...extra].map(kitInstruction), blockhash: read.view.lifetime, lastValidBlockHeight: 1_150, limits }));
  const code = async (wire) => (await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [wire] })).code;
  assert.equal(await code(reply([guard(new PublicKey(createKey$), true)])), "TREASURY_SIGNED_OTHER_BYTES");
  assert.equal(d.sent.length, 0);
  assert.equal(await code(signedV1By(reply([guard(person.publicKey, true)], { computeUnitLimit: undefined, loadedAccountsDataSizeLimit: undefined, priorityFeeLamports: 0n }), [seed])), "TREASURY_SUBMIT_FAILED");
  assert.equal(d.sent.length, 1, "the runtime's defaults stand for limits a wallet left out");
});

test("v1 bytes back from the wallet are held to the build: no Compute Budget instruction, no other payment, no unsigned or legacy reply", async () => {
  const d = deps();
  const { build } = await buildTreasury(d, { kind: "deposit", wallet, multisig: treasuryPda.toBase58(), asset: "SOL", amountRaw: "10000000", format: "v1" });
  const read = readV1(Buffer.from(build.unsignedWireBase64[0], "base64"));
  assert.deepEqual(read.view.config, { ...LIMITS, priorityFeeLamports: 0n, heapSize: null });
  const code = async (wire) => (await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [wire] })).code;
  const topUp = () => SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: treasuryVault, lamports: 10_000_000 });
  const v1 = (instructions, limits = { ...LIMITS, priorityFeeLamports: 0n }) => signedV1By(buildV1Wire({ owner: wallet, instructions: instructions.map(kitInstruction), blockhash: read.view.lifetime, lastValidBlockHeight: 1_150, limits }));
  /* Unsigned; a legacy transaction in its place; the same amount to another address; a Compute Budget instruction riding along. */
  assert.equal(await code(build.unsignedWireBase64[0]), "TREASURY_SIGNED_OTHER_BYTES");
  const legacy = new Transaction({ feePayer: person.publicKey, blockhash: read.view.lifetime, lastValidBlockHeight: 1_150 }).add(topUp());
  legacy.sign(person);
  assert.equal(await code(legacy.serialize().toString("base64")), "TREASURY_SIGNED_OTHER_BYTES");
  assert.equal(await code(v1([SystemProgram.transfer({ fromPubkey: person.publicKey, toPubkey: new PublicKey(second), lamports: 10_000_000 })])), "TREASURY_SIGNED_OTHER_BYTES");
  assert.equal(await code(v1([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), topUp()])), "TREASURY_SIGNED_OTHER_BYTES");
  assert.equal(await code(v1([topUp()], { ...LIMITS, priorityFeeLamports: 10_000_000n })), "TREASURY_SIGNED_OTHER_BYTES", "a priority over the relay's cap");
  assert.equal(d.sent.length, 0, "none of them reached the node");
  /* The wallet's own priority under the cap, and Phantom's guard on the wallet's own account, are its right: this one goes out. */
  assert.equal(await code(v1([topUp(), guard(person.publicKey)], { ...LIMITS, priorityFeeLamports: 1_000n })), "TREASURY_SUBMIT_FAILED");
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0][0], V1_PREFIX);
});

test("a build waits for its signature only while its bytes live", async () => {
  const d = deps();
  const { build } = await buildTreasury(d, createRequest);
  d.advance(10 * 60 * 1000);
  const late = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: build.unsignedWireBase64 });
  assert.equal(late.code, "TREASURY_BUILD_EXPIRED");
});

const signedBy = (wire) => {
  const tx = Transaction.from(Buffer.from(wire, "base64"));
  const signers = tx.compileMessage().accountKeys.slice(0, tx.compileMessage().header.numRequiredSignatures);
  tx.partialSign(person, ...(signers.some((key) => key.equals(seed.publicKey)) ? [seed] : []));
  return tx.serialize().toString("base64");
};

test("a top-up is a member's: SOL straight to the vault; USDC with the vault's account opened, its rent said; a stranger is refused", async () => {
  const multisigAddress = treasuryPda.toBase58();
  const sol = await buildTreasury(deps(), { kind: "deposit", wallet, multisig: multisigAddress, asset: "SOL", amountRaw: "10000000" });
  assert.equal(sol.ok, true, JSON.stringify(sol));
  assert.equal(sol.build.review.kind, "deposit");
  assert.equal(sol.build.review.vault, treasuryVault.toBase58());
  assert.deepEqual(sol.build.review.outflow, [{ asset: "SOL", raw: "10000000", recipients: 1 }]);
  assert.equal(sol.build.review.rentLamports, "0");
  assert.deepEqual(sol.build.review.walletShortfall, []);
  assert.equal(sol.build.review.blockedBy, null);
  assert.equal(sol.build.networkCostLamports, "5000", "one signature, the wallet's — counted, not left at zero");
  const tx = Transaction.from(Buffer.from(sol.build.unsignedWireBase64[0], "base64"));
  assert.equal(tx.feePayer.toBase58(), wallet);
  /* After the loaded-data limit: the transfer. */
  assert.ok(tx.instructions[1].keys[1].pubkey.equals(treasuryVault), "into the treasury's own vault");

  const usdc = await buildTreasury(deps({ usdcRaw: "5000000" }), { kind: "deposit", wallet, multisig: multisigAddress, asset: "USDC", amountRaw: "2000000" });
  assert.equal(usdc.ok, true, JSON.stringify(usdc));
  assert.equal(usdc.build.review.newTokenAccounts, 1, "the vault has no USDC account yet");
  assert.equal(usdc.build.review.rentLamports, String((128 + 165) * 5_080), "a token account at the network's rate");

  const stranger = await buildTreasury(deps(), { kind: "deposit", wallet: second, multisig: multisigAddress, asset: "SOL", amountRaw: "1" });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, "TREASURY_NOT_MEMBER");
});

test("the Review says what the wallet lacks — SOL for the network and rent with the wallet left rent-exempt, USDC for a top-up — and the signature waits", async () => {
  /* 0.001 SOL: enough for the fee, not for the rent of a new multisig and the rent-exempt rest. */
  const poor = await buildTreasury(deps({ lamports: 1_000_000 }), createRequest);
  assert.equal(poor.ok, true, JSON.stringify(poor));
  const [short] = poor.build.review.walletShortfall;
  assert.equal(short.asset, "SOL");
  const need = BigInt(poor.build.networkCostLamports) + BigInt(poor.build.review.rentLamports) + 650_240n;
  assert.equal(BigInt(short.raw), need - 1_000_000n);
  assert.equal(poor.build.review.blockedBy, "wallet");

  const usdc = await buildTreasury(deps({ usdcRaw: "1500000" }), { kind: "deposit", wallet, multisig: treasuryPda.toBase58(), asset: "USDC", amountRaw: "2000000" });
  assert.deepEqual(usdc.build.review.walletShortfall, [{ asset: "USDC", raw: "500000" }]);
  assert.equal(usdc.build.review.blockedBy, "wallet");

  /* A SOL top-up counts its own amount: the wallet keeps its rent-exempt rest after it. */
  const all = await buildTreasury(deps({ lamports: 1_000_000_000 }), { kind: "deposit", wallet, multisig: treasuryPda.toBase58(), asset: "SOL", amountRaw: "1000000000" });
  assert.equal(all.build.review.blockedBy, "wallet");
  assert.equal(all.build.review.walletShortfall[0].raw, String(5_000 + 650_240));
});

test("a refusal of the network comes back as what it means, with the network's own text kept for the disclosure", async () => {
  const d = deps({ send: "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit." });
  const { build } = await buildTreasury(d, createRequest);
  const refused = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [signedBy(build.unsignedWireBase64[0])] });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "TREASURY_WALLET_NO_SOL");
  assert.match(refused.message, /no record of a prior credit/, "the raw text travels for the disclosure");

  /* A Squads refusal that names itself only by number is named by Squads' own list. */
  /* Instruction 1: the legacy bytes' loaded-data limit is instruction 0. */
  const e = deps({ send: 'failed: {"InstructionError":[1,{"Custom":6021}]}' });
  const second$ = await buildTreasury(e, createRequest);
  const delay = await submitTreasury(e, { buildId: second$.build.buildId, wallet, signedWireBase64: [signedBy(second$.build.unsignedWireBase64[0])] });
  assert.equal(delay.code, "TREASURY_DELAY");
});

test("a new address gets at least the network's minimum: a SOL payout line, and an empty vault's first SOL", async () => {
  const multisigAddress = treasuryPda.toBase58();
  const fresh = Keypair.generate().publicKey.toBase58();
  /* 0.0005 SOL to an address with no account could never run: refused before it is proposed, with the line named. */
  const small = await buildTreasury(deps(), { kind: "payouts", wallet, multisig: multisigAddress, asset: "SOL", payouts: [{ to: second, amountRaw: "2000000" }, { to: fresh, amountRaw: "500000" }] });
  assert.equal(small.ok, false);
  assert.equal(small.code, "VALIDATION_ERROR");
  /* Only the small line to the new address: 0.002 SOL clears the minimum. */
  assert.deepEqual(small.issues.map((issue) => [issue.code, issue.line, issue.at]), [["PAYOUT_BELOW_RENT", 2, fresh]]);
  const enough = await buildTreasury(deps(), { kind: "payouts", wallet, multisig: multisigAddress, asset: "SOL", payouts: [{ to: fresh, amountRaw: "650240" }] });
  assert.equal(enough.ok, true, JSON.stringify(enough));
  /* The vault itself, never paid: its first SOL must be the minimum too. */
  const empty = new Map([[treasuryVault.toBase58(), 0]]);
  const first = await buildTreasury(deps({ balances: empty }), { kind: "deposit", wallet, multisig: multisigAddress, asset: "SOL", amountRaw: "500000" });
  assert.equal(first.code, "TREASURY_BELOW_RENT");
  const ok = await buildTreasury(deps({ balances: empty }), { kind: "deposit", wallet, multisig: multisigAddress, asset: "SOL", amountRaw: "650240" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test("a top-up's Review says who can move the money once it is in: the treasury's rules", async () => {
  const built = await buildTreasury(deps(), { kind: "deposit", wallet, multisig: treasuryPda.toBase58(), asset: "SOL", amountRaw: "10000000" });
  assert.deepEqual(built.build.review.rules, { threshold: 1, voters: 1, members: 1, timeLockSeconds: 0 });
  assert.equal(built.build.review.configAuthority, null);
});

test("a refusal is read against the signed transaction: whose instruction failed, and whether Squads itself refused", async () => {
  /* A SOL top-up refused at its transfer: the wallet's money, whatever the logs say. */
  const d = deps({ send: "Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1", logs: ["Program 11111111111111111111111111111111 invoke [1]", "Transfer: insufficient lamports 1, need 10000000", "Program 11111111111111111111111111111111 failed: custom program error: 0x1"] });
  const { build } = await buildTreasury(d, { kind: "deposit", wallet, multisig: treasuryPda.toBase58(), asset: "SOL", amountRaw: "10000000" });
  const short = await submitTreasury(d, { buildId: build.buildId, wallet, signedWireBase64: [signedBy(build.unsignedWireBase64[0])] });
  assert.equal(short.code, "TREASURY_WALLET_SHORT");
  /* A wallet guard's own number in the 6000s is not Squads' «already approved». */
  const guard = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
  const e = deps({ send: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x177a", logs: [`Program ${guard} invoke [1]`, `Program ${guard} failed: custom program error: 0x177a`] });
  const other = await buildTreasury(e, createRequest);
  const refused = await submitTreasury(e, { buildId: other.build.buildId, wallet, signedWireBase64: [signedBy(other.build.unsignedWireBase64[0])] });
  assert.equal(refused.code, "TREASURY_SUBMIT_FAILED");
});

test("a transaction made in another app is not executed from this page: what it does is not shown here", async () => {
  /* A treasury with one proposal, made in Squads' own app: a vault transaction, approved. */
  const createKey$ = Keypair.generate().publicKey;
  const [address] = multisig.getMultisigPda({ createKey: createKey$ });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  const [data] = multisig.accounts.Multisig.fromArgs({ createKey: createKey$, configAuthority: PublicKey.default, threshold: 1, timeLock: 0, transactionIndex: 1, staleTransactionIndex: 0, rentCollector: vault, bump: 255, members: [{ key: person.publicKey, permissions: { mask: 7 } }] }).serialize();
  const [transaction] = multisig.getTransactionPda({ multisigPda: address, index: 1n });
  const [proposalPda] = multisig.getProposalPda({ multisigPda: address, transactionIndex: 1n });
  const [vaultTransaction] = multisig.accounts.VaultTransaction.fromArgs({
    multisig: address,
    creator: person.publicKey,
    index: 1,
    bump: 255,
    vaultIndex: 0,
    vaultBump: 255,
    ephemeralSignerBumps: Uint8Array.from([]),
    message: { numSigners: 1, numWritableSigners: 1, numWritableNonSigners: 0, accountKeys: [vault], instructions: [], addressTableLookups: [] },
  }).serialize();
  const [proposal] = multisig.accounts.Proposal.fromArgs({ multisig: address, transactionIndex: 1, status: { __kind: "Approved", timestamp: 1 }, bump: 255, approved: [person.publicKey], rejected: [], cancelled: [] }).serialize();
  const accounts = new Map([
    [address.toBase58(), data],
    [transaction.toBase58(), vaultTransaction],
    [proposalPda.toBase58(), proposal],
  ]);
  const refused = await buildTreasury(deps({ accounts }), { kind: "execute", wallet, multisig: address.toBase58(), index: "1" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "TREASURY_EXECUTE_ELSEWHERE");
});

/** A treasury of the person's with one proposal at №1: `transactionData` its transaction account, `status` its proposal's. */
function treasuryWithProposal(transactionData, status = { __kind: "Active", timestamp: 1 }, extra = new Map()) {
  const createKey$ = Keypair.generate().publicKey;
  const [address] = multisig.getMultisigPda({ createKey: createKey$ });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  const [data] = multisig.accounts.Multisig.fromArgs({ createKey: createKey$, configAuthority: PublicKey.default, threshold: 2, timeLock: 0, transactionIndex: 1, staleTransactionIndex: 0, rentCollector: vault, bump: 255, members: [{ key: person.publicKey, permissions: { mask: 7 } }, { key: new PublicKey(second), permissions: { mask: 2 } }] }).serialize();
  const [transaction] = multisig.getTransactionPda({ multisigPda: address, index: 1n });
  const [proposalPda] = multisig.getProposalPda({ multisigPda: address, transactionIndex: 1n });
  const [proposal] = multisig.accounts.Proposal.fromArgs({ multisig: address, transactionIndex: 1, status, bump: 255, approved: [], rejected: [], cancelled: [] }).serialize();
  const accounts = new Map([[address.toBase58(), data], [transaction.toBase58(), transactionData(address, vault)], [proposalPda.toBase58(), proposal], ...extra]);
  return { address, vault, accounts, createKey: createKey$ };
}

/** A batch line as Squads stores it. */
function storedLine(vault, instructions) {
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
  const [decoded] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })));
  const stored = { ...decoded, instructions: decoded.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountIndexes: Uint8Array.from(ix.accountIndexes), data: Uint8Array.from(ix.data) })), addressTableLookups: [] };
  return multisig.accounts.VaultBatchTransaction.fromArgs({ bump: 255, ephemeralSignerBumps: Uint8Array.from([]), message: stored }).serialize()[0];
}

test("a «for» says what it authorises — a batch's sums and recipients — and is refused on what this page cannot show", async () => {
  const recipient = Keypair.generate().publicKey;
  const batchOf = (address) => multisig.accounts.Batch.fromArgs({ multisig: address, creator: person.publicKey, index: 1, bump: 255, vaultIndex: 0, vaultBump: 255, size: 1, executedTransactionIndex: 0 }).serialize()[0];
  const make = (lineFor) => {
    const holder = { line: null };
    const built = treasuryWithProposal((address, vault) => {
      holder.line = [multisig.getBatchTransactionPda({ multisigPda: address, batchIndex: 1n, transactionIndex: 1 })[0].toBase58(), storedLine(vault, lineFor(vault))];
      return batchOf(address);
    });
    built.accounts.set(...holder.line);
    return built;
  };
  const paying = make((vault) => [SystemProgram.transfer({ fromPubkey: vault, toPubkey: recipient, lamports: 10_000_000 })]);
  const vote = await buildTreasury(deps({ accounts: paying.accounts }), { kind: "vote", wallet, multisig: paying.address.toBase58(), index: "1", vote: "approve" });
  assert.equal(vote.ok, true, JSON.stringify(vote));
  assert.deepEqual(vote.build.review.outflow, [{ asset: "SOL", raw: "10000000", recipients: 1 }]);
  assert.deepEqual(vote.build.review.to, [recipient.toBase58()]);
  /* A line that hands the vault's money some other way: no «for» from this page; «against» stays. */
  const stranger = Keypair.generate().publicKey;
  const foreign = make(() => [SystemProgram.transfer({ fromPubkey: stranger, toPubkey: recipient, lamports: 1 })]);
  const refused = await buildTreasury(deps({ accounts: foreign.accounts }), { kind: "vote", wallet, multisig: foreign.address.toBase58(), index: "1", vote: "approve" });
  assert.equal(refused.code, "TREASURY_EXECUTE_ELSEWHERE");
  const against = await buildTreasury(deps({ accounts: foreign.accounts }), { kind: "vote", wallet, multisig: foreign.address.toBase58(), index: "1", vote: "reject" });
  assert.equal(against.ok, true, JSON.stringify(against));
});

test("a top-up's Review says when this wallet has no say over the money: not a voter, or the others' votes are enough", async () => {
  /* The person a member who only proposes; the others hold the votes. */
  const createKey$ = Keypair.generate().publicKey;
  const [address] = multisig.getMultisigPda({ createKey: createKey$ });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  const [data] = multisig.accounts.Multisig.fromArgs({ createKey: createKey$, configAuthority: PublicKey.default, threshold: 1, timeLock: 0, transactionIndex: 0, staleTransactionIndex: 0, rentCollector: vault, bump: 255, members: [{ key: person.publicKey, permissions: { mask: 1 } }, { key: new PublicKey(second), permissions: { mask: 7 } }] }).serialize();
  const built = await buildTreasury(deps({ accounts: new Map([[address.toBase58(), data]]) }), { kind: "deposit", wallet, multisig: address.toBase58(), asset: "SOL", amountRaw: "10000000" });
  assert.deepEqual(built.build.review.control, { youVote: false, othersAlone: true });
});

test("a spend's Review names its recipient in full", async () => {
  /* Read from the route's own contract: the recipient travels in the Review, not only in the request. */
  const source = (await import("node:fs")).readFileSync(new URL("./service.server.ts", import.meta.url), "utf8");
  assert.match(source, /review: \{ kind: "spend", \.\.\.base\(read, null\), to: \[request\.to\]/);
});

test("«against» carries none of the batch's money: only a «for» authorises it", async () => {
  const recipient = Keypair.generate().publicKey;
  const holder = {};
  const built = treasuryWithProposal((address, vault) => {
    holder.line = [multisig.getBatchTransactionPda({ multisigPda: address, batchIndex: 1n, transactionIndex: 1 })[0].toBase58(), storedLine(vault, [SystemProgram.transfer({ fromPubkey: vault, toPubkey: recipient, lamports: 10_000_000 })])];
    return multisig.accounts.Batch.fromArgs({ multisig: address, creator: person.publicKey, index: 1, bump: 255, vaultIndex: 0, vaultBump: 255, size: 1, executedTransactionIndex: 0 }).serialize()[0];
  });
  built.accounts.set(...holder.line);
  const against = await buildTreasury(deps({ accounts: built.accounts }), { kind: "vote", wallet, multisig: built.address.toBase58(), index: "1", vote: "reject" });
  assert.deepEqual(against.build.review.outflow, []);
  assert.deepEqual(against.build.review.to, []);
});

test("money is never paid where it could not be spent: the treasury's own multisig, an account Squads owns", async () => {
  const multisigAddress = treasuryPda.toBase58();
  const own = await buildTreasury(deps(), { kind: "payouts", wallet, multisig: multisigAddress, asset: "SOL", payouts: [{ to: multisigAddress, amountRaw: "1000000" }] });
  assert.equal(own.code, "VALIDATION_ERROR");
  assert.deepEqual(own.issues.map((issue) => [issue.code, issue.at]), [["PAYOUT_NOT_WALLET", multisigAddress]]);
  /* Any account the Squads program owns — a proposal's, a batch's — is not a wallet. */
  const squadsAccount = Keypair.generate().publicKey.toBase58();
  const owned = await buildTreasury(deps({ accounts: new Map([[squadsAccount, Buffer.alloc(8)]]) }), { kind: "payouts", wallet, multisig: multisigAddress, asset: "USDC", payouts: [{ to: squadsAccount, amountRaw: "1000000" }] });
  assert.equal(owned.issues?.[0]?.code, "PAYOUT_NOT_WALLET");
});

test("a recipient is a wallet: a System account or none yet — never a program, a mint or another program's data", async () => {
  const multisigAddress = treasuryPda.toBase58();
  const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const wallet$ = Keypair.generate().publicKey.toBase58();
  const mintLike = Keypair.generate().publicKey.toBase58();
  const program = Keypair.generate().publicKey.toBase58();
  const accounts = new Map([
    [wallet$, { data: Buffer.alloc(0), owner: SystemProgram.programId }],
    [mintLike, { data: Buffer.alloc(82), owner: tokenProgram }],
    [program, { data: Buffer.alloc(36), owner: new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), executable: true }],
  ]);
  const pay = (to, asset = "USDC") => buildTreasury(deps({ accounts }), { kind: "payouts", wallet, multisig: multisigAddress, asset, payouts: [{ to, amountRaw: "1000000" }] });
  assert.equal((await pay(wallet$)).ok, true);
  assert.equal((await pay(mintLike)).issues?.[0]?.code, "PAYOUT_NOT_WALLET", "a token account or a mint takes no USDC account of its own");
  assert.equal((await pay(program)).issues?.[0]?.code, "PAYOUT_NOT_WALLET");
  /* SOL into a token account: its owner takes the lamports back on closing it — allowed. */
  assert.equal((await pay(mintLike, "SOL")).ok, true);
});

test("a node that refuses the program scan still shows the limits and serves a spend: the rules' history names them", async () => {
  const agent = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const limitKey = Keypair.generate().publicKey;
  const built = treasuryWithProposal((address) => {
    const [config] = multisig.accounts.ConfigTransaction.fromArgs({
      multisig: address,
      creator: person.publicKey,
      index: 1,
      bump: 255,
      actions: [{ __kind: "AddSpendingLimit", createKey: limitKey, vaultIndex: 0, mint: PublicKey.default, amount: 50_000_000, period: multisig.generated.Period.Day, members: [agent.publicKey], destinations: [to] }],
    }).serialize();
    return config;
  }, { __kind: "Executed", timestamp: 1 });
  const [limitPda] = multisig.getSpendingLimitPda({ multisigPda: built.address, createKey: limitKey });
  const [limit] = multisig.accounts.SpendingLimit.fromArgs({ multisig: built.address, createKey: limitKey, vaultIndex: 0, mint: PublicKey.default, amount: 50_000_000, period: multisig.generated.Period.Day, remainingAmount: 50_000_000, lastReset: 0, bump: 255, members: [agent.publicKey], destinations: [to] }).serialize();
  built.accounts.set(limitPda.toBase58(), limit);
  /* Its creation on chain, with no config authority: what lets the rules' history vouch for every limit. */
  const creationOf = (configAuthority) => {
    const created = buildCreate({ wallet, createKey: built.createKey, members: [{ address: wallet, initiate: true, vote: true, execute: true }], threshold: 1, timeLockSeconds: 0, programTreasury });
    const tx = new Transaction({ feePayer: person.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(...created.groups[0].instructions);
    if (configAuthority) {
      /* The same creation, its config authority set: byte 8 starts the args, an Option<Pubkey> first. */
      const ix = tx.instructions.find((instruction) => instruction.programId.equals(multisig.PROGRAM_ID));
      ix.data = Buffer.concat([ix.data.subarray(0, 8), Buffer.from([1]), configAuthority.toBuffer(), ix.data.subarray(9)]);
    }
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  };
  const creations = new Map([[built.address.toBase58(), creationOf(null)]]);
  /* The stub has no `getProgramAccounts`: the scan fails, as mainnet's nodes refuse it. */
  const d = deps({ accounts: built.accounts, creations });
  const state = await readTreasury(d.connection, built.address.toBase58(), "devnet", new Date());
  assert.equal(state.limitsUnread, false);
  assert.equal(state.limitsPartial, false, "every limit is named by a change of the rules still open, and no authority ever was");
  assert.deepEqual(state.limits.map((row) => [row.address, row.asset, row.amountRaw, row.spenders]), [[limitPda.toBase58(), "SOL", "50000000", [agent.publicKey.toBase58()]]]);

  const spend = await buildTreasury(d, { kind: "spend", wallet: agent.publicKey.toBase58(), multisig: built.address.toBase58(), limit: limitPda.toBase58(), amountRaw: "10000000", to: to.toBase58() });
  assert.equal(spend.ok, true, JSON.stringify(spend));
  assert.deepEqual(spend.build.review.to, [to.toBase58()]);

  /* A limit account of another multisig is not this one's, whatever address is asked. */
  const [stranger] = multisig.accounts.SpendingLimit.fromArgs({ multisig: Keypair.generate().publicKey, createKey: limitKey, vaultIndex: 0, mint: PublicKey.default, amount: 1, period: multisig.generated.Period.Day, remainingAmount: 1, lastReset: 0, bump: 255, members: [agent.publicKey], destinations: [to] }).serialize();
  const strangerKey = Keypair.generate().publicKey;
  built.accounts.set(strangerKey.toBase58(), stranger);
  const refused = await buildTreasury(deps({ accounts: built.accounts }), { kind: "spend", wallet: agent.publicKey.toBase58(), multisig: built.address.toBase58(), limit: strangerKey.toBase58(), amountRaw: "1", to: to.toBase58() });
  assert.equal(refused.code, "TREASURY_LIMIT_NOT_FOUND");

  /* A closed change of the rules may have added a limit: the page says so instead of «none». */
  const closed = new Map(built.accounts);
  closed.delete(multisig.getTransactionPda({ multisigPda: built.address, index: 1n })[0].toBase58());
  const unsure = await readTreasury(deps({ accounts: closed, creations }).connection, built.address.toBase58(), "devnet", new Date());
  assert.equal(unsure.limitsPartial, true);
  assert.deepEqual(unsure.limits, [], "the limit is not named any more — and the page says there may be others");

  /* Something else at that address — lamports anyone sent there — hides a closed change just the same. */
  const squatted = new Map(built.accounts);
  squatted.set(multisig.getTransactionPda({ multisigPda: built.address, index: 1n })[0].toBase58(), { data: Buffer.alloc(0), owner: SystemProgram.programId });
  assert.equal((await readTreasury(deps({ accounts: squatted, creations }).connection, built.address.toBase58(), "devnet", new Date())).limitsPartial, true);

});

test("the rules' history vouches for the limits only for a multisig created with no config authority, as its creation shows", async () => {
  const fresh = () => treasuryWithProposal((address) => multisig.accounts.ConfigTransaction.fromArgs({ multisig: address, creator: person.publicKey, index: 1, bump: 255, actions: [{ __kind: "SetTimeLock", newTimeLock: 60 }] }).serialize()[0], { __kind: "Executed", timestamp: 1 });
  const creationOf = (built, configAuthority) => {
    const created = buildCreate({ wallet, createKey: built.createKey, members: [{ address: wallet, initiate: true, vote: true, execute: true }], threshold: 1, timeLockSeconds: 0, programTreasury });
    const tx = new Transaction({ feePayer: person.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(...created.groups[0].instructions);
    if (configAuthority) {
      const ix = tx.instructions.find((instruction) => instruction.programId.equals(multisig.PROGRAM_ID));
      ix.data = Buffer.concat([ix.data.subarray(0, 8), Buffer.from([1]), configAuthority.toBuffer(), ix.data.subarray(9)]);
    }
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  };
  const read = async (built, creations) => readTreasury(deps({ accounts: built.accounts, creations }).connection, built.address.toBase58(), "devnet", new Date());

  const clean = fresh();
  assert.equal((await read(clean, new Map([[clean.address.toBase58(), creationOf(clean, null)]]))).limitsPartial, false);
  /* Created with a config authority, now given up: it may have added a limit without a vote. */
  const ruled = fresh();
  assert.equal((await read(ruled, new Map([[ruled.address.toBase58(), creationOf(ruled, Keypair.generate().publicKey)]]))).limitsPartial, true);
  /* No creation read at all is not «complete» either. */
  const unread = fresh();
  assert.equal((await read(unread, new Map())).limitsPartial, true);

  /* A decoy: another multisig's creation, with no authority, carrying this address as an extra account — not this one's. */
  const target = fresh();
  const decoyKey = Keypair.generate().publicKey;
  const [decoy] = multisig.getMultisigPda({ createKey: decoyKey });
  const decoyIx = multisig.instructions.multisigCreateV2({ treasury: programTreasury, createKey: decoyKey, creator: person.publicKey, multisigPda: decoy, configAuthority: null, threshold: 1, members: [{ key: person.publicKey, permissions: multisig.types.Permissions.all() }], timeLock: 0, rentCollector: null });
  decoyIx.keys.push({ pubkey: target.address, isSigner: false, isWritable: false });
  const decoyWire = new Transaction({ feePayer: person.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }).add(decoyIx).serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.equal((await read(target, new Map([[target.address.toBase58(), decoyWire]]))).limitsPartial, true, "the address must be the creation's own multisig account");

  /* The Squads app creates in v0: read the same way. */
  const fromApp = fresh();
  const created = buildCreate({ wallet, createKey: fromApp.createKey, members: [{ address: wallet, initiate: true, vote: true, execute: true }], threshold: 1, timeLockSeconds: 0, programTreasury });
  const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: person.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [...created.groups[0].instructions] }).compileToV0Message());
  assert.equal((await read(fromApp, new Map([[fromApp.address.toBase58(), Buffer.from(v0.serialize()).toString("base64")]]))).limitsPartial, false);
});

test("a USDC balance is read from the token account's own bytes: a node that refuses getTokenAccountBalance still shows it", async () => {
  const d = deps({ usdcRaw: "1234567" });
  assert.equal(await tokenHeld(d.connection, person.publicKey, USDC_DEVNET), 1_234_567n);
  assert.equal(await tokenHeld(d.connection, Keypair.generate().publicKey, USDC_DEVNET), 0n, "no account is no USDC");
});
