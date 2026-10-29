// Run from repo root: node --test lib/agent-control/procurement/battery.test.mjs
//
// The battery the registry row names, on one sale with one fact changed.
//
// Nine cases are required of SOL-5: a wrong network, a wrong mint, a swapped
// recipient, an overridden amount, an expired authorization, a repeated
// signature, a timeout after settlement, concurrent requests, and paid without
// delivery. Each is a test below, named in those words, and each goes through
// the whole seller — decode, verify, claim, `/supported`, `/settle`, deliver —
// rather than through the one function that happens to refuse it. A unit test
// of the verifier proves the verifier; only the whole flow proves that nothing
// downstream serves a resource anyway.
//
// The invariant every case shares: **one payment, at most one fulfilled
// resource**, and no charge that nobody confirmed is ever retried.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { createFulfilmentLedger } from "./fulfilment.ts";
import { issueQuote, settleAndServe } from "./sale.ts";
import { TOKEN_DEEP_REPORT, sellerReadiness } from "./seller.ts";
import {
  DEVNET,
  FIXTURE,
  MAINNET,
  USDC_MAINNET,
  authorizationHeader,
  fixtureSellerEnv,
  headersWith,
  stubDeliverable,
  stubFacilitator,
} from "./fixtures.ts";

const ORIGIN = "https://ryntra.io";
const NOW = new Date("2026-10-26T12:00:00.000Z");

/**
 * The service as it will be once AGH-1 lands.
 *
 * `deliverableTaskRef` is the one field changed, and changing it here rather
 * than in the source is the honest arrangement: the x402 machinery is complete
 * and what is missing is the report, so the battery runs the finished flow
 * against a fixture report and the live service stays unsellable.
 */
const SERVICE = Object.freeze({ ...TOKEN_DEEP_REPORT, deliverableTaskRef: null, maxTimeoutSeconds: 2 });

function config(overrides = {}) {
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv(overrides));
  assert.ok(readiness.config, "the fixture environment stopped producing a configuration");
  return readiness.config;
}

function quote({ nonce = "battery-nonce-00000001", query = new URLSearchParams({ mint: USDC_MAINNET }), now = NOW, service = SERVICE, env = {} } = {}) {
  return issueQuote({ service, config: config(env), origin: ORIGIN, query, nonce, now });
}

function sale({ facilitator, deliverable, ledger } = {}) {
  return {
    facilitator: facilitator ?? stubFacilitator(),
    deliverable: deliverable ?? stubDeliverable(),
    ledger: ledger ?? createFulfilmentLedger(createMemoryGuardStore()),
  };
}

async function serve({ requirements, header, parts, now = NOW, query = new URLSearchParams({ mint: USDC_MAINNET }) }) {
  return settleAndServe({
    requirements,
    headers: headersWith(header),
    query,
    ledger: parts.ledger,
    facilitator: parts.facilitator,
    deliverable: parts.deliverable,
    now,
  });
}

/* ── The happy path, so the nine refusals mean something ──────────────────── */

test("a correct authorization is settled once and the report is served once", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({ requirements, header: authorizationHeader(requirements), parts });

  assert.equal(outcome.kind, "DELIVERED");
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { report: "a fixture deep report" });
  assert.equal(outcome.response.settlement, "SETTLED");
  assert.equal(outcome.response.delivery, "DELIVERED");
  assert.equal(outcome.headerName, "PAYMENT-RESPONSE");
  assert.equal(parts.facilitator.calls.settle, 1);
  assert.equal(parts.facilitator.calls.supported, 1);
  assert.equal(parts.deliverable.calls.build, 1);
});

/* ── 1. A wrong network ──────────────────────────────────────────────────── */

test("wrong network: refused before anything is claimed or settled", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({
    requirements,
    header: authorizationHeader(requirements, {}, { network: MAINNET }),
    parts,
  });
  assert.equal(outcome.kind, "REFUSED");
  assert.equal(outcome.status, 402);
  assert.equal(outcome.reasonCode, "AUTHORIZATION_NETWORK_MISMATCH");
  assert.equal(parts.facilitator.calls.settle, 0);
  assert.equal(parts.deliverable.calls.build, 0);
  assert.equal(await parts.ledger.readQuote("SALE", requirements.nonce), null);
});

