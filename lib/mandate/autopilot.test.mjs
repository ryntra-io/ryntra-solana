/* CITY-175 — the agent at work on its own: the strategy, the book and one pass of the agent, on fixtures. Nothing here
   reaches a network or a real key: the chain is a stand-in, the agent's key a key made for the test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SendTransactionError, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import BN from "bn.js";

import { createMemoryGuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { chainRefusal, mandateOf, presetOf, readBook, readEntry, registerMandate, writeEntry } from "./book.server.ts";
import { tokenAccountOf } from "./human.ts";
import { BUDGET_PRESETS } from "./presets.ts";
import { LIGHTHOUSE_PROGRAM_ID } from "./result.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, ssaAddress } from "./ssa.ts";
import { AUTOSTOP, FAILURES_TO_PAUSE, autostop, decide, resultOf, steadyRhythm, trackRecord } from "./strategy.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2 } from "./terms.ts";
import { PASS_STARTS_WITHIN_MS, markUnread, runAgentPass, settled, tradeOf } from "./tick.server.ts";
import { TRADE_READ_TRIES, fateOf } from "./run.server.ts";
import { startKmsStub, STUB_TOKEN, versionName } from "../launch/signer/kms-stub.fixture.mjs";
import { forgetKmsAddresses } from "../launch/signer/gcp-kms.server.ts";
import { dlmmVenue, viewOf, agentKeyFor } from "./agent-service.server.ts";
import { mandateStatus } from "./service.server.ts";
import { agentFeeAccount, agentFeeRaw, agentFeeWallet, feeTransferInstruction, uncataloguedFacts } from "./fee.ts";

const HOUR = 3_600_000;
const bs58 = (bytes) => getBase58Decoder().decode(bytes);
const NOW = Date.now();
const SECONDS = (ms) => BigInt(Math.floor(ms / 1000));

const human = Keypair.generate().publicKey;
const agentPair = Keypair.generate();
const agent = agentPair.publicKey;
const attacker = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const settings = ssaAddress.settings(7n);
const vault = ssaAddress.vault(settings, 0);
const policy = ssaAddress.policy(settings, 1n);
const budget = tokenAccountOf(vault, NATIVE_MINT);
const receiver = tokenAccountOf(human, coin);
const gate = { open: true, network: "devnet", pool, agent };
const medium = BUDGET_PRESETS.medium;

const RECORD = {
  owner: human.toBase58(),
  settings: settings.toBase58(),
  vault: vault.toBase58(),
  policy: policy.toBase58(),
  budget: budget.toBase58(),
  perTrade: medium.perTrade.toString(),
  perDay: medium.perDay.toString(),
  expiresAt: String(SECONDS(NOW + 29 * 24 * HOUR)),
};

/* ------------------------------------------------------------------ accounts as the program writes them */

const u16 = (n) => [n & 255, n >> 8];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const settingsData = (signers) =>
  Uint8Array.from([223, 179, 163, 190, 177, 224, 67, 173, ...new Array(16).fill(0), ...new Array(32).fill(0), ...u16(1), ...u32(0), ...u64(0), ...u64(0), 0, ...u64(0), 255, ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), 0, 1, ...u64(1)]);
/* The policy's head as the program writes it; its constraints name Ryntra's fee account (CITY-183) unless `fee` is false. */
const policyData = (onSettings, signers, fee = true) =>
  Uint8Array.from([222, 135, 7, 163, 235, 177, 33, 68, ...onSettings.toBytes(), ...u64(1), 255, ...u64(0), ...u64(0), ...u32(signers.length), ...signers.flatMap((key) => [...key.toBytes(), 7]), ...u16(1), ...new Array(64).fill(0), ...(fee ? agentFeeAccount(NATIVE_MINT).toBytes() : [])]);
const tokenData = (mint, owner) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Array(101).fill(0)]);
/** A plain mint of Token: 82 bytes, six decimals, initialized — what the venue reads before it trades a coin (CITY-184). */
const mintData = () => Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : 0));

/** The devnet chain as a stand-in: the accounts it holds, what was sent, and what each transaction did. */
function chain(options = {}) {
  const accounts = new Map([
    [policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(settings, [options.signer ?? agent], options.fee ?? true), lamports: 1, executable: false }],
    [settings.toBase58(), { owner: SSA_PROGRAM_ID, data: settingsData([human]), lamports: 1, executable: false }],
    [receiver.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, human), lamports: 1, executable: false }],
    [coin.toBase58(), { owner: TOKEN_PROGRAM_ID, data: mintData(), lamports: 1, executable: false }],
    [tokenAccountOf(attacker, coin).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coin, attacker), lamports: 1, executable: false }],
    [agentFeeAccount(NATIVE_MINT).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, agentFeeWallet()), lamports: 1, executable: false }],
  ]);
  const sent = [];
  return {
    accounts,
    sent,
    budgetLeft: options.budgetLeft ?? medium.budget,
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async function () {
      return { value: { amount: String(this.budgetLeft) } };
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => {
      sent.push(VersionedTransaction.deserialize(bytes));
      return "sent";
    },
    getBlockHeight: async () => options.height ?? 1_000_000,
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 90_000, fee: 5_000 } }),
  };
}

/** The pool's swap2 for the vault, as the SDK builds it — `amount` in, its output to `to`. */
function swap2(amount, to = receiver) {
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[0] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[4] = { pubkey: budget, isSigner: false, isWritable: true };
  keys[5] = { pubkey: to, isSigner: false, isWritable: true };
  keys[10] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(1n, 16);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
}

/* Devnet's coin is one no catalogue reads: the table's MEME, 1 %. */
const FEE_BPS = 100;
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
const feeOf = (amount) => agentFeeRaw(amount, FEE_BPS);
const feeTransfer = (fee, to = null) => {
  const ix = feeTransferInstruction({ budgetMint: NATIVE_MINT, budgetAccount: budget, vault, fee, decimals: 9 });
  if (to) ix.keys[2] = { ...ix.keys[2], pubkey: to };
  return ix;
};

/* The venue as the devnet one builds a buy: Ryntra's share first, the swap with the rest. */
const venue = (build = (amount) => swap2(amount), extra = {}, fee = (amount) => feeTransfer(feeOf(amount))) => ({
  buy: async (_mandate, amount) => ({ instruction: build(amount - feeOf(amount)), fee: fee(amount), feeSides: { input: null, output: uncataloguedFacts(coin.toBase58()), nowMs: NOW }, setup: [], promisedOut: 1n }),
  received: async () => 47_000n,
  worth: async () => medium.perTrade,
  ...extra,
});

async function stand(options = {}) {
  const store = createMemoryGuardStore();
  const connection = chain(options);
  const joined = await registerMandate({ record: RECORD, strategy: "steady", said: "торгуй на 1 SOL на день" }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW });
  const key = envKey(JSON.stringify([...agentPair.secretKey]));
  const rows = [];
  return { store, connection, joined, key: key.signer, rows, journal: async (row) => void rows.push(row) };
}

/* ------------------------------------------------------------------ the strategy */

test("the steady strategy spreads the day's budget into equal buys, the first at once", () => {
  const base = { strategy: "steady", perTrade: medium.perTrade, perDay: medium.perDay, expiresAt: SECONDS(NOW + 10 * 24 * HOUR), budgetLeft: medium.budget, now: NOW };
  const { buys, everyMs } = steadyRhythm(medium.perTrade, medium.perDay);
  assert.equal(buys, 5);
  assert.equal(everyMs, (24 * HOUR) / 5);
  assert.deepEqual(decide({ ...base, trades: [] }), { action: "buy", amount: medium.perTrade });
  const ok = (at) => ({ at, status: "ok", signature: "s", spentRaw: medium.perTrade.toString(), receivedRaw: "1", reason: null });
  assert.equal(decide({ ...base, trades: [ok(NOW - HOUR)] }).action, "wait");
  assert.deepEqual(decide({ ...base, trades: [ok(NOW - everyMs)] }), { action: "buy", amount: medium.perTrade });
  const fullDay = [0, 1, 2, 3, 4].map((n) => ok(NOW - 23 * HOUR + n * HOUR));
  assert.equal(decide({ ...base, trades: fullDay }).reason, "day-spent");
  assert.deepEqual(decide({ ...base, trades: [], expiresAt: SECONDS(NOW) }), { action: "end", reason: "ended" });
  assert.deepEqual(decide({ ...base, trades: [], budgetLeft: medium.perTrade - 1n }), { action: "end", reason: "spent" });
  const failed = (at) => ({ at, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "x" });
  assert.deepEqual(decide({ ...base, trades: Array.from({ length: FAILURES_TO_PAUSE }, (_, n) => failed(NOW - n)) }), { action: "end", reason: "failing" });
  const allowance = { ...failed(NOW - 60_000), allowance: true };
  assert.equal(decide({ ...base, trades: [failed(NOW - 3), failed(NOW - 2), allowance] }).action, "wait");
});

