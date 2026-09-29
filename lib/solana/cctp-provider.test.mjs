import assert from "node:assert/strict";
import test from "node:test";

import {
  CCTP_IRIS_MAINNET_ORIGIN,
  fetchCctpProviderSnapshot,
  normalizeCctpAllowance,
  normalizeCctpFees,
} from "./cctp-provider.ts";

const NOW = new Date("2026-08-27T13:00:00.000Z");

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function successfulFetch(calls = []) {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${CCTP_IRIS_MAINNET_ORIGIN}/v2/publicKeys`) {
      return json({ v2: { keys: ["public-key-present"] } });
    }
    if (url === `${CCTP_IRIS_MAINNET_ORIGIN}/v2/fastBurn/USDC/allowance`) {
      return json({ allowance: 123999.999999, lastUpdated: NOW.toISOString() });
    }
    if (url === `${CCTP_IRIS_MAINNET_ORIGIN}/v2/burn/USDC/fees/5/6`) {
      return json([
        { finalityThreshold: 1000, minimumFee: 1, forwardFee: { low: 90, medium: 110, high: 160 } },
        { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 90, medium: 110, high: 160 } },
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

test("allowance and fee responses normalize without float amount arithmetic", () => {
  assert.deepEqual(normalizeCctpAllowance({ allowance: 123999.999999, lastUpdated: NOW.toISOString() }), {
    allowanceUsdc: "123999.999999",
    allowanceRaw: "123999999999",
    lastUpdated: NOW.toISOString(),
  });
  assert.deepEqual(
    normalizeCctpFees([
      { finalityThreshold: 2000, minimumFee: 0 },
      { finalityThreshold: 1000, minimumFee: 1.3 },
    ]),
    [
      { mode: "FAST", finalityThreshold: 1000, minimumFeeBps: "1.3" },
      { mode: "STANDARD", finalityThreshold: 2000, minimumFeeBps: "0" },
    ],
  );
});

test("the provider snapshot calls only the pinned mainnet origin and exact three GET paths", async () => {
  const calls = [];
  const result = await fetchCctpProviderSnapshot(
    { direction: "SOLANA_TO_BASE" },
    { fetchImpl: successfulFetch(calls), now: () => NOW },
  );
  assert.equal(result.health, "HEALTHY");
  assert.equal(result.reason, null);
  assert.equal(result.publicKeys.state, "AVAILABLE");
  assert.equal(result.allowance.state, "AVAILABLE");
  assert.equal(result.fees.state, "AVAILABLE");
  assert.equal(result.fees.tiers[0].mode, "FAST");
  assert.deepEqual(calls.map((entry) => entry.url).sort(), [
    `${CCTP_IRIS_MAINNET_ORIGIN}/v2/burn/USDC/fees/5/6`,
    `${CCTP_IRIS_MAINNET_ORIGIN}/v2/fastBurn/USDC/allowance`,
    `${CCTP_IRIS_MAINNET_ORIGIN}/v2/publicKeys`,
  ].sort());
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.body, undefined);
  }
});

test("Cloudflare 1009 is environment unreachability, never provider refusal or reflected HTML", async () => {
  const fetchImpl = async () =>
    new Response("<html>error code: 1009 location private-value</html>", {
      status: 403,
      headers: { "content-type": "text/html", "content-length": "913697" },
    });
  const result = await fetchCctpProviderSnapshot(
    { direction: "BASE_TO_SOLANA" },
    { fetchImpl, now: () => NOW },
  );
  assert.equal(result.health, "UNAVAILABLE");
  assert.equal(result.reason, "UNREACHABLE_FROM_ENVIRONMENT");
  assert.equal(JSON.stringify(result).includes("private-value"), false);
});

test("an actual JSON 403 is REFUSED and a partial 429 degrades instead of becoming empty success", async () => {
  const refused = await fetchCctpProviderSnapshot(
    { direction: "SOLANA_TO_BASE" },
    { fetchImpl: async () => json({ code: "forbidden" }, { status: 403 }), now: () => NOW },
  );
  assert.equal(refused.health, "UNAVAILABLE");
  assert.equal(refused.reason, "REFUSED");

  const partial = await fetchCctpProviderSnapshot(
    { direction: "SOLANA_TO_BASE" },
    {
      now: () => NOW,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/allowance")) return json({ code: "slow" }, { status: 429 });
        if (url.endsWith("/publicKeys")) return json({ v2: { keys: ["present"] } });
        return json([
          { finalityThreshold: 1000, minimumFee: 1 },
          { finalityThreshold: 2000, minimumFee: 0 },
        ]);
      },
    },
  );
  assert.equal(partial.health, "DEGRADED");
  assert.equal(partial.reason, "RATE_LIMITED");
  assert.equal(partial.fees.state, "AVAILABLE");
  assert.equal(partial.allowance.state, "UNAVAILABLE");
});

test("malformed, non-JSON and oversized success responses become UNKNOWN", async () => {
  for (const response of [
    () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(300_000) },
    }),
  ]) {
    const result = await fetchCctpProviderSnapshot(
      { direction: "SOLANA_TO_BASE" },
      { fetchImpl: async () => response(), now: () => NOW },
    );
    assert.equal(result.health, "UNKNOWN");
    assert.equal(result.reason, "MALFORMED_RESPONSE");
  }
});

test("missing one required fee tier fails closed", () => {
  assert.throws(
    () => normalizeCctpFees([{ finalityThreshold: 2000, minimumFee: 0 }]),
    /FAST and Standard/i,
  );
});
