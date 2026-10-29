import { test } from "node:test";
import assert from "node:assert/strict";

import { ask, V1 } from "./engine.ts";

const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("an answer's data envelope is opened; a body without one is the answer", async () => {
  assert.deepEqual(await ask(answer(200, { data: { a: 1 } }), "/x"), { ok: true, status: 200, value: { a: 1 } });
  assert.deepEqual(await ask(answer(200, { order: { state: "X" } }), "/x"), { ok: true, status: 200, value: { order: { state: "X" } } });
});

test("a refusal carries the engine's code, words and everything else it said", async () => {
  const refused = await ask(answer(409, { error: { code: "QUOTE_CHANGED", message: "moved", quote: { id: 1 }, submitBoundary: "NOT_CROSSED" } }), "/x", { body: {} });
  assert.deepEqual(refused, { ok: false, failure: { code: "QUOTE_CHANGED", message: "moved", status: 409, extra: { quote: { id: 1 }, submitBoundary: "NOT_CROSSED" } } });
  const bare = await ask(answer(502, null), "/x");
  assert.equal(bare.failure.code, "HTTP_502");
});

test("a request that never arrives, or arrives cut off, is not a success", async () => {
  const lost = await ask(async () => {
    throw new TypeError("fetch failed");
  }, "/x");
  assert.equal(lost.failure.code, "NETWORK");
  const cut = await ask(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("cut"); } }), "/x");
  assert.equal(cut.failure.code, "NETWORK");
});

test("a hung request answers TIMEOUT", async () => {
  const hung = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const result = await ask(hung, "/x", { timeoutMs: 5 });
  assert.equal(result.failure.code, "TIMEOUT");
});

test("a body is sent as JSON with POST; a read is a GET; the v1 header is the major the city speaks", async () => {
  const seen = [];
  const record = async (url, init) => (seen.push(init), { ok: true, status: 200, json: async () => ({}) });
  await ask(record, "/x", { body: { a: 1 } });
  await ask(record, "/y", { headers: V1 });
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].body, '{"a":1}');
  assert.equal(seen[0].headers["content-type"], "application/json");
  assert.equal(seen[1].method, "GET");
  assert.equal(seen[1].headers["X-Ryntra-API"], "1");
});
