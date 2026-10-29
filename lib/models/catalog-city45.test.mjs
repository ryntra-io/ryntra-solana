// Run from repo root: node --test lib/models/catalog-city45.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_URL,
  PROVIDERS_URL,
  createModelCatalog,
  estimateCostMicroUsd,
  highestPrices,
  parseCatalog,
  parseCatalogModel,
  parseEndpoints,
  parsePrices,
  parseProviders,
  perMillion,
} from "./catalog.ts";
import { ModelGatewayError } from "./errors.ts";

/**
 * CITY-45 «Шлюз моделей»: the catalog and its prices — read from a forged
 * fetch only; a test that reaches the real network fails.
 */

globalThis.fetch = async () => {
  throw new Error("a test reached the real network");
};

/** A forged fetch: records each request and answers from the handler. */
function forge(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    const call = { url: String(url), method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal };
    calls.push(call);
    return handler(call, calls.length);
  };
  impl.calls = calls;
  return impl;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Shaped like OpenRouter's `GET /api/v1/models` (27.10.2026); prices in dollars per token, as strings. */
const CATALOG = {
  data: [
    {
      id: "anthropic/claude-haiku-5.5",
      canonical_slug: "anthropic/claude-haiku-5.5-20261001",
      name: "Anthropic: Haiku 5.5",
      context_length: 200000,
      pricing: { prompt: "0.000001", completion: "0.000005", request: "0", internal_reasoning: "0", input_cache_read: "0.0000001" },
      top_provider: { context_length: 200000, max_completion_tokens: 64000, is_moderated: true },
      supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs", "tool_choice", "tools"],
      reasoning: { mandatory: false, supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"], default_effort: "medium" },
    },
    { id: "openrouter/auto", name: "Auto Router", context_length: 2000000, pricing: { prompt: "-1", completion: "-1" }, supported_parameters: ["tools"] },
    { id: "meta/llama-5-8b:free", name: "Llama 5 8B (free)", context_length: 131072, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["max_tokens"] },
    { id: "acme/no-price", name: "No price", context_length: 8192 },
    { id: "anthropic/claude-haiku-5.5", name: "a duplicate is dropped", pricing: { prompt: "1", completion: "1" } },
    { name: "no id" },
    "not an object",
  ],
};

/** Shaped like `GET /api/v1/models/{id}/endpoints` (27.10.2026). */
const ENDPOINTS = {
  data: {
    id: "google/gemini-3.8-flash",
    name: "Google: Gemini 3.8 Flash",
    endpoints: [
      {
        name: "Google AI Studio | google/gemini-3.8-flash",
        tag: "google-ai-studio",
        provider_name: "Google AI Studio",
        service_tier: null,
        context_length: 1048576,
        max_completion_tokens: 65536,
        pricing: {
          prompt: "0.00000125",
          completion: "0.00001",
          internal_reasoning: "0.00001",
          input_cache_read: "0.000000125",
          discount: 0,
          overrides: [{ min_prompt_tokens: 200000, prompt: "0.0000025", completion: "0.000015", input_cache_read: "0.00000025" }],
        },
        supported_parameters: ["reasoning", "include_reasoning", "structured_outputs", "response_format", "max_tokens", "tools", "tool_choice"],
        status: 0,
      },
      {
        tag: "google-ai-studio/flex",
        provider_name: "Google AI Studio",
        service_tier: "flex",
        context_length: 1048576,
        max_completion_tokens: 65536,
        pricing: { prompt: "0.000000625", completion: "0.000005" },
        supported_parameters: ["max_tokens", "tools"],
      },
      { tag: "bad slug", provider_name: "dropped" },
    ],
  },
};

const PROVIDERS = {
  data: [
    { name: "Google", slug: "google-vertex", privacy_policy_url: null, headquarters: "US", datacenters: ["US"] },
    { name: "Google AI Studio", slug: "google-ai-studio" },
    { name: "Moonshot AI", slug: "moonshotai" },
    { name: "InferenceNet", slug: "inference-net" },
    { name: "no slug" },
  ],
};

test("a price per token reads as dollars per 1M tokens exactly; anything unknown is null, a free model's zero is zero", () => {
  assert.equal(perMillion("0.000003"), 3);
  assert.equal(perMillion("0.0000025"), 2.5);
  assert.equal(perMillion("0.00000015"), 0.15);
  assert.equal(perMillion("0.000015"), 15);
  assert.equal(perMillion("1.5e-6"), 1.5);
  assert.equal(perMillion(3e-7), 0.3);
  assert.equal(perMillion("0"), 0);
  assert.equal(perMillion("-1"), null, "the routers' -1 is no price");
  for (const unknown of ["", "abc", "1,5", undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}]) assert.equal(perMillion(unknown), null);
});

