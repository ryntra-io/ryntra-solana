import assert from "node:assert/strict";
import test from "node:test";

import {
  abbreviateAddress,
  assemblePaymentRequest,
  derivePaymentStatus,
  emptySettlement,
  expirationAt,
  FORBIDDEN_PUBLIC_KEYS,
  isPublicId,
  newPublicId,
  newReferenceKey,
  PAYMENT_EXPIRATIONS,
  projectPublicPaymentRequest,
  settlementAfterFailedRead,
  settlementFromMatch,
  UNKNOWN_AFTER_FAILURES,
} from "./model.ts";

const RECIPIENT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = new Date("2026-09-07T12:00:00.000Z");

function fixedRequest(overrides = {}) {
  const assembled = assemblePaymentRequest({
    id: "3fJ9s2kQ8vB1xR7pL",
    reference: "7Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5j",
    recipient: RECIPIENT,
    input: { mint: USDC, amount: "12.5", description: "  Lunch   Tuesday ", expiration: "24h" },
    decimals: 6,
    symbol: "USDC",
    now: NOW,
  });
  assert.ok(assembled.ok, JSON.stringify(assembled));
  return { ...assembled.request, ...overrides };
}

test("public ids are opaque: random, base58, fixed length, never sequential", () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(newPublicId());
  assert.equal(ids.size, 200, "two hundred draws collided");
  for (const id of ids) {
    assert.ok(isPublicId(id), id);
    assert.ok(id.length >= 16 && id.length <= 17, `${id} is ${id.length} characters`);
  }
  /* A deterministic byte source proves the id is nothing but the bytes. */
  const fixed = newPublicId((bytes) => bytes.fill(7));
  assert.equal(fixed, newPublicId((bytes) => bytes.fill(7)));
  assert.notEqual(fixed, newPublicId((bytes) => bytes.fill(8)));
  assert.ok(!isPublicId("1"), "a one-character id is not opaque");
  assert.ok(!isPublicId("0OIl00000000000000"), "base58 excludes 0, O, I and l");
});

test("a reference key is a fresh 32-byte public key every time", async () => {
  const one = await newReferenceKey();
  const two = await newReferenceKey();
  assert.notEqual(one, two);
  assert.match(one, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("assembly keeps the typed amount, scales it exactly, and trims the description", () => {
  const request = fixedRequest();
  assert.equal(request.amountRaw, "12500000");
  assert.equal(request.amountDisplay, "12.5");
  assert.equal(request.description, "Lunch Tuesday");
  assert.equal(request.expiresAt, "2026-09-08T12:00:00.000Z");
  assert.equal(request.createdAt, NOW.toISOString());

  const open = assemblePaymentRequest({
    id: "3fJ9s2kQ8vB1xR7pL",
    reference: request.reference,
    recipient: RECIPIENT,
    input: { mint: null, amount: null, description: null, expiration: "7d" },
    decimals: 9,
    symbol: "SOL",
    now: NOW,
  });
  assert.ok(open.ok);
  assert.equal(open.request.amountRaw, null);
  assert.equal(open.request.amountDisplay, null);
  assert.equal(open.request.description, null);

  const tooPrecise = assemblePaymentRequest({
    id: "3fJ9s2kQ8vB1xR7pL",
    reference: request.reference,
    recipient: RECIPIENT,
    input: { mint: USDC, amount: "1.1234567", description: null, expiration: "1h" },
    decimals: 6,
    symbol: "USDC",
    now: NOW,
  });
  assert.equal(tooPrecise.ok, false);
  const zero = assemblePaymentRequest({
    id: "3fJ9s2kQ8vB1xR7pL",
    reference: request.reference,
    recipient: RECIPIENT,
    input: { mint: USDC, amount: "0", description: null, expiration: "1h" },
    decimals: 6,
    symbol: "USDC",
    now: NOW,
  });
  assert.equal(zero.ok, false);
});

test("expiration is one of four presets, computed from the server clock", () => {
  assert.deepEqual([...PAYMENT_EXPIRATIONS], ["1h", "24h", "7d", "30d"]);
  assert.equal(expirationAt("1h", NOW), "2026-09-07T13:00:00.000Z");
  assert.equal(expirationAt("30d", NOW), "2026-10-07T12:00:00.000Z");
});

test("status: awaiting until the reference is seen, expired by the server clock, never paid by amount alone", () => {
  const request = fixedRequest();
  const none = derivePaymentStatus({ request, settlement: null, now: NOW });
  assert.equal(none.status, "AWAITING");

  const later = new Date("2026-09-08T12:00:01.000Z");
  assert.equal(derivePaymentStatus({ request, settlement: null, now: later }).status, "EXPIRED");

  /* A read that saw nothing carrying the reference stays awaiting, whatever
     the recipient's balance did meanwhile. */
  const seenNothing = settlementFromMatch({ previous: emptySettlement(request.id, NOW.toISOString()), request, observed: [], now: NOW });
  assert.equal(seenNothing.state, "NONE");
  assert.equal(derivePaymentStatus({ request, settlement: seenNothing, now: NOW }).status, "AWAITING");
});

test("status: paid only on a reference-carrying payment in the right mint and amount", () => {
  const request = fixedRequest();
  const base = emptySettlement(request.id, NOW.toISOString());
  const sig = "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1lZ3mA5nB7oC9pD";

  const paid = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sig, creditedRaw: "12500000", mint: USDC, payer: RECIPIENT, blockTime: "2026-09-07T12:05:00.000Z" }],
    now: NOW,
  });
  assert.equal(paid.state, "PAID");
  assert.equal(paid.signature, sig);
  assert.equal(paid.paidAt, "2026-09-07T12:05:00.000Z");
  assert.equal(derivePaymentStatus({ request, settlement: paid, now: NOW }).status, "PAID");
  /* Paid stays paid after expiry: expiry stops inviting, it does not un-receive. */
  assert.equal(derivePaymentStatus({ request, settlement: paid, now: new Date("2026-10-01T00:00:00.000Z") }).status, "PAID");

  const under = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sig, creditedRaw: "1000000", mint: USDC, payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(under.state, "UNDERPAID");
  const underView = derivePaymentStatus({ request, settlement: under, now: NOW });
  assert.equal(underView.status, "AWAITING");
  assert.equal(underView.note, "UNDERPAID");

  const wrong = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sig, creditedRaw: "12500000", mint: "So11111111111111111111111111111111111111112", payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(wrong.state, "WRONG_TOKEN");
  assert.equal(derivePaymentStatus({ request, settlement: wrong, now: NOW }).note, "WRONG_TOKEN");

  const over = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sig, creditedRaw: "20000000", mint: USDC, payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(over.state, "OVERPAID");
  const overView = derivePaymentStatus({ request, settlement: over, now: NOW });
  assert.equal(overView.status, "PAID");
  assert.equal(overView.note, "OVERPAID");
});