test("what the agent earned is its own trades against the price now — never guessed when a trade was not read", () => {
  const trades = [
    { at: 1, status: "ok", signature: "a", spentRaw: "50000000", receivedRaw: "48000", reason: null },
    { at: 2, status: "failed", signature: "b", spentRaw: "0", receivedRaw: null, reason: "x" },
    { at: 3, status: "ok", signature: "c", spentRaw: "50000000", receivedRaw: "47000", reason: null },
  ];
  assert.deepEqual(resultOf(trades, 112_000_000n), { trades: 2, spentRaw: "100000000", boughtRaw: "95000", worthRaw: "112000000", earnedRaw: "12000000", multiple: 1.12 });
  assert.equal(resultOf([{ ...trades[0], receivedRaw: null }], 1n).worthRaw, null);
  assert.equal(resultOf([], null).multiple, null);
});

/* ------------------------------------------------------------------ the book */

test("a mandate joins the agent's book only as the chain has it, with a budget the city offers", async () => {
  const { joined, store, connection } = await stand();
  assert.equal(joined.ok, true);
  assert.equal(joined.entry.status, "working");
  assert.equal(joined.entry.receiveMint, coin.toBase58());
  assert.equal((await readBook(store)).length, 1);
  assert.equal(presetOf({ perTrade: "1", perDay: "2" }), null);
  const reg = (record, conn = connection) => registerMandate({ record, strategy: "steady", said: null }, gate, { store: createMemoryGuardStore(), connection: conn, receiveMint: async () => coin, now: () => NOW });
  assert.match((await reg({ ...RECORD, perTrade: "100000000" })).reason, /not a budget/);
  assert.match((await reg({ ...RECORD, expiresAt: String(SECONDS(NOW + 40 * 24 * HOUR)) })).reason, /end/);
  assert.match((await reg(RECORD, chain({ signer: attacker }))).reason, /another agent/);
  assert.match((await reg(RECORD, chain({ fee: false }))).reason, /before Ryntra's fee/);
  assert.match((await chainRefusal({ ...RECORD, owner: attacker.toBase58() }, gate, connection)) ?? "", /person's/);
  assert.match((await chainRefusal({ ...RECORD, vault: attacker.toBase58() }, gate, connection)) ?? "", /vault/);
  const gone = chain();
  gone.accounts.delete(policy.toBase58());
  assert.match((await reg(RECORD, gone)).reason, /no such mandate/);
  // Joining twice keeps the first.
  const again = await registerMandate({ record: RECORD, strategy: "steady", said: "other" }, gate, { store, connection, receiveMint: async () => coin, now: () => NOW + 1 });
  assert.equal(again.ok && again.entry.said, "торгуй на 1 SOL на день");
});

test("CITY-196: a coin of Ryntra's launchpad, or the person's own launch, never joins the book — and an unread registry joins nothing", async () => {
  const reg = async (launch, screen) => {
    const store = createMemoryGuardStore();
    if (launch) await store.collection("launches").set(`solana:devnet:${coin.toBase58()}`, { state: "LAUNCHED", token: coin.toBase58(), creator: launch });
    return registerMandate({ record: RECORD, strategy: "steady", said: null }, gate, { store, connection: chain(), receiveMint: async () => coin, now: () => NOW, ...(screen ? { screen } : {}) });
  };
  const someone = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(await reg(someone), { ok: false, code: "REFUSED", reason: "The agent does not buy coins launched on Ryntra." });
  assert.deepEqual(await reg(human.toBase58()), { ok: false, code: "REFUSED", reason: "The agent does not buy your own coin." });
  const down = { origin: async () => { throw new Error("down"); }, ryntra: async () => new Set() };
  assert.equal((await reg(null, down)).code, "UNAVAILABLE");
  assert.equal((await reg(null)).ok, true, "a coin Launch never recorded joins");
});

test("CITY-196: the agent's pass asks the registry before its key — a coin launched on Ryntra after it joined is refused, nothing is sent", async () => {
  const { store, connection, key, rows, journal } = await stand();
  await store.collection("launches").set(`solana:devnet:${coin.toBase58()}`, { state: "LAUNCHED", token: coin.toBase58(), creator: attacker.toBase58() });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  assert.equal(connection.sent.length, 0);
  assert.equal(rows.at(-1).outcome, "REFUSED");
  assert.match(rows.at(-1).reason, /launched on Ryntra/);
});

test("CITY-196: the status answers only of a real mandate of this agent — any other policy or vault is not found", async () => {
  const SYSTEM = "11111111111111111111111111111111";
  const connection = chain();
  connection.accounts.set(SYSTEM, { owner: new PublicKey("NativeLoader1111111111111111111111111111111"), data: new Uint8Array(14), lamports: 1, executable: true });
  const store = createMemoryGuardStore();
  const status = (input, conn = connection) => mandateStatus(input, gate, conn, { store });
  assert.deepEqual(await status({ policy: RECORD.policy, vault: RECORD.vault }), { ok: true, status: { active: true, budgetLamports: String(medium.budget) } });
  /* The bug: System Program for both said «active». */
  assert.deepEqual(await status({ policy: SYSTEM, vault: SYSTEM }), { ok: false, code: "not-found" });
  assert.deepEqual(await status({ policy: RECORD.policy, vault: SYSTEM }), { ok: false, code: "not-found" }, "the vault must be the policy's account's");
  assert.deepEqual(await status({ policy: RECORD.settings, vault: RECORD.vault }), { ok: false, code: "not-found" }, "an account of the program that is not a policy");
  assert.deepEqual(await status({ policy: RECORD.policy, vault: RECORD.vault }, chain({ signer: attacker })), { ok: false, code: "not-found" }, "a policy of another agent");
  /* A policy at an address its settings and seed do not derive. */
  const moved = chain();
  const elsewhere = Keypair.generate().publicKey;
  moved.accounts.set(elsewhere.toBase58(), moved.accounts.get(RECORD.policy));
  assert.deepEqual(await status({ policy: elsewhere.toBase58(), vault: RECORD.vault }, moved), { ok: false, code: "not-found" });
  assert.deepEqual(await status({ policy: "not an address", vault: RECORD.vault }), { ok: false, code: "not-addresses" });
  /* Stopped: the policy is gone from the chain; only the agent's book knows it was this agent's, with this vault. */
  const gone = chain();
  gone.accounts.delete(RECORD.policy);
  assert.deepEqual(await status({ policy: RECORD.policy, vault: RECORD.vault }, gone), { ok: false, code: "not-found" });
  await writeEntry(store, { v: 1, cluster: "devnet", record: RECORD, preset: "medium", strategy: "steady", said: null, receiveMint: coin.toBase58(), status: "stopped", trades: [], createdAt: NOW, updatedAt: NOW });
  assert.deepEqual(await status({ policy: RECORD.policy, vault: RECORD.vault }, gone), { ok: true, status: { active: false, budgetLamports: String(medium.budget) } });
  assert.deepEqual(await status({ policy: RECORD.policy, vault: SYSTEM }, gone), { ok: false, code: "not-found" });
});

/* ------------------------------------------------------------------ the agent at work */

test("the agent buys by itself within the limits: one honest buy, signed by its own signer, to the person's wallet", async () => {
  const { store, connection, key, rows, journal } = await stand();
  const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  assert.deepEqual(lines, [{ policy: RECORD.policy, did: "bought" }]);
  assert.equal(connection.sent.length, 1);
  const tx = connection.sent[0];
  assert.ok(tx.message.staticAccountKeys[0].equals(agent), "the agent pays its own fee");
  const execute = tx.message.compiledInstructions.find((ix) => tx.message.staticAccountKeys[ix.programIdIndex].equals(SSA_PROGRAM_ID));
  const view = readPolicyExecute({ programId: SSA_PROGRAM_ID, keys: execute.accountKeyIndexes.map((n) => tx.message.staticAccountKeys[n]), data: execute.data });
  assert.ok(view.policy.equals(policy));
  /* Ryntra's 1 % to Ryntra's fee account, the rest into the swap: the two together are the trade, within its cap. */
  assert.deepEqual(view.constraintIndices, [1, 0]);
  assert.ok(view.instructions[0].accounts[2].equals(FEE_WSOL), "the fee lands in Ryntra's fee account");
  assert.equal(Buffer.from(view.instructions[0].data).readBigUInt64LE(1), feeOf(medium.perTrade));
  assert.equal(Buffer.from(view.instructions[1].data).readBigUInt64LE(8), medium.perTrade - feeOf(medium.perTrade));
  assert.ok(view.instructions[1].accounts[5].equals(receiver), "the coins land in the person's own account");
  assert.deepEqual(rows.map((row) => row.outcome), ["SIGNED"]);
  const rule = tx.message.compiledInstructions.at(-1);
  assert.ok(tx.message.staticAccountKeys[rule.programIdIndex].equals(LIGHTHOUSE_PROGRAM_ID), "the trade ends with the rule on what reached the person");
  assert.ok(tx.message.staticAccountKeys[rule.accountKeyIndexes[0]].equals(receiver));
  const entry = await readEntry(store, RECORD.policy);
  assert.deepEqual(entry.trades.map((t) => [t.status, t.spentRaw, t.receivedRaw]), [["ok", medium.perTrade.toString(), "47000"]]);
  // Minutes later the rhythm says wait: nothing more is signed or sent.
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 5 * 60_000 }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 1);
});

