import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CCTP_ATTESTATION_POLL_MS,
  CCTP_ATTESTATION_THROTTLED_POLL_MS,
  cctpMintAuthorized,
  cctpShouldPollAgain,
  fetchCctpAttestation,
  isSourceTransactionId,
} from "./cctp-attestation.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/cctp-v2-solana-to-base.json", import.meta.url), "utf8"),
);

/* Shaped like a Solana signature — base58, 64 characters — but not a real one.
   The lookup validates the shape before it builds a URL, so the shape is the
   part that has to be right here. */
const BURN_SIGNATURE = `4TX1LSCt597YZVzT${"z".repeat(48)}`;

function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url) => {
    calls.push(String(url));
    const next = queue.shift();
    if (!next) throw new Error("the stub was asked for more responses than it was given");
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const completeMessage = (overrides = {}) => ({
  message: FIXTURE.messageHex,
  eventNonce: "9007199254740993",
  attestation: `0x${"ab".repeat(130)}`,
  cctpVersion: 2,
  status: "complete",
  delayReason: null,
  ...overrides,
});

const pendingMessage = (overrides = {}) => ({
  message: "0x",
  eventNonce: "",
  attestation: "PENDING",
  cctpVersion: 2,
  status: "pending_confirmations",
  delayReason: null,
  ...overrides,
});

const lookup = (fetchImpl, extra = {}) =>
  fetchCctpAttestation(
    { direction: "SOLANA_TO_BASE", transactionHash: BURN_SIGNATURE, ...extra },
    { fetchImpl, now: () => new Date("2026-09-01T12:00:00.000Z") },
  );

test("the request names Circle's domain-5 messages endpoint and carries the signature unchanged", async () => {
  const fetchImpl = stubFetch([json({ messages: [pendingMessage()], sourceTxHash: BURN_SIGNATURE })]);
  await lookup(fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.origin, "https://iris-api.circle.com");
  assert.equal(url.pathname, "/v2/messages/5", "Solana is source domain 5");
  /* Base58 exactly as the cluster returned it: no 0x, no hex conversion. */
  assert.equal(url.searchParams.get("transactionHash"), BURN_SIGNATURE);
});

test("HTTP 404 is a pending state, never an absent burn", async () => {
  /* The single most consequential line in this module. Circle answers 404 while
     a burn is still being indexed. A client that read that as "no such burn"
     would conclude the money never left, and the next thing a person does after
     that conclusion is burn a second time. */
  const result = await lookup(stubFetch([json({ code: 404, message: "Not found." }, 404)]));
  assert.equal(result.state, "PENDING_INDEXING");
  assert.equal(result.httpStatus, 404);
  assert.equal(result.reason, null, "a normal polling state carries no failure reason");
  assert.equal(cctpMintAuthorized(result), false);
  assert.equal(cctpShouldPollAgain(result), true);
});

test("an empty messages array is the second pending state, not an answer", async () => {
  const result = await lookup(stubFetch([json({ messages: [], sourceTxHash: BURN_SIGNATURE })]));
  assert.equal(result.state, "PENDING_INDEXING");
  assert.equal(result.messagesReturned, 0);
  assert.equal(cctpShouldPollAgain(result), true);
});

test("both spellings of not-complete are pending, because Circle's own docs disagree", async () => {
  /* The OpenAPI specification enumerates `pending_confirmations`; three prose
     pages print `pending`. Nothing here compares against either — the only
     positive test is `complete`. */
  for (const status of ["pending_confirmations", "pending", "PENDING", "whatever_comes_next"]) {
    const result = await lookup(
      stubFetch([json({ messages: [pendingMessage({ status })], sourceTxHash: BURN_SIGNATURE })]),
    );
    assert.equal(result.state, "PENDING_CONFIRMATIONS", `status ${status}`);
    assert.equal(cctpMintAuthorized(result), false);
  }
});

test("a signed attestation over a decodable V2 message is the only path to ATTESTED", async () => {
  const result = await lookup(
    stubFetch([json({ messages: [completeMessage()], sourceTxHash: BURN_SIGNATURE })]),
  );
  assert.equal(result.state, "ATTESTED");
  assert.equal(cctpMintAuthorized(result), true);
  assert.equal(cctpShouldPollAgain(result), false);
  assert.ok(result.attested);
  assert.equal(result.attested.nonce, FIXTURE.expected.nonce);
  assert.equal(result.attested.decoded.header.sourceDomain, 5);
  assert.equal(result.attested.decoded.header.destinationDomain, 6);
  assert.equal(result.attested.decoded.burn?.amountRaw, FIXTURE.expected.amountRaw);
});

test("`complete` alone cannot authorize a mint when the bytes are still placeholders", async () => {
  /* Circle returns the literal `0x` for the message and the literal `PENDING`
     for the attestation while a burn waits. A client that trusted `status`
     and forwarded `message` would hand the destination two bytes. */
  for (const overrides of [
    { message: "0x" },
    { attestation: "PENDING" },
    { attestation: "0x" },
    { message: "not-hex" },
  ]) {
    const result = await lookup(
      stubFetch([json({ messages: [completeMessage(overrides)], sourceTxHash: BURN_SIGNATURE })]),
    );
    assert.equal(result.state, "PENDING_CONFIRMATIONS", JSON.stringify(overrides));
    assert.equal(result.attested, null);
  }
});

test("a V1 message served by the V2 endpoint is not this lane's message", async () => {
  const result = await lookup(
    stubFetch([json({ messages: [completeMessage({ cctpVersion: 1 })], sourceTxHash: BURN_SIGNATURE })]),
  );
  assert.equal(result.state, "PENDING_CONFIRMATIONS");
  assert.equal(cctpMintAuthorized(result), false);
});

test("an expectation binds the answer to this burn and refuses to bind to another", async () => {
  const expect = {
    destinationDomain: 6,
    mintRecipient: FIXTURE.expected.mintRecipient,
    amountRaw: FIXTURE.expected.amountRaw,
  };
  const bound = await lookup(
    stubFetch([json({ messages: [completeMessage()], sourceTxHash: BURN_SIGNATURE })]),
    { expect },
  );
  assert.equal(bound.state, "ATTESTED");

  /* Same signed message, an amount this product did not burn. Circle answered
     about the transaction; it did not answer about our burn. */
  const wrong = await lookup(
    stubFetch([json({ messages: [completeMessage()], sourceTxHash: BURN_SIGNATURE })]),
    { expect: { ...expect, amountRaw: "2000000" } },
  );
  assert.equal(wrong.state, "UNAVAILABLE");
  assert.equal(wrong.reason, "NO_MATCHING_MESSAGE");
  assert.equal(cctpMintAuthorized(wrong), false);
  assert.equal(
    cctpShouldPollAgain(wrong),
    false,
    "a mismatch is a stop-and-look, and polling it forever would hide that",
  );
});

test("a transaction carrying several messages waits while any of them is unsigned", async () => {
  const expect = {
    destinationDomain: 6,
    mintRecipient: FIXTURE.expected.mintRecipient,
    amountRaw: "2000000",
  };
  const result = await lookup(
    stubFetch([
      json({ messages: [completeMessage(), pendingMessage()], sourceTxHash: BURN_SIGNATURE }),
    ]),
    { expect },
  );
  assert.equal(result.state, "PENDING_CONFIRMATIONS", "ours may be the one still waiting");
  assert.equal(result.messagesReturned, 2);
});

test("a throttle carries Circle's own five-minute back-off in the answer", async () => {
  const result = await lookup(stubFetch([json({ code: 429, message: "Too many requests." }, 429)]));
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.reason, "RATE_LIMITED");
  assert.equal(result.pollAfterMs, CCTP_ATTESTATION_THROTTLED_POLL_MS);
  assert.equal(cctpShouldPollAgain(result), true, "a throttle is temporary, not terminal");
});

