// Run from repo root: node --test lib/plans/review.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { PlanReviewSchema } from "../api/v1/contract.ts";
import { STOCK_ISSUERS } from "../stocks/representations.ts";
import { UNKNOWN_SESSION } from "../stocks/session.ts";
import { evaluatePlanReview } from "./review.ts";
import { computePlanSizing } from "./sizing.ts";
import { exampleRules } from "./sizing.test.mjs";

/**
 * The Strategy block (canon §10.1): the plan's version judged on the order in
 * front of the person. What is tested is the rule set — which check blocks,
 * which only warns, and that an unknown is never a pass.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const OTHER = "So11111111111111111111111111111111111111112";
const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function plan(overrides = {}, rulesOverrides = {}) {
  const rules = exampleRules(rulesOverrides);
  /* Sized as of the plan's creation, so a fixture whose validity has since passed still has the size it was written with. */
  const sized = computePlanSizing(rules, Date.parse("2026-09-14T09:30:00.000Z"));
  if (!sized.ok) throw new Error("the fixture must size");
  return {
    id: "plan_0f3a9c2e7b4d4e1f8a6c5b7d9e0f1a2b",
    owner: "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv",
    network: "solana:mainnet",
    status: "active",
    side: "BUY",
    asset: { network: "solana:mainnet", mint: NVDAX, symbol: "NVDAx", issuer: { id: "xstocks", label: "xStocks · Backed Finance" }, underlying: { symbol: "NVDA", name: "NVIDIA" }, decimals: 8 },
    version: 2,
    current: { version: 2, rules, sizing: sized.sizing, createdAt: "2026-09-15T08:00:00.000Z", reason: null },
    versions: [{ version: 1, createdAt: "2026-09-14T09:30:00.000Z", reason: null }, { version: 2, createdAt: "2026-09-15T08:00:00.000Z", reason: null }],
    journal: [{ at: "2026-09-14T09:30:00.000Z", event: "created", version: 1, note: null, ref: null }],
    executions: [],
    createdAt: "2026-09-14T09:30:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

/* $780.00 buys 4.29942 NVDA at $181.42 a share: raw out = 4.29942 / 1.001701 tokens with 8 decimals.
   At this price the plan's own notional ($825.68, sized at $180) no longer fits the planned risk —
   see the risk test below — so the fixture that is ready is the amount that fits. */
function order(overrides = {}) {
  return {
    inputMint: USDC,
    outputMint: NVDAX,
    inAmountRaw: "780000000",
    outAmountRaw: "429212000",
    requestId: "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c",
    slippageBps: 50,
    priceImpactPct: "0.02",
    totalFeeBasisPoints: 85,
    observedAt: "2026-09-15T11:59:57.000Z",
    reviewExpiresAt: "2026-09-15T12:00:57.000Z",
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    representation: { mint: NVDAX, symbol: "NVDAx", name: "NVIDIA xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US", name: "NVIDIA" }, exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, sources: [] },
    market: { priceUsd: 181.7, change24hPct: 0, volume24hUsd: 0, liquidityUsd: 1_700_000, verified: true, observedAt: "2026-09-15T11:59:00.000Z", icon: null },
    tokenPerShareUsd: 181.39,
    multiplier: { current: 1.001701, pending: null, effectiveAt: null },
    multiplierState: "active",
    reference: { state: "current", perShare: 181.1, currency: "USD", source: { id: "issuer-xstocks", label: "xStocks" }, observedAt: "2026-09-15T11:58:00.000Z", fetchedAt: "2026-09-15T11:59:30.000Z", note: null },
    session: { ...UNKNOWN_SESSION, exchangeOpen: true },
    deviationPct: 0.16,
    ...overrides,
  };
}

const judge = (p = plan(), o = order(), r = row(), version = 2, nowMs = NOW) => evaluatePlanReview({ plan: p, requestedVersion: version, order: o, row: r, usdcMint: USDC, nowMs });
const outcomeOf = (review, id) => review.checks.find((c) => c.id === id).outcome;