test("a trade outside the limits is never signed: over the trade cap, to someone else's account, or with Ryntra's fee off the table", async () => {
  const attackerWsol = tokenAccountOf(attacker, NATIVE_MINT);
  for (const [label, build, fee] of [
    ["over the cap", (amount) => swap2(amount * 2n)],
    ["to the attacker", (amount) => swap2(amount, tokenAccountOf(attacker, coin))],
    ["the fee to the attacker", undefined, (amount) => feeTransfer(feeOf(amount), attackerWsol)],
    ["the fee under the table's share", undefined, (amount) => feeTransfer(feeOf(amount) / 2n)],
    ["the fee over the table's share", undefined, (amount) => feeTransfer(feeOf(amount) * 2n)],
    /* The fee on top of a full-size swap: each within its own rule, the two together over the trade cap. */
    ["the trade and its fee over the cap", (amount) => swap2(amount + feeOf(amount) - 1n), (amount) => feeTransfer(feeOf(amount))],
    ["no fee", undefined, () => undefined],
  ]) {
    const { store, connection, key, rows, journal } = await stand();
    const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venue(build, {}, fee), now: () => NOW });
    assert.deepEqual(lines, [{ policy: RECORD.policy, did: "refused" }], label);
    assert.equal(connection.sent.length, 0, label);
    assert.deepEqual(rows.map((row) => row.outcome), ["REFUSED"], label);
    assert.equal((await readEntry(store, RECORD.policy)).trades[0].status, "refused", label);
  }
});

test("after the person's one stop signature the agent leaves the mandate alone", async () => {
  const { store, connection, key, journal } = await stand();
  connection.accounts.delete(policy.toBase58());
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "stopped" }]);
  assert.equal((await readEntry(store, RECORD.policy)).status, "stopped");
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 24 * HOUR }), []);
  assert.equal(connection.sent.length, 0);
});

test("a mandate signed before Ryntra's fee rule is one the agent no longer trades for", async () => {
  const { store, connection, key, journal } = await stand();
  connection.accounts.set(policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(settings, [agent], false), lamports: 1, executable: false });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "ended" }]);
  assert.equal(connection.sent.length, 0);
});

test("a mandate signed for another agent's key (the move to KMS, CITY-186) is one the agent leaves; the person's stop needs no agent", async () => {
  const { store, connection, key, journal } = await stand();
  connection.accounts.set(policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(settings, [attacker]), lamports: 1, executable: false });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "ended" }]);
  assert.equal(connection.sent.length, 0);
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + HOUR }), [], "an ended mandate is left alone");
});

test("a policy the pass cannot read is a pass that did not read, never a mandate ended for good", async () => {
  const { store, connection, key, journal } = await stand();
  /* The head names more signers than the account holds: the fee rule is there, the head does not read. */
  const torn = Uint8Array.from([...policyData(settings, [agent]).subarray(0, 65), ...u32(999), ...agentFeeAccount(NATIVE_MINT).toBytes()]);
  connection.accounts.set(policy.toBase58(), { owner: SSA_PROGRAM_ID, data: torn, lamports: 1, executable: false });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "unread" }]);
  const entry = await readEntry(store, RECORD.policy);
  assert.deepEqual([entry.status, entry.unreadSince], ["working", NOW], "its clock runs; the mandate stays the person's");
  assert.equal(connection.sent.length, 0);
  connection.accounts.set(policy.toBase58(), { owner: SSA_PROGRAM_ID, data: policyData(settings, [agent]), lamports: 1, executable: false });
  assert.notEqual((await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + HOUR }))[0].did, "ended", "read again, it works on");
});

test("the devnet venue leaves the SDK's wallet setup out, so a real buy passes the agent's signer", async () => {
  const { store, connection, key, rows, journal } = await stand();
  /* As `@meteora-ag/dlmm` builds it for `user` = the vault: SOL wrapped from the vault, its coin account opened at its cost. */
  const DLMM = {
    create: async () => ({
      tokenX: { publicKey: coin },
      tokenY: { publicKey: NATIVE_MINT },
      getBinArrayForSwap: async () => [],
      swapQuote: () => ({ outAmount: new BN(1), minOutAmount: new BN(1), binArraysPubkey: [] }),
      swap: async ({ inAmount }) => ({
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
          SystemProgram.transfer({ fromPubkey: vault, toPubkey: budget, lamports: 1 }),
          createAssociatedTokenAccountIdempotentInstruction(vault, tokenAccountOf(vault, coin), vault, coin),
          swap2(BigInt(inAmount.toString())),
        ],
      }),
    }),
  };
  const real = dlmmVenue(connection, gate, { DLMM });
  const lines = await runAgentPass({ gate, store, connection, key, journal, venue: { ...real, received: async () => 1n }, now: () => NOW });
  assert.deepEqual(lines, [{ policy: RECORD.policy, did: "bought" }]);
  assert.deepEqual(rows.map((row) => row.outcome), ["SIGNED"]);
  assert.equal(connection.sent[0].message.header.numRequiredSignatures, 1);
  /* Her account not there yet: the first buy opens it, at the agent's cost. */
  connection.accounts.delete(receiver.toBase58());
  const built = await real.buy(mandateOf(await readEntry(store, RECORD.policy), gate), medium.perTrade, receiver, coin);
  assert.equal(built.setup.length, 1);
  assert.ok(built.setup[0].keys[0].pubkey.equals(agent) && built.setup[0].keys[1].pubkey.equals(receiver));
  /* Ryntra's fee: the table's 1 % for a coin no catalogue reads, to Ryntra's account; the swap gets the rest. */
  assert.equal(built.feeSides.output.verified, false, "a coin no catalogue reads: the table's MEME");
  assert.ok(built.fee.keys[2].pubkey.equals(FEE_WSOL));
  assert.equal(built.fee.data.readBigUInt64LE(1), feeOf(medium.perTrade));
  assert.equal(built.instruction.data.readBigUInt64LE(8), medium.perTrade - feeOf(medium.perTrade));
  /* No fee account on chain, no trade: the agent does not pay to hear the chain fail. */
  connection.accounts.delete(FEE_WSOL.toBase58());
  await assert.rejects(real.buy(mandateOf(await readEntry(store, RECORD.policy), gate), medium.perTrade, receiver, coin), /fee account is not on chain/);
});

test("two passes at once never buy the same slot twice", async () => {
  const { store, connection, key, journal } = await stand();
  const both = await Promise.all([0, 1].map(() => runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW })));
  assert.deepEqual(both.flat().map((line) => line.did).sort(), ["bought", "waited"]);
  assert.equal(connection.sent.length, 1);
});

test("the chain's answers are written as they are: a refusal of the day's cap is a wait, not a failure", () => {
  assert.equal(tradeOf({ status: "landed", ok: false, signature: "s", size: 1, refusal: { code: "ProgramInteractionInsufficientTokenAllowance", reason: "the day's budget is spent" }, computeUnits: 1, fee: 1 }, 5n, null, 1).allowance, true);
  assert.equal(tradeOf({ status: "landed", ok: true, signature: "s", size: 1, computeUnits: 1, fee: 1 }, 5n, 9n, 1).receivedRaw, "9");
  assert.equal(tradeOf({ status: "unknown", signature: "s", size: 1 }, 5n, null, 1).spentRaw, "0");
});

