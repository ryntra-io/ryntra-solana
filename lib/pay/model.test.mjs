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
  PUBLIC_ID_LENGTH,
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
    assert.equal(id.length, 17, `${id} is ${id.length} characters`);
  }
  /* A deterministic byte source proves the id is nothing but the bytes. */
  const fixed = newPublicId((bytes) => bytes.fill(7));
  assert.equal(fixed, newPublicId((bytes) => bytes.fill(7)));
  assert.notEqual(fixed, newPublicId((bytes) => bytes.fill(8)));
  assert.ok(!isPublicId("1"), "a one-character id is not opaque");
  assert.ok(!isPublicId("0OIl00000000000000"), "base58 excludes 0, O, I and l");
});

test("public ids are always 17 characters, whatever the bytes (FIX-PAY-1: base58 of a small value spells shorter)", () => {
  assert.equal(PUBLIC_ID_LENGTH, 17);
  /* The bytes that spelled short before: zeros in front, a small value, all zero, and the largest. */
  const patterns = [
    new Uint8Array(12),
    Uint8Array.from([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    Uint8Array.from([0, ...new Array(11).fill(255)]),
    Uint8Array.from([1, ...new Array(11).fill(0)]),
    Uint8Array.from([3, ...new Array(11).fill(255)]),
    new Uint8Array(12).fill(7),
    new Uint8Array(12).fill(255),
  ];
  const seen = new Set();
  for (const pattern of patterns) {
    const id = newPublicId((bytes) => {
      bytes.set(pattern);
      return bytes;
    });
    assert.equal(id.length, 17, `${Buffer.from(pattern).toString("hex")} spelled ${id}`);
    assert.ok(isPublicId(id), id);
    seen.add(id);
  }
  assert.equal(seen.size, patterns.length, "padding never makes two byte strings one id");
  assert.equal(newPublicId((bytes) => bytes.fill(0)), "11111111111111111");
  /* Many random draws: 50 000 of them, where the old spelling came out at 15 characters about three times. */
  for (let i = 0; i < 50_000; i += 1) {
    const id = newPublicId();
    if (id.length !== 17) assert.fail(`draw ${i}: ${id} is ${id.length} characters`);
  }
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

test("FIX-PAY-1: the settlement records what arrived in the requested mint, summed, and the fee withheld", () => {
  const request = fixedRequest();
  const base = emptySettlement(request.id, NOW.toISOString());
  const sigA = "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5nB7oC9";
  const sigB = "4VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5nB7oC9";

  /* Attack: two transactions that carried the reference and credited nothing are not OVERPAID, not Paid. */
  const empty = settlementFromMatch({
    previous: base,
    request,
    observed: [
      { signature: sigA, creditedRaw: "0", mint: USDC, payer: null, blockTime: null },
      { signature: sigB, creditedRaw: "0", mint: USDC, payer: null, blockTime: null },
    ],
    now: NOW,
  });
  assert.equal(empty.state, "NONE");
  assert.equal(empty.creditedRaw, null);
  assert.equal(derivePaymentStatus({ request, settlement: empty, now: NOW }).status, "AWAITING");
  assert.equal(projectPublicPaymentRequest({ request, settlement: empty, now: NOW }).received, null);

  /* Short by the token's own fee: underpaid, with what came and what the fee kept. */
  const byFee = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sigA, creditedRaw: "12375000", mint: USDC, feeWithheldRaw: "125000", payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(byFee.state, "UNDERPAID");
  assert.equal(byFee.creditedRaw, "12375000");
  assert.equal(byFee.feeWithheldRaw, "125000");
  const byFeeView = projectPublicPaymentRequest({ request, settlement: byFee, now: NOW });
  assert.equal(byFeeView.status, "AWAITING");
  assert.equal(byFeeView.note, "UNDERPAID");
  assert.deepEqual(byFeeView.received, { raw: "12375000", feeWithheldRaw: "125000" });

  /* The top-up after it: paid, by the payment that reached the amount, with the sum. */
  const topped = settlementFromMatch({
    previous: byFee,
    request,
    observed: [
      { signature: sigA, creditedRaw: "12375000", mint: USDC, feeWithheldRaw: "125000", payer: null, blockTime: "2026-09-07T12:05:00.000Z" },
      { signature: sigB, creditedRaw: "125000", mint: USDC, payer: RECIPIENT, blockTime: "2026-09-07T12:09:00.000Z" },
    ],
    now: NOW,
  });
  assert.equal(topped.state, "PAID");
  assert.equal(topped.signature, sigB);
  assert.equal(topped.creditedRaw, "12500000");
  assert.equal(topped.paidAt, "2026-09-07T12:09:00.000Z");
  const toppedView = projectPublicPaymentRequest({ request, settlement: topped, now: NOW });
  assert.deepEqual(toppedView.paid, { signature: sigB, creditedRaw: "12500000", paidAt: "2026-09-07T12:09:00.000Z" });

  /* Overpaid is Paid with its explanation and the amount that came, never a bare «Paid». */
  const over = settlementFromMatch({
    previous: base,
    request,
    observed: [
      { signature: sigA, creditedRaw: "12500000", mint: USDC, payer: null, blockTime: null },
      { signature: sigB, creditedRaw: "12500000", mint: USDC, payer: null, blockTime: null },
    ],
    now: NOW,
  });
  assert.equal(over.state, "OVERPAID");
  assert.equal(over.signature, sigA);
  const overView = projectPublicPaymentRequest({ request, settlement: over, now: NOW });
  assert.equal(overView.status, "PAID");
  assert.equal(overView.note, "OVERPAID");
  assert.deepEqual(overView.received, { raw: "25000000", feeWithheldRaw: null });

  /* Another token is not a credit of this request. */
  const wrong = settlementFromMatch({
    previous: base,
    request,
    observed: [{ signature: sigA, creditedRaw: "1", mint: "So11111111111111111111111111111111111111112", payer: null, blockTime: null }],
    now: NOW,
  });
  assert.equal(wrong.state, "WRONG_TOKEN");
  assert.equal(wrong.creditedRaw, null);
  assert.equal(projectPublicPaymentRequest({ request, settlement: wrong, now: NOW }).received, null);
});
