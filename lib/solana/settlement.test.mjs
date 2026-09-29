/** Exact reviewed-plan handoff and recovery at the sole submit boundary. */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import test from "node:test";

import {
  getAddressDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";

import { NATIVE_SOL_TRANSFER_ACTION_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { ISSUER_PRIVATE_KEY_ENV, loadIssuerKey } from "../agent-control/issuer.ts";
import { buildSendCanaryIntent } from "./canary-send.ts";
import { SolanaCanaryVerdictSchema, solanaCanaryIntentDigest } from "./canary-policy.ts";
import { buildNativeSolPreflight, buildNativeSolTransaction, SYSTEM_PROGRAM_ADDRESS } from "./native-sol.ts";
import { evaluateNativeSolPolicy } from "./policy.ts";
import { createIndependentReadHandle, createSolanaRpcHandle } from "./rpc.ts";
import { createSendReviewProof } from "./review-proof.ts";

/* On the ed25519 curve. `5Q544fKrFoe6…pge4j1` is off-curve — no key can sign
   for it — so native SOL to that address is now refused at build time. */
const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const SIGNATURE = "5".repeat(88);
const NOW = new Date("2026-08-27T08:00:00.000Z");

function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    address: getAddressDecoder().decode(new Uint8Array(raw)),
    sign: (message) => new Uint8Array(signBytes(null, Buffer.from(message), privateKey)),
  };
}

function walletSign(plan, wallet) {
  const decoded = getTransactionDecoder().decode(Buffer.from(plan.unsignedWireBase64, "base64"));
  return Buffer.from(
    getTransactionEncoder().encode({
      messageBytes: decoded.messageBytes,
      signatures: { ...decoded.signatures, [wallet.address]: wallet.sign(decoded.messageBytes) },
    }),
  ).toString("base64");
}

const POLICY = {
  schema: "ryntra.solana.owner-policy",
  schemaVersion: "0.1.0",
  allowedNetworks: ["mainnet"],
  allowedMints: "ANY",
  allowedTokenPrograms: ["SPL_TOKEN", "TOKEN_2022"],
  acceptPermanentDelegate: false,
  transferHookAllowlist: "NONE_ALLOWED",
  maxFeeBasisPoints: 100,
  maxFeeRaw: null,
  recipientAllowlist: "ANY",
  maxAmountRaw: null,
  maxEvidenceAgeSeconds: 300,
  acceptDefaultFrozenAccounts: false,
  requireHumanApproval: false,
};

async function candidate() {
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
    const input = {
      schemaVersion: "1.0.0",
      actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
      network: "mainnet",
      sender: String(wallet.address),
      recipient: RECIPIENT,
      amountRaw: "1000000",
    };
    const built = await buildNativeSolTransaction({
      handle: createSolanaRpcHandle({ network: "mainnet" }),
      input,
      now: NOW,
    });
    assert.equal(built.ok, true);
    const preflight = buildNativeSolPreflight({
      input,
      plan: built.plan,
      simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "500" },
      observedAt: NOW.toISOString(),
    });
    const verdict = evaluateNativeSolPolicy({ policy: POLICY, input, preflight, now: NOW });
    const provider = { role: "primary", host: "solana-rpc.publicnode.com" };
    const canaryIntent = buildSendCanaryIntent({ plan: built.plan, humanApproval: "RECORDED" });
    const canaryVerdict = SolanaCanaryVerdictSchema.parse({
      schema: "ryntra.solana.canary-verdict",
      schemaVersion: "1.0.0",
      decision: "ALLOW",
      newRiskAllowed: true,
      /* The verdict says whether the action was inside the envelope it judges,
         because the verdict is signed into evidence and a decision with no
         scope beside it reads as a refusal somebody overrode. */
      scope: {
        status: "INSIDE_ENVELOPE",
        decidedBy: "OWNER_CANARY",
        detail: "This action is inside the envelope the owner canary reserves for, and this verdict decides it.",
      },
      policyId: "owner-mainnet-canary-v1",
      policyDigest: "0x" + "1".repeat(64),
      intentDigest: solanaCanaryIntentDigest(canaryIntent),
      budgetObservedAt: NOW.toISOString(),
      findings: [
        "CONFIG_VALID",
        "EMERGENCY_STOP",
        "MAINNET_ONLY",
        "DESTINATION_ALLOWLISTED",
        "MINTS_ALLOWLISTED",
        "PROGRAMS_ALLOWLISTED",
        "VALUATION_CURRENT",
        "FAMILY_LIMIT",
        "TOTAL_LIMIT",
        "HUMAN_APPROVAL",
      ].map((rule) => ({ rule, outcome: "PASS", detail: `${rule} passed in the settlement fixture.` })),
      evaluatedAt: NOW.toISOString(),
    });
    const { privateKey } = generateKeyPairSync("ed25519");
    const issuerKey = loadIssuerKey({
      [ISSUER_PRIVATE_KEY_ENV]: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    });
    assert.ok(issuerKey);
    const reviewProof = createSendReviewProof({
      bundle: { plan: built.plan, preflight, verdict, provider, canaryIntent, canaryVerdict },
      key: issuerKey,
      now: NOW,
    });
    return {
      wallet,
      issuerKey,
      trustedPublicKey: issuerKey.publicKey,
      request: {
        plan: built.plan,
        preflight,
        verdict,
        provider,
        canaryIntent,
        canaryVerdict,
        reviewProof,
        signedWireBase64: walletSign(built.plan, wallet),
      },
    };
  } finally {
    globalThis.fetch = original;
  }
}