test("the agent works only on devnet, with its own key and a store that survives a cold start", async () => {
  const { agentMinute, agentKeyFor } = await import("./agent-service.server.ts");
  const env = { RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: pool.toBase58(), RYNTRA_AGENT_MANDATE_AGENT: agent.toBase58() };
  assert.deepEqual(await agentMinute({}), { ran: false, why: "closed" });
  assert.deepEqual(await agentMinute({ ...env, RYNTRA_AGENT_MANDATE: "mainnet" }), { ran: false, why: "closed" });
  assert.deepEqual(await agentMinute(env), { ran: false, why: "no-key" });
  const other = Keypair.generate();
  assert.equal(agentKeyFor({ ...env, RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...other.secretKey]) }, gate), null, "a key that is not the gate's agent signs nothing");
  assert.deepEqual(await agentMinute({ ...env, RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...agentPair.secretKey]) }, { store: createMemoryGuardStore() }), { ran: false, why: "store" });
});

/* ------------------------------------------------------------------ the agent's own pause: every threshold */

const buy = (spent, received, at = NOW - HOUR, extra = {}) => ({ at, status: "ok", signature: "s", spentRaw: String(spent), receivedRaw: received === null ? null : String(received), reason: null, ...extra });
const looked = (extra) => autostop({ trades: [], worthRaw: 0n, budgetLeft: medium.budget, unreadSince: null, now: NOW, ...extra });

test("the thresholds are the conservative ones, in one place", () => {
  assert.deepEqual({ ...AUTOSTOP }, { maxLossBps: 1_500, losingInARow: 3, losingTradeBps: 300, failuresInARow: 3, unreadMs: 6 * HOUR, settledBlocks: 150 });
  assert.equal(FAILURES_TO_PAUSE, AUTOSTOP.failuresInARow);
});

test("the first buy needs nothing but the budget read; nothing bought is nothing lost", () => {
  assert.deepEqual(looked({}), { action: "go" });
  assert.deepEqual(looked({ budgetLeft: null }), { action: "wait" });
});

test("at 15 % under what it paid the agent pauses; a hair above, it buys on", () => {
  const trades = [buy(10_000, 500)];
  assert.deepEqual(looked({ trades, worthRaw: 8_500n }), { action: "pause", reason: "loss" });
  assert.deepEqual(looked({ trades, worthRaw: 0n }), { action: "pause", reason: "loss" });
  assert.deepEqual(looked({ trades, worthRaw: 8_501n }), { action: "go" });
  assert.deepEqual(looked({ trades, worthRaw: 12_000n }), { action: "go" });
  assert.equal(trackRecord(trades, 8_500n).lossBps, 1_500);
  assert.equal(trackRecord(trades, 12_000n).lossBps, 0);
});

test("three buys in a row under water pause it; two, or a good buy between, do not", () => {
  /* Three equal buys, the price 3 % under all of them: not 15 % overall, yet three losing buys. */
  const three = [buy(10_000, 100), buy(10_000, 100), buy(10_000, 100)];
  assert.deepEqual(looked({ trades: three, worthRaw: 29_100n }), { action: "pause", reason: "losses" });
  assert.equal(trackRecord(three, 29_100n).losingInARow, 3);
  /* Just above the 3 % line: none is a losing buy. */
  assert.deepEqual(looked({ trades: three, worthRaw: 29_103n }), { action: "go" });
  assert.equal(trackRecord(three, 29_103n).losingInARow, 0);
  assert.deepEqual(looked({ trades: three.slice(1), worthRaw: 19_400n }), { action: "go" });
  /* The newest buy cheap, the two before it dear: the streak is what the last buys did. */
  const mixed = [buy(10_000, 100), buy(10_000, 100), buy(10_000, 200)];
  assert.equal(trackRecord(mixed, 40_000n).losingInARow, 0);
  /* A failed try between buys is not a buy: the streak runs through it. */
  const through = [buy(10_000, 100), buy(10_000, 100), { at: NOW, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "x" }, buy(10_000, 100)];
  assert.equal(trackRecord(through, 29_100n).losingInARow, 3);
});

test("a figure not read means no buy, never a guess — and if it stays unread, a pause", () => {
  const trades = [buy(10_000, 500)];
  assert.deepEqual(looked({ trades, worthRaw: null }), { action: "wait" });
  assert.deepEqual(looked({ trades, worthRaw: 10_000n, budgetLeft: null }), { action: "wait" });
  assert.deepEqual(looked({ trades: [buy(10_000, null)], worthRaw: 10_000n }), { action: "wait" });
  assert.deepEqual(looked({ trades: [{ at: NOW, status: "failed", signature: "s", spentRaw: "0", receivedRaw: null, reason: "x", unsettledRaw: "10000" }], worthRaw: 0n }), { action: "wait" });
  assert.deepEqual(looked({ trades, worthRaw: null, unreadSince: NOW - AUTOSTOP.unreadMs + 1 }), { action: "wait" });
  assert.deepEqual(looked({ trades, worthRaw: null, unreadSince: NOW - AUTOSTOP.unreadMs }), { action: "pause", reason: "unread" });
});

test("a trade that brought less than the minimum it demanded stops the agent at once", () => {
  const trades = [buy(10_000, 99, NOW - HOUR, { minOutRaw: "100" })];
  assert.deepEqual(looked({ trades, worthRaw: 20_000n }), { action: "pause", reason: "short" });
  assert.deepEqual(looked({ trades: [buy(10_000, 100, NOW - HOUR, { minOutRaw: "100" })], worthRaw: 20_000n }), { action: "go" });
});

const ripe = NOW + 24 * HOUR;

test("in the pass: when the bought coins are down 15 % the agent pauses, signs nothing, and stays paused", async () => {
  const { store, connection, key, rows, journal } = await stand();
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  assert.equal(connection.sent.length, 1);
  const down = venue(undefined, { worth: async () => (medium.perTrade * 85n) / 100n });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: down, now: () => ripe }), [{ policy: RECORD.policy, did: "paused" }]);
  assert.equal(connection.sent.length, 1, "nothing more is sent");
  assert.equal(rows.length, 1, "nothing more is signed");
  const entry = await readEntry(store, RECORD.policy);
  assert.equal(entry.status, "paused");
  assert.equal(entry.pausedBy, "loss");
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + HOUR }), [], "a paused agent does not come back on its own");
  assert.equal(viewOf(entry, null).pausedBy, "loss");
});

test("in the pass: a buy that brought nothing is a whole loss, not a figure unread", async () => {
  const { store, connection, key, journal } = await stand();
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(undefined, { received: async () => 0n }), now: () => NOW });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe }), [{ policy: RECORD.policy, did: "paused" }]);
  assert.equal((await readEntry(store, RECORD.policy)).pausedBy, "short", "it also fell under its own minimum");
});

test("in the pass: a buy above the line goes on, and the quote is read only when a buy is due", async () => {
  const { store, connection, key, journal } = await stand();
  let quotes = 0;
  const counted = venue(undefined, { worth: async () => (quotes += 1, medium.perTrade) });
  await runAgentPass({ gate, store, connection, key, journal, venue: counted, now: () => NOW });
  assert.equal(quotes, 0, "nothing bought yet: nothing to quote");
  await runAgentPass({ gate, store, connection, key, journal, venue: counted, now: () => NOW + 60_000 });
  assert.equal(quotes, 0, "the rhythm says wait: no read");
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: counted, now: () => ripe }), [{ policy: RECORD.policy, did: "bought" }]);
  assert.equal(quotes, 1);
  assert.equal(connection.sent.length, 2);
});

test("in the pass: a quote that does not answer means no buy; it pauses after six hours; an answer clears the clock", async () => {
  const { store, connection, key, journal } = await stand();
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  const blind = venue(undefined, { worth: async () => { throw new Error("no answer"); } });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => ripe }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal((await readEntry(store, RECORD.policy)).unreadSince, ripe);
  assert.equal(connection.sent.length, 1);
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => ripe + AUTOSTOP.unreadMs - 1 }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal((await readEntry(store, RECORD.policy)).unreadSince, ripe, "the clock keeps its start");
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + HOUR }), [{ policy: RECORD.policy, did: "bought" }]);
  assert.equal((await readEntry(store, RECORD.policy)).unreadSince, undefined);
  await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => ripe + 12 * HOUR });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => ripe + 18 * HOUR }), [{ policy: RECORD.policy, did: "paused" }]);
  assert.equal((await readEntry(store, RECORD.policy)).pausedBy, "unread");
});

