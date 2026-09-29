// Run from repo root:
// node --test --test-isolation=none lib/agent-control/payments/receipt.test.mjs
//
// A commerce receipt names who was paid, over what, by whom, on which chain,
// in which asset — and how much any of that is actually worth as evidence.
// These tests pin the six identity fields and the one thing a receipt may
// never do, which is claim more than its own evidence supports.
import { test } from "node:test";
import assert from "node:assert/strict";

import { PAYMENT_PROTOCOL, PROVIDER_IMPLEMENTATIONS, PAYMENT_METHODS, PAYMENT_FACILITATORS } from "./implementations.ts";
import { buildRoutePreview, resolvePaymentRoute } from "./x402-engine.ts";
import { buildCommerceOutcome } from "./vocabulary.ts";
import { ERC_8183_PIN, buildJobObservation } from "./draft-standards.ts";
import {
  COMMERCE_RECEIPT_REFUSALS,
  CommerceReceiptError,
  buildCommerceReceipt,
  verifyCommerceReceipt,
} from "./receipt.ts";

const BSC = "eip155:56";
const USDT = `${BSC}/erc20:0x55d398326f99059fF775485246999027B3197955`;
const NOW = new Date("2026-08-24T00:00:00.000Z");

function policy() {
  return {
    id: "test-commerce-policy",
    version: 1,
    allowedImplementations: [...PROVIDER_IMPLEMENTATIONS],
    allowedMethods: [...PAYMENT_METHODS],
    allowedFacilitators: [...PAYMENT_FACILITATORS],
    assetPolicy: [{ network: BSC, assetRefs: [USDT] }],
  };
}

function binanceRoute() {
  return resolvePaymentRoute({
    protocol: PAYMENT_PROTOCOL,
    implementation: "BINANCE_B402",
    method: "PERMIT2_EXACT",
    facilitator: "BINANCE",
    network: BSC,
    assetRef: USDT,
    policy: policy(),
  });
}

function vistaraRoute() {
  return resolvePaymentRoute({
    protocol: PAYMENT_PROTOCOL,
    implementation: "VISTARA_B402",
    method: "VISTARA_RELAYER_EIP712",
    facilitator: "VISTARA",
    network: BSC,
    assetRef: USDT,
    policy: policy(),
  });
}

