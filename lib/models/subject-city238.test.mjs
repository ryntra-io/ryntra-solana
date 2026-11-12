// Run from repo root: node --test lib/models/subject-city238.test.mjs
/*
 * CITY-238: who a model call is for. One list — a Vault's guard, a Ring's agent, an Arena agent on a Hack order — read
 * by the call, its journal and the key manager; a Hack agent's calls are journaled under their own subject, on the
 * agent's own key.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const { SUBJECT_KINDS, readSubject, badSubject } = await import("./subject.ts");
const { createModelGateway, CHAT_URL } = await import("./call.ts");
const { createModelCatalog } = await import("./catalog.ts");
const { keyName } = await import("./keys.ts");
const { stubCatalogFetch } = await import("../ring/stub-catalog.ts");

test("the subjects are one list, and a subject reads only as one of them with a safe id", () => {
  assert.deepEqual([...SUBJECT_KINDS], ["vault-guard", "ring-agent", "hack-agent"]);
  for (const kind of SUBJECT_KINDS) assert.deepEqual(readSubject({ kind, id: "agent-42", extra: "dropped" }), { kind, id: "agent-42" });
  for (const bad of [null, undefined, "hack-agent", {}, { kind: "hack-agent" }, { kind: "hack-agent", id: "has spaces" }, { kind: "hack-agent", id: "" }, { kind: "hack-agent", id: "x".repeat(65) }, { kind: "wallet", id: "agent-42" }, { kind: "HACK-AGENT", id: "agent-42" }]) {
    assert.equal(readSubject(bad), null, JSON.stringify(bad));
  }
  assert.equal(badSubject().kind, "invalid_request");
  assert.match(badSubject().message, /"vault-guard" \| "ring-agent" \| "hack-agent"/);
  assert.equal(keyName({ kind: "hack-agent", id: "agent-42" }), "ryntra:hack-agent:agent-42");
});

test("a Hack agent's call goes through the gateway and is journaled under hack-agent, on the agent's own key", async () => {
  const records = [];
  const sent = [];
  const key = `sk-or-${"v1"}-${randomBytes(32).toString("hex")}`;
  const fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== CHAT_URL) return stubCatalogFetch(input, init);
    sent.push({ authorization: new Headers(init.headers).get("authorization"), body: JSON.parse(init.body) });
    return Response.json({
      id: "gen-1",
      provider: "Anthropic",
      model: "anthropic/claude-haiku-5.5",
      choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read_account", arguments: '{"address":"x"}' } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0002 },
    });
  };
  const gateway = createModelGateway({ env: {}, fetch, catalog: createModelCatalog({ fetch: stubCatalogFetch }), journal: (record) => void records.push(record) });
  const ask = (subject) =>
    gateway.call({
      subject,
      model: { id: "anthropic/claude-haiku-5.5", providers: ["anthropic"] },
      messages: [{ role: "system", content: "Rules." }, { role: "user", content: "Begin." }],
      budget: { maxTokens: 600, reasoningTokens: 0, timeoutMs: 10_000 },
      tools: [{ name: "read_account", parameters: { type: "object", properties: { address: { type: "string" } } } }],
      apiKey: key,
    });

  const reply = await ask({ kind: "hack-agent", id: "agent-42" });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.toolCalls.map((call) => call.name), ["read_account"]);
  assert.equal(reply.costMicroUsd, 200);
  assert.equal(sent[0].authorization, `Bearer ${key}`);
  assert.deepEqual(records.at(-1).subject, { kind: "hack-agent", id: "agent-42" });
  assert.equal(records.at(-1).key, "own");
  assert.equal(records.at(-1).outcome, "ok");

  // A subject the gateway does not know is refused before anything is sent, and journaled with no subject.
  const refused = await ask({ kind: "hacker", id: "agent-42" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.kind, "invalid_request");
  assert.equal(sent.length, 1);
  assert.equal(records.at(-1).subject, null);
});