test("status: an open request is paid by any positive amount in its mint", () => {
  const request = fixedRequest({ amountRaw: null, amountDisplay: null });
  const sig = "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1lZ3mA5nB7oC9pD";
  const paid = settlementFromMatch({
    previous: emptySettlement(request.id, NOW.toISOString()),
    request,
    observed: [{ signature: sig, creditedRaw: "1", mint: USDC, payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(paid.state, "PAID");
});

test("status: failed reads say checking, then unknown, and never regress a paid request", () => {
  const request = fixedRequest();
  let settlement = emptySettlement(request.id, NOW.toISOString());
  settlement = settlementAfterFailedRead(settlement, NOW, "timeout");
  assert.equal(derivePaymentStatus({ request, settlement, now: NOW }).status, "CHECKING");
  for (let i = 1; i < UNKNOWN_AFTER_FAILURES; i += 1) settlement = settlementAfterFailedRead(settlement, NOW, "timeout");
  assert.equal(settlement.failures, UNKNOWN_AFTER_FAILURES);
  assert.equal(derivePaymentStatus({ request, settlement, now: NOW }).status, "UNKNOWN");

  const sig = "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1lZ3mA5nB7oC9pD";
  const paid = settlementFromMatch({
    previous: settlement,
    request,
    observed: [{ signature: sig, creditedRaw: "12500000", mint: USDC, payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(paid.failures, 0);
  const failedAfterPaid = settlementAfterFailedRead(paid, NOW, "timeout");
  assert.equal(failedAfterPaid.state, "PAID", "a failed read must keep the paid verdict");
  assert.equal(derivePaymentStatus({ request, settlement: failedAfterPaid, now: NOW }).status, "PAID");
});

test("a pending submit stays pending until the reference is seen", () => {
  const request = fixedRequest();
  const pending = { ...emptySettlement(request.id, NOW.toISOString()), state: "PENDING", signature: "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1lZ3mA5nB7oC9pD" };
  const still = settlementFromMatch({ previous: pending, request, observed: [], now: NOW });
  assert.equal(still.state, "PENDING");
  assert.equal(still.signature, pending.signature);
});

test("the public projection carries no creator, session, store or observation internals", () => {
  const request = fixedRequest();
  const settlement = { ...emptySettlement(request.id, NOW.toISOString()), lastError: "secret-ish", failures: 1 };
  const projected = projectPublicPaymentRequest({ request, settlement, now: NOW });
  const keys = new Set(Object.keys(projected));
  for (const forbidden of FORBIDDEN_PUBLIC_KEYS) assert.ok(!keys.has(forbidden), `public payload carries ${forbidden}`);
  assert.equal(projected.recipient.abbreviated, abbreviateAddress(RECIPIENT));
  assert.equal(projected.recipient.abbreviated.length, 9);
  assert.equal(projected.status, "CHECKING");
  assert.equal(projected.paid, null);
  assert.equal(JSON.stringify(projected).includes("secret-ish"), false);
});
