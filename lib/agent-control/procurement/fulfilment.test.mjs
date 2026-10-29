// Run from repo root: node --test lib/agent-control/procurement/fulfilment.test.mjs
//
// One payment, at most one execution — and no second charge for a settlement
// nobody could confirm.
//
// Every test here is about a *second* attempt: a retried authorization, a
// second authorization against one quote, two requests arriving together, a
// settlement recorded twice, a delivery recorded twice. The first attempt
// working is the easy half; what makes the invariant real is which of two
// callers loses, and what the loser is told.
import { test } from "node:test";
import assert from "node:assert/strict";

import { GUARD_COLLECTIONS, createMemoryGuardStore } from "../../guard/store.ts";
import { settlementPairing } from "../payments/vocabulary.ts";
import { FULFILMENT_REFUSALS, createFulfilmentLedger } from "./fulfilment.ts";
import { DEVNET, FIXTURE, USDC_DEVNET } from "./fixtures.ts";
import { splAssetRef } from "./protocol.ts";

const NOW_MS = Date.parse("2026-10-26T12:00:00.000Z");

function claimInput(overrides = {}) {
  return {
    side: "SALE",
    paymentId: `0x${"11".repeat(32)}`,
    nonce: "fixture-nonce-0000000001",
    requirementsDigest: `0x${"22".repeat(32)}`,
    resourceDigest: `0x${"33".repeat(32)}`,
    network: DEVNET,
    assetRef: splAssetRef(DEVNET, USDC_DEVNET),
    amountBaseUnits: "50000",
    payer: FIXTURE.buyer,
    payTo: FIXTURE.payTo,
    facilitator: "COINBASE_CDP",
    nowMs: NOW_MS,
    ...overrides,
  };
}

const settled = {
  status: "SETTLED",
  transaction: "5FixtureSignature",
  source: "FACILITATOR_REPORT",
  detail: "settled",
};
const unknown = {
  status: "UNKNOWN",
  transaction: null,
  source: "FACILITATOR_REPORT",
  detail: "the facilitator did not answer",
};

function ledger() {
  return createFulfilmentLedger(createMemoryGuardStore());
}

/* ── The collection ──────────────────────────────────────────────────────── */

test("the ledger's collection is one the Guard store already serves", () => {
  // A new collection name is a value in a column that exists, not a migration.
  assert.ok(GUARD_COLLECTIONS.includes("agentProcurementPayments"));
});

/* ── Claiming ────────────────────────────────────────────────────────────── */

test("a first claim records a signed authorization and nothing more", () => {
  const book = ledger();
  return book.claim(claimInput()).then((outcome) => {
    assert.equal(outcome.ok, true);
    const record = outcome.record;
    // Signed is not settled. The buyer's own signature establishes neither
    // that value moved nor that anything was served.
    assert.equal(record.paymentStatus, "AUTHORIZATION_SIGNED");
    assert.equal(record.paymentSource, null);
    assert.equal(record.serviceDeliveryStatus, "REQUESTED");
    assert.equal(record.reconciliation, "PENDING");
    assert.equal(record.refund, "NOT_DUE");
    assert.equal(record.pairing, null);
  });
});

test("the same authorization presented again is the same payment, with its outcome", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const again = await book.claim(claimInput());
  assert.equal(again.ok, false);
  assert.equal(again.reasonCode, "PAYMENT_ALREADY_CLAIMED");
  assert.match(again.detail, /never a second charge/);
  assert.equal(again.record.paymentId, claimInput().paymentId);
});

test("a second, different authorization against one quote is a conflict", async () => {
  // GATE-PROVED: without the quote key both payments would be claimed, each
  // individually satisfying «one payment, one resource» while the buyer paid
  // twice for one 402.
  const book = ledger();
  await book.claim(claimInput());
  const second = await book.claim(claimInput({ paymentId: `0x${"44".repeat(32)}` }));
  assert.equal(second.ok, false);
  assert.equal(second.reasonCode, "QUOTE_ALREADY_ANSWERED");
  assert.equal(second.record, null);
  assert.match(second.detail, /one 402 is one sale/);
});

test("two requests arriving together produce one winner and one loser", async () => {
  const book = ledger();
  const [first, second] = await Promise.all([book.claim(claimInput()), book.claim(claimInput())]);
  const wins = [first, second].filter((outcome) => outcome.ok);
  assert.equal(wins.length, 1, "both callers claimed the same payment");
  const loser = [first, second].find((outcome) => !outcome.ok);
  assert.equal(loser.reasonCode, "PAYMENT_ALREADY_CLAIMED");
});

test("two different authorizations arriving together both cannot take one quote", async () => {
  const book = ledger();
  const [first, second] = await Promise.all([
    book.claim(claimInput()),
    book.claim(claimInput({ paymentId: `0x${"55".repeat(32)}` })),
  ]);
  assert.equal([first, second].filter((outcome) => outcome.ok).length, 1);
  assert.equal([first, second].find((outcome) => !outcome.ok).reasonCode, "QUOTE_ALREADY_ANSWERED");
  // And the quote marker points at whichever payment won.
  const marker = await book.readQuote("SALE", claimInput().nonce);
  const winner = [first, second].find((outcome) => outcome.ok);
  assert.equal(marker.paymentId, winner.record.paymentId);
});

test("the two sides keep their own books", async () => {
  // A sale and a purchase can share a payment identifier without sharing a row:
  // the hub both sells and buys, and one key space for both would make a
  // purchase's claim refuse a sale.
  const book = ledger();
  assert.equal((await book.claim(claimInput({ side: "SALE" }))).ok, true);
  assert.equal((await book.claim(claimInput({ side: "PURCHASE" }))).ok, true);
});

