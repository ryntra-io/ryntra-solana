/**
 * The commerce receipt.
 *
 * It answers six questions and refuses to be built if it cannot answer all of
 * them: on **which network**, through **which implementation**, by **which
 * method**, via **which facilitator**, in **which asset**, and at **what trust
 * class**. The first five are identity. The sixth is the one that keeps the
 * other five honest.
 *
 * ## Why the trust class is computed and not accepted
 *
 * A caller may state what evidence it holds. It may not state the conclusion.
 * The moment a receipt takes a trust label as an input, the label becomes a
 * marketing field with a JSON name — and the whole artifact is worth exactly as
 * much as whoever filled it in. So the class is derived from the outcome's own
 * admissible sources, then capped, and an `assertedTrustClass` above the result
 * is a refusal rather than a warning.
 *
 * ## The cap, and when it stops applying
 *
 * Each implementation declares the most its **own report** can establish. For
 * an operator whose facilitator is documented as an open, unauthenticated API,
 * that is `UNVERIFIED_ASSERTION`: a report nobody can attribute is not a
 * facilitator's assertion, it is an anonymous one. The cap applies only while
 * the facilitator's report is the only evidence. As soon as Ryntra has its own
 * chain read or resource response, the observation is Ryntra's and the
 * operator's ceiling has nothing left to cap.
 *
 * ## What it is not
 *
 * It is not an `OutcomeReceipt`. That artifact is the Envelope's outcome
 * projection over an authorized action; this one records a payment interaction
 * and its separately-sourced service outcome. They carry different domains, so
 * neither can be replayed as the other.
 *
 * Nothing here settles, submits or verifies anything on a network. Every field
 * describes evidence somebody else produced.
 */

import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "../canonical.ts";
import type { RegistryPin } from "../registry.ts";
import type {
  PaymentFacilitator,
  PaymentMethod,
  ProviderImplementation,
} from "./implementations.ts";
import type { JobObservation, ReputationEvidence } from "./draft-standards.ts";
import type { ResolvedPaymentRoute } from "./x402-engine.ts";
import {
  ADMISSIBLE_SOURCES,
  PAYMENT_TRUST_CLASSES,
  deriveTrustClass,
  settlementPairing,
  type CommerceOutcome,
  type PaymentTrustClass,
  type SettlementPairing,
} from "./vocabulary.ts";

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;

export const COMMERCE_RECEIPT_REFUSALS = [
  "PREVIEW_IS_NOT_A_RECEIPT",
  "RECEIPT_IDENTITY_INCOMPLETE",
  "NETWORK_NOT_CAIP2",
  "AMOUNT_MALFORMED",
  "TRUST_CLASS_UNKNOWN_VALUE",
  "TRUST_CLASS_NOT_SUPPORTED_BY_EVIDENCE",
  "JOB_NETWORK_MISMATCH",
] as const;

export type CommerceReceiptRefusal = (typeof COMMERCE_RECEIPT_REFUSALS)[number];

export class CommerceReceiptError extends Error {
  readonly reasonCode: CommerceReceiptRefusal;

  constructor(reasonCode: CommerceReceiptRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "CommerceReceiptError";
    this.reasonCode = reasonCode;
  }
}

export type CommerceReceipt = Readonly<{
  kind: "COMMERCE_RECEIPT";
  schemaVersion: "1.0.0";
  id: string;
  createdAt: string;

  /* The six identity facts. */
  network: string;
  providerImplementation: ProviderImplementation;
  paymentMethod: PaymentMethod;
  facilitator: PaymentFacilitator;
  asset: Readonly<{ assetRef: string; symbol: string }>;
  trustClass: PaymentTrustClass;

  /* Everything else describes where those six came from. */
  protocol: "X402";
  operator: string;
  wireValue: string | null;
  amount: string;
  routeId: string;
  policyRef: Readonly<{ id: string; version: number }>;
  registryPin: RegistryPin;
  sourceUrl: string;

  outcome: CommerceOutcome;
  pairing: SettlementPairing;
  jobObservation: JobObservation | null;
  reputationEvidence: readonly ReputationEvidence[];

  limitations: readonly string[];
  integrity: Readonly<{ algorithm: "SHA-256"; hash: string }>;
}>;

