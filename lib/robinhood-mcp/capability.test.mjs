import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { capabilityTone } from "../domain/capability.ts";
import {
  OAUTH_LIFECYCLE,
  ROBINHOOD_MCP_CAPABILITIES,
  ROBINHOOD_MCP_PRODUCTS,
  capabilityById,
  jurisdictionRecord,
} from "./capability.ts";

test("Ryntra ships nothing against this surface, and every record says so", function () {
  assert.ok(ROBINHOOD_MCP_CAPABILITIES.length >= 8);
  for (const capability of ROBINHOOD_MCP_CAPABILITIES) {
    assert.ok(
      capability.state.ryntra === "planned" || capability.state.ryntra === "blocked",
      capability.id + " claims Ryntra maturity " + capability.state.ryntra,
    );
    assert.notEqual(capabilityTone(capability.state), "ok", capability.id + " must never read as green");
    assert.ok(capability.evidence.length >= 1, capability.id + " must carry evidence");
    assert.ok(capability.state.reason, capability.id + " must say why it is gated");
  }
});

test("every capability is observed externally, because no Ryntra adapter exists on this path", function () {
  for (const capability of ROBINHOOD_MCP_CAPABILITIES) {
    assert.equal(
      capability.enforcementMode,
      "OBSERVED_EXTERNALLY",
      capability.id + " may not claim enforcement",
    );
  }
});

test("no tool was called, and no record pretends otherwise", function () {
  for (const capability of ROBINHOOD_MCP_CAPABILITIES) {
    assert.equal(capability.reachedOverMcp, false, capability.id);
    /* Reaching a transport and calling a tool are different facts. The handshake
       answered from Ryntra's production egress; every tool still needs a
       credential nobody here holds. */
    assert.notEqual(capability.state.user, "available", capability.id + " has no account behind it");
  }
});

test("the transport record carries both origins, because they answered differently", function () {
  const record = jurisdictionRecord();
  assert.equal(record.state.source, "live-probe");
  assert.equal(record.state.protocol, "live");
  /* Unknown rather than restricted: the refusal belongs to one origin, and what
     stops Ryntra acting is that it holds no Robinhood account. Recording it as
     restricted would blame a jurisdiction for an absence of an account. */
  assert.equal(record.state.user, "unknown");
  assert.match(record.state.reason, /jurisdiction restricted by US sanctions/);
  assert.match(record.state.reason, /401/);
});

test("the OAuth lifecycle is measured where the standards publish it, absent where they do not", function () {
  const byId = new Map(OAUTH_LIFECYCLE.map(function (step) { return [step.id, step]; }));
  for (const id of ["registration", "authorization", "token", "refresh", "scopes", "revocation"]) {
    assert.ok(byId.has(id), id + " must be a named lifecycle step");
  }
  for (const step of OAUTH_LIFECYCLE) {
    assert.ok(["VERIFIED", "VERIFIED_ABSENT", "UNVERIFIED"].includes(step.state), step.id);
    assert.ok(step.finding.length > 20, step.id + " must state its finding");
    if (step.state === "UNVERIFIED") continue;
    assert.equal(step.source, "live-probe", step.id + " must name where it was measured");
  }

  /* The exact contract, from the two documents RFC 8414 and RFC 9728 intend to
     be read unauthenticated. Each of these is a fact a later packet would
     otherwise have to guess. */
  assert.equal(byId.get("registration").state, "VERIFIED");
  assert.match(byId.get("registration").finding, /agent\.robinhood\.com\/oauth\/trading\/register/);
  assert.equal(byId.get("authorization").state, "VERIFIED");
  assert.match(byId.get("authorization").finding, /S256/);
  assert.equal(byId.get("token").state, "VERIFIED");
  assert.match(byId.get("token").finding, /api\.robinhood\.com\/oauth2\/token/);
  assert.equal(byId.get("refresh").state, "VERIFIED");
  assert.match(byId.get("refresh").finding, /refresh_token/);
  assert.equal(byId.get("scopes").state, "VERIFIED");
  assert.match(byId.get("scopes").finding, /internal/);
  /* And the one that is a verified absence rather than an unknown: no RFC 7009
     endpoint is published, so there is no protocol way to revoke an agent. */
  assert.equal(byId.get("revocation").state, "VERIFIED_ABSENT");
});

