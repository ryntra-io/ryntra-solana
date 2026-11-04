// Run from repo root: node --test lib/agent-control/a2a/card.test.mjs
//
// The card is a document strangers parse, so the tests are about shape as much
// as about content: a field the 1.0 generation moved, a version string in the
// older form, or a promise no route honours would each be a defect somebody
// else's software discovers.
import { test } from "node:test";
import assert from "node:assert/strict";

import { CONNECTOR_TOOLS } from "../../connector/tools.ts";
import { HOSTED_LOCAL_READ_TOOLS } from "../mcp/hosted.ts";
import { MCP_WRITE_EFFECTS, MCP_WRITE_TOOLS } from "../mcp/write-tools.ts";
import { EXTERNAL_ROUTER_SKILLS } from "../external/router.ts";
import {
  A2A_BEARER_SCHEME,
  A2A_CARD_PATHS,
  A2A_CARD_SOURCE,
  A2A_HTTP_JSON_METHODS,
  A2A_INTERFACE_PATH,
  A2A_PROTOCOL_BINDINGS,
  A2A_SERVED_BINDING,
  A2A_WIRE_VERSION,
  CONNECTOR_OAUTH_SCHEME,
  CARD_LIMITATIONS,
  CardError,
  RYNTRA_A2A_EXTENSION,
  buildRyntraAgentCard,
} from "./card.ts";

const ORIGIN = "https://ryntra.io";

test("the wire version is major and minor, as the protocol's own surface publishes it", () => {
  /* `1.0.0` is the earlier generation's spelling and a 1.0 reader does not
     recognise it. The source of the fact is recorded beside it so a later
     session can re-check rather than re-derive. */
  assert.equal(A2A_WIRE_VERSION, "1.0");
  assert.equal(A2A_CARD_SOURCE.package, "@a2a-js/sdk");
  assert.match(A2A_CARD_SOURCE.observedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test("the card carries the 1.0 shape and none of the fields that generation moved", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  for (const field of [
    "name",
    "description",
    "supportedInterfaces",
    "provider",
    "version",
    "capabilities",
    "securitySchemes",
    "securityRequirements",
    "defaultInputModes",
    "defaultOutputModes",
    "skills",
    "signatures",
  ]) {
    assert.ok(field in card, `the card is missing ${field}`);
  }
  /* The two fields a card written from memory of the earlier generation would
     put at the top level. Both live inside `supportedInterfaces` now. */
  assert.ok(!("url" in card), "a 1.0 card carries no top-level url");
  assert.ok(!("protocolVersion" in card), "a 1.0 card carries no top-level protocolVersion");
});

test("the one interface is absolute, https, HTTP+JSON and at the path the route serves", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  assert.equal(card.supportedInterfaces.length, 1);
  const [served] = card.supportedInterfaces;
  assert.equal(served.url, `${ORIGIN}${A2A_INTERFACE_PATH}`);
  assert.equal(served.protocolBinding, A2A_SERVED_BINDING);
  assert.equal(served.protocolVersion, A2A_WIRE_VERSION);
  assert.ok(A2A_PROTOCOL_BINDINGS.includes(served.protocolBinding));
  assert.ok(!("tenant" in served), "an empty tenant is omitted, as the protocol's encoder omits it");
});

test("the declared base plus the protocol's own method path is the address the router serves", () => {
  /*
   * The defect this test exists for: a client uses the card's interface URL as
   * its endpoint unchanged and appends `/v1/<method>`. A base that already
   * carried `/v1` would send every call to `/v1/v1/<method>`, and the only
   * symptom would be somebody else's client getting a not-found.
   */
  assert.ok(!A2A_INTERFACE_PATH.endsWith("/v1"), "the declared base must not carry the version segment");
  const composed = `${A2A_INTERFACE_PATH}${A2A_HTTP_JSON_METHODS.messageSend}`;
  assert.equal(composed, "/api/agents/a2a/v1/message:send");
  assert.ok(!composed.includes("/v1/v1"));
  assert.equal(`${A2A_INTERFACE_PATH}${A2A_HTTP_JSON_METHODS.card}`, "/api/agents/a2a/v1/card");
});

test("an origin that is not absolute https is refused rather than published", () => {
  for (const origin of ["ryntra.io", "http://ryntra.io", "/", "https://ryntra.io/app", ""]) {
    assert.throws(
      () => buildRyntraAgentCard({ origin }),
      (error) => error instanceof CardError && error.reasonCode === "CARD_ORIGIN_NOT_ABSOLUTE_HTTPS",
      origin,
    );
  }
});

test("every skill is one this product already serves, and none is named for acting", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  const known = new Set([
    ...EXTERNAL_ROUTER_SKILLS.map((skill) => skill.id),
    ...HOSTED_LOCAL_READ_TOOLS,
    ...MCP_WRITE_TOOLS.map((tool) => tool.name),
    ...CONNECTOR_TOOLS.map((tool) => tool.name),
  ]);
  assert.equal(card.skills.length, known.size);
  for (const skill of card.skills) {
    assert.ok(known.has(skill.id), `${skill.id} is published and is served by nothing`);
    assert.ok(skill.description.length > 20, `${skill.id} is published without a description`);
    assert.ok(
      skill.securityRequirements.some((requirement) => A2A_BEARER_SCHEME in requirement.schemes || CONNECTOR_OAUTH_SCHEME in requirement.schemes),
      `${skill.id} publishes no security requirement`,
    );
  }
  /* The write side of the inventory has one effect value, which is what makes a
     signing skill unrepresentable rather than merely absent. */
  assert.deepEqual([...MCP_WRITE_EFFECTS], ["PROPOSAL_ONLY"]);
});

