import assert from "node:assert/strict";
import test from "node:test";

import { fetchRawMintAccounts, MINT_BATCH_LIMIT } from "./mint-batch.ts";
import { createSolanaRpcHandle } from "./rpc.ts";

/**
 * Many mints in few reads. The universe warms its mint cache this way on a
 * cold start; the batch size is the one every endpoint on the public list
 * accepts, and a refused batch fails only its own mints.
 */

const PRIMARY = "https://primary.example/rpc";
const FALLBACK = "https://fallback.example/rpc";
const OWNER = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function mintAddress(index) {
  /* Distinct base58 addresses of a plausible length; the transport does not validate them. */
  return `Mint${String(index).padStart(3, "0")}${"1".repeat(37)}`;
}

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ host: new URL(url).host, method: body.method, count: body.params?.[0]?.length ?? 0 });
    return handler(body, new URL(url).host);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const answer = (body, values) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 400 }, value: values } }), { status: 200, headers: { "content-type": "application/json" } });

test("mints are read ten at a time, every mint lands in its own slot, and an unknown account is a stated failure", async () => {
  const mints = Array.from({ length: 23 }, (_, index) => mintAddress(index));
  const stub = stubFetch((body) => {
    const batch = body.params[0];
    return answer(
      body,
      batch.map((mint, index) => (mint === mints[5] ? null : { owner: OWNER, data: [Buffer.from(`data-${index}`).toString("base64"), "base64"], lamports: 1, executable: false, rentEpoch: 0, space: 82 })),
    );
  });
  try {
    const handle = createSolanaRpcHandle({ network: "mainnet", endpoint: PRIMARY, fallbackEndpoint: FALLBACK, timeoutMs: 200, retries: 0 });
    const out = await fetchRawMintAccounts(handle, [...mints, mints[0]]);
    assert.equal(MINT_BATCH_LIMIT, 10);
    assert.deepEqual(stub.calls.map((call) => call.count), [10, 10, 3]);
    assert.ok(stub.calls.every((call) => call.method === "getMultipleAccounts"));
    assert.equal(out.size, 23);
    const first = out.get(mints[0]);
    assert.ok(first && !("ok" in first));
    assert.equal(first.owner, OWNER);
    assert.equal(first.slot, "400");
    assert.equal(first.mint, mints[0]);
    const missing = out.get(mints[5]);
    assert.deepEqual(missing.ok, false);
    assert.equal(missing.code, "ACCOUNT_NOT_FOUND");
  } finally {
    stub.restore();
  }
});

test("a refused batch fails only its own mints; the batches around it still answer", async () => {
  const mints = Array.from({ length: 25 }, (_, index) => mintAddress(index));
  const stub = stubFetch((body, host) => {
    const batch = body.params[0];
    if (batch[0] === mints[10]) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Request blocked" } }), { status: 403, headers: { "content-type": "application/json" } });
    return answer(body, batch.map((_, index) => ({ owner: OWNER, data: [Buffer.from(`d${index}${host}`).toString("base64"), "base64"], lamports: 1, executable: false, rentEpoch: 0, space: 82 })));
  });
  try {
    const handle = createSolanaRpcHandle({ network: "mainnet", endpoint: PRIMARY, fallbackEndpoint: FALLBACK, timeoutMs: 200, retries: 0 });
    const out = await fetchRawMintAccounts(handle, mints);
    assert.equal(out.size, 25);
    assert.equal(out.get(mints[10]).ok, false);
    assert.equal(out.get(mints[10]).code, "RPC_FAILED");
    assert.equal(out.get(mints[19]).code, "RPC_FAILED");
    assert.ok(!("ok" in out.get(mints[9])));
    assert.ok(!("ok" in out.get(mints[20])));
  } finally {
    stub.restore();
  }
});
