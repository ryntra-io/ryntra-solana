// Run from repo root: node --test lib/agent-control/procurement/protocol.test.mjs
//
// The wire, and the order its checks fire in.
//
// Two kinds of test live here. The first pins published facts — header names,
// scheme names, chain ids, package versions — because every one of them is a
// value somebody can "tidy" into a nicer spelling that no client speaks. The
// second proves the refusal order, which is the actual security property: a
// payload for the wrong chain must be refused *as* a wrong chain, or somebody
// will adjust the amount and come back.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COINBASE_CDP_FACILITATOR,
  FACILITATOR_DECLARATIONS,
  PAYAI_FACILITATOR,
  RYNTRA_RUNS_A_FACILITATOR,
  X402_CLIENT_PACKAGES,
  X402_HEADERS,
  X402_SCHEMES,
  X402_SOLANA_NETWORKS,
  X402_V1_AUTHORIZATION_HEADER,
  X402_VERSION,
  X402_WIRE_REFUSALS,
  X402WireError,
  buildPaymentRequirements,
  decodePaymentAuthorization,
  encodePaymentRequirements,
  facilitatorDeclaration,
  isSolanaNetwork,
  paymentIdentifier,
  splAssetRef,
  verifyPaymentAuthorization,
} from "./protocol.ts";
import { DEVNET, FIXTURE, MAINNET, USDC_DEVNET, authorizationHeader, headersWith } from "./fixtures.ts";

const NOW = new Date("2026-10-26T12:00:00.000Z");

function quote(overrides = {}) {
  return buildPaymentRequirements({
    scheme: "exact",
    network: DEVNET,
    asset: USDC_DEVNET,
    assetSymbol: "USDC",
    decimals: 6,
    maxAmountRequired: "50000",
    payTo: FIXTURE.payTo,
    resource: "https://ryntra.io/api/agents/services/token-report",
    resourceDescriptor: { serviceId: "token-deep-report", query: [["mint", USDC_DEVNET]] },
    description: "Deep token report",
    mimeType: "application/json",
    maxTimeoutSeconds: 30,
    facilitator: "COINBASE_CDP",
    nonce: "fixture-nonce-0000000001",
    refundReference: "https://ryntra.io/agents/workspace/procurement",
    now: NOW,
    validForSeconds: 60,
    ...overrides,
  });
}

/* ── The published facts ──────────────────────────────────────────────────── */

test("the three V2 header names are the spelling clients speak", () => {
  assert.equal(X402_HEADERS.requirements, "PAYMENT-REQUIRED");
  assert.equal(X402_HEADERS.authorization, "PAYMENT-SIGNATURE");
  assert.equal(X402_HEADERS.response, "PAYMENT-RESPONSE");
  assert.equal(X402_VERSION, 2);
  // And V1's payload header is present only so it can be refused by name.
  assert.equal(X402_V1_AUTHORIZATION_HEADER, "X-PAYMENT");
});

test("both schemes are named and the Solana chain ids are the genesis ones", () => {
  assert.deepEqual([...X402_SCHEMES], ["exact", "upto"]);
  assert.equal(X402_SOLANA_NETWORKS.mainnet, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  assert.equal(X402_SOLANA_NETWORKS.devnet, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.ok(isSolanaNetwork(MAINNET) && isSolanaNetwork(DEVNET));
  assert.equal(isSolanaNetwork("eip155:8453"), false);
});

test("CAIP-19 for a mint is derived rather than typed", () => {
  assert.equal(splAssetRef(DEVNET, USDC_DEVNET), `${DEVNET}/token:${USDC_DEVNET}`);
});

test("the three client packages are recorded with the versions they were read at", () => {
  const names = X402_CLIENT_PACKAGES.map((entry) => entry.name);
  assert.deepEqual(names, ["@x402/core", "@x402/svm", "@x402/fetch"]);
  for (const entry of X402_CLIENT_PACKAGES) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/, `${entry.name} carries no exact version`);
  }
  // `@x402/express` is for another framework and is deliberately absent.
  assert.equal(names.includes("@x402/express"), false);
});