test("an order inside every rule is ready, and the block parses as the contract's PlanReview", () => {
  const review = judge();
  PlanReviewSchema.parse(review);
  assert.equal(review.verdict, "ready");
  assert.equal(review.version, 2);
  assert.ok(review.checks.every((c) => c.outcome === "pass"), JSON.stringify(review.checks.filter((c) => c.outcome !== "pass")));
  assert.equal(review.quote.unit, "underlying");
  assert.equal(review.quote.amount, "4.299420");
  assert.ok(Math.abs(review.quote.perShareUsd - 181.42) < 0.01);
  assert.ok(Math.abs(review.quote.deviationPct - 0.177) < 0.01);
  assert.equal(review.quote.referenceState, "current");
  assert.equal(review.reviewId, "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c");
  assert.equal(review.checks.length, 17);
  /* 4.29942 × (181.42 − 160 + 1.8142) = 99.89: inside the $100 planned risk. */
  assert.ok(Math.abs(review.quote.modelledLossUsd - 99.89) < 0.02, String(review.quote.modelledLossUsd));
  /* min(100 / 23.234, 980 / 181.42) × 181.42 = 780.8 fits at this price. */
  assert.ok(Math.abs(review.quote.fitUsd - 780.8) < 0.05, String(review.quote.fitUsd));
});

test("a deal inside the budget but over the planned risk at this price is blocked — the budget is not the risk", () => {
  /* The plan's own notional, $825.68 (4.5512 NVDA), sized at $180: at $181.42 the same dollars model 4.5512 × 23.23 = $105.74 of loss. */
  const notional = judge(plan(), order({ inAmountRaw: "825680000", outAmountRaw: "454347000" }));
  assert.equal(outcomeOf(notional, "budget"), "pass");
  assert.equal(outcomeOf(notional, "spend"), "pass");
  assert.equal(outcomeOf(notional, "risk"), "fail");
  assert.equal(notional.verdict, "blocked");
  assert.ok(notional.checks.find((c) => c.id === "risk").required);
  assert.match(notional.checks.find((c) => c.id === "risk").actual, /\$105\.7\d · 4\.551198 NVDA at \$181\.42/);
  assert.ok(notional.quote.fitUsd < 825.68 && notional.quote.fitUsd > 700, String(notional.quote.fitUsd));

  /* The Owner's example: budget $1,000, entry $100, invalidation $90, planned risk $20 → 2 shares. A $1,000 buy fits the budget and models $100 of loss. */
  const rules = { entry: { pricePerShare: 100, maxPricePerShare: null, validUntil: null }, capital: { budgetUsd: 1000, reserveForCostsUsd: 0 }, risk: { invalidationPerShare: 90, plannedRiskUsd: 20, costBufferBps: 0 } };
  const two = plan({}, rules);
  assert.equal(two.current.sizing.units, 2);
  const flat = row({ multiplier: { current: 1, pending: null, effectiveAt: null }, reference: { ...row().reference, perShare: 100 } });
  const thousand = judge(two, order({ inAmountRaw: "1000000000", outAmountRaw: "1000000000" }), flat);
  assert.equal(outcomeOf(thousand, "budget"), "pass");
  assert.equal(outcomeOf(thousand, "risk"), "fail");
  assert.equal(thousand.quote.modelledLossUsd, 100);
  assert.equal(thousand.verdict, "blocked");
  assert.equal(thousand.quote.fitUsd, 200);
  const twoHundred = judge(two, order({ inAmountRaw: "200000000", outAmountRaw: "200000000" }), flat);
  assert.equal(outcomeOf(twoHundred, "risk"), "pass");
  assert.equal(twoHundred.quote.modelledLossUsd, 20);
  assert.equal(twoHundred.verdict, "ready");
});

test("the reserve, the invalidation and the size: spend is the budget net of the reserve, a price at or under the invalidation fails, the size is advice", () => {
  /* $990 is inside the $1,000 budget and over the $980 the plan may spend. */
  const reserve = judge(plan(), order({ inAmountRaw: "990000000", outAmountRaw: "544800000" }));
  assert.equal(outcomeOf(reserve, "budget"), "pass");
  assert.equal(outcomeOf(reserve, "spend"), "fail");
  assert.equal(reserve.verdict, "blocked");
  /* A fill at $150 a share is under the $160 invalidation: the thesis is already wrong at this price. */
  const under = judge(plan(), order({ inAmountRaw: "600000000", outAmountRaw: "399321000" }), row({ reference: { ...row().reference, perShare: 150 } }));
  assert.equal(outcomeOf(under, "invalidation"), "fail");
  assert.equal(under.verdict, "blocked");
  /* Over the version's sized spend but inside every rule: advice, and the person decides. */
  const cheap = row({ reference: { ...row().reference, perShare: 170 } });
  const larger = judge(plan(), order({ inAmountRaw: "900000000", outAmountRaw: "528500000" }), cheap);
  assert.equal(outcomeOf(larger, "risk"), "pass");
  assert.equal(outcomeOf(larger, "size"), "fail");
  assert.equal(larger.checks.find((c) => c.id === "size").required, false);
  assert.equal(larger.verdict, "attention");
  /* Without a multiplier the money checks that need units are unknown, and unknown does not sign. */
  const unread = judge(plan(), order(), row({ multiplier: null, multiplierState: null }));
  assert.equal(outcomeOf(unread, "risk"), "unknown");
  assert.equal(outcomeOf(unread, "invalidation"), "unknown");
  assert.equal(unread.quote.modelledLossUsd, null);
  assert.equal(unread.quote.fitUsd, null);
});

