// Run from repo root: node --test lib/agent-control/adapters/bnb-apex.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, encodeFunctionResult, getAddress, toHex } from "viem";

const {
  BNB_APEX_BSC_TESTNET_CHAIN_ID,
  BNB_APEX_BSC_TESTNET_DEPLOYMENT,
  BNB_APEX_COMMERCE_JOB_EVENT_TOPICS,
  BNB_APEX_OFFICIAL_RPC_URLS,
  BNB_APEX_READ_ABIS,
  BNB_APEX_READ_RPC_METHODS,
  BNB_APEX_README_MIRROR,
  BnbApexAdapterError,
  normalizeBnbApexDeploymentSnapshot,
  observeBnbApexKnownJobTransaction,
  observeBnbApexTestnetDeployment,
} = await import("./bnb-apex.ts");

const OBSERVED_AT = new Date("2026-08-14T04:00:00.000Z");
const JOB_ID = 7n;
const TX_HASH = `0x${"ab".repeat(32)}`;
const CLIENT = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const DELIVERABLE = `0x${"cd".repeat(32)}`;
const JOB_CREATED_TOPIC = Object.entries(BNB_APEX_COMMERCE_JOB_EVENT_TOPICS).find(
  ([, eventName]) => eventName === "JobCreated",
)[0];

function jsonRpcResponse(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
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

function decodeRpcRequest(url, init, calls) {
  assert.ok(BNB_APEX_OFFICIAL_RPC_URLS.includes(String(url)));
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.deepEqual(init.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(init.body);
  assert.equal(body.jsonrpc, "2.0");
  assert.ok(BNB_APEX_READ_RPC_METHODS.includes(body.method));
  calls.push(body);
  return body;
}

function deployedCodeMap() {
  return Object.fromEntries(
    Object.values(BNB_APEX_BSC_TESTNET_DEPLOYMENT).map((address) => [address, "0x60006000"]),
  );
}

function deploymentCallResults() {
  return new Map([
    [
      encodeFunctionData({
        abi: BNB_APEX_READ_ABIS.commerce,
        functionName: "paymentToken",
      }),
      encodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.commerce,
        functionName: "paymentToken",
        result: BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken,
      }),
    ],
    [
      encodeFunctionData({ abi: BNB_APEX_READ_ABIS.router, functionName: "commerce" }),
      encodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.router,
        functionName: "commerce",
        result: BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
      }),
    ],
    [
      encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "name" }),
      encodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.erc20Metadata,
        functionName: "name",
        result: "United Stables",
      }),
    ],
    [
      encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "symbol" }),
      encodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.erc20Metadata,
        functionName: "symbol",
        result: "U",
      }),
    ],
    [
      encodeFunctionData({ abi: BNB_APEX_READ_ABIS.erc20Metadata, functionName: "decimals" }),
      encodeFunctionResult({
        abi: BNB_APEX_READ_ABIS.erc20Metadata,
        functionName: "decimals",
        result: 18,
      }),
    ],
  ]);
}

test("deployment constants follow the authoritative registry and retain README drift as evidence", () => {
  assert.equal(BNB_APEX_BSC_TESTNET_CHAIN_ID, 97);
  assert.deepEqual(BNB_APEX_BSC_TESTNET_DEPLOYMENT, {
    paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
    router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
    policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
  });
  assert.equal(BNB_APEX_README_MIRROR.policy, "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6");
  assert.equal(
    Object.values(BNB_APEX_BSC_TESTNET_DEPLOYMENT).includes(BNB_APEX_README_MIRROR.policy),
    false,
  );
});

