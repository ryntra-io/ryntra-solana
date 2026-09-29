// Run from repo root: node --test lib/guard/evidence-coverage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

/* Moved unchanged from `lib/guard/strategic-delta.test.mjs`, whose other tests
   drive the separate project's transfer adapter and moved with it. This one
   needs only the kernel. */

const HASH_A = `0x${"ab".repeat(32)}`;
const HASH_B = `0x${"cd".repeat(32)}`;
const WALLET = "0x1111111111111111111111111111111111111111";

test("provider-neutral evidence fields are explicit and unavailable coverage cannot allow policy", async () => {
  const [{ EvidenceItemSchema }, { evaluateGuardReadiness }] = await Promise.all([
    import("./contracts.ts"),
    import("./kernel.ts"),
  ]);
  const evidence = EvidenceItemSchema.parse({
    schemaVersion: "1.0.0",
    id: "ev_provider_neutral_001",
    provider: "Circle App Kit",
    sourceRef: "circle-app-kit:estimateSwap",
    adapter: "circle-app-kit",
    adapterVersion: "1.11.0",
    sourceType: "SWAP_QUOTE",
    observedAt: "2026-08-06T11:59:30.000Z",
    receivedAt: "2026-08-06T11:59:31.000Z",
    validUntil: "2026-08-06T12:01:30.000Z",
    confidence: "PROVIDER_REPORTED",
    coverage: {
      subjectRefs: ["eip155:5042002"],
      fields: ["amountIn", "expectedAmountOut", "minimumAmountOut"],
      limitations: ["UNDERLYING_ROUTE_UNAVAILABLE"],
    },
    availability: "AVAILABLE",
    verificationStatus: "PROVIDER_REPORTED",
    chainRef: "eip155:5042002",
    blockRef: null,
    transactionRef: null,
    status: "VALID",
    requestHash: HASH_A,
    responseHash: HASH_B,
    responseDigest: HASH_B,
    reason: null,
    transformationVersion: "arc-swap-quote-v1",
    fallbackUsed: false,
    facts: {
      quoteRef: "quote_arc_001",
      providerRef: "circle-app-kit",
      routeRef: "circle-app-kit:swap",
      venueRef: "circle-app-kit",
      recipientAddress: WALLET,
      sellAssetRef: "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
      buyAssetRef: "eip155:5042002/erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a",
      amountIn: "10.00",
      expectedAmountOut: "9.96",
      minimumAmountOut: "9.94",
      feeAmount: "0.02",
      feeAssetRef: "eip155:5042002/erc20:0x3600000000000000000000000000000000000000",
      totalDebit: "10.02",
      slippageBps: "20",
    },
  });

  assert.equal(evidence.responseDigest, evidence.responseHash);
  assert.equal(
    EvidenceItemSchema.safeParse({ ...evidence, responseDigest: HASH_A }).success,
    false,
  );

  const policy = {
    rules: [
      { id: "allowed-chain", type: "ALLOWED_CHAIN", value: "eip155:5042002" },
      {
        id: "allowed-pair",
        type: "ALLOWED_PAIR",
        value: [evidence.facts.sellAssetRef, evidence.facts.buyAssetRef],
      },
      {
        id: "max-total-debit",
        type: "MAX_TOTAL_DEBIT",
        value: "100.00",
        currencyAssetRef: evidence.facts.sellAssetRef,
      },
      { id: "max-quote-age", type: "MAX_QUOTE_AGE_SECONDS", value: 120 },
      { id: "max-slippage", type: "MAX_SLIPPAGE_BPS", value: "25" },
      { id: "human-auth", type: "HUMAN_AUTHORIZATION_REQUIRED", value: true },
    ],
  };
  const intent = {
    actionType: "SWAP",
    chainRef: "eip155:5042002",
    sellAssetRef: evidence.facts.sellAssetRef,
    buyAssetRef: evidence.facts.buyAssetRef,
    amount: evidence.facts.amountIn,
    leverage: null,
    recipient: WALLET,
    venueRef: evidence.facts.venueRef,
    routeRef: evidence.facts.routeRef,
    quoteRef: evidence.facts.quoteRef,
    expiresAt: "2026-08-06T12:02:00.000Z",
  };
  const allowed = evaluateGuardReadiness({
    intent,
    evidence: [evidence],
    policy,
    now: "2026-08-06T12:00:00.000Z",
  });
  assert.equal(allowed.evidenceStatus, "COMPLETE");
  assert.equal(allowed.policyDecision, "ALLOWED_BY_POLICY");
  assert.equal(allowed.executionStatus, "NOT_STARTED");

  const unavailable = evaluateGuardReadiness({
    intent,
    evidence: [
      {
        ...evidence,
        availability: "UNAVAILABLE",
        status: "UNAVAILABLE",
        reason: "PROVIDER_TIMEOUT",
      },
    ],
    policy,
    now: "2026-08-06T12:00:00.000Z",
  });
  assert.equal(unavailable.evidenceStatus, "UNAVAILABLE");
  assert.equal(unavailable.policyDecision, "INSUFFICIENT_EVIDENCE");
  assert.notEqual(unavailable.policyDecision, "ALLOWED_BY_POLICY");
});
