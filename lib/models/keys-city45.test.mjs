// Run from repo root: node --test lib/models/keys-city45.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createModelGateway } from "./call.ts";
import { CATALOG_URL, createModelCatalog } from "./catalog.ts";
import { MODELS_ENV } from "./env.ts";
import { ModelGatewayError } from "./errors.ts";
import { KEY_LIMIT_MAX_USD, KEYS_URL, createKeyManager, keyName, parseKeyInfo } from "./keys.ts";

/**
 * CITY-45 «Шлюз моделей»: each agent's and guard's own OpenRouter key with a
 * dollar limit — made and switched off through the management API, and its
 * spent limit read as «budget exhausted». A forged fetch only.
 */

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

function forge(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    const call = { url: String(url), method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    return handler(call, calls.length);
  };
  impl.calls = calls;
  return impl;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const MANAGEMENT = "test-management-key-01";
const CREATED_SECRET = "test-created-agent-key-9";
const HASH = "f3a9c2e1b7d4a6c8";
const ENV = { [MODELS_ENV.managementKey]: MANAGEMENT };

/** Shaped like OpenRouter's key record (`data`). */
const record = (patch = {}) => ({
  hash: HASH,
  name: "ryntra:ring-agent:agent-42",
  label: "masked label",
  disabled: false,
  limit: 2.5,
  limit_remaining: 2.5,
  limit_reset: null,
  include_byok_in_limit: true,
  usage: 0,
  created_at: "2026-10-27T20:00:00.000Z",
  updated_at: null,
  ...patch,
});

test("no management key on the server — a clear error naming it, nothing sent", async () => {
  const fetch = forge(() => json(200, {}));
  const keys = createKeyManager({ env: {}, fetch });
  for (const action of [() => keys.create({ subject: { kind: "ring-agent", id: "agent-42" }, limitUsd: 1 }), () => keys.disable(HASH), () => keys.read(HASH)]) {
    await assert.rejects(action(), (error) => error instanceof ModelGatewayError && error.kind === "no_key" && /OPENROUTER_MANAGEMENT_KEY is not set/.test(error.message));
  }
  assert.equal(fetch.calls.length, 0);
  const shared = createKeyManager({ env: { [MODELS_ENV.apiKey]: "test-shared-key-0001" }, fetch });
  await assert.rejects(shared.read(HASH), (error) => error.kind === "no_key", "the calling key never stands in for the management key");
});

test("a key for an agent: its name, its dollar limit, the secret once — and the management key only in the header", async () => {
  const fetch = forge(() => json(201, { data: record(), key: CREATED_SECRET }));
  const keys = createKeyManager({ env: ENV, fetch });
  const created = await keys.create({ subject: { kind: "ring-agent", id: "agent-42" }, limitUsd: 2.5 });
  const [sent] = fetch.calls;
  assert.deepEqual({ url: sent.url, method: sent.method, auth: sent.headers.authorization }, { url: KEYS_URL, method: "POST", auth: `Bearer ${MANAGEMENT}` });
  assert.deepEqual(sent.body, { name: "ryntra:ring-agent:agent-42", limit: 2.5, limit_reset: null, include_byok_in_limit: true });
  assert.equal(created.secret, CREATED_SECRET);
  assert.deepEqual(created.info, {
    hash: HASH,
    name: "ryntra:ring-agent:agent-42",
    disabled: false,
    limitUsd: 2.5,
    limitRemainingUsd: 2.5,
    limitReset: null,
    usageUsd: 0,
    createdAt: "2026-10-27T20:00:00.000Z",
    updatedAt: null,
  });
  assert.ok(!JSON.stringify(created.info).includes(CREATED_SECRET), "the record of a key never holds the key");

  const daily = forge(() => json(201, { data: record({ name: "ryntra:vault-guard:vault-7", limit: 5, limit_reset: "daily" }), key: CREATED_SECRET }));
  const guard = await createKeyManager({ env: ENV, fetch: daily }).create({ subject: { kind: "vault-guard", id: "vault-7" }, limitUsd: 5, limitReset: "daily" });
  assert.equal(daily.calls[0].body.limit_reset, "daily");
  assert.equal(guard.info.limitReset, "daily");
  assert.equal(keyName({ kind: "vault-guard", id: "vault-7" }), "ryntra:vault-guard:vault-7");
});

test("a limit above 0 and at most the ceiling, a known subject and reset — or nothing is sent", async () => {
  const fetch = forge(() => json(201, { data: record(), key: CREATED_SECRET }));
  const keys = createKeyManager({ env: ENV, fetch });
  const subject = { kind: "ring-agent", id: "agent-42" };
  for (const input of [
    { subject, limitUsd: 0 },
    { subject, limitUsd: -1 },
    { subject, limitUsd: Number.NaN },
    { subject, limitUsd: KEY_LIMIT_MAX_USD + 0.01 },
    { subject, limitUsd: "2" },
    { subject: { kind: "player", id: "x" }, limitUsd: 1 },
    { subject: { kind: "ring-agent", id: "" }, limitUsd: 1 },
    { subject, limitUsd: 1, limitReset: "hourly" },
  ]) {
    await assert.rejects(keys.create(input), (error) => error instanceof ModelGatewayError && error.kind === "invalid_request", JSON.stringify(input));
  }
  assert.equal(fetch.calls.length, 0);
  await keys.create({ subject, limitUsd: KEY_LIMIT_MAX_USD });
  assert.equal(fetch.calls.length, 1, "the ceiling itself is allowed");
});

test("a key made but not returned, or a record without a hash, is an invalid response", async () => {
  await assert.rejects(createKeyManager({ env: ENV, fetch: forge(() => json(201, { data: record() })) }).create({ subject: { kind: "ring-agent", id: "a" }, limitUsd: 1 }), (error) => error.kind === "invalid_response");
  assert.throws(() => parseKeyInfo({ name: "x" }), (error) => error.kind === "invalid_response");
  assert.deepEqual(parseKeyInfo(record({ limit: null, limit_remaining: null, usage: "x", limit_reset: "yearly" })), {
    hash: HASH,
    name: "ryntra:ring-agent:agent-42",
    disabled: false,
    limitUsd: null,
    limitRemainingUsd: null,
    limitReset: null,
    usageUsd: null,
    createdAt: "2026-10-27T20:00:00.000Z",
    updatedAt: null,
  });
});

test("switching a key off: PATCH disabled, confirmed by OpenRouter's record; reading what is left of it", async () => {
  const fetch = forge((call) => (call.method === "PATCH" ? json(200, { data: record({ disabled: true, usage: 1.75, limit_remaining: 0.75, updated_at: "2026-10-27T21:00:00.000Z" }) }) : json(200, { data: record({ usage: 1.75, limit_remaining: 0.75 }) })));
  const keys = createKeyManager({ env: ENV, fetch });
  const off = await keys.disable(HASH);
  assert.deepEqual({ url: fetch.calls[0].url, method: fetch.calls[0].method, body: fetch.calls[0].body }, { url: `${KEYS_URL}/${HASH}`, method: "PATCH", body: { disabled: true } });
  assert.equal(off.disabled, true);
  assert.equal(off.usageUsd, 1.75);
  const read = await keys.read(HASH);
  assert.deepEqual({ url: fetch.calls[1].url, method: fetch.calls[1].method, body: fetch.calls[1].body }, { url: `${KEYS_URL}/${HASH}`, method: "GET", body: undefined });
  assert.equal(read.limitRemainingUsd, 0.75);

  await assert.rejects(createKeyManager({ env: ENV, fetch: forge(() => json(200, { data: record() })) }).disable(HASH), (error) => error.kind === "invalid_response", "a key OpenRouter did not switch off is never reported off");
  for (const hash of ["", "short", "../keys", "a b c d e f g h", null]) {
    await assert.rejects(keys.disable(hash), (error) => error.kind === "invalid_request");
  }
  assert.equal(fetch.calls.length, 2);
});

test("the management API's failures by kind", async () => {
  const cases = [
    [404, { error: { code: 404, message: "Key not found" } }, "not_found"],
    [401, { error: { code: 401, message: "Invalid management key" } }, "unauthorized"],
    [403, { error: { code: 403, message: "Only management keys can perform this operation" } }, "forbidden"],
    [429, { error: { code: 429, message: "Too many" } }, "rate_limited"],
    [500, { error: { code: 500, message: "Internal" } }, "provider_unavailable"],
  ];
  for (const [status, body, kind] of cases) {
    await assert.rejects(createKeyManager({ env: ENV, fetch: forge(() => json(status, body)) }).read(HASH), (error) => error instanceof ModelGatewayError && error.kind === kind && error.status === status);
  }
  const unreachable = createKeyManager({
    env: ENV,
    fetch: forge(() => {
      throw new TypeError("fetch failed");
    }),
  });
  await assert.rejects(unreachable.read(HASH), (error) => error.kind === "network");
});

test("the agent's own key at its limit: the call comes back «budget exhausted», and only that agent stops", async () => {
  const keys = createKeyManager({ env: ENV, fetch: forge(() => json(201, { data: record({ limit: 0.05 }), key: CREATED_SECRET })) });
  const { secret } = await keys.create({ subject: { kind: "ring-agent", id: "agent-42" }, limitUsd: 0.05 });
  const records = [];
  const chat = forge((call) =>
    call.headers.authorization === `Bearer ${secret}`
      ? json(403, { error: { code: 403, message: "Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/f3a9c2e1b7d4a6c8" } })
      : json(200, { id: "gen-2", model: "openai/gpt-6-luna", provider: "OpenAI", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "e4" } }], usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52, cost: 0.000006 } }),
  );
  const catalog = createModelCatalog({
    fetch: forge((call) =>
      call.url === CATALOG_URL ? json(200, { data: [{ id: "openai/gpt-6-luna", pricing: { prompt: "0.0000001", completion: "0.0000004" }, supported_parameters: ["max_tokens", "tools"] }] }) : json(200, { data: [{ name: "OpenAI", slug: "openai" }] }),
    ),
  });
  const gateway = createModelGateway({ env: { [MODELS_ENV.apiKey]: "test-shared-key-0001" }, fetch: chat, catalog, journal: (entry) => records.push(entry) });
  const move = (apiKey, id) => ({
    subject: { kind: "ring-agent", id },
    model: { id: "openai/gpt-6-luna", providers: ["openai"] },
    messages: [{ role: "user", content: "Your move." }],
    budget: { maxTokens: 200, reasoningTokens: 0, timeoutMs: 20_000 },
    ...(apiKey ? { apiKey } : {}),
  });
  const spent = await gateway.call(move(secret, "agent-42"));
  assert.equal(spent.ok, false);
  assert.equal(spent.error.kind, "budget_exhausted");
  assert.equal(spent.error.retryable, false, "the same key will not have more money in a minute");
  const other = await gateway.call(move(undefined, "agent-43"));
  assert.equal(other.ok, true);
  assert.equal(other.costMicroUsd, 6);
  assert.equal(other.answered.pinned, true, "«OpenAI» is openai by OpenRouter's list");
  assert.deepEqual(records.map((entry) => [entry.subject.id, entry.key, entry.outcome]), [
    ["agent-42", "own", "budget_exhausted"],
    ["agent-43", "shared", "ok"],
  ]);
  assert.ok(!JSON.stringify(records).includes(secret));
});
