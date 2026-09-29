// Run from repo root: node --test lib/agent-control/adapters/agent-launch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  AGENT_LAUNCH_BASE_URL,
  AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID,
  AgentLaunchAdapterError,
  fetchAgentLaunchTestnetToken,
  fetchAgentLaunchTestnetTokens,
  normalizeAgentLaunchToken,
  normalizeAgentLaunchTokenDetailPayload,
  normalizeAgentLaunchTokenListPayload,
} = await import("./agent-launch.ts");

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const OBSERVED_AT = new Date("2026-08-14T04:00:00.000Z");

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function streamedResponse(chunks, init = {}) {
  let index = 0;
  let cancellations = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
    },
    cancel() {
      cancellations += 1;
    },
  });
  return {
    response: new Response(body, init),
    cancellationCount: () => cancellations,
  };
}

test("public token list reports a truthful zero state and uses only explicit chainId 97 GET", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      success: true,
      data: [],
      meta: { total: 0 },
      error: null,
    });
  };

  const observation = await fetchAgentLaunchTestnetTokens({
    fetchImpl,
    now: () => OBSERVED_AT,
  });

  assert.equal(observation.provider, "AGENT_LAUNCH");
  assert.equal(observation.access, "PUBLIC_READ_ONLY_GET");
  assert.equal(observation.endpoint, "TOKENS");
  assert.equal(observation.chainId, 97);
  assert.equal(observation.state, "ZERO_STATE");
  assert.deepEqual(observation.tokens, []);
  assert.equal(observation.controllerVariant, "SUCCESS_DATA_ARRAY");
  assert.equal(observation.observedAt, OBSERVED_AT.toISOString());
  assert.deepEqual(observation.raw.meta, { total: 0 });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin, AGENT_LAUNCH_BASE_URL);
  assert.equal(requestUrl.pathname, "/api/agents/tokens");
  assert.deepEqual([...requestUrl.searchParams.entries()], [["chainId", "97"]]);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(calls[0].init.headers, { Accept: "application/json" });
  assert.equal("body" in calls[0].init, false);
});

test("detail normalizer records controller and schema drift without inventing fields", async () => {
  const calls = [];
  const providerPayload = {
    success: true,
    data: {
      token_address: ADDRESS.toUpperCase().replace("0X", "0x"),
      tokenName: "Example Agent Token",
      ticker: "EAT",
      agent_address: "agent-7",
      chain_id: "97",
      decimals: "18",
      listed: false,
      status: true,
      providerOnlyField: { untouched: true },
    },
    error: null,
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(providerPayload);
  };

  const observation = await fetchAgentLaunchTestnetToken(ADDRESS, {
    fetchImpl,
    now: () => OBSERVED_AT,
  });

  assert.equal(observation.state, "AVAILABLE");
  assert.equal(observation.controllerVariant, "SUCCESS_DATA_RECORD");
  assert.equal(observation.token.address, ADDRESS);
  assert.equal(observation.token.name, "Example Agent Token");
  assert.equal(observation.token.symbol, "EAT");
  assert.equal(observation.token.agentId, "agent-7");
  assert.equal(observation.token.payloadChainId, AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID);
  assert.equal(observation.token.decimals, 18);
  assert.equal(observation.token.listed, false);
  assert.equal(observation.token.status, true);
  assert.deepEqual(observation.token.raw.providerOnlyField, { untouched: true });
  assert.deepEqual(observation.raw, providerPayload);
  assert.ok(observation.schemaDrift.includes("ADDRESS_FROM_TOKEN_ADDRESS"));
  assert.ok(observation.schemaDrift.includes("NAME_FROM_TOKENNAME"));
  assert.ok(observation.schemaDrift.includes("SYMBOL_FROM_TICKER"));
  assert.ok(observation.schemaDrift.includes("AGENTID_FROM_AGENT_ADDRESS"));
  assert.ok(observation.schemaDrift.includes("CHAIN_ID_FROM_CHAIN_ID_SNAKE_CASE"));
  assert.ok(observation.schemaDrift.includes("CHAIN_ID_FROM_DECIMAL_STRING"));
  assert.ok(observation.schemaDrift.includes("DECIMALS_FROM_DECIMAL_STRING"));

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.pathname, `/api/agents/token/${ADDRESS}`);
  assert.deepEqual([...requestUrl.searchParams.entries()], [["chainId", "97"]]);
  assert.equal(calls[0].init.method, "GET");
});

