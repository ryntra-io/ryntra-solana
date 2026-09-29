import assert from "node:assert/strict";
import test from "node:test";

import { fetchRelayFinishedRequest, RELAY_REQUESTS_V2_PATH, RELAY_REQUESTS_V3_PATH } from "./requests-api.ts";

/**
 * The part of the v2 → v3 migration that can be silently wrong is the field
 * mapping, not the fetch. A reader that quietly finds nothing reports a fill of
 * `null` and an uncollected fee — which looks exactly like a swap that paid no
 * fee, and would drain Rewards without a single error anywhere.
 *
 * So both shapes are exercised against the same underlying swap, and the two
 * readers must agree on every figure. The payloads below follow Relay's own
 * migration table: `appFees`/`paidAppFees` consolidated into
 * `data.appFees.{quoted,actual}`, amounts moved into `data.route.{actual,quoted}`,
 * `inTxs[].hash` renamed to `txHash`, and `?hash=` replaced by `depositTxHash`.
 */

const HASH = "43HixJti8n23UL9cqMVv7SawPSNzCqRyLDqcytny7aA1CszekfVr14rTnLXA8o3tvqw4rkssApto7CxnrnstVFr5";
const RECIPIENT = "0x9fc4e320a181e88644a302d11f1f158ef0699e37";

const v3CrossChain = {
  requests: [
    {
      id: "0xabc",
      status: "success",
      requestType: "Crosschain Swap",
      inTxs: [{ txHash: HASH }],
      data: {
        appFees: {
          currency: { symbol: "USDC", decimals: 6 },
          quoted: [{ recipient: RECIPIENT, bps: "25", amount: "12500", amountUsd: "0.012498" }],
          actual: [{ recipient: RECIPIENT, bps: "25", amount: "12500", amountUsd: "0.012498" }],
        },
        route: {
          quoted: { origin: { outputCurrency: { amountFormatted: "4.900000" } }, destination: { outputCurrency: { amountFormatted: "4.900000" } } },
          actual: { origin: { outputCurrency: { amountFormatted: "4.900000" } }, destination: { outputCurrency: { amountFormatted: "4.905699" } } },
        },
      },
    },
  ],
};

const v2SameSwap = {
  requests: [
    {
      id: "0xabc",
      status: "success",
      inTxs: [{ hash: HASH }],
      data: {
        appFees: [{ recipient: RECIPIENT, bps: "25", amount: "12500", amountUsd: "0.012498" }],
        appFeeCurrencyObject: { symbol: "USDC", decimals: 6 },
        paidAppFees: [{ recipient: RECIPIENT, bps: "25", amount: "12500", amountUsd: "0.012498" }],
        metadata: { currencyOut: { amountFormatted: "4.905699" } },
      },
    },
  ],
};

function stub(byPath) {
  const seen = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    seen.push(parsed);
    const body = byPath[parsed.pathname];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, seen };
}

test("v3 is asked when a key exists, by depositTxHash, and the fill comes from the executed route", async () => {
  const { fetchImpl, seen } = stub({ [RELAY_REQUESTS_V3_PATH]: v3CrossChain });
  const filled = await fetchRelayFinishedRequest(HASH, { fetchImpl, apiKey: "k" });

  assert.equal(seen.length, 1, "v2 must not be touched when v3 answers");
  assert.equal(seen[0].pathname, RELAY_REQUESTS_V3_PATH);
  assert.equal(seen[0].searchParams.get("depositTxHash"), HASH, "`?hash=` was removed in v3");
  assert.equal(filled.version, "v3");
  /* `actual` over `quoted`: the executed route is what arrived, and reading the
     quote back would report the promise rather than the payment. */
  assert.equal(filled.toAmount, "4.905699");
  assert.equal(filled.serviceFee.collected, true);
  assert.equal(filled.serviceFee.paidAmountRaw, "12500");
  assert.equal(filled.serviceFee.settlement.operationRef, HASH);
});

test("a same-chain request has no destination side, and falls back to the origin's output", async () => {
  /* The trap in the migration: reading only `destination` reports no amount at
     all for every same-chain swap, which reads as a swap that delivered nothing. */
  const sameChain = {
    requests: [
      {
        data: {
          appFees: { quoted: [{ amount: "12500" }], actual: [{ amount: "12500", amountUsd: "0.0125" }] },
          route: { actual: { origin: { outputCurrency: { amountFormatted: "0.049870864" } } } },
        },
      },
    ],
  };
  const { fetchImpl } = stub({ [RELAY_REQUESTS_V3_PATH]: sameChain });
  const filled = await fetchRelayFinishedRequest(HASH, { fetchImpl, apiKey: "k" });
  assert.equal(filled.toAmount, "0.049870864");
});