test("two facilitators are declared, neither with a Ryntra credential, and Ryntra runs none", () => {
  assert.equal(FACILITATOR_DECLARATIONS.length, 2);
  for (const declaration of FACILITATOR_DECLARATIONS) {
    assert.equal(declaration.ryntraCredential, "NONE");
    assert.ok(declaration.limitations.length > 0, `${declaration.id} states no limitation`);
    assert.match(declaration.source.observedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  // CDP takes both schemes on both chains; PayAI publishes less, and the
  // difference is recorded rather than levelled up.
  assert.deepEqual([...COINBASE_CDP_FACILITATOR.schemes], ["exact", "upto"]);
  assert.deepEqual([...PAYAI_FACILITATOR.schemes], ["exact"]);
  assert.equal(PAYAI_FACILITATOR.networks.includes(DEVNET), false);
  assert.equal(RYNTRA_RUNS_A_FACILITATOR, false);
  assert.equal(facilitatorDeclaration("SELF_HOSTED"), null);
});

/* ── Building a quote ─────────────────────────────────────────────────────── */

test("a quote carries the six facts a buyer needs and a digest over the deliverable", () => {
  const requirements = quote();
  assert.equal(requirements.x402Version, 2);
  assert.equal(requirements.scheme, "exact");
  assert.equal(requirements.network, DEVNET);
  assert.equal(requirements.asset, USDC_DEVNET);
  assert.equal(requirements.assetRef, splAssetRef(DEVNET, USDC_DEVNET));
  assert.equal(requirements.payTo, FIXTURE.payTo);
  assert.equal(requirements.maxAmountRequired, "50000");
  assert.match(requirements.resourceDigest, /^0x[0-9a-f]{64}$/);
  assert.match(requirements.requirementsDigest, /^0x[0-9a-f]{64}$/);
  assert.equal(requirements.expiresAt, "2026-10-26T12:01:00.000Z");
  assert.ok(requirements.limitations.some((line) => /not a charge/i.test(line)));
  // The header value is base64 of the quote, and it round-trips.
  const decoded = JSON.parse(Buffer.from(encodePaymentRequirements(requirements), "base64").toString("utf8"));
  assert.equal(decoded.nonce, requirements.nonce);
});

test("a quote for a different question has a different resource digest", () => {
  const one = quote();
  const other = quote({ resourceDescriptor: { serviceId: "token-deep-report", query: [["mint", "other"]] } });
  assert.notEqual(one.resourceDigest, other.resourceDigest);
});

test("every way a quote can be misconfigured refuses by name", () => {
  const cases = [
    ["REQUIREMENTS_SCHEME_UNKNOWN", { scheme: "upfront" }],
    ["REQUIREMENTS_NETWORK_NOT_SOLANA", { network: "eip155:8453" }],
    ["REQUIREMENTS_ASSET_MALFORMED", { asset: "USDC" }],
    ["REQUIREMENTS_RECIPIENT_MALFORMED", { payTo: "ryntra" }],
    ["REQUIREMENTS_AMOUNT_MALFORMED", { maxAmountRequired: "0.05" }],
    ["REQUIREMENTS_AMOUNT_ZERO", { maxAmountRequired: "0" }],
    ["REQUIREMENTS_RESOURCE_NOT_HTTPS", { resource: "http://ryntra.io/api" }],
    ["REQUIREMENTS_FACILITATOR_UNKNOWN", { facilitator: "SELF_HOSTED" }],
    ["REQUIREMENTS_TIMEOUT_OUT_OF_RANGE", { maxTimeoutSeconds: 600 }],
    ["REQUIREMENTS_NONCE_MALFORMED", { nonce: "short" }],
  ];
  for (const [reasonCode, overrides] of cases) {
    assert.throws(
      () => quote(overrides),
      (error) => error instanceof X402WireError && error.reasonCode === reasonCode,
      `${JSON.stringify(overrides)} did not refuse with ${reasonCode}`,
    );
  }
});

test("a facilitator that does not publish the scheme or the chain refuses before a buyer sees a quote", () => {
  assert.throws(
    () => quote({ facilitator: "PAYAI", scheme: "upto" }),
    (error) => error.reasonCode === "REQUIREMENTS_SCHEME_NOT_SUPPORTED_BY_FACILITATOR",
  );
  // PayAI publishes no devnet, so the devnet quote refuses on the network.
  assert.throws(
    () => quote({ facilitator: "PAYAI" }),
    (error) => error.reasonCode === "REQUIREMENTS_FACILITATOR_NETWORK_UNDECLARED",
  );
});

/* ── Reading an authorization ─────────────────────────────────────────────── */

test("a V1 header is refused as V1, before anything else is read", () => {
  // GATE-PROVED: the payload below is perfectly good V2. The only reason this
  // refuses is the V1 header beside it, which is what tells a client one major
  // version behind why nothing it sends is ever read.
  const requirements = quote();
  const headers = headersWith(authorizationHeader(requirements), {
    "X-PAYMENT": "anything at all",
  });
  const decoded = decodePaymentAuthorization(headers);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reasonCode, "AUTHORIZATION_HEADER_IS_V1");
});

test("a missing, unreadable or incomplete payload each refuse differently", () => {
  assert.equal(decodePaymentAuthorization(headersWith(null)).reasonCode, "AUTHORIZATION_HEADER_MISSING");
  assert.equal(
    decodePaymentAuthorization(headersWith("not base64 of json")).reasonCode,
    "AUTHORIZATION_NOT_BASE64_JSON",
  );
  const noPayload = Buffer.from(JSON.stringify({ x402Version: 2, scheme: "exact", network: DEVNET }), "utf8").toString("base64");
  assert.equal(decodePaymentAuthorization(headersWith(noPayload)).reasonCode, "AUTHORIZATION_SHAPE_UNREADABLE");
  const requirements = quote();
  const noSignature = authorizationHeader(requirements, { signature: "" });
  assert.equal(decodePaymentAuthorization(headersWith(noSignature)).reasonCode, "AUTHORIZATION_SHAPE_UNREADABLE");
  const badPayer = authorizationHeader(requirements, { payer: "me" });
  assert.equal(decodePaymentAuthorization(headersWith(badPayer)).reasonCode, "AUTHORIZATION_PAYER_MALFORMED");
});

test("a well-formed authorization verifies and yields one stable payment identifier", () => {
  const requirements = quote();
  const decoded = decodePaymentAuthorization(headersWith(authorizationHeader(requirements)));
  assert.equal(decoded.ok, true);
  const verdict = verifyPaymentAuthorization({ requirements, authorization: decoded.value, now: NOW });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.amount, "50000");
  assert.equal(verdict.payer, FIXTURE.buyer);
  assert.match(verdict.paymentId, /^0x[0-9a-f]{64}$/);
  // The same authorization, read again, is the same payment. That is what makes
  // a retry a retry rather than a second sale.
  assert.equal(
    verdict.paymentId,
    paymentIdentifier({ requirements, authorization: decoded.value }),
  );
});