test("the catalog body: id, prices per 1M, context, tools and structured outputs; aliases listed but not pinnable", () => {
  const models = parseCatalog(CATALOG);
  assert.deepEqual(models.map((model) => model.id), ["anthropic/claude-haiku-5.5", "openrouter/auto", "meta/llama-5-8b:free", "acme/no-price"]);
  const [haiku, auto, free, unpriced] = models;
  assert.deepEqual(haiku, {
    id: "anthropic/claude-haiku-5.5",
    canonicalSlug: "anthropic/claude-haiku-5.5-20261001",
    name: "Anthropic: Haiku 5.5",
    contextLength: 200000,
    maxOutputTokens: 64000,
    prices: { inputPerMillionUsd: 1, outputPerMillionUsd: 5, reasoningPerMillionUsd: 0, cacheReadPerMillionUsd: 0.1, overrides: [] },
    tools: true,
    structuredOutputs: true,
    reasoning: true,
    reasoningMandatory: false,
    reasoningEfforts: ["max", "xhigh", "high", "medium", "low", "none"],
    pinnable: true,
  });
  assert.equal(auto.pinnable, false, "a router picks the model for us");
  assert.equal(auto.prices.inputPerMillionUsd, null);
  assert.equal(free.pinnable, true, "a free variant is a fixed model");
  assert.deepEqual([free.prices.inputPerMillionUsd, free.prices.outputPerMillionUsd, free.tools, free.structuredOutputs, free.reasoningMandatory, free.reasoningEfforts], [0, 0, false, false, false, []]);
  assert.deepEqual(unpriced.prices, { inputPerMillionUsd: null, outputPerMillionUsd: null, reasoningPerMillionUsd: null, cacheReadPerMillionUsd: null, overrides: [] });
  assert.equal(parseCatalogModel({ id: "x".repeat(161) }), null);
  assert.throws(() => parseCatalog({ models: [] }), (error) => error instanceof ModelGatewayError && error.kind === "invalid_response", "a body without the list is never an empty catalog");
});

test("an estimate in micro-dollars from the catalog's prices, rounded up; unknown price — null, not zero", () => {
  const [haiku, auto, free] = parseCatalog(CATALOG);
  assert.equal(estimateCostMicroUsd(haiku, { input: 2_000, output: 500 }), 4_500, "2 000 × $1/M + 500 × $5/M = $0.0045");
  assert.equal(estimateCostMicroUsd({ ...haiku, prices: { ...haiku.prices, inputPerMillionUsd: 0.25 } }, { input: 3, output: 0 }), 1, "0.75 micro-dollars rounds up to 1");
  assert.equal(estimateCostMicroUsd(auto, { input: 1, output: 1 }), null);
  assert.equal(estimateCostMicroUsd(free, { input: 10_000, output: 10_000 }), 0);
});

test("the catalog is read without a key, kept for its time, shared by readers at the same moment, refetched after", async () => {
  let now = Date.parse("2026-10-27T18:19:00.000Z");
  const fetch = forge(() => json(200, CATALOG));
  const catalog = createModelCatalog({ fetch, now: () => now, ttlMs: 60_000 });
  assert.equal(catalog.peek("anthropic/claude-haiku-5.5"), null, "nothing is cached before the first read");
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(fetch.calls.length, 1, "two readers at once share one request");
  assert.equal(first, second);
  assert.deepEqual({ url: fetch.calls[0].url, method: fetch.calls[0].method }, { url: CATALOG_URL, method: "GET" });
  assert.equal(fetch.calls[0].headers.authorization, undefined, "the catalog is public: no key goes with it");
  assert.equal(first.stale, false);
  assert.equal(first.readAt, "2026-10-27T18:19:00.000Z");
  now += 59_000;
  assert.equal((await catalog.get("anthropic/claude-haiku-5.5"))?.prices.outputPerMillionUsd, 5);
  assert.equal(await catalog.get("nobody/none"), null);
  assert.equal(fetch.calls.length, 1, "fresh for its time");
  assert.equal(catalog.peek("meta/llama-5-8b:free")?.id, "meta/llama-5-8b:free");
  now += 2_000;
  await catalog.list();
  assert.equal(fetch.calls.length, 2, "read again once its time is up");
});

