import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BnbApexAdapterError } from "../../../../../lib/agent-control/adapters/bnb-apex.ts";
import { createBnbApexObservePostHandler } from "./handler.ts";
import { POST as productionPost } from "./route.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;
const ROUTE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const ALLOWED_RATE = {
  allowed: true,
  limit: 90,
  remaining: 89,
  resetAfterSeconds: 60,
  retryAfterSeconds: 60,
};

function request(body, headers = {}) {
  return new Request("https://ryntra.test/api/agents/bnb-apex/observe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function handler(observeJob, options = {}) {
  return createBnbApexObservePostHandler({
    observeJob,
    consumeRequest: options.consumeRequest ?? (() => ALLOWED_RATE),
    ...(options.readJson ? { readJson: options.readJson } : {}),
    ...(options.acquireUpstreamSlot ? { acquireUpstreamSlot: options.acquireUpstreamSlot } : {}),
  });
}

test("the observer accepts only exact bounded string jobId and txHash fields", async () => {
  let calls = 0;
  const post = handler(async () => {
    calls += 1;
    return {};
  });
  const invalidBodies = [
    {},
    { jobId: 1, txHash: TX_HASH },
    { jobId: "01", txHash: TX_HASH },
    { jobId: "-1", txHash: TX_HASH },
    { jobId: "1", txHash: "0x1234" },
    { jobId: "1", txHash: TX_HASH, chainId: 97 },
    { jobId: "1", txHash: TX_HASH, rpcUrl: "https://example.invalid" },
    { jobId: `${1n << 256n}`, txHash: TX_HASH },
  ];

  for (const body of invalidBodies) {
    const response = await post(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "VALIDATION_ERROR",
        message: "The BNB APEX observation request is not accepted.",
      },
    });
  }
  assert.equal(calls, 0);
});

test("the observer rejects query controls before parsing or an RPC read", async () => {
  let parsed = 0;
  let calls = 0;
  const post = handler(
    async () => {
      calls += 1;
      return {};
    },
    {
      readJson: async () => {
        parsed += 1;
        return { ok: true, value: { jobId: "1", txHash: TX_HASH } };
      },
    },
  );
  const response = await post(new Request(
    "https://ryntra.test/api/agents/bnb-apex/observe?rpcUrl=https://example.invalid",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "1", txHash: TX_HASH }),
    },
  ));

  assert.equal(response.status, 400);
  assert.equal(parsed, 0);
  assert.equal(calls, 0);
});

test("a valid reference is normalized, abort-aware and remains private no-store", async () => {
  let observedReference;
  let observedSignal;
  const observation = {
    provider: "BNB_APEX",
    access: "KNOWN_TX_AND_JOB_READ_ONLY",
    chainId: 97,
    state: "NOT_FOUND",
    jobId: "42",
    txHash: TX_HASH,
    transaction: null,
    job: null,
  };
  const post = handler(async (reference, { signal }) => {
    observedReference = reference;
    observedSignal = signal;
    return observation;
  });
  const input = request({ jobId: "42", txHash: TX_HASH.toUpperCase().replace("0X", "0x") });
  const response = await post(input);

  assert.equal(response.status, 200);
  assert.deepEqual(observedReference, { jobId: "42", txHash: TX_HASH });
  assert.equal(observedSignal, input.signal);
  assert.deepEqual(await response.json(), { data: observation });
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
});

test("the production observer delegates only to the known-reference allowlisted adapter", () => {
  assert.match(ROUTE, /observeBnbApexKnownJobTransaction/);
  assert.match(ROUTE, /createBnbApexObservePostHandler/);
  assert.match(ROUTE, /fetchBoundToCaller/);
  assert.doesNotMatch(ROUTE, /process\.env|authorization|cookie|credentials|eth_getLogs/i);
});

test("the production observer rejects invalid input without touching BSC RPC", async () => {
  const response = await productionPost(request({
    jobId: "1",
    txHash: TX_HASH,
    rpcUrl: "https://example.invalid",
  }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("bounded JSON errors preserve parser status and code without an observer call", async () => {
  let calls = 0;
  const post = handler(async () => {
    calls += 1;
    return {};
  });

  const wrongType = await post(new Request(
    "https://ryntra.test/api/agents/bnb-apex/observe",
    { method: "POST", body: "{}", headers: { "content-type": "text/plain" } },
  ));
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).error.code, "JSON_REQUIRED");

  const malformed = await post(request("{"));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_JSON");

  const oversized = await post(request({ jobId: "1", txHash: TX_HASH, pad: "x".repeat(1_024) }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "BODY_TOO_LARGE");
  assert.equal(calls, 0);
});

test("rate limiting rejects before body parsing and upstream observation", async () => {
  let parsed = 0;
  let calls = 0;
  const post = handler(
    async () => {
      calls += 1;
      return {};
    },
    {
      consumeRequest: () => ({
        allowed: false,
        limit: 90,
        remaining: 0,
        resetAfterSeconds: 31,
        retryAfterSeconds: 31,
      }),
      readJson: async () => {
        parsed += 1;
        return { ok: true, value: {} };
      },
    },
  );
  const response = await post(request("{"));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "31");
  assert.equal(parsed, 0);
  assert.equal(calls, 0);
});

test("upstream concurrency rejection is a bounded 429 before the BNB RPC read", async () => {
  let calls = 0;
  const post = handler(
    async () => {
      calls += 1;
      return {};
    },
    {
      acquireUpstreamSlot: () => ({ allowed: false, retryAfterSeconds: 2 }),
    },
  );
  const response = await post(request({ jobId: "1", txHash: TX_HASH }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal((await response.json()).error.code, "RATE_LIMITED");
  assert.equal(calls, 0);
});

test("the BNB observer releases its upstream slot after success", async () => {
  let releases = 0;
  const post = handler(
    async () => ({
      provider: "BNB_APEX",
      access: "KNOWN_TX_AND_JOB_READ_ONLY",
      chainId: 97,
      state: "NOT_FOUND",
      jobId: "1",
      txHash: TX_HASH,
      transaction: null,
      job: null,
    }),
    {
      acquireUpstreamSlot: () => ({
        allowed: true,
        release: () => {
          releases += 1;
        },
      }),
    },
  );
  const response = await post(request({ jobId: "1", txHash: TX_HASH }));

  assert.equal(response.status, 200);
  assert.equal(releases, 1);
});

test("adapter validation is a bounded 400 while upstream failures collapse to 502", async () => {
  const invalid = handler(async () => {
    throw new BnbApexAdapterError("APEX_JOB_ID_INVALID", "private invalid detail");
  });
  const invalidResponse = await invalid(request({ jobId: "1", txHash: TX_HASH }));
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidBody.error.code, "VALIDATION_ERROR");
  assert.doesNotMatch(JSON.stringify(invalidBody), /private invalid detail/i);

  const upstream = handler(async () => {
    throw new BnbApexAdapterError(
      "APEX_RPC_NETWORK_ERROR",
      "https://example.invalid/?diagnostic=do-not-reflect",
    );
  });
  const upstreamResponse = await upstream(request({ jobId: "1", txHash: TX_HASH }));
  const upstreamBody = await upstreamResponse.json();
  assert.equal(upstreamResponse.status, 502);
  assert.deepEqual(upstreamBody, {
    error: {
      code: "UPSTREAM_FAILURE",
      message: "The BNB APEX read-only observation could not be completed.",
    },
  });
  assert.doesNotMatch(JSON.stringify(upstreamBody), /do-not-reflect|example\.invalid/i);
});
