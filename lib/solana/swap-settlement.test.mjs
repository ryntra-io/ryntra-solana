import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ISSUER_PRIVATE_KEY_ENV, loadIssuerKey } from "../agent-control/issuer.ts";
import {
  JUPITER_SWAP_ACTION_REF,
  JUPITER_SWAP_ADAPTER_REF,
} from "../agent-control/adapters/jupiter-swap.ts";
import { AGENT_CONTROL_REGISTRY } from "../agent-control/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { recordSwapSettlementBenefits, swapFeePrice } from "../rewards/swap-settlement.ts";
import { listPointsEntries, pointsSummary } from "../points/ledger.ts";
import { SolanaActionOriginSchema } from "./action-origin.ts";
import { normalizeJupiterExecutableOrder } from "./quotes.ts";
import {
  createSwapExecutionProof,
  swapExecutionDigest,
  verifySwapExecutionProof,
} from "./swap-execution-review.ts";
import { observeSwap } from "./swap-observe.ts";
import { mintSwapOutcomeReceipt } from "./swap-outcome.ts";
import {
  buildSwapReceiptFacts,
  parseSwapReceiptFactsFromEffects,
} from "./swap-receipt.ts";
import { buildSwapQuoteReview } from "./swap-review.ts";
import {
  markSendSubmittedUnknown,
  readSendAttempt,
  reserveSendAttempt,
} from "./send-attempt.ts";
import {
  claimSwapOwnerSignature,
  failSwapOwnerLock,
  markSwapOwnerSubmitted,
  readSwapOwnerLock,
  reserveSwapOwnerReview,
} from "./swap-owner-lock.ts";
import { describeChainError } from "./chain-error.ts";
import { readSignatureStatus } from "./recover.ts";

const FIXTURE_PATH = join("lib", "solana", "fixtures", "jupiter-order-v2-sol-usdc.json");
const TAKER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const OBSERVED_AT = "2026-08-30T12:00:00.000Z";

function issuerEnvironment() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { [ISSUER_PRIVATE_KEY_ENV]: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
}

function executableOrder() {
  const body = {
    ...JSON.parse(readFileSync(FIXTURE_PATH, "utf8")),
    taker: TAKER,
    transaction: "AQIDBAUGBwg=",
    lastValidBlockHeight: "443000000",
  };
  return normalizeJupiterExecutableOrder(body, {
    access: "production",
    latencyMs: 42,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
    expectedTaker: TAKER,
  });
}

function quoteView(order) {
  const {
    schema: _schema,
    execution: _execution,
    taker: _taker,
    transactionBase64: _bytes,
    lastValidBlockHeight: _lastValidBlockHeight,
    ...shared
  } = order;
  return {
    ...shared,
    schema: "ryntra.solana.jupiter-order-quote",
    execution: "NOT_EXECUTED",
    taker: null,
    transactionBase64: null,
  };
}

function sampleBundle() {
  const order = executableOrder();
  const review = buildSwapQuoteReview(quoteView(order), new Date(OBSERVED_AT));
  return {
    review,
    taker: TAKER,
    lastValidBlockHeight: order.lastValidBlockHeight,
    inspection: {
      messageHashHex: "a".repeat(64),
      version: 0,
      feePayer: TAKER,
      signerAddresses: [TAKER],
      providerPresignedCount: 0,
      blockhash: WSOL,
      programs: [MEMO_PROGRAM],
      tokenProgramIndices: [],
      staticAccountCount: 5,
      staticAccounts: [TAKER, USDC, WSOL, MEMO_PROGRAM, "11111111111111111111111111111111"],
      lookupTables: [],
      instructionCount: 3,
      wireBytes: 512,
      nativeWrapRoundTrip: null,
      nativeWrapCandidate: null,
    },
    simulation: {
      status: "OK",
      unitsConsumed: "140000",
      error: null,
      sourceHost: "stub.rpc",
      observedAt: OBSERVED_AT,
      ownerEffects: {
        status: "VERIFIED",
        method: "SIMULATION_OWNER_DELTAS_V1",
        tokenInstructionAudit: "NO_UNSAFE_MUTATIONS",
        nativeWrapRoundTrip: false,
        programs: [MEMO_PROGRAM],
        taker: TAKER,
        inputMint: USDC,
        outputMint: WSOL,
        inputAmountRaw: "1000000",
        outputAmountRaw: "104497",
        minimumOutputRaw: "104497",
        inputRepresentation: "NATIVE_SOL",
        outputRepresentation: "TOKEN",
        feeLamports: "0",
        takerLamportDelta: "-1000000",
        ownerTokenDeltas: [{ mint: USDC, rawDelta: "104497" }],
        accountVectorCount: 5,
      },
    },
    canaryIntent: {
      schema: "ryntra.solana.canary-intent",
      schemaVersion: "1.0.0",
      intentId: `swap:${order.requestId}`,
      revision: 1,
      family: "SWAP",
      network: "mainnet",
      destination: TAKER,
      mints: [USDC, WSOL].sort(),
      programs: [MEMO_PROGRAM],
      principalUsdMicros: "3000000",
      feeReserveUsdMicros: "11018",
      usdMicros: "3011018",
      valuation: {
        method: "PROVIDER_QUOTE",
        sourceRef: "jupiter:price-v3:wsol",
        observedAt: OBSERVED_AT,
        validUntil: "2026-08-30T12:01:00.000Z",
      },
      humanApproval: "NOT_RECORDED",
    },
    canaryVerdict: { decision: "REVIEW", findings: [] },
  };
}

