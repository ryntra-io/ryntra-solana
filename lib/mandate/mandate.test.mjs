import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, VersionedMessage } from "@solana/web3.js";

import { envKey } from "../launch/signer/env.server.ts";
import { AGENT_COMPUTE_UNIT_LIMIT, AGENT_HEAP_BYTES, agentTradeInstructions, apiInstruction } from "./agent.ts";
import { buyTick, floorFor } from "./dca.ts";
import { MAX_TRANSACTION_BYTES, planEnable, planStop, planStopAndWithdraw, planWithdraw, tokenAccountOf, unsignedTransaction, wireSize } from "./human.ts";
import { instructionRefusal } from "./judge.ts";
import { agentRouteQuery, readAgentRoute } from "./jupiter.server.ts";
import { LIGHTHOUSE_PROGRAM_ID, heldIn, readReceivedAtLeast, receivedAtLeastInstruction, tradeTerms } from "./result.ts";
import { policyOf, tradeAccounts } from "./run.server.ts";
import { AgentSignerRefused, NO_AGENT_JOURNAL, mandateSigner, tradeRefusal } from "./signer.server.ts";
import { OPEN_SCREEN, registryKeys, storeScreen } from "./ryntra-coins.server.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, readPolicyExecute, refusalOf, ssaAddress } from "./ssa.ts";
import { DLMM_PROGRAM_ID, JUPITER_PROGRAM_ID, LAYOUT, ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2, STARTER_CAPS, constraintIndexFor, jupiterQuoteFloor, mandatePolicy, termsRefusal } from "./terms.ts";
import { agentFeeAccount } from "./fee.ts";

const K = (text) => new PublicKey(text);
const USDC = K("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const NOW = 1_762_000_000n;
const BLOCKHASH = "11111111111111111111111111111111";

/*
 * A live `/build` route for CITY-136's vault (CITY-183): 0.5 SOL → USDC, taker = the vault, output to the person's USDC
 * account, Ryntra's 0.1 % (the table's MAJOR) into Ryntra's wSOL fee account in the route's fee slot.
 */
const route = JSON.parse(readFileSync(new URL("./fixtures/jup-build-fee.json", import.meta.url), "utf8"));
const HUMAN = K("4jh9GEonrg7rpoQv99NWrtQaiskHbiFZp59TyUfZfBGB");
const AGENT = K("9uk3gTx3paCi3zvUav7M4LyMfDVmGWworUgRGypHLjRP");
const ATTACKER = K("29fL4E8eBR62Rf9CHBYvgSv9Nk63JVJ8kLnF7DQThuUf");
const VAULT = K(route.swapInstruction.accounts[0].pubkey);
const BUDGET = K(route.swapInstruction.accounts[1].pubkey);
const VAULT_USDC = K(route.swapInstruction.accounts[2].pubkey);
const HUMAN_USDC = K(route.swapInstruction.accounts[7].pubkey);
const ATTACKER_USDC = getAssociatedTokenAddressSync(USDC, ATTACKER);
const ATTACKER_WSOL = getAssociatedTokenAddressSync(NATIVE_MINT, ATTACKER);
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
/* SOL → USDC is the table's MAJOR: 0.1 % — both sides known by mint, no catalogue facts needed. */
const FEE_BPS = 10;
const SIDES = { input: null, output: null, nowMs: Date.now() };

/** A token account's first 64 bytes: mint, then owner. */
const tokenData = (mint, owner) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Uint8Array(101)]);
const FACTS = new Map([
  [VAULT_USDC.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(USDC, VAULT) }],
  [HUMAN_USDC.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(USDC, HUMAN) }],
  [ATTACKER_USDC.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(USDC, ATTACKER) }],
]);

const jupiterTerms = (extra = {}) => ({
  human: HUMAN,
  agent: AGENT,
  budgetMint: NATIVE_MINT,
  perTrade: 500_000_000n,
  perDay: 2_000_000_000n,
  slippageBps: 100,
  expiresAt: NOW + 30n * 86_400n,
  venue: { kind: "jupiter" },
  raised: true,
  ...extra,
});

const swapOf = (mutate = () => undefined) => {
  const ix = apiInstruction(route.swapInstruction);
  mutate(ix);
  return { programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: Uint8Array.from(ix.data) };
};
const setU64 = (data, offset, value) => new DataView(data.buffer, data.byteOffset).setBigUint64(offset, value, true);
const setU16 = (data, offset, value) => new DataView(data.buffer, data.byteOffset).setUint16(offset, value, true);

/* ------------------------------------------------------------------ terms */