test("the refusal order is version, scheme, chain, mint, recipient, amount, resource, freshness", () => {
  const requirements = quote();
  const read = (header) => {
    const decoded = decodePaymentAuthorization(headersWith(header));
    assert.equal(decoded.ok, true, "the fixture payload stopped being readable");
    return verifyPaymentAuthorization({ requirements, authorization: decoded.value, now: NOW });
  };

  // Each case breaks one fact *and everything after it*, so the reason proves
  // the order rather than merely that the field is checked.
  const after = {
    asset: FIXTURE.otherMint,
    payTo: FIXTURE.otherPayTo,
    amount: "1",
    resource: "https://ryntra.io/api/agents/services/other",
    resourceDigest: "0x" + "ab".repeat(32),
    nonce: "a-different-nonce-000001",
    validUntil: "2020-01-01T00:00:00.000Z",
  };
  assert.equal(read(authorizationHeader(requirements, after, { x402Version: 1 })).reasonCode, "AUTHORIZATION_VERSION_NOT_V2");
  assert.equal(read(authorizationHeader(requirements, after, { scheme: "upto" })).reasonCode, "AUTHORIZATION_SCHEME_MISMATCH");
  assert.equal(read(authorizationHeader(requirements, after, { network: MAINNET })).reasonCode, "AUTHORIZATION_NETWORK_MISMATCH");
  assert.equal(read(authorizationHeader(requirements, after)).reasonCode, "AUTHORIZATION_ASSET_MISMATCH");

  const { asset: _asset, ...afterAsset } = after;
  assert.equal(read(authorizationHeader(requirements, afterAsset)).reasonCode, "AUTHORIZATION_RECIPIENT_MISMATCH");
  const { payTo: _payTo, ...afterPayTo } = afterAsset;
  assert.equal(read(authorizationHeader(requirements, afterPayTo)).reasonCode, "AUTHORIZATION_AMOUNT_MISMATCH");
  const { amount: _amount, ...afterAmount } = afterPayTo;
  assert.equal(read(authorizationHeader(requirements, afterAmount)).reasonCode, "AUTHORIZATION_RESOURCE_MISMATCH");
  const { resource: _resource, ...afterResource } = afterAmount;
  assert.equal(read(authorizationHeader(requirements, afterResource)).reasonCode, "AUTHORIZATION_RESOURCE_DIGEST_MISMATCH");
  const { resourceDigest: _digest, ...afterDigest } = afterResource;
  assert.equal(read(authorizationHeader(requirements, afterDigest)).reasonCode, "AUTHORIZATION_NONCE_MISMATCH");
  const { nonce: _nonce, ...afterNonce } = afterDigest;
  assert.equal(read(authorizationHeader(requirements, afterNonce)).reasonCode, "AUTHORIZATION_EXPIRED");
});