test("the capability flags match what the interface actually serves", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  assert.equal(card.capabilities.streaming, false);
  assert.equal(card.capabilities.pushNotifications, false);
  assert.equal(card.capabilities.extendedAgentCard, false);
  assert.deepEqual(card.capabilities.extensions, [RYNTRA_A2A_EXTENSION]);
  assert.equal(RYNTRA_A2A_EXTENSION.required, true);
});

test("the security scheme is in the shape the protocol's encoder writes", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  const scheme = card.securitySchemes[A2A_BEARER_SCHEME];
  assert.ok(scheme, "the card names no scheme");
  assert.equal(scheme.httpAuthSecurityScheme.scheme, "Bearer");
  assert.ok(scheme.httpAuthSecurityScheme.description.length > 20);
  assert.ok(card.securityRequirements.some((requirement) => A2A_BEARER_SCHEME in requirement.schemes));
});

test("the Solana connector's skills are read-only MCP tools behind the wallet-approved OAuth scheme (CITY-154)", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  const scheme = card.securitySchemes[CONNECTOR_OAUTH_SCHEME];
  assert.ok(scheme?.oauth2SecurityScheme, "the connector's scheme is missing");
  const flow = scheme.oauth2SecurityScheme.flows.authorizationCode;
  assert.equal(flow.authorizationUrl, `${ORIGIN}/connect`);
  assert.equal(flow.tokenUrl, `${ORIGIN}/api/connect/token`);
  assert.equal(flow.pkceRequired, true);
  assert.deepEqual(Object.keys(flow.scopes), ["market:read"]);
  assert.equal(card.documentationUrl, `${ORIGIN}/connect`);
  const connector = card.skills.filter((skill) => skill.tags.includes("solana"));
  assert.equal(connector.length, CONNECTOR_TOOLS.length);
  for (const skill of connector) {
    assert.deepEqual([...skill.tags], ["read", "mcp", "solana"]);
    assert.ok(skill.description.includes(`${ORIGIN}/mcp`));
  }
});

test("the card is unsigned and says so where a reader will look", () => {
  const card = buildRyntraAgentCard({ origin: ORIGIN });
  assert.deepEqual(card.signatures, []);
  assert.ok(CARD_LIMITATIONS.some((line) => /no JWS signature/i.test(line)));
});

test("one document answers at both paths", () => {
  assert.equal(A2A_CARD_PATHS.current, "/.well-known/agent-card.json");
  assert.equal(A2A_CARD_PATHS.legacy, "/.well-known/agent.json");
  assert.notEqual(A2A_CARD_PATHS.current, A2A_CARD_PATHS.legacy);
  assert.ok(CARD_LIMITATIONS.some((line) => /there is one card, not two/i.test(line)));
});

test("nothing in the serialized card is an empty string", () => {
  /* The protocol's own encoder omits empty strings, so a field we filled with
     `""` would travel as an absent field and a reader would see a document
     different from the one we think we publish. */
  const serialized = JSON.parse(JSON.stringify(buildRyntraAgentCard({ origin: ORIGIN })));
  const walk = (value, path) => {
    if (typeof value === "string") {
      assert.notEqual(value, "", `${path} is an empty string`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    }
  };
  walk(serialized, "card");
});
