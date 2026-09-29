/**
 * Provider health, and the state that is easiest to get wrong.
 *
 * `UNKNOWN` is what a pair is before anything has been asked of it, and the
 * first assertion here is that an untouched handle does not report `HEALTHY`.
 * A tile that renders "no problems" over an empty attempt log is reporting its
 * own silence, and it would be green on the exact morning nobody wants it to
 * be.
 *
 * The reads are driven through the real transport with `fetch` stood in for,
 * so the attempt log these states are derived from is the one the product
 * writes rather than one composed for the test.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { freshnessOf, rpcPairHealth } from "./health.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "./rpc.ts";

const PRIMARY = "https://primary.example";
const FALLBACK = "https://fallback.example";

function reply(result) {
  return new Response(`{"jsonrpc":"2.0","id":1,"result":${result}}`, { status: 200 });
}

function stubFetch(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const handler = handlers[new URL(url).host];
    if (!handler) throw new Error("no stub");
    return handler();
  };
  return () => {
    globalThis.fetch = original;
  };
}

function pair(overrides = {}) {
  return createSolanaRpcHandle({
    network: "mainnet",
    endpoint: PRIMARY,
    fallbackEndpoint: FALLBACK,
    timeoutMs: 200,
    retries: 0,
    ...overrides,
  });
}

async function readEpoch(handle) {
  try {
    await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    return true;
  } catch {
    return false;
  }
}

test("a pair nothing has been asked of is UNKNOWN, not healthy", () => {
  const health = rpcPairHealth(pair());
  assert.equal(health.state, "UNKNOWN");
  assert.equal(health.servedBy, null);
  assert.equal(freshnessOf(health.state), "UNKNOWN");
});

test("the primary answering everything is HEALTHY", async () => {
  const restore = stubFetch({ "primary.example": () => reply('{"epoch":1}') });
  try {
    const handle = pair();
    assert.equal(await readEpoch(handle), true);
    const health = rpcPairHealth(handle);
    assert.equal(health.state, "HEALTHY");
    assert.equal(health.servedBy, "primary");
    assert.equal(health.endpoints[0].failed, 0);
    assert.equal(freshnessOf(health.state), "CURRENT");
  } finally {
    restore();
  }
});

test("the fallback answering instead is DEGRADED and names both hosts", async () => {
  const restore = stubFetch({
    "primary.example": () => new Response("blocked", { status: 403 }),
    "fallback.example": () => reply('{"epoch":1}'),
  });
  try {
    const handle = pair();
    assert.equal(await readEpoch(handle), true);
    const health = rpcPairHealth(handle);
    assert.equal(health.state, "DEGRADED", "a real answer from the wrong endpoint is not healthy");
    assert.equal(health.servedBy, "fallback");
    assert.match(health.detail, /primary\.example/);
    assert.match(health.detail, /fallback\.example/);
    assert.equal(freshnessOf(health.state), "STALE");
    assert.match(health.endpoints[0].lastReason, /403/);
  } finally {
    restore();
  }
});

test("neither endpoint answering is UNAVAILABLE, and unknown is not stale", async () => {
  const restore = stubFetch({
    "primary.example": () => new Response("no", { status: 500 }),
    "fallback.example": () => new Response("no", { status: 500 }),
  });
  try {
    const handle = pair();
    assert.equal(await readEpoch(handle), false);
    const health = rpcPairHealth(handle);
    assert.equal(health.state, "UNAVAILABLE");
    assert.equal(health.unanswered, 1);
    assert.equal(health.servedBy, null);
    assert.equal(freshnessOf(health.state), "UNKNOWN");
  } finally {
    restore();
  }
});

test("one failed read among several answered ones is DEGRADED, not an outage", async () => {
  /* The case a naive count gets wrong in both directions: reporting HEALTHY
     because most calls worked, or UNAVAILABLE because one did not. */
  let call = 0;
  const restore = stubFetch({
    "primary.example": () => {
      call += 1;
      return call === 2 ? new Response("no", { status: 500 }) : reply('{"epoch":1}');
    },
    "fallback.example": () => new Response("no", { status: 500 }),
  });
  try {
    const handle = pair();
    assert.equal(await readEpoch(handle), true);
    assert.equal(await readEpoch(handle), false);
    assert.equal(await readEpoch(handle), true);
    const health = rpcPairHealth(handle);
    assert.equal(health.state, "DEGRADED");
    assert.equal(health.unanswered, 1);
    assert.equal(health.endpoints[0].answered, 2);
  } finally {
    restore();
  }
});

test("a single-endpoint network reports the absence rather than an imaginary pair", async () => {
  const restore = stubFetch({ "primary.example": () => new Response("no", { status: 500 }) });
  try {
    const handle = pair({ fallbackEndpoint: null });
    assert.equal(await readEpoch(handle), false);
    const health = rpcPairHealth(handle);
    assert.equal(health.state, "UNAVAILABLE");
    assert.equal(health.endpoints.length, 1);
    assert.match(health.detail, /no second endpoint/i);
  } finally {
    restore();
  }
});