test("the terms refuse what a new agent may not hold, and allow the person's own raise up to its ceiling", () => {
  const starter = { ...jupiterTerms(), raised: false, perTrade: STARTER_CAPS.SOL.perTrade, perDay: STARTER_CAPS.SOL.perDay };
  assert.equal(termsRefusal(starter, NOW), null);
  assert.match(termsRefusal({ ...starter, perDay: STARTER_CAPS.SOL.perDay + 1n }, NOW), /new agent/);
  assert.match(termsRefusal({ ...starter, perTrade: STARTER_CAPS.SOL.perTrade + 1n }, NOW), /new agent/);
  assert.equal(termsRefusal(jupiterTerms(), NOW), null);
  assert.match(termsRefusal(jupiterTerms({ perDay: 6_000_000_000n }), NOW), /raised ceiling/);
  assert.match(termsRefusal(jupiterTerms({ slippageBps: 101 }), NOW), /1 %/);
  assert.match(termsRefusal(jupiterTerms({ expiresAt: NOW + 91n * 86_400n }), NOW), /90 days/);
  assert.match(termsRefusal({ ...starter, expiresAt: NOW + 31n * 86_400n }, NOW), /30 days/);
  assert.match(termsRefusal(jupiterTerms({ expiresAt: NOW }), NOW), /future/);
  assert.match(termsRefusal(jupiterTerms({ agent: HUMAN }), NOW), /agent's key/);
  assert.match(termsRefusal(jupiterTerms({ budgetMint: ATTACKER }), NOW), /SOL or USDC/);
  assert.match(termsRefusal(jupiterTerms({ perTrade: 3_000_000_000n, perDay: 2_000_000_000n }), NOW), /day's cap/);
  assert.match(termsRefusal(jupiterTerms({ fixedBuy: { amountIn: 600_000_000n, outputMint: USDC, minOut: 1n } }), NOW), /within the trade cap/);
  assert.match(termsRefusal(jupiterTerms({ fixedBuy: { amountIn: 100n, outputMint: NATIVE_MINT, minOut: 1n } }), NOW), /another token/);
});

test("the Jupiter policy is the report's template: both instructions, the vault signs, the budget pays, the person receives", () => {
  const policy = mandatePolicy(jupiterTerms(), { vault: VAULT, budgetAccount: BUDGET });
  assert.equal(policy.constraints.length, 2);
  const [route2, shared] = policy.constraints;
  assert.ok(route2.programId.equals(JUPITER_PROGRAM_ID) && shared.programId.equals(JUPITER_PROGRAM_ID));
  assert.deepEqual([...route2.data[0].value.value], [...ROUTE_V2]);
  assert.deepEqual([...shared.data[0].value.value], [...SHARED_ACCOUNTS_ROUTE_V2]);
  assert.deepEqual(route2.accounts.map((a) => a.index), [0, 1, 2, 7, 10]);
  assert.deepEqual(shared.accounts.map((a) => a.index), [1, 2, 5, 12]);
  assert.deepEqual(route2.data.slice(1).map((d) => [d.offset, d.operator]), [[8, "lessThanOrEqualTo"], [24, "lessThanOrEqualTo"], [26, "lessThanOrEqualTo"]]);
  assert.deepEqual(shared.data.slice(1).map((d) => [d.offset, d.operator]), [[9, "lessThanOrEqualTo"], [25, "lessThanOrEqualTo"], [27, "lessThanOrEqualTo"]]);
  /* Ryntra's fee: its account alone in the fee slot, at most the table's highest rate (1 %). */
  for (const [constraint, slot] of [[route2, 10], [shared, 12]]) {
    const fee = constraint.accounts.find((a) => a.index === slot);
    assert.deepEqual(fee.rule.keys.map((k) => k.toBase58()), [FEE_WSOL.toBase58()]);
    assert.equal(constraint.data.at(-1).value.value, 100);
  }
  assert.deepEqual(policy.spendingLimits.map((l) => [l.mint.toBase58(), l.period, l.maxPerPeriod]), [[NATIVE_MINT.toBase58(), "daily", 2_000_000_000n]]);
  assert.equal(policy.spendingLimits[0].expiration, jupiterTerms().expiresAt);
});

test("a regular buy pins exactly its size, its output mint and a quote whose worst slippage still meets the floor", () => {
  assert.equal(jupiterQuoteFloor(99n, 100), 100n);
  assert.equal(jupiterQuoteFloor(45_000_000n, 100), 45_454_546n);
  const terms = jupiterTerms({ fixedBuy: { amountIn: 500_000_000n, outputMint: USDC, minOut: 45_000_000n } });
  const [route2] = mandatePolicy(terms, { vault: VAULT, budgetAccount: BUDGET }).constraints;
  assert.deepEqual(route2.data.slice(1).map((d) => [d.offset, d.operator, d.value.value]), [[8, "equals", 500_000_000n], [24, "lessThanOrEqualTo", 100], [16, "greaterThanOrEqualTo", 45_454_546n], [26, "lessThanOrEqualTo", 100]]);
  /* The pinned mint pins the account itself: the person's own of that mint. */
  const receiver = route2.accounts.find((a) => a.index === 7);
  assert.deepEqual(receiver.rule.keys.map((k) => k.toBase58()), [HUMAN_USDC.toBase58()]);
});

test("the DLMM stand-in pins the program, the pool, the budget, the person's account and the vault", () => {
  const pool = K("2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7");
  const policy = mandatePolicy({ ...jupiterTerms(), venue: { kind: "dlmm", pool } }, { vault: VAULT, budgetAccount: BUDGET });
  assert.equal(policy.constraints.length, 2);
  assert.ok(policy.constraints[0].programId.equals(DLMM_PROGRAM_ID));
  assert.deepEqual(policy.constraints[0].accounts.map((a) => a.index), [0, 4, 5, 10]);
  /* Ryntra's fee on devnet: a TransferChecked from the budget into Ryntra's account, at most 1 % of the trade cap. */
  const fee = policy.constraints[1];
  assert.ok(fee.programId.equals(TOKEN_PROGRAM_ID));
  assert.deepEqual(fee.accounts.map((a) => [a.index, a.rule.keys.map((k) => k.toBase58())]), [[0, [BUDGET.toBase58()]], [2, [FEE_WSOL.toBase58()]]]);
  assert.deepEqual(fee.data.map((d) => [d.offset, d.operator, d.value.value]), [[0, "equals", 12], [1, "lessThanOrEqualTo", 5_000_000n]]);
  assert.equal(constraintIndexFor({ kind: "dlmm", pool }, DLMM_PROGRAM_ID, Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136)), 0);
  assert.equal(constraintIndexFor({ kind: "dlmm", pool }, TOKEN_PROGRAM_ID, Uint8Array.of(12, 0, 0, 0, 0, 0, 0, 0, 0, 9)), 1);
  assert.equal(constraintIndexFor({ kind: "dlmm", pool }, TOKEN_PROGRAM_ID, Uint8Array.of(3, 0, 0, 0, 0, 0, 0, 0, 0)), null);
  assert.equal(constraintIndexFor({ kind: "dlmm", pool }, DLMM_PROGRAM_ID, Uint8Array.of(248, 198, 158, 145, 225, 117, 135, 200)), null);
  assert.equal(constraintIndexFor({ kind: "jupiter" }, JUPITER_PROGRAM_ID, SHARED_ACCOUNTS_ROUTE_V2), 1);
});

/* ------------------------------------------------------------------ the rules, on a real Jupiter route */

test("on a real route the honest buy keeps every rule; the fork's attacks break one each", () => {
  const terms = jupiterTerms();
  const [rule] = mandatePolicy(terms, { vault: VAULT, budgetAccount: BUDGET }).constraints;
  assert.equal(instructionRefusal(swapOf(), rule, FACTS), null);
  assert.match(instructionRefusal(swapOf((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: ATTACKER_USDC })), rule, FACTS), /account 7/);
  assert.match(instructionRefusal(swapOf((ix) => setU64(ix.data, 8, 900_000_000n)), rule, FACTS), /number at 8/);
  assert.match(instructionRefusal(swapOf((ix) => setU16(ix.data, 24, 1_000)), rule, FACTS), /number at 24/);
  assert.match(instructionRefusal(swapOf((ix) => (ix.keys[1] = { ...ix.keys[1], pubkey: ATTACKER_USDC })), rule, FACTS), /account 1/);
  assert.match(instructionRefusal(swapOf((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: K("So11111111111111111111111111111111111111112") })), rule, FACTS), /could not be read/);
  /* Ryntra's fee goes to Ryntra's account and no other, at most the table's highest rate. */
  assert.match(instructionRefusal(swapOf((ix) => (ix.keys[10] = { ...ix.keys[10], pubkey: ATTACKER_WSOL })), rule, FACTS), /account 10/);
  assert.match(instructionRefusal(swapOf((ix) => setU16(ix.data, 26, 101)), rule, FACTS), /number at 26/);
  assert.equal(instructionRefusal(swapOf((ix) => setU16(ix.data, 26, 100)), rule, FACTS), null);
  /* Without a floor the price is not held: minimum 1 passes (the risk decision 95 (a) accepts, bounded by the day's cap). */
  assert.equal(instructionRefusal(swapOf((ix) => setU64(ix.data, 16, 1n)), rule, FACTS), null);
});

