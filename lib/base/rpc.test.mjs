import assert from "node:assert/strict";
import test from "node:test";

import { BASE_MAINNET_CHAIN_ID, ETHEREUM_MAINNET_CHAIN_ID, EVM_CHAIN_IDS, abiAddressWord, baseEthCall, baseRpcCall, createBaseRpcHandle, createEvmRpcHandle, evmChainProfile, evmChainProfileByRef, hexQuantityToDecimal, readBaseBlockNumber, readBaseErc20Balance, readBaseLogs } from "./rpc.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const result = (value) => json({ jsonrpc: "2.0", id: 1, result: value });
const rpcError = (message, code = -32000) => json({ jsonrpc: "2.0", id: 1, error: { code, message } });

/** Records every call and answers per host. */
function stubFetch(byHost) {
  const calls = [];
  const impl = async (url, init) => {
    const host = new URL(String(url)).host;
    const body = JSON.parse(String(init.body));
    calls.push({ host, method: body.method, params: body.params });
    const answer = byHost[host];
    if (!answer) throw new Error(`no stub for ${host}`);
    const value = typeof answer === "function" ? answer(body) : answer;
    if (value instanceof Error) throw value;
    return value;
  };
  impl.calls = calls;
  return impl;
}

const handleWith = (fetchImpl, options = {}) =>
  createBaseRpcHandle({ env: {}, fetchImpl, ...options });

test("the default endpoints are three different operators, each with its own limits", () => {
  const handle = createBaseRpcHandle({ env: {} });
  assert.equal(handle.chainId, BASE_MAINNET_CHAIN_ID);
  assert.equal(handle.endpoints.length, 3);
  const operators = handle.endpoints.map((entry) => entry.operator);
  assert.equal(new Set(operators).size, 3, "a fallback that shares an operator is not a fallback");

  const [primary, fallback, independent] = handle.endpoints;
  assert.equal(primary.host, "mainnet.base.org");
  assert.equal(primary.maxLogRangeBlocks, 10_000);
  assert.equal(fallback.host, "base.drpc.org");
  assert.equal(fallback.maxLogRangeBlocks, 5_000, "10,000 is accepted there and then times out");
  /* Measured by binary search against the live chain: head-99 answers and
     head-100 refuses. Recorded because a fallback that silently holds no
     history is worse than no fallback. */
  assert.equal(independent.host, "base-rpc.publicnode.com");
  assert.equal(independent.history, "RECENT_ONLY");
  assert.equal(independent.recentBlockDepth, 100);
});

test("an archive-only handle drops the endpoint that holds no history", () => {
  const handle = createBaseRpcHandle({ env: {}, requireArchive: true });
  assert.equal(handle.endpoints.length, 2);
  assert.equal(
    handle.endpoints.some((entry) => entry.history === "RECENT_ONLY"),
    false,
  );
});

/**
 * Ethereum on the same handle, 2026-09-05.
 *
 * The three endpoints and their limits were measured against the live chain
 * with `MessageTransmitterV2` log queries the day they were written down:
 * Tenderly answered 50,000 blocks, MEV Blocker refused 50,000 and answered
 * 10,000, PublicNode answered 100 and refused 1,000 as an archive request.
 * Nothing about the Base handle changed, which the first test above proves.
 */
