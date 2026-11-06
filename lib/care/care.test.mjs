import { test } from "node:test";
import assert from "node:assert/strict";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { NATIVE_MINT, TOKEN_PROGRAM_ID, ssaAddress } from "../mandate/ssa.ts";
import { MAX_TRANSACTION_BYTES, unsignedTransaction, wireSize } from "../mandate/human.ts";
import { CLAIM_COOLDOWN_MS, OUT_OF_RANGE_PATIENCE_MS, REBALANCE_COOLDOWN_MS, careDay, decide, inRange, recentred } from "./decide.ts";
import { planCareEnable, planCareStop, planCareWithdraw } from "./enable.ts";
import { careRefusal } from "./signer.server.ts";
import { careInstructions } from "./run.server.ts";
import { CARE_VAULT_INDEX, careVaultOf, carePolicyExecuteInstruction, readCarePolicyExecute } from "./ssa-care.ts";
import { CARE_MAX_ACTIVE_BIN_SLIPPAGE, DAMM_V2_PROGRAM_ID, DISC, DLMM_PROGRAM_ID, LAYOUT, careRuleOf, carePolicies, careTermsRefusal } from "./terms.ts";

const now = BigInt(Math.floor(Date.now() / 1000));
const key = () => Keypair.generate().publicKey;
const human = key();
const agent = key();
const attacker = key();
const mintX = key();

function termsFor(kind, extra = {}) {
  return {
    human,
    agent,
    pool: { kind, address: key(), mintX, mintY: NATIVE_MINT, programX: TOKEN_PROGRAM_ID, programY: TOKEN_PROGRAM_ID },
    fees: "reinvest",
    rebalance: kind === "dlmm",
    stopBelow: 0.5,
    expiresAt: now + 30n * 86_400n,
    ...extra,
  };
}

const absent = { kind: "absent", config: { smartAccountIndex: 41n, creationFee: 0n, treasury: key() } };

function enabled(kind) {
  return planCareEnable({ cluster: "devnet", terms: termsFor(kind), account: absent, fund: { x: 0n, y: 100_000_000n }, decimals: { x: 6, y: 9 }, nowSeconds: now });
}

/* An account read the way the chain holds it: a token account of `owner` (Token's layout: mint, owner, …). */
function tokenFacts(entries) {
  const facts = new Map();
  for (const [address, owner] of entries) {
    const data = new Uint8Array(165);
    data.set(mintX.toBytes(), 0);
    data.set(owner.toBytes(), 32);
    facts.set(address.toBase58(), { owner: TOKEN_PROGRAM_ID, data });
  }
  return facts;
}

