import { test } from "node:test";
import assert from "node:assert/strict";

import { cancelLimit, limitRefusal, placeLimit, reviewLimit, sameTerms } from "./limits.ts";
import { INTENT, ORDER_KEY, OWNER, review, scriptedLimits, stubWallet, USDC_MINT, WIF } from "./limit-fixtures.mjs";

// Limit orders through the engine's limits lane: the exact Review, the wallet's one signature, one relay, and every
// unclear answer read back rather than placed twice. The engine and the wallet are stubs.

const T = Date.parse("2026-10-28T10:00:00.000Z");
const clock = (start = T) => {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
};
const PLACED = { status: 200, body: { state: "OPEN", signature: "sigPlace", settled: true } };

test("the engine is asked on this site's own limits routes, with the city's venue and the person's terms", async () => {
  const { api, calls } = scriptedLimits({ market: [{ status: 200, body: { price: 2.6 } }], review: [{ status: 200, body: { review: review() } }], orders: [{ status: 200, body: { orders: [], tokens: {}, complete: true } }], cancel: [{ status: 200, body: { transactionBase64: "AA==", requestId: "c1" } }], submit: [PLACED] });
  await api.market({ owner: OWNER, baseMint: WIF, quoteMint: USDC_MINT });
  await api.review(INTENT);
  await api.orders(OWNER);
  await api.cancel({ owner: OWNER, venue: "trigger", order: ORDER_KEY });
  assert.deepEqual(
    calls.map((call) => call.url),
    ["/api/solana/limits/market", "/api/solana/limits/review", "/api/solana/limits/orders", "/api/solana/limits/cancel"],
  );
  assert.deepEqual(calls[1].body, { owner: OWNER, venue: "trigger", side: "buy", baseMint: WIF, quoteMint: USDC_MINT, amount: "25", price: "2.5", quoteUsd: 1 });
});

test("a Review is the engine's own, for this pair and side; a refusal is said in the person's words", async () => {
  const time = clock();
  const ok = scriptedLimits({ review: [{ status: 200, body: { review: review() } }] });
  const ready = await reviewLimit(INTENT, { api: ok.api, sign: async () => ({ ok: false, reason: "" }), now: time.now });
  assert.equal(ready.kind, "ready");
  assert.equal(ready.review.takingRaw, "10000000");
  assert.equal(ready.receivedAt, T);

  const other = scriptedLimits({ review: [{ status: 200, body: { review: review({ side: "sell" }) } }] });
  assert.equal((await reviewLimit(INTENT, { api: other.api, sign: async () => ({ ok: false, reason: "" }), now: time.now })).refusal.code, "REVIEW_UNREADABLE");

  const small = scriptedLimits({ review: [{ status: 400, body: { error: { code: "BELOW_MINIMUM", message: "Jupiter takes orders from 5 USD." } } }] });
  const refused = await reviewLimit(INTENT, { api: small.api, sign: async () => ({ ok: false, reason: "" }), now: time.now });
  assert.deepEqual(refused.refusal, { code: "BELOW_MINIMUM", message: "Limit orders start at 5 USD.", retryable: true });
  assert.equal(limitRefusal({ code: "SOMETHING_NEW", message: "x" }).message, "The order could not be built right now. Nothing was sent.");
});

test("one tap: the wallet signs the Review on screen and the engine relays it once, with the reviewed terms", async () => {
  const time = clock();
  const { api, routes } = scriptedLimits({ submit: [PLACED] });
  const wallet = stubWallet();
  const phases = [];
  const outcome = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api, sign: wallet.sign, now: time.now, onPhase: (phase) => phases.push(phase) });
  assert.deepEqual(outcome, { kind: "placed", state: "OPEN", signature: "sigPlace", settled: true });
  assert.deepEqual(wallet.shown, ["AQID"]);
  assert.deepEqual(phases, ["wallet", "sending"]);
  const sent = routes("submit")[0].body;
  assert.equal(sent.kind, "place");
  assert.equal(sent.signedTransactionBase64, "AQIDSIGNED");
  assert.equal(sent.requestId, "req-1");
  assert.deepEqual(sent.terms, {
    side: "buy",
    baseMint: WIF,
    quoteMint: USDC_MINT,
    inputMint: USDC_MINT,
    outputMint: WIF,
    makingRaw: "25000000",
    takingRaw: "10000000",
    price: "2.5",
    fillPrice: 2.4752475,
    pool: null,
    fee: { ryntraBps: 100, venueBps: 0, account: "Fee1111111111111111111111111111111111111111" },
  });
});

