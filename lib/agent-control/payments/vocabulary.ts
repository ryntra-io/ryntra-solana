/**
 * Five vocabularies for one commerce outcome, and no function that turns any
 * one of them into any other.
 *
 * The sentence this module exists to make structurally true is short: **paying
 * is not evidence of delivery**. Written as a comment above a boolean it does
 * not survive the third edit, so it is enforced structurally — two axes that
 * multiply rather than collapse, and a closed list of admissible sources per
 * axis that **do not overlap**.
 *
 * The convenient design is one `status` field with values like `PAID`,
 * `COMPLETE`, `FAILED`. It ships in an afternoon and it is a lie the first time
 * a facilitator settles a transfer for a resource that never answered. x402's
 * own security notes list that case (`PAID_BUT_UNSERVED`) and its mirror
 * (`SERVICE_DELIVERED_UNPAID`), and neither is expressible in one field.
 *
 * The load-bearing rule is the source lists. A facilitator's settle report is
 * admissible evidence that a payment happened and **inadmissible** evidence
 * that a service was delivered — because the facilitator never saw the
 * resource. That refusal fires before freshness, before amounts, before
 * anything, for the same reason `RegulatoryCapabilityState` refuses an
 * inadmissible source first: otherwise the failure gets reported as merely
 * incomplete, and somebody supplies the missing field and ships it.
 *
 * Nothing here moves money, reads a chain or calls a facilitator. It classifies
 * evidence somebody else produced.
 */

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * What a payment has done. One axis, one question: did value move?
 *
 * `UNKNOWN` is a normal terminal answer here, not a bug.
 */
