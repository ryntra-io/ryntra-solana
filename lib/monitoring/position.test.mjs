import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { createPlan, getPlanResults, recordPlanReview } from "../plans/service.ts";
import { readTradingPlan } from "../plans/store.ts";
import { exampleRules } from "../plans/sizing.test.mjs";
import { planIsWatched } from "./position.ts";

/*
 * The loop's last step: once a buy settles, the plan is watched as a position
 * for its loss limit, and it stops being watched when the position the plan's
 * own results add up to is closed (the state "executed" no longer switches
 * the watching off).
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = "2026-09-20T12:00:00.000Z";
const WRITTEN_AT = "2026-09-15T10:00:00.000Z";
const ENTRY_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const EXIT_SIG = "5pobZhDyagXu3VGxSgb7sshzXsibnDJkfgkUyQ2BdXTyWctXB5KMdoXD4aaQL2ih4kJ7sDXQXcEffH2d2iL2LhJD";
const REVIEW_ID = "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c";
const SOL_MARKET = {
  mint: SOL, symbol: "SOL", name: "Wrapped SOL", icon: null, decimals: 9, tokenProgram: null, price: 212.5, change24hPct: null, change1hPct: null, volume24hUsd: null, liquidityUsd: 50_000_000, marketCapUsd: null, fdvUsd: null,
  holders: null, organicScore: null, organicScoreLabel: null, verified: true, tags: ["verified"], category: "crypto", issuer: null, firstPoolAt: null,
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: null, devBalancePct: null, suspicious: false }, links: { website: null, twitter: null, telegram: null },
  stats: { h1: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null }, h24: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null } }, updatedAt: "2026-09-15T09:59:48.000Z",
};

let ids = 0;
const deps = (nowIso = NOW) => ({
  now: () => new Date(nowIso),
  findRow: async () => ({ ok: true, row: null, universe: { rows: [], marketsObservedAt: nowIso, issuerCatalogue: { ok: true, reason: null }, fetchedAt: nowIso } }),
  readMarket: async (mint) => ({ ok: true, market: mint === SOL ? SOL_MARKET : null, observedAt: nowIso, stale: false }),
  planId: () => `plan_${String(++ids).padStart(32, "0")}`,
});

const rules = () =>
  exampleRules({
    entry: { pricePerShare: 210, maxPricePerShare: 215, validUntil: null },
    capital: { budgetUsd: 500, reserveForCostsUsd: 10 },
    risk: { invalidationPerShare: 190, plannedRiskUsd: 50, costBufferBps: 100 },
    exit: { targetPerShare: 252, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null },
  });

const swapRow = (over) => ({
  schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, lane: "SWAP", outcome: "DONE",
  destination: null, receiptHash: null, sourceTx: null, destinationTx: null, providerRef: null, statedUsd: null, ...over,
});

const entryRow = (plan) =>
  swapRow({
    actionId: ENTRY_SIG, signature: ENTRY_SIG,
    out: { mint: USDC, amountRaw: "420000000", decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "1970000000", decimals: null, symbol: null },
    fee: { collected: true, basisPoints: 85, amountRaw: null, decimals: null, symbol: null, usd: 0.36, asset: null, providerRaw: null, ryntraRaw: null },
    origin: { surface: "SPOT", side: "BUY", plan: { planId: plan.id, version: plan.version, reviewId: REVIEW_ID } },
    startedAt: "2026-09-15T11:59:50.000Z", updatedAt: "2026-09-15T12:00:10.000Z",
  });

const exitRow = (amountRaw = "1970000000") =>
  swapRow({
    actionId: EXIT_SIG, signature: EXIT_SIG,
    out: { mint: SOL, amountRaw, decimals: null, symbol: null },
    in: { mint: USDC, amountRaw: "370000000", decimals: null, symbol: null },
    fee: { collected: true, basisPoints: 85, amountRaw: null, decimals: null, symbol: null, usd: 0.31, asset: null, providerRaw: null, ryntraRaw: null },
    origin: { surface: "SPOT", side: "SELL" },
    startedAt: "2026-09-19T15:19:42.000Z", updatedAt: "2026-09-19T15:20:00.000Z",
  });

const review = (plan) => ({
  planId: plan.id, version: plan.version, latestVersion: plan.version, reviewId: REVIEW_ID, checkedAt: "2026-09-15T11:58:40.000Z", verdict: "ready",
  checks: [{ id: "status", outcome: "pass", required: true, expected: "active", actual: "active" }],
  quote: {
    side: "BUY", usd: 420, amount: "1.970000", unit: "token", multiplier: null, perShareUsd: 213.2, referencePerShareUsd: null, referenceState: "unavailable",
    deviationPct: null, priceImpactPct: 0.01, slippageBps: 50, feeBps: 85, observedAt: "2026-09-15T11:58:37.000Z", reviewExpiresAt: "2026-09-15T11:59:37.000Z", modelledLossUsd: 46.06, fitUsd: 490,
  },
});

/** A plan whose buy settled: created active, reviewed, and its entry written onto it by a read of History. */
async function boughtPlan(store) {
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  assert.ok(created.ok, JSON.stringify(created));
  await recordPlanReview(store, { owner: OWNER, review: review(created.plan) }, deps(WRITTEN_AT));
  const read = await getPlanResults(store, OWNER, created.plan.id, { ...deps(), ledger: async () => [entryRow(created.plan)] });
  assert.ok(read.ok);
  const record = await readTradingPlan(store, OWNER, created.plan.id);
  assert.equal(record.status, "executed", "the settled buy makes the plan executed");
  return { plan: created.plan, record };
}

test("an active plan is watched for its entry rules; a draft or a cancelled one is not", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  const record = await readTradingPlan(store, OWNER, created.plan.id);
  assert.equal(planIsWatched(record, "active", [], 0, Date.parse(NOW)), true);
  assert.equal(planIsWatched(record, "draft", [], 0, Date.parse(NOW)), false);
  assert.equal(planIsWatched(record, "cancelled", [], 0, Date.parse(NOW)), false);
  assert.equal(planIsWatched(record, "expired", [], 0, Date.parse(NOW)), false);
});

test("a plan whose buy settled is watched as a position until the position is closed", async () => {
  const store = createMemoryGuardStore();
  const { plan, record } = await boughtPlan(store);
  const now = Date.parse(NOW);
  assert.equal(planIsWatched(record, "executed", [entryRow(plan)], 0, now), true, "bought and held: the loss limit is watched");
  assert.equal(planIsWatched(record, "executed", [entryRow(plan), exitRow("985000000")], 0, now), true, "half sold: the rest is still watched");
  assert.equal(planIsWatched(record, "executed", [entryRow(plan), exitRow()], 0, now), false, "sold in full: nothing left to warn about");
  assert.equal(planIsWatched(record, "executed", [entryRow(plan), exitRow()], 1, now), true, "another plan names the mint: the sale cannot be paired, so the position is watched on");
});
