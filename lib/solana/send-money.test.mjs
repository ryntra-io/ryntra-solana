/**
 * «Перевірка» of a transfer and the reading of what the wallet returned
 * (contract 1.22.0), proven on a real built transfer: only the RPC transport
 * is stubbed — the decoder, the passport, the builder, the preflight, the
 * policy, the safety verdict and the byte check are the ones the routes run.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";

import { NATIVE_SOL_TRANSFER_ACTION_REF, SPL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { SendReturnedRequestSchema, SendReturnedResponseSchema, TransferCheckSchema } from "../api/v1/contract.ts";
import { decodeRawMintAccount } from "./mint.ts";
import { buildNativeSolPreflight, buildNativeSolTransaction } from "./native-sol.ts";
import { buildPassport } from "./passport.ts";
import { evaluateNativeSolPolicy, evaluateOwnerPolicy } from "./policy.ts";
import { buildTransferPreflight } from "./preflight.ts";
import { createSolanaRpcHandle } from "./rpc.ts";
import { buildSendCheck, SEND_NOT_SENDABLE } from "./send-check.ts";
import { readReturnedBytes } from "./send-returned.ts";
import { evaluateSendSafety, serverSendPolicy } from "./send-safety.ts";
import { associatedTokenAccount, buildTransferTransaction } from "./transaction.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    address: getAddressDecoder().decode(new Uint8Array(raw)),
    sign: (message) => new Uint8Array(signBytes(null, Buffer.from(message), privateKey)),
  };
}

const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const SIMULATED = { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "6200" };

/** The reads a builder makes, by method; `accounts` answers `getAccountInfo` by address (absent → no account). */
function stubRpc({ accounts, missing = [], rent = 2_039_280, baseFee = 5_000, senderBalance = "5000000", lamports = 5_000_000_000 }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    const context = { apiVersion: "2.1.0", slot: 1 };
    switch (body.method) {
      case "getAccountInfo":
        return reply({ context, value: accounts[body.params[0]] ?? null });
      case "getTokenAccountBalance":
        if (missing.includes(body.params[0])) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "could not find account" } }), { status: 200 });
        }
        return reply({ context, value: { amount: senderBalance, decimals: 6, uiAmountString: "5" } });
      case "getLatestBlockhash":
        return reply({ context, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 } });
      case "getFeeForMessage":
        return reply({ context, value: baseFee });
      case "getMinimumBalanceForRentExemption":
        return reply(body.params[0] === 0 ? 890_880 : rent);
      case "getBalance":
        return reply({ context, value: lamports });
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `unstubbed ${body.method}` } }), { status: 200 });
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** The plan route's SPL half, from the builder to the safety verdict. */
async function splReview({ state = "OPEN", simulation = SIMULATED, amountRaw = "1250000", senderBalance = "5000000" } = {}) {
  const wallet = testWallet();
  const raw = { ...fixture("usdc-spl"), network: "devnet" };
  const read = decodeRawMintAccount(raw);
  const passport = buildPassport(raw);
  const mintAccount = { data: [raw.dataBase64, "base64"], executable: false, lamports: 1_000_000, owner: raw.owner, rentEpoch: 0, space: 82 };
  const recipientAta = await associatedTokenAccount({ owner: RECIPIENT, mint: raw.mint, tokenProgram: passport.passport.identity.programId });
  const restore = stubRpc({
    senderBalance,
    missing: [recipientAta],
    accounts: {
      [raw.mint]: mintAccount,
      [RECIPIENT]: { data: ["", "base64"], executable: false, lamports: 1_000_000, owner: SYSTEM_PROGRAM, rentEpoch: 0, space: 0 },
    },
  });
  try {
    const input = { schemaVersion: "1.0.0", actionRef: SPL_TRANSFER_ACTION_REF, network: "devnet", mint: raw.mint, sender: String(wallet.address), recipient: RECIPIENT, amountRaw };
    const built = await buildTransferTransaction({ handle: createSolanaRpcHandle({ network: "devnet" }), read, passport: passport.passport, epoch: 250n, input });
    assert.equal(built.ok, true, built.reason);
    const preflight = buildTransferPreflight({ read, passport: passport.passport, input, epoch: 250n, simulation, networkFeeLamports: built.plan.baseFeeLamports });
    assert.equal(preflight.ok, true);
    /* The fixture's mint was read when it was captured; the policy judges its freshness at that moment, as the route does a moment after its own read. */
    const verdict = evaluateOwnerPolicy({ policy: serverSendPolicy("devnet"), input, passport: passport.passport, preflight: preflight.preflight, now: new Date(passport.passport.observedAt) });
    const reviewProof = { status: "SIGNED" };
    const safety = evaluateSendSafety({
      network: "devnet",
      state,
      support: built.plan.support,
      simulation,
      baseFeeLamports: built.plan.baseFeeLamports,
      ataRentLamports: built.plan.ataRentLamports,
      createsRecipientAccount: built.plan.createsRecipientAccount,
      programs: built.plan.programs,
      reviewProof,
      requireReviewProof: true,
      settlementStore: "DURABLE_MULTI_WRITER",
      independentReadback: true,
    });
    return { wallet, plan: built.plan, preflight: preflight.preflight, verdict, support: built.plan.support, safety, reviewProof };
  } finally {
    restore();
  }
}