test("known controller variants normalize explicitly and preserve raw payloads", () => {
  const token = { address: ADDRESS, symbol: "ONE", chainId: 97 };

  const wrapped = normalizeAgentLaunchTokenListPayload({
    success: true,
    data: { tokens: [token] },
    error: null,
  });
  assert.equal(wrapped.controllerVariant, "SUCCESS_DATA_TOKENS");
  assert.equal(wrapped.state, "AVAILABLE");
  assert.ok(wrapped.schemaDrift.includes("CONTROLLER_DATA_TOKENS_WRAPPER"));

  const legacy = normalizeAgentLaunchTokenListPayload({ tokens: [token] });
  assert.equal(legacy.controllerVariant, "LEGACY_TOKENS_ROOT");
  assert.ok(legacy.schemaDrift.includes("CONTROLLER_LEGACY_TOKENS_ROOT"));

  const raw = normalizeAgentLaunchTokenListPayload([token]);
  assert.equal(raw.controllerVariant, "RAW_ARRAY");
  assert.ok(raw.schemaDrift.includes("CONTROLLER_RAW_ARRAY"));

  const notFound = normalizeAgentLaunchTokenDetailPayload(
    { success: true, data: null, error: null },
    ADDRESS,
  );
  assert.equal(notFound.state, "NOT_FOUND");
  assert.equal(notFound.token, null);
});

test("non-critical aliases that disagree are surfaced as conflicts, not selected as truth", () => {
  const token = normalizeAgentLaunchToken({
    address: ADDRESS,
    symbol: "AAA",
    ticker: "BBB",
    agentId: "agent-a",
    agent_address: "agent-b",
    chainId: 97,
  });

  assert.equal(token.symbol, null);
  assert.equal(token.agentId, null);
  assert.deepEqual(
    token.conflicts.map(({ field }) => field),
    ["symbol", "agentId"],
  );
  assert.ok(token.schemaDrift.includes("SYMBOL_ALIAS_CONFLICT"));
  assert.ok(token.schemaDrift.includes("AGENTID_ALIAS_CONFLICT"));
});

test("critical mismatches and malformed controller payloads fail closed", () => {
  assert.throws(
    () => normalizeAgentLaunchToken({ address: ADDRESS, chainId: 56 }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_CHAIN_MISMATCH",
  );
  assert.throws(
    () =>
      normalizeAgentLaunchToken({
        address: ADDRESS,
        tokenAddress: OTHER_ADDRESS,
        chainId: 97,
      }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_ADDRESS_CONFLICT",
  );
  assert.throws(
    () =>
      normalizeAgentLaunchTokenDetailPayload(
        { success: true, data: { address: OTHER_ADDRESS }, error: null },
        ADDRESS,
      ),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_ADDRESS_MISMATCH",
  );
  assert.throws(
    () => normalizeAgentLaunchTokenListPayload({ success: false, data: [], error: "no" }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_PROVIDER_REJECTED",
  );
  assert.throws(
    () => normalizeAgentLaunchTokenListPayload({ success: true, data: [], error: "contradiction" }),
    (error) =>
      error instanceof AgentLaunchAdapterError &&
      error.code === "AGENT_LAUNCH_PROVIDER_CONTRADICTION",
  );
  assert.throws(
    () =>
      normalizeAgentLaunchTokenListPayload({
        success: true,
        data: [
          { address: ADDRESS },
          { tokenAddress: ADDRESS },
        ],
        error: null,
      }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_DUPLICATE_TOKEN",
  );
});

test("public reads reject non-JSON responses and enforce a bounded timeout", async () => {
  await assert.rejects(
    fetchAgentLaunchTestnetTokens({
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_JSON_INVALID",
  );

  await assert.rejects(
    fetchAgentLaunchTestnetTokens({
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        }),
    }),
    (error) => error instanceof AgentLaunchAdapterError && error.code === "AGENT_LAUNCH_TIMEOUT",
  );
});

test("public reads stop and cancel a chunked response exactly once at the byte limit", async () => {
  const streamed = streamedResponse([
    new Uint8Array(700_000).fill(0x20),
    new Uint8Array(400_000).fill(0x20),
  ]);

  await assert.rejects(
    fetchAgentLaunchTestnetTokens({ fetchImpl: async () => streamed.response }),
    (error) =>
      error instanceof AgentLaunchAdapterError
      && error.code === "AGENT_LAUNCH_RESPONSE_TOO_LARGE",
  );
  assert.equal(streamed.cancellationCount(), 1);
});

test("public reads cancel rejected and unreadable response bodies exactly once", async () => {
  const cases = [
    {
      expectedCode: "AGENT_LAUNCH_HTTP_ERROR",
      streamed: streamedResponse([new TextEncoder().encode("provider failure")], { status: 502 }),
    },
    {
      expectedCode: "AGENT_LAUNCH_HTTP_INVALID",
      streamed: streamedResponse([new TextEncoder().encode("{}")], {
        headers: { "content-length": "invalid" },
      }),
    },
    {
      expectedCode: "AGENT_LAUNCH_RESPONSE_TOO_LARGE",
      streamed: streamedResponse([new TextEncoder().encode("{}")], {
        headers: { "content-length": "1048577" },
      }),
    },
    {
      expectedCode: "AGENT_LAUNCH_JSON_INVALID",
      streamed: streamedResponse([new Uint8Array([0xff])]),
    },
  ];

  for (const { expectedCode, streamed } of cases) {
    await assert.rejects(
      fetchAgentLaunchTestnetTokens({ fetchImpl: async () => streamed.response }),
      (error) => error instanceof AgentLaunchAdapterError && error.code === expectedCode,
    );
    assert.equal(streamed.cancellationCount(), 1, expectedCode);
  }
});