test("in the pass: a budget balance that does not answer means no buy", async () => {
  const { store, connection, key, journal } = await stand();
  connection.getTokenAccountBalance = async () => { throw new Error("no answer"); };
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 0);
});

test("in the pass: a trade the chain has not answered holds the next buy until it has, and then counts as what it was", async () => {
  const { store, connection, key, journal } = await stand();
  const trade = async () => ({ status: "unknown", signature: "unread-one", size: 1, validUntilHeight: 500 });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW, trade });
  const first = await readEntry(store, RECORD.policy);
  assert.equal(first.trades[0].unsettledRaw, medium.perTrade.toString());
  assert.equal(first.trades[0].validUntilHeight, 500);
  assert.equal(first.trades[0].spentRaw, "0");
  /* Still unknown at the next slot: no buy. */
  connection.getTransaction = async () => null;
  connection.getBlockHeight = async () => 400;
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe, trade }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 0);
  /* It landed after all: it is a real buy, with what it brought. */
  connection.getTransaction = async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 1 } });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + 60_000, trade });
  const after = await readEntry(store, RECORD.policy);
  assert.deepEqual([after.trades[0].status, after.trades[0].spentRaw, after.trades[0].receivedRaw, after.trades[0].unsettledRaw], ["ok", medium.perTrade.toString(), "47000", undefined]);
});

test("in the pass: a coin's mint not read leaves a landed trade open — never counted off a guessed account", async () => {
  const { store, connection, key, journal } = await stand();
  const trade = async () => ({ status: "unknown", signature: "unread-one", size: 1, validUntilHeight: 500 });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW, trade });
  /* It landed, but the coin's mint does not answer: which program her account is under is not known. */
  const read = connection.getAccountInfo;
  connection.getAccountInfo = async (address, ...rest) => {
    if (address.equals(coin)) throw new Error("429");
    return read(address, ...rest);
  };
  const askedOf = [];
  const counting = venue(undefined, { received: async (_signature, account) => (askedOf.push(account.toBase58()), 47_000n) });
  for (const at of [ripe, ripe + 60_000]) await runAgentPass({ gate, store, connection, key, journal, venue: counting, now: () => at, trade });
  const open = await readEntry(store, RECORD.policy);
  assert.equal(open.trades[0].unsettledRaw, medium.perTrade.toString());
  assert.equal(open.trades[0].receivedRaw, null);
  assert.deepEqual(askedOf, []);
  /* The mint answers again: the trade counts what reached her own account. */
  connection.getAccountInfo = read;
  await runAgentPass({ gate, store, connection, key, journal, venue: counting, now: () => ripe + 120_000, trade });
  const after = await readEntry(store, RECORD.policy);
  assert.deepEqual([after.trades[0].status, after.trades[0].receivedRaw, after.trades[0].unsettledRaw], ["ok", "47000", undefined]);
  assert.deepEqual(askedOf, [receiver.toBase58()]);
});

const unknownRow = { at: NOW, status: "failed", signature: "x", spentRaw: "0", receivedRaw: null, reason: "not confirmed in time", unsettledRaw: "50", validUntilHeight: 1_000 };
const noTx = (height) => ({ getTransaction: async () => null, getBlockHeight: async () => { if (height === null) throw new Error("429"); return height; } });

test("a read that failed is not an answer: only «no such transaction» past the blockhash's end means it did not land", async () => {
  const read = async () => 1n;
  /* The RPC does not answer, however late: the money may be spent, the row stays open. */
  const down = { getTransaction: async () => { throw new Error("429 Too Many Requests"); }, getBlockHeight: async () => 9_999_999 };
  assert.equal((await settled([unknownRow], down, read))[0].unsettledRaw, "50");
  /* It answers «none», but the blockhash still lives, or the height is not read. */
  assert.equal((await settled([unknownRow], noTx(1_000), read))[0].unsettledRaw, "50");
  assert.equal((await settled([unknownRow], noTx(1_000 + AUTOSTOP.settledBlocks), read))[0].unsettledRaw, "50");
  assert.equal((await settled([unknownRow], noTx(null), read))[0].unsettledRaw, "50");
  /* A row that does not know its blockhash's end is never called gone. */
  const { validUntilHeight: _none, ...blind } = unknownRow;
  assert.equal((await settled([blind], noTx(9_999_999), read))[0].unsettledRaw, "50");
  /* Past the end by the margin, and the chain says none: it did not land. */
  const [gone] = await settled([unknownRow], noTx(1_001 + AUTOSTOP.settledBlocks), read);
  assert.deepEqual([gone.status, gone.unsettledRaw, gone.reason, gone.spentRaw], ["failed", undefined, "did not land", "0"]);
});

test("settling: one that landed and failed says why; a landed one gets what it brought", async () => {
  const failed = { getBlockHeight: async () => 1, getTransaction: async () => ({ meta: { err: { x: 1 }, logMessages: ["Error Code: ProgramInteractionInsufficientTokenAllowance"], computeUnitsConsumed: 1, fee: 1 } }) };
  const [refused] = await settled([unknownRow], failed, async () => 1n);
  assert.deepEqual([refused.status, refused.allowance, refused.unsettledRaw], ["failed", true, undefined]);
  const landed = { getBlockHeight: async () => 1, getTransaction: async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 1 } }) };
  const [ok] = await settled([unknownRow], landed, async () => 9n);
  assert.deepEqual([ok.status, ok.spentRaw, ok.receivedRaw, ok.unsettledRaw], ["ok", "50", "9", undefined]);
  const landedUnread = buy(10, null);
  const [read] = await settled([landedUnread], noTx(1), async () => 9n);
  assert.equal(read.receivedRaw, "9");
  const [stillUnread] = await settled([landedUnread], noTx(1), async () => { throw new Error("no"); });
  assert.equal(stillUnread, landedUnread);
});

test("the fate of a transaction has three answers: landed, none, and not read", async () => {
  assert.equal((await fateOf({ getTransaction: async () => ({ meta: { err: null, logMessages: [], fee: 1 } }) }, "s")).state, "landed");
  assert.equal((await fateOf({ getTransaction: async () => null }, "s")).state, "absent");
  assert.equal((await fateOf({ getTransaction: async () => { throw new Error("429"); } }, "s")).state, "unread");
  assert.equal((await fateOf({ getTransaction: async () => ({ meta: null }) }, "s")).state, "unread");
});

test("a broken connection on sending is a trade of unknown fate with its signature, never a refusal", async () => {
  const { store, connection, key, journal } = await stand();
  connection.sendRawTransaction = async () => { throw new Error("fetch failed"); };
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "failed" }]);
  const row = (await readEntry(store, RECORD.policy)).trades[0];
  assert.ok(row.signature, "the signature is known before sending");
  assert.equal(row.unsettledRaw, medium.perTrade.toString());
  assert.equal(typeof row.validUntilHeight, "number");
  /* The node had taken it: the next pass finds it landed, money spent, coins bought. */
  const later = await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 60_000 });
  assert.deepEqual(later, [{ policy: RECORD.policy, did: "waited" }]);
  const settledRow = (await readEntry(store, RECORD.policy)).trades[0];
  assert.deepEqual([settledRow.status, settledRow.spentRaw, settledRow.receivedRaw], ["ok", medium.perTrade.toString(), "47000"]);
});

test("the node's own refusal stays a refusal: nothing was sent, nothing is left open", async () => {
  for (const refusal of [
    new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed: Blockhash not found", logs: [] }),
    Object.assign(new Error("Transaction simulation failed"), { logs: ["Program log: Error Code: ProgramInteractionInsufficientTokenAllowance"] }),
  ]) {
    const { store, connection, key, journal } = await stand();
    connection.sendRawTransaction = async () => { throw refusal; };
    await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
    const row = (await readEntry(store, RECORD.policy)).trades[0];
    assert.equal(row.status, "failed");
    assert.equal(row.signature, null);
    assert.equal(row.unsettledRaw, undefined);
  }
});