test("«Перевірка» of a token transfer: the card's lines, exact, and the recipient's new account as the sender's cost", async () => {
  const review = await splReview();
  const check = TransferCheckSchema.parse(buildSendCheck(review));
  assert.deepEqual(check.asset, { mint: review.plan.mint, decimals: 6 });
  assert.equal(check.from, review.plan.sender);
  assert.deepEqual(check.to, { address: RECIPIENT, kind: "wallet", owner: RECIPIENT, account: review.plan.recipientTokenAccount, opensAccount: true });
  assert.equal(check.to.account, await associatedTokenAccount({ owner: RECIPIENT, mint: review.plan.mint, tokenProgram: review.plan.tokenProgram }));
  assert.deepEqual(check.send, { raw: "1250000", amount: "1.25" });
  assert.equal(check.issuerFee, null, "classic USDC keeps no fee");
  assert.deepEqual(check.receive, { raw: "1250000", amount: "1.25", less: false });
  assert.deepEqual(check.networkFee, { lamports: "5000", sol: "0.000005" });
  assert.deepEqual(check.setup, { lamports: "2039280", sol: "0.00203928" });
  assert.equal(check.minimum, null);
  assert.equal(check.signable, true);
  assert.equal(check.blocked, null);
  for (const warning of check.warnings) assert.ok(warning.en && warning.uk, warning.code);
});

test("a closed lane closes the wallet and says so in the card's words, in both languages", async () => {
  const review = await splReview({ state: "PAUSED" });
  const check = buildSendCheck(review);
  assert.equal(check.signable, false);
  assert.equal(check.blocked, null, "a closed safety verdict speaks through its warnings, as the card does");
  const stop = check.warnings.find((warning) => warning.code === "EMERGENCY_STOP");
  assert.deepEqual(stop, { code: "EMERGENCY_STOP", stops: true, en: "Sending is turned off right now.", uk: stop.uk });
  assert.notEqual(stop.uk, stop.en);
});

test("a Review the network would refuse is not signable, and `blocked` names why", async () => {
  const failed = { status: "PRESENT", succeeded: false, error: "{\"InstructionError\":[1,\"Custom\"]}", unitsConsumed: null };
  const review = await splReview({ simulation: failed });
  const check = buildSendCheck(review);
  assert.equal(check.signable, false);
  assert.ok(check.warnings.some((warning) => warning.code === "SIMULATION" && warning.stops));
  /* A safety verdict that closes signing leaves nothing for `blocked`; one that opens it with a Review that is not ready says the readiness line. */
  const opened = buildSendCheck({ ...review, safety: { decision: "ALLOW", findings: [] } });
  assert.deepEqual(opened.blocked, { code: "SIMULATION_FAILED", en: "This transfer would fail on the network right now.", uk: opened.blocked.uk });
  assert.notEqual(opened.blocked.uk, opened.blocked.en);
  const fallback = buildSendCheck({ ...review, safety: { decision: "BLOCK", findings: [] }, support: { decision: "BLOCKED", findings: [] } });
  assert.deepEqual(fallback.warnings.map((warning) => warning.code), [SEND_NOT_SENDABLE]);
});

test("SOL to an address with no account: the least it must carry, never a cost on top", async () => {
  const wallet = testWallet();
  const restore = stubRpc({ accounts: {} });
  try {
    const input = { schemaVersion: "1.0.0", actionRef: NATIVE_SOL_TRANSFER_ACTION_REF, network: "devnet", sender: String(wallet.address), recipient: RECIPIENT, amountRaw: "1000000000" };
    const built = await buildNativeSolTransaction({ handle: createSolanaRpcHandle({ network: "devnet" }), input });
    assert.equal(built.ok, true, built.reason);
    const preflight = buildNativeSolPreflight({ input, plan: built.plan, simulation: SIMULATED });
    const verdict = evaluateNativeSolPolicy({ policy: serverSendPolicy("devnet"), input, preflight });
    const safety = evaluateSendSafety({
      network: "devnet",
      state: "OPEN",
      support: built.plan.support,
      simulation: SIMULATED,
      baseFeeLamports: built.plan.baseFeeLamports,
      ataRentLamports: built.plan.ataRentLamports,
      createsRecipientAccount: built.plan.createsRecipientAccount,
      programs: built.plan.programs,
      reviewProof: { status: "SIGNED" },
      requireReviewProof: true,
      settlementStore: "DURABLE_MULTI_WRITER",
      independentReadback: true,
    });
    const check = TransferCheckSchema.parse(buildSendCheck({ plan: built.plan, preflight, verdict, support: built.plan.support, safety, reviewProof: { status: "SIGNED" } }));
    assert.deepEqual(check.asset, { mint: null, decimals: 9 });
    assert.deepEqual(check.send, { raw: "1000000000", amount: "1" });
    assert.deepEqual(check.to, { address: RECIPIENT, kind: "wallet", owner: RECIPIENT, account: RECIPIENT, opensAccount: true });
    assert.equal(check.setup, null);
    assert.deepEqual(check.minimum, { lamports: "890880", sol: "0.00089088" });
  } finally {
    restore();
  }
});