test("a stale version, a budget overrun or a price above the bound is blocked before any bytes are built", () => {
  assert.equal(judge(plan(), order(), row(), 1).verdict, "blocked");
  assert.equal(outcomeOf(judge(plan(), order(), row(), 1), "version"), "fail");
  const over = judge(plan(), order({ inAmountRaw: "1200000000", outAmountRaw: "660000000" }));
  assert.equal(outcomeOf(over, "budget"), "fail");
  assert.equal(over.verdict, "blocked");
  const dear = judge(plan({}, { entry: { pricePerShare: 180, maxPricePerShare: 181, validUntil: "2026-10-15T00:00:00.000Z" } }));
  assert.equal(outcomeOf(dear, "entryPrice"), "fail");
  assert.equal(dear.verdict, "blocked");
  const expired = judge(plan({}, { entry: { pricePerShare: 180, maxPricePerShare: 185, validUntil: "2026-09-15T11:00:00.000Z" } }));
  assert.equal(outcomeOf(expired, "validity"), "fail");
  const draft = judge(plan({ status: "draft" }));
  assert.equal(outcomeOf(draft, "status"), "fail");
  assert.equal(draft.verdict, "blocked");
});

test("the exact representation and the side are checked — the company's name is not the mint", () => {
  const wrongMint = judge(plan(), order({ outputMint: OTHER }));
  assert.equal(outcomeOf(wrongMint, "asset"), "fail");
  assert.equal(wrongMint.verdict, "blocked");
  const sell = judge(plan(), order({ inputMint: NVDAX, outputMint: USDC }));
  assert.equal(outcomeOf(sell, "side"), "fail");
});

test("an unknown is never a pass: with the reference required a missing reference blocks; advisory and unbounded, it is named and the verdict is attention", () => {
  const noRef = row({ reference: { state: "unavailable", perShare: null, currency: "USD", source: { id: "none", label: "" }, observedAt: null, fetchedAt: null, note: null } });
  const required = judge(plan(), order(), noRef);
  assert.equal(outcomeOf(required, "reference"), "unknown");
  assert.equal(outcomeOf(required, "deviation"), "unknown");
  assert.equal(required.verdict, "blocked");
  const advisory = judge(plan({}, { execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null } }), order(), noRef);
  assert.equal(outcomeOf(advisory, "reference"), "unknown");
  assert.equal(outcomeOf(advisory, "deviation"), "unknown");
  assert.equal(advisory.verdict, "attention");
  assert.equal(advisory.quote.referenceState, "unavailable");
});

test("a deviation bound the person wrote is a rule whatever the reference flag says: without a reference it is unknown and blocks; with one it is judged", () => {
  const bounded = { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: 1.5, referenceRequired: false, minLiquidityUsd: null };
  const noRef = row({ reference: { state: "unavailable", perShare: null, currency: "USD", source: { id: "none", label: "" }, observedAt: null, fetchedAt: null, note: null } });
  const blind = judge(plan({}, { execution: bounded }), order(), noRef);
  assert.equal(outcomeOf(blind, "reference"), "unknown");
  assert.equal(blind.checks.find((c) => c.id === "reference").required, false);
  assert.equal(outcomeOf(blind, "deviation"), "unknown");
  assert.equal(blind.checks.find((c) => c.id === "deviation").required, true);
  assert.equal(blind.verdict, "blocked");
  const far = judge(plan({}, { execution: bounded }), order(), row({ reference: { ...row().reference, perShare: 175 } }));
  assert.equal(outcomeOf(far, "deviation"), "fail");
  assert.equal(far.verdict, "blocked");
  const near = judge(plan({}, { execution: bounded }), order(), row());
  assert.equal(outcomeOf(near, "deviation"), "pass");
  assert.equal(near.verdict, "ready");
});

