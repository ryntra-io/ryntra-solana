/**
 * Observation, reconciliation and the receipt — the half after the signature.
 *
 * The transaction responses here are shaped exactly as a Solana JSON-RPC
 * `getTransaction` reply, so the normaliser, the delta arithmetic and the
 * schema all run for real; only the transport is stood in for. The case that
 * matters most is the last one: the same real transaction, reconciled against
 * an expectation that is wrong by one base unit, must record
 * `DEVIATION_RECORDED` and not round itself into a match.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import { ISSUER_PRIVATE_KEY_ENV } from "../agent-control/issuer.ts";
import { verifyAgentArtifact } from "../agent-control/verify.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "./canary-policy.ts";
import { decodeRawMintAccount } from "./mint.ts";
import { buildNativeSolPreflight, SYSTEM_PROGRAM_ADDRESS } from "./native-sol.ts";
import { observeTransfer } from "./observe.ts";
import { expectedEffectsFor, mintSolanaOutcomeReceipt } from "./outcome.ts";
import { buildPassport } from "./passport.ts";
import { buildTransferPreflight } from "./preflight.ts";
import { verifySolanaOutcomeReceipt } from "./receipt.ts";
import { createSolanaRpcHandle } from "./rpc.ts";
import { TOKEN_PROGRAM_ID } from "./send-kinds.ts";
import { COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM } from "./wallet-modification.ts";

const SIGNATURE = "5".repeat(88);
const SENDER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const RECIPIENT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const SENDER_ATA = "GfVPzUxMDvhFJ1Xs6C9i3ZUUeqxT2vJcBpTLtvVMEcAP";
const RECIPIENT_ATA = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const NOW = new Date("2026-08-17T20:00:00.000Z");
const REVIEW_DIGEST = `0x${"a".repeat(64)}`;

const raw = { ...JSON.parse(readFileSync(new URL("./fixtures/usdc-spl.json", import.meta.url), "utf8")), network: "devnet" };
const MINT = raw.mint;

function throwawayEnvironment() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { [ISSUER_PRIVATE_KEY_ENV]: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
}

/** A `getTransaction` reply in the cluster's own shape. */
function transactionReply({
  amount = 1_000_000,
  err = null,
  includeDeltas = true,
  fee = 5_000,
  recipientAtaRent = 2_039_280,
  includePrograms = true,
  includeRecipientOwner = true,
} = {}) {
  const reply = {
    slot: 350123456,
    blockTime: Math.floor(NOW.getTime() / 1000),
    meta: {
      err,
      fee,
      preBalances: [5_000_000_000, 2_039_280, 0],
      postBalances: [5_000_000_000 - fee - recipientAtaRent, 2_039_280, recipientAtaRent],
      preTokenBalances: includeDeltas
        ? [
            {
              accountIndex: 1,
              mint: MINT,
              owner: SENDER,
              programId: TOKEN_PROGRAM_ID,
              uiTokenAmount: { amount: "5000000", decimals: 6 },
            },
          ]
        : [],
      postTokenBalances: includeDeltas
        ? [
            {
              accountIndex: 1,
              mint: MINT,
              owner: SENDER,
              programId: TOKEN_PROGRAM_ID,
              uiTokenAmount: { amount: String(5_000_000 - amount), decimals: 6 },
            },
            {
              accountIndex: 2,
              mint: MINT,
              ...(includeRecipientOwner ? { owner: RECIPIENT } : {}),
              programId: TOKEN_PROGRAM_ID,
              uiTokenAmount: { amount: String(amount), decimals: 6 },
            },
          ]
        : [],
    },
    transaction: {
      message: {
        accountKeys: [
          SENDER,
          SENDER_ATA,
          RECIPIENT_ATA,
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          String(SYSTEM_PROGRAM_ADDRESS),
        ],
        instructions: includePrograms
          ? [{ programIdIndex: 3 }, { programIdIndex: 4 }]
          : [],
      },
    },
  };
  if (includePrograms) {
    reply.meta.innerInstructions = [{ instructions: [{ programIdIndex: 5 }, { programIdIndex: 4 }] }];
  }
  return reply;
}

