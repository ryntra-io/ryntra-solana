// Run from repo root: node --test app/.well-known/agent-card.json/route.test.mjs
//
// One document, two addresses. The earlier generation's path is still what most
// clients try first, so both are served and both answer the 1.0 card.
import { test } from "node:test";
import assert from "node:assert/strict";

import { GET as currentPath } from "./route.ts";
import { GET as legacyPath } from "../agent.json/route.ts";

function get(handler, url = "https://ryntra.io/.well-known/agent-card.json", headers = {}) {
  return handler(new Request(url, { headers }));
}

test("both paths answer the same card", async () => {
  const current = await get(currentPath).json();
  const legacy = await get(legacyPath, "https://ryntra.io/.well-known/agent.json").json();
  assert.deepEqual(current, legacy);
  assert.equal(current.supportedInterfaces[0].protocolVersion, "1.0");
});

test("the card is public, cacheable and typed as the protocol types it", async () => {
  const response = get(currentPath);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/a2a+json");
  assert.equal(response.headers.get("A2A-Version"), "1.0");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("cache-control"), /max-age/);
});

test("the interface URL follows the host the request arrived on", async () => {
  const card = await get(currentPath, "https://ryntra.io/.well-known/agent-card.json", {
    "x-forwarded-host": "preview.ryntra.io",
    "x-forwarded-proto": "https",
  }).json();
  assert.equal(card.supportedInterfaces[0].url, "https://preview.ryntra.io/api/agents/a2a");
  assert.equal(card.provider.url, "https://preview.ryntra.io");
});

test("without an https origin no card is published at all", async () => {
  const response = get(currentPath, "http://localhost:3000/.well-known/agent-card.json");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "CARD_ORIGIN_NOT_ABSOLUTE_HTTPS");
});

test("the card promises no skill that signs, sends or spends", async () => {
  const card = await get(currentPath).json();
  for (const skill of card.skills) {
    assert.doesNotMatch(
      `${skill.id} ${skill.name}`,
      /\b(sign|send|execute|submit|transfer|withdraw|pay)\b/i,
      `${skill.id} is named for something no skill here may do`,
    );
  }
  assert.equal(card.capabilities.streaming, false);
  assert.deepEqual(card.signatures, []);
});