test("with a regular buy's floor, the minimum-1 attack is refused and the honest buy passes", () => {
  const terms = jupiterTerms({ fixedBuy: { amountIn: 500_000_000n, outputMint: USDC, minOut: 45_000_000n } });
  const [rule] = mandatePolicy(terms, { vault: VAULT, budgetAccount: BUDGET }).constraints;
  assert.equal(instructionRefusal(swapOf(), rule, FACTS), null);
  assert.match(instructionRefusal(swapOf((ix) => setU64(ix.data, 16, 1n)), rule, FACTS), /number at 16/);
  assert.match(instructionRefusal(swapOf((ix) => setU64(ix.data, 8, 400_000_000n)), rule, FACTS), /number at 8/);
  /* Her own account of another mint: the pinned mint refuses it. */
  assert.match(instructionRefusal(swapOf((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: getAssociatedTokenAddressSync(ATTACKER, HUMAN) })), rule, FACTS), /account 7/);
});

/* ------------------------------------------------------------------ the person's transactions */

const config = { smartAccountIndex: 597_750n, creationFee: 0n, treasury: K("BrQAbGdWQ9YUHmWWgKFdFe4miTURH71jkYFPXfaosqDv") };

test("turning the agent on is one approval of the person's wallet: two packets when her smart account is new, each a mandate transaction", () => {
  const pool = K("2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7");
  const tRyn = K("9oAzLLVTTHDW587KyoHK5L5fmU9aDCcR1t3GoeycH1ne");
  const cases = [
    /* With Ryntra's fee rule the devnet policy no longer fits beside a new smart account (CITY-183): 674 + 850 bytes. */
    { name: "devnet DLMM", terms: { ...jupiterTerms(), venue: { kind: "dlmm", pool } }, receive: [tRyn], count: 2 },
    { name: "Jupiter", terms: jupiterTerms(), receive: [], count: 2 },
    { name: "Jupiter regular buy", terms: jupiterTerms({ fixedBuy: { amountIn: 500_000_000n, outputMint: USDC, minOut: 45_000_000n } }), receive: [], count: 2 },
  ];
  for (const c of cases) {
    const plan = planEnable({ cluster: "devnet", terms: c.terms, account: { kind: "absent", config }, fund: 250_000_000n, nowSeconds: NOW, receiveMints: c.receive, agentFeeLamports: 10_000_000n });
    assert.equal(plan.transactions.length, c.count, c.name);
    for (const instructions of plan.transactions) {
      const tx = unsignedTransaction(HUMAN, instructions, BLOCKHASH);
      assert.equal(tx.message.header.numRequiredSignatures, 1, c.name);
      assert.ok(tx.message.staticAccountKeys[0].equals(HUMAN), c.name);
      assert.ok(wireSize(tx) <= MAX_TRANSACTION_BYTES, `${c.name}: ${wireSize(tx)} bytes`);
      /* The window signs only transactions that call her smart account (`city/lib/bots/mandate-check.ts`). */
      assert.ok(instructions.some((ix) => ix.programId.equals(SSA_PROGRAM_ID)), c.name);
    }
    assert.ok(plan.transactions[0][0].programId.equals(SSA_PROGRAM_ID), c.name);
    /* The policy comes last: its settings exist by the time it lands. */
    assert.equal(plan.transactions.at(-1).at(-1).data[13], 7, c.name);
    const settings = ssaAddress.settings(config.smartAccountIndex + 1n);
    assert.ok(plan.mandate.settings.equals(settings));
    assert.ok(plan.mandate.policy.equals(ssaAddress.policy(settings, 1n)));
    assert.ok(plan.mandate.budgetAccount.equals(tokenAccountOf(plan.mandate.vault, NATIVE_MINT)));
  }
});

test("on a smart account she already has, the next policy seed is used and her sole control is required", () => {
  const settings = K("3SH5NF7iMYLrfu9TfuCUXaVxXhe9E4bzH6Dzz8aYRx7n");
  const state = { signers: [{ key: HUMAN, permissions: 7 }], threshold: 1, timeLock: 0, policySeed: 2n };
  /* The window's devnet stand: on her own smart account the budget, her coin's account and the policy fit one transaction. */
  const devnet = { ...jupiterTerms(), venue: { kind: "dlmm", pool: K("2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7") } };
  const plan = planEnable({ cluster: "devnet", terms: devnet, account: { kind: "present", settings, state }, fund: 250_000_000n, nowSeconds: NOW, receiveMints: [K("9oAzLLVTTHDW587KyoHK5L5fmU9aDCcR1t3GoeycH1ne")], agentFeeLamports: 10_000_000n });
  assert.equal(plan.mandate.policySeed, 3n);
  assert.equal(plan.transactions.length, 1);
  assert.ok(plan.transactions[0].every((ix) => !ix.data.subarray(0, 8).equals(Buffer.from([197, 102, 253, 231, 77, 84, 50, 17]))));
  assert.throws(() => planEnable({ cluster: "devnet", terms: jupiterTerms(), account: { kind: "present", settings, state: { ...state, threshold: 2 } }, fund: 0n, nowSeconds: NOW }), /alone/);
  assert.throws(() => planEnable({ cluster: "devnet", terms: jupiterTerms({ slippageBps: 500 }), account: { kind: "present", settings, state }, fund: 0n, nowSeconds: NOW }), /not written/);
});

test("stop is the policy removed with its rent back to her; withdraw unwraps the rest straight to her wallet", () => {
  const plan = planEnable({ cluster: "devnet", terms: jupiterTerms(), account: { kind: "absent", config }, fund: 1n, nowSeconds: NOW });
  const [stop] = planStop(plan.mandate);
  assert.ok(stop.keys[1].pubkey.equals(HUMAN) && stop.keys[1].isSigner);
  assert.ok(stop.keys.some((k) => k.pubkey.equals(plan.mandate.policy) && k.isWritable));
  assert.equal(stop.data[13], 9); // SettingsAction::PolicyRemove
  const withdraw = planWithdraw(plan.mandate, 123n);
  assert.equal(withdraw.length, 1);
  assert.deepEqual(withdraw[0].keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [HUMAN.toBase58()]);
  const usdc = planEnable({ cluster: "mainnet", terms: { ...jupiterTerms(), budgetMint: USDC, perTrade: 10_000_000n, perDay: 50_000_000n }, account: { kind: "absent", config }, fund: 1n, nowSeconds: NOW });
  assert.equal(planWithdraw(usdc.mandate, 5n).length, 2);
  const both = unsignedTransaction(HUMAN, planStopAndWithdraw(plan.mandate, 0n), BLOCKHASH);
  assert.equal(both.message.header.numRequiredSignatures, 1);
});

/* ------------------------------------------------------------------ the agent's trade and its signer */