test("an ordinary pending answer carries Circle's five-second floor", async () => {
  const result = await lookup(stubFetch([json({ messages: [pendingMessage()], sourceTxHash: BURN_SIGNATURE })]));
  assert.equal(result.pollAfterMs, CCTP_ATTESTATION_POLL_MS);
});

test("the Cloudflare edge block is environment unreachability, not a Circle refusal", async () => {
  const html = new Response("<!DOCTYPE html><html><body>error code: 1009</body></html>", {
    status: 403,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
  const result = await lookup(stubFetch([html]));
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.reason, "UNREACHABLE_FROM_ENVIRONMENT");
  assert.equal(cctpShouldPollAgain(result), true);
});

test("a transport failure is unavailable, and unavailable is never an absence", async () => {
  const result = await lookup(stubFetch([new Error("socket hang up")]));
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.reason, "UNREACHABLE_FROM_ENVIRONMENT");
  assert.equal(cctpMintAuthorized(result), false);
  assert.notEqual(result.state, "PENDING_INDEXING", "an unread answer is not a pending burn either");
});

test("Circle's stated cause of a Fast delay is carried through rather than flattened", async () => {
  const result = await lookup(
    stubFetch([
      json({
        messages: [pendingMessage({ delayReason: "insufficient_fee" })],
        sourceTxHash: BURN_SIGNATURE,
      }),
    ]),
  );
  assert.equal(result.state, "PENDING_CONFIRMATIONS");
  assert.equal(result.delayReason, "insufficient_fee");
});

test("a malformed transaction id never reaches the network", async () => {
  const fetchImpl = stubFetch([]);
  const result = await fetchCctpAttestation(
    { direction: "SOLANA_TO_BASE", transactionHash: "0xdeadbeef" },
    { fetchImpl },
  );
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.reason, "MALFORMED_RESPONSE");
});

test("the transaction id shape is decided by the source chain, not by habit", () => {
  assert.equal(isSourceTransactionId(5, BURN_SIGNATURE), true);
  assert.equal(isSourceTransactionId(5, `0x${"ab".repeat(32)}`), false, "Solana signatures are base58");
  assert.equal(isSourceTransactionId(6, `0x${"ab".repeat(32)}`), true);
  assert.equal(isSourceTransactionId(6, BURN_SIGNATURE), false);
});

test("an answer that is not an object with messages is unreadable, not empty", async () => {
  for (const body of [{ messages: "none" }, [], { sourceTxHash: BURN_SIGNATURE }]) {
    const result = await lookup(stubFetch([json(body)]));
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.reason, "MALFORMED_RESPONSE");
    assert.equal(cctpShouldPollAgain(result), false, "a malformed shape will not become well-formed by waiting");
  }
});