test("bytes too old for a wallet are built again: the same order goes to the wallet, a changed one is shown first", async () => {
  const time = clock();
  time.advance(20_000);
  const same = scriptedLimits({ review: [{ status: 200, body: { review: review({ transactionBase64: "BBBB" }) } }], submit: [PLACED] });
  const wallet = stubWallet();
  const placed = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: same.api, sign: wallet.sign, now: time.now });
  assert.equal(placed.kind, "placed");
  assert.deepEqual(wallet.shown, ["BBBB"], "the fresh bytes, never the dying ones");

  const moved = scriptedLimits({ review: [{ status: 200, body: { review: review({ fee: { ...review().fee, ryntraBps: 50 } }) } }], submit: [PLACED] });
  const quiet = stubWallet();
  const shown = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: moved.api, sign: quiet.sign, now: time.now });
  assert.equal(shown.kind, "review");
  assert.equal(shown.review.fee.ryntraBps, 50);
  assert.equal(quiet.shown.length, 0);
  assert.equal(moved.routes("submit").length, 0);
  assert.ok(sameTerms(review(), review({ transactionBase64: "X", requestId: "other" })));
  assert.ok(!sameTerms(review(), review({ takingRaw: "9999999" })));
});

test("a wallet that answers after the bytes' life sends nothing; a wallet that says no sends nothing", async () => {
  const time = clock();
  const late = scriptedLimits({ review: [{ status: 200, body: { review: review() } }], submit: [PLACED] });
  const slow = stubWallet([() => time.advance(30_000)]);
  const outcome = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: late.api, sign: slow.sign, now: time.now });
  assert.equal(outcome.kind, "review");
  assert.match(outcome.note, /Nothing was sent/);
  assert.equal(late.routes("submit").length, 0);

  const no = scriptedLimits({ submit: [PLACED] });
  const declined = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: no.api, sign: stubWallet(["no"]).sign, now: clock().now });
  assert.equal(declined.kind, "cancelled");
  assert.equal(no.routes("submit").length, 0);
});

test("after the relay: a refusal before it is nothing sent, a failure on chain is said, an unclear answer is never placed again", async () => {
  const before = scriptedLimits({ submit: [{ status: 409, body: { error: { code: "SWAP_PAUSED", message: "Trading is turned off right now.", submitBoundary: "NOT_CROSSED" } } }] });
  const refused = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: before.api, sign: stubWallet().sign, now: clock().now });
  assert.equal(refused.kind, "refused");
  assert.equal(refused.refusal.code, "SWAP_PAUSED");

  const failed = scriptedLimits({ submit: [{ status: 422, body: { error: { code: "PLACEMENT_FAILED", message: "x", submitBoundary: "CROSSED", signature: "sigFail" } } }] });
  assert.deepEqual(await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: failed.api, sign: stubWallet().sign, now: clock().now }), { kind: "failed", signature: "sigFail" });

  const lost = scriptedLimits({ submit: ["network", PLACED] });
  const unclear = await placeLimit({ intent: INTENT, review: review(), receivedAt: T }, { api: lost.api, sign: stubWallet().sign, now: clock().now });
  assert.equal(unclear.kind, "unclear");
  assert.match(unclear.message, /Do not place it again/);
  assert.equal(lost.routes("submit").length, 1, "the signed bytes are relayed once");
});

test("cancelling: built by the engine, signed once, relayed once; a wallet's no keeps the order", async () => {
  const time = clock();
  const { api, routes } = scriptedLimits({ cancel: [{ status: 200, body: { transactionBase64: "CCCC", requestId: "c1", signableMs: 25_000 } }], submit: [{ status: 200, body: { state: "CANCELLED", signature: "sigCancel", settled: true } }] });
  const wallet = stubWallet();
  const done = await cancelLimit({ owner: OWNER, venue: "trigger", order: ORDER_KEY }, { api, sign: wallet.sign, now: time.now });
  assert.deepEqual(done, { kind: "cancelled", state: "CANCELLED", signature: "sigCancel", settled: true });
  assert.deepEqual(routes("submit")[0].body, { kind: "cancel", venue: "trigger", owner: OWNER, order: ORDER_KEY, requestId: "c1", signedTransactionBase64: "CCCCSIGNED", terms: null });

  const kept = scriptedLimits({ cancel: [{ status: 200, body: { transactionBase64: "CCCC", requestId: "c1" } }], submit: [{ status: 200, body: {} }] });
  assert.equal((await cancelLimit({ owner: OWNER, venue: "trigger", order: ORDER_KEY }, { api: kept.api, sign: stubWallet(["no"]).sign, now: time.now })).kind, "kept");
  assert.equal(kept.routes("submit").length, 0);

  const closed = scriptedLimits({ cancel: [{ status: 200, body: { transactionBase64: "CCCC", requestId: "c1" } }], submit: [{ status: 409, body: { error: { code: "NOT_CANCELLABLE", message: "x", submitBoundary: "NOT_CROSSED" } } }] });
  const refused = await cancelLimit({ owner: OWNER, venue: "trigger", order: ORDER_KEY }, { api: closed.api, sign: stubWallet().sign, now: time.now });
  assert.equal(refused.refusal.message, "This order is already closed or being closed.");
});