test("the book holds the trade before it is sent: a function killed right after sending loses nothing", async () => {
  const { store, connection, key, journal } = await stand();
  let inBook = null;
  let signature = null;
  let told;
  const sent = new Promise((resolve) => (told = resolve));
  connection.sendRawTransaction = async (bytes) => {
    signature = bs58(VersionedTransaction.deserialize(bytes).signatures[0]);
    inBook = (await readEntry(store, RECORD.policy)).trades.at(-1);
    told();
    return signature;
  };
  /* The function dies here: its read never comes back, its last write never happens. */
  connection.getTransaction = () => new Promise(() => undefined);
  void runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  await sent;
  assert.equal(inBook?.signature, signature);
  assert.equal(inBook?.unsettledRaw, medium.perTrade.toString());
  /* The next pass, on a new instance, reads the chain: the buy counts. */
  connection.getTransaction = async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 1 } });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 60_000 });
  const row = (await readEntry(store, RECORD.policy)).trades.at(-1);
  assert.deepEqual([row.status, row.signature, row.spentRaw, row.receivedRaw], ["ok", signature, medium.perTrade.toString(), "47000"]);
  assert.equal((await readEntry(store, RECORD.policy)).trades.length, 1);
});

test("a book that cannot keep the row: nothing is sent", async () => {
  const { store, connection, key, journal } = await stand();
  const real = store.collection.bind(store);
  let writes = 0;
  store.collection = (name) => {
    const collection = real(name);
    if (name !== "agentMandates") return collection;
    return { ...collection, get: collection.get.bind(collection), valuesWithPrefix: collection.valuesWithPrefix.bind(collection), insertIfAbsent: collection.insertIfAbsent.bind(collection), set: async () => { writes += 1; throw new Error("store down"); } };
  };
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  assert.ok(writes > 0);
  assert.equal(connection.sent.length, 0);
});

test("a trade waits a bounded time for the chain and leaves the rest to the next pass; a pass starts nothing late", { timeout: 40_000 }, async () => {
  assert.ok(TRADE_READ_TRIES * 1.5 <= 15, "a trade's read fits the pass");
  const { store, connection, key, journal, joined } = await stand();
  connection.confirmTransaction = () => new Promise(() => undefined);
  connection.getTransaction = async () => null;
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "failed" }]);
  /* Two mandates and a clock past the budget after the first: the second waits for the next pass. */
  const other = Keypair.generate().publicKey;
  await writeEntry(store, { ...joined.entry, record: { ...RECORD, policy: other.toBase58() } });
  connection.accounts.set(other.toBase58(), connection.accounts.get(policy.toBase58()));
  let clock = ripe;
  const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => (clock += PASS_STARTS_WITHIN_MS) });
  assert.equal(lines.length, 1);
});

test("one mandate that cannot be read does not stop the pass, and its clock starts", async () => {
  const { store, connection, key, journal, joined } = await stand();
  const other = Keypair.generate().publicKey;
  await writeEntry(store, { ...joined.entry, record: { ...RECORD, policy: other.toBase58() } });
  connection.accounts.set(other.toBase58(), connection.accounts.get(policy.toBase58()));
  const read = connection.getAccountInfo;
  /* The first mandate in the book fails on its very first read; the other goes on. */
  const first = (await readBook(store))[0].record.policy;
  connection.getAccountInfo = async (address, ...rest) => { if (address.toBase58() === first) throw new Error("429"); return read(address, ...rest); };
  const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  assert.equal(lines.length, 2);
  assert.equal(lines.find((line) => line.policy === first).did, "unread");
  assert.equal(lines.find((line) => line.policy !== first).did, "bought");
  assert.equal((await readEntry(store, first)).unreadSince, NOW);
  /* The whole outage: after six hours it pauses, though no read ever worked. */
  connection.getAccountInfo = async () => { throw new Error("429"); };
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + HOUR });
  assert.equal((await readEntry(store, first)).unreadSince, NOW, "the clock keeps its start");
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 7 * HOUR });
  const paused = await readEntry(store, first);
  assert.deepEqual([paused.status, paused.pausedBy], ["paused", "unread"]);
});

test("an agent that cannot reach the chain at all keeps the clock too", async () => {
  const { store } = await stand();
  const { agentMinute } = await import("./agent-service.server.ts");
  const env = { RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: pool.toBase58(), RYNTRA_AGENT_MANDATE_AGENT: agent.toBase58(), RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...agentPair.secretKey]) };
  const durable = { ...store, durability: "DURABLE_SINGLE_WRITER" };
  const down = { getGenesisHash: async () => { throw new Error("429"); } };
  assert.deepEqual(await agentMinute(env, { store: durable, connection: down, now: () => NOW - 1 }), { ran: false, why: "not-devnet" });
  assert.equal((await readEntry(store, RECORD.policy)).unreadSince, NOW - 1);
  await writeEntry(store, { ...(await readEntry(store, RECORD.policy)), unreadSince: undefined });
  await markUnread(store, NOW);
  assert.equal((await readEntry(store, RECORD.policy)).unreadSince, NOW);
  await markUnread(store, NOW + 7 * HOUR);
  const paused = await readEntry(store, RECORD.policy);
  assert.deepEqual([paused.status, paused.pausedBy], ["paused", "unread"]);
});

test("a pause for what it could not read lifts by itself once it reads; a pause for a loss does not", async () => {
  const { store, connection, key, journal, joined } = await stand();
  await writeEntry(store, { ...joined.entry, status: "paused", pausedBy: "unread", unreadSince: NOW - 7 * HOUR });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "bought" }]);
  const back = await readEntry(store, RECORD.policy);
  assert.deepEqual([back.status, back.pausedBy, back.unreadSince], ["working", undefined, undefined]);
  await writeEntry(store, { ...back, status: "paused", pausedBy: "loss" });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe }), []);
  assert.equal((await readEntry(store, RECORD.policy)).pausedBy, "loss");
});

test("an old blip does not pause the agent: the clock is cleared when the figures read again", async () => {
  /* Quote fails once; next time all reads, but the slot is already taken: no trade, yet the clock must clear. */
  {
    const { store, connection, key, journal } = await stand();
    await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
    const blind = venue(undefined, { worth: async () => { throw new Error("no answer"); } });
    await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => ripe });
    assert.equal((await readEntry(store, RECORD.policy)).unreadSince, ripe);
    const { everyMs } = steadyRhythm(medium.perTrade, medium.perDay);
    const slot = Math.floor(ripe / everyMs);
    await store.collection("agentMandates").insertIfAbsent(`c:devnet:${RECORD.policy}:${slot}`, { claimedAt: ripe });
    assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + 1 }), [{ policy: RECORD.policy, did: "waited" }]);
    assert.equal((await readEntry(store, RECORD.policy)).unreadSince, undefined);
  }
  /* A read failed while the rhythm said wait; the next pass reads and still waits: the clock clears then too. */
  {
    const { store, connection, key, journal } = await stand();
    await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
    const read = connection.getAccountInfo;
    connection.getAccountInfo = async () => { throw new Error("429"); };
    await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 60_000 });
    assert.equal((await readEntry(store, RECORD.policy)).unreadSince, NOW + 60_000);
    connection.getAccountInfo = read;
    await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 120_000 });
    assert.equal((await readEntry(store, RECORD.policy)).unreadSince, undefined);
    /* Seven hours on, one blip: a wait, not a pause. */
    const blind = venue(undefined, { worth: async () => { throw new Error("no answer"); } });
    assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: blind, now: () => NOW + 7 * HOUR }), [{ policy: RECORD.policy, did: "waited" }]);
  }
});

test("a mandate no longer working still settles its open trades, and trades no more", async () => {
  for (const status of ["spent", "ended", "stopped", "paused"]) {
    const { store, connection, key, journal, joined } = await stand();
    await writeEntry(store, { ...joined.entry, status, ...(status === "paused" ? { pausedBy: "loss" } : {}), trades: [{ ...unknownRow, signature: "last-one" }, buy(10, null, NOW - HOUR, { signature: "read-me" })] });
    const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
    assert.deepEqual(lines, [], status);
    assert.equal(connection.sent.length, 0, status);
    const [first, second] = (await readEntry(store, RECORD.policy)).trades;
    assert.deepEqual([first.status, first.spentRaw, first.unsettledRaw, first.receivedRaw], ["ok", "50", undefined, "47000"], status);
    assert.equal(second.receivedRaw, "47000", status);
    assert.equal((await readEntry(store, RECORD.policy)).status, status);
  }
});

test("what it earned is not told while a trade's fate is open", () => {
  assert.equal(resultOf([buy(10, 5), unknownRow], 100n).worthRaw, null);
  assert.equal(resultOf([buy(10, 5), unknownRow], 100n).earnedRaw, null);
});

/* ------------------------------------------------------------------ the agent's key under KMS */