/* ---- what the wallet returned */

function sign(plan, wallet, rewrite = (message) => message) {
  const decoded = getTransactionDecoder().decode(Buffer.from(plan.unsignedWireBase64, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const messageBytes = getCompiledTransactionMessageEncoder().encode(rewrite(message));
  return Buffer.from(getTransactionEncoder().encode({ messageBytes, signatures: { ...decoded.signatures, [wallet.address]: wallet.sign(messageBytes) } })).toString("base64");
}

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const withPriorityFee = (message) => ({
  ...message,
  header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1 },
  staticAccounts: [...message.staticAccounts, COMPUTE_BUDGET],
  instructions: [{ programAddressIndex: message.staticAccounts.length, accountIndices: [], data: new Uint8Array([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0]) }, ...message.instructions],
});

/* The Seeker Wallet's shape (seen 2026-10-05 on a Seeker phone): its fee
   first, then Lighthouse's two read-only assertions after the transfer — on
   the fee payer and on a token account of the transfer — at log level 5. */
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const withSeekerGuards = (message) => {
  const base = withPriorityFee(message);
  const tokenAccount = base.header.numSignerAccounts;
  const lighthouse = base.staticAccounts.length;
  return {
    ...base,
    header: { ...base.header, numReadonlyNonSignerAccounts: base.header.numReadonlyNonSignerAccounts + 1 },
    staticAccounts: [...base.staticAccounts, LIGHTHOUSE],
    instructions: [
      ...base.instructions,
      { programAddressIndex: lighthouse, accountIndices: [0], data: Buffer.from("0605030053969c00000000000403000001000000000000000000", "hex") },
      { programAddressIndex: lighthouse, accountIndices: [tokenAccount], data: Buffer.from("0a0504024523010000000000040300000600000000000000000508", "hex") },
    ],
  };
};

async function returned(plan, signedWireBase64) {
  /* The request a phone sends: the Review's whole plan, passed through unread beyond the four fields. */
  const body = SendReturnedRequestSchema.parse({ plan, signedWireBase64 });
  return SendReturnedResponseSchema.parse(await readReturnedBytes(body));
}

test("the exact bytes, signed: settle, with the transaction's signature read from the bytes", async () => {
  const { plan, wallet } = await splReview();
  const answer = await returned(plan, sign(plan, wallet));
  assert.equal(answer.verdict, "BYTES_MATCH");
  assert.equal(answer.next, "settle");
  assert.match(answer.signature, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
});

test("the wallet added only its fee: adopt first; anything else, or no signature: stop", async () => {
  const { plan, wallet } = await splReview();
  const fee = await returned(plan, sign(plan, wallet, withPriorityFee));
  assert.deepEqual([fee.verdict, fee.next], ["BYTES_FEE_ADDED", "adopt"]);
  assert.ok(fee.signature);

  const seeker = await returned(plan, sign(plan, wallet, withSeekerGuards));
  assert.deepEqual([seeker.verdict, seeker.next], ["BYTES_FEE_ADDED", "adopt"], seeker.detail);

  const changed = await returned(plan, sign(plan, wallet, (message) => ({ ...message, lifetimeToken: "11111111111111111111111111111111" })));
  assert.deepEqual([changed.verdict, changed.next], ["BYTES_CHANGED", "stop"]);

  const unsigned = await returned(plan, plan.unsignedWireBase64);
  assert.deepEqual([unsigned.verdict, unsigned.next, unsigned.signature], ["NOT_SIGNED", "stop", null]);

  const garbage = await returned(plan, Buffer.alloc(80, 7).toString("base64"));
  assert.deepEqual([garbage.verdict, garbage.next], ["UNREADABLE", "stop"]);
});

test("a thousand units or more are still one plain decimal — no separator a client must guess at", async () => {
  const review = await splReview({ amountRaw: "1250000000", senderBalance: "5000000000" });
  const check = TransferCheckSchema.parse(buildSendCheck(review));
  assert.deepEqual(check.send, { raw: "1250000000", amount: "1250" });
  assert.deepEqual(check.receive, { raw: "1250000000", amount: "1250", less: false });
});

test("an account that opens at a cost the server could not read says unknown, never nothing", async () => {
  const review = await splReview();
  const check = TransferCheckSchema.parse(buildSendCheck({ ...review, plan: { ...review.plan, ataRentLamports: null } }));
  assert.equal(check.to.opensAccount, true);
  assert.deepEqual(check.setup, { lamports: null, sol: null });
  assert.equal(check.minimum, null);
});