/* ── 2. A wrong mint ─────────────────────────────────────────────────────── */

test("wrong mint: refused, and the quote stays unspent", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({
    requirements,
    header: authorizationHeader(requirements, { asset: FIXTURE.otherMint }),
    parts,
  });
  assert.equal(outcome.reasonCode, "AUTHORIZATION_ASSET_MISMATCH");
  assert.equal(parts.facilitator.calls.settle, 0);
  // A refused attempt must not burn the nonce: the buyer corrects its client
  // and presents a payload against the same quote.
  assert.equal(await parts.ledger.readQuote("SALE", requirements.nonce), null);
  const corrected = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(corrected.kind, "DELIVERED");
});

/* ── 3. A swapped recipient ──────────────────────────────────────────────── */

test("swapped recipient: refused, and nothing is served", async () => {
  // The classic malicious `payTo`: the payload is otherwise the quote's own.
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({
    requirements,
    header: authorizationHeader(requirements, { payTo: FIXTURE.otherPayTo }),
    parts,
  });
  assert.equal(outcome.reasonCode, "AUTHORIZATION_RECIPIENT_MISMATCH");
  assert.equal(parts.deliverable.calls.build, 0);
});

/* ── 4. An overridden amount ─────────────────────────────────────────────── */

test("overridden amount: both more and less than the quote are refused", async () => {
  const requirements = quote();
  for (const amount of ["1", "49999", "50001", "999999999"]) {
    const parts = sale();
    const outcome = await serve({
      requirements,
      header: authorizationHeader(requirements, { amount }),
      parts,
    });
    assert.equal(outcome.reasonCode, "AUTHORIZATION_AMOUNT_MISMATCH", amount);
    assert.equal(parts.facilitator.calls.settle, 0, amount);
  }
});

/* ── 5. An expired authorization ─────────────────────────────────────────── */

test("expired: a quote that has run out is refused even seconds later", async () => {
  const requirements = quote();
  const parts = sale();
  const later = new Date(Date.parse(requirements.expiresAt) + 1_000);
  const outcome = await serve({
    requirements,
    header: authorizationHeader(requirements),
    parts,
    now: later,
  });
  assert.equal(outcome.reasonCode, "AUTHORIZATION_EXPIRED");
  assert.equal(parts.facilitator.calls.settle, 0);
});

/* ── 6. A repeated signature ─────────────────────────────────────────────── */

test("repeated signature: the same purchase is re-served and never charged twice", async () => {
  const requirements = quote();
  const parts = sale();
  const first = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(first.kind, "DELIVERED");

  const again = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(again.kind, "ALREADY_SERVED");
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  // GATE-PROVED: one settle call in total. The second request produced the
  // report again — compute, not money — and did not reach the facilitator.
  assert.equal(parts.facilitator.calls.settle, 1);
  assert.equal(parts.deliverable.calls.build, 2);
});

test("repeated signature, different payload: a second authorization cannot take one quote", async () => {
  const requirements = quote();
  const parts = sale();
  await serve({ requirements, header: authorizationHeader(requirements), parts });
  const second = await serve({
    requirements,
    header: authorizationHeader(requirements, { signature: "YW5vdGhlci1zaWduYXR1cmUtMDAwMDAwMDAw" }),
    parts,
  });
  assert.equal(second.kind, "REFUSED");
  assert.equal(second.status, 409);
  assert.equal(second.reasonCode, "QUOTE_ALREADY_ANSWERED");
  assert.equal(parts.facilitator.calls.settle, 1);
});

/* ── 7. A timeout after settlement ───────────────────────────────────────── */

