/**
 * Gate M0C: action kinds do not overlap, native SOL builds, states classify,
 * a second submit is refused, Send facts round-trip, Jupiter catalog
 * fail-closes.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAddressDecoder } from "@solana/kit";

import { NATIVE_SOL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { fetchTokenCatalog, normalizePriceMap, normalizeTokenRow } from "./catalog.ts";
import { classifySendOutcome, nextSendState, RECOVERY_READS_FIRST } from "./send-lifecycle.ts";
import {
  classifyTokenTransfer,
  SEND_ACTION_KINDS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./send-kinds.ts";
import { encodeSendFacts, parseSendReceiptFacts, SolanaSendReceiptFactsSchema } from "./send-receipt.ts";
import { claimIntent, intentKey, resetSubmitOnceForTests } from "./submit-once.ts";
import { buildNativeSolTransaction, nativeSolTransferInstruction, SYSTEM_PROGRAM_ADDRESS } from "./native-sol.ts";
import { createSolanaRpcHandle } from "./rpc.ts";
import { canSubmitSendAction } from "./send-safety.ts";

function testWallet() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: getAddressDecoder().decode(new Uint8Array(raw)) };
}

/* On the ed25519 curve. The previous fixture — `5Q544fKrFoe6…pge4j1` — is
   off-curve, so no key can ever sign for it, and native SOL sent there would
   be unrecoverable. It built a transaction here for as long as nothing
   classified the recipient; `resolveNativeRecipient` now refuses it, which is
   the behavior this suite wants and the reason the fixture changed. */
const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

test("the four Send action kinds are disjoint, and classification never overlaps", () => {
  assert.deepEqual([...SEND_ACTION_KINDS], [
    "NATIVE_SOL",
    "SPL_TRANSFER_CHECKED",
    "TOKEN_2022",
    "TOKEN_ATA_CREATE",
  ]);
  assert.equal(classifyTokenTransfer({ tokenProgram: TOKEN_PROGRAM_ID, createsRecipientAccount: false }), "SPL_TRANSFER_CHECKED");
  assert.equal(classifyTokenTransfer({ tokenProgram: TOKEN_2022_PROGRAM_ID, createsRecipientAccount: false }), "TOKEN_2022");
  assert.equal(classifyTokenTransfer({ tokenProgram: TOKEN_PROGRAM_ID, createsRecipientAccount: true }), "TOKEN_ATA_CREATE");
  /* The token program decides the family; creating the recipient account is an
     effect that travels beside it on the plan. This assertion was the opposite
     until RYN-SOL-M4, where the old order sent a Token-2022 transfer into
     M1B's classic-USDC envelope — a 0.5 USD cap and a mint allowlist holding
     classic USDC alone — and produced a permanent BLOCK that read as a policy
     refusal rather than as a misfiling. The overlap the old order guarded
     against is still guarded: `createsRecipientAccount` stays on the plan, the
     rent is stated before Review, and no receipt may claim an existing-account
     transfer when an account was created. */
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_2022_PROGRAM_ID, createsRecipientAccount: true }),
    "TOKEN_2022",
    "a Token-2022 transfer stays in its own family even when it creates the recipient account",
  );
  /* TOKEN_ATA_CREATE keeps exactly its original meaning: the classic SPL
     account-creation case RYN-SOL-M1B proved. Nothing about that row moves. */
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_PROGRAM_ID, createsRecipientAccount: true }),
    "TOKEN_ATA_CREATE",
  );
  /* The submit gate is no longer a function of the action kind. Every one of
     the four shapes can reach a wallet when the server's safety verdict says
     the transfer was proven, and none of them can when it does not. */
  for (const decision of ["ALLOW", "REVIEW"]) {
    assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision } }), true);
  }
  for (const decision of ["BLOCK", "UNKNOWN", "PAUSE"]) {
    assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision } }), false);
  }
});