/* A DLMM claim_fee2 shaped as the program reads it — 14 accounts, the IDL's order. */
function dlmmClaim(care, to) {
  const keys = Array.from({ length: 14 }, () => ({ pubkey: key(), isSigner: false, isWritable: true }));
  keys[LAYOUT.dlmmClaimFee2.pool].pubkey = care.terms.pool.address;
  keys[LAYOUT.dlmmClaimFee2.sender].pubkey = care.vault;
  keys[LAYOUT.dlmmClaimFee2.tokenX].pubkey = getAssociatedTokenAddressSync(mintX, to, true);
  keys[LAYOUT.dlmmClaimFee2.tokenY].pubkey = getAssociatedTokenAddressSync(NATIVE_MINT, to, true);
  return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data: Buffer.from([...DISC.dlmmClaimFee2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
}

function message(care, build) {
  const tx = unsignedTransaction(care.terms.agent, careInstructions(care, build), PublicKey.default.toBase58(), []);
  return tx.message.serialize();
}

test("the terms: a care the engine writes, and the ones it does not", () => {
  assert.equal(careTermsRefusal(termsFor("dlmm"), now), null);
  assert.equal(careTermsRefusal(termsFor("damm-v2"), now), null);
  assert.match(careTermsRefusal(termsFor("dlmm", { agent: human }), now), /not the person's wallet/);
  assert.match(careTermsRefusal(termsFor("damm-v2", { rebalance: true }), now), /only a DLMM range/);
  assert.match(careTermsRefusal(termsFor("dlmm", { stopBelow: -1 }), now), /stop is a price/);
  assert.match(careTermsRefusal(termsFor("dlmm", { expiresAt: now + 91n * 86_400n }), now), /at most 90 days/);
});

test("the policies: no spending limit, every payee rule the person's or the vault's, the pool pinned, the slippage capped", () => {
  const vault = key();
  for (const kind of ["dlmm", "damm-v2"]) {
    const terms = termsFor(kind);
    const { exit, tend } = carePolicies(terms, vault);
    assert.equal(exit.spendingLimits.length, 0);
    assert.equal(tend.spendingLimits.length, 0);
    for (const constraint of exit.constraints) {
      const payees = constraint.accounts.filter((account) => account.rule.kind === "data").map((account) => new PublicKey(account.rule.constraints[0].value.value));
      for (const payee of payees) assert.ok(payee.equals(human), "an exit pays only the person");
      const pinnedKeys = constraint.accounts.filter((account) => account.rule.kind === "keys").flatMap((account) => account.rule.keys);
      assert.ok(pinnedKeys.some((pinned) => pinned.equals(vault)), "the vault signs every exit");
    }
    for (const constraint of tend.constraints) {
      const payees = constraint.accounts.filter((account) => account.rule.kind === "data").map((account) => new PublicKey(account.rule.constraints[0].value.value));
      for (const payee of payees) assert.ok(payee.equals(vault), "tending keeps the money in the vault");
      const pinnedKeys = constraint.accounts.filter((account) => account.rule.kind === "keys").flatMap((account) => account.rule.keys);
      assert.ok(!pinnedKeys.some((pinned) => pinned.equals(human)) || kind === "damm-v2");
      assert.ok(pinnedKeys.some((pinned) => pinned.equals(terms.pool.address)) || constraint.accounts.length === 3, "the pool is pinned");
    }
  }
  const rebalance = carePolicies(termsFor("dlmm"), vault).tend.constraints[0];
  const cap = rebalance.data.find((rule) => rule.offset === LAYOUT.dlmmRebalance.maxActiveBinSlippage);
  assert.equal(cap.value.value, CARE_MAX_ACTIVE_BIN_SLIPPAGE);
  assert.equal(cap.operator, "lessThanOrEqualTo");
});

test("the person's approval: at most three transactions, each within the packet", () => {
  for (const kind of ["dlmm", "damm-v2"]) {
    const plan = enabled(kind);
    assert.ok(plan.transactions.length >= 2 && plan.transactions.length <= 3);
    for (const instructions of plan.transactions) assert.ok(wireSize(unsignedTransaction(human, instructions, PublicKey.default.toBase58())) <= MAX_TRANSACTION_BYTES);
    assert.ok(plan.care.vault.equals(ssaAddress.vault(plan.care.settings, CARE_VAULT_INDEX)));
    assert.equal(plan.care.vaultIndex, 1);
    assert.equal(carePolicies(plan.care.terms, plan.care.vault, 2).exit.accountIndex, 2);
    assert.ok(!plan.care.vault.equals(ssaAddress.vault(plan.care.settings, 0)), "the care's vault is not the trading budget's");
    assert.equal(plan.care.tendSeed, plan.care.exitSeed + 1n);
    assert.equal(planCareStop(plan.care).length, 1);
    assert.equal(planCareWithdraw(plan.care, { x: 5n, y: 0n, lamports: 1n }, { x: 6, y: 9 }).length, 1);
  }
});

test("the execution: written for the care vault and read back the same", () => {
  const plan = enabled("dlmm");
  const claim = dlmmClaim(plan.care, human);
  const execution = carePolicyExecuteInstruction({ policy: plan.care.exitPolicy, signer: agent, instructions: [claim], constraintIndices: [0] });
  const view = readCarePolicyExecute({ programId: execution.programId, keys: execution.keys.map((entry) => entry.pubkey), data: execution.data });
  assert.ok(view.policy.equals(plan.care.exitPolicy));
  assert.deepEqual(view.constraintIndices, [0]);
  assert.equal(view.instructions.length, 1);
  assert.ok(view.instructions[0].programId.equals(DLMM_PROGRAM_ID));
  assert.deepEqual(view.instructions[0].accounts.map(String), claim.keys.map((entry) => entry.pubkey.toBase58()));
  assert.equal(careVaultOf(plan.care.settings).toBase58(), plan.care.vault.toBase58());
});

test("the agent's signer: the fees to the person — signed; to anyone else, another pool, another policy, a stray signer — refused", () => {
  const { care } = enabled("dlmm");
  const facts = (to) => tokenFacts([
    [getAssociatedTokenAddressSync(mintX, to, true), to],
    [getAssociatedTokenAddressSync(NATIVE_MINT, to, true), to],
  ]);
  const good = { policy: "exit", setup: [], inner: [dlmmClaim(care, human)], constraintIndices: [0], extraSigners: [] };
  assert.equal(careRefusal(message(care, good), care, { facts: facts(human) }), null);

  const stolen = { ...good, inner: [dlmmClaim(care, attacker)] };
  assert.match(careRefusal(message(care, stolen), care, { facts: facts(attacker) }), /breaks the exit rule/);

  const otherPool = dlmmClaim(care, human);
  otherPool.keys[LAYOUT.dlmmClaimFee2.pool].pubkey = key();
  assert.match(careRefusal(message(care, { ...good, inner: [otherPool] }), care, { facts: facts(human) }), /not a pinned one/);

  assert.match(careRefusal(message(care, { ...good, policy: "tend" }), care, { facts: facts(human) }), /breaks the tend rule|does not hold/);

  const payee = unsignedTransaction(care.terms.agent, [...careInstructions(care, good), new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [], data: Buffer.from([3]) })], PublicKey.default.toBase58(), []);
  assert.match(careRefusal(payee.message.serialize(), care, { facts: facts(human) }), /outside the care/);

  const notAgent = unsignedTransaction(attacker, careInstructions(care, good), PublicKey.default.toBase58(), []);
  assert.match(careRefusal(notAgent.message.serialize(), care, { facts: facts(human) }), /does not pay/);
});

test("the rule an instruction names, by its program and discriminator", () => {
  assert.deepEqual(careRuleOf("dlmm", DLMM_PROGRAM_ID, DISC.dlmmRebalance), { policy: "tend", index: 0, rule: "rebalance" });
  assert.deepEqual(careRuleOf("dlmm", DLMM_PROGRAM_ID, DISC.dlmmClosePosition2), { policy: "exit", index: 2, rule: "closeToWallet" });
  assert.deepEqual(careRuleOf("damm-v2", DAMM_V2_PROGRAM_ID, DISC.dammClaimFee, true), { policy: "tend", index: 0, rule: "claimToVault" });
  assert.deepEqual(careRuleOf("damm-v2", DAMM_V2_PROGRAM_ID, DISC.dammClaimFee), { policy: "exit", index: 0, rule: "claimToWallet" });
  assert.equal(careRuleOf("dlmm", DAMM_V2_PROGRAM_ID, DISC.dlmmRebalance), null);
  assert.equal(careRuleOf("dlmm", DLMM_PROGRAM_ID, Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136)), null, "a swap is no rule of the care");
});

