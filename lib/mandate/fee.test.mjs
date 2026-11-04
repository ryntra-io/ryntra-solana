/* CITY-183 — Ryntra's fee on the agent's trades: the person's table, the registry's account, the limits counting it. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Keypair, PublicKey } from "@solana/web3.js";

import { SOLANA_FEE_WALLET } from "../attribution/registry.ts";
import { FEE_POLICY_V2, classifyPair, inputSideFeeRaw } from "../core/fee-policy.ts";
import {
  AGENT_FEE_CEILING_BPS,
  AGENT_FEE_FLOOR_BPS,
  AGENT_FEE_FLOWS,
  AGENT_FEE_RATES,
  agentFeeAccount,
  agentFeeBps,
  agentFeeRaw,
  agentFeeWallet,
  feeAccountRefusal,
  feeTransferInstruction,
  pairFeeBps,
  policyCarriesFee,
  readFeeTransfer,
  uncataloguedFacts,
} from "./fee.ts";
import { MAX_TRANSACTION_BYTES, planEnable, unsignedTransaction, wireSize } from "./human.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "./ssa.ts";
import { STARTER_CAPS, mandatePolicy } from "./terms.ts";

const K = (text) => new PublicKey(text);
const USDC = K("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WSOL = NATIVE_MINT.toBase58();

test("the agent's rates are the person's table: the router's flows with a fee, nothing new", () => {
  assert.deepEqual([...AGENT_FEE_FLOWS].sort(), ["MAJOR", "MEME", "TRENDING", "XSTOCK"]);
  assert.deepEqual(AGENT_FEE_RATES, [10, 25, 50, 100]);
  assert.equal(AGENT_FEE_FLOOR_BPS, 10);
  assert.equal(AGENT_FEE_CEILING_BPS, 100);
  for (const flow of AGENT_FEE_FLOWS) assert.equal(agentFeeBps(flow), FEE_POLICY_V2[flow].bps, flow);
  /* Dollar to dollar pays nothing by the table; a stock by RFQ and an unread side take `/order`: not agent trades. */
  for (const flow of ["STABLE", "ONDO", "PRESTOCK", "AS_NOW"]) assert.equal(agentFeeBps(flow), null, flow);
});

test("the fee is the same share Jupiter's program takes of a person's swap", () => {
  for (const [amount, bps] of [[50_000_000n, 100], [12_345_678n, 25], [1n, 10], [500_000_000n, 10]]) {
    assert.equal(agentFeeRaw(amount, bps).toString(), inputSideFeeRaw(amount.toString(), bps));
  }
});

test("the fee lands in the registry's fee wallet, in its canonical account of the budget's mint", () => {
  assert.equal(agentFeeWallet().toBase58(), SOLANA_FEE_WALLET);
  /* The accounts a person's swap pays into, read on mainnet 02.11: owned by the fee wallet, of wSOL and USDC. */
  assert.equal(agentFeeAccount(NATIVE_MINT).toBase58(), "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578");
  assert.equal(agentFeeAccount(USDC).toBase58(), "GfZQv5L2fAmqNgMsUv97ecV3MUF8GYs7rE7K4ySJDhod");
});

test("a coin no catalogue reads is a token nobody verified — the table's MEME; SOL and dollars stay what they are", () => {
  const coin = Keypair.generate().publicKey.toBase58();
  const flow = (output) => classifyPair({ inputMint: WSOL, outputMint: output, input: uncataloguedFacts(WSOL), output: uncataloguedFacts(output), nowMs: Date.now() });
  assert.equal(flow(coin), "MEME");
  assert.equal(flow(USDC.toBase58()), "MAJOR");
  assert.equal(agentFeeBps(flow(coin)), 100);
});

