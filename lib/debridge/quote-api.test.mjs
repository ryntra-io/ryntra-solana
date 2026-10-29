import assert from "node:assert/strict";
import test from "node:test";

import { bpsAsPercent, buildDebridgeQuoteUrl, fetchDebridgeQuote } from "./quote-api.ts";

const SOLANA_KEY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const ask = { fromNetwork: "solana", fromToken: "11111111111111111111111111111111", toNetwork: "arc", toToken: "0x0000000000000000000000000000000000000000", amountRaw: "100000000" };

test("basis points as deBridge's percentage", () => {
  assert.equal(bpsAsPercent(25), "0.25");
  assert.equal(bpsAsPercent(100), "1");
  assert.equal(bpsAsPercent(5), "0.05");
  assert.equal(bpsAsPercent(150), "1.5");
  assert.throws(() => bpsAsPercent(2.5));
  assert.throws(() => bpsAsPercent(1_001));
});

test("the URL names both chains by deBridge's ids and never raises the amount", () => {
  const url = new URL(buildDebridgeQuoteUrl({ ...ask, affiliate: { recipient: SOLANA_KEY, bps: 25 } }));
  assert.equal(url.pathname, "/v1.0/dln/order/create-tx");
  assert.equal(url.searchParams.get("srcChainId"), "7565164");
  assert.equal(url.searchParams.get("dstChainId"), "5042");
  assert.equal(url.searchParams.get("srcChainTokenInAmount"), "100000000");
  assert.equal(url.searchParams.get("dstChainTokenOutAmount"), "auto");
  assert.equal(url.searchParams.get("prependOperatingExpenses"), "false");
  assert.equal(url.searchParams.get("affiliateFeePercent"), "0.25");
});

test("an affiliate key of the wrong chain is not sent; an unknown chain is not asked", () => {
  const url = new URL(buildDebridgeQuoteUrl({ ...ask, affiliate: { recipient: "0x000000000000000000000000000000000000dEaD", bps: 25 } }));
  assert.equal(url.searchParams.get("affiliateFeeRecipient"), null);
  assert.equal(buildDebridgeQuoteUrl({ ...ask, toNetwork: "starknet" }), null);
  assert.equal(buildDebridgeQuoteUrl({ ...ask, toNetwork: "solana" }), null);
  assert.equal(buildDebridgeQuoteUrl({ ...ask, amountRaw: "0" }), null);
});

test("deBridge's refusals keep their meaning: no route is a market answer, a fault is not", async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const noRoute = await fetchDebridgeQuote(ask, { fetchImpl: reply(400, { errorCode: 2, errorId: "INVALID_QUERY_PARAMETERS", errorMessage: "The token you provided as dstChainTokenOut is not supported" }) });
  assert.deepEqual([noRoute.ok, noRoute.code, noRoute.providerCode], [false, "NO_ROUTE", "INVALID_QUERY_PARAMETERS"]);
  const limited = await fetchDebridgeQuote(ask, { fetchImpl: reply(429, {}) });
  assert.equal(limited.code, "RATE_LIMITED");
  const broken = await fetchDebridgeQuote(ask, { fetchImpl: reply(502, { errorId: "INTERNAL" }) });
  assert.equal(broken.code, "HTTP_ERROR");
  const silent = await fetchDebridgeQuote(ask, { fetchImpl: async () => { throw new Error("timeout"); } });
  assert.equal(silent.code, "TRANSPORT");
  const notServed = await fetchDebridgeQuote({ ...ask, toNetwork: "starknet" }, { fetchImpl: async () => assert.fail("not asked") });
  assert.equal(notServed.code, "NOT_SERVED");
});