test("native SOL instruction is System Program transfer, not a mint", () => {
  const wallet = testWallet();
  const ix = nativeSolTransferInstruction({
    source: wallet.address,
    destination: RECIPIENT,
    lamports: 1_000_000n,
  });
  assert.equal(String(ix.programAddress), SYSTEM_PROGRAM_ADDRESS);
  assert.equal(ix.accounts.length, 2);
  const data = ix.data;
  assert.equal(data.byteLength, 12);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getUint32(0, true), 2);
  assert.equal(view.getBigUint64(4, true), 1_000_000n);
});

test("native SOL builds on mainnet semantics against stubbed chain reads", async () => {
  const wallet = testWallet();
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    switch (body.method) {
      case "getBalance":
        return reply({ context: { slot: 1 }, value: 5_000_000_000 });
      case "getAccountInfo":
        return reply({ context: { slot: 1 }, value: { lamports: 1, owner: SYSTEM_PROGRAM_ADDRESS, data: ["", "base64"] } });
      case "getLatestBlockhash":
        return reply({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 } });
      case "getFeeForMessage":
        return reply({ context: { slot: 1 }, value: 5_000 });
      default:
        return reply(null);
    }
  };
  try {
    const result = await buildNativeSolTransaction({
      handle: createSolanaRpcHandle({ network: "mainnet" }),
      input: {
        schemaVersion: "1.0.0",
        actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
        network: "mainnet",
        sender: String(wallet.address),
        recipient: RECIPIENT,
        amountRaw: "1000000000",
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.plan.actionKind, "NATIVE_SOL");
    assert.equal(result.plan.network, "mainnet");
    assert.equal(result.plan.decimals, 9);
    assert.equal(result.plan.amountRaw, "1000000000");
    assert.equal(result.plan.createsRecipientAccount, false);
    assert.equal(result.plan.baseFeeLamports, "5000");
    assert.equal(result.plan.priorityFeeLamports, "0");
    assert.deepEqual(result.plan.programs, [SYSTEM_PROGRAM_ADDRESS]);
    assert.equal(result.plan.fingerprint.instructionCount, 1);
    assert.equal(result.plan.fingerprint.transfer.programAddress, SYSTEM_PROGRAM_ADDRESS);
  } finally {
    globalThis.fetch = original;
  }
});

test("native SOL reserves the exact network fee instead of accepting a doomed max-balance transfer", async () => {
  const wallet = testWallet();
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    switch (body.method) {
      case "getBalance":
        return reply({ context: { slot: 1 }, value: 1_004_999 });
      case "getAccountInfo":
        return reply({ context: { slot: 1 }, value: { lamports: 1, owner: SYSTEM_PROGRAM_ADDRESS, data: ["", "base64"] } });
      case "getLatestBlockhash":
        return reply({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 } });
      case "getFeeForMessage":
        return reply({ context: { slot: 1 }, value: 5_000 });
      default:
        return reply(null);
    }
  };
  try {
    const result = await buildNativeSolTransaction({
      handle: createSolanaRpcHandle({ network: "mainnet" }),
      input: {
        schemaVersion: "1.0.0",
        actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
        network: "mainnet",
        sender: String(wallet.address),
        recipient: RECIPIENT,
        amountRaw: "1000000",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INSUFFICIENT_FEE_BALANCE");
  } finally {
    globalThis.fetch = original;
  }
});

test("signature readiness requires a successful simulation, clear policy and known base fee", async () => {
  const { assessSendReadiness } = await import("./send-readiness.ts");
  const base = {
    plan: { baseFeeLamports: "5000" },
    preflight: { simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "500" } },
    verdict: { verdict: "NO_KNOWN_BLOCKER" },
    canaryVerdict: { decision: "ALLOW", newRiskAllowed: true },
    reviewProof: { status: "SIGNED" },
    requireReviewProof: true,
  };

  assert.deepEqual(assessSendReadiness(base), { ready: true, code: "READY", reason: "Ready for signature." });
  assert.equal(
    assessSendReadiness({ ...base, preflight: { simulation: { status: "SKIPPED", reason: "RPC timeout" } } }).code,
    "SIMULATION_MISSING",
  );
  assert.equal(
    assessSendReadiness({
      ...base,
      preflight: { simulation: { status: "PRESENT", succeeded: false, error: "InstructionError", unitsConsumed: "400" } },
    }).code,
    "SIMULATION_FAILED",
  );
  assert.equal(
    assessSendReadiness({ ...base, verdict: { verdict: "REVIEW_REQUIRED" } }).code,
    "POLICY_NOT_CLEAR",
  );
  assert.equal(
    assessSendReadiness({ ...base, canaryVerdict: { decision: "PAUSE", newRiskAllowed: false } }).code,
    "CANARY_NOT_CLEAR",
  );
  assert.equal(
    assessSendReadiness({ ...base, canaryVerdict: { decision: "REVIEW", newRiskAllowed: false } }).code,
    "CANARY_NOT_CLEAR",
  );
  assert.equal(
    assessSendReadiness({ ...base, plan: { baseFeeLamports: null } }).code,
    "BASE_FEE_UNKNOWN",
  );
  assert.equal(
    assessSendReadiness({ ...base, reviewProof: { status: "UNSIGNED" } }).code,
    "REVIEW_PROOF_UNSIGNED",
  );
  assert.equal(
    assessSendReadiness({
      ...base,
      reviewProof: { status: "UNSIGNED" },
      requireReviewProof: false,
    }).code,
    "READY",
  );
});

