// Run from repo root: node --test app/api/agents/services/token-report/route.test.mjs
//
// The seller's endpoint. Two states matter and both are tested here: the one it
// is in today — not for sale, with the reasons — and the one it is in once the
// Owner supplies a facilitator and AGH-1 supplies a report.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../../../../../lib/guard/store.ts";
import { createFulfilmentLedger } from "../../../../../lib/agent-control/procurement/fulfilment.ts";
import {
  buildPaymentRequirements,
  decodePaymentAuthorization,
} from "../../../../../lib/agent-control/procurement/protocol.ts";
import { TOKEN_DEEP_REPORT, sellerReadiness } from "../../../../../lib/agent-control/procurement/seller.ts";
import {
  authorizationHeader,
  fixtureSellerEnv,
  stubDeliverable,
  stubFacilitator,
} from "../../../../../lib/agent-control/procurement/fixtures.ts";
import { createTokenReportHandler } from "./handler.ts";

const URL_UNDER_TEST = "https://ryntra.io/api/agents/services/token-report?mint=So11111111111111111111111111111111111111112";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const NONCE = "route-nonce-000000000001";

function handler({ env = fixtureSellerEnv(), facilitator, deliverable, ledger } = {}) {
  const store = createMemoryGuardStore();
  return createTokenReportHandler({
    env,
    now: () => NOW,
    nonce: () => NONCE,
    ledger: ledger ?? (() => createFulfilmentLedger(store)),
    facilitator: () => facilitator ?? null,
    deliverable: () => deliverable ?? null,
  });
}

/* ── What it is today ─────────────────────────────────────────────────────── */

test("with nothing configured it is 503 and names every blocker, charging nothing", async () => {
  const response = await handler({ env: {} })(new Request(URL_UNDER_TEST));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("PAYMENT-REQUIRED"), null, "a quote was issued for a sale that cannot happen");
  const body = await response.json();
  assert.equal(body.error.code, "SERVICE_NOT_SELLABLE");
  const codes = body.error.blockers.map((blocker) => blocker.code);
  for (const expected of [
    "NETWORK_NOT_SET_BY_OWNER",
    "PRICE_NOT_SET_BY_OWNER",
    "DELIVERABLE_NOT_BUILT",
    "FACILITATOR_CLIENT_NOT_CONFIGURED",
  ]) {
    assert.ok(codes.includes(expected), `${expected} is not reported`);
  }
});

test("with the owner's four values but no facilitator client it still refuses to quote", async () => {
  // GATE-PROVED: this is the shipped state. A `402` here would be a quote for a
  // payment nobody can settle and a report nobody can produce.
  const response = await handler()(new Request(URL_UNDER_TEST));
  assert.equal(response.status, 503);
  const body = await response.json();
  const codes = body.error.blockers.map((blocker) => blocker.code);
  assert.deepEqual(codes.sort(), ["DELIVERABLE_NOT_BUILT", "FACILITATOR_CLIENT_NOT_CONFIGURED"].sort());
  assert.equal(sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv()).sellable, false);
});

/* ── What it is once both ports exist ─────────────────────────────────────── */