const FACILITATOR_ONLY = {
  paymentStatus: "SETTLED",
  paymentSource: "FACILITATOR_REPORT",
  serviceDeliveryStatus: "UNKNOWN",
  serviceDeliverySource: null,
  verificationStatus: "PROVIDER_REPORTED",
  verificationSource: "FACILITATOR_REPORT",
  disputeStatus: "NONE",
  reconciliationStatus: "PENDING",
};

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CommerceReceiptError, `expected a receipt refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode, `expected ${reasonCode}, got ${error.reasonCode}`);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

test("a receipt names all six identity facts", () => {
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  assert.equal(receipt.kind, "COMMERCE_RECEIPT");
  assert.equal(receipt.network, BSC);
  assert.equal(receipt.providerImplementation, "BINANCE_B402");
  assert.equal(receipt.paymentMethod, "PERMIT2_EXACT");
  assert.equal(receipt.facilitator, "BINANCE");
  assert.equal(receipt.asset.assetRef, USDT);
  assert.equal(receipt.asset.symbol, "USDT");
  assert.equal(receipt.trustClass, "FACILITATOR_ASSERTION");
  /* CAIP-2, not a friendly name. "BNB Chain" is not an identifier. */
  assert.match(receipt.network, /^[a-z0-9-]+:[A-Za-z0-9-]+$/);
  assert.ok(Object.isFrozen(receipt));
});

test("a receipt with any identity fact missing cannot be built", () => {
  const route = binanceRoute();
  for (const field of ["network", "implementation", "method", "facilitator", "assetRef", "trustCeiling"]) {
    const broken = { ...route, [field]: undefined };
    throwsWith("RECEIPT_IDENTITY_INCOMPLETE", () =>
      buildCommerceReceipt({
        route: broken,
        amount: "0.25",
        outcome: buildCommerceOutcome(FACILITATOR_ONLY),
        now: NOW,
      }),
    );
  }
});

test("the two B402s produce receipts that cannot be confused", () => {
  const binance = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  const vistara = buildCommerceReceipt({
    route: vistaraRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });

  /* Same chain, same token, same amount, same evidence — and the receipts
     disagree about the operator and about what the evidence is worth. */
  assert.equal(binance.asset.assetRef, vistara.asset.assetRef);
  assert.equal(binance.amount, vistara.amount);
  assert.notEqual(binance.providerImplementation, vistara.providerImplementation);
  assert.notEqual(binance.operator, vistara.operator);
  assert.notEqual(binance.id, vistara.id);
  assert.notEqual(binance.integrity.hash, vistara.integrity.hash);
  assert.equal(binance.trustClass, "FACILITATOR_ASSERTION");
  assert.equal(vistara.trustClass, "UNVERIFIED_ASSERTION");
});

test("an unauthenticated facilitator's report cannot reach FACILITATOR_ASSERTION", () => {
  /* The ceiling is not a judgement of the project. Vistara documents its
     facilitator as an open API with no authentication, so a report from it
     cannot be attributed to anyone — and an unattributable assertion is not a
     facilitator assertion. */
  const receipt = buildCommerceReceipt({
    route: vistaraRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  assert.equal(receipt.trustClass, "UNVERIFIED_ASSERTION");
});

test("the ceiling stops applying once Ryntra has its own observation", () => {
  /* A chain read is Ryntra's observation, not the facilitator's report, so the
     operator's ceiling has nothing to cap. */
  const receipt = buildCommerceReceipt({
    route: vistaraRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome({
      ...FACILITATOR_ONLY,
      verificationStatus: "CHAIN_OBSERVED",
      verificationSource: "CHAIN_READ",
    }),
    now: NOW,
  });
  assert.equal(receipt.trustClass, "CHAIN_OBSERVED");
});

test("a receipt asserting more than its evidence supports is refused", () => {
  /* GATE-PROVED. This is the one line a marketing chip would cross first. */
  throwsWith("TRUST_CLASS_NOT_SUPPORTED_BY_EVIDENCE", () =>
    buildCommerceReceipt({
      route: binanceRoute(),
      amount: "0.25",
      outcome: buildCommerceOutcome(FACILITATOR_ONLY),
      assertedTrustClass: "INDEPENDENTLY_RECONCILED",
      now: NOW,
    }),
  );
  throwsWith("TRUST_CLASS_NOT_SUPPORTED_BY_EVIDENCE", () =>
    buildCommerceReceipt({
      route: vistaraRoute(),
      amount: "0.25",
      outcome: buildCommerceOutcome(FACILITATOR_ONLY),
      assertedTrustClass: "FACILITATOR_ASSERTION",
      now: NOW,
    }),
  );
  /* Asserting less than the evidence supports is allowed and recorded as
     asserted: understating is safe, and refusing it would be pedantry. */
  const modest = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    assertedTrustClass: "UNVERIFIED_ASSERTION",
    now: NOW,
  });
  assert.equal(modest.trustClass, "UNVERIFIED_ASSERTION");
});

test("a receipt carries the payment/service pairing rather than a merged verdict", () => {
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome({
      ...FACILITATOR_ONLY,
      serviceDeliveryStatus: "NOT_DELIVERED",
      serviceDeliverySource: "OWNER_ATTESTATION",
    }),
    now: NOW,
  });
  assert.equal(receipt.pairing.code, "PAID_BUT_UNSERVED");
  assert.equal(receipt.pairing.consistency, "INCONSISTENT");
  assert.equal(receipt.outcome.paymentStatus, "SETTLED");
  assert.equal(receipt.outcome.serviceDeliveryStatus, "NOT_DELIVERED");
  /* And there is no single field that resolves the two into one word. */
  for (const forbidden of ["status", "succeeded", "ok", "complete", "settledAndDelivered"]) {
    assert.ok(!(forbidden in receipt), `the receipt merges the two axes into ${forbidden}`);
  }
});

test("a terminal ERC-8183 job does not promote the receipt", () => {
  /* GATE-PROVED. The escrow contract saying `Completed` is the provider's
     account of itself — canon 03 §8.2 — so it cannot be the thing that makes
     Ryntra's reconciliation MATCHED. */
  const job = buildJobObservation({
    pin: ERC_8183_PIN,
    jobRef: "job_1",
    network: BSC,
    state: "TERMINAL",
    terminalKind: "COMPLETED",
    sourceLabel: "ERC-8183 escrow read, revision-pinned",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    jobObservation: job,
    now: NOW,
  });
  assert.equal(receipt.jobObservation.terminalKind, "COMPLETED");
  assert.equal(receipt.outcome.reconciliationStatus, "PENDING");
  assert.equal(receipt.trustClass, "FACILITATOR_ASSERTION");
  assert.equal(receipt.jobObservation.reconciliationSupport, "NONE");
});

test("a job observed on another chain cannot be attached to this receipt", () => {
  const job = buildJobObservation({
    pin: ERC_8183_PIN,
    jobRef: "job_1",
    network: "eip155:8453",
    state: "TERMINAL",
    terminalKind: "COMPLETED",
    sourceLabel: "ERC-8183 escrow read",
    observedAt: "2026-08-24T00:00:00.000Z",
  });
  throwsWith("JOB_NETWORK_MISMATCH", () =>
    buildCommerceReceipt({
      route: binanceRoute(),
      amount: "0.25",
      outcome: buildCommerceOutcome(FACILITATOR_ONLY),
      jobObservation: job,
      now: NOW,
    }),
  );
});

test("a preview is not a receipt and cannot be handed in as one", () => {
  const preview = buildRoutePreview({ route: binanceRoute(), amount: "0.25", now: NOW });
  throwsWith("PREVIEW_IS_NOT_A_RECEIPT", () =>
    buildCommerceReceipt({
      route: preview,
      amount: "0.25",
      outcome: buildCommerceOutcome(FACILITATOR_ONLY),
      now: NOW,
    }),
  );
  /* And the two types never share a shape. */
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  assert.notEqual(preview.kind, receipt.kind);
  assert.ok(!("trustClass" in preview));
  assert.ok(!("outcome" in preview));
});

test("the receipt recomputes and a tampered field is caught", () => {
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  const verified = verifyCommerceReceipt(receipt);
  assert.equal(verified.valid, true);
  assert.deepEqual(verified.issues, []);

  const tampered = { ...receipt, trustClass: "INDEPENDENTLY_RECONCILED" };
  const rejected = verifyCommerceReceipt(tampered);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.issues.includes("INTEGRITY_HASH_MISMATCH"));

  /* Three axes reported separately, never one merged verdict. Canon 03 §7.4. */
  assert.deepEqual(Object.keys(verified.axes).sort(), ["identity", "integrity", "trust"]);
  assert.ok(!("verdict" in verified));
});

test("the receipt records which registry it was produced against", () => {
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  assert.match(receipt.registryPin.registryDigest, /^0x[0-9a-f]{64}$/);
  assert.ok(receipt.registryPin.refs.some((entry) => entry.ref === "adapter:binance-b402@1"));
});

test("a receipt states its own limitations, including the one about payment and service", () => {
  const receipt = buildCommerceReceipt({
    route: binanceRoute(),
    amount: "0.25",
    outcome: buildCommerceOutcome(FACILITATOR_ONLY),
    now: NOW,
  });
  assert.ok(receipt.limitations.length >= 3);
  assert.ok(
    receipt.limitations.some((line) => /not.*(evidence|proof).*deliver/i.test(line)),
    "a receipt must say that payment is not evidence of delivery",
  );
});

test("every refusal this module can raise is a declared code", () => {
  assert.equal(new Set(COMMERCE_RECEIPT_REFUSALS).size, COMMERCE_RECEIPT_REFUSALS.length);
  const error = throwsWith("AMOUNT_MALFORMED", () =>
    buildCommerceReceipt({
      route: binanceRoute(),
      amount: "0,25",
      outcome: buildCommerceOutcome(FACILITATOR_ONLY),
      now: NOW,
    }),
  );
  assert.ok(COMMERCE_RECEIPT_REFUSALS.includes(error.reasonCode));
});