test("a quoted fee with nothing actually taken is not revenue", async () => {
  /* Relay's documented silent case, and the one at the centre of Rewards: below
     $0.025 a same-chain app fee is never collected, and the request still
     succeeds. `collected: false` beside a quoted figure is the correct answer. */
  const uncollected = {
    requests: [
      {
        data: {
          appFees: { quoted: [{ amount: "1200", amountUsd: "0.0012" }], actual: [] },
          route: { actual: { origin: { outputCurrency: { amountFormatted: "0.5" } } } },
        },
      },
    ],
  };
  const { fetchImpl } = stub({ [RELAY_REQUESTS_V3_PATH]: uncollected });
  const filled = await fetchRelayFinishedRequest(HASH, { fetchImpl, apiKey: "k" });
  assert.equal(filled.serviceFee.collected, false);
  assert.equal(filled.serviceFee.quotedUsd, 0.0012, "what was asked for stays on the record");
  assert.equal(filled.serviceFee.paidAmountRaw, null);
});

test("no key means no v3 call at all — it would only ever be refused", async () => {
  const { fetchImpl, seen } = stub({ [RELAY_REQUESTS_V2_PATH]: v2SameSwap });
  const filled = await fetchRelayFinishedRequest(HASH, { fetchImpl });
  assert.deepEqual(seen.map((u) => u.pathname), [RELAY_REQUESTS_V2_PATH]);
  assert.equal(filled.version, "v2");
});

test("the two readers agree on the same swap, which is the whole point of the migration", async () => {
  const viaV3 = await fetchRelayFinishedRequest(HASH, { fetchImpl: stub({ [RELAY_REQUESTS_V3_PATH]: v3CrossChain }).fetchImpl, apiKey: "k" });
  const viaV2 = await fetchRelayFinishedRequest(HASH, { fetchImpl: stub({ [RELAY_REQUESTS_V2_PATH]: v2SameSwap }).fetchImpl });
  assert.equal(viaV3.toAmount, viaV2.toAmount);
  assert.deepEqual(viaV3.serviceFee, viaV2.serviceFee, "a migration that changed a figure would change what Rewards accrues");
});

test("v3 failing falls back to v2 rather than losing the fill entirely", async () => {
  /* The endpoint is where Activity's actual output and every accrual come from,
     so a transient v3 failure must degrade to the deprecated reader rather than
     to silence. v2 is retired 2026-11-24 and this branch goes with it. */
  const { fetchImpl, seen } = stub({ [RELAY_REQUESTS_V2_PATH]: v2SameSwap });
  const filled = await fetchRelayFinishedRequest(HASH, { fetchImpl, apiKey: "k" });
  assert.deepEqual(seen.map((u) => u.pathname), [RELAY_REQUESTS_V3_PATH, RELAY_REQUESTS_V2_PATH]);
  assert.equal(filled.version, "v2");
});

test("a request nobody has indexed yet is null, never a zero fee", async () => {
  const { fetchImpl } = stub({});
  assert.equal(await fetchRelayFinishedRequest(HASH, { fetchImpl, apiKey: "k" }), null);
});

test("a quoted output is never reported as received when execution details are missing", async () => {
  const pending=structuredClone(v3CrossChain);
  delete pending.requests[0].data.route.actual;
  const filled=await fetchRelayFinishedRequest(HASH,{fetchImpl:stub({[RELAY_REQUESTS_V3_PATH]:pending}).fetchImpl,apiKey:"k"});
  assert.equal(filled.toAmount,null);
});

test("a cross-chain origin intermediate output cannot replace a missing destination fill", async () => {
  const pending=structuredClone(v3CrossChain);
  delete pending.requests[0].data.route.actual.destination;
  const filled=await fetchRelayFinishedRequest(HASH,{fetchImpl:stub({[RELAY_REQUESTS_V3_PATH]:pending}).fetchImpl,apiKey:"k"});
  assert.equal(filled.toAmount,null);
});

test("the collected fee keeps its own currency and stated rate", async () => {
  const result=await fetchRelayFinishedRequest(HASH,{fetchImpl:stub({[RELAY_REQUESTS_V3_PATH]:v3CrossChain}).fetchImpl,apiKey:"k"});
  assert.equal(result.serviceFee.currency.symbol,"USDC");
  assert.equal(result.serviceFee.currency.decimals,6);
  assert.equal(result.serviceFee.basisPoints,25);
});

test("missing actual fee data is unknown, not an assertion that nothing was collected", async () => {
  const missing=structuredClone(v3CrossChain);
  delete missing.requests[0].data.appFees.actual;
  const result=await fetchRelayFinishedRequest(HASH,{fetchImpl:stub({[RELAY_REQUESTS_V3_PATH]:missing}).fetchImpl,apiKey:"k"});
  assert.equal(result.serviceFee,null);
});
