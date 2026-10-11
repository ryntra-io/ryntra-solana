import assert from "node:assert/strict";
import test from "node:test";
const subject = await import("./ticket-state.ts").catch(() => ({}));

const ready = { phase: "IDLE", hasAttempt: false, lockedReview: false, hasPrepared: false,
  reviewReady: false, amountValid: true,
  insufficientBalance: false, cannotPayFee: false, blocked: false,
  quoteFailureRetryable: null, actionFailureRetryable: null };

test("expired or rejected Reviews refresh, and a live checked Review alone offers signing", () => {
  assert.equal(subject.spotTicketAction?.({ ...ready, phase: "REVIEW", hasPrepared: true, reviewReady: true }), "SIGN");
  assert.equal(subject.spotTicketAction?.({ ...ready, phase: "REVIEW", hasPrepared: true, reviewReady: false }), "REFRESH_REVIEW");
});

test("a submitted attempt cannot offer a second action while execute or recovery is running", () => {
  for (const phase of ["SIGNING", "EXECUTING", "RECOVERING", "PREPARING"])
    assert.equal(subject.spotTicketAction?.({ ...ready, phase, hasAttempt: true }), "WAIT");
  assert.equal(subject.spotTicketAction?.({ ...ready, hasAttempt: true }), "RECOVER");
});

test("balance and network fee govern Review before the server is called; the estimate's freshness does not (2026-10-11)", () => {
  for (const [change, expected] of [
    [{ insufficientBalance: true }, "INSUFFICIENT_BALANCE"],
    [{ cannotPayFee: true }, "NETWORK_FEE"],
    [{ actionFailureRetryable: false }, "UNAVAILABLE"],
    /* An estimate that refused for this amount for good — the same asset — offers no Review; one that may pass does. */
    [{ quoteFailureRetryable: false }, "UNAVAILABLE"],
    [{ quoteFailureRetryable: true }, "REVIEW"],
    /* A retryable refusal of the last Review — the venue's moment — offers the Review again. */
    [{ actionFailureRetryable: true }, "REVIEW"],
    [{ blocked: true }, "UNAVAILABLE"],
    [{ amountValid: false }, "AMOUNT"],
    [{}, "REVIEW"],
  ]) assert.equal(subject.spotTicketAction?.({ ...ready, ...change }), expected);
  /* «Перевірка» waits for no estimate: a stale one, one still pricing, or none at all — the order route builds its own. */
  for (const stale of [{ quoteFresh: false }, { quoting: true, hasQuote: false }, { hasQuote: false }])
    assert.equal(subject.spotTicketAction?.({ ...ready, ...stale }), "REVIEW");
});

test("wallet or market changes hide the previous snapshot, including after a failed new read", () => {
  const old = { key: "wallet-a", state: { status: "ready", value: ["private-a"] } };
  const empty = { status: "loading", value: null };
  assert.deepEqual(subject.currentSpotSnapshot?.(old, "wallet-b", empty), empty);
  assert.deepEqual(subject.currentSpotSnapshot?.(old, null, empty), empty);
  assert.deepEqual(subject.currentSpotSnapshot?.(old, "wallet-a", empty), old.state);
  assert.deepEqual(subject.currentSpotSnapshot?.({ ...old, key: "mint-a" }, "mint-b", empty), empty);
});

test("fill units and Buy/Sell direction come from the captured trade, never the newly selected market", () => {
  const context = { side: "BUY", baseMint: "old", baseSymbol: "OLD", baseDecimals: 9,
    quoteMint: "usd", quoteSymbol: "USDC", quoteDecimals: 6 };
  const observation = { actualInputRaw: "2000000", actualOutputRaw: "5000000000" };
  assert.deepEqual(subject.spotFillAmounts?.(observation, context), { base: 5, quote: 2, price: 0.4 });
  assert.deepEqual(subject.spotFillAmounts?.({ actualInputRaw: "5000000000", actualOutputRaw: "2000000" }, { ...context, side: "SELL" }), { base: 5, quote: 2, price: 0.4 });
  assert.deepEqual(subject.spotFillAmounts?.(observation, null), { base: null, quote: null, price: null });
});