test("an Ethereum handle is three different operators with their own measured limits, and Base is untouched", () => {
  const handle = createEvmRpcHandle("ethereum", { env: {} });
  assert.equal(handle.chainId, ETHEREUM_MAINNET_CHAIN_ID);
  assert.equal(handle.chain.id, "ethereum");
  assert.equal(handle.chain.chainRef, "eip155:1");
  assert.equal(handle.chain.chainIdHex, "0x1");
  assert.equal(handle.endpoints.length, 3);
  assert.equal(new Set(handle.endpoints.map((entry) => entry.operator)).size, 3);
  const [primary, fallback, independent] = handle.endpoints;
  assert.equal(primary.host, "mainnet.gateway.tenderly.co");
  assert.equal(primary.history, "ARCHIVE");
  assert.equal(primary.maxLogRangeBlocks, 10_000);
  assert.equal(fallback.host, "rpc.mevblocker.io");
  assert.equal(fallback.maxLogRangeBlocks, 10_000);
  assert.equal(independent.host, "ethereum-rpc.publicnode.com");
  assert.equal(independent.history, "RECENT_ONLY");
  assert.equal(independent.recentBlockDepth, 100);

  /* The Base handle is what it always was, with its chain now said out loud. */
  const base = createBaseRpcHandle({ env: {} });
  assert.equal(base.chain.id, "base");
  assert.equal(base.chain.chainRef, "eip155:8453");
  assert.equal(base.chain.chainIdHex, "0x2105");
  assert.deepEqual(base.endpoints.map((entry) => entry.host), ["mainnet.base.org", "base.drpc.org", "base-rpc.publicnode.com"]);
  assert.deepEqual(createBaseRpcHandle({ env: {}, chain: "base" }).endpoints, base.endpoints);
  assert.equal(evmChainProfile("ethereum").explorerTxUrl("0xabc"), "https://etherscan.io/tx/0xabc");
  assert.equal(evmChainProfile("base").explorerTxUrl("0xabc"), "https://basescan.org/tx/0xabc");
  assert.equal(evmChainProfileByRef("eip155:1")?.id, "ethereum");
  /* Chain 4663 used to be this test's example of a chain the module does not
     serve. `RYN-SOL-MONEY-FLOWS-001H` gave it a handle for the swap lane, so
     the negative case moved to a chain nothing here reads. Serving it over RPC
     is not the same as bridging to it: it has no Circle domain and no USDC,
     and `CCTP_EVM_CHAINS` — not this list — is what the bridge asks. */
  assert.equal(evmChainProfileByRef("eip155:4663")?.id, "robinhood");
  assert.equal(evmChainProfile("robinhood").explorerTxUrl("0xabc"), "https://robinhoodchain.blockscout.com/tx/0xabc");
  /* Polygon was this test's example of a chain nothing here reads, and stopped
     being one on 2026-09-10 when Bridge gained it. The negative case moves to a
     chain this module genuinely does not serve rather than being deleted — the
     property being pinned is that `evmChainProfileByRef` answers null for an
     unknown reference, not that any particular chain is unknown forever. */
  assert.equal(evmChainProfileByRef("eip155:137")?.id, "polygon");
  assert.equal(evmChainProfileByRef("eip155:43114"), null, "Avalanche is not served here");
});

test("a chain a handle can read is not thereby a chain the bridge can reach", async () => {
  const { CCTP_EVM_CHAINS, isEvmChain } = await import("../solana/cctp-direction.ts");
  /* The defect this closes would be silent: for two chains "an EVM chain a
     handle names" and "a chain Circle serves" were the same set, so nothing
     had to say which one it meant. Robinhood Chain made them differ. */
  assert.deepEqual([...CCTP_EVM_CHAINS], ["base", "ethereum"]);
  assert.equal(isEvmChain("robinhood"), false, "the bridge does not serve chain 4663");
  assert.equal(EVM_CHAIN_IDS.includes("robinhood"), true, "but a handle does read it");
});

test("Ethereum overrides live under their own variables and never leak into Base's", () => {
  const env = { RYNTRA_ETHEREUM_RPC_MAINNET: "https://eth.example.test/v1/key" };
  const ethereum = createEvmRpcHandle("ethereum", { env });
  assert.equal(ethereum.endpoints[0].host, "eth.example.test");
  assert.equal(ethereum.endpoints[0].operator, "configured");
  const base = createBaseRpcHandle({ env });
  assert.equal(base.endpoints[0].host, "mainnet.base.org", "an Ethereum override must not move Base's primary");
  const archive = createEvmRpcHandle("ethereum", { env: {}, requireArchive: true });
  assert.equal(archive.endpoints.length, 2);
  assert.equal(archive.endpoints.some((entry) => entry.history === "RECENT_ONLY"), false);
});

