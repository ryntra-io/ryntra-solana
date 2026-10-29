import { test } from "node:test";
import assert from "node:assert/strict";

import { createExchangeEngine, getJson } from "./engine.ts";
import { AGAIN, refusalWords } from "./refusals.ts";
import { OWNER } from "./test-fixtures.mjs";

const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("reads are GETs of the engine's Phoenix routes, addressed as the routes validate them", async () => {
  const asked = [];
  const engine = createExchangeEngine(async (url, init) => {
    asked.push([init.method, url, init.body ?? null]);
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  await engine.markets();
  await engine.funding("SOL");
  await engine.book("SOL");
  await engine.candles("SOL", "1h");
  await engine.account(OWNER);
  await engine.orderStates(OWNER);
  await engine.collateralStates(OWNER);
  const history = await engine.history(OWNER, "funding", null);
  await engine.orderStatus(OWNER, "sig");
  await engine.collateralStatus("sig");
  await engine.reviewOrder({ kind: "cancelAll", owner: OWNER, symbol: "SOL" });
  await engine.submitOrder("ticket", ["wire"]);
  await engine.reviewCollateral({ action: "deposit", owner: OWNER, amount: "1000000" });
  await engine.submitCollateral("ticket", ["wire"]);
  assert.deepEqual(asked, [
    ["GET", "/api/solana/futures/markets", null],
    ["GET", "/api/solana/futures/funding?symbol=SOL", null],
    ["GET", "/api/solana/futures/book?symbol=SOL", null],
    ["GET", "/api/solana/futures/candles?symbol=SOL&tf=1h", null],
    ["GET", `/api/solana/futures/account?wallet=${OWNER}`, null],
    ["GET", `/api/solana/futures/orders?owner=${OWNER}`, null],
    ["GET", `/api/solana/futures/collateral?owner=${OWNER}`, null],
    ["GET", `/api/solana/futures/history?wallet=${OWNER}&kind=funding`, null],
    ["GET", `/api/solana/futures/orders/status?owner=${OWNER}&signatures=sig`, null],
    ["GET", "/api/solana/futures/collateral/status?signatures=sig", null],
    ["POST", "/api/solana/futures/orders/review", JSON.stringify({ kind: "cancelAll", owner: OWNER, symbol: "SOL" })],
    ["POST", "/api/solana/futures/orders/submit", JSON.stringify({ ticket: "ticket", signed: ["wire"] })],
    ["POST", "/api/solana/futures/collateral/review", JSON.stringify({ action: "deposit", owner: OWNER, amount: "1000000" })],
    ["POST", "/api/solana/futures/collateral/submit", JSON.stringify({ ticket: "ticket", signed: ["wire"] })],
  ]);
  assert.equal(history.value.kind, "funding");
});

test("a refused read keeps the engine's own code and words; no answer is NETWORK or the status", async () => {
  assert.deepEqual(await getJson(answer(404, { error: { code: "PHOENIX_NOT_FOUND", message: "Phoenix has no such market." } }), "/x", 1000), { ok: false, failure: { code: "PHOENIX_NOT_FOUND", message: "Phoenix has no such market." } });
  assert.equal((await getJson(answer(503, null), "/x", 1000)).failure.code, "HTTP_503");
  assert.equal((await getJson(async () => Promise.reject(new Error("offline")), "/x", 1000)).failure.code, "NETWORK");
  const late = await getJson((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))), "/x", 5);
  assert.equal(late.failure.code, "TIMEOUT");
  assert.deepEqual(await getJson(answer(200, { markets: [] }), "/x", 1000), { ok: true, value: { markets: [] }, status: 200 });
});

test("every refusal says that nothing was sent, in a person's words; an unknown code is said plainly", () => {
  const codes = ["ORDERS_CLOSED", "ACTIONS_CLOSED", "CANARY_LIMIT", "ORDERS_UNAVAILABLE", "TRADING_CLOSED", "MARKET_GATED", "ISOLATED_ONLY", "BELOW_MINIMUM", "LIMIT_FAR", "POST_ONLY_CROSS", "TP_SIDE", "SL_SIDE", "PRICE_UNKNOWN", "PHOENIX_UNAVAILABLE", "NOT_FILLABLE", "NO_POSITION", "BAD_REQUEST", "BUILD_REFUSED", "WALLET_REFUSED", "WALLET_MISMATCH", "TICKET_EXPIRED", "TICKET_INVALID", "SIGNED_MISMATCH", "NOT_SIGNED", "RELAY_REFUSED", "SOMETHING_NEW", "HTTP_502"];
  for (const code of codes) {
    assert.match(refusalWords(code), /Nothing was sent/, code);
    // The clean interface rule of 28.10: no technical words on screen.
    assert.doesNotMatch(refusalWords(code), /engine|relay|bytes|seal|server|request|ticket|Review|API|route/i, code);
  }
  assert.match(refusalWords("ACCOUNT_NEEDED"), /Phoenix opens accounts by invite/);
  assert.equal(refusalWords("SOMETHING_NEW"), "Not accepted right now. Nothing was sent.");
  assert.equal(AGAIN.has("TICKET_EXPIRED"), true);
  assert.equal(AGAIN.has("ORDERS_CLOSED"), false);
});
