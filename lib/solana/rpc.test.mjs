/**
 * The endpoint pair, proven by breaking it.
 *
 * The pair is a primary and an independent fallback, and a fallback that has
 * never been exercised is a claim rather than a path. So the primary is broken
 * here in four different ways — a refusal, a hang, an oversized body and a dead
 * host — and each one has to arrive at the second endpoint with the answer
 * intact and the substitution recorded.
 *
 * The transport is the real one: only `fetch` is stood in for, so the byte
 * ceiling, the bigint codec, the ordering and the attempt log all run.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ENV_OVERRIDES,
  createSolanaRpcHandle,
  resolveEndpoint,
  resolveEndpoints,
  withRpcDiscipline,
} from "./rpc.ts";

const PRIMARY = "https://primary.example";
const FALLBACK = "https://fallback.example";

/** `result` is raw JSON text, so a reply can carry integers no `JSON.stringify`
    would produce — which is the whole point of the codec being tested. */
function jsonReply(result) {
  return new Response(`{"jsonrpc":"2.0","id":1,"result":${result}}`, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stand in for `fetch`, answering per host.
 *
 * A handler may return a `Response`, or throw to imitate a transport that
 * never produced one at all — a DNS failure, a refused connection, an abort.
 */
function stubFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const host = new URL(url).host;
    calls.push({ host, body: JSON.parse(init.body) });
    const handler = handlers[host];
    if (!handler) throw new Error(`no stub for ${host}`);
    return handler(JSON.parse(init.body), init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function pairHandle(overrides = {}) {
  return createSolanaRpcHandle({
    network: "mainnet",
    endpoint: PRIMARY,
    fallbackEndpoint: FALLBACK,
    timeoutMs: 200,
    retries: 0,
    ...overrides,
  });
}

// ------------------------------------------------------------- resolution --

test("an endpoint is explicit, then environment, then the public default", () => {
  const before = process.env[ENV_OVERRIDES.mainnet.primary];
  try {
    delete process.env[ENV_OVERRIDES.mainnet.primary];
    const fallbackToPublic = resolveEndpoint("mainnet");
    assert.match(fallbackToPublic, /^https:\/\//);

    process.env[ENV_OVERRIDES.mainnet.primary] = "https://operator.example";
    assert.equal(resolveEndpoint("mainnet"), "https://operator.example");
    assert.equal(resolveEndpoint("mainnet", "https://explicit.example"), "https://explicit.example");

    const pair = resolveEndpoints("mainnet");
    assert.equal(pair[0].url, "https://operator.example");
    assert.equal(pair[0].fromEnv, true, "an endpoint the founder supplied must be reported as supplied");
    assert.equal(pair[1].fromEnv, false, "the untouched half of the pair is still the public default");
  } finally {
    if (before === undefined) delete process.env[ENV_OVERRIDES.mainnet.primary];
    else process.env[ENV_OVERRIDES.mainnet.primary] = before;
  }
});

test("the committed defaults carry no credential", () => {
  /* The card's rule is that endpoints and keys are named founder inputs. A
     default that smuggled a key into the repository would pass every other
     check in this file. */
  for (const network of ["mainnet", "devnet"]) {
    for (const endpoint of resolveEndpoints(network)) {
      assert.ok(
        !/api[-_]?key|token=|secret|bearer/i.test(endpoint.url),
        `${endpoint.url} looks like it carries a credential`,
      );
    }
  }
});

test("mainnet ships a pair, and the two halves are different operators", () => {
  /* The fallback read path has to be *independent*. A second address of the
     same operator is a spare tyre bolted to the same axle, and the failure
     that takes one out takes the other with it. Registrable-domain
     comparison rather than exact host: `a.example.com` and `b.example.com` are
     one operator wearing two names. */
  const pair = resolveEndpoints("mainnet", { network: "mainnet" });
  assert.equal(pair.length, 2, "mainnet must resolve to a primary and a fallback");
  const operator = (host) => host.split(".").slice(-2).join(".");
  assert.notEqual(
    operator(pair[0].host),
    operator(pair[1].host),
    `${pair[0].host} and ${pair[1].host} are the same operator, so the pair is not a second read path`,
  );
});

test("a fallback identical to the primary is not a pair", () => {
  const same = resolveEndpoints("mainnet", {
    network: "mainnet",
    endpoint: PRIMARY,
    fallbackEndpoint: PRIMARY,
  });
  assert.equal(same.length, 1, "asking the same host twice is a retry, not a second read path");
});

test("devnet has no committed fallback and says so by having one endpoint", () => {
  const pair = resolveEndpoints("devnet", { network: "devnet" });
  assert.equal(pair.length, 1);
  assert.equal(pair[0].role, "primary");
});

// --------------------------------------------------------------- failover --

test("a refusal on the primary is answered by the fallback", async () => {
  const stub = stubFetch({
    "primary.example": () => new Response("blocked", { status: 403 }),
    "fallback.example": () => jsonReply('{"epoch":1023}'),
  });
  try {
    const handle = pairHandle();
    const info = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    assert.equal(String(info.epoch), "1023");
    assert.deepEqual(
      stub.calls.map((call) => call.host),
      ["primary.example", "fallback.example"],
      "the primary must be asked first, and only once",
    );
    assert.equal(handle.answered().role, "fallback");
    assert.equal(handle.host(), "fallback.example", "evidence is stamped with whoever actually answered");

    const attempts = handle.attempts();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].ok, false);
    assert.match(attempts[0].reason, /403/);
    assert.equal(attempts[1].ok, true);
  } finally {
    stub.restore();
  }
});

test("a host that never answers is answered by the fallback", async () => {
  const stub = stubFetch({
    "primary.example": () => {
      throw new Error("getaddrinfo ENOTFOUND primary.example");
    },
    "fallback.example": () => jsonReply('{"epoch":7}'),
  });
  try {
    const handle = pairHandle();
    const info = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    assert.equal(String(info.epoch), "7");
    assert.equal(handle.answered().role, "fallback");
  } finally {
    stub.restore();
  }
});

test("a primary that hangs is cut off by its own timeout, not by the caller's patience", async () => {
  /* The stub never settles on its own. Only the per-endpoint timeout can end
     this call, so the fallback answering at all is the proof that the bound
     exists — a `setTimeout` in the stub would have proven the stub. */
  const stub = stubFetch({
    "primary.example": (_body, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted by signal")));
      }),
    "fallback.example": () => jsonReply('{"epoch":11}'),
  });
  try {
    const handle = pairHandle({ timeoutMs: 120 });
    const started = Date.now();
    const info = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    assert.equal(String(info.epoch), "11");
    assert.equal(handle.attempts()[0].ok, false);
    assert.ok(Date.now() - started < 2_000, "the hang has to end at the timeout rather than at the test runner");
  } finally {
    stub.restore();
  }
});

test("when both endpoints fail the read fails, naming both hosts", async () => {
  const stub = stubFetch({
    "primary.example": () => new Response("no", { status: 500 }),
    "fallback.example": () => new Response("no", { status: 502 }),
  });
  try {
    const handle = pairHandle();
    await assert.rejects(
      () => withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal })),
      (failure) => /primary\.example/.test(failure.message) && /fallback\.example/.test(failure.message),
    );
    assert.equal(handle.answered(), null);
    assert.equal(handle.host(), "primary.example", "with nothing answered, the configured endpoint is named");
  } finally {
    stub.restore();
  }
});