test("`exact` means equal, not «no more than»", () => {
  // GATE-PROVED: under a ceiling reading, paying less than the quote would be
  // accepted — which is `upto` wearing the name `exact`.
  const requirements = quote();
  const decoded = decodePaymentAuthorization(headersWith(authorizationHeader(requirements, { amount: "49999" })));
  const verdict = verifyPaymentAuthorization({ requirements, authorization: decoded.value, now: NOW });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasonCode, "AUTHORIZATION_AMOUNT_MISMATCH");
});

test("`upto` accepts less and refuses more than the declared cap", () => {
  const requirements = quote({ scheme: "upto", maxAmountRequired: "100000" });
  const under = decodePaymentAuthorization(headersWith(authorizationHeader(requirements, { amount: "60000" })));
  assert.equal(
    verifyPaymentAuthorization({ requirements, authorization: under.value, now: NOW }).ok,
    true,
  );
  const over = decodePaymentAuthorization(headersWith(authorizationHeader(requirements, { amount: "100001" })));
  assert.equal(
    verifyPaymentAuthorization({ requirements, authorization: over.value, now: NOW }).reasonCode,
    "AUTHORIZATION_AMOUNT_ABOVE_CAP",
  );
});

test("a quote that has run out refuses even when the authorization says it has not", () => {
  const requirements = quote();
  const header = authorizationHeader(requirements, { validUntil: "2030-01-01T00:00:00.000Z" });
  const decoded = decodePaymentAuthorization(headersWith(header));
  const later = new Date(Date.parse(requirements.expiresAt) + 1);
  assert.equal(
    verifyPaymentAuthorization({ requirements, authorization: decoded.value, now: later }).reasonCode,
    "AUTHORIZATION_EXPIRED",
  );
});

test("every refusal this module can produce is in its own list", () => {
  // A reason code that is thrown but not listed cannot be handled by a caller
  // that switches on the list, which is how an unnamed failure becomes a 500.
  const unique = new Set(X402_WIRE_REFUSALS);
  assert.equal(unique.size, X402_WIRE_REFUSALS.length);
  for (const code of X402_WIRE_REFUSALS) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `${code} is not a reason code`);
  }
});