function walletAugmentedAtaTransactionReply() {
  const reply = transactionReply({ amount: 500_000, fee: 80_000 });
  reply.transaction.message.accountKeys = [
    SENDER,
    SENDER_ATA,
    RECIPIENT_ATA,
    COMPUTE_BUDGET_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    LIGHTHOUSE_PROGRAM,
    String(SYSTEM_PROGRAM_ADDRESS),
  ];
  reply.transaction.message.instructions = [
    { programIdIndex: 3 },
    { programIdIndex: 4 },
    { programIdIndex: 5 },
    { programIdIndex: 6 },
  ];
  reply.meta.innerInstructions = [
    { instructions: [{ programIdIndex: 7 }, { programIdIndex: 5 }] },
  ];
  return reply;
}

/**
 * The first owner-signed transfer: the recipient already holds this token.
 *
 * No account is created, so no rent moves, no Associated Token Program appears
 * in the message and no System CPI appears inside it. The recipient ATA is
 * rent-funded before the transfer and unchanged in lamports after it — the
 * whole point of the case is that the only thing that moves is the token.
 */
function existingAtaTransactionReply({ amount = 1_000_000, fee = 5_000, augmented = false } = {}) {
  const RECIPIENT_HELD = 250_000;
  const keys = augmented
    ? [SENDER, SENDER_ATA, RECIPIENT_ATA, COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM_ID, LIGHTHOUSE_PROGRAM]
    : [SENDER, SENDER_ATA, RECIPIENT_ATA, TOKEN_PROGRAM_ID];
  const instructions = augmented
    ? [{ programIdIndex: 3 }, { programIdIndex: 4 }, { programIdIndex: 5 }]
    : [{ programIdIndex: 3 }];
  return {
    slot: 350123458,
    blockTime: Math.floor(NOW.getTime() / 1000),
    meta: {
      err: null,
      fee,
      preBalances: [5_000_000_000, 2_039_280, 2_039_280],
      postBalances: [5_000_000_000 - fee, 2_039_280, 2_039_280],
      preTokenBalances: [
        {
          accountIndex: 1,
          mint: MINT,
          owner: SENDER,
          programId: TOKEN_PROGRAM_ID,
          uiTokenAmount: { amount: "5000000", decimals: 6 },
        },
        {
          accountIndex: 2,
          mint: MINT,
          owner: RECIPIENT,
          programId: TOKEN_PROGRAM_ID,
          uiTokenAmount: { amount: String(RECIPIENT_HELD), decimals: 6 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint: MINT,
          owner: SENDER,
          programId: TOKEN_PROGRAM_ID,
          uiTokenAmount: { amount: String(5_000_000 - amount), decimals: 6 },
        },
        {
          accountIndex: 2,
          mint: MINT,
          owner: RECIPIENT,
          programId: TOKEN_PROGRAM_ID,
          uiTokenAmount: { amount: String(RECIPIENT_HELD + amount), decimals: 6 },
        },
      ],
    },
    transaction: { message: { accountKeys: keys, instructions } },
  };
}

function nativeTransactionReply({ amount = 1_000_000, err = null } = {}) {
  return {
    slot: 350123457,
    blockTime: Math.floor(NOW.getTime() / 1000),
    meta: {
      err,
      fee: 5000,
      preBalances: [5_000_000, 1_000, 1],
      postBalances: [5_000_000 - amount - 5_000, 1_000 + amount, 1],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: {
      message: {
        accountKeys: [SENDER, RECIPIENT, SYSTEM_PROGRAM_ADDRESS],
        instructions: [{ programIdIndex: 2 }],
      },
    },
  };
}

function stubGetTransaction(result) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return () => { globalThis.fetch = original; };
}

async function observe(reply, actionRef = SPL_TRANSFER_ACTION_REF) {
  const restore = stubGetTransaction(reply);
  try {
    return await observeTransfer(createSolanaRpcHandle({ network: "devnet" }), SIGNATURE, { now: NOW, actionRef });
  } finally {
    restore();
  }
}

function planAndPreflight({ amountRaw = "1000000" } = {}) {
  const read = decodeRawMintAccount(raw);
  const built = buildPassport(raw);
  const input = {
    schemaVersion: "1.0.0",
    actionRef: SPL_TRANSFER_ACTION_REF,
    network: "devnet",
    mint: MINT,
    sender: SENDER,
    recipient: RECIPIENT,
    amountRaw,
  };
  const preflight = buildTransferPreflight({ read, passport: built.passport, input });
  assert.equal(preflight.ok, true);
  const plan = {
    network: "devnet",
    mint: MINT,
    tokenProgram: built.passport.identity.programId,
    decimals: 6,
    sender: SENDER,
    recipient: RECIPIENT,
    recipientOwner: RECIPIENT,
    senderTokenAccount: SENDER_ATA,
    recipientTokenAccount: RECIPIENT_ATA,
    actionKind: "TOKEN_ATA_CREATE",
    createsRecipientAccount: true,
    ataRentLamports: "2039280",
    amountRaw,
    senderBalanceRaw: "5000000",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [ASSOCIATED_TOKEN_PROGRAM_ID, built.passport.identity.programId],
    blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    lastValidBlockHeight: "350000000",
    unsignedWireBase64: "",
    fingerprint: {
      messageHash: `0x${"a".repeat(64)}`,
      feePayer: SENDER,
      blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
      instructionCount: 2,
      transfer: {
        programAddress: built.passport.identity.programId,
        source: SENDER_ATA,
        mint: MINT,
        destination: RECIPIENT_ATA,
        authority: SENDER,
        amountRaw,
        decimals: 6,
      },
    },
    builtAt: NOW.toISOString(),
  };
  return { plan, preflight: preflight.preflight };
}

function nativePlanAndPreflight({ amountRaw = "1000000" } = {}) {
  const plan = {
    network: "devnet",
    mint: SYSTEM_PROGRAM_ADDRESS,
    tokenProgram: SYSTEM_PROGRAM_ADDRESS,
    decimals: 9,
    sender: SENDER,
    recipient: RECIPIENT,
    senderTokenAccount: SENDER,
    recipientTokenAccount: RECIPIENT,
    actionKind: "NATIVE_SOL",
    createsRecipientAccount: false,
    ataRentLamports: null,
    amountRaw,
    senderBalanceRaw: "5000000",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [SYSTEM_PROGRAM_ADDRESS],
    blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    lastValidBlockHeight: "350000000",
    unsignedWireBase64: "",
    fingerprint: {
      messageHash: `0x${"b".repeat(64)}`,
      feePayer: SENDER,
      blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
      instructionCount: 1,
      transfer: {
        programAddress: SYSTEM_PROGRAM_ADDRESS,
        source: SENDER,
        mint: SYSTEM_PROGRAM_ADDRESS,
        destination: RECIPIENT,
        authority: SENDER,
        amountRaw,
        decimals: 9,
      },
    },
    builtAt: NOW.toISOString(),
  };
  const preflight = buildNativeSolPreflight({
    input: {
      schemaVersion: "1.0.0",
      actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
      network: "devnet",
      sender: SENDER,
      recipient: RECIPIENT,
      amountRaw,
    },
    plan,
    simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "500" },
    observedAt: NOW.toISOString(),
  });
  return { plan, preflight };
}