function jupiterMandate(extra = {}) {
  const terms = jupiterTerms(extra);
  return { cluster: "devnet", terms, settings: K("3SH5NF7iMYLrfu9TfuCUXaVxXhe9E4bzH6Dzz8aYRx7n"), vault: VAULT, policy: K("29fL4E8eBR62Rf9CHBYvgSv9Nk63JVJ8kLnF7DQThuUf"), policySeed: 1n, budgetAccount: BUDGET };
}

const ALT_KEY = K(Object.keys(route.addressesByLookupTableAddress)[0]);
const ALT = new AddressLookupTableAccount({ key: ALT_KEY, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: route.addressesByLookupTableAddress[ALT_KEY.toBase58()].map(K) } });

function tradeMessage(mandate, mutate = (ix) => ix, extra = []) {
  const instructions = agentTradeInstructions({ mandate, venueInstruction: mutate(apiInstruction(route.swapInstruction)), holding: 0n, setup: route.setupInstructions.map(apiInstruction) });
  return { instructions, tx: unsignedTransaction(AGENT, [...instructions, ...extra], BLOCKHASH, [ALT]) };
}

const PROMISED = BigInt(route.outAmount);

test("every agent trade carries a 1.4 M compute limit and a 256 KB heap, and only an instruction the mandate allows", () => {
  const { instructions, tx } = tradeMessage(jupiterMandate());
  assert.ok(instructions[0].programId.equals(ComputeBudgetProgram.programId) && instructions[0].data.readUInt32LE(1) === AGENT_COMPUTE_UNIT_LIMIT);
  assert.ok(instructions[1].data[0] === 1 && instructions[1].data.readUInt32LE(1) === AGENT_HEAP_BYTES);
  assert.ok(wireSize(tx) <= MAX_TRANSACTION_BYTES, `${wireSize(tx)} bytes`);
  const execution = instructions.at(-2);
  const exec = readPolicyExecute({ programId: SSA_PROGRAM_ID, keys: execution.keys.map((k) => k.pubkey), data: execution.data });
  assert.deepEqual(exec.constraintIndices, [0]);
  assert.ok(exec.instructions[0].programId.equals(JUPITER_PROGRAM_ID));
  assert.ok(tradeAccounts(instructions).some((k) => k.equals(HUMAN_USDC)));
  assert.throws(() => agentTradeInstructions({ mandate: jupiterMandate(), venueInstruction: SystemProgram.transfer({ fromPubkey: VAULT, toPubkey: ATTACKER, lamports: 1 }), holding: 0n }), /not one the mandate allows/);
});

/* ------------------------------------------------------------------ the money reaches the person, or nothing happened */

test("the rule's bytes are the program's own: AssertTokenAccount, silent, Amount, at least", () => {
  /* The same bytes as `lighthouse-sdk` 2.1.0's `getAssertTokenAccountInstructionDataEncoder`; the fork runs them on the program itself. */
  const rule = receivedAtLeastInstruction(HUMAN_USDC, 47_000_000n);
  assert.ok(rule.programId.equals(LIGHTHOUSE_PROGRAM_ID));
  assert.equal(rule.data.toString("hex"), "0900" + "02" + "c029cd0200000000" + "04");
  assert.deepEqual(rule.keys, [{ pubkey: HUMAN_USDC, isSigner: false, isWritable: false }]);
  const read = readReceivedAtLeast(rule);
  assert.ok(read.account.equals(HUMAN_USDC));
  assert.equal(read.amount, 47_000_000n);
  const bent = (at, value) => {
    const data = Buffer.from(rule.data);
    data[at] = value;
    return readReceivedAtLeast({ programId: rule.programId, keys: rule.keys, data });
  };
  assert.equal(bent(0, 8), null, "another instruction");
  assert.equal(bent(2, 1), null, "another assertion");
  assert.equal(bent(11, 5), null, "at most instead of at least");
  assert.equal(readReceivedAtLeast({ programId: SSA_PROGRAM_ID, keys: rule.keys, data: rule.data }), null);
});

test("what a venue instruction says of the trade is read from its own bytes", () => {
  const swap = apiInstruction(route.swapInstruction);
  const terms = tradeTerms({ programId: swap.programId, accounts: swap.keys.map((k) => k.pubkey), data: swap.data });
  assert.ok(terms.receiver.equals(HUMAN_USDC));
  assert.equal(terms.amountIn, 500_000_000n);
  assert.equal(terms.minOut, (swap.data.readBigUInt64LE(16) * BigInt(10_000 - swap.data.readUInt16LE(24))) / 10_000n);
  assert.equal(tradeTerms({ programId: SSA_PROGRAM_ID, accounts: [], data: swap.data }), null);
  assert.equal(tradeTerms({ programId: JUPITER_PROGRAM_ID, accounts: [], data: Uint8Array.of(1, 2, 3) }), null);
  assert.equal(tradeTerms({ programId: JUPITER_PROGRAM_ID, accounts: [], data: swap.data }), null, "no receiver");
  assert.equal(heldIn(undefined), 0n);
  const held = tokenData(USDC, HUMAN);
  new DataView(held.buffer).setBigUint64(64, 77n, true);
  assert.equal(heldIn(held), 77n);
});

test("every agent trade ends with the rule: her account holds what it held plus the trade's minimum", () => {
  const swap = apiInstruction(route.swapInstruction);
  const minOut = tradeTerms({ programId: swap.programId, accounts: swap.keys.map((k) => k.pubkey), data: swap.data }).minOut;
  const instructions = agentTradeInstructions({ mandate: jupiterMandate(), venueInstruction: swap, holding: 1_000n });
  const rule = readReceivedAtLeast(instructions.at(-1));
  assert.ok(rule.account.equals(HUMAN_USDC));
  assert.equal(rule.amount, 1_000n + minOut);
  assert.ok(instructions.at(-2).programId.equals(SSA_PROGRAM_ID), "the rule runs after the trade");
  const noFloor = apiInstruction(route.swapInstruction);
  noFloor.data.writeBigUInt64LE(0n, 16);
  assert.throws(() => agentTradeInstructions({ mandate: jupiterMandate(), venueInstruction: noFloor, holding: 0n }), /no minimum/);
});

