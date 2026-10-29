// Run from repo root: node --test lib/ring/agent.test.mjs
/*
 * CITY-50 «Ринг · агенти»: the rules an agent's request is checked by before the store is asked — the script up to
 * 2 000 characters, the six bodies, the formats a brain can play — and the switches: the Ring opens only where the
 * deployment says `open` and, in production, only on the database; keys are made only with both secrets; the
 * fixture catalog never in production. And the seal an agent's key is kept under.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FORMAT_NEEDS, agentName, checkScenario, formatsOf, parseChange, parseCreate, parseOff } = await import("./agent.ts");
const { ARCHETYPES, FORMATS, SCENARIO_MAX } = await import("./contract.ts");
const { catalogKind, keyMode, ringReady, storeKind } = await import("./ready.ts");
const { createSealer } = await import("./seal.ts");

const AGENT = "00000000-0000-4000-8000-000000000001";

test("six bodies of decision 72 and three formats, each with what its harness needs", () => {
  assert.deepEqual([...ARCHETYPES], ["guardian", "fighter", "tactician", "scout", "engineer", "host"]);
  assert.deepEqual([...FORMATS], ["duo-crack", "code", "market-replay"]);
  assert.deepEqual(Object.keys(FORMAT_NEEDS), [...FORMATS]);
  assert.deepEqual(formatsOf({ tools: true, structuredOutputs: true }), ["duo-crack", "code", "market-replay"]);
  assert.deepEqual(formatsOf({ tools: true, structuredOutputs: false }), ["duo-crack", "code"]);
  assert.deepEqual(formatsOf({ tools: false, structuredOutputs: true }), ["duo-crack", "market-replay"]);
  assert.deepEqual(formatsOf({ tools: false, structuredOutputs: false }), ["duo-crack"], "every brain can play Duo Crack");
});

test("an agent's name is its body and four characters of its id — nothing typed by anyone", () => {
  assert.equal(agentName("tactician", "9f2a71c4-0000-4000-8000-000000000000"), "Tactician 9F2A");
  assert.equal(agentName("host", "--"), "Host 0000");
});

test("a script: up to 2 000 characters counted as people see them, kept as typed, never cut", () => {
  assert.equal(SCENARIO_MAX, 2000);
  assert.deepEqual(checkScenario(""), { ok: true, text: "" });
  assert.deepEqual(checkScenario("a".repeat(2000)), { ok: true, text: "a".repeat(2000) });
  assert.deepEqual(checkScenario("a".repeat(2001)), { ok: false, code: "TOO_LONG" });
  // An emoji is one character to a person and two UTF-16 units to JavaScript.
  assert.equal(checkScenario("🛡".repeat(2000)).ok, true);
  assert.equal(checkScenario("a‍b‌c​‮d﻿").text, "a‍b‌cd","joiners stay, zero-width space and direction marks go");
  assert.deepEqual(checkScenario("🛡".repeat(2001)), { ok: false, code: "TOO_LONG" });
  assert.deepEqual(checkScenario(42), { ok: false, code: "BAD_REQUEST" });
});

test("a script is kept clean: one kind of line end, no control or direction-flipping characters, no trailing space", () => {
  assert.deepEqual(checkScenario("line one\r\nline two\rthree\tend   \n\n"), { ok: true, text: "line one\nline two\nthree\tend" });
  assert.deepEqual(checkScenario("a\u0000b\u0007c‮d​e﻿"), { ok: true, text: "abcde" });
  assert.deepEqual(checkScenario("é"), { ok: true, text: "é" }, "NFC");
});

test("a create names a garage, a body, a model and a script; anything else is a bad request", () => {
  const good = { quarter: "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f", slot: 2, archetype: "scout", model: "anthropic/claude-sonnet-5.5", scenario: "go" };
  assert.deepEqual(parseCreate(good), { ok: true, value: { quarterId: good.quarter, slot: 2, archetype: "scout", model: good.model, scenario: "go" } });
  assert.equal(parseCreate({ ...good, scenario: undefined }).ok, true, "no script is an empty script");
  for (const bad of [{ slot: -1 }, { slot: 64 }, { slot: 1.5 }, { quarter: "../x" }, { archetype: "wizard" }, { model: "" }, { model: "a b/c" }, { scenario: 7 }]) {
    const parsed = parseCreate({ ...good, ...bad });
    assert.equal(parsed.ok, false, JSON.stringify(bad));
    assert.equal(parsed.code, "BAD_REQUEST", JSON.stringify(bad));
  }
  const long = parseCreate({ ...good, scenario: "x".repeat(2001) });
  assert.equal(long.code, "TOO_LONG");
  assert.match(long.message, /2,000/);
});

test("a change and a switch-off name the agent and the version seen", () => {
  assert.deepEqual(parseOff({ agent: AGENT, version: 3 }), { ok: true, value: { id: AGENT, version: 3 } });
  assert.equal(parseOff({ agent: "nope", version: 3 }).ok, false);
  assert.equal(parseOff({ agent: AGENT, version: 0 }).ok, false);
  assert.equal(parseChange({ agent: AGENT, version: 1, archetype: "host", model: "openai/gpt-6-luna", scenario: "" }).ok, true);
  assert.equal(parseChange({ agent: AGENT, version: "1", archetype: "host", model: "openai/gpt-6-luna" }).ok, false);
});

test("the Ring opens only where the switch says `open` — and in production only on the database", () => {
  const memory = { durable: false };
  const database = { durable: true };
  assert.equal(ringReady(database, "open", "production"), true);
  assert.equal(ringReady(database, " open ", "production"), true);
  assert.equal(ringReady(memory, "open", "production"), false, "one instance's memory never opens in production");
  assert.equal(ringReady(memory, "open", "development"), true);
  for (const flag of [undefined, "", "closed", "OPEN", "yes"]) assert.equal(ringReady(database, flag, "production"), false, String(flag));
});

test("the store: the database wherever a deployment runs, memory on a developer's machine", () => {
  const db = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", BETA_APP_SECRET: "s" };
  assert.equal(storeKind({ ...db, NODE_ENV: "production" }), "database");
  assert.equal(storeKind({ ...db, NODE_ENV: "development" }), "memory");
  assert.equal(storeKind({ ...db, NODE_ENV: "development", RYNTRA_RING_STORE: "database" }), "database");
  assert.equal(storeKind({ NODE_ENV: "production" }), "memory", "without the database's settings — and then closed in production");
});

test("keys are made only with OpenRouter's management key and the seal's secret; otherwise the Ring is quiet", () => {
  const seal = "s".repeat(32);
  assert.equal(keyMode({ OPENROUTER_MANAGEMENT_KEY: "sk-or-mgmt-12345678", RYNTRA_RING_SEAL_SECRET: seal }), "live");
  assert.equal(keyMode({ OPENROUTER_MANAGEMENT_KEY: "sk-or-mgmt-12345678" }), "quiet");
  assert.equal(keyMode({ RYNTRA_RING_SEAL_SECRET: seal }), "quiet");
  assert.equal(keyMode({ OPENROUTER_MANAGEMENT_KEY: "sk-or-mgmt-12345678", RYNTRA_RING_SEAL_SECRET: "short" }), "quiet");
  assert.equal(keyMode({ OPENROUTER_MANAGEMENT_KEY: "has a space in it", RYNTRA_RING_SEAL_SECRET: seal }), "quiet");
  assert.equal(keyMode({}), "quiet");
});

test("the fixture catalog only on a developer's machine that asks for it, never in production", () => {
  assert.equal(catalogKind({ NODE_ENV: "development", RYNTRA_RING_MODELS: "stub" }), "stub");
  assert.equal(catalogKind({ NODE_ENV: "production", RYNTRA_RING_MODELS: "stub" }), "live");
  assert.equal(catalogKind({ NODE_ENV: "development" }), "live");
});

test("the seal: a key opens for its own agent under the same secret, and nothing else opens it", () => {
  const sealer = createSealer("ring-test-seal-secret-0123456789abcdef");
  const sealed = sealer.seal(AGENT, "sk-or-v1-abc123");
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  assert.ok(!sealed.includes("sk-or"));
  assert.equal(sealer.open(AGENT, sealed), "sk-or-v1-abc123");
  assert.notEqual(sealer.seal(AGENT, "sk-or-v1-abc123"), sealed, "a fresh nonce every time");
  assert.equal(sealer.open("00000000-0000-4000-8000-000000000002", sealed), null, "another agent");
  assert.equal(createSealer("another-seal-secret-0123456789abcdefgh").open(AGENT, sealed), null, "another secret");
  const parts = sealed.split(".");
  const flipped = parts[2][0] === "A" ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;
  assert.equal(sealer.open(AGENT, [parts[0], parts[1], flipped, parts[3]].join(".")), null, "a changed byte");
  assert.equal(sealer.open(AGENT, "not sealed"), null);
  for (const weak of [undefined, null, "", "too-short", " ".repeat(40)]) assert.equal(createSealer(weak), null, String(weak));
});