test("a JSON-RPC error is an answer and is never moved to the fallback", async () => {
  const stub = stubFetch({
    "primary.example": () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid param" } }), {
        status: 200,
      }),
    "fallback.example": () => jsonReply('{"epoch":1}'),
  });
  try {
    const handle = pairHandle();
    await assert.rejects(() =>
      withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal })),
    );
    assert.deepEqual(
      stub.calls.map((call) => call.host),
      ["primary.example"],
      "re-asking a different host does not change an answer",
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------- bounded --

test("a response over the ceiling is refused and moves to the fallback", async () => {
  const oversized = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { epoch: 1, filler: "x".repeat(4_000) } });
  const stub = stubFetch({
    "primary.example": () => new Response(oversized, { status: 200 }),
    "fallback.example": () => jsonReply('{"epoch":99}'),
  });
  try {
    const handle = pairHandle({ maxResponseBytes: 1_000 });
    const info = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    assert.equal(String(info.epoch), "99");
    assert.match(handle.attempts()[0].reason, /ceiling/);
  } finally {
    stub.restore();
  }
});

test("an announced content-length over the ceiling is refused before the body is read", async () => {
  const stub = stubFetch({
    "primary.example": () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { epoch: 1 } }), {
        status: 200,
        headers: { "content-length": "999999999" },
      }),
    "fallback.example": () => jsonReply('{"epoch":5}'),
  });
  try {
    const handle = pairHandle({ maxResponseBytes: 1_000 });
    const info = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    assert.equal(String(info.epoch), "5");
    assert.match(handle.attempts()[0].reason, /announced/);
  } finally {
    stub.restore();
  }
});

test("a failure never quotes the endpoint URL back", async () => {
  /* A provider URL is where an API key lives. Node's DNS and TLS errors quote
     the URL by habit, and an attempt log is rendered on a surface. */
  const secret = "https://provider.example/v1/sk-not-a-real-key";
  const stub = stubFetch({
    "provider.example": () => {
      throw new Error(`connect ECONNREFUSED ${secret}`);
    },
    "fallback.example": () => jsonReply('{"epoch":3}'),
  });
  try {
    const handle = pairHandle({ endpoint: secret });
    await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    const reason = handle.attempts()[0].reason;
    assert.ok(!reason.includes("sk-not-a-real-key"), reason);
    assert.match(reason, /provider\.example/);
  } finally {
    stub.restore();
  }
});

test("a lamport balance past Number.MAX_SAFE_INTEGER survives the transport", async () => {
  /* The reason this module carries its own codecs. `JSON.parse` would round
     this and the panel would print a wrong balance with total confidence. */
  const huge = "9408663538618130123";
  const stub = stubFetch({
    "primary.example": () =>
      new Response(`{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":${huge}}}`, { status: 200 }),
  });
  try {
    const handle = createSolanaRpcHandle({
      network: "mainnet",
      endpoint: PRIMARY,
      fallbackEndpoint: null,
      retries: 0,
    });
    const balance = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getBalance("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").send({ abortSignal }),
    );
    assert.equal(String(balance.value), huge);
  } finally {
    stub.restore();
  }
});