test("the observation is built from the transaction's own balances, not a later read", async function () {
  const observed = await observe(transactionReply());
  assert.equal(observed.ok, true, observed.ok ? "" : observed.reason);
  assert.equal(observed.transactionSucceeded, true);
  assert.equal(observed.observation.signature, SIGNATURE);
  assert.equal(observed.observation.slot, "350123456");
  assert.equal(observed.observation.feeLamports, "5000");
  assert.equal(observed.observation.blockTime, NOW.toISOString());

  const deltas = Object.fromEntries(observed.observation.balanceDeltas.map((d) => [d.account, d.rawDelta]));
  assert.equal(deltas[SENDER_ATA], "-1000000");
  assert.equal(deltas[RECIPIENT_ATA], "1000000");
  const lamports = Object.fromEntries(observed.observation.lamportBalanceDeltas.map((d) => [d.account, d.rawDelta]));
  assert.equal(lamports[SENDER], "-2044280");
  assert.equal(lamports[RECIPIENT_ATA], "2039280");
  assert.deepEqual(observed.invokedPrograms, [
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    String(SYSTEM_PROGRAM_ADDRESS),
  ]);
  assert.deepEqual(
    observed.postTokenAccounts.find((entry) => entry.account === RECIPIENT_ATA),
    {
      account: RECIPIENT_ATA,
      mint: MINT,
      owner: RECIPIENT,
      tokenProgram: TOKEN_PROGRAM_ID,
      amountRaw: "1000000",
      decimals: 6,
    },
  );
  /* Every number carries where it was read from. */
  assert.equal(observed.observation.sources.length, 1);
  assert.match(observed.observation.sources[0].ref, /getTransaction/);
});