export const COMMERCE_RECEIPT_LIMITATIONS: readonly string[] = Object.freeze([
  "A settled payment is not evidence that the service was delivered. The two are separate observations with separate admissible sources, and this receipt keeps them apart.",
  "The trust class is derived from the evidence this receipt actually carries. It is not a rating of the operator and it never rises because a provider reported success.",
  "Ryntra is beside this payment rather than inside it: it holds no key, no facilitator credential and no signer, and it did not move, sponsor or submit anything.",
  "Provider facts behind the route are read from published documentation on the date the declaration records, and none is live-verified.",
]);

function classIndex(value: PaymentTrustClass): number {
  return PAYMENT_TRUST_CLASSES.indexOf(value);
}

/** True once Ryntra holds an observation of its own, rather than a report about one. */
function hasIndependentObservation(outcome: CommerceOutcome): boolean {
  const source = outcome.verificationSource;
  return source !== null && ADMISSIBLE_SOURCES.verification.includes(source);
}

/**
 * The trust class this receipt is entitled to.
 *
 * Derived from the outcome, then capped by the operator's own ceiling for as
 * long as the operator's report is all there is.
 */
export function effectiveTrustClass(
  route: ResolvedPaymentRoute,
  outcome: CommerceOutcome,
): PaymentTrustClass {
  const derived = deriveTrustClass(outcome);
  if (hasIndependentObservation(outcome)) return derived;
  return classIndex(derived) <= classIndex(route.trustCeiling) ? derived : route.trustCeiling;
}

export function buildCommerceReceipt({
  route,
  amount,
  outcome,
  assertedTrustClass = null,
  jobObservation = null,
  reputationEvidence = [],
  now,
}: {
  route: ResolvedPaymentRoute;
  amount: string;
  outcome: CommerceOutcome;
  assertedTrustClass?: PaymentTrustClass | null;
  jobObservation?: JobObservation | null;
  reputationEvidence?: readonly ReputationEvidence[];
  now: Date;
}): CommerceReceipt {
  /* A preview reaching this function is not a typo to tolerate. Canon 01 §24
     is the rule and the cheapest way to break it is exactly this call. */
  if (!route || (route as unknown as { kind?: string }).kind === "X402_ROUTE_PREVIEW") {
    throw new CommerceReceiptError(
      "PREVIEW_IS_NOT_A_RECEIPT",
      "a route preview describes what could happen; a receipt records what did",
    );
  }

  for (const field of [
    "protocol",
    "implementation",
    "method",
    "facilitator",
    "network",
    "assetRef",
    "assetSymbol",
    "trustCeiling",
    "registryPin",
  ] as const) {
    if (route[field] === undefined || route[field] === null) {
      throw new CommerceReceiptError(
        "RECEIPT_IDENTITY_INCOMPLETE",
        `a receipt cannot omit ${field}; a payment nobody can attribute is not a record`,
      );
    }
  }
  if (!CAIP2.test(route.network)) {
    throw new CommerceReceiptError("NETWORK_NOT_CAIP2", `${route.network} is a name, not a chain id`);
  }
  if (typeof amount !== "string" || !DECIMAL_STRING.test(amount)) {
    throw new CommerceReceiptError("AMOUNT_MALFORMED", "an amount must be a plain decimal string");
  }
  if (jobObservation && jobObservation.network !== route.network) {
    throw new CommerceReceiptError(
      "JOB_NETWORK_MISMATCH",
      `the job was observed on ${jobObservation.network} and the payment routed over ${route.network}`,
    );
  }

  const supported = effectiveTrustClass(route, outcome);
  let trustClass = supported;
  if (assertedTrustClass !== null) {
    if (!PAYMENT_TRUST_CLASSES.includes(assertedTrustClass)) {
      throw new CommerceReceiptError("TRUST_CLASS_UNKNOWN_VALUE", String(assertedTrustClass));
    }
    if (classIndex(assertedTrustClass) > classIndex(supported)) {
      throw new CommerceReceiptError(
        "TRUST_CLASS_NOT_SUPPORTED_BY_EVIDENCE",
        `this receipt's evidence supports ${supported}, and it was asked to say ${assertedTrustClass}`,
      );
    }
    /* Understating is allowed and preserved. Refusing it would be pedantry, and
       a caller with a reason to be more cautious than the derivation should be
       able to be. */
    trustClass = assertedTrustClass;
  }

  const core = {
    kind: "COMMERCE_RECEIPT" as const,
    schemaVersion: "1.0.0" as const,
    createdAt: now.toISOString(),
    network: route.network,
    providerImplementation: route.implementation,
    paymentMethod: route.method,
    facilitator: route.facilitator,
    asset: Object.freeze({ assetRef: route.assetRef, symbol: route.assetSymbol }),
    trustClass,
    protocol: route.protocol,
    operator: route.operator,
    wireValue: route.wireValue,
    amount,
    routeId: [
      route.protocol,
      route.implementation,
      route.method,
      route.facilitator,
      route.network,
      route.assetRef,
    ].join("|"),
    policyRef: route.policyRef,
    registryPin: route.registryPin,
    sourceUrl: route.sourceUrl,
    outcome,
    pairing: settlementPairing({
      paymentStatus: outcome.paymentStatus,
      serviceDeliveryStatus: outcome.serviceDeliveryStatus,
    }),
    jobObservation,
    reputationEvidence: Object.freeze([...reputationEvidence]),
    limitations: COMMERCE_RECEIPT_LIMITATIONS,
  };

  const id = `commerce-receipt_${hashAgentPayloadV2(
    AGENT_HASH_DOMAINS_V2.commerceReceipt,
    core,
  ).slice(2, 18)}`;
  const withId = { ...core, id };

  return Object.freeze({
    ...withId,
    integrity: Object.freeze({
      algorithm: "SHA-256" as const,
      hash: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.commerceReceipt, withId),
    }),
  });
}

