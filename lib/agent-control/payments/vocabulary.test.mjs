// Run from repo root:
// node --test --test-isolation=none lib/agent-control/payments/vocabulary.test.mjs
//
// Paying is not evidence of delivery. These tests pin the one sentence the
// whole packet exists to make structurally true, and they do it by naming the
// inference that would be convenient and proving it cannot be made.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADMISSIBLE_SOURCES,
  COMMERCE_VOCABULARY_REFUSALS,
  CommerceVocabularyError,
  DISPUTE_STATUSES,
  EVIDENCE_SOURCE_KINDS,
  PAYMENT_STATUSES,
  PAYMENT_TRUST_CLASSES,
  RECONCILIATION_STATUSES,
  SERVICE_DELIVERY_STATUSES,
  VERIFICATION_STATUSES,
  buildCommerceOutcome,
  deriveTrustClass,
  settlementPairing,
} from "./vocabulary.ts";

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CommerceVocabularyError, `expected a vocabulary refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

const SETTLED_BY_FACILITATOR = {
  paymentStatus: "SETTLED",
  paymentSource: "FACILITATOR_REPORT",
  serviceDeliveryStatus: "UNKNOWN",
  serviceDeliverySource: null,
  verificationStatus: "PROVIDER_REPORTED",
  verificationSource: "FACILITATOR_REPORT",
  disputeStatus: "NONE",
  reconciliationStatus: "PENDING",
};

test("the five axes are five closed vocabularies and none is a subset of another", () => {
  const axes = {
    paymentStatus: PAYMENT_STATUSES,
    serviceDeliveryStatus: SERVICE_DELIVERY_STATUSES,
    verificationStatus: VERIFICATION_STATUSES,
    disputeStatus: DISPUTE_STATUSES,
    reconciliationStatus: RECONCILIATION_STATUSES,
  };
  for (const [name, values] of Object.entries(axes)) {
    assert.ok(values.length >= 4, `${name} is too small to be a real axis`);
    assert.equal(new Set(values).size, values.length, `${name} repeats a value`);
  }
  /* SETTLED belongs to exactly one axis. A word that appears on two axes is a
     defect this product already paid for once, on a different pair. */
  assert.ok(PAYMENT_STATUSES.includes("SETTLED"));
  for (const [name, values] of Object.entries(axes)) {
    if (name === "paymentStatus") continue;
    assert.ok(!values.includes("SETTLED"), `${name} also carries SETTLED`);
  }
});

test("reconciliation reuses the product's reconciliation vocabulary exactly, rather than inventing a second one", () => {
  assert.deepEqual([...RECONCILIATION_STATUSES], [
    "PENDING",
    "MATCHED",
    "DEVIATION",
    "PARTIAL",
    "FAILED",
    "UNKNOWN",
    "RECOVERY",
  ]);
  /* The non-canonical aliases may never appear. */
  for (const alias of ["RECONCILED", "DEVIATED", "AMBIGUOUS", "RECOVERY_REQUIRED"]) {
    assert.ok(!RECONCILIATION_STATUSES.includes(alias), `${alias} is a forbidden alias`);
  }
  /* The evidence ladder is the other axis and keeps its careful name. */
  assert.ok(VERIFICATION_STATUSES.includes("EVIDENCE_RECONCILED"));
  assert.ok(!VERIFICATION_STATUSES.includes("RECONCILED"));
});

test("the admissible-source lists for payment and for service delivery do not overlap", () => {
  const payment = new Set(ADMISSIBLE_SOURCES.payment);
  const delivery = new Set(ADMISSIBLE_SOURCES.serviceDelivery);
  for (const kind of payment) {
    assert.ok(!delivery.has(kind), `${kind} is admissible for both payment and delivery`);
  }
  /* Every declared source kind is classified somewhere, including the one that
     is admissible for nothing. Silence would read as "allowed". */
  for (const kind of EVIDENCE_SOURCE_KINDS) {
    const classified =
      payment.has(kind) ||
      delivery.has(kind) ||
      ADMISSIBLE_SOURCES.verification.includes(kind) ||
      ADMISSIBLE_SOURCES.inadmissible.includes(kind);
    assert.ok(classified, `${kind} is declared but classified nowhere`);
  }
});

test("a settled payment does not make the service delivered", () => {
  const outcome = buildCommerceOutcome(SETTLED_BY_FACILITATOR);
  assert.equal(outcome.paymentStatus, "SETTLED");
  assert.equal(outcome.serviceDeliveryStatus, "UNKNOWN");
  assert.equal(outcome.verificationStatus, "PROVIDER_REPORTED");
  assert.equal(outcome.reconciliationStatus, "PENDING");
});

test("the facilitator's own report is inadmissible for service delivery", () => {
  /* This is the gate proved by breaking what it guards: wire the convenient
     inference — the facilitator settled, therefore the resource was served —
     and watch the source list refuse it before anything else is read. */
  throwsWith("SERVICE_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      serviceDeliveryStatus: "DELIVERED",
      serviceDeliverySource: "FACILITATOR_REPORT",
    }),
  );
});

test("a delivery state above UNKNOWN cannot be stated with no source at all", () => {
  throwsWith("SERVICE_SOURCE_MISSING", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      serviceDeliveryStatus: "DELIVERED",
      serviceDeliverySource: null,
    }),
  );
});

test("verification above PROVIDER_REPORTED needs an independent observation", () => {
  throwsWith("VERIFICATION_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      verificationStatus: "CHAIN_OBSERVED",
      verificationSource: "FACILITATOR_REPORT",
    }),
  );

  const observed = buildCommerceOutcome({
    ...SETTLED_BY_FACILITATOR,
    verificationStatus: "CHAIN_OBSERVED",
    verificationSource: "CHAIN_READ",
  });
  assert.equal(observed.verificationStatus, "CHAIN_OBSERVED");
});

test("a counterparty claim supports nothing above the lowest state on any axis", () => {
  assert.ok(ADMISSIBLE_SOURCES.inadmissible.includes("COUNTERPARTY_CLAIM"));
  throwsWith("PAYMENT_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({ ...SETTLED_BY_FACILITATOR, paymentSource: "COUNTERPARTY_CLAIM" }),
  );
  throwsWith("SERVICE_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      serviceDeliveryStatus: "DELIVERED",
      serviceDeliverySource: "COUNTERPARTY_CLAIM",
    }),
  );
});

test("an MPP receipt is external payment evidence and never service evidence", () => {
  const paid = buildCommerceOutcome({ ...SETTLED_BY_FACILITATOR, paymentSource: "MPP_RECEIPT" });
  assert.equal(paid.paymentStatus, "SETTLED");
  throwsWith("SERVICE_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      paymentSource: "MPP_RECEIPT",
      serviceDeliveryStatus: "DELIVERED",
      serviceDeliverySource: "MPP_RECEIPT",
    }),
  );
});

test("MATCHED requires both an observation and an equal expected/actual pair", () => {
  throwsWith("RECONCILIATION_NOT_SUPPORTED_BY_EVIDENCE", () =>
    buildCommerceOutcome({ ...SETTLED_BY_FACILITATOR, reconciliationStatus: "MATCHED" }),
  );

  const matched = buildCommerceOutcome({
    ...SETTLED_BY_FACILITATOR,
    serviceDeliveryStatus: "DELIVERED",
    serviceDeliverySource: "RESOURCE_RESPONSE",
    verificationStatus: "STATE_EFFECT_OBSERVED",
    verificationSource: "CHAIN_READ",
    reconciliationStatus: "MATCHED",
    expected: { amount: "0.25", assetRef: "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955" },
    actual: { amount: "0.25", assetRef: "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955" },
  });
  assert.equal(matched.reconciliationStatus, "MATCHED");

  throwsWith("RECONCILIATION_NOT_SUPPORTED_BY_EVIDENCE", () =>
    buildCommerceOutcome({
      ...SETTLED_BY_FACILITATOR,
      serviceDeliveryStatus: "DELIVERED",
      serviceDeliverySource: "RESOURCE_RESPONSE",
      verificationStatus: "STATE_EFFECT_OBSERVED",
      verificationSource: "CHAIN_READ",
      reconciliationStatus: "MATCHED",
      expected: { amount: "0.25", assetRef: "eip155:56/erc20:0xAA" },
      actual: { amount: "0.24", assetRef: "eip155:56/erc20:0xAA" },
    }),
  );
});

test("UNKNOWN is a normal terminal answer and never an error", () => {
  const unknown = buildCommerceOutcome({
    ...SETTLED_BY_FACILITATOR,
    paymentStatus: "UNKNOWN",
    paymentSource: null,
    verificationStatus: "NOT_VERIFIED",
    verificationSource: null,
    reconciliationStatus: "UNKNOWN",
  });
  assert.equal(unknown.reconciliationStatus, "UNKNOWN");
});

test("the paired reason codes come from the pair and from neither status alone", () => {
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "NOT_DELIVERED" }).code,
    "PAID_BUT_UNSERVED",
  );
  assert.equal(
    settlementPairing({ paymentStatus: "NOT_ATTEMPTED", serviceDeliveryStatus: "DELIVERED" }).code,
    "SERVICE_DELIVERED_UNPAID",
  );
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "DELIVERED" }).code,
    null,
  );
  /* Either half on its own is not enough to name an inconsistency. */
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "UNKNOWN" }).code,
    null,
  );
  assert.equal(
    settlementPairing({ paymentStatus: "UNKNOWN", serviceDeliveryStatus: "NOT_DELIVERED" }).code,
    null,
  );
});

test("an unknown half is reported as unknown rather than resolved either way", () => {
  const pairing = settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "UNKNOWN" });
  assert.equal(pairing.consistency, "UNDETERMINED");
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "DELIVERED" }).consistency,
    "CONSISTENT",
  );
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "NOT_DELIVERED" }).consistency,
    "INCONSISTENT",
  );
});

test("trust class is derived from the evidence present and never supplied", () => {
  assert.deepEqual([...PAYMENT_TRUST_CLASSES], [
    "UNVERIFIED_ASSERTION",
    "FACILITATOR_ASSERTION",
    "CHAIN_OBSERVED",
    "INDEPENDENTLY_RECONCILED",
  ]);
  assert.equal(deriveTrustClass(buildCommerceOutcome(SETTLED_BY_FACILITATOR)), "FACILITATOR_ASSERTION");
  assert.equal(
    deriveTrustClass(
      buildCommerceOutcome({
        ...SETTLED_BY_FACILITATOR,
        verificationStatus: "CHAIN_OBSERVED",
        verificationSource: "CHAIN_READ",
      }),
    ),
    "CHAIN_OBSERVED",
  );
  assert.equal(
    deriveTrustClass(
      buildCommerceOutcome({
        ...SETTLED_BY_FACILITATOR,
        paymentSource: null,
        paymentStatus: "UNKNOWN",
        verificationStatus: "NOT_VERIFIED",
        verificationSource: null,
      }),
    ),
    "UNVERIFIED_ASSERTION",
  );
});

test("every refusal this module can raise is a declared code", () => {
  assert.ok(COMMERCE_VOCABULARY_REFUSALS.length >= 6);
  assert.equal(new Set(COMMERCE_VOCABULARY_REFUSALS).size, COMMERCE_VOCABULARY_REFUSALS.length);
  const error = throwsWith("PAYMENT_SOURCE_INADMISSIBLE", () =>
    buildCommerceOutcome({ ...SETTLED_BY_FACILITATOR, paymentSource: "COUNTERPARTY_CLAIM" }),
  );
  assert.ok(COMMERCE_VOCABULARY_REFUSALS.includes(error.reasonCode));
});

test("an outcome is frozen, so a caller cannot upgrade one axis after the checks ran", () => {
  const outcome = buildCommerceOutcome(SETTLED_BY_FACILITATOR);
  assert.ok(Object.isFrozen(outcome));
  assert.throws(() => {
    outcome.serviceDeliveryStatus = "DELIVERED";
  }, TypeError);
});