test("the agent's key: the switch names it, in KMS it must be the gate's agent, a mistyped switch is no key at all", async () => {
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    const name = versionName("agent");
    const kmsAgent = new PublicKey(stub.addressOf(name));
    const kmsGate = { ...gate, agent: kmsAgent };
    const env = { RYNTRA_AGENT_MANDATE_SIGNER: "kms", RYNTRA_AGENT_MANDATE_KMS_KEY: name, RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN };
    const key = agentKeyFor(env, kmsGate);
    assert.equal(key.mode, "kms");
    assert.equal(key.keyRef, name);
    assert.equal((await key.sign(Uint8Array.of(1, 2, 3))).length, 64);

    /* The environment's key is not read in KMS mode, even where it is set; `env` mode reads only it. */
    const envPair = JSON.stringify([...agentPair.secretKey]);
    assert.equal(agentKeyFor({ ...env, RYNTRA_AGENT_MANDATE_KEY: envPair }, kmsGate).mode, "kms");
    assert.equal(agentKeyFor({ RYNTRA_AGENT_MANDATE_SIGNER: "env", RYNTRA_AGENT_MANDATE_KEY: envPair, RYNTRA_AGENT_MANDATE_KMS_KEY: name }, gate).mode, "env");
    assert.equal(agentKeyFor({ RYNTRA_AGENT_MANDATE_KEY: envPair }, gate).mode, "env");

    assert.equal(agentKeyFor({ ...env, RYNTRA_AGENT_MANDATE_SIGNER: "kmss", RYNTRA_AGENT_MANDATE_KEY: envPair }, gate), null, "a mistyped switch never falls back");
    assert.equal(agentKeyFor({ ...env, RYNTRA_AGENT_MANDATE_KMS_KEY: undefined }, kmsGate), null);
    assert.equal(agentKeyFor({ ...env, RYNTRA_AGENT_MANDATE_KMS_KEY: "not-a-version" }, kmsGate), null);
    assert.equal(agentKeyFor({ ...env, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: undefined }, kmsGate), null, "no way in");
    assert.equal(agentKeyFor({ ...env, RYNTRA_LAUNCH_KMS_ENDPOINT: "https://not-google.example" }, kmsGate), null, "a token goes to Google or to this machine, nowhere else");

    /* A KMS key that is not the gate's agent signs nothing. */
    await assert.rejects(agentKeyFor(env, gate).sign(Uint8Array.of(1)), /the deployment names/);
  } finally {
    await stub.close();
    forgetKmsAddresses();
  }
});

test("in KMS the key's address is asked of Google before a pass: another address or no answer runs no pass and ends no mandate", async () => {
  const { agentMinute } = await import("./agent-service.server.ts");
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    const name = versionName("agent-pass");
    const kmsAgent = stub.addressOf(name);
    const env = { RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: pool.toBase58(), RYNTRA_AGENT_MANDATE_SIGNER: "kms", RYNTRA_AGENT_MANDATE_KMS_KEY: name, RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN };
    /* A durable book with a working mandate: a pass that ran would touch it. */
    const book = createMemoryGuardStore();
    const store = { ...book, durability: "DURABLE_SINGLE_WRITER", collection: (...args) => book.collection(...args) };
    await writeEntry(book, { v: 1, cluster: "devnet", record: RECORD, preset: "medium", strategy: "steady", said: null, receiveMint: coin.toBase58(), status: "working", trades: [], createdAt: NOW, updatedAt: NOW });
    const untouched = async () => assert.deepEqual([(await readEntry(book, RECORD.policy)).status, (await readEntry(book, RECORD.policy)).updatedAt], ["working", NOW]);
    const reached = { calls: 0 };
    const connection = { getGenesisHash: async () => { reached.calls += 1; throw new Error("not reached"); } };

    assert.deepEqual(await agentMinute({ ...env, RYNTRA_AGENT_MANDATE_AGENT: agent.toBase58() }, { store, connection }), { ran: false, why: "wrong-key" }, "the deployment names an address the key is not");
    await untouched();
    assert.deepEqual(await agentMinute({ ...env, RYNTRA_AGENT_MANDATE_AGENT: kmsAgent }, { store, connection, fetch: async () => { throw new Error("down"); } }), { ran: false, why: "key-unread" });
    await untouched();
    assert.equal(reached.calls, 0, "neither asked the chain");
    /* The right key goes on to the pass: here the network, which this stand-in does not answer. */
    assert.deepEqual(await agentMinute({ ...env, RYNTRA_AGENT_MANDATE_AGENT: kmsAgent }, { store, connection, now: () => NOW }), { ran: false, why: "not-devnet" });
    assert.equal(reached.calls, 1);
  } finally {
    await stub.close();
    forgetKmsAddresses();
  }
});

test("under KMS the agent's trade is the same: its bounds, its check and its journal, and a KMS that misbehaves signs nothing", async () => {
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    const name = versionName("agent-pass");
    const kmsAgent = new PublicKey(stub.addressOf(name));
    const kmsGate = { ...gate, agent: kmsAgent };
    const key = agentKeyFor({ RYNTRA_AGENT_MANDATE_SIGNER: "kms", RYNTRA_AGENT_MANDATE_KMS_KEY: name, RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint, RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN }, kmsGate);
    const store = createMemoryGuardStore();
    const connection = chain({ signer: kmsAgent });
    await registerMandate({ record: RECORD, strategy: "steady", said: null }, kmsGate, { store, connection, receiveMint: async () => coin, now: () => NOW });
    const rows = [];
    const journal = async (row) => void rows.push(row);
    assert.deepEqual(await runAgentPass({ gate: kmsGate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "bought" }]);
    assert.ok(connection.sent[0].message.staticAccountKeys[0].equals(kmsAgent));
    assert.deepEqual(rows.map((row) => [row.outcome, row.mode, row.keyRef, row.signer]), [["SIGNED", "kms", name, kmsAgent.toBase58()]]);
    assert.ok(!JSON.stringify(rows).includes(STUB_TOKEN), "a token never reaches the journal");

    /* Outside the bounds KMS is never asked. */
    const asked = stub.calls.filter((call) => call.method === "POST").length;
    assert.deepEqual(await runAgentPass({ gate: kmsGate, store, connection, key, journal, venue: venue((amount) => swap2(amount * 2n)), now: () => ripe }), [{ policy: RECORD.policy, did: "refused" }]);
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, asked);

    /* KMS answering with another key's signature: not given back, not sent. */
    stub.faults.add("wrongSignature");
    const sent = connection.sent.length;
    assert.deepEqual(await runAgentPass({ gate: kmsGate, store, connection, key, journal, venue: venue(), now: () => ripe + 2 * 24 * HOUR }), [{ policy: RECORD.policy, did: "refused" }]);
    assert.equal(connection.sent.length, sent);
    assert.match(rows.at(-1).reason, /signature is not/);
  } finally {
    await stub.close();
    forgetKmsAddresses();
  }
});

test("the agent's files read no key from the environment and print none", () => {
  for (const file of ["strategy.ts", "book.server.ts", "tick.server.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|secretKey|console\.log/, file);
  }
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/agent-mandate"));
  void PublicKey;
});

const venueOf = (...args) => venue(...args);

/* ------------------------------------------------------------------ CITY-70: missions — freeze, the books, a replay, unknown */

test("CITY-70: her «Freeze» stops every new buy at once — nothing signed, nothing sent — and «Resume» lets it work again", async () => {
  const { setFrozen } = await import("./freeze.server.ts");
  const { store, connection, key, journal, rows } = await stand();
  assert.deepEqual(await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: true }, "devnet", { store, now: () => NOW }), { ok: true, frozen: true });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "frozen" }]);
  assert.deepEqual([connection.sent.length, rows.length], [0, 0], "frozen: the signer is never asked");
  /* The book's row is the agent's to rewrite; the switch is not in it, so no pass writes it away. */
  assert.equal((await readEntry(store, RECORD.policy)).status, "working");
  assert.deepEqual(await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: false }, "devnet", { store }), { ok: true, frozen: false });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 60_000 }), [{ policy: RECORD.policy, did: "bought" }]);
  assert.equal(connection.sent.length, 1);
});

test("CITY-70: only the mandate's own wallet turns its switch; a mandate no longer at work has nothing to freeze", async () => {
  const { setFrozen } = await import("./freeze.server.ts");
  const { store } = await stand();
  assert.equal((await setFrozen({ owner: attacker.toBase58(), policy: RECORD.policy, frozen: true }, "devnet", { store })).ok, false);
  assert.equal((await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: true }, "mainnet", { store })).ok, false, "another network's book is another book");
  await writeEntry(store, { ...(await readEntry(store, RECORD.policy)), status: "stopped" });
  assert.deepEqual(await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: true }, "devnet", { store }), { ok: false, code: "NOTHING", reason: "The agent no longer works for this mandate." });
  assert.deepEqual(await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: false }, "devnet", { store }), { ok: true, frozen: false }, "off is always allowed");
});