test("deployment snapshot resolves payment metadata onchain and surfaces provider-label conflicts", async () => {
  const calls = [];
  const code = deployedCodeMap();
  const callResults = deploymentCallResults();
  const fetchImpl = async (url, init) => {
    const request = decodeRpcRequest(url, init, calls);
    if (request.method === "eth_chainId") return jsonRpcResponse(request.id, "0x61");
    if (request.method === "eth_getCode") {
      const result = Object.entries(code).find(
        ([address]) => address.toLowerCase() === request.params[0].toLowerCase(),
      )?.[1];
      assert.ok(result, `unexpected code target ${request.params[0]}`);
      return jsonRpcResponse(request.id, result);
    }
    if (request.method === "eth_call") {
      const result = callResults.get(request.params[0].data);
      assert.ok(result, `unexpected call data ${request.params[0].data}`);
      return jsonRpcResponse(request.id, result);
    }
    assert.fail(`unexpected RPC method ${request.method}`);
  };

  const observation = await observeBnbApexTestnetDeployment({
    fetchImpl,
    now: () => OBSERVED_AT,
  });

  assert.equal(observation.provider, "BNB_APEX");
  assert.equal(observation.access, "PUBLIC_READ_ONLY_RPC");
  assert.equal(observation.chainId, 97);
  assert.equal(observation.state, "OBSERVED_WITH_PROVIDER_DRIFT");
  assert.equal(observation.observedAt, OBSERVED_AT.toISOString());
  assert.deepEqual(observation.paymentAsset.onchain, {
    name: "United Stables",
    symbol: "U",
    decimals: 18,
  });
  assert.equal(observation.paymentAsset.readmeLabel, "USDC on testnet");
  assert.equal(observation.paymentAsset.registryLabel, "e.g. U on BSC Testnet");
  assert.deepEqual(
    observation.providerDrift.map(({ kind }) => kind),
    ["README_POLICY_MIRROR_MISMATCH", "README_PAYMENT_ASSET_LABEL_CONFLICT"],
  );
  assert.equal(observation.providerDrift[1].providerValue, "USDC");
  assert.equal(observation.providerDrift[1].onchainValue, "U");
  assert.equal(observation.rpcEvidence.length, calls.length);
  assert.equal(calls.filter(({ method }) => method === "eth_getCode").length, 4);
  assert.equal(calls.filter(({ method }) => method === "eth_call").length, 5);
  assert.deepEqual(
    [...new Set(calls.map(({ method }) => method))],
    ["eth_chainId", "eth_getCode", "eth_call"],
  );
});

test("deployment normalizer rejects wrong chains, missing code, and non-allowlisted links", () => {
  const valid = {
    chainId: "0x61",
    codeByAddress: deployedCodeMap(),
    commercePaymentToken: BNB_APEX_BSC_TESTNET_DEPLOYMENT.paymentToken,
    routerCommerce: BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
    paymentAssetMetadata: { name: "United Stables", symbol: "U", decimals: 18 },
  };

  assert.equal(normalizeBnbApexDeploymentSnapshot(valid).chainId, 97);
  assert.throws(
    () => normalizeBnbApexDeploymentSnapshot({ ...valid, chainId: "0x38" }),
    (error) => error instanceof BnbApexAdapterError && error.code === "APEX_CHAIN_MISMATCH",
  );
  assert.throws(
    () =>
      normalizeBnbApexDeploymentSnapshot({
        ...valid,
        codeByAddress: {
          ...valid.codeByAddress,
          [BNB_APEX_BSC_TESTNET_DEPLOYMENT.policy]: "0x",
        },
      }),
    (error) => error instanceof BnbApexAdapterError && error.code === "APEX_CODE_MISSING",
  );
  assert.throws(
    () =>
      normalizeBnbApexDeploymentSnapshot({
        ...valid,
        commercePaymentToken: "0x3333333333333333333333333333333333333333",
      }),
    (error) =>
      error instanceof BnbApexAdapterError && error.code === "APEX_PAYMENT_TOKEN_NOT_ALLOWLISTED",
  );
  assert.throws(
    () =>
      normalizeBnbApexDeploymentSnapshot({
        ...valid,
        routerCommerce: "0x4444444444444444444444444444444444444444",
      }),
    (error) => error instanceof BnbApexAdapterError && error.code === "APEX_ROUTER_LINK_MISMATCH",
  );
});