test("execution proof: signs the exact bundle and refuses any changed field", () => {
  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const bundle = sampleBundle();
  const proof = createSwapExecutionProof({ bundle, key });
  assert.equal(proof.status, "SIGNED");
  assert.equal(proof.digest, swapExecutionDigest(bundle));

  const verified = verifySwapExecutionProof({ bundle, proof, trustedPublicKey: key.publicKey });
  assert.deepEqual(verified, { ok: true });

  const tampered = { ...bundle, inspection: { ...bundle.inspection, messageHashHex: "b".repeat(64) } };
  const refused = verifySwapExecutionProof({ bundle: tampered, proof, trustedPublicKey: key.publicKey });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /changed after the proof was issued/);

  const wrongKeyEnvironment = issuerEnvironment();
  const otherKey = loadIssuerKey(wrongKeyEnvironment);
  const foreign = verifySwapExecutionProof({ bundle, proof, trustedPublicKey: otherKey.publicKey });
  assert.equal(foreign.ok, false);
});

test("execution proof: the Spot origin is inside the signed bundle, so it cannot be rewritten between Review and execute", () => {
  /* Same transaction, two things a person could be told they did. The label
     travels with the proof: a bundle with `origin` verifies as itself and
     fails as a Swap, and a Swap bundle fails once someone adds an origin. */
  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const spot = { ...sampleBundle(), origin: { surface: "SPOT", side: "BUY" } };
  const proof = createSwapExecutionProof({ bundle: spot, key });
  assert.deepEqual(verifySwapExecutionProof({ bundle: spot, proof, trustedPublicKey: key.publicKey }), { ok: true });
  assert.equal(verifySwapExecutionProof({ bundle: { ...spot, origin: { surface: "SPOT", side: "SELL" } }, proof, trustedPublicKey: key.publicKey }).ok, false, "the side is signed");
  const { origin: _origin, ...asSwap } = spot;
  assert.equal(verifySwapExecutionProof({ bundle: asSwap, proof, trustedPublicKey: key.publicKey }).ok, false, "dropping the origin changes the digest");
  const swapProof = createSwapExecutionProof({ bundle: asSwap, key });
  assert.equal(verifySwapExecutionProof({ bundle: spot, proof: swapProof, trustedPublicKey: key.publicKey }).ok, false, "adding an origin to a Swap bundle changes the digest");
  assert.ok(SolanaActionOriginSchema.safeParse({ surface: "SPOT", side: "SELL" }).success);
  assert.ok(!SolanaActionOriginSchema.safeParse({ surface: "PERPS", side: "BUY" }).success, "only the surfaces that exist");
  assert.ok(!SolanaActionOriginSchema.safeParse({ surface: "SPOT", side: "BUY", extra: 1 }).success, "and nothing smuggled beside them");
});

test("execution proof: without an issuer key the proof is honestly UNSIGNED", () => {
  const proof = createSwapExecutionProof({ bundle: sampleBundle(), key: null });
  assert.equal(proof.status, "UNSIGNED");
  assert.equal(proof.reasonCode, "NO_ISSUER_KEY_CONFIGURED");
});