export const PAYMENT_STATUSES = [
  "NOT_ATTEMPTED",
  "REQUIREMENTS_RECEIVED",
  "AUTHORIZATION_SIGNED",
  "SUBMITTED",
  "SETTLED",
  "FAILED",
  "UNKNOWN",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * What the paid-for service has done. Deliberately a different word set from
 * the payment axis: no value appears on both, so no rendering can merge them by
 * accident and no reader can mistake one for the other.
 */
export const SERVICE_DELIVERY_STATUSES = [
  "NOT_REQUESTED",
  "REQUESTED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "NOT_DELIVERED",
  "UNKNOWN",
] as const;

export type ServiceDeliveryStatus = (typeof SERVICE_DELIVERY_STATUSES)[number];

/**
 * How strongly any of it is established. This is Ryntra's evidence ladder
 * with its two honest ends attached.
 *
 * The top rung is `EVIDENCE_RECONCILED` and not `RECONCILED`, because
 * `RECONCILED` is a non-canonical alias for the *reconciliation state*
 * `MATCHED` and one word in two roles is a defect this product already fixed
 * once on a different pair.
 */
export const VERIFICATION_STATUSES = [
  "NOT_VERIFIED",
  "PROVIDER_REPORTED",
  "CHAIN_OBSERVED",
  "RESOURCE_OBSERVED",
  "STATE_EFFECT_OBSERVED",
  "EVIDENCE_RECONCILED",
  "CONFLICTING",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Whether anybody is contesting the outcome. Separate from whether it worked. */
export const DISPUTE_STATUSES = [
  "NONE",
  "OPEN",
  "EVIDENCE_SUBMITTED",
  "RESOLVED_BUYER",
  "RESOLVED_SELLER",
  "UNRESOLVED",
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * What the action ended as. Ryntra's reconciliation states, reproduced exactly
 * rather than re-derived — a second vocabulary for one state is the defect
 * this list exists to prevent.
 */
export const RECONCILIATION_STATUSES = [
  "PENDING",
  "MATCHED",
  "DEVIATION",
  "PARTIAL",
  "FAILED",
  "UNKNOWN",
  "RECOVERY",
] as const;

export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/**
 * Who says so. Every axis states which of these it will accept, and the lists
 * for payment and for service delivery are disjoint on purpose.
 */
export const EVIDENCE_SOURCE_KINDS = [
  /** The x402 facilitator's own `/settle` or `/verify` answer. */
  "FACILITATOR_REPORT",
  /** A Stripe/MPP native payment record imported as versioned external evidence. */
  "MPP_RECEIPT",
  /** An independent read of the chain the transfer claims to have happened on. */
  "CHAIN_READ",
  /** The paid resource's own response, observed by the party that paid for it. */
  "RESOURCE_RESPONSE",
  /** The owner stating, on the record, what they received. */
  "OWNER_ATTESTATION",
  /** The other side of the trade asserting its own performance. */
  "COUNTERPARTY_CLAIM",
] as const;

export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

/**
 * The disjoint admissibility lists.
 *
 * `FACILITATOR_REPORT` and `MPP_RECEIPT` establish that value moved and say
 * nothing about a resource, because neither party ever saw one.
 * `RESOURCE_RESPONSE` and `OWNER_ATTESTATION` establish that something was
 * received and say nothing about payment, because neither observes a ledger.
 * `COUNTERPARTY_CLAIM` establishes nothing at all: the party with the interest
 * asserting its own performance is not evidence, and listing it explicitly is
 * how the list avoids reading silence as permission.
 */
export const ADMISSIBLE_SOURCES: Readonly<{
  payment: readonly EvidenceSourceKind[];
  serviceDelivery: readonly EvidenceSourceKind[];
  verification: readonly EvidenceSourceKind[];
  inadmissible: readonly EvidenceSourceKind[];
}> = Object.freeze({
  payment: Object.freeze(["FACILITATOR_REPORT", "MPP_RECEIPT", "CHAIN_READ"] as const),
  serviceDelivery: Object.freeze(["RESOURCE_RESPONSE", "OWNER_ATTESTATION"] as const),
  verification: Object.freeze(["CHAIN_READ", "RESOURCE_RESPONSE"] as const),
  inadmissible: Object.freeze(["COUNTERPARTY_CLAIM"] as const),
});

/** Money, in the shape the rest of Agent Control already uses. */
export type CommerceMoney = Readonly<{ amount: string; assetRef: string }>;

export const COMMERCE_VOCABULARY_REFUSALS = [
  "PAYMENT_STATUS_UNKNOWN_VALUE",
  "SERVICE_STATUS_UNKNOWN_VALUE",
  "VERIFICATION_STATUS_UNKNOWN_VALUE",
  "DISPUTE_STATUS_UNKNOWN_VALUE",
  "RECONCILIATION_STATUS_UNKNOWN_VALUE",
  "PAYMENT_SOURCE_INADMISSIBLE",
  "PAYMENT_SOURCE_MISSING",
  "SERVICE_SOURCE_INADMISSIBLE",
  "SERVICE_SOURCE_MISSING",
  "VERIFICATION_SOURCE_INADMISSIBLE",
  "VERIFICATION_SOURCE_MISSING",
  "RECONCILIATION_NOT_SUPPORTED_BY_EVIDENCE",
  "MONEY_MALFORMED",
] as const;

export type CommerceVocabularyRefusal = (typeof COMMERCE_VOCABULARY_REFUSALS)[number];

export class CommerceVocabularyError extends Error {
  readonly reasonCode: CommerceVocabularyRefusal;

  constructor(reasonCode: CommerceVocabularyRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "CommerceVocabularyError";
    this.reasonCode = reasonCode;
  }
}

export type CommerceOutcomeInput = Readonly<{
  paymentStatus: PaymentStatus;
  paymentSource: EvidenceSourceKind | null;
  serviceDeliveryStatus: ServiceDeliveryStatus;
  serviceDeliverySource: EvidenceSourceKind | null;
  verificationStatus: VerificationStatus;
  verificationSource: EvidenceSourceKind | null;
  disputeStatus: DisputeStatus;
  reconciliationStatus: ReconciliationStatus;
  expected?: CommerceMoney | null;
  actual?: CommerceMoney | null;
}>;

export type CommerceOutcome = Readonly<{
  paymentStatus: PaymentStatus;
  paymentSource: EvidenceSourceKind | null;
  serviceDeliveryStatus: ServiceDeliveryStatus;
  serviceDeliverySource: EvidenceSourceKind | null;
  verificationStatus: VerificationStatus;
  verificationSource: EvidenceSourceKind | null;
  disputeStatus: DisputeStatus;
  reconciliationStatus: ReconciliationStatus;
  expected: CommerceMoney | null;
  actual: CommerceMoney | null;
}>;

/** The payment states that assert value actually moved, rather than was tried. */
const PAYMENT_STATES_NEEDING_A_SOURCE: readonly PaymentStatus[] = [
  "REQUIREMENTS_RECEIVED",
  "AUTHORIZATION_SIGNED",
  "SUBMITTED",
  "SETTLED",
  "FAILED",
];

/** The delivery states that assert something about a resource. */
const SERVICE_STATES_NEEDING_A_SOURCE: readonly ServiceDeliveryStatus[] = [
  "REQUESTED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "NOT_DELIVERED",
];

/** The verification rungs that require an observation Ryntra itself can point at. */
const VERIFICATION_RUNGS_NEEDING_OBSERVATION: readonly VerificationStatus[] = [
  "CHAIN_OBSERVED",
  "RESOURCE_OBSERVED",
  "STATE_EFFECT_OBSERVED",
  "EVIDENCE_RECONCILED",
];

function assertMoney(value: CommerceMoney | null | undefined, label: string): CommerceMoney | null {
  if (value === null || value === undefined) return null;
  if (typeof value.amount !== "string" || !DECIMAL_STRING.test(value.amount)) {
    throw new CommerceVocabularyError("MONEY_MALFORMED", `${label} amount is not a decimal string`);
  }
  if (typeof value.assetRef !== "string" || value.assetRef.length === 0) {
    throw new CommerceVocabularyError("MONEY_MALFORMED", `${label} carries no asset reference`);
  }
  return Object.freeze({ amount: value.amount, assetRef: value.assetRef });
}

/**
 * Build one outcome, refusing an inadmissible source before anything else is
 * read.
 *
 * The order is the point. Freshness, amounts and equality are all downstream of
 * *may this source speak to this axis at all*, and checking them first is how a
 * structurally inadmissible record gets reported as merely stale.
 */
export function buildCommerceOutcome(input: CommerceOutcomeInput): CommerceOutcome {
  if (!PAYMENT_STATUSES.includes(input.paymentStatus)) {
    throw new CommerceVocabularyError("PAYMENT_STATUS_UNKNOWN_VALUE", String(input.paymentStatus));
  }
  if (!SERVICE_DELIVERY_STATUSES.includes(input.serviceDeliveryStatus)) {
    throw new CommerceVocabularyError("SERVICE_STATUS_UNKNOWN_VALUE", String(input.serviceDeliveryStatus));
  }
  if (!VERIFICATION_STATUSES.includes(input.verificationStatus)) {
    throw new CommerceVocabularyError("VERIFICATION_STATUS_UNKNOWN_VALUE", String(input.verificationStatus));
  }
  if (!DISPUTE_STATUSES.includes(input.disputeStatus)) {
    throw new CommerceVocabularyError("DISPUTE_STATUS_UNKNOWN_VALUE", String(input.disputeStatus));
  }
  if (!RECONCILIATION_STATUSES.includes(input.reconciliationStatus)) {
    throw new CommerceVocabularyError("RECONCILIATION_STATUS_UNKNOWN_VALUE", String(input.reconciliationStatus));
  }

  if (PAYMENT_STATES_NEEDING_A_SOURCE.includes(input.paymentStatus)) {
    if (!input.paymentSource) {
      throw new CommerceVocabularyError(
        "PAYMENT_SOURCE_MISSING",
        `${input.paymentStatus} states that something happened and names nobody who saw it`,
      );
    }
    if (!ADMISSIBLE_SOURCES.payment.includes(input.paymentSource)) {
      throw new CommerceVocabularyError(
        "PAYMENT_SOURCE_INADMISSIBLE",
        `${input.paymentSource} cannot establish a payment state`,
      );
    }
  }

  if (SERVICE_STATES_NEEDING_A_SOURCE.includes(input.serviceDeliveryStatus)) {
    if (!input.serviceDeliverySource) {
      throw new CommerceVocabularyError(
        "SERVICE_SOURCE_MISSING",
        `${input.serviceDeliveryStatus} states something about a resource and names nobody who observed it`,
      );
    }
    if (!ADMISSIBLE_SOURCES.serviceDelivery.includes(input.serviceDeliverySource)) {
      throw new CommerceVocabularyError(
        "SERVICE_SOURCE_INADMISSIBLE",
        `${input.serviceDeliverySource} never observed the resource, so it cannot establish delivery`,
      );
    }
  }

  if (VERIFICATION_RUNGS_NEEDING_OBSERVATION.includes(input.verificationStatus)) {
    if (!input.verificationSource) {
      throw new CommerceVocabularyError(
        "VERIFICATION_SOURCE_MISSING",
        `${input.verificationStatus} claims an observation and names none`,
      );
    }
    if (!ADMISSIBLE_SOURCES.verification.includes(input.verificationSource)) {
      throw new CommerceVocabularyError(
        "VERIFICATION_SOURCE_INADMISSIBLE",
        `${input.verificationSource} is a report, not an independent observation`,
      );
    }
  }

  const expected = assertMoney(input.expected, "expected");
  const actual = assertMoney(input.actual, "actual");

  /* `MATCHED` is the one reconciliation state that asserts the world agreed
     with the plan. It needs an observation Ryntra made and a pair that is
     actually equal; a facilitator saying `success` is neither. */
  if (input.reconciliationStatus === "MATCHED") {
    const observed = VERIFICATION_RUNGS_NEEDING_OBSERVATION.includes(input.verificationStatus);
    const equal =
      expected !== null &&
      actual !== null &&
      expected.assetRef === actual.assetRef &&
      expected.amount === actual.amount;
    if (!observed || !equal) {
      throw new CommerceVocabularyError(
        "RECONCILIATION_NOT_SUPPORTED_BY_EVIDENCE",
        !observed
          ? "MATCHED needs an independent observation, not a provider report"
          : "MATCHED needs an expected and actual pair that are equal",
      );
    }
  }

  return Object.freeze({
    paymentStatus: input.paymentStatus,
    paymentSource: input.paymentSource,
    serviceDeliveryStatus: input.serviceDeliveryStatus,
    serviceDeliverySource: input.serviceDeliverySource,
    verificationStatus: input.verificationStatus,
    verificationSource: input.verificationSource,
    disputeStatus: input.disputeStatus,
    reconciliationStatus: input.reconciliationStatus,
    expected,
    actual,
  });
}

export const SETTLEMENT_PAIRING_CODES = ["PAID_BUT_UNSERVED", "SERVICE_DELIVERED_UNPAID"] as const;

export type SettlementPairingCode = (typeof SETTLEMENT_PAIRING_CODES)[number];

export type SettlementPairing = Readonly<{
  code: SettlementPairingCode | null;
  consistency: "CONSISTENT" | "INCONSISTENT" | "UNDETERMINED";
}>;

/**
 * The two reason codes, produced from the **pair**.
 *
 * Neither status alone can name either code, which is the whole reason the two
 * axes exist. An unknown half yields `UNDETERMINED` rather than a guess: a
 * pairing function that resolved silence in either direction would be inventing
 * the fact it was asked to check.
 */
export function settlementPairing({
  paymentStatus,
  serviceDeliveryStatus,
}: {
  paymentStatus: PaymentStatus;
  serviceDeliveryStatus: ServiceDeliveryStatus;
}): SettlementPairing {
  const paidKnown = paymentStatus === "SETTLED";
  const notPaidKnown = paymentStatus === "NOT_ATTEMPTED" || paymentStatus === "FAILED";
  const deliveredKnown = serviceDeliveryStatus === "DELIVERED";
  const notDeliveredKnown =
    serviceDeliveryStatus === "NOT_DELIVERED" || serviceDeliveryStatus === "PARTIALLY_DELIVERED";

  if (paidKnown && notDeliveredKnown) {
    return Object.freeze({ code: "PAID_BUT_UNSERVED" as const, consistency: "INCONSISTENT" as const });
  }
  if (notPaidKnown && deliveredKnown) {
    return Object.freeze({ code: "SERVICE_DELIVERED_UNPAID" as const, consistency: "INCONSISTENT" as const });
  }
  if ((paidKnown && deliveredKnown) || (notPaidKnown && !deliveredKnown && serviceDeliveryStatus !== "UNKNOWN")) {
    return Object.freeze({ code: null, consistency: "CONSISTENT" as const });
  }
  return Object.freeze({ code: null, consistency: "UNDETERMINED" as const });
}

export const PAYMENT_TRUST_CLASSES = [
  "UNVERIFIED_ASSERTION",
  "FACILITATOR_ASSERTION",
  "CHAIN_OBSERVED",
  "INDEPENDENTLY_RECONCILED",
] as const;

export type PaymentTrustClass = (typeof PAYMENT_TRUST_CLASSES)[number];

/**
 * The trust class of an outcome, computed from what is actually present.
 *
 * A caller may state the evidence it holds. It may not state the conclusion —
 * that is the whole difference between a receipt and a marketing chip, and it
 * is why this is a derivation with no override parameter.
 *
 * The ceiling: an x402 receipt is a server assertion about an interaction.
 * It never rises above `FACILITATOR_ASSERTION` on its own.
 */
export function deriveTrustClass(outcome: CommerceOutcome): PaymentTrustClass {
  if (outcome.reconciliationStatus === "MATCHED" && outcome.verificationStatus === "EVIDENCE_RECONCILED") {
    return "INDEPENDENTLY_RECONCILED";
  }
  if (VERIFICATION_RUNGS_NEEDING_OBSERVATION.includes(outcome.verificationStatus)) {
    return "CHAIN_OBSERVED";
  }
  if (
    outcome.verificationStatus === "PROVIDER_REPORTED" &&
    outcome.paymentSource !== null &&
    ADMISSIBLE_SOURCES.payment.includes(outcome.paymentSource)
  ) {
    return "FACILITATOR_ASSERTION";
  }
  return "UNVERIFIED_ASSERTION";
}