test("native SOL read-back records transaction-local lamport deltas and Send facts exclude the network fee", async () => {
  const observed = await observe(nativeTransactionReply(), NATIVE_SOL_TRANSFER_ACTION_REF);
  assert.equal(observed.ok, true, observed.ok ? "" : observed.reason);
  assert.equal(observed.observation.actionRef, NATIVE_SOL_TRANSFER_ACTION_REF);
  const lamports = Object.fromEntries(observed.observation.lamportBalanceDeltas.map((d) => [d.account, d.rawDelta]));
  assert.equal(lamports[SENDER], "-1005000");
  assert.equal(lamports[RECIPIENT], "1000000");

  const { sendFactsFrom } = await import("./send-receipt.ts");
  const { plan, preflight } = nativePlanAndPreflight();
  const facts = sendFactsFrom({
    plan,
    preflight,
    observed,
    finality: "confirmed",
    reconciliation: "MATCHED",
    reviewDigest: REVIEW_DIGEST,
  });
  assert.equal(facts.actualDebitRaw, "-1000000");
  assert.equal(facts.actualCreditRaw, "1000000");
  assert.equal(facts.baseFeeLamports, "5000");
  assert.equal(facts.priorityFeeLamports, "0");
  assert.deepEqual(facts.programs, [SYSTEM_PROGRAM_ADDRESS]);
});