test("swap recovery reads one recorded signature and mints a recovery receipt without resubmitting", async () => {
  const recoveryModule = await import("./swap-recovery.ts").catch(() => ({}));
  assert.equal(typeof recoveryModule.recoverSwapOutcome, "function");

  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const bundle = sampleBundle();
  const proof = createSwapExecutionProof({ bundle, key });
  const signature = "N3zXBD2bcRWyRh5bVxs2Tr1z6aWKoobLpTkkxRvoSCJCBZv9z5joMjayx4pPSCz5sGt1UyfLkTQthDLEtS8aVwJ";
  const store = createMemoryGuardStore();
  const reserved = await reserveSendAttempt({
    store,
    network: "mainnet",
    signature,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    at: OBSERVED_AT,
  });
  assert.equal(reserved.ok, true);
  assert.equal((await markSendSubmittedUnknown({ store, network: "mainnet", signature, at: OBSERVED_AT })).ok, true);
  assert.equal((await reserveSwapOwnerReview({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt,
    bundle,
    proof,
    at: OBSERVED_AT,
  })).ok, true);
  assert.equal((await claimSwapOwnerSignature({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    signature,
    at: "2026-08-30T12:00:01.000Z",
  })).ok, true);
  assert.equal((await markSwapOwnerSubmitted({
    store,
    owner: TAKER,
    signature,
    at: "2026-08-30T12:00:02.000Z",
  })).ok, true);

  let submitCalls = 0;
  const result = await recoveryModule.recoverSwapOutcome({
    store,
    bundle,
    proof,
    trustedPublicKey: key.publicKey,
    signature,
    environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => ({
        state: "READ",
        status: { confirmationStatus: "finalized", err: null, seen: true, slot: "442812999" },
      }),
      observe: async () => ({
        ok: true,
        observation: {
          signature,
          slot: "442812999",
          finality: "finalized",
          actualInputRaw: bundle.review.quote.inputRaw,
          actualOutputRaw: bundle.review.quote.quotedOutputRaw,
          baseFeeLamports: bundle.review.quote.signatureFeeLamports,
          priorityFeeLamports: bundle.review.quote.priorityFeeLamports,
          programs: [MEMO_PROGRAM],
          observedAt: OBSERVED_AT,
          source: { ref: "solana:mainnet:recovery:test", label: "Independent recovery test read" },
        },
        feeLamports: "0",
        takerLamportDelta: "-1000000",
      }),
      commitSpend: async () => ({ ok: true }),
      submit: async () => { submitCalls += 1; },
    },
  });
  assert.equal(submitCalls, 0);
  assert.equal(result.state, "RECOVERED");
  assert.equal(result.facts.provider, null);
  /* A recovery that finds the swap did exactly what was reviewed is a late
     answer to a good outcome, not a damaged one — the fixture's observation
     matches the reviewed input and clears its minimum, so the state says so.
     `RECOVERY` is reserved for a read that does NOT reconcile, and the missing
     provider evidence is still recorded as the deviation it is. */
  assert.equal(result.facts.reconciliation.state, "DEVIATION_RECORDED");
  assert.ok(
    result.facts.reconciliation.deviations.includes("PROVIDER_EVIDENCE_UNAVAILABLE"),
    "a recovery without provider evidence must still say so",
  );
  assert.equal(result.receipt.issuer.status, "SIGNED");
  const attempt = await readSendAttempt({ store, network: "mainnet", signature });
  assert.equal(attempt.ok, true);
  assert.equal(attempt.record.state, "RECEIPTED");
  assert.equal(attempt.record.receiptHash, result.receipt.contentHash);
  const repeated = await recoveryModule.recoverSwapOutcome({
    store,
    bundle,
    proof,
    trustedPublicKey: key.publicKey,
    signature,
    environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => { throw new Error("an already receipted recovery must not read RPC again"); },
      observe: async () => { throw new Error("an already receipted recovery must not observe again"); },
      commitSpend: async () => { throw new Error("an already receipted recovery must not commit again"); },
    },
  });
  assert.equal(repeated.state, "ALREADY_RECEIPTED");
  assert.deepEqual(repeated.receipt, result.receipt);
  /* Contract 1.11.0: the figures travel as the fields a fresh recovery carries, read back from the sealed receipt with no chain read. */
  assert.deepEqual(repeated.facts, result.facts);
  assert.deepEqual(repeated.observation, { ...result.observation, serviceFeeCollectedRaw: result.observation.serviceFeeCollectedRaw ?? null });
  // The cached recovery receipt also restores bookkeeping, once, with its
  // original settlement identity even when the re-read happens on another day.
  await recordSwapSettlementBenefits(store, { bundle, receipt: result.receipt, signature, now: OBSERVED_AT, env: {} });
  await recordSwapSettlementBenefits(store, { bundle, receipt: repeated.receipt, signature, now: "2026-08-31T12:00:00.000Z", env: {} });
  assert.equal(pointsSummary(await listPointsEntries(store, TAKER)).trades, 1);
  assert.equal((await store.collection("solanaWalletActions").valuesWithPrefix("")).length, 1);
});

test("fee valuation uses the quote's own mint scale and amount, and refuses an unrelated asset", () => {
  const quote = { inputMint: WSOL, inputRaw: "250000000", inUsdValue: "25.125", outputMint: USDC, quotedOutputRaw: "25000000", outUsdValue: "25", requestId: "price-test", observedAt: OBSERVED_AT };
  assert.equal(swapFeePrice(quote, { asset: WSOL, decimals: null }).price, "100.5");
  assert.equal(swapFeePrice(quote, { asset: USDC, decimals: 6 }).price, "1");
  assert.equal(swapFeePrice(quote, { asset: MEMO_PROGRAM, decimals: 6 }), null);
  assert.equal(swapFeePrice(quote, null), null);
});

test("a signed pre-submit failure unlocks only after the exact blockhash is independently invalid and the signature unseen", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const bundle = sampleBundle();
  const proof = createSwapExecutionProof({ bundle, key });
  const signature = "N3zXBD2bcRWyRh5bVxs2Tr1z6aWKoobLpTkkxRvoSCJCBZv9z5joMjayx4pPSCz5sGt1UyfLkTQthDLEtS8aVwJ";
  const store = createMemoryGuardStore();
  await reserveSwapOwnerReview({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt,
    bundle,
    proof,
    at: OBSERVED_AT,
  });
  await claimSwapOwnerSignature({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    signature,
    at: "2026-08-30T12:00:01.000Z",
  });
  const result = await recoverSwapOutcome({
    store,
    bundle,
    proof,
    trustedPublicKey: key.publicKey,
    signature,
    environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => ({
        state: "READ",
        status: { confirmationStatus: null, err: null, seen: false, slot: null },
      }),
      isBlockhashValid: async () => false,
    },
  });
  assert.equal(result.state, "EXPIRED_BEFORE_SUBMIT");
  assert.equal(result.blockhashValid, false);
  const lock = await readSwapOwnerLock({ store, owner: TAKER });
  assert.equal(lock.ok, true);
  assert.equal(lock.record.state, "EXPIRED_BEFORE_SUBMIT");
});

function stubHandle(fixture) {
  return {
    network: "mainnet",
    host: () => "stub.rpc",
    timeoutMs: 1_000,
    endpoints: [{}],
    retries: 0,
    rpc: {
      getTransaction: () => ({ send: async () => fixture }),
    },
  };
}

