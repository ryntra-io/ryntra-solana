/**
 * The seller's endpoint for the one paid service.
 *
 * Without a `PAYMENT-SIGNATURE` it answers `402` with `PAYMENT-REQUIRED`; with
 * one it runs the whole sale. Both halves live in
 * `lib/agent-control/procurement/sale.ts`; this file is the HTTP shape around
 * them and the place where the two ports are resolved.
 *
 * ## In production both ports are absent, and the route says so
 *
 * There is no facilitator client in this repository — the credential is the
 * owner's and arrives with it — and the deep report itself is AGH-1 and is not
 * built. So the wiring below resolves both to `null` and the route answers
 * `503` with the exact list: the owner's four values, the facilitator client
 * and the deliverable. That is not a stub standing in for a feature. Issuing a
 * quote for an answer that does not exist is the `PAID_BUT_UNSERVED` case, and
 * refusing to quote is the only honest behaviour until both ports exist.
 *
 * The tests supply both and exercise the finished flow, which is what makes
 * this a completed path waiting on a key rather than a sketch.
 */

import { randomBytes } from "node:crypto";

import {
  X402_HEADERS,
  encodePaymentRequirements,
} from "../../../../../lib/agent-control/procurement/protocol.ts";
import {
  createFulfilmentLedger,
  type FulfilmentLedger,
} from "../../../../../lib/agent-control/procurement/fulfilment.ts";
import {
  issueNonce,
  issueQuote,
  settleAndServe,
  type Deliverable,
  type FacilitatorClient,
} from "../../../../../lib/agent-control/procurement/sale.ts";
import {
  TOKEN_DEEP_REPORT,
  sellerReadiness,
} from "../../../../../lib/agent-control/procurement/seller.ts";
import { getAgentControlRuntime } from "../../../../../lib/agent-control/runtime.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

export type TokenReportDependencies = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  /** The durable claim store. One per request is fine: it holds no state. */
  ledger?: () => FulfilmentLedger;
  /** `null` while Ryntra holds no facilitator credential, which is always here. */
  facilitator?: () => FacilitatorClient | null;
  /** `null` while the deep report is AGH-1 and not built. */
  deliverable?: () => Deliverable | null;
  now?: () => Date;
  nonce?: () => string;
}>;

function unavailable(blockers: readonly Readonly<{ code: string; detail: string }>[]): Response {
  return Response.json(
    {
      error: {
        code: "SERVICE_NOT_SELLABLE",
        message: "This service is not for sale yet, and nothing has been charged.",
        blockers: blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })),
      },
    },
    { status: 503, headers: privateNoStoreHeaders() },
  );
}

export function createTokenReportHandler(dependencies: TokenReportDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const nonce = dependencies.nonce ?? (() => issueNonce((size) => randomBytes(size)));
  const ledgerFor = dependencies.ledger ?? (() => createFulfilmentLedger(getAgentControlRuntime().guardStore));
  /* Both default to absent on purpose. See the module header. */
  const facilitatorFor = dependencies.facilitator ?? (() => null);
  const deliverableFor = dependencies.deliverable ?? (() => null);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const facilitator = facilitatorFor();
    const deliverable = deliverableFor();

    /* The service's own «deliverable not built» blocker is exactly the question
       the port answers, so it is cleared when a deliverable is supplied rather
       than reported twice. */
    const service = {
      ...TOKEN_DEEP_REPORT,
      deliverableTaskRef: deliverable === null ? TOKEN_DEEP_REPORT.deliverableTaskRef : null,
    };
    const readiness = sellerReadiness(service, env);

    /* Everything missing, in one list, rather than the first thing missing. */
    const blockers = [
      ...(readiness.sellable ? [] : readiness.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail }))),
      ...(facilitator === null
        ? [
            {
              code: "FACILITATOR_CLIENT_NOT_CONFIGURED",
              detail:
                "Ryntra holds no facilitator credential. The client and its key are the owner's, and nothing is quoted without them.",
            },
          ]
        : []),
    ];
    if (blockers.length > 0 || !readiness.config || facilitator === null || deliverable === null) {
      return unavailable(blockers);
    }

    const origin = url.origin;
    if (!/^https:\/\/[^/]+$/.test(origin)) {
      return unavailable([
        {
          code: "ORIGIN_NOT_HTTPS",
          detail: "A priced resource is not served in the clear, and this request did not arrive over https.",
        },
      ]);
    }

    const requirements = issueQuote({
      service,
      config: readiness.config,
      origin,
      query: url.searchParams,
      nonce: nonce(),
      now: now(),
    });

    /* No authorization presented: answer with the quote and charge nothing. */
    if (request.headers.get(X402_HEADERS.authorization) === null && request.headers.get("X-PAYMENT") === null) {
      return Response.json(
        { error: { code: "PAYMENT_REQUIRED", message: "This resource is paid for with x402 V2, scheme `exact`." } },
        {
          status: 402,
          headers: {
            ...privateNoStoreHeaders(),
            [X402_HEADERS.requirements]: encodePaymentRequirements(requirements),
          },
        },
      );
    }

    const outcome = await settleAndServe({
      requirements,
      headers: request.headers,
      query: url.searchParams,
      ledger: ledgerFor(),
      facilitator,
      deliverable,
      now: now(),
    });

    if (outcome.kind === "REQUIREMENTS") {
      return Response.json(
        { error: { code: "PAYMENT_REQUIRED", message: "This resource is paid for with x402 V2, scheme `exact`." } },
        {
          status: 402,
          headers: { ...privateNoStoreHeaders(), [outcome.headerName]: outcome.headerValue },
        },
      );
    }
    if (outcome.kind === "REFUSED") {
      return Response.json(
        {
          error: {
            code: outcome.reasonCode,
            message: outcome.detail,
            paymentId: outcome.record?.paymentId ?? null,
            refund: outcome.record?.refund ?? null,
          },
        },
        { status: outcome.status, headers: privateNoStoreHeaders() },
      );
    }
    if (outcome.kind === "AWAITING_RECONCILIATION" || outcome.kind === "IN_PROGRESS") {
      return Response.json(
        {
          data: {
            state: outcome.kind,
            paymentId: outcome.record.paymentId,
            settlement: outcome.response.settlement,
            delivery: outcome.response.delivery,
            message:
              outcome.kind === "AWAITING_RECONCILIATION"
                ? "The settlement could not be confirmed. This sale awaits reconciliation and will never be charged again."
                : "This purchase is being served by the request that claimed it. Nothing further is charged.",
          },
        },
        {
          status: outcome.status,
          headers: {
            ...privateNoStoreHeaders(),
            [outcome.headerName]: outcome.headerValue,
            "Retry-After": "5",
          },
        },
      );
    }

    /* Served. The two kinds that reach here — a first delivery and a re-serve
       of the same purchase — carry the same body and the same receipt, and the
       `meta.state` is what tells them apart. */
    if (outcome.kind === "DELIVERED" || outcome.kind === "ALREADY_SERVED") {
      return Response.json(
        { data: outcome.body, meta: { state: outcome.kind, paymentId: outcome.record.paymentId } },
        {
          status: outcome.status,
          headers: { ...privateNoStoreHeaders(), [outcome.headerName]: outcome.headerValue },
        },
      );
    }

    /* Unreachable while `SaleOutcome` has the kinds above. Kept so a seventh
       kind added to the union is a failing type-check rather than a 500. */
    return Response.json(
      { error: { code: "SALE_OUTCOME_UNKNOWN", message: "The sale produced an outcome this route cannot render." } },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  };
}
