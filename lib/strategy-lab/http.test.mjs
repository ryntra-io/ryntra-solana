import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson } from "./http.ts";

test("bounded JSON rejects unsupported media, declared overflow, actual overflow, and malformed input", async () => {
  const unsupported = await readBoundedJson(new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }), 32);
  assert.deepEqual(unsupported, { ok: false, status: 415 });

  const declared = await readBoundedJson(new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "100" },
    body: "{}",
  }), 32);
  assert.deepEqual(declared, { ok: false, status: 413 });

  const actual = await readBoundedJson(new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(100) }),
  }), 32);
  assert.deepEqual(actual, { ok: false, status: 413 });

  const malformed = await readBoundedJson(new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }), 32);
  assert.deepEqual(malformed, { ok: false, status: 400 });
});

test("bounded JSON returns parsed unknown data without mutating it", async () => {
  const parsed = await readBoundedJson(new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ brief: "test" }),
  }), 128);
  assert.deepEqual(parsed, { ok: true, value: { brief: "test" } });
});

test("bounded JSON cancels an oversized stream before consuming the remaining body", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1_024));
      if (pulls >= 65) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://ryntra.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });

  assert.deepEqual(await readBoundedJson(request, 16), { ok: false, status: 413 });
  assert.equal(cancelled, true);
  assert.ok(pulls <= 2, `expected early cancellation, observed ${pulls} pulls`);
});
