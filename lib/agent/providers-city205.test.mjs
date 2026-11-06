// Run from repo root: node --test lib/agent/providers-city205.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentAnswerSchema } from "../api/v1/contract.ts";
import { assistantProviderOf, costMicroUsd, modelFor, priceOf, providerPrices, setProviderPrices, usageFromResponse } from "../assistant/models.ts";
import { resolveAgentBudgetConfig } from "./budget.ts";
import { composeDeterministic } from "./answer.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "./fixtures.ts";
import { parseIntent } from "./intent.ts";
import { CitationBook } from "./provenance.ts";
import { anthropicResponsesClient, anthropicSchema, createProviderAgentModel, openRouterResponsesClient } from "./providers.ts";
import { runTool } from "./tools/registry.ts";

/**
 * CITY-205: the consultant's words from OpenAI, Anthropic, or any model through OpenRouter — one switch of the
 * deployment, one shape for the assistant. Another provider's models and prices are the deployment's to name, never the
 * code's. No paid call is made here: each provider is a fake that records what it was sent and answers as it would.
 */

/** Another provider's models stand here for whatever the operator sets. */
const A_L1 = "a-everyday-model";
const A_L2 = "a-strong-model";
const ANTHROPIC = { RYNTRA_ASSISTANT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-test-key", ANTHROPIC_ASSISTANT_MODEL_L1: A_L1, ANTHROPIC_ASSISTANT_MODEL_L2: A_L2 };
const R_L1 = "vendor/everyday-model";
const ROUTER = { RYNTRA_ASSISTANT_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-test-key", OPENROUTER_ASSISTANT_MODEL_L1: R_L1, OPENROUTER_ASSISTANT_MODEL_L2: "vendor/strong-model" };

async function packet() {
  const world = await createFixtureWorld();
  const ctx = { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: world.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000001" };
  const run = await runTool("market_read", { query: "SOL" }, ctx);
  return { intent: parseIntent("Why is SOL moving?", null), personText: "Why is SOL moving?", runs: [run], citations: ctx.citations, locale: "en" };
}

test("the provider is the one named only with its key and both its models; OpenAI otherwise", () => {
  assert.equal(assistantProviderOf({}), "openai");
  assert.equal(assistantProviderOf({ ...ANTHROPIC, ANTHROPIC_API_KEY: "" }), "openai", "no key — OpenAI keeps answering");
  assert.equal(assistantProviderOf({ ...ANTHROPIC, ANTHROPIC_ASSISTANT_MODEL_L2: "" }), "openai", "a model unnamed — OpenAI keeps answering");
  assert.equal(assistantProviderOf(ANTHROPIC), "anthropic");
  assert.equal(assistantProviderOf({ ...ROUTER, RYNTRA_ASSISTANT_PROVIDER: " OpenRouter " }), "openrouter");
  assert.equal(assistantProviderOf({ ...ROUTER, RYNTRA_ASSISTANT_PROVIDER: "gemini" }), "openai");

  assert.equal(modelFor("answer", ANTHROPIC).name, A_L1);
  assert.equal(modelFor("critic", ANTHROPIC).name, A_L2);
  assert.equal(modelFor("answer", ROUTER).name, R_L1);
  assert.equal(modelFor("answer", { ...ROUTER, OPENROUTER_ASSISTANT_MODEL_L1: "a/b/c; drop" }).name, "gpt-6-luna", "a name that is not a model's is never sent");
  // The OpenAI default and its own variables are untouched.
  assert.equal(modelFor("answer", {}).name, "gpt-6-luna");
  assert.equal(modelFor("answer", { ...ANTHROPIC, OPENAI_ASSISTANT_MODEL_L1: "gpt-x" }, "openai").name, "gpt-x");
});

test("the model is switched on by the key of the provider that answers", () => {
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_MODEL_ENABLED: "1", OPENAI_API_KEY: "sk-test" }).modelEnabled, true);
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_MODEL_ENABLED: "1", ...ANTHROPIC }).modelEnabled, true);
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_MODEL_ENABLED: "1" }).modelEnabled, false);
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_MODEL_ENABLED: "0", ...ANTHROPIC }).modelEnabled, false);
});

test("another provider's calls are priced from the deployment's figures, and stay unpriced without them — never zero", () => {
  assert.deepEqual(priceOf("0.1/0.01/0.5"), { input: 0.1, cached: 0.01, output: 0.5 });
  for (const bad of [undefined, "", "0.1/0.5", "a/b/c", "-1/0/0"]) assert.equal(priceOf(bad), null, String(bad));
  const usage = { input: 3_000, cached: 0, output: 600, reasoning: 0, total: 3_600 };
  setProviderPrices({});
  assert.equal(costMicroUsd(A_L1, usage), null);
  const env = { ...ANTHROPIC, ANTHROPIC_ASSISTANT_PRICE_L1: "0.1/0.01/0.5", ANTHROPIC_ASSISTANT_PRICE_L2: "2/0.2/10" };
  assert.deepEqual(Object.keys(providerPrices(env)).sort(), [A_L2, A_L1].sort());
  setProviderPrices(providerPrices(env));
  assert.equal(costMicroUsd(A_L1, usage), 600); // 3000 × $0.10 + 600 × $0.50 per 1M = $0.0006
  assert.equal(costMicroUsd(A_L2, usage), 12_000);
  // OpenAI's own table is never overwritten by a deployment's figures.
  setProviderPrices({ "gpt-6-luna": { input: 99, cached: 99, output: 99 } });
  assert.equal(costMicroUsd("gpt-6-luna", usage), 600);
  setProviderPrices({});
});