test("latest wallet request wins exactly and cancellation rejects late commits", async () => {
  const { acceptLatestSolanaResult, createLatestSolanaRequestGate } = await import("./latest-request.ts");
  const gate = createLatestSolanaRequestGate();
  const walletA = gate.begin("WalletAddressA");
  const walletB = gate.begin("WalletAddressB");
  assert.equal(walletA.signal.aborted, true);
  assert.equal(gate.accepts(walletA, "WalletAddressA"), false);
  assert.equal(gate.accepts(walletB, "WalletAddressB"), true);
  assert.equal(gate.accepts(walletB, "walletaddressb"), false, "Solana identity is case-sensitive");
  gate.cancel(walletB);
  assert.equal(gate.accepts(walletB, "WalletAddressB"), false);

  let finishVerification;
  const verification = new Promise((resolve) => {
    finishVerification = resolve;
  });
  const signedTicket = gate.begin("plan-hash-a");
  const completion = acceptLatestSolanaResult({
    gate,
    ticket: signedTicket,
    identity: "plan-hash-a",
    produce: () => verification,
  });
  gate.cancel(signedTicket);
  finishVerification({ verdict: "BYTES_MATCH" });
  assert.deepEqual(await completion, { accepted: false });
});

test("Review panel height grows with exact refusal count instead of clipping", async () => {
  const { reviewPanelHeight } = await import("./send-layout.ts");
  assert.equal(reviewPanelHeight({ hasPlan: false, settled: false, findingCount: 0 }), 2);
  assert.equal(reviewPanelHeight({ hasPlan: true, settled: true, findingCount: 0 }), 4);
  assert.equal(reviewPanelHeight({ hasPlan: true, settled: false, findingCount: 0 }), 7);
  assert.equal(reviewPanelHeight({ hasPlan: true, settled: false, findingCount: 1 }), 10);
  assert.equal(reviewPanelHeight({ hasPlan: true, settled: false, findingCount: 4 }), 12);
  assert.equal(reviewPanelHeight({ hasPlan: true, settled: false, findingCount: 13 }), 16);
});

test("asset search matches ticker, full name and mint while unknown search results expand inline", async () => {
  const { matchesSendAssetQuery, showUnknownMatchesInline } = await import("./send-assets.ts");
  const sol = { ticker: "SOL", name: "Solana", mint: null };
  const unknown = { ticker: "ABCD", name: null, mint: RECIPIENT };
  assert.equal(matchesSendAssetQuery(sol, "sol"), true);
  assert.equal(matchesSendAssetQuery(sol, "Solana"), true);
  assert.equal(matchesSendAssetQuery(unknown, RECIPIENT.slice(0, 8)), true);
  assert.equal(matchesSendAssetQuery(sol, "USDC"), false);
  assert.equal(showUnknownMatchesInline(""), false);
  assert.equal(showUnknownMatchesInline("abcd"), true);
});

