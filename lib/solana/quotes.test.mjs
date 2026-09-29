import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assessJupiterOrderFreshness,
  fetchJupiterOrder,
  normalizeJupiterOrder,
  rawDelta,
  resolveJupiterSwapEndpoint,
} from "./quotes.ts";

const FIXTURE_PATH = join("lib", "solana", "fixtures", "jupiter-order-v2-sol-usdc.json");
const loadOrder = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const OBSERVED_AT = "2026-08-27T10:00:00.000Z";
const REVIEW_EXPIRES_AT = "2026-08-27T10:00:15.000Z";

test("production selection refuses before a request when the API key is absent", async () => {
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: null });
  assert.deepEqual(selection, {
    ok: false,
    code: "PRODUCTION_KEY_REQUIRED",
    reason: "Jupiter production access is not configured. Add RYNTRA_JUPITER_API_KEY or explicitly choose the labelled keyless fallback.",
  });

  let calls = 0;
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    { fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } },
  );
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "PRODUCTION_KEY_REQUIRED");
});

test("explicit keyless access is labelled degraded and never carries credentials", () => {
  const selection = resolveJupiterSwapEndpoint({ access: "degraded", apiKey: "jup_secret_that_must_not_be_used" });
  assert.equal(selection.ok, true);
  assert.equal(selection.access, "degraded");
  assert.equal(selection.tier, "lite");
  assert.match(selection.label, /degraded/i);
  assert.deepEqual(selection.authorizationHeaders(), {});
  assert.ok(!JSON.stringify(selection).includes("jup_secret"));
});

test("keyed production selects Swap API V2 and keeps the key out of serializable state", () => {
  const secret = "jup_secret_that_must_not_be_serialized";
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  assert.equal(selection.ok, true);
  assert.equal(selection.access, "production");
  assert.equal(selection.orderUrl, "https://api.jup.ag/swap/v2/order");
  assert.equal(selection.buildUrl, "https://api.jup.ag/swap/v2/build");
  assert.deepEqual(selection.authorizationHeaders(), { "x-api-key": secret });
  assert.ok(!JSON.stringify(selection).includes(secret));
});