test("native SOL reconciles from independent lamport effects and issues verifier-bound Send facts", async () => {
  const observed = await observe(nativeTransactionReply(), NATIVE_SOL_TRANSFER_ACTION_REF);
  assert.equal(observed.ok, true, observed.ok ? "" : observed.reason);
  const { plan, preflight } = nativePlanAndPreflight();
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_native_devnet_test",
    actionPassportHash: `0x${"6".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    finality: "confirmed",
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "MATCHED");
  assert.equal(minted.sendReceiptFacts.actualDebitRaw, "-1000000");
  assert.equal(minted.sendReceiptFacts.actualCreditRaw, "1000000");
  assert.equal(minted.sendReceiptFacts.finality, "confirmed");
  const full = verifyAgentArtifact(minted.receipt);
  assert.equal(full.integrity.valid, true);
  assert.equal(full.issuer.verdict, "SIGNATURE_VALID");
});

test("a failed transaction that moved nothing is still a complete observation", async function () {
  /* The case that found a real contract defect: the observation schema
     required at least one balance delta, so a transaction that landed and
     failed — moving nothing, which is the honest outcome this product exists
     to record — could not be expressed at all. */
  const observed = await observe(transactionReply({ err: { InstructionError: [1, { Custom: 1 }] }, includeDeltas: false }));
  assert.equal(observed.ok, true);
  assert.equal(observed.transactionSucceeded, false);
  assert.match(observed.transactionError, /InstructionError/);
  assert.deepEqual(observed.observation.balanceDeltas, []);
  assert.equal(observed.observedEffects.length, 1);
  assert.match(observed.observedEffects[0].description, /The transaction failed on devnet/);
  /* An empty movement list is not an absent observation: the fee was still
     charged and the source still names where it was read. */
  assert.equal(observed.observation.feeLamports, "5000");
  assert.equal(observed.observation.sources.length, 1);
});

test("a transaction the cluster has never seen is NOT_FOUND, not an error", async function () {
  const observed = await observe(null);
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "NOT_FOUND");
  assert.match(observed.reason, /may not have landed/);
});

test("expectations are written from the plan and the preflight, and refuse to disagree", function () {
  const { plan, preflight } = planAndPreflight();
  const good = expectedEffectsFor({ plan, preflight });
  assert.equal(good.ok, true);
  assert.equal(good.effects.length, 3);
  assert.match(good.effects[0], /The transaction succeeded on devnet\./);
  assert.match(good.effects[1], new RegExp(`Account ${SENDER_ATA} sent 1000000 base units`));
  assert.match(good.effects[2], new RegExp(`Account ${RECIPIENT_ATA} received 1000000 base units`));

  const mismatched = expectedEffectsFor({ plan, preflight: { ...preflight, amountRequestedRaw: "2000000" } });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.code, "PLAN_PREFLIGHT_DISAGREE");
});

test("a transfer that did exactly what was expected reconciles MATCHED and signs", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply());

  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_test",
    actionPassportHash: `0x${"1".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "MATCHED");
  assert.equal(minted.reconciliation.matched, 7);
  assert.equal(minted.reconciliation.expected, 7);
  assert.deepEqual(minted.reconciliation.unexpected, []);
  assert.equal(minted.receipt.outcome.status, "MATCHED");

  /* The receipt has to verify on both readings, and the signature has to cover
     the bytes that shipped — a failure once recorded was a second mint
     stamping a new timestamp under an old signature. */
  const bounded = verifySolanaOutcomeReceipt(minted.receipt);
  assert.equal(bounded.integrity.valid, true);
  assert.equal(bounded.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(bounded.binding.verdict, "SOLANA_PINNED");
  assert.equal(bounded.outcome.network, "devnet");
  const full = verifyAgentArtifact(minted.receipt);
  assert.equal(full.integrity.valid, true);
  assert.equal(full.issuer.verdict, "SIGNATURE_VALID");

  const { parseSendReceiptFactsFromEffects } = await import("./send-receipt.ts");
  const sendFacts = parseSendReceiptFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.ok(sendFacts);
  assert.equal(sendFacts.actionKind, "TOKEN_ATA_CREATE");
  assert.equal(sendFacts.actualDebitRaw, "-1000000");
  assert.equal(sendFacts.actualCreditRaw, "1000000");
  assert.equal(sendFacts.reconciliation, "MATCHED");
});

/**
 * Gate M1's own shape, which no test covered.
 *
 * Every `MATCHED` case in this file built a `TOKEN_ATA_CREATE` plan — the M1B
 * canary — so the one question M1 turns on, whether a transfer into an account
 * that already exists reconciles without a deviation, was answered by nothing.
 * A later edit to the ATA expectation or the program set could break the
 * ordinary Send lane with the whole suite green.
 */
test("the M1 shape — an existing recipient account, no rent, no creation — reconciles MATCHED", async function () {
  const base = planAndPreflight();
  const plan = {
    ...base.plan,
    actionKind: "SPL_TRANSFER_CHECKED",
    createsRecipientAccount: false,
    ataRentLamports: null,
    programs: [TOKEN_PROGRAM_ID],
  };
  const observed = await observe(existingAtaTransactionReply());

  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_m1_shape",
    actionPassportHash: `0x${"2".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight: base.preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "MATCHED");
  assert.deepEqual(minted.reconciliation.unexpected, []);
  assert.equal(minted.reconciliation.matched, minted.reconciliation.expected);
  assert.equal(minted.receipt.outcome.status, "MATCHED");

  const { parseSendReceiptFactsFromEffects } = await import("./send-receipt.ts");
  const facts = parseSendReceiptFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.ok(facts);
  assert.equal(facts.actionKind, "SPL_TRANSFER_CHECKED");
  assert.equal(facts.actualDebitRaw, "-1000000");
  assert.equal(facts.actualCreditRaw, "1000000");
  assert.equal(facts.reconciliation, "MATCHED");

  const verified = verifySolanaOutcomeReceipt(minted.receipt);
  assert.equal(verified.integrity.valid, true);
  assert.equal(verified.issuer.verdict, "SIGNATURE_VALID");
});

/** The same shape as a real wallet will sign it: a compute budget and guards. */
test("the M1 shape still reconciles MATCHED once a wallet adds its own guards", async function () {
  const base = planAndPreflight();
  const plan = {
    ...base.plan,
    actionKind: "SPL_TRANSFER_CHECKED",
    createsRecipientAccount: false,
    ataRentLamports: null,
    priorityFeeLamports: "75000",
    programs: [COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM_ID, LIGHTHOUSE_PROGRAM],
    walletAugmentation: {
      computeUnitLimit: 200000,
      microLamportsPerUnit: "375000",
      maximumPriorityFeeLamports: "75000",
      lighthouseAssertions: [{ kind: "ASSERT_TOKEN_ACCOUNT_MULTI", account: RECIPIENT_ATA }],
    },
  };
  const observed = await observe(existingAtaTransactionReply({ fee: 80_000, augmented: true }));

  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_m1_wallet_shape",
    actionPassportHash: `0x${"3".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight: base.preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "MATCHED");
  assert.deepEqual(minted.reconciliation.unexpected, []);
});

test("an issued verifier-valid Send receipt binds the exact nonzero Review digest and explicit no-augmentation facts", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply());
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_digest_bound",
    actionPassportHash: `0x${"7".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.sendReceiptFacts.reviewDigest, REVIEW_DIGEST);
  assert.deepEqual(minted.sendReceiptFacts.augmentation, {
    status: "NONE",
    summary: "The signed message matched the reviewed plan without wallet augmentation.",
  });
  assert.deepEqual(minted.sendReceiptFacts.plannedAta, {
    createsRecipientAccount: true,
    rentLamports: "2039280",
  });
  assert.deepEqual(minted.sendReceiptFacts.observedAta, {
    created: true,
    rentLamports: "2039280",
    owner: RECIPIENT,
    tokenProgram: TOKEN_PROGRAM_ID,
    rentPayer: SENDER,
  });
  assert.deepEqual(minted.sendReceiptFacts.observedPrograms, [
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    String(SYSTEM_PROGRAM_ADDRESS),
  ]);
  assert.equal(minted.sendReceiptFacts.plannedBaseFeeLamports, "5000");
  assert.equal(minted.sendReceiptFacts.actualBaseFeeLamports, "5000");
  assert.equal(minted.sendReceiptFacts.plannedPriorityFeeLamports, "0");
  assert.equal(minted.sendReceiptFacts.actualPriorityFeeLamports, "0");

  const bounded = verifySolanaOutcomeReceipt(minted.receipt);
  assert.equal(bounded.integrity.valid, true);
  const { parseSendReceiptFactsFromEffects } = await import("./send-receipt.ts");
  const factsFromSignedReceipt = parseSendReceiptFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.ok(factsFromSignedReceipt);
  assert.equal(factsFromSignedReceipt.reviewDigest, REVIEW_DIGEST);
});

test("an M1B-sized ATA transfer records the actual 500000 USDC credit and all creation evidence", async function () {
  const { plan, preflight } = planAndPreflight({ amountRaw: "500000" });
  const observed = await observe(transactionReply({ amount: 500_000 }));
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_m1b_shape",
    actionPassportHash: `0x${"7".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.sendReceiptFacts.schemaVersion, "1.2.0");
  assert.equal(minted.sendReceiptFacts.actualCreditRaw, "500000");
  assert.deepEqual(minted.sendReceiptFacts.observedAta, {
    created: true,
    rentLamports: "2039280",
    owner: RECIPIENT,
    tokenProgram: TOKEN_PROGRAM_ID,
    rentPayer: SENDER,
  });
  assert.deepEqual(minted.sendReceiptFacts.observedPrograms, [
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    String(SYSTEM_PROGRAM_ADDRESS),
  ]);
});

