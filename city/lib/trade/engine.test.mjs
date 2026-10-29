import { test } from "node:test";
import assert from "node:assert/strict";

import { createEngine, postJson } from "./engine.ts";
import { QUOTE, recorded, scriptedEngine, TAKER, WSOL, USDT } from "./test-fixtures.mjs";

const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const timers = { set: () => 0, clear: () => {} };

test("a success comes back whole; 202 is an answer too", async () => {
  const ok = await postJson(answer(200, QUOTE), "/x", {}, 1000, timers);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.order.outAmountRaw, "1500000");
  const later = await postJson(answer(202, { state: "SUBMITTED_UNKNOWN" }), "/x", {}, 1000, timers);
  assert.deepEqual(later, { ok: true, value: { state: "SUBMITTED_UNKNOWN" }, status: 202 });
});

test("a refusal carries the engine's code, words, boundary and lock", async () => {
  const locked = recorded("order refused: the owner holds a signature the server claimed");
  const refused = await postJson(answer(locked.status, locked.body), "/x", {}, 1000, timers);
  assert.equal(refused.ok, false);
  assert.equal(refused.failure.code, "OWNER_SWAP_LOCKED");
  assert.equal(refused.failure.ownerLock.signature, locked.body.error.ownerLock.signature);
  const expired = recorded("execute refused before submit: the Review window has closed");
  const before = await postJson(answer(expired.status, expired.body), "/x", {}, 1000, timers);
  assert.equal(before.failure.code, "ORDER_EXPIRED");
  assert.equal(before.failure.submitBoundary, "NOT_CROSSED");
  const bare = await postJson(answer(502, null), "/x", {}, 1000, timers);
  assert.equal(bare.failure.code, "HTTP_502");
});

test("a request that never arrives, or arrives cut off, is not a success", async () => {
  const lost = await postJson(async () => {
    throw new TypeError("fetch failed");
  }, "/x", {}, 1000, timers);
  assert.deepEqual(lost, { ok: false, failure: { code: "NETWORK", message: "The request did not complete." } });
  const cut = await postJson(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("cut"); } }), "/x", {}, 1000, timers);
  assert.equal(cut.failure.code, "NETWORK");
});

test("a request that hangs is stopped by its bound and says TIMEOUT", async () => {
  let fire = null;
  const hang = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      fire?.();
    });
  const result = postJson(hang, "/x", {}, 1000, { set: (run) => { fire = run; return 1; }, clear: () => {} });
  assert.deepEqual(await result, { ok: false, failure: { code: "TIMEOUT", message: "The server did not answer in time." } });
});

test("a price and an order are asked once more after a lost answer; an execute never is", async () => {
  const { engine, routes } = scriptedEngine({ quote: ["network", { status: 200, body: QUOTE }], execute: ["network", { status: 200, body: {} }] });
  const quoted = await engine.quote({ inputMint: WSOL, outputMint: USDT, amountRaw: "10000000" });
  assert.equal(quoted.ok, true);
  assert.equal(routes("quote").length, 2);
  const sent = await engine.execute({ bundle: {}, proof: {}, signedTransactionBase64: "AA==", reviewedTransactionBase64: "AA==" });
  assert.equal(sent.ok, false);
  assert.equal(routes("execute").length, 1);
});

test("the order names the taker and says it is a buy from the city's card", async () => {
  const { engine, calls } = scriptedEngine({ order: [{ status: 409, body: { error: { code: "ORDER_NO_ROUTE", message: "No route." } } }] });
  await engine.order({ inputMint: WSOL, outputMint: USDT, amountRaw: "10000000", taker: TAKER }, { surface: "SPOT", side: "BUY" });
  assert.deepEqual(calls[0].body, { input: { inputMint: WSOL, outputMint: USDT, amountRaw: "10000000", taker: TAKER }, origin: { surface: "SPOT", side: "BUY" } });
});

test("the engine is asked on this site's own routes", async () => {
  const urls = [];
  const engine = createEngine(async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({}) };
  }, { wait: async () => {}, timers });
  await engine.quote({ inputMint: WSOL, outputMint: USDT, amountRaw: "1" });
  await engine.order({ inputMint: WSOL, outputMint: USDT, amountRaw: "1", taker: TAKER });
  await engine.execute({ bundle: {}, proof: {}, signedTransactionBase64: "AA==", reviewedTransactionBase64: "AA==" });
  await engine.recover({ owner: TAKER, signature: "sig" });
  assert.deepEqual(urls, ["/api/solana/swap/quote", "/api/solana/swap/order", "/api/solana/swap/execute", "/api/solana/swap/recover"]);
});