test("timeout after settlement: the sale awaits reconciliation and is never charged again", async () => {
  // The facilitator settles and the answer never arrives. From the seller's
  // side that is indistinguishable from a failure, so it is neither: the
  // payment is unknown, nothing is served, and no retry is attempted.
  const requirements = quote();
  const slow = stubFacilitator({ settleDelayMs: requirements.maxTimeoutSeconds * 1_000 + 200 });
  const parts = sale({ facilitator: slow });
  const outcome = await serve({ requirements, header: authorizationHeader(requirements), parts });

  assert.equal(outcome.kind, "AWAITING_RECONCILIATION");
  assert.equal(outcome.status, 202);
  assert.equal(outcome.response.settlement, "PENDING_VERIFICATION");
  assert.equal(outcome.response.delivery, "AWAITING_RECONCILIATION");
  assert.equal(outcome.record.paymentStatus, "UNKNOWN");
  assert.equal(parts.deliverable.calls.build, 0);

  // The buyer retries. It is told the same thing, and the facilitator is not
  // called a second time.
  const retried = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(retried.kind, "AWAITING_RECONCILIATION");
  assert.equal(slow.calls.settle, 1);

  // Later, somebody can say. Reconciliation records it without charging.
  const resolved = await parts.ledger.reconcileSettlement({
    side: "SALE",
    paymentId: outcome.record.paymentId,
    report: { status: "SETTLED", transaction: "5Late", source: "CHAIN_READ", detail: "read from the chain" },
    nowMs: NOW.getTime() + 60_000,
  });
  assert.equal(resolved.record.paymentStatus, "SETTLED");
  assert.equal(slow.calls.settle, 1);
});

test("a facilitator that cannot be reached is unknown, not failed", async () => {
  const requirements = quote();
  const unreachable = stubFacilitator({ throwOnSettle: true });
  const parts = sale({ facilitator: unreachable });
  const outcome = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(outcome.kind, "AWAITING_RECONCILIATION");
  assert.equal(outcome.record.paymentStatus, "UNKNOWN");
});

test("a facilitator that does not take this pair settles nothing", async () => {
  // `/supported` runs before `/settle` for exactly this: finding out from a
  // failed settle would leave a sale in an unknown state for no reason.
  const requirements = quote();
  const wrongPair = stubFacilitator({ supported: [{ network: MAINNET, scheme: "exact" }] });
  const parts = sale({ facilitator: wrongPair });
  const outcome = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(outcome.kind, "REFUSED");
  assert.equal(outcome.status, 503);
  assert.equal(outcome.reasonCode, "FACILITATOR_DOES_NOT_TAKE_THIS_PAIR");
  assert.equal(wrongPair.calls.settle, 0);
  assert.equal(requirements.network, DEVNET);
});

/* ── 8. Concurrent requests ──────────────────────────────────────────────── */

test("concurrent requests: the same authorization twice settles once", async () => {
  const requirements = quote();
  const parts = sale();
  const header = authorizationHeader(requirements);
  const [first, second] = await Promise.all([
    serve({ requirements, header, parts }),
    serve({ requirements, header, parts }),
  ]);

  // The loser arrives while the winner is still settling, so it is told the
  // purchase is in progress rather than that its payment is in doubt.
  const kinds = [first.kind, second.kind].sort();
  assert.deepEqual(kinds, ["DELIVERED", "IN_PROGRESS"]);
  const loser = [first, second].find((outcome) => outcome.kind === "IN_PROGRESS");
  assert.equal(loser.status, 202);
  // GATE-PROVED: one charge. Two callers raced the claim and only one reached
  // the facilitator.
  assert.equal(parts.facilitator.calls.settle, 1);
});

test("concurrent requests: two authorizations against one quote charge once", async () => {
  const requirements = quote();
  const parts = sale();
  const [first, second] = await Promise.all([
    serve({ requirements, header: authorizationHeader(requirements), parts }),
    serve({
      requirements,
      header: authorizationHeader(requirements, { signature: "c2Vjb25kLXNpZ25hdHVyZS0wMDAwMDAwMDAw" }),
      parts,
    }),
  ]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((outcome) => outcome.kind === "DELIVERED").length, 1);
  const refused = outcomes.find((outcome) => outcome.kind === "REFUSED");
  assert.equal(refused.reasonCode, "QUOTE_ALREADY_ANSWERED");
  assert.equal(parts.facilitator.calls.settle, 1);
});