function nativeObservation(sender) {
  return {
    ok: true,
    observation: {
      schemaVersion: "1.0.0",
      actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
      network: "mainnet",
      signature: SIGNATURE,
      slot: "350123456",
      blockTime: NOW.toISOString(),
      feeLamports: "5000",
      balanceDeltas: [],
      lamportBalanceDeltas: [
        { account: sender, rawDelta: "-1005000" },
        { account: RECIPIENT, rawDelta: "1000000" },
      ],
      sources: [{ ref: `solana:mainnet:rpc:getTransaction/${SIGNATURE}`, label: "Solana mainnet JSON-RPC" }],
      observedAt: NOW.toISOString(),
    },
    transactionSucceeded: true,
    transactionError: null,
    observedEffects: [
      { description: "The transaction succeeded on mainnet.", sourceRef: "solana:test", observedAt: NOW.toISOString() },
      { description: `Account ${sender} sent 1000000 lamports.`, sourceRef: "solana:test", observedAt: NOW.toISOString() },
      { description: `Account ${RECIPIENT} received 1000000 lamports.`, sourceRef: "solana:test", observedAt: NOW.toISOString() },
    ],
  };
}

test("settlement validates the signed bytes against the exact reviewed native plan", async () => {
  const { validateSettlementCandidate } = await import("./settlement.ts");
  const built = await candidate();
  const valid = validateSettlementCandidate(built.request, { trustedPublicKey: built.trustedPublicKey });
  assert.equal(valid.ok, true);
  assert.equal(valid.plan, built.request.plan);

  const repricedPlan = { ...built.request.plan, priorityFeeLamports: "75000" };
  const repricedPreflight = {
    ...built.request.preflight,
    networkFeeLamports: "80000",
  };
  const repricedProof = createSendReviewProof({
    bundle: {
      plan: repricedPlan,
      preflight: repricedPreflight,
      verdict: built.request.verdict,
      provider: built.request.provider,
      canaryIntent: built.request.canaryIntent,
      canaryVerdict: built.request.canaryVerdict,
    },
    key: built.issuerKey,
    now: NOW,
  });
  const repriced = validateSettlementCandidate(
    {
      ...built.request,
      plan: repricedPlan,
      preflight: repricedPreflight,
      reviewProof: repricedProof,
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(repriced.ok, true);

  const tampered = validateSettlementCandidate(
    {
      ...built.request,
      plan: { ...built.request.plan, recipient: String(built.wallet.address) },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, "PLAN_INVALID");

  const feeMismatch = validateSettlementCandidate(
    {
      ...built.request,
      preflight: { ...built.request.preflight, networkFeeLamports: "6000" },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(feeMismatch.ok, false);
  assert.equal(feeMismatch.code, "REVIEW_PROOF_INVALID");

  const forgedProgram = validateSettlementCandidate(
    {
      ...built.request,
      plan: {
        ...built.request.plan,
        mint: RECIPIENT,
        tokenProgram: RECIPIENT,
        programs: [RECIPIENT],
        fingerprint: {
          ...built.request.plan.fingerprint,
          transfer: {
            ...built.request.plan.fingerprint.transfer,
            mint: RECIPIENT,
            programAddress: RECIPIENT,
          },
          /* Both, because the schema now requires the single-leg projection to
             be the first leg. Rewriting one and not the other is caught a
             layer earlier, which the next case proves on its own. */
          transfers: built.request.plan.fingerprint.transfers.map((leg, index) =>
            index === 0 ? { ...leg, mint: RECIPIENT, programAddress: RECIPIENT } : leg,
          ),
        },
      },
      preflight: { ...built.request.preflight, mint: RECIPIENT },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(forgedProgram.ok, false);
  assert.equal(forgedProgram.code, "REVIEW_PROOF_INVALID");

  /* A fingerprint whose single-leg projection disagrees with its own first leg
     is refused before any signature is examined: the two fields describe the
     same instruction, so a plan where they differ describes nothing. */
  const inconsistentLegs = validateSettlementCandidate(
    {
      ...built.request,
      plan: {
        ...built.request.plan,
        fingerprint: {
          ...built.request.plan.fingerprint,
          transfer: { ...built.request.plan.fingerprint.transfer, amountRaw: "999" },
        },
      },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(inconsistentLegs.ok, false);
  assert.equal(inconsistentLegs.code, "PLAN_INVALID");

  const changedProvider = validateSettlementCandidate(
    {
      ...built.request,
      provider: { role: "fallback", host: "different.example" },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(changedProvider.ok, false);
  assert.equal(changedProvider.code, "REVIEW_PROOF_INVALID");

  const changedCanary = validateSettlementCandidate(
    {
      ...built.request,
      canaryVerdict: {
        ...built.request.canaryVerdict,
        decision: "PAUSE",
        newRiskAllowed: false,
      },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(changedCanary.ok, false);
  assert.equal(changedCanary.code, "REVIEW_PROOF_INVALID");

  const mismatchedCanaryVerdict = {
    ...built.request.canaryVerdict,
    intentDigest: "0x" + "4".repeat(64),
  };
  const mismatchedCanaryProof = createSendReviewProof({
    bundle: {
      plan: built.request.plan,
      preflight: built.request.preflight,
      verdict: built.request.verdict,
      provider: built.request.provider,
      canaryIntent: built.request.canaryIntent,
      canaryVerdict: mismatchedCanaryVerdict,
    },
    key: built.issuerKey,
    now: NOW,
  });
  const internallyMismatchedCanary = validateSettlementCandidate(
    {
      ...built.request,
      canaryVerdict: mismatchedCanaryVerdict,
      reviewProof: mismatchedCanaryProof,
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(internallyMismatchedCanary.ok, false);
  assert.equal(internallyMismatchedCanary.code, "REVIEW_PROOF_INVALID");
  assert.match(internallyMismatchedCanary.reason, /intent digest/i);

  const changedIssuedAt = validateSettlementCandidate(
    {
      ...built.request,
      reviewProof: { ...built.request.reviewProof, issuedAt: "2026-08-27T08:00:01.000Z" },
    },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(changedIssuedAt.ok, false);
  assert.equal(changedIssuedAt.code, "REVIEW_PROOF_INVALID");

  const callerReceiptId = validateSettlementCandidate(
    { ...built.request, receiptId: "caller-controlled" },
    { trustedPublicKey: built.trustedPublicKey },
  );
  assert.equal(callerReceiptId.ok, false);
  assert.equal(callerReceiptId.code, "PLAN_INVALID");
});

test("settlement carries the exact plan through submit, observe and receipt", async () => {
  const { settleSignedTransfer } = await import("./settlement.ts");
  const built = await candidate();
  const calls = [];
  const result = await settleSignedTransfer({
    request: built.request,
    trustedPublicKey: built.trustedPublicKey,
    dependencies: {
      submit: async (args) => {
        calls.push(["submit", args.plan]);
        return {
          ok: true,
          signature: SIGNATURE,
          submittedAt: NOW.toISOString(),
          confirmation: { slot: "350123456", status: "confirmed", err: null },
        };
      },
      currentBlockHeight: async () => "349999999",
      recover: async () => {
        throw new Error("recovery must not run after a confirmed submit");
      },
      observe: async (args) => {
        calls.push(["observe", args.actionRef]);
        return nativeObservation(String(built.wallet.address));
      },
      mint: (args) => {
        calls.push(["mint", args.plan]);
        assert.equal(args.reviewDigest, built.request.reviewProof.digest);
        return {
          ok: true,
          receipt: { id: "server-owned" },
          reconciliation: { status: "MATCHED", matched: 3, expected: 3, findings: [], unexpected: [] },
          sendReceiptFacts: { reconciliation: "MATCHED" },
        };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, "RECEIPTED");
  assert.equal(result.landingState, "CONFIRMED");
  assert.equal(calls[0][1], built.request.plan);
  assert.equal(calls[1][1], NATIVE_SOL_TRANSFER_ACTION_REF);
  assert.equal(calls[2][1], built.request.plan);
});

test("an uncertain submit reads signature status first and never submits again", async () => {
  const { settleSignedTransfer } = await import("./settlement.ts");
  const built = await candidate();
  const calls = [];
  const result = await settleSignedTransfer({
    request: built.request,
    trustedPublicKey: built.trustedPublicKey,
    dependencies: {
      submit: async () => {
        calls.push("submit");
        return { ok: false, code: "NOT_CONFIRMED", reason: "not confirmed", signature: SIGNATURE };
      },
      currentBlockHeight: async () => "349999999",
      recover: async (args) => {
        calls.push("recover");
        assert.equal(args.signature, SIGNATURE);
        return {
          state: "UNKNOWN",
          facts: {
            signature: SIGNATURE,
            status: { confirmationStatus: null, err: null, seen: false, slot: null },
            blockHeight: "349999999",
            lastValidBlockHeight: built.request.plan.lastValidBlockHeight,
          },
          effectReadback: { state: "READ", value: { ok: false, code: "NOT_FOUND" } },
        };
      },
      observe: async () => {
        calls.push("observe");
        throw new Error("UNKNOWN must not be observed as settled");
      },
      mint: () => {
        calls.push("mint");
        throw new Error("UNKNOWN has no receipt");
      },
    },
  });
  assert.deepEqual(calls, ["submit", "recover"]);
  assert.equal(result.ok, true);
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.signature, SIGNATURE);
  assert.equal(result.receipt, null);
  assert.deepEqual(result.effectReadback, { state: "READ", value: { ok: false, code: "NOT_FOUND" } });
});

test("an expired reviewed blockhash returns to Review before the one-shot submit", async () => {
  const { settleSignedTransfer } = await import("./settlement.ts");
  const built = await candidate();
  let submitted = false;
  const result = await settleSignedTransfer({
    request: built.request,
    trustedPublicKey: built.trustedPublicKey,
    dependencies: {
      currentBlockHeight: async () => String(BigInt(built.request.plan.lastValidBlockHeight) + 1n),
      submit: async () => {
        submitted = true;
        throw new Error("expired plan must not submit");
      },
      recover: async () => {
        throw new Error("nothing was submitted");
      },
      observe: async () => {
        throw new Error("nothing was submitted");
      },
      mint: () => {
        throw new Error("nothing was submitted");
      },
    },
  });
  assert.equal(submitted, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, "PLAN_EXPIRED");
});

test("one absolute settlement deadline bounds pre-submit reads before any broadcast", { timeout: 500 }, async () => {
  const { settleSignedTransfer } = await import("./settlement.ts");
  const built = await candidate();
  let submitted = false;
  const result = await settleSignedTransfer({
    request: built.request,
    trustedPublicKey: built.trustedPublicKey,
    deadlineAt: Date.now() + 20,
    dependencies: {
      currentBlockHeight: async () => await new Promise(() => {}),
      submit: async () => {
        submitted = true;
        throw new Error("deadline must stop before submit");
      },
      recover: async () => {
        throw new Error("nothing was submitted");
      },
      observe: async () => {
        throw new Error("nothing was submitted");
      },
      mint: () => {
        throw new Error("nothing was submitted");
      },
    },
  });
  assert.equal(submitted, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, "REQUEST_DEADLINE");
});

test("settlement read-back uses a provider independent from the one-shot submit endpoint", () => {
  const submitHandle = createSolanaRpcHandle({
    network: "mainnet",
    endpoint: "https://primary.example",
    fallbackEndpoint: "https://independent.example",
    retries: 4,
  });
  const readHandle = createIndependentReadHandle(submitHandle);
  assert.ok(readHandle);
  assert.equal(readHandle.endpoint, "https://independent.example");
  assert.equal(readHandle.endpoints.length, 1);
  assert.equal(readHandle.retries, 0);

  const noFallback = createSolanaRpcHandle({
    network: "devnet",
    endpoint: "https://only.example",
    fallbackEndpoint: null,
  });
  assert.equal(createIndependentReadHandle(noFallback), null);
});