test("a mutated endpoint cannot receive production credentials", async () => {
  const secret = "jup_origin_binding_sentinel";
  const resolved = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  assert.equal(resolved.ok, true);
  let headerCalls = 0;
  let fetchCalls = 0;
  const selection = {
    ...resolved,
    orderUrl: "https://attacker.invalid/swap/v2/order",
    authorizationHeaders: () => {
      headerCalls += 1;
      return { "x-api-key": secret };
    },
  };
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify(loadOrder()), { headers: { "content-type": "application/json" } });
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MALFORMED");
  assert.equal(headerCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("the captured keyed V2 order normalizes every ticket field without floating raw amounts", () => {
  const raw = loadOrder();
  const order = normalizeJupiterOrder(raw, {
    access: "production",
    latencyMs: 118,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  });

  assert.equal(order.schema, "ryntra.solana.jupiter-order-quote");
  assert.equal(order.schemaVersion, "1.0.0");
  assert.equal(order.inAmountRaw, raw.inAmount);
  assert.equal(order.outAmountRaw, raw.outAmount);
  assert.equal(order.minReceivedRaw, raw.otherAmountThreshold);
  assert.equal(order.platformFee.basisPoints, raw.platformFee.feeBps);
  assert.equal(order.platformFee.mint, raw.platformFee.feeMint);
  assert.equal(order.providerFee.amountRaw, null);
  assert.equal(order.providerFee.mint, null);
  assert.equal(order.priorityFeeLamports, "0");
  assert.equal(order.signatureFeeLamports, "0");
  assert.equal(order.rentFeeLamports, "0");
  assert.equal(order.ryntraFee.basisPoints, 0);
  assert.equal(order.ryntraFee.amountRaw, null);
  assert.equal(order.router, "dflow");
  assert.equal(order.mode, "ultra");
  assert.equal(order.requestId, raw.requestId);
  assert.equal(order.transactionBase64, null);
  assert.equal(order.providerExpiresAt, null);
  assert.equal(order.reviewExpiresAt, REVIEW_EXPIRES_AT);
  assert.equal(order.execution, "NOT_EXECUTED");
  assert.deepEqual(order.routeAffectingOptions, []);
  assert.match(order.source.label, /production/i);
  assert.deepEqual(order.route[0], {
    ammKey: raw.routePlan[0].swapInfo.ammKey,
    label: raw.routePlan[0].swapInfo.label,
    inputMint: raw.routePlan[0].swapInfo.inputMint,
    outputMint: raw.routePlan[0].swapInfo.outputMint,
    inAmountRaw: raw.routePlan[0].swapInfo.inAmount,
    outAmountRaw: raw.routePlan[0].swapInfo.outAmount,
    basisPoints: 10000,
  });
});

test("a V2 body missing fee, router, mode or request identity is malformed", () => {
  const raw = loadOrder();
  const meta = {
    access: "production",
    latencyMs: 1,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  };
  for (const key of ["platformFee", "prioritizationFeeLamports", "router", "mode", "requestId"]) {
    const broken = { ...raw };
    delete broken[key];
    assert.throws(() => normalizeJupiterOrder(broken, meta), new RegExp(key, "i"));
  }
});

test("quote-only normalization rejects an unexpected transaction and a route flood", () => {
  const meta = {
    access: "production",
    latencyMs: 1,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  };
  assert.throws(
    () => normalizeJupiterOrder({ ...loadOrder(), transaction: "unsigned-provider-bytes" }, meta),
    /transaction must be null/,
  );
  assert.throws(
    () => normalizeJupiterOrder({ ...loadOrder(), routePlan: Array.from({ length: 33 }, () => loadOrder().routePlan[0]) }, meta),
    /at most 32 hops/,
  );
});

test("order normalization preserves Jupiter's raw platform fee amount when it is present", () => {
  const raw = loadOrder();
  const order = normalizeJupiterOrder(
    {
      ...raw,
      platformFee: { ...raw.platformFee, amount: "200" },
    },
    {
      access: "production",
      latencyMs: 1,
      observedAt: OBSERVED_AT,
      reviewWindowMs: 15_000,
      sourceHost: "api.jup.ag",
      routeAffectingOptions: [],
    },
  );

  assert.equal(order.platformFee.amountRaw, "200");
  assert.throws(
    () => normalizeJupiterOrder(
      { ...raw, platformFee: { ...raw.platformFee, amount: "-1" } },
      {
        access: "production",
        latencyMs: 1,
        observedAt: OBSERVED_AT,
        reviewWindowMs: 15_000,
        sourceHost: "api.jup.ag",
        routeAffectingOptions: [],
      },
    ),
    /platformFee\.amount/,
  );
});

test("the order request uses one keyed V2 call and never puts the key in URL or result", async () => {
  const secret = "jup_secret_only_in_the_header";
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  const calls = [];
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), headers: init.headers });
        return new Response(JSON.stringify(loadOrder()), { status: 200, headers: { "content-type": "application/json" } });
      },
      now: () => new Date(OBSERVED_AT),
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.jup\.ag\/swap\/v2\/order\?/);
  assert.equal(new URL(calls[0].url).searchParams.get("amount"), "1000000");
  assert.deepEqual([...new URL(calls[0].url).searchParams.keys()].sort(), ["amount", "inputMint", "outputMint"]);
  assert.ok(!calls[0].url.includes(secret));
  assert.deepEqual(calls[0].headers, { "x-api-key": secret });
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("a provider response must match the exact requested pair and input amount", async () => {
  const request = {
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountRaw: "1000000",
  };
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: "jup_response_binding" });
  const mismatches = [
    { inputMint: "11111111111111111111111111111111" },
    { outputMint: "11111111111111111111111111111111" },
    { inAmount: "999999" },
  ];
  for (const mismatch of mismatches) {
    const result = await fetchJupiterOrder(request, selection, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ ...loadOrder(), ...mismatch }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      now: () => new Date(OBSERVED_AT),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "MALFORMED");
    assert.match(result.reason, /does not match the requested/i);
  }
});

