// Run from repo root: node --test lib/agent/model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { composeDeterministic } from "./answer.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "./fixtures.ts";
import { parseIntent } from "./intent.ts";
import { createFixtureAgentModel, createOpenAiAgentModel, OPENAI_AGENT_MODEL_DEFAULT } from "./model.ts";
import { CitationBook } from "./provenance.ts";
import { runTool } from "./tools/registry.ts";

/**
 * The model client on a fake provider: no paid call is made here or
 * anywhere in the suite. What is proved: the provider's refusal, an output
 * outside the schema, a timeout, a rate limit and a quota come back as
 * outcomes the receipt records and the service falls back on; `reached`
 * says whether the reservation is refunded; the model name is the
 * deployment's configuration with the documented default.
 */

async function packet() {
  const world = await createFixtureWorld();
  const ctx = { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: world.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000001" };
  const run = await runTool("market_read", { query: "SOL" }, ctx);
  return { intent: parseIntent("Why is SOL moving?", null), personText: "Why is SOL moving?", runs: [run], citations: ctx.citations, locale: "en" };
}

const clientOf = (behaviour) => ({ responses: { parse: behaviour } });

test("the model name is the deployment's configuration, with the documented default", () => {
  assert.equal(createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: clientOf(async () => ({ output_parsed: null })) }).name, OPENAI_AGENT_MODEL_DEFAULT);
  assert.equal(createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test", OPENAI_AGENT_MODEL: "gpt-owner-named" }, client: clientOf(async () => ({ output_parsed: null })) }).name, "gpt-owner-named");
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
  assert.deepEqual(r.usage, { input: 120, output: 80, total: 200 });
  assert.equal(r.responseId, "resp_x");
  const fixture = await createFixtureAgentModel().compose(p, "digest");
  assert.ok(fixture.ok && fixture.usage.total > 0);
  const failing = await createFixtureAgentModel({ fail: "timeout" }).compose(p, "digest");
  assert.deepEqual([failing.ok, failing.outcome], [false, "timeout"]);
});