test("OpenRouter down: a copy younger than a day is served marked stale; older or none — the error", async () => {
  let now = Date.parse("2026-10-27T18:19:00.000Z");
  let up = true;
  const fetch = forge(() => (up ? json(200, CATALOG) : json(503, { error: { code: 503, message: "upstream down" } })));
  const catalog = createModelCatalog({ fetch, now: () => now, ttlMs: 60_000, maxStaleMs: 3_600_000 });
  await catalog.list();
  up = false;
  now += 120_000;
  const stale = await catalog.list();
  assert.equal(stale.stale, true);
  assert.equal(stale.readAt, "2026-10-27T18:19:00.000Z", "the copy says when it was read");
  assert.equal(stale.models.length, 4);
  now += 3_600_000;
  await assert.rejects(catalog.list(), (error) => error instanceof ModelGatewayError && error.kind === "provider_unavailable" && error.status === 503);

  const never = createModelCatalog({ fetch: forge(() => json(200, { nope: true })), now: () => now });
  await assert.rejects(never.list(), (error) => error instanceof ModelGatewayError && error.kind === "invalid_response");
  const unreachable = createModelCatalog({
    fetch: forge(() => {
      throw new TypeError("fetch failed");
    }),
    now: () => now,
  });
  await assert.rejects(unreachable.list(), (error) => error instanceof ModelGatewayError && error.kind === "network" && error.retryable);
  const html = createModelCatalog({ fetch: forge(() => new Response("<html>", { status: 200 })), now: () => now });
  await assert.rejects(html.list(), (error) => error instanceof ModelGatewayError && error.kind === "invalid_response");
});

test("not pinnable: anything priced below zero (a router under any name), an alias with a target; thinking that cannot be turned off is read", () => {
  const switchyard = parseCatalogModel({ id: "nvidia/switchyard", pricing: { prompt: "-1", completion: "-1" }, supported_parameters: ["tools"] });
  assert.equal(switchyard.pinnable, false, "nvidia/switchyard is not named like a router, but it is priced like one");
  assert.equal(parseCatalogModel({ id: "acme/odd-1", pricing: { prompt: "0.000001", completion: "0.000002", request: "-1" } }).pinnable, false, "a negative price anywhere");
  assert.equal(parseCatalogModel({ id: "deepseek/deepseek-flash-now", pricing: { prompt: "0.0000001", completion: "0.0000002" }, alias_target: { name: "DeepSeek", slug: "deepseek/deepseek-v4.1-flash-1017" } }).pinnable, false);
  assert.equal(parseCatalogModel({ id: "acme/fine-1", pricing: { prompt: "0", completion: "0", discount: 0 } }).pinnable, true);
  const always = parseCatalogModel({ id: "anthropic/claude-sonnet-5.5", reasoning: { mandatory: true, supported_efforts: ["max", "high", "low"] } });
  assert.deepEqual([always.reasoningMandatory, always.reasoningEfforts], [true, ["max", "high", "low"]]);
  assert.deepEqual([parseCatalogModel({ id: "acme/x-1", reasoning: { mandatory: "yes", supported_efforts: "none" } }).reasoningMandatory, parseCatalogModel({ id: "acme/x-1", reasoning: { mandatory: "yes", supported_efforts: "none" } }).reasoningEfforts], [false, []]);
});

test("prices above a prompt size: overrides read with the base price for what they leave out; the estimate takes the prompt's tier; several endpoints — the highest at every size", () => {
  const prices = parsePrices(ENDPOINTS.data.endpoints[0].pricing);
  assert.deepEqual(prices, {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
    reasoningPerMillionUsd: 10,
    cacheReadPerMillionUsd: 0.125,
    overrides: [{ minPromptTokens: 200000, inputPerMillionUsd: 2.5, outputPerMillionUsd: 15, reasoningPerMillionUsd: 10, cacheReadPerMillionUsd: 0.25 }],
  });
  assert.equal(estimateCostMicroUsd({ prices }, { input: 199_999, output: 1_000 }), 259_999, "199 999 × $1.25/M + 1 000 × $10/M, rounded up");
  assert.equal(estimateCostMicroUsd({ prices }, { input: 200_000, output: 1_000 }), 515_000, "from 200 000 prompt tokens: $2.5/M and $15/M on the whole call");
  assert.deepEqual(parsePrices({ prompt: "0.000001", completion: "0.000002", overrides: [{ prompt: "0.000003" }, { min_prompt_tokens: 0, prompt: "1" }, "x"] }).overrides, [], "an override without a threshold above 0 is no tier");
  assert.equal(parsePrices({ prompt: "0.000001", completion: "0.000002", overrides: [{ min_prompt_tokens: 1000, completion: "-1" }] }).overrides[0].outputPerMillionUsd, null, "an override's unknown price is unknown, not the base");

  const flat = parsePrices({ prompt: "0.000002", completion: "0.000008" });
  const merged = highestPrices([{ prices }, { prices: flat }]);
  assert.deepEqual([merged.inputPerMillionUsd, merged.outputPerMillionUsd], [2, 10]);
  assert.deepEqual(merged.overrides.map((tier) => [tier.minPromptTokens, tier.inputPerMillionUsd, tier.outputPerMillionUsd]), [[200000, 2.5, 15]]);
  assert.equal(highestPrices([{ prices }, { prices: parsePrices({ prompt: "0.000001" }) }]).outputPerMillionUsd, null, "one endpoint's unknown price makes the pin's unknown");
  assert.equal(highestPrices([]).inputPerMillionUsd, null, "no endpoint — no price");
});

