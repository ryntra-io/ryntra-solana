import { test } from "node:test";
import assert from "node:assert/strict";

import { MIN_WALLET_WINDOW_MS } from "./blockhash-life.ts";
import {
  MAX_RENEWALS,
  NETWORK_FEE_SLACK_LAMPORTS,
  RENEW_LEAD_MS,
  SWAP_TIMEOUT_MS,
  WORSE_FIGURES_SETTLE_MS,
  askOnceMore,
  freshOrderWithinReview,
  pressRoute,
  renewAtMs,
  walletAnswerRoute,
} from "./swap-press.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function terms(overrides = {}) {
  return {
    inputMint: SOL,
    outputMint: USDC,
    inAmountRaw: "10000000",
    outAmountRaw: "1850000",
    minReceivedRaw: "1840750", // 0.5 % below the quote
    totalFeeBasisPoints: 50,
    platformFee: { basisPoints: 50 },
    signatureFeeLamports: "5000",
    priorityFeeLamports: "20000",
    rentFeeLamports: "0",
    ...overrides,
  };
}

/* ------------------------------------------------------------ the press */

test("bytes with enough life left open the wallet at once", () => {
  const now = 1_000_000;
  assert.equal(pressRoute({ readinessCode: "READY", ready: true, receivedAtMs: now - 5_000, signableMs: 24_000, nowMs: now }), "WALLET_NOW");
});

test("stale bytes are built again at the press, never sent and never waited out", () => {
  const now = 1_000_000;
  /* 20 s read of a Review whose bytes could be signed for 24 s: 4 s left, under the wallet's 10 s. */
  assert.equal(pressRoute({ readinessCode: "READY", ready: true, receivedAtMs: now - 20_000, signableMs: 24_000, nowMs: now }), "FRESH_BYTES");
  /* exactly at the wallet's window still opens it; a millisecond under does not */
  assert.equal(pressRoute({ readinessCode: "READY", ready: true, receivedAtMs: now - (24_000 - MIN_WALLET_WINDOW_MS), signableMs: 24_000, nowMs: now }), "WALLET_NOW");
  assert.equal(pressRoute({ readinessCode: "READY", ready: true, receivedAtMs: now - (24_000 - MIN_WALLET_WINDOW_MS) - 1, signableMs: 24_000, nowMs: now }), "FRESH_BYTES");
  /* bytes long dead */
  assert.equal(pressRoute({ readinessCode: "READY", ready: true, receivedAtMs: now - 600_000, signableMs: 24_000, nowMs: now }), "FRESH_BYTES");
});

test("a Review whose window closed by time is answered by fresh bytes in the same press", () => {
  for (const code of ["ORDER_EXPIRED", "ORDER_TOO_SHORT"]) {
    assert.equal(pressRoute({ readinessCode: code, ready: false, receivedAtMs: 0, signableMs: 24_000, nowMs: 60_000 }), "FRESH_BYTES", code);
  }
});

test("a structural refusal is never papered over by fresh bytes", () => {
  for (const code of ["REVIEW_INVALIDATED", "PROOF_NOT_SIGNED", "SIMULATION_NOT_CLEAR", "EFFECTS_NOT_VERIFIED", "POLICY_BLOCKED"]) {
    assert.equal(pressRoute({ readinessCode: code, ready: false, receivedAtMs: 0, signableMs: 24_000, nowMs: 1 }), "REFUSE", code);
  }
});

/* ------------------------------------------------------------ the slow wallet */

test("a slow wallet's signature over bytes past their window is never sent: a fresh Review instead", () => {
  const received = 1_000_000;
  assert.equal(walletAnswerRoute({ receivedAtMs: received, signableMs: 24_000, answeredAtMs: received + 23_999 }), "SEND");
  assert.equal(walletAnswerRoute({ receivedAtMs: received, signableMs: 24_000, answeredAtMs: received + 24_000 }), "FRESH_REVIEW");
  /* a wallet that took a minute */
  assert.equal(walletAnswerRoute({ receivedAtMs: received, signableMs: 24_000, answeredAtMs: received + 60_000 }), "FRESH_REVIEW");
  /* a window nobody could read is closed */
  assert.equal(walletAnswerRoute({ receivedAtMs: Number.NaN, signableMs: 24_000, answeredAtMs: received }), "FRESH_REVIEW");
});

test("the card's wait on a wallet and on the execute is bounded above the server's own landing wait", () => {
  /* the server reads and re-sends for 30 s (`settle.ts`); the card must not call that missing first */
  assert.ok(SWAP_TIMEOUT_MS.execute > 30_000 + 10_000);
  assert.ok(SWAP_TIMEOUT_MS.execute < 60_000, "below the route's 60 s platform limit");
  assert.ok(SWAP_TIMEOUT_MS.order > 2_000 && SWAP_TIMEOUT_MS.order < 60_000);
  assert.ok(SWAP_TIMEOUT_MS.quote > 1_000 && SWAP_TIMEOUT_MS.quote < 30_000);
});