test("the production Phantom ATA shape reconciles its observed fee split and expected System CPI", async function () {
  const base = planAndPreflight({ amountRaw: "500000" });
  const plan = {
    ...base.plan,
    priorityFeeLamports: "75000",
    programs: [
      COMPUTE_BUDGET_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      LIGHTHOUSE_PROGRAM,
    ],
    walletAugmentation: {
      computeUnitLimit: 200000,
      microLamportsPerUnit: "375000",
      maximumPriorityFeeLamports: "75000",
      lighthouseAssertions: [
        { kind: "ASSERT_ACCOUNT_INFO_MULTI", account: RECIPIENT_ATA },
        { kind: "ASSERT_TOKEN_ACCOUNT_MULTI", account: RECIPIENT_ATA },
      ],
    },
  };
  const observed = await observe(walletAugmentedAtaTransactionReply());
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_m1b_production_shape",
    actionPassportHash: `0x${"7".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight: base.preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "MATCHED");
  assert.equal(minted.reconciliation.matched, 7);
  assert.deepEqual(minted.reconciliation.unexpected, []);
  assert.equal(minted.sendReceiptFacts.augmentation.status, "PRESENT");
  assert.equal(minted.sendReceiptFacts.actualBaseFeeLamports, "5000");
  assert.equal(minted.sendReceiptFacts.actualPriorityFeeLamports, "75000");
  assert.ok(minted.sendReceiptFacts.observedPrograms.includes(String(SYSTEM_PROGRAM_ADDRESS)));
});

test("a nonzero Review digest, actual fee components and observed ATA rent are reconciliation requirements", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply({ fee: 5_001, recipientAtaRent: 2_039_281 }));
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_fee_rent_deviation",
    actionPassportHash: `0x${"8".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    augmentation: {
      status: "PRESENT",
      summary: "A wallet-added compute-price instruction charged one lamport of priority fee.",
      actualPriorityFeeLamports: "1",
    },
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "DEVIATION_RECORDED");
  assert.equal(minted.receipt.outcome.status, "DEVIATION_RECORDED");
  assert.equal(minted.sendReceiptFacts.actualBaseFeeLamports, "5000");
  assert.equal(minted.sendReceiptFacts.actualPriorityFeeLamports, "1");
  assert.equal(minted.sendReceiptFacts.observedAta.rentLamports, "2039281");
});