test("wallet connection never falls back to an EVM account when a Solana account is available", async () => {
  const { selectSolanaAccount, withWalletPromptTimeout } = await import("./wallet.client.ts");
  const evm = {
    address: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
    chains: ["eip155:1"],
    features: ["solana:signTransaction"],
  };
  const solana = {
    address: RECIPIENT,
    chains: ["solana:mainnet"],
    features: ["solana:signTransaction"],
  };
  assert.equal(selectSolanaAccount([evm, solana]), solana);
  assert.equal(selectSolanaAccount([evm]), null);
  await assert.rejects(
    withWalletPromptTimeout(new Promise(() => {}), 5),
    (failure) => failure?.code === -32002 && /still waiting/i.test(failure.message),
  );
});

test("native SOL refuses when the sender cannot cover the amount", async () => {
  const wallet = testWallet();
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const reply = (result) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (body.method === "getBalance") return reply({ context: { slot: 1 }, value: 10 });
    return reply(null);
  };
  try {
    const result = await buildNativeSolTransaction({
      handle: createSolanaRpcHandle({ network: "mainnet" }),
      input: {
        schemaVersion: "1.0.0",
        actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
        network: "mainnet",
        sender: String(wallet.address),
        recipient: RECIPIENT,
        amountRaw: "1000000000",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INSUFFICIENT_BALANCE");
  } finally {
    globalThis.fetch = original;
  }
});

test("LANDED_FAILED, EXPIRED and UNKNOWN are distinct, and recovery starts at signature status", () => {
  assert.equal(RECOVERY_READS_FIRST, "SIGNATURE_STATUS");
  const base = {
    signature: "1".repeat(64),
    lastValidBlockHeight: "100",
  };
  assert.equal(
    classifySendOutcome({
      ...base,
      status: { confirmationStatus: "confirmed", err: "InstructionError", seen: true, slot: "9" },
      blockHeight: "90",
    }),
    "LANDED_FAILED",
  );
  assert.equal(
    classifySendOutcome({
      ...base,
      status: { confirmationStatus: null, err: null, seen: false, slot: null },
      blockHeight: "101",
    }),
    "EXPIRED",
  );
  assert.equal(
    classifySendOutcome({
      ...base,
      status: { confirmationStatus: null, err: null, seen: false, slot: null },
      blockHeight: "50",
    }),
    "UNKNOWN",
  );
  assert.equal(
    classifySendOutcome({
      ...base,
      status: { confirmationStatus: "finalized", err: null, seen: true, slot: "9" },
      blockHeight: "90",
    }),
    "FINALIZED",
  );
  assert.equal(nextSendState("DRAFT", "SUBMITTED"), "DRAFT");
  assert.equal(nextSendState("DRAFT", "PREVIEWED"), "REVIEW");
  assert.equal(nextSendState("REVIEW", "POLICY_ALLOWED"), "SIGNATURE_REQUIRED");
  assert.equal(nextSendState("SIGNED", "SUBMITTED"), "SUBMITTED");
  assert.equal(nextSendState("SUBMITTED", "LANDED_FAILED"), "LANDED_FAILED");
});

test("a second submit of the same intent is refused", () => {
  resetSubmitOnceForTests();
  const key = intentKey({ network: "mainnet", messageHash: "0x" + "ab".repeat(32) });
  assert.equal(claimIntent(key).ok, true);
  const second = claimIntent(key);
  assert.equal(second.ok, false);
  resetSubmitOnceForTests();
});

test("Send Receipt facts round-trip through their schema", () => {
  const facts = SolanaSendReceiptFactsSchema.parse({
    schema: "ryntra.solana.send-receipt",
    schemaVersion: "1.0.0",
    actionKind: "NATIVE_SOL",
    network: "mainnet",
    mint: SYSTEM_PROGRAM_ADDRESS,
    sender: RECIPIENT,
    recipient: RECIPIENT.replace("5", "4"),
    expectedDebitRaw: "-1000",
    expectedCreditRaw: "1000",
    actualDebitRaw: "-1000",
    actualCreditRaw: "1000",
    transferFeeRaw: "0",
    baseFeeLamports: "5000",
    priorityFeeLamports: null,
    ataRentLamports: null,
    programs: [SYSTEM_PROGRAM_ADDRESS],
    signature: "1".repeat(64),
    slot: "12",
    finality: "confirmed",
    reconciliation: "MATCHED",
  });
  const encoded = encodeSendFacts(facts);
  const parsed = parseSendReceiptFacts(encoded);
  assert.ok(parsed);
  assert.equal(parsed.actionKind, "NATIVE_SOL");
  assert.equal(parsed.expectedCreditRaw, "1000");
});

test("Jupiter catalog normalizer keeps venue strings and omits a missing price", () => {
  const source = { ref: "jupiter:test", label: "Jupiter Tokens API, lite tier" };
  const row = normalizeTokenRow(
    {
      id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      symbol: "USDC",
      name: "USD Coin",
      isVerified: true,
      usdPrice: 1,
    },
    source,
  );
  assert.ok(row);
  assert.equal(row.symbol, "USDC");
  assert.equal(row.isVerified, true);
  assert.equal(row.usdPrice, "1");
  const prices = normalizePriceMap({
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { usdPrice: 0.999 },
  });
  assert.equal(prices.EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, "0.999");
  assert.deepEqual(normalizePriceMap({}), {});
});

test("Jupiter catalog refuses oversized bodies and row floods before iterating them", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "262145" },
      });
    const oversized = await fetchTokenCatalog([RECIPIENT], 100);
    assert.equal(oversized.ok, false);
    assert.equal(oversized.code, "MALFORMED");
    assert.match(oversized.reason, /byte ceiling/i);

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json(
          Array.from({ length: 201 }, (_, index) => ({
            id: `${RECIPIENT.slice(0, -3)}${String(index).padStart(3, "1")}`,
            symbol: `T${index}`,
          })),
        );
      }
      return Response.json({});
    };
    const flooded = await fetchTokenCatalog([RECIPIENT], 100);
    assert.equal(flooded.ok, false);
    assert.equal(flooded.code, "MALFORMED");
    assert.match(flooded.reason, /200-row ceiling/i);

    globalThis.fetch = async () => new Response("too many requests", { status: 429 });
    const limited = await fetchTokenCatalog([RECIPIENT], 100);
    assert.equal(limited.ok, false);
    assert.equal(limited.code, "RATE_LIMITED");
  } finally {
    globalThis.fetch = original;
  }
});

test("the holdings route returns every wallet asset and never truncates the list it answers with", () => {
  const source = readFileSync(new URL("../../app/api/solana/holdings/route.ts", import.meta.url), "utf8");

  /* The enrichment cap is a cost boundary on mint reads. It became a cap on
     the answer itself, so a wallet holding sixty-one assets could not select
     the sixty-first at all — the row was not "and 7 more", it was absent. The
     cap stays on what is *detailed*; the list is complete. */
  assert.ok(
    !/holdings[\s\S]{0,200}\.slice\(0, DETAILED\)/.test(source),
    "the returned holdings list must not be sliced to the enrichment cap",
  );
  assert.match(source, /groupSendInventory/, "the route must group accounts into asset rows");
  assert.match(source, /sourceAccounts/, "each asset row must carry its underlying token accounts");
  assert.match(source, /spendableRaw/, "each asset row must state what can actually move");
  assert.match(source, /returned:/, "the response must state how many rows it returned");
  assert.match(source, /held:/, "the response must state how many accounts were read");
  assert.match(
    source,
    /associatedTokenAccount/,
    "the route must mark the canonical associated account so planning can prefer it",
  );
});