/* ------------------------------------------------------------ no worse than the Review */

test("an unchanged or better fresh order opens the wallet in the same press", () => {
  assert.equal(freshOrderWithinReview(terms(), terms()), true);
  assert.equal(freshOrderWithinReview(terms(), terms({ outAmountRaw: "1860000", minReceivedRaw: "1850700" })), true);
  /* a lower quote whose guaranteed minimum still holds (a tighter slippage) */
  assert.equal(freshOrderWithinReview(terms(), terms({ outAmountRaw: "1849000", minReceivedRaw: "1840750" })), true);
});

test("the guaranteed minimum is never lower than the one the person reviewed — not by a single unit", () => {
  assert.equal(freshOrderWithinReview(terms(), terms({ outAmountRaw: "1849999", minReceivedRaw: "1840749" })), false);
  assert.equal(freshOrderWithinReview(terms(), terms({ outAmountRaw: "1850000", minReceivedRaw: "1831499" })), false);
});

test("no fee may rise past the Review, beyond the network fee's small slack", () => {
  assert.equal(freshOrderWithinReview(terms(), terms({ totalFeeBasisPoints: 51 })), false);
  assert.equal(freshOrderWithinReview(terms(), terms({ platformFee: { basisPoints: 51 } })), false);
  assert.equal(freshOrderWithinReview(terms(), terms({ rentFeeLamports: "1" })), false);
  /* the priority fee moves with the cluster: up to the slack is inside, past it is not */
  const reviewedNetwork = 25_000n;
  const slack = reviewedNetwork / 4n > NETWORK_FEE_SLACK_LAMPORTS ? reviewedNetwork / 4n : NETWORK_FEE_SLACK_LAMPORTS;
  assert.equal(freshOrderWithinReview(terms(), terms({ priorityFeeLamports: (20_000n + slack).toString() })), true);
  assert.equal(freshOrderWithinReview(terms(), terms({ priorityFeeLamports: (20_000n + slack + 1n).toString() })), false);
});

test("a warning the Review did not carry is read before any wallet opens", () => {
  assert.equal(freshOrderWithinReview(terms(), terms(), { reviewed: ["SLIPPAGE_BOUNDED"], fresh: ["SLIPPAGE_BOUNDED"] }), true);
  assert.equal(freshOrderWithinReview(terms(), terms(), { reviewed: ["SLIPPAGE_BOUNDED"], fresh: [] }), true);
  assert.equal(freshOrderWithinReview(terms(), terms(), { reviewed: [], fresh: ["PRICE_IMPACT_DISCLOSED"] }), false);
});

test("another pair, another amount or an unreadable figure is never inside the Review", () => {
  assert.equal(freshOrderWithinReview(terms(), terms({ inAmountRaw: "10000001" })), false);
  assert.equal(freshOrderWithinReview(terms(), terms({ outputMint: SOL, inputMint: USDC })), false);
  assert.equal(freshOrderWithinReview(terms(), terms({ minReceivedRaw: "-1" })), false);
});

/* ------------------------------------------------------------ renewed while read */

test("a Review's bytes are renewed shortly before they fall short of a wallet's window, at most twice", () => {
  const received = 1_000_000;
  /* 27.8 s of signable life (production, 2026-10-19): renewed 27.8 − 10 − 3 = 14.8 s after arriving */
  assert.equal(renewAtMs({ receivedAtMs: received, signableMs: 27_800, renewals: 0 }), received + 27_800 - MIN_WALLET_WINDOW_MS - RENEW_LEAD_MS);
  assert.equal(renewAtMs({ receivedAtMs: received, signableMs: 27_800, renewals: MAX_RENEWALS - 1 }) !== null, true);
  assert.equal(renewAtMs({ receivedAtMs: received, signableMs: 27_800, renewals: MAX_RENEWALS }), null);
  /* bytes already short of the window are renewed at once */
  assert.equal(renewAtMs({ receivedAtMs: received, signableMs: 6_000, renewals: 0 }), received);
  assert.equal(renewAtMs({ receivedAtMs: Number.NaN, signableMs: 6_000, renewals: 0 }), null);
  assert.ok(MAX_RENEWALS <= 2, "two renewals are two of the 12 action requests a minute");
  assert.ok(WORSE_FIGURES_SETTLE_MS >= 1_000, "worse figures stand on screen for a moment before a press confirms them");
});

/* ------------------------------------------------------------ the one repeat */

test("only a missing answer is asked once more — never a refusal the server decided", () => {
  for (const code of ["TIMEOUT", "NETWORK", "HTTP_502", "HTTP_503", "HTTP_504"]) assert.equal(askOnceMore(code), true, code);
  for (const code of ["RATE_LIMITED", "OWNER_SWAP_LOCKED", "SIMULATION_FAILED", "ORDER_REFUSED", "HTTP_500", "VALIDATION_ERROR", "LANDED_FAILED"]) {
    assert.equal(askOnceMore(code), false, code);
  }
});