test("the pair's rate: a dollar or a major by its mint, any other coin by its own facts; facts of another mint are none", () => {
  const coin = Keypair.generate().publicKey.toBase58();
  const now = Date.parse("2026-11-02T00:00:00Z");
  const sides = (output) => ({ input: null, output, nowMs: now });
  assert.equal(pairFeeBps(WSOL, USDC.toBase58(), sides(null)), 10);
  /* Facts that call USDC a new unverified token do not make it one. */
  assert.equal(pairFeeBps(WSOL, USDC.toBase58(), sides({ mint: USDC.toBase58(), verified: false, tags: [], firstPoolAt: null })), 10);
  assert.equal(pairFeeBps(WSOL, coin, sides({ mint: coin, verified: true, tags: [], firstPoolAt: "2026-10-01T00:00:00Z" })), 50);
  assert.equal(pairFeeBps(WSOL, coin, sides({ mint: coin, verified: false, tags: [], firstPoolAt: null })), 100);
  assert.equal(pairFeeBps(WSOL, coin, sides({ mint: coin, verified: true, tags: ["xstocks"], firstPoolAt: null })), 25);
  for (const tag of ["ondo", "prestocks"]) assert.equal(pairFeeBps(WSOL, coin, sides({ mint: coin, verified: true, tags: [tag], firstPoolAt: null })), null, tag);
  assert.equal(pairFeeBps(WSOL, coin, sides(null)), null, "unread");
  assert.equal(pairFeeBps(WSOL, coin, sides({ mint: WSOL, verified: false, tags: [], firstPoolAt: null })), null, "facts of another mint");
  assert.equal(pairFeeBps(USDC.toBase58(), "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", sides(null)), null, "dollar to dollar");
});

test("the fee account must be on chain, a Token account of the budget's mint, the fee wallet's own — as a person's swap checks", () => {
  const data = (mint, owner) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Uint8Array(101)]);
  const wallet = agentFeeWallet();
  assert.equal(feeAccountRefusal({ owner: TOKEN_PROGRAM_ID, data: data(NATIVE_MINT, wallet) }, NATIVE_MINT), null);
  assert.match(feeAccountRefusal(null, NATIVE_MINT), /not on chain/);
  assert.match(feeAccountRefusal({ owner: K("11111111111111111111111111111111"), data: data(NATIVE_MINT, wallet) }, NATIVE_MINT), /not a token account/);
  assert.match(feeAccountRefusal({ owner: TOKEN_PROGRAM_ID, data: data(USDC, wallet) }, NATIVE_MINT), /fee wallet's/);
  assert.match(feeAccountRefusal({ owner: TOKEN_PROGRAM_ID, data: data(NATIVE_MINT, Keypair.generate().publicKey) }, NATIVE_MINT), /fee wallet's/);
});

test("the devnet fee transfer reads back from its own bytes, and only Token's TransferChecked is one", () => {
  const vault = Keypair.generate().publicKey;
  const budget = Keypair.generate().publicKey;
  const ix = feeTransferInstruction({ budgetMint: NATIVE_MINT, budgetAccount: budget, vault, fee: 200_000n, decimals: 9 });
  const read = readFeeTransfer({ programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: ix.data });
  assert.ok(read.source.equals(budget) && read.mint.equals(NATIVE_MINT) && read.authority.equals(vault));
  assert.ok(read.destination.equals(agentFeeAccount(NATIVE_MINT)));
  assert.equal(read.amount, 200_000n);
  assert.equal(readFeeTransfer({ programId: K("11111111111111111111111111111111"), accounts: ix.keys.map((k) => k.pubkey), data: ix.data }), null);
  assert.equal(readFeeTransfer({ programId: TOKEN_PROGRAM_ID, accounts: ix.keys.map((k) => k.pubkey), data: Uint8Array.of(3, ...ix.data.subarray(1, 9)) }), null);
  assert.throws(() => feeTransferInstruction({ budgetMint: NATIVE_MINT, budgetAccount: budget, vault, fee: 0n, decimals: 9 }), /above zero/);
});