test("the schema for Anthropic keeps its shape and drops only the constraints its structured output does not hold", () => {
  const schema = { type: "object", additionalProperties: false, required: ["a", "format"], properties: { a: { type: "string", maxLength: 40, minLength: 1 }, format: { type: "array", maxItems: 3, items: { type: "number", minimum: 0 } } } };
  assert.deepEqual(anthropicSchema(schema), { type: "object", additionalProperties: false, required: ["a", "format"], properties: { a: { type: "string" }, format: { type: "array", items: { type: "number" } } } });
});

test("Anthropic: one message with the instructions as the system, the schema as the output format, effort low; usage in the assistant's figures", async () => {
  const p = await packet();
  const sent = [];
  const answer = composeDeterministic(p);
  const fake = {
    messages: {
      async create(body, options) {
        sent.push({ body, options });
        return { id: "msg_1", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 2_000, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 400 } };
      },
    },
  };
  const model = createProviderAgentModel({ env: ANTHROPIC, client: anthropicResponsesClient({ client: fake }) });
  assert.equal(model.name, A_L1);
  const result = await model.compose(p, "safety-x");
  assert.equal(result.ok, true);
  assert.equal(AgentAnswerSchema.safeParse(result.answer).success, true);
  assert.deepEqual(result.usage, { input: 2_500, cached: 500, output: 400, reasoning: 0, total: 2_900 });
  const { body, options } = sent[0];
  assert.equal(body.model, A_L1);
  assert.equal(typeof body.system, "string");
  assert.match(body.system, /You are Ryntra/);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.metadata.user_id, "safety-x");
  assert.equal(options.maxRetries, 0);
  for (const key of ["temperature", "top_p", "top_k", "thinking", "store", "prompt_cache_key"]) assert.equal(key in body, false, `${key} is not sent`);
});

test("Anthropic: a refusal, an answer cut at the ceiling and a rate limit come back as the assistant's outcomes", async () => {
  const p = await packet();
  const with_ = (create) => createProviderAgentModel({ env: ANTHROPIC, client: anthropicResponsesClient({ client: { messages: { create } } }) });
  const refused = await with_(async () => ({ id: "m", stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 0 } })).compose(p, "x");
  assert.deepEqual([refused.ok, refused.outcome], [false, "refused"]);
  const cut = await with_(async () => ({ id: "m", stop_reason: "max_tokens", content: [{ type: "text", text: '{"observation":' }], usage: { input_tokens: 10, output_tokens: 1800 } })).compose(p, "x");
  assert.deepEqual([cut.ok, cut.outcome, cut.reached], [false, "invalid-output", true]);
  const limited = await with_(async () => { throw Object.assign(new Error("429"), { name: "RateLimitError", status: 429 }); }).compose(p, "x");
  assert.deepEqual([limited.ok, limited.outcome], [false, "rate-limited"]);
});

test("OpenRouter: one pinned chat completion with a strict schema, no fallbacks, no data collection, no attribution", async () => {
  const p = await packet();
  const calls = [];
  const answer = composeDeterministic(p);
  const fetchFake = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "gen-1", choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 1_800, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 0 } } }), { status: 200 });
  };
  const model = createProviderAgentModel({ env: ROUTER, client: openRouterResponsesClient({ apiKey: "sk-or-test-key", fetch: fetchFake }) });
  const result = await model.compose(p, "safety-y");
  assert.equal(result.ok, true);
  assert.equal(result.model, R_L1);
  assert.deepEqual(result.usage, usageFromResponse({ input_tokens: 1_800, output_tokens: 300, input_tokens_details: { cached_tokens: 0 } }));
  const { url, init, body } = calls[0];
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(init.headers.authorization, "Bearer sk-or-test-key");
  assert.equal("HTTP-Referer" in init.headers || "X-Title" in init.headers, false);
  assert.equal(body.model, R_L1);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true, data_collection: "deny" });
  assert.equal("models" in body, false);
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"]);

  const broke = createProviderAgentModel({ env: ROUTER, client: openRouterResponsesClient({ apiKey: "k", fetch: async () => new Response(JSON.stringify({ error: { code: 402, message: "credits" } }), { status: 402 }) }) });
  const out = await broke.compose(p, "x");
  assert.deepEqual([out.ok, out.outcome], [false, "quota"]);
});

test("a provider named without its key answers on OpenAI, and nothing at all without any key", () => {
  assert.equal(createProviderAgentModel({ env: { ...ANTHROPIC, ANTHROPIC_API_KEY: "" } }), null);
  const model = createProviderAgentModel({ env: { ...ANTHROPIC, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "sk-test" } });
  assert.equal(model.name, "gpt-6-luna");
});