test("a production failure makes one request and never falls back", async () => {
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: "jup_one_request" });
  let calls = 0;
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: "temporarily unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "HTTP_ERROR");
  assert.equal(result.access, "production");
});

test("a transport exception cannot echo production credentials", async () => {
  const secret = "jup_transport_echo_sentinel";
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async (_url, init) => {
        const echoed = new Headers(init?.headers).get("x-api-key") ?? "missing";
        throw new Error(`transport reflected x-api-key: ${echoed}`);
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNREACHABLE");
  assert.equal(result.reason, "Jupiter did not answer within the request deadline.");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("an authenticated provider error cannot echo the API key into a rendered failure", async () => {
  const secret = "jup_secret_echo_sentinel";
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async () => new Response(
        JSON.stringify({ error: `request header x-api-key: ${secret}`, errorCode: secret }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "REFUSED");
  assert.equal(result.errorCode, null);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.reason, "Jupiter refused the order with HTTP 401.");
});

test("malformed provider JSON cannot reflect credentials through parser text", async () => {
  const secret = "jup_malformed_json_echo_sentinel";
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: secret });
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async () =>
        new Response(`{"error":"${secret}`, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MALFORMED");
  assert.equal(result.reason, "Jupiter returned unreadable or malformed JSON.");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("an announced oversized V2 response is rejected before normalization", async () => {
  const selection = resolveJupiterSwapEndpoint({ access: "production", apiKey: "jup_bounded" });
  const result = await fetchJupiterOrder(
    { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" },
    selection,
    {
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(513 * 1024) },
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MALFORMED");
  assert.match(result.reason, /byte ceiling/);
});

test("freshness expires exactly at the local Review boundary and never invents provider expiry", () => {
  const order = normalizeJupiterOrder(loadOrder(), {
    access: "production",
    latencyMs: 1,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  });
  assert.equal(order.providerExpiresAt, null);
  assert.equal(assessJupiterOrderFreshness(order, new Date("2026-08-27T10:00:14.999Z")), "FRESH");
  assert.equal(assessJupiterOrderFreshness(order, new Date(REVIEW_EXPIRES_AT)), "EXPIRED");
});

test("provider expiry requires RFC3339 timezone evidence while numeric epochs remain explicit", () => {
  const meta = {
    access: "production",
    latencyMs: 1,
    observedAt: OBSERVED_AT,
    reviewWindowMs: 15_000,
    sourceHost: "api.jup.ag",
    routeAffectingOptions: [],
  };
  assert.throws(
    () => normalizeJupiterOrder({ ...loadOrder(), expireAt: "2026-08-27T10:00:05" }, meta),
    /explicit UTC or offset/i,
  );

  const offset = normalizeJupiterOrder({ ...loadOrder(), expireAt: "2026-08-27T12:00:05+02:00" }, meta);
  assert.equal(offset.providerExpiresAt, "2026-08-27T10:00:05.000Z");
  assert.equal(offset.reviewExpiresAt, "2026-08-27T10:00:05.000Z");

  const epochSeconds = Date.parse("2026-08-27T10:00:05.000Z") / 1000;
  const numeric = normalizeJupiterOrder({ ...loadOrder(), expireAt: epochSeconds }, meta);
  assert.equal(numeric.providerExpiresAt, "2026-08-27T10:00:05.000Z");
});

test("delta arithmetic remains exact string math", () => {
  assert.equal(rawDelta("104497", "104000"), "497");
  assert.equal(rawDelta("1000000000000000000000000", "1"), "999999999999999999999999");
});

test("no raw amount in the V2 adapter is parsed through a float", () => {
  const source = readFileSync(join("lib", "solana", "quotes.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/parseFloat/.test(source));
  assert.ok(!/Number\((?:raw\.(?:inAmount|outAmount|otherAmountThreshold)|[a-z]*[Aa]mount)/.test(source));
});
