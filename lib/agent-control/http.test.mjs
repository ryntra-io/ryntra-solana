import assert from "node:assert/strict";
import test from "node:test";

import { readAgentControlJson } from "./http.ts";

test("Agent Control JSON reader rejects unsupported, malformed and oversized bodies", async () => {
  assert.deepEqual(
    await readAgentControlJson(new Request("https://ryntra.test", { method: "POST", body: "{}" })),
    { ok: false, status: 415, code: "JSON_REQUIRED" },
  );

  assert.deepEqual(
    await readAgentControlJson(new Request("https://ryntra.test", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "bad" },
      body: "{}",
    })),
    { ok: false, status: 400, code: "INVALID_CONTENT_LENGTH" },
  );

  assert.deepEqual(
    await readAgentControlJson(new Request("https://ryntra.test", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "5" },
      body: "{}",
    }), 4),
    { ok: false, status: 413, code: "BODY_TOO_LARGE" },
  );

  assert.deepEqual(
    await readAgentControlJson(new Request("https://ryntra.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })),
    { ok: false, status: 400, code: "INVALID_JSON" },
  );
});

test("Agent Control JSON reader accepts bounded UTF-8 JSON", async () => {
  const result = await readAgentControlJson(new Request("https://ryntra.test", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ request: "перевірити" }),
  }));

  assert.deepEqual(result, { ok: true, value: { request: "перевірити" } });
});

test("the warm-instance upstream gate caps concurrency and releases each lease once", async () => {
  const http = await import("./http.ts");
  assert.equal(
    typeof http.WarmInstanceConcurrencyGate,
    "function",
    "the shared Agent Control HTTP boundary must expose the concurrency gate",
  );

  const gate = new http.WarmInstanceConcurrencyGate({
    limit: 2,
    retryAfterSeconds: 3,
  });
  const first = gate.acquire();
  const second = gate.acquire();
  const blocked = gate.acquire();

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.deepEqual(blocked, { allowed: false, retryAfterSeconds: 3 });
  assert.equal(gate.inFlight, 2);

  first.release();
  first.release();
  assert.equal(gate.inFlight, 1, "a lease can release capacity only once");

  const replacement = gate.acquire();
  assert.equal(replacement.allowed, true, "released capacity is immediately reusable");
  second.release();
  replacement.release();
  assert.equal(gate.inFlight, 0);
});