test("a failure names the chain that was asked, not Base by habit", async () => {
  const fetchImpl = stubFetch({
    "mainnet.gateway.tenderly.co": new Error("timeout"),
    "rpc.mevblocker.io": new Error("dns"),
    "ethereum-rpc.publicnode.com": new Error("refused"),
  });
  const read = await baseRpcCall(createEvmRpcHandle("ethereum", { env: {}, fetchImpl }), "eth_chainId");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.match(read.reason, /^No Ethereum endpoint answered eth_chainId/);
  assert.deepEqual(
    read.attempts.map((entry) => entry.host),
    ["mainnet.gateway.tenderly.co", "rpc.mevblocker.io", "ethereum-rpc.publicnode.com"],
  );
});

test("an https override replaces its role and anything else is ignored", () => {
  const configured = createBaseRpcHandle({
    env: { RYNTRA_BASE_RPC_MAINNET: "https://base.example.test/v1/key" },
  });
  assert.equal(configured.endpoints[0].host, "base.example.test");
  assert.equal(configured.endpoints[0].operator, "configured");

  const insecure = createBaseRpcHandle({ env: { RYNTRA_BASE_RPC_MAINNET: "http://base.example.test" } });
  assert.notEqual(insecure.endpoints[0]?.host, "base.example.test");

  const nonsense = createBaseRpcHandle({ env: { RYNTRA_BASE_RPC_MAINNET: "not a url" } });
  assert.equal(nonsense.endpoints.length, 2, "an unusable override removes its role rather than guessing one");
});

test("a transport failure moves to the next operator", async () => {
  const fetchImpl = stubFetch({
    "mainnet.base.org": new Error("socket hang up"),
    "base.drpc.org": result("0x3061b8c"),
  });
  const read = await readBaseBlockNumber(handleWith(fetchImpl));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.value, "50731916");
  assert.equal(read.endpoint.host, "base.drpc.org", "which operator answered travels with the answer");
  assert.equal(fetchImpl.calls.length, 2);
});

test("a JSON-RPC answer is not retried on a second operator", async () => {
  /* The chain answered and said no. Asking somebody else the same question
     would turn one clear refusal into an ambiguous sweep. */
  const fetchImpl = stubFetch({
    "mainnet.base.org": rpcError("execution reverted"),
    "base.drpc.org": result("0x1"),
  });
  const read = await baseEthCall(handleWith(fetchImpl), { to: `0x${"11".repeat(20)}`, data: "0xdeadbeef" });
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "RPC_ERROR");
  assert.equal(fetchImpl.calls.length, 1, "no second operator was asked");
});

test("every endpoint that was asked is reported, never collapsed into one failure", async () => {
  const fetchImpl = stubFetch({
    "mainnet.base.org": new Error("timeout"),
    "base.drpc.org": new Error("dns"),
    "base-rpc.publicnode.com": new Error("refused"),
  });
  const read = await baseRpcCall(handleWith(fetchImpl), "eth_chainId");
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.attempts.length, 3);
  assert.deepEqual(
    read.attempts.map((entry) => entry.host),
    ["mainnet.base.org", "base.drpc.org", "base-rpc.publicnode.com"],
  );
});

test("a log span is checked against each endpoint's own ceiling before it is asked", async () => {
  const fetchImpl = stubFetch({ "mainnet.base.org": result([]), "base.drpc.org": result([]) });
  const handle = handleWith(fetchImpl);

  /* 8,000 blocks: only the Base endpoint serves it. */
  await readBaseLogs(handle, { address: `0x${"22".repeat(20)}`, topics: [], fromBlock: 1n, toBlock: 8_000n });
  assert.deepEqual(
    fetchImpl.calls.map((entry) => entry.host),
    ["mainnet.base.org"],
    "the 5,000-block operator is never asked a question it cannot answer",
  );
});