test("a stale reference fails the required check; a quote past its age and a slippage above the bound fail", () => {
  /* Freshness is the observation's, not the fetch's: a figure the feed published twenty minutes ago is stale however recently it was fetched, and the reverse — an old fetch of a fresh observation — cannot happen, so both times old is the plain case. */
  const stale = judge(plan(), order(), row({ reference: { ...row().reference, observedAt: "2026-09-15T11:40:00.000Z", fetchedAt: "2026-09-15T11:40:00.000Z" } }));
  assert.equal(outcomeOf(stale, "reference"), "fail");
  assert.equal(stale.quote.referenceState, "stale");
  const oldObservationFreshFetch = judge(plan(), order(), row({ reference: { ...row().reference, observedAt: "2026-09-15T11:40:00.000Z", fetchedAt: "2026-09-15T11:59:50.000Z" } }));
  assert.equal(outcomeOf(oldObservationFreshFetch, "reference"), "fail", "a fresh fetch of an old publish time is stale");
  assert.equal(oldObservationFreshFetch.quote.referenceState, "stale");
  const old = judge(plan(), order({ observedAt: "2026-09-15T11:58:00.000Z" }));
  assert.equal(outcomeOf(old, "quoteAge"), "fail");
  const slip = judge(plan(), order({ slippageBps: 100 }));
  assert.equal(outcomeOf(slip, "slippage"), "fail");
});

test("units are security: no multiplier is unknown and blocks; an activation window fails; the leg is then stated in tokens", () => {
  const unread = judge(plan(), order(), row({ multiplier: null, multiplierState: null }));
  assert.equal(outcomeOf(unread, "units"), "unknown");
  assert.equal(unread.verdict, "blocked");
  assert.equal(unread.quote.unit, "token");
  assert.equal(unread.quote.perShareUsd, null);
  const window = judge(plan(), order(), row({ multiplier: { current: 1.001701, pending: 1.1, effectiveAt: "2026-09-15T12:05:00.000Z" } }));
  assert.equal(outcomeOf(window, "units"), "fail");
  const noRow = judge(plan(), order(), null);
  assert.equal(outcomeOf(noRow, "units"), "unknown");
  assert.equal(noRow.verdict, "blocked");
});

test("a liquidity floor is judged against the pool; without a floor the pool is reported, never refused", () => {
  const floor = judge(plan({}, { execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: 1.5, referenceRequired: true, minLiquidityUsd: 2_000_000 } }));
  assert.equal(outcomeOf(floor, "liquidity"), "fail");
  assert.equal(floor.verdict, "blocked");
  const none = judge();
  assert.equal(outcomeOf(none, "liquidity"), "pass");
  assert.equal(none.checks.find((c) => c.id === "liquidity").required, false);
});

/* A plan on a pre-IPO token (PreStocks) is judged per token — the executable
   price is the order's USD over the tokens it buys, the bound is per token,
   and a private company's missing reference is named, never a pass and never
   a block unless the person required it. */
