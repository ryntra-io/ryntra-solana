/**
 * One sale, end to end — and every way it can stop.
 *
 * The flow is the one Solana's own x402 guide and the owner's review describe,
 * with Ryntra in the seller's chair:
 *
 * ```
 * request → 402 PAYMENT-REQUIRED → buyer signs → PAYMENT-SIGNATURE
 *   → local checks → claim (one payment, one quote) → facilitator /supported
 *   → facilitator /settle → deliverable → resource + PAYMENT-RESPONSE
 * ```
 *
 * ## Fail closed at every step, and the step is named
 *
 * Nothing is served on a payment nobody confirmed. A facilitator that times
 * out, answers unreadably or cannot be reached leaves the sale
 * `AWAITING_RECONCILIATION`: the buyer is told the truth, the resource is not
 * handed over, and no second charge is attempted — which is the registry row's
 * rule written as control flow rather than as a comment.
 *
 * ## Why a dropped connection re-serves the report
 *
 * A buyer whose answer was lost presents the same authorization again. The
 * ledger refuses the claim as `PAYMENT_ALREADY_CLAIMED`, and the right response
 * is the resource they already paid for — not a 409 and not a second charge.
 * The deliverable runs again, because it is a read over public chain state and
 * running it twice costs compute rather than money; what cannot happen twice is
 * the *charge* and the *delivery record*.
 *
 * ## Two things this module never does
 *
 * It never verifies a signature, and it never decides that a payment happened.
 * Both belong to the facilitator, behind the port below, whose credential is
 * the owner's. `RYNTRA_RUNS_A_FACILITATOR` is `false` for a structural reason:
 * a resource server that verifies its own payments is attesting to itself.
 */

import {
  X402_HEADERS,
  buildPaymentRequirements,
  decodePaymentAuthorization,
  encodePaymentRequirements,
  encodePaymentResponse,
  verifyPaymentAuthorization,
  type X402Facilitator,
  type X402PaymentAuthorization,
  type X402PaymentRequirements,
  type X402PaymentResponse,
  type X402Scheme,
} from "./protocol.ts";
import {
  createFulfilmentLedger,
  type FulfilmentLedger,
  type FulfilmentRecord,
  type SettlementReport,
} from "./fulfilment.ts";
import type { SellableService, SellerConfig } from "./seller.ts";

/* ─── The two ports ────────────────────────────────────────────────────────── */

/**
 * The facilitator, as the only interface this product has to one.
 *
 * Deliberately three methods and no constructor: there is no client in this
 * repository, no base URL constant and no credential, so the only way to supply
 * one is to pass it in. That is what keeps "Ryntra holds no facilitator
 * credential" true by construction rather than by review.
 */
export type FacilitatorClient = Readonly<{
  id: X402Facilitator;
  /** The facilitator's own `/supported`: which networks and schemes it will take. */
  supported(): Promise<readonly Readonly<{ network: string; scheme: X402Scheme }>[]>;
  /** `/settle`. Its answer is a report about a payment, never about a service. */
  settle(input: {
    requirements: X402PaymentRequirements;
    authorization: X402PaymentAuthorization;
  }): Promise<SettlementReport>;
}>;

/**
 * The thing being sold.
 *
 * Returning `null` is a legal answer and it is the honest one for a report that
 * could not be produced: it becomes a recorded non-delivery with a refund due,
 * rather than an empty body the buyer has to interpret.
 */
export type Deliverable = Readonly<{
  serviceId: string;
  build(input: { requirements: X402PaymentRequirements; query: URLSearchParams }): Promise<unknown | null>;
}>;

/* ─── Outcomes ─────────────────────────────────────────────────────────────── */

export type SaleOutcome =
  | Readonly<{
      kind: "REQUIREMENTS";
      status: 402;
      requirements: X402PaymentRequirements;
      headerName: string;
      headerValue: string;
    }>
  | Readonly<{
      kind: "REFUSED";
      status: 400 | 402 | 409 | 502 | 503;
      reasonCode: string;
      detail: string;
      record: FulfilmentRecord | null;
    }>
  | Readonly<{
      kind: "DELIVERED" | "ALREADY_SERVED";
      status: 200;
      body: unknown;
      response: X402PaymentResponse;
      headerName: string;
      headerValue: string;
      record: FulfilmentRecord;
    }>
  /**
   * Two shapes of "not yet", kept apart because they are different facts.
   *
   * `AWAITING_RECONCILIATION` — the facilitator's answer is lost and nobody
   * knows whether value moved. `IN_PROGRESS` — this exact purchase is being
   * served right now by the request that won the claim. Collapsing them would
   * tell a buyer in a race that their payment is in doubt when it is merely a
   * few milliseconds behind.
   */
  | Readonly<{
      kind: "AWAITING_RECONCILIATION" | "IN_PROGRESS";
      status: 202;
      response: X402PaymentResponse;
      headerName: string;
      headerValue: string;
      record: FulfilmentRecord;
    }>;

