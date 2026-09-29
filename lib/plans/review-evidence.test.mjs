// Run from repo root: node --test lib/plans/review-evidence.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { PlanReviewSchema } from "../api/v1/contract.ts";
import { redactExpiredEvidence } from "../evidence/retention.ts";
import { STOCK_ISSUERS } from "../stocks/representations.ts";
import { UNKNOWN_SESSION } from "../stocks/session.ts";
import { evaluatePlanReview, evidenceChecks } from "./review.ts";
import { computePlanSizing } from "./sizing.ts";
import { exampleRules } from "./sizing.test.mjs";

/**
 * The evidence checks on the Review (1.5.0): one per condition, judged on
 * the reads the caller made; required blocks on unmet, stale, unknown or
 * unavailable; advisory names; a version without conditions gains nothing;
 * the block keeps what it knew and redacts the figure after retention.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const NOW = Date.parse("2026-09-15T12:00:00.000Z");

const volumeRule = (threshold, mode = "required") => ({ metric: "dex_volume_usd", window: "24h", operator: "gte", threshold, mode, onUnknown: mode === "required" ? "block" : "warn" });
const whaleRule = { metric: "whale_net_flow_usd", window: "7d", operator: "gt", threshold: 0, mode: "advisory", onUnknown: "warn" };

function snapshot(window, volume, fetchedAt = "2026-09-15T11:58:00.000Z", expiresAt = "2026-09-15T12:03:00.000Z") {
  return {
    provider: "nansen",
    subject: { network: "solana:mainnet", mint: NVDAX, symbol: "NVDAx" },
    window,
    fetchedAt,
    observedAt: null,
    providerLagSeconds: 600,
    expiresAt,
    metrics: [
      { id: "dex_volume_usd", value: volume, unit: "usd", window, coverage: "full", note: null },
      { id: "whale_net_flow_usd", value: 12_000, unit: "usd", window, coverage: "full", note: null },
    ],
    warnings: [],
    attribution: { text: "Powered by Nansen API", href: "https://nansen.ai" },
    rightsPolicy: "nansen-guide-2025-11-18",
    families: ["tgm/token-screener", "tgm/flow-intelligence"],
  };
}
const fresh = (window, volume) => ({ window, read: { state: "FRESH", snapshot: snapshot(window, volume), reason: null, served: "provider" } });

function plan(conditions) {
  const rules = exampleRules({ evidenceConditions: conditions });
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
  };
}

const order = { inputMint: USDC, outputMint: NVDAX, inAmountRaw: "780000000", outAmountRaw: "429212000", requestId: "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c", slippageBps: 50, priceImpactPct: "0.02", totalFeeBasisPoints: 85, observedAt: "2026-09-15T11:59:57.000Z", reviewExpiresAt: "2026-09-15T12:00:57.000Z" };
const row = {
  representation: { mint: NVDAX, symbol: "NVDAx", name: "NVIDIA xStock", issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US", name: "NVIDIA" }, exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, sources: [] },
  market: { priceUsd: 181.7, change24hPct: 0, volume24hUsd: 0, liquidityUsd: 1_700_000, verified: true, observedAt: "2026-09-15T11:59:00.000Z", icon: null },
  tokenPerShareUsd: 181.39,
  multiplier: { current: 1.001701, pending: null, effectiveAt: null },
  multiplierState: "active",
  reference: { state: "current", perShare: 181.1, currency: "USD", source: { id: "issuer-xstocks", label: "xStocks" }, observedAt: "2026-09-15T11:58:00.000Z", fetchedAt: "2026-09-15T11:59:30.000Z", note: null },
  session: { ...UNKNOWN_SESSION, exchangeOpen: true },
  deviationPct: 0.16,
};

const judge = (p, evidence, nowMs = NOW) => evaluatePlanReview({ plan: p, requestedVersion: 2, order, row, usdcMint: USDC, nowMs, evidence });
const evidenceOf = (review) => review.checks.filter((check) => check.id === "evidence");

test("a version without conditions gains no check and no block, whatever was read", () => {
  const review = judge(plan([]), [fresh("24h", 5_000_000)]);
  assert.equal(review.checks.length, 17);
  assert.equal(review.evidence, undefined);
  assert.equal(review.verdict, "ready");
  assert.deepEqual(evidenceChecks({ rules: plan([]).current.rules, reads: [], nowMs: NOW }), { checks: [], evidence: null });
});

test("a required condition met on a fresh read passes; the block keeps the figure, the read and the retention", () => {
  const review = judge(plan([volumeRule(1_000_000)]), [fresh("24h", 1_284_530.12)]);
  PlanReviewSchema.parse(review);
  assert.equal(review.verdict, "ready");
  assert.equal(review.checks.length, 18);
  const [check] = evidenceOf(review);
  assert.equal(check.outcome, "pass");
  assert.equal(check.required, true);
  assert.equal(check.expected, "24h DEX trading volume ≥ $1,000,000");
  assert.equal(check.actual, "$1,284,530 · asked 11:58 UTC");
  assert.equal(review.evidence.provider, "nansen");
  assert.deepEqual(review.evidence.sources, [{ provider: "nansen", attribution: { text: "Powered by Nansen API", href: "https://nansen.ai" } }]);
  assert.deepEqual(review.evidence.reads, [{ provider: "nansen", window: "24h", state: "FRESH", fetchedAt: "2026-09-15T11:58:00.000Z", observedAt: null, providerLagSeconds: 600, reason: null }]);
  assert.equal(review.evidence.conditions[0].value, 1_284_530.12);
  assert.equal(review.evidence.retainedUntil, "2026-09-22T12:00:00.000Z", "seven days from the Review");
});

test("a required condition not met blocks; unknown, unavailable, stale and a missing window block too", () => {
  const unmet = judge(plan([volumeRule(2_000_000)]), [fresh("24h", 1_284_530.12)]);
  assert.equal(unmet.verdict, "blocked");
  assert.equal(evidenceOf(unmet)[0].outcome, "fail");

  const unavailable = judge(plan([volumeRule(1)]), [{ window: "24h", read: { state: "UNAVAILABLE", snapshot: null, reason: "The provider did not answer in time.", served: "provider" } }]);
  assert.equal(unavailable.verdict, "blocked");
  assert.equal(evidenceOf(unavailable)[0].outcome, "unknown");
  assert.equal(evidenceOf(unavailable)[0].actual, "unavailable");
  assert.equal(unavailable.evidence.reads[0].reason, "The provider did not answer in time.");

  const unknown = judge(plan([volumeRule(1)]), [{ window: "24h", read: { state: "UNKNOWN", snapshot: null, reason: "The provider has no data for this token.", served: "provider" } }]);
  assert.equal(unknown.verdict, "blocked");
  assert.equal(evidenceOf(unknown)[0].actual, "no data");

  const stale = judge(plan([volumeRule(1)]), [fresh("24h", 5_000_000)], Date.parse("2026-09-15T12:10:00.000Z"));
  assert.equal(stale.verdict, "blocked", "a figure past its expiry is not a pass, however large");
  assert.match(evidenceOf(stale)[0].actual, /stale/);

  const missing = judge(plan([volumeRule(1)]), []);
  assert.equal(missing.verdict, "blocked");
  assert.equal(missing.evidence.reads[0].state, "UNAVAILABLE");
  assert.equal(missing.evidence.reads[0].reason, "No observation was read for 24h.");
});

test("an advisory condition names its result and never blocks; conditions keep the version's order and windows", () => {
  const review = judge(plan([volumeRule(1_000_000, "advisory"), whaleRule]), [fresh("24h", 500_000), fresh("7d", 9_000_000)]);
  assert.equal(review.verdict, "attention");
  const checks = evidenceOf(review);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].outcome, "fail");
  assert.equal(checks[0].required, false);
  assert.equal(checks[1].outcome, "pass", "the 7d whale flow of $12,000 is above zero");
  assert.equal(checks[1].expected, "7d net token movement by large holders > $0.00");
  assert.deepEqual(review.evidence.reads.map((read) => read.window), ["24h", "7d"]);
  const advisoryUnknown = judge(plan([whaleRule]), []);
  assert.equal(advisoryUnknown.verdict, "attention", "an advisory unknown warns, never blocks");
});

test("after retention the figures are redacted and the verdict stays; before it nothing changes", () => {
  const review = judge(plan([volumeRule(1_000_000)]), [fresh("24h", 1_284_530.12)]);
  assert.deepEqual(redactExpiredEvidence(review, Date.parse("2026-09-20T00:00:00.000Z")), review);
  const later = redactExpiredEvidence(review, Date.parse("2026-09-23T00:00:00.000Z"));
  assert.equal(later.verdict, "ready");
  assert.equal(evidenceOf(later)[0].outcome, "pass");
  assert.equal(evidenceOf(later)[0].actual, "retained until 2026-09-22");
  assert.equal(later.evidence.conditions[0].value, null);
  assert.equal(later.checks.find((check) => check.id === "risk").actual, review.checks.find((check) => check.id === "risk").actual, "the money checks are Ryntra's own and stay");
  PlanReviewSchema.parse(later);
});
