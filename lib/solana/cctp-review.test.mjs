import assert from "node:assert/strict";
import test from "node:test";

import {
  SolanaCanaryBudgetSnapshotSchema,
  resolveSolanaCanaryPolicy,
} from "./canary-policy.ts";
import { buildCctpPrecanaryReview } from "./cctp-review.ts";

const NOW = new Date("2026-08-27T14:00:00.000Z");
const SOLANA_WALLET = "AdSHK6vpQnwHRSw7jXUwjMEytmhFwnynZSENhvpAxL1y";
const BASE_WALLET = "0x1111111111111111111111111111111111111111";
const BASE_DESTINATION = `eip155:8453:${BASE_WALLET}`;
const SOLANA_CCTP_PROGRAM = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
const BASE_CCTP_PROGRAM = "eip155:8453:0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

function provider({ allowanceRaw = "123999999999", available = true } = {}) {
  if (!available) {
    const unavailable = { state: "UNAVAILABLE", code: "UNREACHABLE_FROM_ENVIRONMENT", status: 403 };
    return {
      schema: "ryntra.solana.cctp-provider-snapshot",
      schemaVersion: "1.0.0",
      provider: "CIRCLE_IRIS_V2",
      environment: "MAINNET",
      direction: "SOLANA_TO_BASE",
      sourceDomain: 5,
      destinationDomain: 6,
      health: "UNAVAILABLE",
      reason: "UNREACHABLE_FROM_ENVIRONMENT",
      publicKeys: unavailable,
      allowance: unavailable,
      fees: unavailable,
      observedAt: NOW.toISOString(),
      source: { host: "iris-api.circle.com", ref: "circle:cctp-v2:mainnet:5->6" },
    };
  }
  return {
    schema: "ryntra.solana.cctp-provider-snapshot",
    schemaVersion: "1.0.0",
    provider: "CIRCLE_IRIS_V2",
    environment: "MAINNET",
    direction: "SOLANA_TO_BASE",
    sourceDomain: 5,
    destinationDomain: 6,
    health: "HEALTHY",
    reason: null,
    publicKeys: { state: "AVAILABLE", observedAt: NOW.toISOString() },
    allowance: {
      state: "AVAILABLE",
      observedAt: NOW.toISOString(),
      allowance: { allowanceUsdc: "123999.999999", allowanceRaw, lastUpdated: NOW.toISOString() },
    },
    fees: {
      state: "AVAILABLE",
      observedAt: NOW.toISOString(),
      tiers: [
        { mode: "FAST", finalityThreshold: 1000, minimumFeeBps: "1" },
        { mode: "STANDARD", finalityThreshold: 2000, minimumFeeBps: "0" },
      ],
    },
    observedAt: NOW.toISOString(),
    source: { host: "iris-api.circle.com", ref: "circle:cctp-v2:mainnet:5->6" },
  };
}

function policy(state = "PAUSED") {
  const result = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: state,
    RYNTRA_SOLANA_CANARY_BRIDGE_DESTINATIONS: `${SOLANA_WALLET},${BASE_DESTINATION}`,
    RYNTRA_SOLANA_CANARY_CCTP_PROGRAMS: `${SOLANA_CCTP_PROGRAM},${BASE_CCTP_PROGRAM}`,
  });
  assert.equal(result.ok, true);
  return result.policy;
}

function budget(selectedPolicy = policy()) {
  return SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    policyId: selectedPolicy.policyId,
    readState: "AVAILABLE",
    storeBoundary: "DURABLE_MULTI_WRITER",
    totalLimitUsdMicros: selectedPolicy.totalLimitUsdMicros,
    reservedUsdMicros: "0",
    spentUsdMicros: "0",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "0",
    families: Object.fromEntries(["SEND", "ATA_CREATE", "SWAP", "CCTP", "TOKEN_2022"].map((family) => [family, {
      reservedUsdMicros: "0",
      spentUsdMicros: "0",
    }])),
    observedAt: NOW.toISOString(),
  });
}

const INPUT = {
  direction: "SOLANA_TO_BASE",
  sourceWallet: SOLANA_WALLET,
  destinationRecipient: BASE_WALLET,
  amountRaw: "2000000",
  speed: "FAST",
  humanApproval: "NOT_RECORDED",
};