test("the agent's signer refuses a trade without the rule, or with a rule that asks too little", () => {
  const mandate = jupiterMandate();
  const policy = policyOf(mandate);
  const request = { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES };
  const judged = (instructions, asked = request) => tradeRefusal(unsignedTransaction(AGENT, instructions, BLOCKHASH, [ALT]).message.serialize(), mandate, policy, asked);
  const { instructions } = tradeMessage(mandate);
  const trade = instructions.slice(0, -1);
  const rule = readReceivedAtLeast(instructions.at(-1));
  assert.equal(judged(instructions), null);
  assert.match(judged(trade), /one rule on what reached/);
  assert.match(judged([...trade.slice(0, -1), instructions.at(-1), trade.at(-1)]), /before the trade/);
  assert.match(judged([...trade, instructions.at(-1), instructions.at(-1)]) ?? "", /not exactly one rule/);
  assert.match(judged([...trade, receivedAtLeastInstruction(ATTACKER_USDC, rule.amount)]), /another account/);
  assert.match(judged([...trade, receivedAtLeastInstruction(rule.account, rule.amount - 1n)]), /less than the trade's minimum/);
  /* Her account already holds 500: a rule from zero asks nothing of this trade. */
  const holding = tokenData(USDC, HUMAN);
  new DataView(holding.buffer).setBigUint64(64, 500n, true);
  const heldFacts = new Map(FACTS).set(HUMAN_USDC.toBase58(), { owner: TOKEN_PROGRAM_ID, data: holding });
  assert.match(judged(instructions, { ...request, facts: heldFacts }), /less than the trade's minimum/);
  const other = new TransactionInstruction({ programId: LIGHTHOUSE_PROGRAM_ID, keys: instructions.at(-1).keys, data: Buffer.from(instructions.at(-1).data).fill(5, 11) });
  assert.match(judged([...trade, other]), /other than what reached/);
});

test("the signer holds the minimum to the promise: a minimum of 1, or under the quote less slippage, is not signed", () => {
  const mandate = jupiterMandate();
  const policy = policyOf(mandate);
  const request = { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES };
  const bytes = (tx) => tx.message.serialize();
  assert.match(tradeRefusal(bytes(tradeMessage(mandate, (ix) => (ix.data.writeBigUInt64LE(2n, 16), ix)).tx), mandate, policy, request), /under what the person was promised/);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate).tx), mandate, policy, { ...request, promisedOut: PROMISED * 2n }), /under what the person was promised/);
  /* The route says 0.5 % slippage: its quote just high enough that the minimum is the promise less the mandate's 1 %. */
  const ceil = (a, b) => (a + b - 1n) / b;
  const edge = ceil(((PROMISED * 9_900n) / 10_000n) * 10_000n, 9_950n);
  assert.equal(tradeRefusal(bytes(tradeMessage(mandate, (ix) => (ix.data.writeBigUInt64LE(edge, 16), ix)).tx), mandate, policy, request), null);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate, (ix) => (ix.data.writeBigUInt64LE(edge - 2n, 16), ix)).tx), mandate, policy, request), /under what the person was promised/);
});

test("a token account the trade itself opens is judged as it will be: the person's passes, one of another program than its coin's does not", () => {
  const mandate = jupiterMandate();
  const policy = policyOf(mandate);
  const absent = new Map(FACTS);
  absent.delete(HUMAN_USDC.toBase58());
  const open = createAssociatedTokenAccountIdempotentInstruction(AGENT, HUMAN_USDC, HUMAN, USDC);
  const venueInstruction = apiInstruction(route.swapInstruction);
  const judged = (setup) => tradeRefusal(unsignedTransaction(AGENT, agentTradeInstructions({ mandate, venueInstruction, holding: 0n, setup }), BLOCKHASH, [ALT]).message.serialize(), mandate, policy, { lookupTables: [ALT], facts: absent, promisedOut: PROMISED, feeSides: SIDES });
  assert.match(judged([]), /account 7 could not be read/);
  assert.equal(judged([open]), null);
  const token2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const receiver2022 = getAssociatedTokenAddressSync(USDC, HUMAN, true, token2022);
  const swap2022 = apiInstruction(route.swapInstruction);
  swap2022.keys[7] = { ...swap2022.keys[7], pubkey: receiver2022 };
  const judged2022 = (facts) => tradeRefusal(unsignedTransaction(AGENT, agentTradeInstructions({ mandate, venueInstruction: swap2022, holding: 0n, setup: [createAssociatedTokenAccountIdempotentInstruction(AGENT, receiver2022, HUMAN, USDC, token2022)] }), BLOCKHASH, [ALT]).message.serialize(), mandate, policy, { lookupTables: [ALT], facts, promisedOut: PROMISED, feeSides: SIDES });
  /* CITY-184: the chain takes a token account of either program; the signer reads the coin from its mint. */
  assert.match(judged2022(absent), /coin's mint could not be read/);
  const usdcMint = { owner: TOKEN_PROGRAM_ID, data: Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : 0)) };
  assert.match(judged2022(new Map(absent).set(USDC.toBase58(), usdcMint)), /not of its coin's program/);
});

test("the program's refusals keep their names: the venue's minimum and the rule in the trade", () => {
  const failed = (program) => [`Program ${program} failed: custom program error: 0x1771`, "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG failed: custom program error: 0x1771"];
  assert.equal(refusalOf(failed("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")).code, "SlippageToleranceExceeded");
  assert.equal(refusalOf(["Program L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 failed: custom program error: 0x1771"]).code, "ReceivedTooLittle");
  assert.equal(refusalOf(["Program log: Error Code: ExceededAmountSlippageTolerance. Error Number: 6003."]).code, "ExceededAmountSlippageTolerance");
  assert.equal(refusalOf(["Program log: fine"]), null);
});

test("the agent's signer reads the bytes again: it passes the honest trade and refuses each way out of the mandate", () => {
  const mandate = jupiterMandate();
  const policy = policyOf(mandate);
  const request = { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES };
  const bytes = (tx) => tx.message.serialize();
  assert.equal(tradeRefusal(bytes(tradeMessage(mandate).tx), mandate, policy, request), null);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate, (ix) => ((ix.keys[7] = { ...ix.keys[7], pubkey: ATTACKER_USDC }), ix)).tx), mandate, policy, request), /account 7/);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate, (ix) => (ix.data.writeBigUInt64LE(900_000_000n, 8), ix)).tx), mandate, policy, request), /number at 8/);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate, (ix) => ix, [SystemProgram.transfer({ fromPubkey: AGENT, toPubkey: ATTACKER, lamports: 1 })]).tx), mandate, policy, request), /outside the mandate/);
  assert.match(tradeRefusal(bytes(tradeMessage({ ...mandate, policy: K("BrQAbGdWQ9YUHmWWgKFdFe4miTURH71jkYFPXfaosqDv") }).tx), mandate, policy, request), /another policy/);
  assert.match(tradeRefusal(bytes(tradeMessage(mandate).tx), mandate, policy, { facts: FACTS, promisedOut: PROMISED, feeSides: SIDES }), /lookup tables/);
  const otherPayer = unsignedTransaction(HUMAN, tradeMessage(mandate).instructions, BLOCKHASH, [ALT]);
  assert.match(tradeRefusal(bytes(otherPayer), mandate, policy, request), /pay|only signer/);
  const greedy = unsignedTransaction(AGENT, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000n }), ...tradeMessage(mandate).instructions], BLOCKHASH, [ALT]);
  assert.match(tradeRefusal(bytes(greedy), mandate, policy, request), /compute-budget/);
  assert.match(tradeRefusal(Uint8Array.of(1, 2, 3), mandate, policy, request), /not a transaction message/);
});