/* ── 9. Paid without delivery ────────────────────────────────────────────── */

test("paid but not delivered: recorded as such, with a refund due", async () => {
  const requirements = quote();
  const parts = sale({ deliverable: stubDeliverable({ failing: true }) });
  const outcome = await serve({ requirements, header: authorizationHeader(requirements), parts });

  assert.equal(outcome.kind, "REFUSED");
  assert.equal(outcome.status, 502);
  assert.equal(outcome.reasonCode, "PAID_BUT_UNSERVED");
  assert.equal(outcome.record.paymentStatus, "SETTLED");
  assert.equal(outcome.record.serviceDeliveryStatus, "NOT_DELIVERED");
  // The pair names it, and the refund follows from the pair rather than from a
  // caller deciding to set it.
  assert.equal(outcome.record.pairing, "PAID_BUT_UNSERVED");
  assert.equal(outcome.record.refund, "DUE");

  // And a retry says the same thing — a refund is due — rather than charging
  // again or flipping the record to delivered.
  const retried = await serve({ requirements, header: authorizationHeader(requirements), parts });
  assert.equal(retried.kind, "REFUSED");
  assert.equal(retried.reasonCode, "PAID_BUT_UNSERVED");
  assert.equal(parts.facilitator.calls.settle, 1);
  const stored = await parts.ledger.read("SALE", outcome.record.paymentId);
  assert.equal(stored.serviceDeliveryStatus, "NOT_DELIVERED");
});

/* ── Two more the review's own list names ────────────────────────────────── */

test("an altered resource digest cannot move a quote to another deliverable", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({
    requirements,
    header: authorizationHeader(requirements, { resourceDigest: `0x${"ee".repeat(32)}` }),
    parts,
  });
  assert.equal(outcome.reasonCode, "AUTHORIZATION_RESOURCE_DIGEST_MISMATCH");
});

test("a quote for one mint cannot be answered for another", async () => {
  // Both quotes are served at the same path — the mint is a query parameter —
  // so the URL alone cannot tell them apart. The descriptor inside the digest
  // is what binds a quote to its question, and it is the digest that refuses
  // here, before the nonce is even compared.
  const forOne = quote({ query: new URLSearchParams({ mint: USDC_MAINNET }) });
  const forAnother = quote({ nonce: "battery-nonce-00000002", query: new URLSearchParams({ mint: FIXTURE.otherMint }) });
  assert.equal(forOne.resource, forAnother.resource);
  assert.notEqual(forOne.resourceDigest, forAnother.resourceDigest);
  const parts = sale();
  const outcome = await serve({
    requirements: forOne,
    header: authorizationHeader(forAnother),
    parts,
  });
  assert.equal(outcome.reasonCode, "AUTHORIZATION_RESOURCE_DIGEST_MISMATCH");
  assert.equal(parts.facilitator.calls.settle, 0);
});

test("a V1 client is told it is V1, and nothing it sends is read", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await settleAndServe({
    requirements,
    headers: headersWith(authorizationHeader(requirements), { "X-PAYMENT": "v1 payload" }),
    query: new URLSearchParams(),
    ledger: parts.ledger,
    facilitator: parts.facilitator,
    deliverable: parts.deliverable,
    now: NOW,
  });
  assert.equal(outcome.status, 400);
  assert.equal(outcome.reasonCode, "AUTHORIZATION_HEADER_IS_V1");
});

test("no authorization at all is a 400 rather than a silent 402 loop", async () => {
  const requirements = quote();
  const parts = sale();
  const outcome = await serve({ requirements, header: null, parts });
  assert.equal(outcome.status, 400);
  assert.equal(outcome.reasonCode, "AUTHORIZATION_HEADER_MISSING");
});