test("with both ports present and no payment it answers 402 with the quote", async () => {
  const response = await handler({
    facilitator: stubFacilitator(),
    deliverable: stubDeliverable(),
  })(new Request(URL_UNDER_TEST));

  assert.equal(response.status, 402);
  const header = response.headers.get("PAYMENT-REQUIRED");
  assert.ok(header, "no PAYMENT-REQUIRED header");
  const quote = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert.equal(quote.x402Version, 2);
  assert.equal(quote.scheme, "exact");
  assert.equal(quote.nonce, NONCE);
  assert.equal(quote.maxAmountRequired, "50000");
  assert.equal(quote.network, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.match(quote.resource, /^https:\/\/ryntra\.io\/api\/agents\/services\/token-report$/);
});

/** The quote the handler issues for this URL, rebuilt with the same inputs. */
function quoteForUrl() {
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv());
  const url = new URL(URL_UNDER_TEST);
  return buildPaymentRequirements({
    scheme: TOKEN_DEEP_REPORT.scheme,
    network: readiness.config.network,
    asset: readiness.config.mint,
    assetSymbol: readiness.config.assetSymbol,
    decimals: readiness.config.decimals,
    maxAmountRequired: readiness.config.priceBaseUnits,
    payTo: readiness.config.payTo,
    resource: `${url.origin}${TOKEN_DEEP_REPORT.path}`,
    resourceDescriptor: {
      serviceId: TOKEN_DEEP_REPORT.serviceId,
      query: [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    },
    description: TOKEN_DEEP_REPORT.label,
    mimeType: TOKEN_DEEP_REPORT.mimeType,
    maxTimeoutSeconds: TOKEN_DEEP_REPORT.maxTimeoutSeconds,
    facilitator: readiness.config.facilitator,
    nonce: NONCE,
    refundReference: `${url.origin}/agents/workspace/procurement`,
    now: NOW,
    validForSeconds: TOKEN_DEEP_REPORT.validForSeconds,
  });
}

test("a presented authorization is settled and the report is served with a PAYMENT-RESPONSE", async () => {
  const facilitator = stubFacilitator();
  const deliverable = stubDeliverable({ body: { report: "fixture" } });
  const requirements = quoteForUrl();
  const response = await handler({ facilitator, deliverable })(
    new Request(URL_UNDER_TEST, {
      headers: { "PAYMENT-SIGNATURE": authorizationHeader(requirements) },
    }),
  );

  assert.equal(response.status, 200);
  const header = response.headers.get("PAYMENT-RESPONSE");
  assert.ok(header, "no PAYMENT-RESPONSE header");
  const receipt = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert.equal(receipt.settlement, "SETTLED");
  assert.equal(receipt.delivery, "DELIVERED");
  const body = await response.json();
  assert.deepEqual(body.data, { report: "fixture" });
  assert.equal(body.meta.state, "DELIVERED");
  assert.equal(facilitator.calls.settle, 1);
});

test("a V1 header is a 400 that names V1, and nothing is settled", async () => {
  const facilitator = stubFacilitator();
  const response = await handler({ facilitator, deliverable: stubDeliverable() })(
    new Request(URL_UNDER_TEST, { headers: { "X-PAYMENT": "v1 payload" } }),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "AUTHORIZATION_HEADER_IS_V1");
  assert.equal(facilitator.calls.settle, 0);
});

test("a swapped recipient is a 402 with the reason, and the facilitator is never called", async () => {
  const facilitator = stubFacilitator();
  const requirements = quoteForUrl();
  const response = await handler({ facilitator, deliverable: stubDeliverable() })(
    new Request(URL_UNDER_TEST, {
      headers: {
        "PAYMENT-SIGNATURE": authorizationHeader(requirements, {
          payTo: "GmFNVt4tXsYXn5RQZJLWNix8ksd8XE69JGzZcd5X1rng",
        }),
      },
    }),
  );
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.error.code, "AUTHORIZATION_RECIPIENT_MISMATCH");
  assert.equal(facilitator.calls.settle, 0);
});

test("an unconfirmable settlement is a 202 that says so and is never charged again", async () => {
  const facilitator = stubFacilitator({ throwOnSettle: true });
  const store = createMemoryGuardStore();
  const serve = handler({
    facilitator,
    deliverable: stubDeliverable(),
    ledger: () => createFulfilmentLedger(store),
  });
  const requirements = quoteForUrl();
  const request = () =>
    new Request(URL_UNDER_TEST, { headers: { "PAYMENT-SIGNATURE": authorizationHeader(requirements) } });

  const first = await serve(request());
  assert.equal(first.status, 202);
  const body = await first.json();
  assert.equal(body.data.state, "AWAITING_RECONCILIATION");
  assert.equal(body.data.settlement, "PENDING_VERIFICATION");
  assert.equal(first.headers.get("Retry-After"), "5");

  const second = await serve(request());
  assert.equal(second.status, 202);
  assert.equal(facilitator.calls.settle, 1);
});

test("a settled payment whose report fails is a 502 that names the refund", async () => {
  const requirements = quoteForUrl();
  const response = await handler({
    facilitator: stubFacilitator(),
    deliverable: stubDeliverable({ failing: true }),
  })(
    new Request(URL_UNDER_TEST, { headers: { "PAYMENT-SIGNATURE": authorizationHeader(requirements) } }),
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, "PAID_BUT_UNSERVED");
  assert.equal(body.error.refund, "DUE");
  assert.match(body.error.paymentId, /^0x[0-9a-f]{64}$/);
});

test("the quote the handler issues is the one the verifier reads", () => {
  // Pinned because the handler and this test build the quote independently: if
  // either drifts, every payment against the live route would refuse on a
  // digest the buyer could never have produced.
  const requirements = quoteForUrl();
  const decoded = decodePaymentAuthorization(
    new Headers({ "PAYMENT-SIGNATURE": authorizationHeader(requirements) }),
  );
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.payload.resourceDigest, requirements.resourceDigest);
});
