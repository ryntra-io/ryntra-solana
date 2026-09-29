import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AgentLaunchAdapterError } from "../../../../../lib/agent-control/adapters/agent-launch.ts";
import { createAgentLaunchTokenListGetHandler } from "./handler.ts";
import { GET as productionGet } from "./route.ts";

const ROUTE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const ALLOWED_RATE = {
  allowed: true,
  limit: 90,
  remaining: 89,
  resetAfterSeconds: 60,
  retryAfterSeconds: 60,
};

function handler(fetchTokens, rate = ALLOWED_RATE, acquireUpstreamSlot) {
  return createAgentLaunchTokenListGetHandler({
    fetchTokens,
    consumeRequest: () => rate,
    ...(acquireUpstreamSlot ? { acquireUpstreamSlot } : {}),
  });
}

test("the token-list route fixes chain 97 server-side and accepts no query controls", async () => {
  let calls = 0;
  const get = handler(async ({ signal }) => {
    calls += 1;
    assert.ok(signal instanceof AbortSignal);
    return { provider: "AGENT_LAUNCH", chainId: 97, state: "ZERO_STATE", tokens: [] };
  });

  for (const query of ["?chainId=97", "?origin=https://example.invalid", "?rpcUrl=x", "?x=1&x=2"]) {
    const response = await get(
      new Request(`https://ryntra.test/api/agents/agent-launch/tokens${query}`),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "VALIDATION_ERROR",
        message: "The Agent Launch token-list request is not accepted.",
      },
    });
  }
  assert.equal(calls, 0);

  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens"),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    data: { provider: "AGENT_LAUNCH", chainId: 97, state: "ZERO_STATE", tokens: [] },
  });
});

test("the production token-list route delegates only to the fixed adapter", () => {
  assert.match(ROUTE, /fetchAgentLaunchTestnetTokens/);
  assert.match(ROUTE, /createAgentLaunchTokenListGetHandler/);
  assert.match(ROUTE, /fetchBoundToCaller/);
  assert.doesNotMatch(ROUTE, /searchParams|process\.env|authorization|cookie|credentials/i);
});

test("the production route rejects a query without touching Agent Launch", async () => {
  const response = await productionGet(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens?chainId=56"),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("rate limiting happens before validation and upstream reads", async () => {
  let calls = 0;
  const get = handler(
    async () => {
      calls += 1;
      return {};
    },
    {
      allowed: false,
      limit: 90,
      remaining: 0,
      resetAfterSeconds: 23,
      retryAfterSeconds: 23,
    },
  );
  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens?bad=query"),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "23");
  assert.equal(calls, 0);
});

test("upstream concurrency rejection is a bounded 429 before the Agent Launch read", async () => {
  let calls = 0;
  const get = handler(
    async () => {
      calls += 1;
      return {};
    },
    ALLOWED_RATE,
    () => ({ allowed: false, retryAfterSeconds: 2 }),
  );
  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens"),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.deepEqual(await response.json(), {
    error: {
      code: "RATE_LIMITED",
      message: "Too many Agent Launch token requests. Retry after the rate-limit window.",
    },
  });
  assert.equal(calls, 0);
});

test("the token-list route releases its upstream slot after success", async () => {
  let releases = 0;
  const get = handler(
    async () => ({ provider: "AGENT_LAUNCH", chainId: 97, state: "ZERO_STATE", tokens: [] }),
    ALLOWED_RATE,
    () => ({
      allowed: true,
      release: () => {
        releases += 1;
      },
    }),
  );

  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens"),
  );
  assert.equal(response.status, 200);
  assert.equal(releases, 1);
});

test("upstream errors are bounded, private and never reflect exception details", async () => {
  const get = handler(async () => {
    throw new AgentLaunchAdapterError(
      "AGENT_LAUNCH_NETWORK_ERROR",
      "https://example.invalid/?diagnostic=do-not-reflect",
    );
  });
  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens"),
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  assert.deepEqual(body, {
    error: {
      code: "UPSTREAM_FAILURE",
      message: "The Agent Launch token-list read could not be completed.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /do-not-reflect|example\.invalid/i);
});

test("caller cancellation is a bounded 499 and does not expose the thrown value", async () => {
  const controller = new AbortController();
  const get = handler(async () => {
    controller.abort();
    throw new Error("hidden diagnostic sentinel");
  });
  const response = await get(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens", {
      signal: controller.signal,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 499);
  assert.deepEqual(body, {
    error: {
      code: "REQUEST_ABORTED",
      message: "The Agent Launch token-list request was cancelled.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /hidden diagnostic sentinel/i);
});
