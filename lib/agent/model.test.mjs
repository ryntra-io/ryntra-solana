// Run from repo root: node --test lib/agent/model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { composeDeterministic } from "./answer.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "./fixtures.ts";
import { parseIntent } from "./intent.ts";
import { createFixtureAgentModel, createOpenAiAgentModel, ModelIntentSchema } from "./model.ts";
import { CitationBook } from "./provenance.ts";
import { runTool } from "./tools/registry.ts";

/**
 * The model client on a fake provider: no paid call is made here or
 * anywhere in the suite. What is proved: the provider's refusal, an output
 * outside the schema, a timeout, a rate limit and a quota come back as
 * outcomes the receipt records and the service falls back on; `reached`
 * says whether the reservation is refunded; the models are the deployment's
 * configuration per class with the documented defaults (AI-02).
 */

async function packet() {
  const world = await createFixtureWorld();
  const ctx = { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: world.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000001" };
  const run = await runTool("market_read", { query: "SOL" }, ctx);
  return { intent: parseIntent("Why is SOL moving?", null), personText: "Why is SOL moving?", runs: [run], citations: ctx.citations, locale: "en" };
}

const clientOf = (behaviour) => ({ responses: { parse: behaviour } });

test("the models are chosen by class: L1 for the answer, the intent and the Brief, L2 for the Critic; the legacy single model is not read", () => {
  const plain = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => ({ output_parsed: null })) });
  assert.equal(plain.name, "gpt-6-luna");
  /* AI-09: the news labeller is the everyday class too; AI-10: so is «Ранковий огляд»; AI-06c: and a talk. */
  assert.deepEqual(plain.models, { intent: "gpt-6-luna", answer: "gpt-6-luna", brief: "gpt-6-luna", critic: "gpt-6.1-sol", news_tag: "gpt-6-luna", morning_brief: "gpt-6-luna", talk: "gpt-6-luna", talk_check: "gpt-6-luna" });
  const legacy = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test", OPENAI_AGENT_MODEL: "gpt-5.6-sol" }, client: clientOf(async () => ({ output_parsed: null })) });
  assert.equal(legacy.name, "gpt-6-luna", "the deployment's old OPENAI_AGENT_MODEL no longer decides the everyday answer");
  const named = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test", OPENAI_ASSISTANT_MODEL_L1: "gpt-owner-l1", OPENAI_ASSISTANT_MODEL_L2: "gpt-owner-l2" }, client: clientOf(async () => ({ output_parsed: null })) });
  assert.deepEqual(named.models, { intent: "gpt-owner-l1", answer: "gpt-owner-l1", brief: "gpt-owner-l1", critic: "gpt-owner-l2", news_tag: "gpt-owner-l1", morning_brief: "gpt-owner-l1", talk: "gpt-owner-l1", talk_check: "gpt-owner-l1" });
  const odd = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test", OPENAI_ASSISTANT_MODEL_L1: "gpt with spaces; drop" }, client: clientOf(async () => ({ output_parsed: null })) });
  assert.equal(odd.name, "gpt-6-luna", "a name that is not a model name falls back to the class default");
});