/* ─── The quote ────────────────────────────────────────────────────────────── */

/**
 * A nonce for one quote.
 *
 * Random rather than derived: a nonce derived from the request would be the
 * same for two buyers asking the same question, and the first of them would own
 * the second's quote.
 */
export function issueNonce(randomBytes: (size: number) => Uint8Array): string {
  return Buffer.from(randomBytes(24)).toString("base64url");
}

export function issueQuote({
  service,
  config,
  origin,
  query,
  nonce,
  now,
}: {
  service: SellableService;
  config: SellerConfig;
  /** Ryntra's own origin, as the deployment knows it. */
  origin: string;
  query: URLSearchParams;
  nonce: string;
  now: Date;
}): X402PaymentRequirements {
  return buildPaymentRequirements({
    scheme: service.scheme,
    network: config.network,
    asset: config.mint,
    assetSymbol: config.assetSymbol,
    decimals: config.decimals,
    maxAmountRequired: config.priceBaseUnits,
    payTo: config.payTo,
    resource: `${origin}${service.path}`,
    /* The descriptor binds the quote to the question. A quote for one mint
       cannot be presented for another, because the digest would not match. */
    resourceDescriptor: {
      serviceId: service.serviceId,
      query: [...query.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    },
    description: service.label,
    mimeType: service.mimeType,
    maxTimeoutSeconds: service.maxTimeoutSeconds,
    facilitator: config.facilitator,
    nonce,
    refundReference: `${origin}/agents/workspace/procurement`,
    now,
    validForSeconds: service.validForSeconds,
  });
}

/* ─── Settle and serve ─────────────────────────────────────────────────────── */

const refuse = (
  status: 400 | 402 | 409 | 502 | 503,
  reasonCode: string,
  detail: string,
  record: FulfilmentRecord | null = null,
): SaleOutcome => Object.freeze({ kind: "REFUSED" as const, status, reasonCode, detail, record });

function paymentResponse({
  requirements,
  record,
}: {
  requirements: X402PaymentRequirements;
  record: FulfilmentRecord;
}): X402PaymentResponse {
  const settlement =
    record.paymentStatus === "SETTLED"
      ? ("SETTLED" as const)
      : record.paymentStatus === "FAILED"
        ? ("FAILED" as const)
        : ("PENDING_VERIFICATION" as const);
  const delivery =
    record.serviceDeliveryStatus === "DELIVERED"
      ? ("DELIVERED" as const)
      : record.serviceDeliveryStatus === "NOT_DELIVERED"
        ? ("NOT_DELIVERED" as const)
        : ("AWAITING_RECONCILIATION" as const);
  return Object.freeze({
    x402Version: requirements.x402Version,
    scheme: requirements.scheme,
    network: requirements.network,
    settlement,
    facilitator: record.facilitator,
    transaction: record.transaction,
    payer: record.payer,
    amount: record.amountBaseUnits,
    asset: requirements.asset,
    paymentId: record.paymentId,
    delivery,
  });
}

const served = (
  kind: "DELIVERED" | "ALREADY_SERVED",
  body: unknown,
  requirements: X402PaymentRequirements,
  record: FulfilmentRecord,
): SaleOutcome =>
  Object.freeze({
    kind,
    status: 200 as const,
    body,
    response: paymentResponse({ requirements, record }),
    headerName: X402_HEADERS.response,
    headerValue: encodePaymentResponse(paymentResponse({ requirements, record })),
    record,
  });

const pending = (
  requirements: X402PaymentRequirements,
  record: FulfilmentRecord,
  kind: "AWAITING_RECONCILIATION" | "IN_PROGRESS" = "AWAITING_RECONCILIATION",
): SaleOutcome =>
  Object.freeze({
    kind,
    status: 202 as const,
    response: paymentResponse({ requirements, record }),
    headerName: X402_HEADERS.response,
    headerValue: encodePaymentResponse(paymentResponse({ requirements, record })),
    record,
  });

/**
 * Call the facilitator with a deadline, and turn every way that can go wrong
 * into one report: `UNKNOWN`.
 *
 * A thrown error, a rejected promise and a deadline that passes are the same
 * fact from the seller's side — nobody can say whether value moved — and
 * collapsing them into `UNKNOWN` is what stops a lost answer from being read as
 * a failure and retried into a second charge.
 */
async function settleWithDeadline({
  facilitator,
  requirements,
  authorization,
  timeoutMs,
}: {
  facilitator: FacilitatorClient;
  requirements: X402PaymentRequirements;
  authorization: X402PaymentAuthorization;
  timeoutMs: number;
}): Promise<SettlementReport> {
  const unknown = (detail: string): SettlementReport =>
    Object.freeze({
      status: "UNKNOWN" as const,
      transaction: null,
      source: "FACILITATOR_REPORT" as const,
      detail,
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<SettlementReport>((resolve) => {
      timer = setTimeout(
        () => resolve(unknown(`the facilitator did not answer within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([
      facilitator.settle({ requirements, authorization }).catch((error: unknown) =>
        unknown(
          `the facilitator call failed: ${error instanceof Error ? error.name : "unknown error"}`,
        ),
      ),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type SettleAndServeInput = Readonly<{
  requirements: X402PaymentRequirements;
  headers: Headers;
  query: URLSearchParams;
  ledger: FulfilmentLedger;
  facilitator: FacilitatorClient;
  deliverable: Deliverable;
  now: Date;
}>;

/**
 * Take one presented authorization as far as it can honestly go.
 *
 * The status codes are chosen rather than inherited. An unreadable payload is
 * `400` — the buyer's client is wrong and a fresh quote will not help. A
 * payload that reads but does not match the quote is `402` with the reason, so
 * a client can correct it and present a new one. A second authorization against
 * one quote is `409`: the quote is spent, and that is a conflict rather than a
 * payment problem.
 */
export async function settleAndServe(input: SettleAndServeInput): Promise<SaleOutcome> {
  const { requirements, ledger, facilitator, deliverable, now } = input;

  const decoded = decodePaymentAuthorization(input.headers);
  if (!decoded.ok) {
    return refuse(400, decoded.reasonCode, decoded.detail);
  }
  const authorization = decoded.value;

  const verdict = verifyPaymentAuthorization({ requirements, authorization, now });
  if (!verdict.ok) {
    return refuse(402, verdict.reasonCode, verdict.detail);
  }

  /* The claim comes before the facilitator, not after. A settle call that
     succeeded while two requests were in flight would charge once and let both
     believe they may serve; claiming first makes the second request a retry of
     the first rather than a second sale. */
  const claim = await ledger.claim({
    side: "SALE",
    paymentId: verdict.paymentId,
    nonce: requirements.nonce,
    requirementsDigest: requirements.requirementsDigest,
    resourceDigest: requirements.resourceDigest,
    network: requirements.network,
    assetRef: requirements.assetRef,
    amountBaseUnits: verdict.amount,
    payer: verdict.payer,
    payTo: requirements.payTo,
    facilitator: facilitator.id,
    nowMs: now.getTime(),
  });

  if (!claim.ok) {
    if (claim.reasonCode === "QUOTE_ALREADY_ANSWERED") {
      return refuse(409, claim.reasonCode, claim.detail);
    }
    if (claim.reasonCode !== "PAYMENT_ALREADY_CLAIMED" || !claim.record) {
      return refuse(400, claim.reasonCode, claim.detail, claim.record);
    }
    /* The same purchase, presented again. Answer with where it actually got to. */
    const existing = claim.record;
    if (existing.paymentStatus === "SETTLED" && existing.serviceDeliveryStatus === "DELIVERED") {
      const body = await deliverable
        .build({ requirements, query: input.query })
        .catch(() => null);
      if (body === null) {
        return refuse(
          502,
          "REDELIVERY_UNAVAILABLE",
          "this report was paid for and delivered once; it could not be produced again just now, and nothing has been charged",
          existing,
        );
      }
      return served("ALREADY_SERVED", body, requirements, existing);
    }
    if (existing.serviceDeliveryStatus === "NOT_DELIVERED") {
      /* A finished sale that owes money back. Answering "in progress" here
         would hide a refund that is already due. */
      return refuse(
        502,
        "PAID_BUT_UNSERVED",
        "this payment settled and the report was not delivered; the sale is recorded as not delivered and a refund is due",
        existing,
      );
    }
    if (existing.paymentStatus === "FAILED") {
      return refuse(402, "PAYMENT_FAILED", "the facilitator reported this payment as failed", existing);
    }
    /* `UNKNOWN` is a payment in doubt; anything else here is a purchase the
       winning request is still working through. */
    return pending(
      requirements,
      existing,
      existing.paymentStatus === "UNKNOWN" ? "AWAITING_RECONCILIATION" : "IN_PROGRESS",
    );
  }

  /* `/supported` before `/settle`: a facilitator that does not take this
     network and scheme cannot settle, and finding that out from a failed settle
     would leave a sale in an unknown state for no reason. */
  const supported = await facilitator
    .supported()
    .catch(() => null);
  if (supported === null) {
    const unknown = await ledger.recordSettlement({
      side: "SALE",
      paymentId: verdict.paymentId,
      report: Object.freeze({
        status: "UNKNOWN" as const,
        transaction: null,
        source: "FACILITATOR_REPORT" as const,
        detail: "the facilitator did not answer /supported",
      }),
      nowMs: now.getTime(),
    });
    return unknown.ok
      ? pending(requirements, unknown.record)
      : refuse(503, unknown.reasonCode, unknown.detail);
  }
  const pairDeclared = supported.some(
    (entry) => entry.network === requirements.network && entry.scheme === requirements.scheme,
  );
  if (!pairDeclared) {
    const closed = await ledger.recordSettlement({
      side: "SALE",
      paymentId: verdict.paymentId,
      report: Object.freeze({
        status: "FAILED" as const,
        transaction: null,
        source: "FACILITATOR_REPORT" as const,
        detail: `the facilitator does not take ${requirements.scheme} on ${requirements.network}`,
      }),
      nowMs: now.getTime(),
    });
    return refuse(
      503,
      "FACILITATOR_DOES_NOT_TAKE_THIS_PAIR",
      `the facilitator's /supported does not list ${requirements.scheme} on ${requirements.network}; nothing was settled`,
      closed.ok ? closed.record : null,
    );
  }

  const report = await settleWithDeadline({
    facilitator,
    requirements,
    authorization,
    timeoutMs: requirements.maxTimeoutSeconds * 1_000,
  });
  const settled = await ledger.recordSettlement({
    side: "SALE",
    paymentId: verdict.paymentId,
    report,
    nowMs: now.getTime(),
  });
  if (!settled.ok) return refuse(503, settled.reasonCode, settled.detail);

  if (settled.record.paymentStatus === "UNKNOWN") {
    /* Awaiting reconciliation: the buyer is told, the resource is not served,
       and nothing is charged again. */
    return pending(requirements, settled.record);
  }
  if (settled.record.paymentStatus === "FAILED") {
    return refuse(402, "PAYMENT_FAILED", report.detail, settled.record);
  }

  const body = await deliverable.build({ requirements, query: input.query }).catch(() => null);
  if (body === null) {
    const missed = await ledger.recordDelivery({
      side: "SALE",
      paymentId: verdict.paymentId,
      delivered: false,
      source: "RESOURCE_RESPONSE",
      nowMs: now.getTime(),
    });
    return refuse(
      502,
      "PAID_BUT_UNSERVED",
      "the payment settled and the report could not be produced; the sale is recorded as not delivered and a refund is due",
      missed.ok ? missed.record : settled.record,
    );
  }

  const delivered = await ledger.recordDelivery({
    side: "SALE",
    paymentId: verdict.paymentId,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: now.getTime(),
  });
  if (!delivered.ok) return refuse(502, delivered.reasonCode, delivered.detail, settled.record);

  return served("DELIVERED", body, requirements, delivered.record);
}

/** The ledger over the deployment's own Guard store. One line, named once. */
export { createFulfilmentLedger };

/** The `PAYMENT-REQUIRED` outcome, for the branch that has no authorization. */
export function requirementsOutcome(requirements: X402PaymentRequirements): SaleOutcome {
  return Object.freeze({
    kind: "REQUIREMENTS" as const,
    status: 402 as const,
    requirements,
    headerName: X402_HEADERS.requirements,
    headerValue: encodePaymentRequirements(requirements),
  });
}