export type CommerceReceiptVerification = Readonly<{
  valid: boolean;
  /**
   * Three axes, reported separately and never combined. Canon `03 §7.4`: the
   * verifier does not issue one verdict, because a single word would let a
   * strong integrity result carry a weak trust result across the line.
   */
  axes: Readonly<{
    integrity: "VALID" | "MISMATCH";
    identity: "COMPLETE" | "INCOMPLETE";
    trust: PaymentTrustClass | "UNREADABLE";
  }>;
  issues: readonly string[];
}>;

export function verifyCommerceReceipt(value: unknown): CommerceReceiptVerification {
  const issues: string[] = [];
  const receipt = value as CommerceReceipt;

  const identityComplete =
    !!receipt &&
    typeof receipt === "object" &&
    receipt.kind === "COMMERCE_RECEIPT" &&
    typeof receipt.network === "string" &&
    CAIP2.test(receipt.network) &&
    typeof receipt.providerImplementation === "string" &&
    typeof receipt.paymentMethod === "string" &&
    typeof receipt.facilitator === "string" &&
    !!receipt.asset &&
    typeof receipt.asset.assetRef === "string" &&
    typeof receipt.trustClass === "string";
  if (!identityComplete) issues.push("IDENTITY_INCOMPLETE");

  let integrityValid = false;
  if (receipt && typeof receipt === "object" && receipt.integrity) {
    const { integrity: _integrity, ...withoutIntegrity } = receipt;
    integrityValid =
      receipt.integrity.hash ===
      hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.commerceReceipt, withoutIntegrity);
  }
  if (!integrityValid) issues.push("INTEGRITY_HASH_MISMATCH");

  const trust =
    identityComplete && PAYMENT_TRUST_CLASSES.includes(receipt.trustClass)
      ? receipt.trustClass
      : ("UNREADABLE" as const);

  return Object.freeze({
    valid: issues.length === 0,
    axes: Object.freeze({
      integrity: integrityValid ? ("VALID" as const) : ("MISMATCH" as const),
      identity: identityComplete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
      trust,
    }),
    issues: Object.freeze(issues),
  });
}