test("a token-unit plan (PreStocks ANTHROPIC) refuses a price above its per-token bound on a fresh quote; the missing reference is named, not a block, when not required", () => {
  const ANTHROPIC = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
  const tokenPlan = plan(
    { asset: { network: "solana:mainnet", mint: ANTHROPIC, symbol: "ANTHROPIC", issuer: { id: "prestocks", label: "PreStocks" }, underlying: { symbol: "ANTHROPIC", name: "Anthropic" }, decimals: 9, unitBasis: "token" } },
    { entry: { pricePerShare: 95, maxPricePerShare: 100, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 80, plannedRiskUsd: 60, costBufferBps: 100 }, capital: { budgetUsd: 500, reserveForCostsUsd: 10 }, execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null } },
  );
  /* $50 buys 0.051459 ANTHROPIC: $971.65 per token, above the $100 bound. */
  const tokenOrder = order({ outputMint: ANTHROPIC, inAmountRaw: "50000000", outAmountRaw: "51459000" });
  const tokenRow = row({
    representation: { mint: ANTHROPIC, symbol: "ANTHROPIC", name: "Anthropic PreStocks", issuer: STOCK_ISSUERS.prestocks, issuerConfirmation: "issuer-catalogue", instrument: { class: "pre-ipo", unitBasis: "token", rights: "economic-exposure" }, underlying: { symbol: "ANTHROPIC", isin: null, listingCountry: null, name: "Anthropic" }, companyKey: "anthropic", exchange: null, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", decimals: 9, tradingHalted: null, issuerUrl: "https://www.prestocks.com/anthropic", issuerNote: null, sources: ["jupiter-verified", "prestocks-public-api"] },
    market: { priceUsd: 966.34, change24hPct: -1.8, volume24hUsd: 1_128_997, liquidityUsd: 377_000, verified: true, observedAt: "2026-09-15T11:59:00.000Z", icon: null },
    tokenPerShareUsd: null,
    multiplier: { current: 1, pending: null, effectiveAt: null },
    multiplierState: "active",
    reference: { state: "unavailable", perShare: null, currency: "USD", source: { id: "none", label: "" }, observedAt: null, fetchedAt: null, note: "A private company has no exchange reference; the issuer's mark is shown separately and is not a market price." },
    session: UNKNOWN_SESSION,
    deviationPct: null,
    issuerMark: { source: { id: "issuer-prestocks", label: "PreStocks" }, perUnit: 812.79, valuationUsd: 950_000_000_000, impliedValuationUsd: null, supply: null, holders: null, observedAt: null, fetchedAt: "2026-09-15T11:50:00.000Z", stale: false },
    markPremiumPct: 18.9,
  });
  const review = judge(tokenPlan, tokenOrder, tokenRow, 2);
  assert.equal(review.quote.unit, "token");
  assert.ok(Math.abs(review.quote.perShareUsd - 971.65) < 0.05, `per token ${review.quote.perShareUsd}`);
  assert.equal(outcomeOf(review, "entryPrice"), "fail", "the per-token price is above the bound");
  assert.equal(review.verdict, "blocked");
  assert.equal(outcomeOf(review, "reference"), "unknown", "no reference for a private company is unknown, never a pass");
  assert.equal(review.checks.find((c) => c.id === "reference").required, false);
  assert.equal(review.quote.referenceState, "unavailable");
  assert.equal(review.quote.deviationPct, null, "no deviation is drawn against a company-level figure");
  assert.ok(PlanReviewSchema.safeParse(review).success, "the block still parses as the contract's PlanReview — the contract is unchanged");
  /* The same order under a bound the price sits below is ready: the token unit is the whole difference. */
  const roomy = judge(plan({ asset: tokenPlan.asset }, { entry: { pricePerShare: 960, maxPricePerShare: 1000, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 800, plannedRiskUsd: 60, costBufferBps: 100 }, capital: { budgetUsd: 500, reserveForCostsUsd: 10 }, exit: { targetPerShare: 1500, timeExitAt: null, invalidationIsOrder: false }, execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null } }), tokenOrder, tokenRow, 2);
  assert.equal(outcomeOf(roomy, "entryPrice"), "pass");
  assert.notEqual(roomy.verdict, "blocked");
});
test("1.7.0: a crypto plan (SOL) is judged on the mint's decimals and the catalogue's liquidity — no multiplier, the reference and the deviation not applicable; a meme's per-token price is read in fractions of a cent", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const solPlan = plan(
    { asset: { network: "solana:mainnet", mint: SOL, symbol: "SOL", issuer: { id: "jupiter-verified", label: "Jupiter verified" }, underlying: { symbol: "SOL", name: "Wrapped SOL" }, decimals: 9, unitBasis: "token", kind: "crypto" } },
    { entry: { pricePerShare: 210, maxPricePerShare: 215, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 190, plannedRiskUsd: 50, costBufferBps: 100 }, capital: { budgetUsd: 500, reserveForCostsUsd: 10 }, exit: { targetPerShare: 260, timeExitAt: null, invalidationIsOrder: false }, execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: 1_000_000 } },
  );
  /* $420.00 buys 1.97 SOL at $213.20 a token: raw out with 9 decimals. */
  const solOrder = order({ outputMint: SOL, inAmountRaw: "420000000", outAmountRaw: "1970000000" });
  /* A stock row handed by mistake is not a token's reference: it is not read. */
  const review = evaluatePlanReview({ plan: solPlan, requestedVersion: 2, order: solOrder, row: row(), market: { liquidityUsd: 48_000_000 }, usdcMint: USDC, nowMs: NOW });
  PlanReviewSchema.parse(review);
  assert.equal(review.quote.unit, "token");
  assert.equal(review.quote.multiplier, null);
  assert.equal(review.quote.amount, "1.970000");
  assert.ok(Math.abs(review.quote.perShareUsd - 213.2) < 0.01, String(review.quote.perShareUsd));
  assert.equal(review.quote.referencePerShareUsd, null);
  assert.equal(review.quote.referenceState, "unavailable");
  assert.equal(review.quote.deviationPct, null);
  const reference = review.checks.find((c) => c.id === "reference");
  assert.deepEqual([reference.outcome, reference.required, reference.actual], ["pass", false, "not applicable"]);
  const deviation = review.checks.find((c) => c.id === "deviation");
  assert.deepEqual([deviation.outcome, deviation.required], ["pass", false]);
  const units = review.checks.find((c) => c.id === "units");
  assert.deepEqual([units.outcome, units.actual], ["pass", "tokens · 9 decimals · no multiplier"]);
  const liquidity = review.checks.find((c) => c.id === "liquidity");
  assert.deepEqual([liquidity.outcome, liquidity.actual], ["pass", "$48,000,000.00"]);
  assert.equal(outcomeOf(review, "entryPrice"), "pass");
  assert.equal(review.verdict, "ready", JSON.stringify(review.checks.filter((c) => c.outcome !== "pass")));

  /* Without the catalogue's figure a floor is unknown, which blocks; without a floor it is reported. */
  const dark = evaluatePlanReview({ plan: solPlan, requestedVersion: 2, order: solOrder, row: null, market: null, usdcMint: USDC, nowMs: NOW });
  assert.equal(outcomeOf(dark, "liquidity"), "unknown");
  assert.equal(dark.verdict, "blocked");

  /* The bound crossed on a fresh quote refuses, in token units: $420 for 1.90 SOL is $221.05 a token, above $215. */
  const dear = evaluatePlanReview({ plan: solPlan, requestedVersion: 2, order: order({ outputMint: SOL, inAmountRaw: "420000000", outAmountRaw: "1900000000" }), row: null, market: { liquidityUsd: 48_000_000 }, usdcMint: USDC, nowMs: NOW });
  assert.equal(outcomeOf(dear, "entryPrice"), "fail");
  assert.equal(dear.checks.find((c) => c.id === "entryPrice").actual, "$221.05 / token");
  assert.equal(dear.verdict, "blocked");

  /* A meme priced in fractions of a cent: the figures say the price rather than $0.00. */
  const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const bonkPlan = plan(
    { asset: { network: "solana:mainnet", mint: BONK, symbol: "Bonk", issuer: { id: "jupiter-verified", label: "Jupiter verified" }, underlying: { symbol: "Bonk", name: "Bonk" }, decimals: 5, unitBasis: "token", kind: "meme" } },
    { entry: { pricePerShare: 0.00001234, maxPricePerShare: 0.0000126, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 0.00001, plannedRiskUsd: 10, costBufferBps: 100 }, capital: { budgetUsd: 100, reserveForCostsUsd: 1 }, exit: { targetPerShare: 0.00002, timeExitAt: null, invalidationIsOrder: false }, execution: { maxSlippageBps: 100, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null } },
  );
  /* $12.00 buys 972,447.32568 Bonk at $0.00001234 a token: raw out with 5 decimals. */
  const bonkReview = evaluatePlanReview({ plan: bonkPlan, requestedVersion: 2, order: order({ outputMint: BONK, inAmountRaw: "12000000", outAmountRaw: "97244732568", slippageBps: 100 }), row: null, market: { liquidityUsd: 3_000_000 }, usdcMint: USDC, nowMs: NOW });
  PlanReviewSchema.parse(bonkReview);
  assert.equal(bonkReview.quote.unit, "token");
  assert.equal(outcomeOf(bonkReview, "entryPrice"), "pass");
  assert.equal(bonkReview.checks.find((c) => c.id === "entryPrice").expected, "at most $0.0000126 / token");
  assert.match(bonkReview.checks.find((c) => c.id === "invalidation").expected, /^above \$0\.00001 \/ token$/);
  assert.equal(bonkReview.verdict, "ready", JSON.stringify(bonkReview.checks.filter((c) => c.outcome !== "pass")));
});