test("the review renders every §12.1 field and keeps unknown gas outside the quoted fee", () => {
  const selectedPolicy = policy();
  const review = buildCctpPrecanaryReview({
    input: INPUT,
    provider: provider(),
    policy: selectedPolicy,
    budget: budget(selectedPolicy),
    now: NOW,
  });
  assert.equal(review.lane.source.chainRef, "solana:mainnet");
  assert.equal(review.lane.destination.chainRef, "eip155:8453");
  assert.equal(review.lane.source.asset.representation, "NATIVE_USDC");
  assert.equal(review.lane.destination.asset.representation, "NATIVE_USDC");
  assert.equal(review.provider, "CIRCLE_CCTP_V2");
  assert.equal(review.amountRaw, "2000000");
  assert.equal(review.fees.protocolFeeRaw, "200");
  assert.equal(review.fees.relayerFeeRaw, null);
  assert.equal(review.fees.destinationGasRaw, null);
  assert.equal(review.expectedReceiveRaw, "1999800");
  assert.equal(review.speed.requested, "FAST");
  assert.equal(review.speed.effective, "FAST");
  assert.equal(review.speed.finalityThreshold, 1000);
  assert.equal(review.approvals.ownerSignature, "NOT_REQUESTED");
  assert.equal(review.execution, "NOT_BUILT");
  assert.equal(review.recovery.secondBurnAllowed, false);
  assert.equal(review.canaryVerdict.decision, "PAUSE");
  assert.equal(review.canaryIntent.family, "CCTP");
  assert.deepEqual(review.canaryIntent.mints, [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ]);
});

test("insufficient Fast allowance falls back explicitly to Standard and never calls it instant", () => {
  const selectedPolicy = policy();
  const review = buildCctpPrecanaryReview({
    input: INPUT,
    provider: provider({ allowanceRaw: "1000000" }),
    policy: selectedPolicy,
    budget: budget(selectedPolicy),
    now: NOW,
  });
  assert.equal(review.speed.requested, "FAST");
  assert.equal(review.speed.effective, "STANDARD");
  assert.equal(review.speed.fallbackReason, "FAST_ALLOWANCE_INSUFFICIENT");
  assert.equal(review.speed.finalityThreshold, 2000);
  assert.equal(review.fees.protocolFeeRaw, "0");
  assert.equal(review.expectedReceiveRaw, "2000000");
  assert.doesNotMatch(JSON.stringify(review), /guaranteed.?instant/i);
});

test("unread provider facts remain UNKNOWN and never become zero", () => {
  const selectedPolicy = policy();
  const review = buildCctpPrecanaryReview({
    input: INPUT,
    provider: provider({ available: false }),
    policy: selectedPolicy,
    budget: budget(selectedPolicy),
    now: NOW,
  });
  assert.equal(review.decision, "UNKNOWN");
  assert.equal(review.fees.protocolFeeRaw, null);
  assert.equal(review.expectedReceiveRaw, null);
  assert.equal(review.speed.effective, null);
  assert.equal(review.findings.some((finding) => finding.code === "PROVIDER_FACTS_UNAVAILABLE"), true);
});

test("invalid recipients and values outside the 2–5 USDC proof range are blocked", () => {
  const selectedPolicy = policy();
  for (const input of [
    { ...INPUT, destinationRecipient: SOLANA_WALLET },
    { ...INPUT, amountRaw: "1999999" },
    { ...INPUT, amountRaw: "5000001" },
  ]) {
    const review = buildCctpPrecanaryReview({
      input,
      provider: provider(),
      policy: selectedPolicy,
      budget: budget(selectedPolicy),
      now: NOW,
    });
    assert.equal(review.decision, "BLOCK", JSON.stringify(input));
  }
});

test("the reverse lane validates Base as source and Solana as destination", () => {
  const selectedPolicy = policy();
  const reverseProvider = { ...provider(), direction: "BASE_TO_SOLANA", sourceDomain: 6, destinationDomain: 5 };
  const review = buildCctpPrecanaryReview({
    input: {
      direction: "BASE_TO_SOLANA",
      sourceWallet: BASE_WALLET,
      destinationRecipient: SOLANA_WALLET,
      amountRaw: "3000000",
      speed: "STANDARD",
      humanApproval: "RECORDED",
    },
    provider: reverseProvider,
    policy: selectedPolicy,
    budget: budget(selectedPolicy),
    now: NOW,
  });
  assert.equal(review.lane.source.chainRef, "eip155:8453");
  assert.equal(review.lane.destination.chainRef, "solana:mainnet");
  assert.equal(review.sourceWallet, BASE_WALLET);
  assert.equal(review.destinationRecipient, SOLANA_WALLET);
});
