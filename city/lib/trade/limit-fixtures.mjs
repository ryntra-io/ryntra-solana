// Test helpers for the limit and stop ticket: a Review as the limits engine shapes it, its orders as «My orders» reads
// them, and a limits engine that answers from a script and records every request. No network, no wallet.
import { createLimits } from "./limits.ts";

export const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
export const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const ORDER_KEY = "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S";

/** A Review of «buy WIF with 25 USDC at 2.5», the way `/api/solana/limits/review` answers. */
export function review(changes = {}) {
  return {
    venue: "trigger",
    side: "buy",
    order: ORDER_KEY,
    requestId: "req-1",
    pool: null,
    transactionBase64: "AQID",
    pair: { baseMint: WIF, baseDecimals: 6, quoteMint: USDC_MINT, quoteDecimals: 6 },
    inputMint: USDC_MINT,
    outputMint: WIF,
    makingRaw: "25000000",
    takingRaw: "10000000",
    price: "2.5",
    fillPrice: 2.4752475,
    fee: { ryntraBps: 100, venueBps: 0, ryntraFeeRaw: "100000", venueFeeRaw: "0", reason: "RYNTRA", account: "Fee1111111111111111111111111111111111111111" },
    networkFeeLamports: 15000,
    depositLamports: 2039280,
    makerFeeShare: false,
    builtAt: "2026-10-28T10:00:00.000Z",
    signableMs: 25_000,
    risk: { verdict: "NO_KNOWN_BLOCKER", facts: [] },
    ...changes,
  };
}

/** One order of «My orders». */
export function orderView(changes = {}) {
  return {
    key: `${OWNER}:trigger:${ORDER_KEY}`,
    venue: "trigger",
    order: ORDER_KEY,
    side: "buy",
    baseMint: WIF,
    quoteMint: USDC_MINT,
    inputMint: USDC_MINT,
    outputMint: WIF,
    makingRaw: "25000000",
    takingRaw: "10000000",
    filledInputRaw: "0",
    filledOutputRaw: "0",
    ryntraFeeRaw: "0",
    ryntraBps: 100,
    fillPrice: 2.4752475,
    state: "OPEN",
    placeSignature: "sigPlace",
    cancelSignature: null,
    fills: [],
    createdAt: "2026-10-28T10:00:05.000Z",
    updatedAt: "2026-10-28T10:00:05.000Z",
    throughRyntra: true,
    canCancel: true,
    canClaim: false,
    pool: null,
    ...changes,
  };
}

export const INTENT = { owner: OWNER, side: "buy", baseMint: WIF, quoteMint: USDC_MINT, amount: "25", price: "2.5", quoteUsd: 1 };

/**
 * A limits engine whose five routes answer from a script — `{ market: [answer…], review: […], … }`, each answer
 * `{ status, body }` or `"network"` — the last answer repeating. Every request is recorded.
 */
export function scriptedLimits(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([route, answers]) => [route, [...answers]]));
  const fetchStub = async (url, init) => {
    const route = url.split("/").at(-1);
    calls.push({ url, route, body: JSON.parse(init.body) });
    const queue = queues[route] ?? [];
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (!answer) throw new Error(`Nothing scripted for ${route}.`);
    if (answer === "network") throw new TypeError("fetch failed");
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => structuredClone(answer.body) };
  };
  const api = createLimits(fetchStub, { set: () => 0, clear: () => {} });
  return { api, calls, routes: (route) => calls.filter((call) => call.route === route) };
}

/** A wallet that signs what it is shown with a stand-in signature and remembers it; `answers` scripts its replies. */
export function stubWallet(answers = []) {
  const shown = [];
  const queue = [...answers];
  return {
    shown,
    sign: async (wire) => {
      shown.push(wire);
      const next = queue.shift();
      if (next === "no") return { ok: false, reason: "" };
      if (typeof next === "function") await next();
      return { ok: true, signedWireBase64: `${wire}SIGNED` };
    },
  };
}
