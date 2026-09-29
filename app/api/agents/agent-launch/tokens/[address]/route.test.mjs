import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AgentLaunchAdapterError } from "../../../../../../lib/agent-control/adapters/agent-launch.ts";
import { createAgentLaunchTokenDetailGetHandler } from "./handler.ts";
import { GET as productionGet } from "./route.ts";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ROUTE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const ALLOWED_RATE = {
  allowed: true,
  limit: 90,
  remaining: 89,
  resetAfterSeconds: 60,
  retryAfterSeconds: 60,
};

function handler(fetchToken, rate = ALLOWED_RATE, acquireUpstreamSlot) {
  return createAgentLaunchTokenDetailGetHandler({
    fetchToken,
    consumeRequest: () => rate,
    ...(acquireUpstreamSlot ? { acquireUpstreamSlot } : {}),
  });
}

function context(address, extra = {}) {
  return { params: Promise.resolve({ address, ...extra }) };
}

test("the detail route accepts one exact EVM address and no query controls", async () => {
  let observedAddress;
  let observedSignal;
  const get = handler(async (address, { signal }) => {
    observedAddress = address;
    observedSignal = signal;
    return {
      provider: "AGENT_LAUNCH",
      endpoint: "TOKEN_DETAIL",
      chainId: 97,
      state: "NOT_FOUND",
      token: null,
    };
  });

  for (const [address, query, extra] of [
    ["not-an-address", "", {}],
    ["0x1234", "", {}],
    [ADDRESS, "?chainId=97", {}],
    [ADDRESS, "?origin=https://example.invalid", {}],
    [ADDRESS, "", { rpcUrl: "https://example.invalid" }],
  ]) {
    const response = await get(
      new Request(`https://ryntra.test/api/agents/agent-launch/tokens/${address}${query}`),
      context(address, extra),
    );
    assert.equal(response.status, 400);
  }

  const request = new Request(
    `https://ryntra.test/api/agents/agent-launch/tokens/${ADDRESS.toUpperCase().replace("0X", "0x")}`,
  );
  const response = await get(request, context(ADDRESS.toUpperCase().replace("0X", "0x")));
  assert.equal(response.status, 200);
  assert.equal(observedAddress, ADDRESS);
  assert.equal(observedSignal, request.signal);
  assert.deepEqual(await response.json(), {
    data: {
      provider: "AGENT_LAUNCH",
      endpoint: "TOKEN_DETAIL",
      chainId: 97,
      state: "NOT_FOUND",
      token: null,
    },
  });
});

test("the production detail route delegates only to the fixed adapter", () => {
  assert.match(ROUTE, /fetchAgentLaunchTestnetToken/);
  assert.match(ROUTE, /createAgentLaunchTokenDetailGetHandler/);
  assert.match(ROUTE, /fetchBoundToCaller/);
  assert.doesNotMatch(ROUTE, /searchParams|process\.env|authorization|cookie|credentials/i);
});

test("the production detail route rejects invalid input without a provider read", async () => {
  const response = await productionGet(
    new Request("https://ryntra.test/api/agents/agent-launch/tokens/invalid"),
    context("invalid"),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("typed adapter validation remains a bounded 400", async () => {
  const get = handler(async () => {
    throw new AgentLaunchAdapterError(
      "AGENT_LAUNCH_ADDRESS_INVALID",
      "provider secret must not be reflected",
    );
  });
  const response = await get(
    new Request(`https://ryntra.test/api/agents/agent-launch/tokens/${ADDRESS}`),
    context(ADDRESS),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error: {
      code: "VALIDATION_ERROR",
      message: "The Agent Launch token-detail request is not accepted.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /provider secret/i);
});

test("upstream concurrency rejection is a bounded 429 before the token-detail read", async () => {
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
    new Request(`https://ryntra.test/api/agents/agent-launch/tokens/${ADDRESS}`),
    context(ADDRESS),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal((await response.json()).error.code, "RATE_LIMITED");
  assert.equal(calls, 0);
});

test("the token-detail route releases its upstream slot after failure", async () => {
  let releases = 0;
  const get = handler(
    async () => {
      throw new Error("bounded upstream failure");
    },
    ALLOWED_RATE,
    () => ({
      allowed: true,
      release: () => {
        releases += 1;
      },
    }),
  );
  const response = await get(
    new Request(`https://ryntra.test/api/agents/agent-launch/tokens/${ADDRESS}`),
    context(ADDRESS),
  );

  assert.equal(response.status, 502);
  assert.equal(releases, 1);
});

test("upstream failures are bounded and private", async () => {
  const get = handler(async () => {
    throw new Error("hidden upstream diagnostic");
  });
  const response = await get(
    new Request(`https://ryntra.test/api/agents/agent-launch/tokens/${ADDRESS}`),
    context(ADDRESS),
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(body, {
    error: {
      code: "UPSTREAM_FAILURE",
      message: "The Agent Launch token-detail read could not be completed.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /hidden upstream diagnostic/i);
});