test("a model's endpoints: read without a key under its id, each with its tag, tier, prices and parameters; cached; an unknown model is not_found, not retried", async () => {
  let now = Date.parse("2026-10-27T18:19:00.000Z");
  const fetch = forge((call) => {
    if (call.url === `${CATALOG_URL}/google/gemini-3.8-flash/endpoints`) return json(200, ENDPOINTS);
    if (call.url === `${CATALOG_URL}/anthropic/claude-haiku-5.5%3Abatch/endpoints`) return json(200, { data: { id: "anthropic/claude-haiku-5.5:batch", endpoints: [] } });
    return json(404, { error: { message: "Not Found", code: 404 } });
  });
  const catalog = createModelCatalog({ fetch, now: () => now, ttlMs: 60_000 });
  const [first, second] = await Promise.all([catalog.endpoints("google/gemini-3.8-flash"), catalog.endpoints("google/gemini-3.8-flash")]);
  assert.equal(fetch.calls.length, 1, "two readers at once share one request");
  assert.equal(first, second);
  assert.equal(fetch.calls[0].headers.authorization, undefined, "public: no key goes with it");
  assert.deepEqual(
    first.endpoints.map((endpoint) => [endpoint.tag, endpoint.providerName, endpoint.serviceTier, endpoint.maxOutputTokens, endpoint.tools, endpoint.structuredOutputs, endpoint.reasoning]),
    [
      ["google-ai-studio", "Google AI Studio", null, 65536, true, true, true],
      ["google-ai-studio/flex", "Google AI Studio", "flex", 65536, true, false, false],
    ],
    "an endpoint without a usable tag is dropped",
  );
  assert.equal(first.endpoints[0].prices.overrides[0].minPromptTokens, 200000);
  assert.deepEqual({ modelId: first.modelId, readAt: first.readAt, stale: first.stale }, { modelId: "google/gemini-3.8-flash", readAt: "2026-10-27T18:19:00.000Z", stale: false });
  now += 30_000;
  await catalog.endpoints("google/gemini-3.8-flash");
  assert.equal(fetch.calls.length, 1, "fresh for its time");

  assert.deepEqual((await catalog.endpoints("anthropic/claude-haiku-5.5:batch")).endpoints, [], "a variant's colon is sent encoded inside its segment");
  await assert.rejects(catalog.endpoints("acme/none-1"), (error) => error instanceof ModelGatewayError && error.kind === "not_found" && error.retryable === false);
  await assert.rejects(catalog.endpoints("not a model id"), (error) => error.kind === "invalid_request");
  assert.equal(fetch.calls.length, 3, "a malformed id is never sent");
  assert.throws(() => parseEndpoints({ data: { id: "x/y" } }), (error) => error.kind === "invalid_response", "a body without the list is never «no endpoints»");

  let up = true;
  const flaky = createModelCatalog({ fetch: forge(() => (up ? json(200, ENDPOINTS) : json(503, {}))), now: () => now, ttlMs: 1_000 });
  await flaky.endpoints("google/gemini-3.8-flash");
  up = false;
  now += 5_000;
  assert.equal((await flaky.endpoints("google/gemini-3.8-flash")).stale, true, "OpenRouter down: the last copy, marked");
});

test("providers: OpenRouter's own names and slugs, read without a key, cached — the only way a response's provider name becomes a slug", async () => {
  const slugs = parseProviders(PROVIDERS);
  assert.equal(slugs.get("Google"), "google-vertex", "a display name folded by hand would say «google»");
  assert.equal(slugs.get("Moonshot AI"), "moonshotai");
  assert.equal(slugs.get("InferenceNet"), "inference-net");
  assert.equal(slugs.has("no slug"), false);
  assert.throws(() => parseProviders({ providers: [] }), (error) => error.kind === "invalid_response");

  const fetch = forge(() => json(200, PROVIDERS));
  const catalog = createModelCatalog({ fetch });
  const [first] = await Promise.all([catalog.providers(), catalog.providers()]);
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual({ url: fetch.calls[0].url, auth: fetch.calls[0].headers.authorization }, { url: PROVIDERS_URL, auth: undefined });
  assert.equal(first.slugByName.get("Google AI Studio"), "google-ai-studio");
  await catalog.providers();
  assert.equal(fetch.calls.length, 1, "cached with the catalog");
});