test("an unrecorded signature remains pending until its exact issued Review is proven unable to land", async () => {
  const recoveryModule = await import("./swap-recovery.ts");
  assert.equal(typeof recoveryModule.recoverUnrecordedSwap, "function");
  const key = loadIssuerKey(issuerEnvironment());
  const { buildSwapPolicyIntent, evaluateSwapPolicy } = await import("./swap-policy.ts");
  const { SwapExecutionBundleSchema } = await import("./swap-execution-review.ts");
  const sample = sampleBundle();
  const policyIntent = buildSwapPolicyIntent({ order: executableOrder(), programs: [MEMO_PROGRAM] });
  const policyVerdict = evaluateSwapPolicy({ intent: policyIntent, now: new Date(OBSERVED_AT), evidence: {
    inspection: sample.inspection, simulationStatus: "OK", ownerEffects: sample.simulation.ownerEffects,
    outputAssetVerdict: { verdict: "NO_KNOWN_BLOCKER" }, gasless: false,
  } });
  const bundle = SwapExecutionBundleSchema.parse({ ...sample, policyIntent, policyVerdict });
  const proof = createSwapExecutionProof({ bundle, key });
  const signature = "7".repeat(87);
  const store = createMemoryGuardStore();
  await reserveSwapOwnerReview({ store, owner: TAKER, requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`, reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt, bundle, proof, at: OBSERVED_AT });
  const args = { store, owner: TAKER, signature, requestId: bundle.review.quote.requestId,
    handle: stubHandle(null), trustedPublicKey: key.publicKey,
    status: { state: "READ", status: { confirmationStatus: null, err: null, seen: false, slot: null } } };
  for (const [over, wanted] of [
    [{ dependencies: { isBlockhashValid: async () => true } }, "PENDING"],
    [{ dependencies: { isBlockhashValid: async () => { throw new Error("unavailable"); } } }, "PENDING"],
    [{ dependencies: { isBlockhashValid: async () => undefined } }, "PENDING"],
    [{ requestId: "another-review", dependencies: { isBlockhashValid: async () => false } }, "PENDING"],
    [{ requestId: undefined, dependencies: { isBlockhashValid: async () => false } }, "PENDING"],
    [{ dependencies: { isBlockhashValid: async () => false, readStatus: async () => { throw new Error("status unavailable"); } } }, "PENDING"],
    [{ dependencies: { isBlockhashValid: async () => false, readStatus: async () => ({ state: "READ", status: { confirmationStatus: "confirmed", err: null, seen: true, slot: "44" } }) } }, "SEEN_WITHOUT_RECORD"],
    [{ trustedPublicKey: loadIssuerKey(issuerEnvironment()).publicKey, dependencies: { isBlockhashValid: async () => false } }, "PENDING"],
    [{ status: { state: "READ", status: { confirmationStatus: "confirmed", err: null, seen: true, slot: "44" } } }, "SEEN_WITHOUT_RECORD"],
  ]) {
    assert.equal((await recoveryModule.recoverUnrecordedSwap({ ...args, ...over })).state, wanted);
    assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "REVIEW_ISSUED");
  }
  const closed = await recoveryModule.recoverUnrecordedSwap({ ...args, dependencies: { isBlockhashValid: async () => false, readStatus: async () => args.status } });
  assert.equal(closed.state, "UNKNOWN_TO_CHAIN");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "EXPIRED_BEFORE_SUBMIT");
});

test("a signature observed after the expiry check is not recorded as an expired broadcast", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  let reads = 0;
  const result = await recoverSwapOutcome({ store, bundle, proof, trustedPublicKey: key.publicKey,
    environment, signature, handle: stubHandle(null), dependencies: {
      readStatus: async () => ({ state: "READ", status: ++reads === 1
        ? { confirmationStatus: null, err: null, seen: false, slot: null }
        : { confirmationStatus: "confirmed", err: null, seen: true, slot: "443000001" } }),
      isBlockhashValid: async () => false,
    } });
  assert.equal(result.state, "PENDING");
  assert.equal((await readSendAttempt({ store, network: "mainnet", signature })).record.state, "SUBMITTED_UNKNOWN");
});

/** A USDC→SOL swap as the chain reports it: taker pays 3 USDC, receives SOL. */
function landedSwapFixture(overrides = {}) {
  return {
    slot: 442812999,
    meta: {
      err: null,
      fee: 105000,
      preBalances: [1_000_000_000, 0, 0],
      postBalances: [1_027_895_000, 0, 0],
      preTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: TAKER, uiTokenAmount: { amount: "5000000" } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: TAKER, uiTokenAmount: { amount: "2000000" } },
      ],
      ...overrides.meta,
    },
    transaction: {
      message: {
        accountKeys: [TAKER, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", MEMO_PROGRAM],
        instructions: [{ programIdIndex: 2 }],
      },
    },
    ...overrides.top,
  };
}

test("swap observation: derives both legs, the fee split and the programs from the chain alone", async () => {
  const result = await observeSwap(stubHandle(landedSwapFixture()), {
    signature: "5".repeat(87),
    taker: TAKER,
    inputMint: USDC,
    outputMint: WSOL,
    requiredSignatures: 1,
    finality: "confirmed",
  });
  assert.equal(result.ok, true);
  assert.equal(result.observation.actualInputRaw, "3000000");
  /* Lamport delta +27_895_000 plus the 105_000 fee the taker paid. */
  assert.equal(result.observation.actualOutputRaw, "28000000");
  assert.equal(result.observation.baseFeeLamports, "5000");
  assert.equal(result.observation.priorityFeeLamports, "100000");
  assert.deepEqual(result.observation.programs, [MEMO_PROGRAM]);
  assert.equal(result.observation.finality, "confirmed");
});

test("swap observation: a landed failure and an unresolvable leg are refused with named codes", async () => {
  const failed = await observeSwap(
    stubHandle(landedSwapFixture({ meta: { err: { InstructionError: [2, "custom"] }, fee: 105000 } })),
    {
      signature: "5".repeat(87),
      taker: TAKER,
      inputMint: USDC,
      outputMint: WSOL,
      requiredSignatures: 1,
      finality: "confirmed",
    },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "LANDED_FAILED");
  assert.match(failed.chainError, /InstructionError/);

  const unresolved = await observeSwap(
    stubHandle(
      landedSwapFixture({
        meta: {
          err: null,
          fee: 105000,
          preBalances: [1_000_000_000, 0, 0],
          /* Lamports fell: no positive SOL leg can be read for an output. */
          postBalances: [999_000_000, 0, 0],
          preTokenBalances: [],
          postTokenBalances: [],
        },
      }),
    ),
    {
      signature: "5".repeat(87),
      taker: TAKER,
      inputMint: USDC,
      outputMint: WSOL,
      requiredSignatures: 1,
      finality: "confirmed",
    },
  );
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.code, "LEG_UNRESOLVED");
});

test("swap receipt: reconciled facts seal into a signed Outcome Receipt pinned to the Jupiter adapter", () => {
  const order = executableOrder();
  const review = buildSwapQuoteReview(quoteView(order), new Date(OBSERVED_AT));
  const quote = review.quote;
  const signature = "5".repeat(87);
  const observation = {
    signature,
    slot: "442812999",
    finality: "confirmed",
    actualInputRaw: quote.inputRaw,
    actualOutputRaw: quote.quotedOutputRaw,
    baseFeeLamports: quote.signatureFeeLamports,
    priorityFeeLamports: quote.priorityFeeLamports,
    programs: [MEMO_PROGRAM],
    observedAt: OBSERVED_AT,
    source: { ref: "solana:mainnet:rpc:getTransaction/stub", label: "Solana mainnet JSON-RPC (stub)" },
  };
  const facts = buildSwapReceiptFacts({
    review,
    provider: {
      requestId: quote.requestId,
      signature,
      status: "Success",
      inputRaw: quote.inputRaw,
      outputRaw: quote.quotedOutputRaw,
      source: { ref: "jupiter:execute", label: "Jupiter execute", observedAt: OBSERVED_AT },
    },
    observation,
    reconciliation: "MATCHED",
  });
  assert.equal(facts.reconciliation.state, "MATCHED");
  assert.deepEqual(facts.reconciliation.deviations, []);

  const registryEntry = AGENT_CONTROL_REGISTRY.entries.find((entry) => entry.ref === JUPITER_SWAP_ADAPTER_REF);
  assert.ok(registryEntry, "the Jupiter swap adapter must be registered");

  const environment = issuerEnvironment();
  const minted = mintSwapOutcomeReceipt({
    id: `swap:${quote.requestId}`,
    actionPassportHash: `0x${"c".repeat(64)}`,
    facts,
    submissionLane: "JUPITER_EXECUTE",
    environment,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.receipt.kind, "OUTCOME_RECEIPT");
  assert.equal(minted.receipt.outcome.status, "MATCHED");
  assert.equal(minted.receipt.outcome.transactionHash, signature);
  assert.equal(minted.receipt.issuer.status, "SIGNED");
  assert.deepEqual(
    minted.receipt.registry.refs.map((ref) => ref.ref).sort(),
    [JUPITER_SWAP_ACTION_REF, JUPITER_SWAP_ADAPTER_REF].sort(),
  );

  const recovered = parseSwapReceiptFactsFromEffects(minted.receipt.outcome.observedEffects);
  assert.ok(recovered, "the structured facts must survive the effect chunking");
  assert.equal(recovered.quote.inputMint, quote.inputMint);
  assert.equal(recovered.independentObservation.signature, signature);
});

test("an adopted wallet-modified swap receipt pins the own-RPC submission path", () => {
  const order = executableOrder();
  const review = buildSwapQuoteReview(quoteView(order), new Date(OBSERVED_AT));
  const quote = review.quote;
  const signature = "6".repeat(87);
  const facts = buildSwapReceiptFacts({
    review,
    provider: null,
    observation: {
      signature,
      slot: "443400001",
      finality: "confirmed",
      actualInputRaw: quote.inputRaw,
      actualOutputRaw: quote.quotedOutputRaw,
      baseFeeLamports: quote.signatureFeeLamports,
      priorityFeeLamports: quote.priorityFeeLamports,
      programs: [MEMO_PROGRAM],
      observedAt: OBSERVED_AT,
      source: { ref: "solana:mainnet:rpc:getTransaction/stub", label: "Solana mainnet JSON-RPC (stub)" },
    },
    reconciliation: "DEVIATION_RECORDED",
  });

  const minted = mintSwapOutcomeReceipt({
    id: `swap:${quote.requestId}`,
    actionPassportHash: `0x${"d".repeat(64)}`,
    facts,
    submissionLane: "ADOPTED_RPC",
    environment: issuerEnvironment(),
  });
  assert.equal(minted.ok, true);
  assert.deepEqual(
    minted.receipt.registry.refs.map((ref) => ref.ref).sort(),
    ["action:jupiter-swap/order-own-rpc-submit@1", JUPITER_SWAP_ADAPTER_REF].sort(),
  );
  assert.doesNotMatch(minted.receipt.limitations.join(" "), /did not[^.]*\bsubmit\b/i);
});

/**
 * The screen this closes.
 *
 * A signature the wallet signed, the server broadcast, and the chain never
 * took. `getSignatureStatuses` searches transaction history here, so "unseen"
 * is the whole ledger's answer rather than a cache's; put it beside a blockhash
 * that can no longer carry the bytes and the transaction is not undetermined,
 * it is impossible. Before this, that combination had no terminal state: the
 * attempt stayed pending forever and its owner was locked out of the product
 * behind a Recover button whose only possible reply was "not yet".
 */
async function strandedSubmittedAttempt() {
  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const bundle = sampleBundle();
  const proof = createSwapExecutionProof({ bundle, key });
  const signature = "RD582EVGD7rbUyzUd9ubSziG9ATH4NPVkctAbfLR7rvH3AwqduGmAuv1rGabz6noUM1A2LUE5wLRs85xZHvY187";
  const store = createMemoryGuardStore();
  await reserveSendAttempt({
    store,
    network: "mainnet",
    signature,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    at: OBSERVED_AT,
  });
  await markSendSubmittedUnknown({ store, network: "mainnet", signature, at: OBSERVED_AT });
  await reserveSwapOwnerReview({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt,
    bundle,
    proof,
    at: OBSERVED_AT,
  });
  await claimSwapOwnerSignature({
    store,
    owner: TAKER,
    requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    signature,
    at: "2026-08-30T12:00:01.000Z",
  });
  await markSwapOwnerSubmitted({ store, owner: TAKER, signature, at: "2026-08-30T12:00:02.000Z" });
  return { store, bundle, proof, key, environment, signature };
}

test("a broadcast the ledger never saw, past the block that could have carried it, is settled and releases the wallet", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();

  const result = await recoverSwapOutcome({
    store,
    bundle,
    proof,
    trustedPublicKey: key.publicKey,
    signature,
    environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => ({
        state: "READ",
        status: { confirmationStatus: null, err: null, seen: false, slot: null },
      }),
      isBlockhashValid: async () => false,
    },
  });
  assert.equal(result.state, "EXPIRED_AFTER_SUBMIT");
  assert.equal(result.lastValidBlockHeight, bundle.lastValidBlockHeight);

  /* The record still says the bytes went out — history is not rewritten — and
     it may never claim the pre-submit word. */
  const attempt = await readSendAttempt({ store, network: "mainnet", signature });
  assert.equal(attempt.ok, true);
  assert.equal(attempt.record.state, "EXPIRED_AFTER_SUBMIT");

  /* And the point of all of it: the wallet can trade again. */
  const lock = await readSwapOwnerLock({ store, owner: TAKER });
  assert.equal(lock.record.state, "EXPIRED_AFTER_SUBMIT");
  const next = await reserveSwapOwnerReview({
    store,
    owner: TAKER,
    requestId: "req-after-expiry",
    messageDigest: "0x" + "c".repeat(64),
    reviewDigest: "0x" + "d".repeat(64),
    reviewExpiresAt: "2026-08-30T12:05:00.000Z",
    bundle: { exact: "next" },
    proof: { status: "SIGNED", digest: "0x" + "d".repeat(64) },
    at: "2026-08-30T12:04:00.000Z",
  });
  assert.equal(next.ok, true);
});

test("block height answers when the blockhash read cannot, so one flaky call cannot strand a wallet", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const result = await recoverSwapOutcome({
    store,
    bundle,
    proof,
    trustedPublicKey: key.publicKey,
    signature,
    environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => ({
        state: "READ",
        status: { confirmationStatus: null, err: null, seen: false, slot: null },
      }),
      isBlockhashValid: async () => {
        throw new Error("the operator refused the blockhash read");
      },
      readBlockHeight: async () => String(BigInt(bundle.lastValidBlockHeight) + 1n),
    },
  });
  assert.equal(result.state, "EXPIRED_AFTER_SUBMIT");
});

test("a signature that could still land stays pending, and neither read alone may close it", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const unseen = {
    state: "READ",
    status: { confirmationStatus: null, err: null, seen: false, slot: null },
  };

  const live = await strandedSubmittedAttempt();
  const stillOpen = await recoverSwapOutcome({
    store: live.store,
    bundle: live.bundle,
    proof: live.proof,
    trustedPublicKey: live.key.publicKey,
    signature: live.signature,
    environment: live.environment,
    handle: stubHandle(null),
    dependencies: { readStatus: async () => unseen, isBlockhashValid: async () => true },
  });
  assert.equal(stillOpen.state, "PENDING");
  assert.equal(
    (await readSendAttempt({ store: live.store, network: "mainnet", signature: live.signature })).record.state,
    "SUBMITTED_UNKNOWN",
  );

  /* Both reads unavailable is not evidence of anything. */
  const blind = await strandedSubmittedAttempt();
  const unresolved = await recoverSwapOutcome({
    store: blind.store,
    bundle: blind.bundle,
    proof: blind.proof,
    trustedPublicKey: blind.key.publicKey,
    signature: blind.signature,
    environment: blind.environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => unseen,
      isBlockhashValid: async () => {
        throw new Error("unavailable");
      },
      readBlockHeight: async () => {
        throw new Error("unavailable");
      },
    },
  });
  assert.equal(unresolved.state, "PENDING");
  assert.equal(
    (await readSendAttempt({ store: blind.store, network: "mainnet", signature: blind.signature })).record.state,
    "SUBMITTED_UNKNOWN",
  );
});

test("nothing that crossed the submit boundary may ever claim it did not", async () => {
  const { transitionSendAttempt } = await import("./send-attempt.ts");
  const { store, signature } = await strandedSubmittedAttempt();
  const lie = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature,
    to: "EXPIRED_BEFORE_SUBMIT",
    at: "2026-08-30T12:10:00.000Z",
  });
  assert.equal(lie.ok, false);
  assert.equal(
    (await readSendAttempt({ store, network: "mainnet", signature })).record.state,
    "SUBMITTED_UNKNOWN",
  );

  /* And a settled expiry is terminal: it cannot be reopened into a landing. */
  assert.equal(
    (await transitionSendAttempt({
      store,
      network: "mainnet",
      signature,
      to: "EXPIRED_AFTER_SUBMIT",
      at: "2026-08-30T12:11:00.000Z",
    })).ok,
    true,
  );
  const reopened = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature,
    to: "CONFIRMED",
    at: "2026-08-30T12:12:00.000Z",
  });
  assert.equal(reopened.ok, false);
});

/*
 * A swap that landed and failed, as the RPC client hands it over.
 *
 * Production, 2026-09-29: SPCXx → SOL landed finalized with
 * `InstructionError [4, { Custom: 6019 }]`. The client decodes those integers
 * as BigInt, the status read's plain stringify threw inside its own try, and a
 * status that had been read came back as an unavailable operator — so
 * recovery answered PENDING every three seconds for as long as anyone asked,
 * and the wallet behind it could not ask for another Review.
 */
const LANDED_FAILURE = Object.freeze({
  confirmationStatus: "finalized",
  confirmations: null,
  err: { InstructionError: [4n, { Custom: 6019n }] },
  slot: 451560298n,
});

function statusHandle(entry, transaction = null) {
  const handle = {
    network: "mainnet",
    host: () => "stub.rpc",
    timeoutMs: 1_000,
    endpoints: [{}],
    retries: 0,
    transactionReads: 0,
    rpc: {
      getSignatureStatuses: () => ({ send: async () => ({ value: [entry] }) }),
      getTransaction: () => ({
        send: async () => {
          handle.transactionReads += 1;
          return transaction;
        },
      }),
    },
  };
  return handle;
}

test("a chain error carrying BigInt is read as a failure, not as an unavailable operator", async () => {
  assert.equal(describeChainError(LANDED_FAILURE.err), '{"InstructionError":["4",{"Custom":"6019"}]}');
  const read = await readSignatureStatus(statusHandle(LANDED_FAILURE), "5".repeat(87));
  assert.equal(read.state, "READ");
  assert.deepEqual(read.status, {
    confirmationStatus: "finalized",
    err: '{"InstructionError":["4",{"Custom":"6019"}]}',
    seen: true,
    slot: "451560298",
  });

  const observed = await observeSwap(
    stubHandle(landedSwapFixture({ meta: { err: LANDED_FAILURE.err, fee: 133950 } })),
    { signature: "5".repeat(87), taker: TAKER, inputMint: USDC, outputMint: WSOL, requiredSignatures: 1, finality: "finalized" },
  );
  assert.equal(observed.ok, false);
  assert.equal(observed.code, "LANDED_FAILED");
  assert.match(observed.chainError, /6019/);
});

test("a landed failure settles the swap and releases the wallet, once and for good", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const recover = () => recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle(LANDED_FAILURE),
  });

  const result = await recover();
  assert.equal(result.state, "FAILED");
  assert.match(result.chainError, /6019/);
  assert.equal((await readSendAttempt({ store, network: "mainnet", signature })).record.state, "RECOVERY_REQUIRED");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");

  const next = await reserveSwapOwnerReview({
    store,
    owner: TAKER,
    requestId: "req-after-failure",
    messageDigest: "0x" + "c".repeat(64),
    reviewDigest: "0x" + "d".repeat(64),
    reviewExpiresAt: "2026-08-30T12:05:00.000Z",
    bundle: { exact: "next" },
    proof: { status: "SIGNED", digest: "0x" + "d".repeat(64) },
    at: "2026-08-30T12:04:00.000Z",
  });
  assert.equal(next.ok, true);

  /* Asked again after the slot moved on: the same answer, read from the
     archived record rather than from a chain an operator may have pruned, and
     the next Review is left exactly as it was. */
  const pruned = await recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle(null),
  });
  assert.equal(pruned.state, "FAILED");
  assert.equal((await readSendAttempt({ store, network: "mainnet", signature })).record.state, "RECOVERY_REQUIRED");
  const slot = await readSwapOwnerLock({ store, owner: TAKER });
  assert.equal(slot.record.state, "REVIEW_ISSUED");
  assert.equal(slot.record.requestId, "req-after-failure");
});

test("a confirmed failure settles the same way as a finalized one", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const result = await recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle({ ...LANDED_FAILURE, confirmationStatus: "confirmed" }),
  });
  assert.equal(result.state, "FAILED");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");
});

test("a failure only one validator has seen is asked of the transaction, and settles nothing until it is there", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const handle = statusHandle({ ...LANDED_FAILURE, confirmationStatus: "processed" }, null);
  const result = await recoverSwapOutcome({ store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment, handle });
  assert.equal(result.state, "PENDING");
  assert.equal(handle.transactionReads, 1);
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "SUBMITTED_UNKNOWN");
});

test("a failure whose status names no level settles once the transaction read finds it failed", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const handle = statusHandle(
    { ...LANDED_FAILURE, confirmationStatus: undefined },
    landedSwapFixture({ meta: { err: LANDED_FAILURE.err, fee: 133950 } }),
  );
  const result = await recoverSwapOutcome({ store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment, handle });
  assert.equal(result.state, "FAILED");
  assert.match(result.chainError, /6019/);
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");
});

test("a landed failure the server never recorded as sent still settles and releases the wallet", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const environment = issuerEnvironment();
  const key = loadIssuerKey(environment);
  const bundle = sampleBundle();
  const proof = createSwapExecutionProof({ bundle, key });
  const signature = "8".repeat(87);
  const store = createMemoryGuardStore();
  await reserveSwapOwnerReview({ store, owner: TAKER, requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`, reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt, bundle, proof, at: OBSERVED_AT });
  await claimSwapOwnerSignature({ store, owner: TAKER, requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`, reviewDigest: proof.digest, signature,
    at: "2026-08-30T12:00:01.000Z" });

  const result = await recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle(LANDED_FAILURE),
  });
  assert.equal(result.state, "FAILED");
  assert.equal((await readSendAttempt({ store, network: "mainnet", signature })).record.state, "RECOVERY_REQUIRED");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");
});

test("a wallet that cannot be released now is refused, not reported failed, and the next check releases it", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const unavailable = {
    ...store,
    versioned(name) {
      const collection = store.versioned(name);
      return name === "solanaSwapOwnerLocks"
        ? { ...collection, compareAndSet: async () => { throw new Error("the owner store is down"); } }
        : collection;
    },
  };
  const refused = await recoverSwapOutcome({
    store: unavailable, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle(LANDED_FAILURE),
  });
  assert.equal(refused.state, "REFUSED");
  assert.equal(refused.code, "OWNER_SWAP_LOCK_UNAVAILABLE");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "SUBMITTED_UNKNOWN");

  const settled = await recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: statusHandle(LANDED_FAILURE),
  });
  assert.equal(settled.state, "FAILED");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");
});

test("execute settles a landed failure, waits for a venue's Failed, and both cards read it as an outcome", () => {
  /* The execute route's settle half runs in the swap's steps of the core pipeline. */
  const route = readFileSync(join("lib", "core", "solana-swap", "settle.ts"), "utf8");
  const landed = route.slice(route.indexOf('observed.code === "LANDED_FAILED"'), route.indexOf('return refusal(409, "LANDED_FAILED"'));
  assert.match(landed, /failSwapOwnerLock\(\{ store, owner: bundle\.taker, signature/);
  assert.match(route, /if \(!seen && \(\(ownBroadcast && delivered\) \|\| venueFailed\)\)/);

  for (const path of [
    join("app", "solana", "workspace", "trade", "swap-card.tsx"),
    join("app", "solana", "workspace", "spot", "use-spot-ticket.ts"),
  ]) {
    const source = readFileSync(path, "utf8");
    const landedAt = source.indexOf('executed.failure.code === "LANDED_FAILED"');
    const unknownAt = source.indexOf('transitionSwapClientAttempt(pending, { kind: "FAILURE" })');
    assert.ok(landedAt > 0 && landedAt < unknownAt, `${path} reads a landed failure before the unknown`);
    const block = source.slice(landedAt, unknownAt);
    assert.match(block, /forgetAttempt\(\)/, path);
    assert.match(block, /state: "FAILED"/, path);
    assert.match(block, /setPhase\("SETTLED"\)/, path);
  }
});

test("a failure the transaction read finds, behind a clean status, releases the wallet too", async () => {
  const { recoverSwapOutcome } = await import("./swap-recovery.ts");
  const { store, bundle, proof, key, environment, signature } = await strandedSubmittedAttempt();
  const result = await recoverSwapOutcome({
    store, bundle, proof, trustedPublicKey: key.publicKey, signature, environment,
    handle: stubHandle(null),
    dependencies: {
      readStatus: async () => ({ state: "READ", status: { confirmationStatus: "confirmed", err: null, seen: true, slot: "451560298" } }),
      observe: async () => ({ ok: false, code: "LANDED_FAILED", chainError: '{"InstructionError":["4",{"Custom":"6019"}]}', reason: "The transaction landed and failed; the chain moved no swap value." }),
    },
  });
  assert.equal(result.state, "FAILED");
  assert.equal((await readSwapOwnerLock({ store, owner: TAKER })).record.state, "FAILED");
});

test("only the matching signed attempt can settle as failed, and settling twice changes nothing", async () => {
  const { store, bundle, proof, signature } = await strandedSubmittedAttempt();
  const at = "2026-08-30T12:03:00.000Z";
  assert.equal((await failSwapOwnerLock({ store, owner: TAKER, signature: "9".repeat(87), at })).code, "OWNER_SWAP_LOCK_MISMATCH");
  const first = await failSwapOwnerLock({ store, owner: TAKER, signature, at });
  assert.equal(first.ok, true);
  assert.equal(first.record.state, "FAILED");
  const again = await failSwapOwnerLock({ store, owner: TAKER, signature, at: "2026-08-30T12:04:00.000Z" });
  assert.equal(again.ok, true);
  assert.equal(again.record.version, first.record.version);

  /* A landing proves the bytes left even when the record never heard they did. */
  const signedOnly = createMemoryGuardStore();
  await reserveSwapOwnerReview({ store: signedOnly, owner: TAKER, requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`, reviewDigest: proof.digest,
    reviewExpiresAt: bundle.review.quote.reviewExpiresAt, bundle, proof, at: OBSERVED_AT });
  assert.equal((await failSwapOwnerLock({ store: signedOnly, owner: TAKER, signature, at })).code, "OWNER_SWAP_LOCK_MISMATCH");
  await claimSwapOwnerSignature({ store: signedOnly, owner: TAKER, requestId: bundle.review.quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`, reviewDigest: proof.digest, signature,
    at: "2026-08-30T12:00:01.000Z" });
  assert.equal((await failSwapOwnerLock({ store: signedOnly, owner: TAKER, signature, at })).record.state, "FAILED");
});
