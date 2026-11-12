// Run from repo root: node --test lib/vault/guard-model.test.mjs
/*
 * The guards on the real model gateway of CITY-45 (CITY-218): what OpenRouter would receive for one attempt — the
 * pinned model, the guard's rules and the one fenced message, thinking off, no tools at all — the worst case priced
 * from the pinned provider's own prices, and every failure as the vault reads it. The gateway is the real one; only
 * OpenRouter is forged, and a test that reaches the real network fails.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createModelGateway, CHAT_URL } = await import("../models/call.ts");
const { CATALOG_URL, PROVIDERS_URL, createModelCatalog } = await import("../models/catalog.ts");
const { MODELS_ENV } = await import("../models/env.ts");
const { guardModel, GUARD_PIN, inputBound, readGuardPin } = await import("./guard-model.ts");
const { guardCall } = await import("./rules.ts");
const { guardOf, VAULTS } = await import("./levels.ts");
const { ModelFailure } = await import("./model.ts");
const { createVaultEngine } = await import("./engine.ts");
const { createMemoryVaultStore } = await import("./store.ts");

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PARAMS = ["max_tokens", "reasoning", "include_reasoning", "tools", "tool_choice", "response_format", "structured_outputs"];
/** $1 a million tokens in, $5 out — shaped like OpenRouter's public reads. */
const MODELS = [{ id: "anthropic/claude-haiku-5.5", pricing: { prompt: "0.000001", completion: "0.000005" }, supported_parameters: PARAMS, reasoning: { mandatory: false, supported_efforts: ["low", "none"] } }];
const ENDPOINTS = [{ tag: "anthropic", provider_name: "Anthropic", context_length: 200000, max_completion_tokens: 64000, pricing: { prompt: "0.000001", completion: "0.000005" }, supported_parameters: PARAMS }];

function forge(chat) {
  const sent = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === CATALOG_URL) return json(200, { data: MODELS });
    if (u === PROVIDERS_URL) return json(200, { data: [{ name: "Anthropic", slug: "anthropic" }] });
    if (u.includes("/endpoints")) return json(200, { data: { id: MODELS[0].id, endpoints: ENDPOINTS } });
    if (u === CHAT_URL) {
      const body = JSON.parse(init.body);
      sent.push({ body, auth: init.headers?.authorization ?? init.headers?.Authorization });
      return chat(body);
    }
    return json(404, { error: { code: 404, message: "Not Found" } });
  };
  return { fetch, sent };
}

const answer = (content, cost = 0.00031) =>
  json(200, {
    id: "gen-vault-1",
    provider: "Anthropic",
    model: "anthropic/claude-haiku-5.5",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 210, completion_tokens: 24, total_tokens: 234, cost, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } },
  });

function live(chat, { apiKey = null, env = { [MODELS_ENV.apiKey]: "test-shared-key-0001" } } = {}) {
  const { fetch, sent } = forge(chat);
  const catalog = createModelCatalog({ fetch });
  const gateway = createModelGateway({ env, fetch, catalog, journal: () => {} });
  return { guard: guardModel({ gateway, apiKey }), sent };
}

const DAY = "2026-11-08";
const call = (text = "Hello, guard. What are you guarding?") =>
  guardCall({ vault: "practice-2", guard: guardOf("practice-2", DAY), strictness: VAULTS["practice-2"].strictness, words: ["amber", "willow", "comet"], text, mark: "m4rk", traceId: "t1" });

test("one attempt is one call: the pinned model, the rules and one fenced message, thinking off, no tools at all", async () => {
  const { guard, sent } = live(() => answer("Twenty years at this door. Move along."));
  const reply = await guard.call(call());
  assert.equal(reply.text, "Twenty years at this door. Move along.");
  assert.equal(reply.costMicroUsd, 310);
  assert.equal(reply.model, "anthropic/claude-haiku-5.5");
  assert.equal(sent.length, 1);
  const body = sent[0].body;
  assert.equal(body.model, GUARD_PIN.id);
  assert.deepEqual(body.provider.only, ["anthropic"]);
  assert.equal(body.provider.allow_fallbacks, false);
  assert.equal(body.models, undefined, "no fallback models");
  assert.equal("tools" in body, false, "the request carries no tools");
  assert.equal("tool_choice" in body, false);
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"], "a new conversation: the rules and one message");
  assert.match(body.messages[0].content, /You are Brass/);
  assert.match(body.messages[1].content, /^<visitor m4rk>\nHello, guard\. What are you guarding\?\n<\/visitor m4rk>$/);
  assert.equal(body.max_tokens, call().maxTokens);
  assert.deepEqual(body.reasoning, { effort: "none" }, "thinking off");
  assert.equal(sent[0].auth, "Bearer test-shared-key-0001", "the gateway's shared key when the vault has none");
});