function encodedJobResult() {
  return encodeFunctionResult({
    abi: BNB_APEX_READ_ABIS.commerce,
    functionName: "getJob",
    result: {
      id: JOB_ID,
      client: CLIENT,
      provider: PROVIDER,
      evaluator: BNB_APEX_BSC_TESTNET_DEPLOYMENT.router,
      description: "Read-only evidence job",
      budget: 1_000_000n,
      expiredAt: 1_800_000_000n,
      status: 2,
      hook: BNB_APEX_BSC_TESTNET_DEPLOYMENT.router,
      submittedAt: 1_799_999_000n,
      deliverable: DELIVERABLE,
    },
  });
}

function successfulJobReceipt(jobId = JOB_ID) {
  return {
    transactionHash: TX_HASH,
    to: BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
    blockNumber: "0x1234",
    status: "0x1",
    logs: [
      {
        address: BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
        topics: [JOB_CREATED_TOPIC, toHex(jobId, { size: 32 })],
        data: "0x",
      },
    ],
  };
}

test("known txHash plus jobId observation binds an allowlisted receipt event and getJob snapshot", async () => {
  const calls = [];
  const expectedGetJobData = encodeFunctionData({
    abi: BNB_APEX_READ_ABIS.commerce,
    functionName: "getJob",
    args: [JOB_ID],
  });
  const fetchImpl = async (url, init) => {
    const request = decodeRpcRequest(url, init, calls);
    if (request.method === "eth_chainId") return jsonRpcResponse(request.id, "0x61");
    if (request.method === "eth_getTransactionReceipt") {
      assert.deepEqual(request.params, [TX_HASH]);
      return jsonRpcResponse(request.id, successfulJobReceipt());
    }
    if (request.method === "eth_call") {
      assert.equal(request.params[0].to.toLowerCase(), BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce);
      assert.equal(request.params[0].data, expectedGetJobData);
      assert.equal(request.params[1], "latest");
      return jsonRpcResponse(request.id, encodedJobResult());
    }
    assert.fail(`unexpected RPC method ${request.method}`);
  };

  const observation = await observeBnbApexKnownJobTransaction(
    { jobId: JOB_ID.toString(), txHash: TX_HASH.toUpperCase().replace("0X", "0x") },
    { fetchImpl, now: () => OBSERVED_AT },
  );

  assert.equal(observation.state, "OBSERVED");
  assert.equal(observation.access, "KNOWN_TX_AND_JOB_READ_ONLY");
  assert.equal(observation.jobId, "7");
  assert.equal(observation.txHash, TX_HASH);
  assert.equal(observation.transaction.success, true);
  assert.deepEqual(observation.transaction.matchingCommerceEvents, ["JobCreated"]);
  assert.equal(observation.transaction.blockNumber, BigInt("0x1234").toString());
  assert.deepEqual(observation.job, {
    id: "7",
    client: CLIENT,
    provider: PROVIDER,
    evaluator: getAddress(BNB_APEX_BSC_TESTNET_DEPLOYMENT.router),
    description: "Read-only evidence job",
    budgetBaseUnits: "1000000",
    expiredAtUnix: "1800000000",
    statusCode: 2,
    hook: getAddress(BNB_APEX_BSC_TESTNET_DEPLOYMENT.router),
    submittedAtUnix: "1799999000",
    deliverable: DELIVERABLE,
  });
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["eth_chainId", "eth_getTransactionReceipt", "eth_call"],
  );
});