test("the decision: stop first, then the range after patience, then fees worth their fee", () => {
  const t = 1_000_000_000_000;
  const base = { kind: "dlmm", price: 1, activeBin: 10, lowerBin: 0, upperBin: 20, feesInY: 0, txCostInY: 0.00001, hasLiquidity: true, outOfRangeSince: null, lastRebalanceAt: null, lastClaimAt: null };
  const choice = { fees: "wallet", rebalance: true, stopBelow: 0.5 };
  assert.deepEqual(decide(base, choice, t), { kind: "wait", reason: "in-range" });
  assert.deepEqual(decide({ ...base, price: 0.4 }, choice, t), { kind: "exit", reason: "stop" });
  const out = { ...base, activeBin: 30 };
  assert.equal(inRange(out), false);
  assert.deepEqual(decide({ ...out, outOfRangeSince: t - 1000 }, choice, t), { kind: "wait", reason: "patience" });
  assert.deepEqual(decide({ ...out, outOfRangeSince: t - OUT_OF_RANGE_PATIENCE_MS }, choice, t), { kind: "rebalance", lowerBin: 20, upperBin: 40 });
  assert.deepEqual(decide({ ...out, outOfRangeSince: t - OUT_OF_RANGE_PATIENCE_MS, lastRebalanceAt: t - REBALANCE_COOLDOWN_MS + 1 }, choice, t), { kind: "wait", reason: "cooldown" });
  assert.deepEqual(decide({ ...out, outOfRangeSince: 0 }, { ...choice, rebalance: false }, t), { kind: "wait", reason: "nothing" });
  assert.deepEqual(recentred(out), { lowerBin: 20, upperBin: 40 });
  assert.deepEqual(decide({ ...base, feesInY: 0.0001 }, choice, t), { kind: "wait", reason: "fees-small" });
  assert.deepEqual(decide({ ...base, feesInY: 0.01 }, choice, t), { kind: "claim", to: "wallet" });
  assert.deepEqual(decide({ ...base, feesInY: 0.01 }, { ...choice, fees: "reinvest" }, t), { kind: "claim", to: "reinvest" });
  assert.deepEqual(decide({ ...base, feesInY: 0.01, lastClaimAt: t - CLAIM_COOLDOWN_MS + 1 }, choice, t), { kind: "wait", reason: "cooldown" });
  assert.deepEqual(decide({ ...base, hasLiquidity: false }, choice, t), { kind: "wait", reason: "empty" });
  assert.deepEqual(decide({ ...base, kind: "damm-v2", activeBin: null, lowerBin: null, upperBin: null, feesInY: 0.01 }, choice, t), { kind: "claim", to: "wallet" });
});

test("the day: only the last 24 hours, only what happened", () => {
  const t = 2_000_000_000_000;
  const events = [
    { at: t - 1000, kind: "claim", valueInY: 0.2, signature: "a" },
    { at: t - 2000, kind: "reinvest", valueInY: 0.1, signature: "b" },
    { at: t - 3000, kind: "rebalance", valueInY: 0, signature: "c" },
    { at: t - 90_000_000, kind: "claim", valueInY: 5, signature: "old" },
  ];
  const day = careDay(events, null, t, { now: 3, dayAgo: 2.9 });
  assert.equal(day.claimedInY, 0.2);
  assert.equal(day.reinvestedInY, 0.1);
  assert.equal(day.rebalances, 1);
  assert.equal(day.exits, 0);
  assert.equal(day.valueNowInY, 3);
});