test("an amount that is not whole base units is never claimed", async () => {
  const book = ledger();
  const outcome = await book.claim(claimInput({ amountBaseUnits: "0.05" }));
  assert.equal(outcome.reasonCode, "AMOUNT_MALFORMED");
  assert.equal(await book.read("SALE", claimInput().paymentId), null);
});

/* ── Settling ────────────────────────────────────────────────────────────── */

test("a settled payment names the source that said so", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const outcome = await book.recordSettlement({ side: "SALE", paymentId: claimInput().paymentId, report: settled, nowMs: NOW_MS });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.record.paymentStatus, "SETTLED");
  assert.equal(outcome.record.paymentSource, "FACILITATOR_REPORT");
  assert.equal(outcome.record.transaction, "5FixtureSignature");
});

test("a settlement is recorded once; a second attempt refuses", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  await book.recordSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS });
  const again = await book.recordSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS });
  assert.equal(again.ok, false);
  assert.equal(again.reasonCode, "SETTLEMENT_ALREADY_FINAL");
});

test("an unknown settlement waits for reconciliation and is never settled again", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  const pending = await book.recordSettlement({ side: "SALE", paymentId: id, report: unknown, nowMs: NOW_MS });
  assert.equal(pending.record.paymentStatus, "UNKNOWN");
  assert.equal(pending.record.reconciliation, "UNKNOWN");

  // GATE-PROVED: this is the step that would otherwise charge twice. A second
  // settle against an unknown payment is exactly the retry the registry row
  // forbids, and it refuses.
  const again = await book.recordSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS });
  assert.equal(again.ok, false);
  assert.equal(again.reasonCode, "SETTLEMENT_ALREADY_FINAL");
  assert.match(again.detail, /reconciled, never settled a second time/);
});

test("a reconciliation may move an unknown payment, and only an unknown one", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  await book.recordSettlement({ side: "SALE", paymentId: id, report: unknown, nowMs: NOW_MS });

  const stillUnknown = await book.reconcileSettlement({ side: "SALE", paymentId: id, report: unknown, nowMs: NOW_MS });
  assert.equal(stillUnknown.ok, false);
  assert.equal(stillUnknown.reasonCode, "SETTLEMENT_NOT_PENDING");

  const resolved = await book.reconcileSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS + 1_000 });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.record.paymentStatus, "SETTLED");
  assert.equal(resolved.record.reconciliation, "PENDING");

  const third = await book.reconcileSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS + 2_000 });
  assert.equal(third.reasonCode, "SETTLEMENT_NOT_PENDING");
});

test("a payment nobody claimed cannot be settled", async () => {
  const book = ledger();
  const outcome = await book.recordSettlement({ side: "SALE", paymentId: claimInput().paymentId, report: settled, nowMs: NOW_MS });
  assert.equal(outcome.reasonCode, "PAYMENT_UNKNOWN");
});

/* ── Delivering ──────────────────────────────────────────────────────────── */

test("nothing is served against a payment that has not settled", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const outcome = await book.recordDelivery({
    side: "SALE",
    paymentId: claimInput().paymentId,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW_MS,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasonCode, "DELIVERY_BEFORE_SETTLEMENT");
});

test("a delivery is recorded once, and «paid but unserved» puts a refund in the open", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  await book.recordSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS });

  const missed = await book.recordDelivery({
    side: "SALE",
    paymentId: id,
    delivered: false,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW_MS,
  });
  assert.equal(missed.ok, true);
  assert.equal(missed.record.serviceDeliveryStatus, "NOT_DELIVERED");
  // The pair names it; neither axis alone could.
  assert.equal(missed.record.pairing, "PAID_BUT_UNSERVED");
  assert.equal(missed.record.refund, "DUE");
  assert.equal(
    settlementPairing({ paymentStatus: "SETTLED", serviceDeliveryStatus: "NOT_DELIVERED" }).code,
    "PAID_BUT_UNSERVED",
  );

  const again = await book.recordDelivery({
    side: "SALE",
    paymentId: id,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW_MS,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reasonCode, "DELIVERY_ALREADY_RECORDED");
  assert.match(again.detail, /one payment is at most one execution/);
});

test("a settled and delivered sale is consistent, with no refund due", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  await book.recordSettlement({ side: "SALE", paymentId: id, report: settled, nowMs: NOW_MS });
  const delivered = await book.recordDelivery({
    side: "SALE",
    paymentId: id,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW_MS,
  });
  assert.equal(delivered.record.serviceDeliveryStatus, "DELIVERED");
  assert.equal(delivered.record.serviceDeliverySource, "RESOURCE_RESPONSE");
  assert.equal(delivered.record.pairing, null);
  assert.equal(delivered.record.refund, "NOT_DUE");
});

test("a failed payment serves nothing and owes nothing", async () => {
  const book = ledger();
  await book.claim(claimInput());
  const id = claimInput().paymentId;
  const failed = await book.recordSettlement({
    side: "SALE",
    paymentId: id,
    report: { status: "FAILED", transaction: null, source: "FACILITATOR_REPORT", detail: "rejected" },
    nowMs: NOW_MS,
  });
  assert.equal(failed.record.paymentStatus, "FAILED");
  assert.equal(failed.record.refund, "NOT_DUE");
  const blocked = await book.recordDelivery({
    side: "SALE",
    paymentId: id,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW_MS,
  });
  assert.equal(blocked.reasonCode, "DELIVERY_BEFORE_SETTLEMENT");
});

test("every refusal the ledger can produce is in its own list", () => {
  const unique = new Set(FULFILMENT_REFUSALS);
  assert.equal(unique.size, FULFILMENT_REFUSALS.length);
});