test("known observation returns honest not-found/failed states and never reads a job without receipt proof", async () => {
  for (const [receipt, expectedState] of [
    [null, "NOT_FOUND"],
    [
      {
        transactionHash: TX_HASH,
        to: BNB_APEX_BSC_TESTNET_DEPLOYMENT.commerce,
        blockNumber: "0x2",
        status: "0x0",
        logs: [],
      },
      "FAILED_TRANSACTION",
    ],
  ]) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const request = decodeRpcRequest(url, init, calls);
      if (request.method === "eth_chainId") return jsonRpcResponse(request.id, "0x61");
      if (request.method === "eth_getTransactionReceipt") {
        return jsonRpcResponse(request.id, receipt);
      }
      assert.fail("getJob must not run without a successful bound receipt");
    };
    const observation = await observeBnbApexKnownJobTransaction(
      { jobId: JOB_ID, txHash: TX_HASH },
      { fetchImpl },
    );
    assert.equal(observation.state, expectedState);
    assert.equal(observation.job, null);
    assert.deepEqual(
      calls.map(({ method }) => method),
      ["eth_chainId", "eth_getTransactionReceipt"],
    );
  }
});

test("successful receipts fail closed without an allowlisted Commerce event for the requested job", async () => {
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "eth_chainId") return jsonRpcResponse(request.id, "0x61");
    if (request.method === "eth_getTransactionReceipt") {
      return jsonRpcResponse(request.id, successfulJobReceipt(8n));
    }
    assert.fail(`unexpected RPC method ${request.method}`);
  };

  await assert.rejects(
    observeBnbApexKnownJobTransaction(
      { jobId: JOB_ID, txHash: TX_HASH },
      { fetchImpl },
    ),
    (error) =>
      error instanceof BnbApexAdapterError && error.code === "APEX_JOB_TX_BINDING_MISSING",
  );
});

test("RPC origin and total observation time are bounded before any capability can widen", async () => {
  let calls = 0;
  await assert.rejects(
    observeBnbApexTestnetDeployment({
      rpcUrl: "https://example.invalid",
      fetchImpl: async () => {
        calls += 1;
        return jsonRpcResponse(1, "0x61");
      },
    }),
    (error) => error instanceof BnbApexAdapterError && error.code === "APEX_RPC_URL_REJECTED",
  );
  assert.equal(calls, 0);

  await assert.rejects(
    observeBnbApexTestnetDeployment({
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        }),
    }),
    (error) => error instanceof BnbApexAdapterError && error.code === "APEX_TIMEOUT",
  );
});

test("RPC reads stop and cancel a chunked response exactly once at the byte limit", async () => {
  const streamed = streamedResponse([
    new Uint8Array(700_000).fill(0x20),
    new Uint8Array(400_000).fill(0x20),
  ]);

  await assert.rejects(
    observeBnbApexTestnetDeployment({ fetchImpl: async () => streamed.response }),
    (error) =>
      error instanceof BnbApexAdapterError
      && error.code === "APEX_RPC_RESPONSE_TOO_LARGE",
  );
  assert.equal(streamed.cancellationCount(), 1);
});

test("RPC reads cancel rejected and unreadable response bodies exactly once", async () => {
  const cases = [
    {
      expectedCode: "APEX_RPC_HTTP_ERROR",
      streamed: streamedResponse([new TextEncoder().encode("provider failure")], { status: 502 }),
    },
    {
      expectedCode: "APEX_RPC_HTTP_INVALID",
      streamed: streamedResponse([new TextEncoder().encode("{}")], {
        headers: { "content-length": "invalid" },
      }),
    },
    {
      expectedCode: "APEX_RPC_RESPONSE_TOO_LARGE",
      streamed: streamedResponse([new TextEncoder().encode("{}")], {
        headers: { "content-length": "1048577" },
      }),
    },
    {
      expectedCode: "APEX_RPC_JSON_INVALID",
      streamed: streamedResponse([new Uint8Array([0xff])]),
    },
  ];

  for (const { expectedCode, streamed } of cases) {
    await assert.rejects(
      observeBnbApexTestnetDeployment({ fetchImpl: async () => streamed.response }),
      (error) => error instanceof BnbApexAdapterError && error.code === expectedCode,
    );
    assert.equal(streamed.cancellationCount(), 1, expectedCode);
  }
});