test("the agent's signer holds Ryntra's fee to the table: the pair's rate, Ryntra's account, no positive slippage", () => {
  const mandate = jupiterMandate();
  const policy = policyOf(mandate);
  const request = { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES };
  const bytes = (tx) => tx.message.serialize();
  const judged = (mutate, asked = request) => tradeRefusal(bytes(tradeMessage(mandate, (ix) => (mutate(ix), ix)).tx), mandate, policy, asked);
  assert.equal(judged(() => undefined), null);
  /* Another rate than the table's for this pair — under the chain's ceiling, so the signer is the one who says no. */
  assert.match(judged((ix) => ix.data.writeUInt16LE(50, 26)), /not the table's rate/);
  /* The rate is the signer's own reading of the pair: USDC is a dollar by its mint, whatever facts the caller hands in. */
  const meme = { mint: USDC.toBase58(), verified: false, tags: [], firstPoolAt: null };
  assert.equal(judged(() => undefined, { ...request, feeSides: { ...SIDES, output: meme } }), null);
  assert.match(judged((ix) => ix.data.writeUInt16LE(100, 26), { ...request, feeSides: { ...SIDES, output: meme } }), /not the table's rate/);
  /* A coin the table cannot price — its facts unread or of another mint — is not an agent trade. */
  const unknown = getAssociatedTokenAddressSync(ATTACKER, HUMAN);
  const unknownFacts = new Map(FACTS).set(unknown.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(ATTACKER, HUMAN) });
  const toUnknown = (ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: unknown });
  assert.match(judged(toUnknown, { ...request, facts: unknownFacts }), /names no router fee/);
  assert.match(judged(toUnknown, { ...request, facts: unknownFacts, feeSides: { ...SIDES, output: { ...meme, mint: K("So11111111111111111111111111111111111111112").toBase58() } } }), /names no router fee/);
  /* Its own facts make it the table's MEME: 1 %, so the route's 0.1 % is refused, its 1 % signed. */
  const coin = { mint: ATTACKER.toBase58(), verified: false, tags: [], firstPoolAt: null };
  assert.match(judged(toUnknown, { ...request, facts: unknownFacts, feeSides: { ...SIDES, output: coin } }), /not the table's rate/);
  assert.equal(judged((ix) => (toUnknown(ix), ix.data.writeUInt16LE(100, 26)), { ...request, facts: unknownFacts, feeSides: { ...SIDES, output: coin } }), null);
  assert.match(judged((ix) => ix.data.writeUInt16LE(0, 26)), /carries no Ryntra fee/);
  assert.match(judged((ix) => ix.data.writeUInt16LE(30, 28)), /positive slippage/);
  /* Another receiver of the fee: the policy's own rule refuses it before the fee check. */
  assert.match(judged((ix) => (ix.keys[10] = { ...ix.keys[10], pubkey: ATTACKER_WSOL })), /account 10/);
  assert.match(judged((ix) => (ix.keys[10] = { ...ix.keys[10], pubkey: agentFeeAccount(USDC) })), /account 10/);
});

test("the signer signs only what it passed, writes every answer down, and gives no signature its journal could not keep", async () => {
  const pair = Keypair.generate();
  const key = envKey(JSON.stringify([...pair.secretKey]));
  const mandate = { ...jupiterMandate(), terms: { ...jupiterTerms(), agent: pair.publicKey } };
  const rows = [];
  const signer = mandateSigner(key.signer, { mandate, policy: policyOf(mandate), journal: async (row) => void rows.push(row), screen: OPEN_SCREEN, now: () => new Date("2026-11-01T00:00:00Z") });
  const tx = unsignedTransaction(pair.publicKey, agentTradeInstructions({ mandate, venueInstruction: apiInstruction(route.swapInstruction), holding: 0n }), BLOCKHASH, [ALT]);
  const message = tx.message.serialize();
  const signature = await signer.signMessage(message, { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES });
  assert.equal(signature.length, 64);
  tx.addSignature(pair.publicKey, signature);
  assert.ok(VersionedMessage.deserialize(tx.message.serialize()));
  assert.deepEqual(rows.map((r) => [r.outcome, r.policy, r.role, r.mode]), [["SIGNED", mandate.policy.toBase58(), "agent", "env"]]);
  assert.ok(!JSON.stringify(rows).includes(Buffer.from(pair.secretKey).toString("hex")));

  const attack = unsignedTransaction(pair.publicKey, agentTradeInstructions({ mandate, holding: 0n, venueInstruction: (() => { const ix = apiInstruction(route.swapInstruction); ix.keys[7] = { ...ix.keys[7], pubkey: ATTACKER_USDC }; return ix; })() }), BLOCKHASH, [ALT]);
  await assert.rejects(signer.signMessage(attack.message.serialize(), { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES }), AgentSignerRefused);
  assert.equal(rows.at(-1).outcome, "REFUSED");
  assert.equal(rows.at(-1).signature, null);

  const blind = mandateSigner(key.signer, { mandate, policy: policyOf(mandate), journal: NO_AGENT_JOURNAL, screen: OPEN_SCREEN });
  await assert.rejects(blind.signMessage(message, { lookupTables: [ALT], facts: FACTS, promisedOut: PROMISED, feeSides: SIDES }), /journal/);
});

/* ------------------------------------------------------------------ CITY-196: no coin of Ryntra's, no key of Ryntra's */

test("CITY-196: the agent's key refuses a coin of Ryntra's launchpad, the person's own coin, another key of Ryntra's in the trade, and an unread registry", async () => {
  const pair = Keypair.generate();
  let asked = 0;
  const key = { mode: "env", keyRef: null, publicKey: pair.publicKey, sign: async (bytes) => { asked += 1; return envKey(JSON.stringify([...pair.secretKey])).signer.sign(bytes); } };
  const mandate = { ...jupiterMandate(), terms: { ...jupiterTerms(), agent: pair.publicKey } };
  const tx = unsignedTransaction(pair.publicKey, agentTradeInstructions({ mandate, venueInstruction: apiInstruction(route.swapInstruction), holding: 0n }), BLOCKHASH, [ALT]);
  const message = tx.message.serialize();
  const request = (facts = FACTS) => ({ lookupTables: [ALT], facts, promisedOut: PROMISED, feeSides: SIDES });
  const rows = [];
  const signWith = (screen, facts) => mandateSigner(key, { mandate, policy: policyOf(mandate), journal: async (row) => void rows.push(row), screen }).signMessage(message, request(facts));
  const screen = (origin, ryntra = []) => ({ origin: async (mint) => (mint === USDC.toBase58() ? origin : { launchedHere: false, creator: null }), ryntra: async () => new Set(ryntra) });
  const refused = async (promise, reason) => {
    await assert.rejects(promise, (error) => error instanceof AgentSignerRefused && reason.test(error.reason));
    assert.equal(rows.at(-1).outcome, "REFUSED");
    assert.equal(rows.at(-1).signature, null);
  };

  /* A coin launched on Ryntra — by anyone: the key is never asked. */
  await refused(signWith(screen({ launchedHere: true, creator: ATTACKER.toBase58() })), /launched on Ryntra/);
  /* The person's own launch. */
  await refused(signWith(screen({ launchedHere: true, creator: HUMAN.toBase58() })), /person's own launch/);
  /* A coin whose mint authority is the person, or a key of Ryntra's — read from the mint's own bytes. */
  const mintOf = (authority) => {
    const data = new Uint8Array(82);
    new DataView(data.buffer).setUint32(0, 1, true);
    data.set(authority.toBytes(), 4);
    data[45] = 1;
    return { owner: TOKEN_PROGRAM_ID, data };
  };
  await refused(signWith(OPEN_SCREEN, new Map([...FACTS, [USDC.toBase58(), mintOf(HUMAN)]])), /person's own/);
  const EXECUTOR = Keypair.generate().publicKey;
  await refused(signWith(screen({ launchedHere: false, creator: null }, [EXECUTOR.toBase58()]), new Map([...FACTS, [USDC.toBase58(), mintOf(EXECUTOR)]])), /Ryntra's own/);
  /* Another key of Ryntra's — another agent's vault, the executor — standing in the route, or owning a token account in it. */
  const POOL_ACCOUNT = K(route.swapInstruction.accounts[16].pubkey);
  await refused(signWith(screen({ launchedHere: false, creator: null }, [POOL_ACCOUNT.toBase58()])), /another key of Ryntra's/);
  const OTHER_VAULT = Keypair.generate().publicKey;
  await refused(signWith(screen({ launchedHere: false, creator: null }, [OTHER_VAULT.toBase58()]), new Map([...FACTS, [POOL_ACCOUNT.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(USDC, OTHER_VAULT) }]])), /token account of another key of Ryntra's/);
  /* The registry not read: refused, never a pass. */
  await refused(signWith({ origin: async () => { throw new Error("store down"); }, ryntra: async () => new Set() }), /registry did not answer/);
  await refused(signWith({ origin: async () => ({ launchedHere: false, creator: null }), ryntra: async () => { throw new Error("store down"); } }), /registry did not answer/);
  assert.equal(asked, 0, "the key is never asked for a refused trade");

  /* Its own accounts are not "another key": the vault, the person, Ryntra's fee account — the same trade signs. */
  const own = [mandate.vault, HUMAN, FEE_WSOL, mandate.budgetAccount, pair.publicKey].map((k) => k.toBase58());
  const signature = await signWith(screen({ launchedHere: false, creator: null }, own));
  assert.equal(signature.length, 64);
  assert.equal(asked, 1);
  assert.equal(rows.at(-1).outcome, "SIGNED");
});

test("CITY-196: the store's screen reads Launch's own record, the registry's keys, the internal wallets and every agent's vault — and throws when it cannot", async () => {
  const store = createMemoryGuardStore();
  const launched = Keypair.generate().publicKey.toBase58();
  await store.collection("launches").set(`solana:mainnet:${launched}`, { state: "PENDING", creator: HUMAN.toBase58(), token: launched });
  const screen = storeScreen(store, "mainnet", {});
  assert.deepEqual(await screen.origin(launched), { launchedHere: true, creator: HUMAN.toBase58() });
  assert.deepEqual(await screen.origin(USDC.toBase58()), { launchedHere: false, creator: null });
  /* Another network's launch is not this one's. */
  assert.deepEqual(await storeScreen(store, "devnet", {}).origin(launched), { launchedHere: false, creator: null });

  const otherVault = Keypair.generate().publicKey.toBase58();
  const otherBudget = Keypair.generate().publicKey.toBase58();
  await store.collection("agentMandates").set(`m:mainnet:${Keypair.generate().publicKey.toBase58()}`, { v: 1, record: { vault: otherVault, budget: otherBudget } });
  const internal = Keypair.generate().publicKey.toBase58();
  const ryntra = await storeScreen(store, "mainnet", { RYNTRA_INTERNAL_WALLETS: internal }).ryntra();
  for (const address of [otherVault, otherBudget, internal]) assert.ok(ryntra.has(address), address);
  const executor = ATTRIBUTION_REGISTRY.find((row) => row.role === "LAUNCH_EXECUTOR" && row.end === null).address;
  const agent = ATTRIBUTION_REGISTRY.find((row) => row.role === "AGENT_SIGNER").address;
  const treasuryLike = ATTRIBUTION_REGISTRY.filter((row) => row.role.startsWith("PAYOUT_") && row.address).map((row) => row.address);
  for (const address of [executor, agent, ...treasuryLike]) assert.ok(ryntra.has(address), address);
  /* Fee wallets are where the fee lands, not a counterparty: never on the list. */
  const fees = ATTRIBUTION_REGISTRY.filter((row) => row.role === "FEE" && row.address).map((row) => row.address);
  for (const address of fees) assert.ok(!registryKeys().includes(address), address);

  const broken = { ...store, collection: (name) => (name === "launches" || name === "adminInternalWallets" ? { get: async () => { throw new Error("down"); }, valuesWithPrefix: async () => { throw new Error("down"); } } : store.collection(name)) };
  await assert.rejects(storeScreen(broken, "mainnet", {}).origin(launched));
  await assert.rejects(storeScreen(broken, "mainnet", {}).ryntra(), /internal wallets/);
});

/* ------------------------------------------------------------------ Jupiter's /build, for the vault */

test("the agent asks /build for the vault as taker, its own fee payer, the person's account and 40–50 accounts", () => {
  const fee = { bps: FEE_BPS, account: FEE_WSOL };
  const query = agentRouteQuery({ inputMint: NATIVE_MINT, outputMint: USDC, amount: 500_000_000n, vault: VAULT, agent: AGENT, receiver: HUMAN_USDC, slippageBps: 100, fee });
  assert.equal(query.get("platformFeeBps"), "10");
  assert.equal(query.get("feeAccount"), FEE_WSOL.toBase58());
  assert.throws(() => agentRouteQuery({ inputMint: NATIVE_MINT, outputMint: USDC, amount: 1n, vault: VAULT, agent: AGENT, receiver: HUMAN_USDC, slippageBps: 100, fee: { ...fee, bps: 0 } }), /fee/);
  assert.equal(query.get("taker"), VAULT.toBase58());
  assert.equal(query.get("payer"), AGENT.toBase58());
  assert.equal(query.get("destinationTokenAccount"), HUMAN_USDC.toBase58());
  assert.equal(query.get("wrapAndUnwrapSol"), "false");
  assert.equal(query.get("maxAccounts"), "48");
  // CITY-201: Manifest writes to its taker, which Jupiter lists read-only — the vault's route never goes through it.
  assert.equal(query.get("excludeDexes"), "Manifest");
  assert.throws(() => agentRouteQuery({ inputMint: NATIVE_MINT, outputMint: USDC, amount: 1n, vault: VAULT, agent: AGENT, receiver: HUMAN_USDC, slippageBps: 100, fee, maxAccounts: 64 }), /40–50/);
  assert.throws(() => agentRouteQuery({ inputMint: NATIVE_MINT, outputMint: USDC, amount: 1n, vault: VAULT, agent: AGENT, receiver: HUMAN_USDC, slippageBps: 300, fee }), /1 %/);
});

test("/build's answer is read and bounded against the request", () => {
  const request = { inputMint: NATIVE_MINT, outputMint: USDC, amount: 500_000_000n, vault: VAULT, agent: AGENT, receiver: HUMAN_USDC, slippageBps: 100, fee: { bps: FEE_BPS, account: FEE_WSOL } };
  const read = readAgentRoute(route, request);
  assert.equal(read.setup.length, 2);
  assert.equal(read.lookupTableAddresses.length, 1);
  assert.equal(read.inAmount, 500_000_000n);
  assert.throws(() => readAgentRoute(route, { ...request, amount: 1n }), /amount/);
  assert.throws(() => readAgentRoute(route, { ...request, vault: ATTACKER }), /authority/);
  assert.throws(() => readAgentRoute(route, { ...request, receiver: ATTACKER_USDC }), /person's account/);
  assert.throws(() => readAgentRoute(route, { ...request, agent: ATTACKER }), /does not pay/);
  assert.throws(() => readAgentRoute(route, { ...request, slippageBps: 10 }), /slippage/);
  assert.throws(() => readAgentRoute(route, { ...request, fee: { ...request.fee, bps: 50 } }), /Ryntra's fee/);
  assert.throws(() => readAgentRoute(route, { ...request, fee: { ...request.fee, account: ATTACKER_WSOL } }), /Ryntra's fee/);
  assert.throws(() => readAgentRoute({ ...route, tipInstruction: route.setupInstructions[0] }, request), /tipInstruction/);
  assert.throws(() => readAgentRoute({ ...route, swapInstruction: { ...route.swapInstruction, programId: SystemProgram.programId.toBase58() } }, request), /Jupiter route/);
});

/* ------------------------------------------------------------------ the regular buy */

test("a regular buy's floor comes from the person's highest price, rounded so it never lets a cent more", () => {
  /* 0.5 SOL at most 0.0105 SOL per USDC → at least 47.619048 USDC. */
  assert.equal(floorFor({ amountIn: 500_000_000n, budgetDecimals: 9, outputDecimals: 6, maxPrice: "0.0105" }), 47_619_048n);
  /* 0.05 SOL at most 0.001 SOL per tRYN → at least 50 tRYN. */
  assert.equal(floorFor({ amountIn: 50_000_000n, budgetDecimals: 9, outputDecimals: 6, maxPrice: "0.001" }), 50_000_000n);
  assert.throws(() => floorFor({ amountIn: 1n, budgetDecimals: 9, outputDecimals: 6, maxPrice: "0" }), /above zero/);
  assert.throws(() => floorFor({ amountIn: 1n, budgetDecimals: 9, outputDecimals: 6, maxPrice: "1e3" }), /decimal/);
  const buy = { amountIn: 50_000_000n, outputMint: USDC, minOut: 49_000_000n };
  assert.deepEqual(buyTick({ buy, quoteOut: 49_500_000n, spentToday: 0n, perDay: 100_000_000n }), { action: "buy", minOut: 49_000_000n });
  assert.deepEqual(buyTick({ buy, quoteOut: 48_000_000n, spentToday: 0n, perDay: 100_000_000n }), { action: "wait", reason: "price-above-ceiling" });
  assert.deepEqual(buyTick({ buy, quoteOut: 49_500_000n, spentToday: 60_000_000n, perDay: 100_000_000n }), { action: "wait", reason: "spent-today" });
});

test("nothing in the engine reads a key from the environment or prints one", () => {
  for (const file of ["ssa.ts", "terms.ts", "judge.ts", "human.ts", "agent.ts", "result.ts", "fee.ts", "signer.server.ts", "jupiter.server.ts", "dlmm.server.ts", "dca.ts", "run.server.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|secretKey|console\.log/, file);
  }
});

void LAYOUT;
void TransactionInstruction;

/* ------------------------------------------------------------------ after a stop, and after the end */

test("after the person stops the agent — or the mandate ends — the engine signs and sends nothing", async () => {
  const { agentTrade } = await import("./run.server.ts");
  const pair = Keypair.generate();
  const key = envKey(JSON.stringify([...pair.secretKey]));
  const mandate = { ...jupiterMandate(), terms: { ...jupiterTerms(), agent: pair.publicKey, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3_600) } };
  const rows = [];
  const signer = mandateSigner(key.signer, { mandate, policy: policyOf(mandate), journal: async (row) => void rows.push(row), screen: OPEN_SCREEN });
  const sent = [];
  const connection = (policyLive) => ({
    getAccountInfo: async () => (policyLive ? { owner: SSA_PROGRAM_ID, data: Buffer.alloc(8), lamports: 1, executable: false } : null),
    getMultipleAccountsInfo: async (keys) => keys.map(() => null),
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
    sendRawTransaction: async (bytes) => void sent.push(bytes),
  });
  const venueInstruction = apiInstruction(route.swapInstruction);
  const revoked = await agentTrade({ connection: connection(false), mandate, signer, venueInstruction, promisedOut: PROMISED, feeSides: SIDES });
  assert.deepEqual(revoked, { status: "refused-by-agent", reason: "the mandate was revoked" });
  const ended = await agentTrade({ connection: connection(true), mandate: { ...mandate, terms: { ...mandate.terms, expiresAt: 1n } }, signer, venueInstruction, promisedOut: PROMISED, feeSides: SIDES });
  assert.deepEqual(ended, { status: "refused-by-agent", reason: "the mandate has ended" });
  assert.equal(sent.length, 0);
  assert.equal(rows.length, 0);
});

/* ------------------------------------------------------------------ the window's server: devnet only */

test("the mandate's routes exist only on devnet with its pool and its agent; closed, they answer 404", async () => {
  const { mandateGate } = await import("./service.server.ts");
  const { openMandate } = await import("./http.server.ts");
  const pool = "2zMg7oGcYA4CLatSUaxsJHaZ2SqmsuVHNzrB6AT5cMf7";
  const agent = AGENT.toBase58();
  assert.deepEqual(mandateGate({}), { open: false });
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "mainnet", RYNTRA_AGENT_MANDATE_POOL: pool, RYNTRA_AGENT_MANDATE_AGENT: agent }), { open: false });
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: pool }), { open: false });
  assert.deepEqual(mandateGate({ RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: "not-an-address", RYNTRA_AGENT_MANDATE_AGENT: agent }), { open: false });
  const open = mandateGate({ RYNTRA_AGENT_MANDATE: "devnet", RYNTRA_AGENT_MANDATE_POOL: pool, RYNTRA_AGENT_MANDATE_AGENT: agent });
  assert.equal(open.open && open.network, "devnet");
  const closed = openMandate(new Request("https://ryntra.test/api/bots/mandate/review", { method: "POST" }), "review", {});
  assert.ok(closed instanceof Response);
  assert.equal(closed.status, 404);
});
