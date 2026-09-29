/*
 * «Check your mail» has to be true. These are the refusals that used to be
 * flattened into it, and the ones that must stay flattened.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { deliveryOutcome } from "./mail-delivery.ts";

test("a request the verifier accepted reads as accepted", () => {
  assert.equal(deliveryOutcome(null), "accepted");
  assert.equal(deliveryOutcome(undefined), "accepted");
});

test("SMTP down is not a delivered mail", () => {
  /* The person waits for a link that was never sent, asks for another, waits
     again. Saying «unavailable» costs a moment; saying «check your mail» costs
     them the account. */
  assert.equal(deliveryOutcome({ status: 500, code: "unexpected_failure", message: "Error sending confirmation email" }), "unavailable");
  assert.equal(deliveryOutcome({ status: 500, message: "smtp: connection refused" }), "unavailable");
  assert.equal(deliveryOutcome({ status: 502, message: "bad gateway" }), "unavailable");
});

test("a spent send quota is reported as a rate limit, not as delivery", () => {
  assert.equal(deliveryOutcome({ status: 429, message: "email rate limit exceeded" }), "rate_limited");
  assert.equal(deliveryOutcome({ code: "over_email_send_rate_limit", message: "" }), "rate_limited");
  assert.equal(deliveryOutcome({ status: 400, message: "For security purposes, you can only request this after 51 seconds" }), "rate_limited");
});

test("enumeration safety is kept: a refusal about the address stays neutral", () => {
  /* Whether an address exists must not leak, so anything that is about the
     person rather than the service keeps the neutral answer. */
  assert.equal(deliveryOutcome({ status: 400, message: "User not found" }), "accepted");
  assert.equal(deliveryOutcome({ status: 422, message: "User already registered" }), "accepted");
  assert.equal(deliveryOutcome({ status: 400, code: "validation_failed", message: "Unable to validate email address" }), "accepted");
});
