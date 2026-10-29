// Run from repo root: node --test app/api/agents/registration/route.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRegistrationHandler } from "./handler.ts";

const handler = createRegistrationHandler();

function get(url = "https://ryntra.io/api/agents/registration", headers = {}) {
  return handler(new Request(url, { headers }));
}

test("the dossier is served with every blocker and nothing that registers", async () => {
  const response = get();
  const { data } = await response.json();
  assert.equal(data.registerable, false);
  assert.equal(data.ryntraBuildsNoAgentRegistry, true);
  assert.ok(data.dossier.entries.length >= 5);
  assert.ok(data.blockers.some((blocker) => blocker.code === "OWNER_HAS_NOT_SAID_TO_REGISTER"));
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("the dossier's addresses follow the origin the request arrived on", async () => {
  const { data } = await get("https://ryntra.io/api/agents/registration", {
    "x-forwarded-host": "preview.ryntra.io",
    "x-forwarded-proto": "https",
  }).json();
  const card = data.dossier.entries.find((entry) => entry.field === "agentCard");
  assert.equal(card.value, "https://preview.ryntra.io/.well-known/agent-card.json");
});

test("a request that arrives without https gets the blockers and no dossier", async () => {
  const { data } = await get("http://localhost:3000/api/agents/registration").json();
  assert.equal(data.dossier, null);
  assert.ok(data.blockers.some((blocker) => blocker.code === "ORIGIN_UNKNOWN"));
});

test("no answer carries a wallet, a key or a transaction", async () => {
  const text = JSON.stringify(await get().json());
  for (const word of ["privateKey", "keypair", "mnemonic", "sendTransaction"]) {
    assert.ok(!text.includes(word), `the answer carried ${word}`);
  }
  /* The wallet field is present and empty, which is the point of having it. */
  assert.match(text, /"field":"walletAddress","value":null/);
});