test("every call carries the cached prefix's key, no storage, no retries; the static instructions come first and the person's words last", async () => {
  const p = await packet();
  const seen = [];
  const client = clientOf(async (body, options) => {
    seen.push({ body, options });
    return { id: "resp_1", output_parsed: body.text.format.name === "ryntra_intent_v1" ? { class: "market", symbols: ["SOL"] } : composeDeterministic(p), usage: { input_tokens: 1400, output_tokens: 300, total_tokens: 1700, input_tokens_details: { cached_tokens: 1024 }, output_tokens_details: { reasoning_tokens: 120 } } };
  });
  const model = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client });
  const answer = await model.compose(p, "digest");
  const intent = await model.composeIntent({ text: "sol price now", locale: "en", contextKind: null }, "digest");
  assert.ok(answer.ok && intent.ok);
  assert.deepEqual(answer.usage, { input: 1400, cached: 1024, output: 300, reasoning: 120, total: 1700 });
  assert.equal(answer.model, "gpt-6-luna");
  assert.deepEqual(intent.intent, { class: "market", symbols: ["SOL"] });
  const [first, second] = seen;
  assert.equal(first.body.prompt_cache_key, "ryntra-answer-ryntra-text-v6");
  assert.equal(second.body.prompt_cache_key, "ryntra-intent-ryntra-intent-v1");
  for (const call of seen) {
    assert.equal(call.body.store, false);
    assert.equal(call.options.maxRetries, 0);
    assert.equal(call.body.safety_identifier, "digest");
  }
  /* The instructions are the same bytes for every question: nothing of the packet is interpolated into them. */
  const other = await packet();
  const again = [];
  await createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async (body) => { again.push(body); return { output_parsed: composeDeterministic(other) }; }) }).compose({ ...other, personText: "Something else entirely", locale: "uk" }, "x");
  assert.equal(again[0].instructions, first.body.instructions);
  /* The provider caches a prefix of 1,024 tokens and more: the instructions and the schema together pass it (measured: the cached share in AI-02's run). */
  assert.ok(first.body.instructions.length + JSON.stringify(first.body.text.format).length > 5_000, "the static prefix is long enough for the provider to cache");
  const keys = Object.keys(JSON.parse(first.body.input));
  assert.equal(keys.at(-1), "question", "the person's words come last");
});

test("the intent's schema admits a research class and symbols only — never a preparation, an execution, a secret or a tool", () => {
  for (const klass of ["execute", "secret", "prepare_trade", "prepare_plan", "prepare_monitoring", "plan", "results", "monitoring"]) {
    assert.equal(ModelIntentSchema.safeParse({ class: klass, symbols: [] }).success, false, klass);
  }
  assert.equal(ModelIntentSchema.safeParse({ class: "market", symbols: ["SOL"], tool: "sign_and_send" }).success, false, "no other field");
  assert.equal(ModelIntentSchema.safeParse({ class: "market", symbols: ["A", "B", "C", "D", "E"] }).success, false, "at most four symbols");
});

test("a refusal, an output outside the schema and the provider's failures are outcomes, never throws", async () => {
  const p = await packet();
  const refused = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => ({ output_parsed: null, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })) });
  const r1 = await refused.compose(p, "digest");
  assert.deepEqual([r1.ok, r1.outcome, r1.reached], [false, "refused", true]);
  const invalid = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => ({ output_parsed: { observation: "not a list" } })) });
  const r2 = await invalid.compose(p, "digest");
  assert.deepEqual([r2.ok, r2.outcome], [false, "invalid-output"]);
  const timeout = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => { throw Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" }); }) });
  const r3 = await timeout.compose(p, "digest");
  assert.deepEqual([r3.ok, r3.outcome, r3.reached], [false, "timeout", true]);
  const limited = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => { throw Object.assign(new Error("429"), { status: 429 }); }) });
  assert.equal((await limited.compose(p, "digest")).outcome, "rate-limited");
  const quota = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => { throw Object.assign(new Error("quota"), { code: "insufficient_quota" }); }) });
  assert.equal((await quota.compose(p, "digest")).outcome, "quota");
  const down = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => { throw new Error("ECONNREFUSED"); }) });
  const r6 = await down.compose(p, "digest");
  assert.deepEqual([r6.outcome, r6.reached], ["unavailable", false], "a provider never reached is refunded");
});

test("a good answer is returned with the provider's usage, and the fixture model behaves like one", async () => {
  const p = await packet();
  const answer = composeDeterministic(p);
  const good = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => ({ id: "resp_x", output_parsed: answer, usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } })) });
  const r = await good.compose(p, "digest");
  assert.ok(r.ok);
  assert.deepEqual(r.usage, { input: 120, cached: 0, output: 80, reasoning: 0, total: 200 });
  assert.equal(r.responseId, "resp_x");
  const fixture = await createFixtureAgentModel().compose(p, "digest");
  assert.ok(fixture.ok && fixture.usage.total > 0);
  const failing = await createFixtureAgentModel({ fail: "timeout" }).compose(p, "digest");
  assert.deepEqual([failing.ok, failing.outcome], [false, "timeout"]);
});