test("a policy written with the fee rule names Ryntra's account; one written before it does not", () => {
  const vault = Keypair.generate().publicKey;
  const terms = { human: Keypair.generate().publicKey, agent: Keypair.generate().publicKey, budgetMint: NATIVE_MINT, perTrade: 20_000_000n, perDay: 100_000_000n, slippageBps: 100, expiresAt: 2_000_000_000n, venue: { kind: "dlmm", pool: Keypair.generate().publicKey } };
  const policy = mandatePolicy(terms, { vault, budgetAccount: Keypair.generate().publicKey });
  const bytes = Buffer.concat(policy.constraints.flatMap((c) => c.accounts.flatMap((a) => (a.rule.kind === "keys" ? a.rule.keys.map((k) => k.toBuffer()) : []))));
  assert.equal(policyCarriesFee(bytes, NATIVE_MINT), true);
  assert.equal(policyCarriesFee(new Uint8Array(400), NATIVE_MINT), false);
});

test("the limits count the fee with the amount: Jupiter's input is the whole trade, devnet's fee is capped by the trade cap's share", () => {
  const terms = { human: Keypair.generate().publicKey, agent: Keypair.generate().publicKey, budgetMint: NATIVE_MINT, perTrade: STARTER_CAPS.SOL.perTrade, perDay: STARTER_CAPS.SOL.perDay, slippageBps: 100, expiresAt: 2_000_000_000n };
  const accounts = { vault: Keypair.generate().publicKey, budgetAccount: Keypair.generate().publicKey };
  /* Jupiter takes the fee out of `in_amount`: the one input rule — at most the trade cap — holds the fee with the amount. */
  const [route] = mandatePolicy({ ...terms, venue: { kind: "jupiter" } }, accounts).constraints;
  assert.deepEqual(route.data.filter((d) => d.offset === 8).map((d) => [d.operator, d.value.value]), [["lessThanOrEqualTo", STARTER_CAPS.SOL.perTrade]]);
  const dlmm = mandatePolicy({ ...terms, venue: { kind: "dlmm", pool: Keypair.generate().publicKey } }, accounts);
  assert.equal(dlmm.constraints[1].data[1].value.value, STARTER_CAPS.SOL.perTrade / 100n);
  /* The day's cap is the vault's loss of the budget's mint, fee and swap alike. */
  for (const policy of [dlmm, mandatePolicy({ ...terms, venue: { kind: "jupiter" } }, accounts)]) assert.deepEqual(policy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod]), [[WSOL, STARTER_CAPS.SOL.perDay]]);
});

test("with the fee rule every policy still fits the person's packet", () => {
  const human = Keypair.generate().publicKey;
  const config = { smartAccountIndex: 597_750n, creationFee: 0n, treasury: K("BrQAbGdWQ9YUHmWWgKFdFe4miTURH71jkYFPXfaosqDv") };
  const base = { human, agent: Keypair.generate().publicKey, budgetMint: NATIVE_MINT, perTrade: 500_000_000n, perDay: 2_000_000_000n, slippageBps: 100, expiresAt: 1_762_000_000n + 30n * 86_400n, raised: true };
  const fixed = { amountIn: 500_000_000n, outputMint: USDC, minOut: 45_000_000n };
  const pool = Keypair.generate().publicKey;
  for (const terms of [
    { ...base, venue: { kind: "jupiter" } },
    { ...base, venue: { kind: "jupiter" }, fixedBuy: fixed },
    { ...base, budgetMint: USDC, perTrade: 10_000_000n, perDay: 50_000_000n, venue: { kind: "jupiter" }, fixedBuy: { ...fixed, amountIn: 10_000_000n, outputMint: NATIVE_MINT } },
    { ...base, venue: { kind: "dlmm", pool } },
    { ...base, venue: { kind: "dlmm", pool }, fixedBuy: fixed },
  ]) {
    const plan = planEnable({ cluster: "devnet", terms, account: { kind: "absent", config }, fund: 250_000_000n, nowSeconds: 1_762_000_000n, receiveMints: [], agentFeeLamports: 10_000_000n });
    for (const instructions of plan.transactions) assert.ok(wireSize(unsignedTransaction(human, instructions, "11111111111111111111111111111111")) <= MAX_TRANSACTION_BYTES);
  }
});
