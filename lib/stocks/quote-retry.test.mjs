import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { quoteStock, resetStockQuoteCache } from "./quote.server.ts";
import { REFERENCE_UNAVAILABLE, UNKNOWN_SESSION } from "./session.ts";

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

const row = {
  representation: { mint: NVDAX, symbol: "NVDAx", decimals: 8, issuer: { id: "xstocks" }, underlying: { symbol: "NVDA" } },
  market: { priceUsd: 212.0, change24hPct: null, volume24hUsd: null, liquidityUsd: null, verified: true, observedAt: null, icon: null },
  tokenPerShareUsd: 211.6,
  multiplier: { current: 1.001701196801074, next: null, nextAt: null },
  multiplierState: "active",
  reference: { ...REFERENCE_UNAVAILABLE },
  session: UNKNOWN_SESSION,
  deviationPct: null,
};

const findRow = async () => ({ ok: true, row, universe: { rows: [row], marketsObservedAt: "", issuerCatalogue: { ok: true, reason: null }, fetchedAt: "" } });
const referral = async () => null;

const okOrder = {
  ok: true,
  order: {
    inAmountRaw: "1000000000",
    outAmountRaw: "468085658",
    minReceivedRaw: "465745230",
    priceImpactPct: "-0.01",
    totalFeeBasisPoints: 50,
    slippageBps: 50,
    router: "metis",
    observedAt: "2026-09-15T00:00:00.000Z",
    reviewExpiresAt: "2026-09-15T00:01:00.000Z",
  },
};
const rateLimited = (retryWaitMs) => ({ ok: false, code: "RATE_LIMITED", errorCode: null, status: 429, access: null, retryWaitMs, reason: "Jupiter Swap API V2 · keyed production access was rate-limited. Refreshing later asks for a new order; no fallback ran." });

beforeEach(() => resetStockQuoteCache());

test("a quote refused for rate with a short pause is asked once more after that pause, and answers", async () => {
  const calls = [];
  const sleeps = [];
  const order = async (request) => { calls.push(request); return calls.length === 1 ? rateLimited(1000) : okOrder; };
  const read = await quoteStock({ ticker: "NVDAx", side: "BUY", usd: 1000 }, { order, findRow, referral, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(read.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(read.quote.usd, 1000);
  assert.equal(read.quote.tokenScaled, "4.688819");
  /* The venue's minimum after its slippage bound, in the same units as the expected figure — what a signature would hold to. */
  assert.equal(read.quote.minReceivedRaw, "465745230");
  assert.equal(read.quote.minReceivedScaled, "4.665375");
  assert.ok(Number(read.quote.minReceivedScaled) < Number(read.quote.tokenScaled));
  assert.equal(read.quote.source.label, "Jupiter");
});

test("a refusal whose reset is too far away is answered honestly at once — no wait, no second ask", async () => {
  let calls = 0;
  const sleeps = [];
  const order = async () => { calls += 1; return rateLimited(null); };
  const read = await quoteStock({ ticker: "NVDAx", side: "BUY", usd: 100 }, { order, findRow, referral, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(read.ok, false);
  assert.equal(read.code, "PROVIDER");
  assert.match(read.reason, /rate-limited/);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("one retry, never two: a second refusal ends the quote", async () => {
  let calls = 0;
  const order = async () => { calls += 1; return rateLimited(500); };
  const read = await quoteStock({ ticker: "NVDAx", side: "BUY", usd: 100 }, { order, findRow, referral, sleep: async () => {} });
  assert.equal(read.ok, false);
  assert.equal(calls, 2);
});

test("any other refusal is never retried", async () => {
  let calls = 0;
  const order = async () => { calls += 1; return { ok: false, code: "NO_ROUTE", errorCode: "NO_ROUTES_FOUND", status: 400, access: null, reason: "no route" }; };
  const read = await quoteStock({ ticker: "NVDAx", side: "BUY", usd: 100 }, { order, findRow, referral, sleep: async () => { throw new Error("must not sleep"); } });
  assert.equal(read.ok, false);
  assert.equal(read.code, "NO_ROUTE");
  assert.equal(calls, 1);
});