test("the measured OAuth contract matches the capture it is derived from", function () {
  const capture = JSON.parse(
    readFileSync(new URL("./fixtures/production-probe.json", import.meta.url), "utf8"),
  );
  const server = capture.observations.find(function (o) { return o.id === "authorization-server-metadata"; });
  assert.equal(server.httpStatus, 200);
  assert.deepEqual(server.metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(server.metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.metadata.scopes_supported, ["internal"]);
  assert.deepEqual(server.metadata.token_endpoint_auth_methods_supported, ["none"]);
  assert.ok(!("revocation_endpoint" in server.metadata), "a revocation endpoint would change the record");

  const transport = capture.observations.find(function (o) { return o.id === "mcp-transport"; });
  assert.equal(transport.httpStatus, 401);
  assert.match(transport.challenge, /^Bearer resource_metadata=/);

  /* The capture is derived facts only: two public documents and one challenge. */
  const raw = readFileSync(new URL("./fixtures/production-probe.json", import.meta.url), "utf8");
  for (const pattern of [/access[_-]?token"\s*:/i, /client[_-]?secret/i, /\bcookie\b/i, /\beyJ[A-Za-z0-9._-]{10,}/]) {
    assert.ok(!pattern.test(raw), "the capture must not carry " + pattern);
  }
});

test("one scope means the documented read/write split is not an OAuth boundary", function () {
  const scopes = OAUTH_LIFECYCLE.find(function (step) { return step.id === "scopes"; });
  /* The provider describes reads across every account and writes confined to the
     Agentic one. The grant carries a single opaque scope, so that split is
     enforced by the account model and by nothing the customer or the client can
     narrow: there is no read-only authorization to ask for. */
  assert.match(scopes.finding, /single|one/i);
  assert.match(scopes.finding, /read-only/i);
});

test("products record what the venue says today, not what the launch post said", function () {
  const byId = new Map(ROBINHOOD_MCP_PRODUCTS.map(function (p) { return [p.id, p]; }));
  for (const id of ["equities", "options", "crypto"]) {
    assert.equal(byId.get(id).providerState, "AVAILABLE", id);
  }
  /* The May 2026 announcement listed event contracts and futures as coming soon
     and the current tool tables carry neither, so they are recorded as absent
     rather than as pending Ryntra work. */
  for (const id of ["futures", "event-contracts"]) {
    assert.equal(byId.get(id).providerState, "NOT_DOCUMENTED", id);
  }
  for (const product of ROBINHOOD_MCP_PRODUCTS) {
    assert.ok(product.evidence.length >= 1, product.id);
  }
});

test("the crypto state restriction is recorded as the provider states it", function () {
  const crypto = ROBINHOOD_MCP_PRODUCTS.find(function (p) { return p.id === "crypto"; });
  assert.match(crypto.limitation, /not available in every state/i);
  assert.match(crypto.limitation, /New York/);
});

test("the register says it is a cancelled artifact, so a reader of the code is told too", function () {
  /* The documents carry the decision; a register that did not would let someone
     reading only the source conclude an account is being arranged. */
  const source = readFileSync(new URL("./capability.ts", import.meta.url), "utf8");
  assert.match(source, /This direction is CANCELLED/);
  assert.match(source, /OWNER_NO_GO/);
  assert.match(source, /no\s+successor is queued/);
  /* And the boundary that must not be inherited. */
  assert.match(source, /Robinhood Chain Markets \+ Arcus is a different vertical/);
});

test("capabilityById refuses an id it does not hold rather than returning a blank", function () {
  assert.equal(capabilityById("robinhood-mcp-portfolio-read").id, "robinhood-mcp-portfolio-read");
  assert.throws(function () { capabilityById("robinhood-mcp-withdrawal"); }, /unknown capability/i);
});