test("a span wider than every operator refuses without a request", async () => {
  const fetchImpl = stubFetch({});
  const read = await readBaseLogs(handleWith(fetchImpl), {
    address: `0x${"22".repeat(20)}`,
    topics: [],
    fromBlock: 1n,
    toBlock: 50_000n,
  });
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "RANGE_UNSUPPORTED");
  assert.match(read.reason, /the widest answers 10000/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a range refusal moves on, because it belongs to the endpoint and not to the chain", async () => {
  const fetchImpl = stubFetch({
    "mainnet.base.org": rpcError("eth_getLogs is limited to a 10,000 range", -32614),
    "base.drpc.org": result([]),
  });
  const read = await readBaseLogs(handleWith(fetchImpl), {
    address: `0x${"22".repeat(20)}`,
    topics: [],
    fromBlock: 1n,
    toBlock: 4_000n,
  });
  assert.equal(read.ok, true);
  assert.equal(fetchImpl.calls.length, 2);
});

test("the balance request is the ERC-20 call, and the answer is base units", async () => {
  const owner = "0x152d11000000000000000000000000000000c401";
  const fetchImpl = stubFetch({
    "mainnet.base.org": () => result(`0x${(1_000n).toString(16).padStart(64, "0")}`),
  });
  const read = await readBaseErc20Balance(handleWith(fetchImpl), {
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    owner,
  });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const [call] = fetchImpl.calls;
  assert.equal(call.method, "eth_call");
  assert.equal(call.params[0].data, `0x70a08231${"0".repeat(24)}${owner.slice(2).toLowerCase()}`);
  assert.equal(call.params[1], "latest");
  /* 1000 base units. USDC has six decimals, so this is 0.001 — the scaling
     belongs to the caller, because a scaled number with no decimals attached
     is how a balance ends up a million times wrong. */
  assert.equal(read.value, "1000");
});

test("an address that is not twenty bytes never reaches the network", async () => {
  const fetchImpl = stubFetch({});
  const read = await readBaseErc20Balance(handleWith(fetchImpl), { token: `0x${"33".repeat(20)}`, owner: "0xnope" });
  assert.equal(read.ok, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a result that is not a hex quantity is malformed rather than zero", async () => {
  const fetchImpl = stubFetch({ "mainnet.base.org": result("nonsense"), "base.drpc.org": result("nonsense") });
  const read = await readBaseBlockNumber(handleWith(fetchImpl));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.code, "MALFORMED_RESPONSE");
});

test("an HTTP error and a missing result are each their own failure", async () => {
  const httpFail = stubFetch({
    "mainnet.base.org": json({}, 502),
    "base.drpc.org": json({}, 502),
    "base-rpc.publicnode.com": json({}, 502),
  });
  const first = await baseRpcCall(handleWith(httpFail), "eth_chainId");
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "HTTP_ERROR");

  const noResult = stubFetch({
    "mainnet.base.org": json({ jsonrpc: "2.0", id: 1 }),
    "base.drpc.org": json({ jsonrpc: "2.0", id: 1 }),
    "base-rpc.publicnode.com": json({ jsonrpc: "2.0", id: 1 }),
  });
  const second = await baseRpcCall(handleWith(noResult), "eth_chainId");
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.code, "MALFORMED_RESPONSE");
});

test("hex quantities and ABI address words are converted, never guessed", () => {
  assert.equal(hexQuantityToDecimal("0x0"), "0");
  assert.equal(hexQuantityToDecimal("0x3061b8c"), "50731916");
  assert.equal(hexQuantityToDecimal("50749452"), null);
  assert.equal(hexQuantityToDecimal(null), null);
  assert.equal(hexQuantityToDecimal("0x"), null);

  assert.equal(abiAddressWord("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), `${"0".repeat(24)}833589fcd6edb6e08f4c7c32d4f71b54bda02913`);
  assert.equal(abiAddressWord("0x8335"), null);
});

test("nothing in this module can write", async () => {
  const source = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("./rpc.ts", import.meta.url), "utf8"),
  );
  /* Comments name the write methods in order to say they are absent, so the
     check reads the code rather than the prose about it. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_sign"]) {
    assert.equal(code.includes(forbidden), false, `${forbidden} has no place in a read-only module`);
  }
});