test("ATA creation is not claimed when the independent read lacks its programs or owner", async function () {
  const { plan, preflight } = planAndPreflight();
  for (const [index, reply] of [
    transactionReply({ includePrograms: false }),
    transactionReply({ includeRecipientOwner: false }),
  ].entries()) {
    const observed = await observe(reply);
    assert.equal(observed.ok, true);
    const minted = mintSolanaOutcomeReceipt({
      id: `outcome_solana_incomplete_ata_${index}`,
      actionPassportHash: `0x${"8".repeat(64)}`,
      reviewDigest: REVIEW_DIGEST,
      plan,
      preflight,
      observed,
      environment: throwawayEnvironment(),
      now: NOW,
    });
    assert.equal(minted.ok, true);
    assert.equal(minted.reconciliation.status, "DEVIATION_RECORDED");
    assert.equal(minted.sendReceiptFacts.observedAta.created, false);
  }
});

test("receipt issuance rejects an all-zero Review digest", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply());
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_zero_digest",
    actionPassportHash: `0x${"9".repeat(64)}`,
    reviewDigest: `0x${"0".repeat(64)}`,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });

  assert.equal(minted.ok, false);
  assert.equal(minted.code, "MINT_FAILED");
  assert.match(minted.reason, /nonzero Review digest/i);
});

test("the same real transaction against a wrong expectation records DEVIATION, not a rounded MATCH", async function () {
  /* One base unit off. The transfer happened, the transaction succeeded, and
     two of three expectations still match — which is exactly the shape that
     tempts a reconciliation to call the whole thing fine. */
  const { plan, preflight } = planAndPreflight({ amountRaw: "1000001" });
  const observed = await observe(transactionReply({ amount: 1_000_000 }));

  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_deviation",
    actionPassportHash: `0x${"2".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.reconciliation.status, "DEVIATION_RECORDED");
  assert.equal(minted.receipt.outcome.status, "DEVIATION_RECORDED");
  assert.equal(minted.reconciliation.matched, 5);
  assert.equal(minted.reconciliation.expected, 7);
  /* And what nobody expected is named rather than dropped. */
  assert.equal(minted.reconciliation.unexpected.length, 2);
  assert.ok(minted.reconciliation.unexpected.some((line) => line.includes("1000000 base units")));

  const bounded = verifySolanaOutcomeReceipt(minted.receipt);
  assert.equal(bounded.integrity.valid, true);
  assert.equal(bounded.issuer.verdict, "SIGNATURE_VALID");
});

test("a failed transaction cannot reconcile as MATCHED however the descriptions line up", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply({ err: { InstructionError: [1, "InvalidAccountData"] } }));

  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_failed",
    actionPassportHash: `0x${"3".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.outcome.status, "FAILED");
});

test("with no issuer key the receipt is explicitly unsigned, never fabricated", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply());
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_unsigned",
    actionPassportHash: `0x${"4".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan,
    preflight,
    observed,
    environment: {},
    now: NOW,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.issuer.status, "UNSIGNED");
  assert.equal(minted.receipt.issuer.reasonCode, "NO_ISSUER_KEY_CONFIGURED");
  const bounded = verifySolanaOutcomeReceipt(minted.receipt);
  assert.equal(bounded.integrity.valid, true);
  assert.equal(bounded.issuer.verdict, "UNSIGNED");
});

test("expectations that cannot be written stop the mint rather than inventing them", async function () {
  const { plan, preflight } = planAndPreflight();
  const observed = await observe(transactionReply());
  const minted = mintSolanaOutcomeReceipt({
    id: "outcome_solana_devnet_mismatch",
    actionPassportHash: `0x${"5".repeat(64)}`,
    reviewDigest: REVIEW_DIGEST,
    plan: { ...plan, network: "mainnet" },
    preflight,
    observed,
    environment: throwawayEnvironment(),
    now: NOW,
  });
  assert.equal(minted.ok, false);
  assert.equal(minted.code, "NO_EXPECTATIONS");
});