test("the vault's own key pays when it has one", async () => {
  const { guard, sent } = live(() => answer("Move along."), { apiKey: "test-vault-key-0002" });
  await guard.call(call());
  assert.equal(sent[0].auth, "Bearer test-vault-key-0002");
});

test("the worst case comes from the pinned provider's prices and bounds any attempt from above", async () => {
  const { guard } = live(() => answer("x"));
  const one = call();
  const worst = await guard.worstCase(one);
  const input = inputBound(one);
  assert.equal(worst, Math.ceil(input * 1 + one.maxTokens * 5));
  // A 280-character attempt of four-byte characters still fits under the bound: tokens never outnumber bytes.
  const heavy = call("😀".repeat(280));
  assert.ok(inputBound(heavy) >= Buffer.byteLength(heavy.system) + Buffer.byteLength(heavy.messages[0].content));
  assert.ok((await guard.worstCase(heavy)) < 10_000, "under a cent even at its worst");
});

test("failures come back as the vault reads them: what lasts, what passes, what it cost", async () => {
  const cases = [
    [() => json(402, { error: { code: 402, message: "Insufficient credits" } }), "budget", true],
    [() => json(403, { error: { code: 403, message: "Key limit exceeded (daily limit)", metadata: { limit_source: "openrouter_key_limit" } } }), "budget", true],
    [() => json(401, { error: { code: 401, message: "No auth credentials found" } }), "unavailable", true],
    [() => json(429, { error: { code: 429, message: "Rate limited" } }), "unavailable", false],
    [() => json(503, { error: { code: 503, message: "Overloaded" } }), "unavailable", false],
    // A visitor's words can make a request the provider refuses: one attempt fails, the guards never rest for it.
    [() => json(400, { error: { code: 400, message: "invalid request: no low surrogate in string" } }), "unavailable", false],
    [() => answer(""), "unavailable", false],
  ];
  for (const [chat, reason, lasting] of cases) {
    const { guard } = live(chat);
    await assert.rejects(guard.call(call()), (error) => {
      assert.ok(error instanceof ModelFailure);
      assert.equal(error.reason, reason, error.message);
      assert.equal(error.lasting, lasting, error.message);
      return true;
    });
  }
  const { guard: empty } = live(() => answer("", 0.0002));
  await assert.rejects(empty.call(call()), (error) => error.costMicroUsd === 200, "an empty answer that was billed keeps its cost");
  const keyless = live(() => answer("x"), { env: {} });
  await assert.rejects(keyless.guard.call(call()), (error) => error.lasting && /no_key/.test(error.message));
  assert.equal(keyless.sent.length, 0, "nothing is sent without a key");
});

test("a model the catalog does not have cannot be priced, so it is never called", async () => {
  const { fetch, sent } = forge(() => answer("x"));
  const catalog = createModelCatalog({ fetch });
  const gateway = createModelGateway({ env: { [MODELS_ENV.apiKey]: "test-shared-key-0001" }, fetch, catalog, journal: () => {} });
  const guard = guardModel({ gateway, pin: { id: "anthropic/claude-gone-1", providers: ["anthropic"] } });
  await assert.rejects(guard.worstCase(call()), (error) => error instanceof ModelFailure && error.lasting);
  assert.equal(sent.length, 0);
});

test("a deployment may pin another model, written vendor/model@provider", () => {
  assert.deepEqual(readGuardPin(undefined), GUARD_PIN);
  assert.deepEqual(readGuardPin("openai/gpt-6-luna@openai"), { id: "openai/gpt-6-luna", providers: ["openai"] });
  assert.deepEqual(readGuardPin(" anthropic/claude-haiku-5.5@anthropic,amazon-bedrock "), { id: "anthropic/claude-haiku-5.5", providers: ["anthropic", "amazon-bedrock"] });
  for (const bad of ["", "haiku", "anthropic/claude-haiku-5.5", "@anthropic", "a/b@c d"]) assert.deepEqual(readGuardPin(bad), GUARD_PIN, bad);
});

test("end to end on the engine: the guard answers, the real cost is booked against the day", async () => {
  const { guard } = live(() => answer("Move along, friend."));
  const store = createMemoryVaultStore();
  let now = Date.parse(`${DAY}T12:00:00Z`);
  const engine = createVaultEngine({ model: guard, store, secret: "s", ceilingMicroUsd: 5_000_000, now: () => (now += 21_000) });
  const result = await engine.attempt({ who: { kind: "guest", id: "g1" }, address: "203.0.113.9", vault: "practice-1", text: "Good evening!" });
  assert.equal(result.ok, true);
  assert.equal(result.response.outcome, "held");
  assert.equal(result.response.reply, "Move along, friend.");
  assert.deepEqual(await store.spent(DAY), { guest: 310, wallet: 0 });
  assert.equal(result.response.state.guards.awake, true);
});