test("CITY-70: a freeze turned on while the pass runs stops the buy it was about to make — the switch is read again before the spend", async () => {
  const { freezeKey } = await import("./freeze.server.ts");
  const { store, connection, key, journal, rows } = await stand();
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW });
  /* The freeze lands between the pass's first read and its buy: while the venue's quote is read. */
  const late = venue(undefined, {
    worth: async () => {
      await store.collection("agentMandates").set(freezeKey("devnet", RECORD.policy), { v: 1, kind: "freeze", cluster: "devnet", policy: RECORD.policy, owner: RECORD.owner, at: NOW });
      return medium.perTrade;
    },
  });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: late, now: () => ripe }), [{ policy: RECORD.policy, did: "frozen" }]);
  assert.deepEqual([connection.sent.length, rows.length], [1, 1]);
});

test("CITY-70: a switch list the book cannot read is never taken as off — nothing new is bought that pass", async () => {
  const { store, connection, key, journal } = await stand();
  const real = store.collection.bind(store);
  const shaky = {
    ...store,
    collection: (name) => {
      const collection = real(name);
      if (name !== "agentMandates") return collection;
      return { ...collection, get: collection.get.bind(collection), set: collection.set.bind(collection), insertIfAbsent: collection.insertIfAbsent.bind(collection), valuesWithPrefix: async (prefix) => (prefix.startsWith("f:") ? Promise.reject(new Error("down")) : collection.valuesWithPrefix(prefix)) };
    },
  };
  assert.deepEqual(await runAgentPass({ gate, store: shaky, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "unread" }]);
  assert.equal(connection.sent.length, 0);
});

test("CITY-70: the money adds up before every spend — a vault holding less than the book explains pauses the agent, nothing signed", async () => {
  const { store, connection, key, journal, rows } = await stand();
  /* The coins hold their price: no loss stands in the way of what this test looks at. */
  const venue = (build, extra = {}) => venueOf(build, { worth: async () => 10n * medium.perTrade, ...extra });
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "bought" }]);
  /* The chain holds exactly budget − spent: the next slot buys. */
  connection.budgetLeft = medium.budget - medium.perTrade;
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe }), [{ policy: RECORD.policy, did: "bought" }]);
  /* A lamport left the vault outside the book: the agent stops spending and says why. */
  connection.budgetLeft = medium.budget - 2n * medium.perTrade - 1n;
  const signed = rows.length;
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + 24 * HOUR }), [{ policy: RECORD.policy, did: "paused" }]);
  const entry = await readEntry(store, RECORD.policy);
  assert.deepEqual([entry.status, entry.pausedBy, rows.length, connection.sent.length], ["paused", "mismatch", signed, 2]);
  /* More in the vault than the book needs (money added, or another mandate's on the same vault) is no reason to stop. */
  const other = await stand();
  other.connection.budgetLeft = medium.budget * 2n;
  assert.deepEqual(await runAgentPass({ gate, store: other.store, connection: other.connection, key: other.key, journal: other.journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "bought" }]);
});

test("CITY-70: a replay never pays twice — the same slot again, a pass that died after sending, and a lost answer are each one trade", async () => {
  const { store, connection, key, journal } = await stand();
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW }), [{ policy: RECORD.policy, did: "bought" }]);
  /* The same slot again — a retried cron, a second instance: the claim is taken. */
  assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 1_000 }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 1);
  /* The next slot's trade is signed, its row written, and the process dies before it learns anything more. */
  const died = async (input) => {
    await input.beforeSend({ signature: "sent-then-died", validUntilHeight: 900 });
    throw new Error("the function was killed");
  };
  connection.getTransaction = async () => null;
  connection.getBlockHeight = async () => 100;
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe, trade: died });
  const open = (await readEntry(store, RECORD.policy)).trades.at(-1);
  assert.deepEqual([open.signature, open.unsettledRaw], ["sent-then-died", medium.perTrade.toString()]);
  /* Every later slot while the chain has not answered: no buy — the trade is read by its signature, never re-sent. */
  for (const later of [ripe + 5 * HOUR, ripe + 10 * HOUR]) assert.deepEqual(await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => later }), [{ policy: RECORD.policy, did: "waited" }]);
  assert.equal(connection.sent.length, 1);
  /* The chain answers that it landed: it is counted once, as the buy it was. */
  connection.getTransaction = async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 1 } });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => ripe + 10 * HOUR + 60_000 });
  const ok = (await readEntry(store, RECORD.policy)).trades.filter((row) => row.status === "ok");
  assert.equal(ok.filter((row) => row.signature === "sent-then-died").length, 1);
  /* Two trades, each paid once; the one that died was never sent again. */
  assert.deepEqual([ok.length, connection.sent.length], [2, 1]);
});

test("CITY-70: an unknown trade is never a failure — two failures and a lost answer do not pause the agent as failing", () => {
  const failed = (at) => ({ at, status: "failed", signature: null, spentRaw: "0", receivedRaw: null, reason: "refused" });
  const unknown = { at: NOW - 60_000, status: "failed", signature: "x", spentRaw: "0", receivedRaw: null, reason: "not confirmed in time", unsettledRaw: medium.perTrade.toString(), validUntilHeight: 1 };
  const input = { strategy: "steady", perTrade: medium.perTrade, perDay: medium.perDay, expiresAt: SECONDS(NOW + 10 * 24 * HOUR), budgetLeft: medium.budget, now: NOW };
  assert.notEqual(decide({ ...input, trades: [failed(NOW - 3 * HOUR), failed(NOW - 2 * HOUR), unknown] }).action, "end");
  assert.deepEqual(decide({ ...input, trades: [failed(NOW - 3 * HOUR), failed(NOW - 2 * HOUR), failed(NOW - HOUR)] }), { action: "end", reason: "failing" });
});

test("CITY-70: the view tells the mission, her switch and the money — an unknown trade reads «confirming», never «failed»", async () => {
  const { setFrozen } = await import("./freeze.server.ts");
  const { agentResult } = await import("./agent-service.server.ts");
  const { store, connection, key, journal } = await stand();
  const trade = async () => ({ status: "unknown", signature: "lost-answer", size: 1, validUntilHeight: 500 });
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW, trade });
  const deps = { store, connection, worth: async () => 47_000n, exitBps: async () => 100, now: () => NOW + 60_000 };
  connection.budgetLeft = medium.budget;
  const view = await agentResult({ policy: RECORD.policy, owner: RECORD.owner }, gate, deps);
  assert.equal(view.last[0].state, "unknown");
  assert.equal(view.mission.state, "confirming");
  assert.equal(view.books.state, "settling", "the vault has not paid it yet: the trade on its way explains it");
  /* It landed: the vault paid exactly the trade. */
  connection.getTransaction = async () => ({ meta: { err: null, logMessages: [], computeUnitsConsumed: 1, fee: 1 } });
  connection.budgetLeft = medium.budget - medium.perTrade;
  await runAgentPass({ gate, store, connection, key, journal, venue: venue(), now: () => NOW + 60_000 });
  const after = await agentResult({ policy: RECORD.policy, owner: RECORD.owner }, gate, deps);
  assert.deepEqual([after.last[0].state, after.mission.state, after.books.state, after.books.spentRaw, after.books.leftRaw], ["ok", "waiting", "exact", medium.perTrade.toString(), (medium.budget - medium.perTrade).toString()]);
  assert.ok(after.mission.nextAt > NOW);
  await setFrozen({ owner: RECORD.owner, policy: RECORD.policy, frozen: true }, "devnet", { store });
  const frozen = await agentResult({ policy: RECORD.policy, owner: RECORD.owner }, gate, deps);
  assert.deepEqual([frozen.frozen, frozen.mission.state], [true, "frozen"]);
  /* Withdrawn: the policy is gone, the vault emptied back to her — the mission is stopped, the books closed. */
  connection.accounts.delete(policy.toBase58());
  connection.budgetLeft = 0n;
  const gone = await agentResult({ policy: RECORD.policy, owner: RECORD.owner }, gate, deps);
  assert.deepEqual([gone.mission.state, gone.books.state], ["stopped", "closed"]);
});
