import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { createPlan, recordPlanReview } from "../plans/service.ts";
import { listTradingPlans, readTradingPlan } from "../plans/store.ts";
import { exampleRules } from "../plans/sizing.test.mjs";
import { readPositions } from "./positions.server.ts";

/*
 * A position bought under a plan is watched by that plan's exit after the
 * purchase: the plan's «Виконано» stops nothing, and a plan whose execution's
 * write failed is brought level with History first — or it would read
 * «expired», and the position unprotected.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WRITTEN_AT = "2026-09-15T10:00:00.000Z";
const NOW = "2026-09-20T12:00:00.000Z";
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

const exitRow = () =>
  swapRow({
    actionId: EXIT_SIG, signature: EXIT_SIG,
    out: { mint: SOL, amountRaw: "1970000000", decimals: null, symbol: null },
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

/** The token as a universe row Нагляд reads — SOL standing in for a company, at $200 observed a minute before the read. */
const universe = {
  ok: true,
  universe: {
    rows: [
      {
        representation: { mint: SOL, symbol: "SOL", name: "Wrapped SOL", underlying: { symbol: "SOL", name: "Solana", isin: null, listingCountry: null }, instrument: { class: "listed-equity", unitBasis: "share", rights: "economic" }, decimals: 9, tradingHalted: false },
        market: { priceUsd: 200, observedAt: "2026-09-20T11:59:00.000Z", icon: null },
        multiplier: null,
        reference: { state: "unavailable" },
        deviationPct: null,
        session: { period: "market" },
        lifecycle: { state: "active" },
      },
    ],
  },
};

const readWith = (store, rows, held = 1_970_000_000n) =>
  readPositions(store, OWNER, Date.parse(NOW), {
    readHeld: async () => ({ held: new Map([[SOL, held]]), frozen: new Set(), complete: true }),
    readUniverse: async () => universe,
    readTelegram: async () => true,
    readRows: async () => rows,
  });

test("a plan whose purchase History holds but whose execution was never written is levelled, and its exit watches the position", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  assert.ok(created.ok, JSON.stringify(created));
  await recordPlanReview(store, { owner: OWNER, review: review(created.plan) }, deps(WRITTEN_AT));
  assert.equal((await readTradingPlan(store, OWNER, created.plan.id)).status, "active", "the write after the purchase never landed");

  const read = await readWith(store, [entryRow(created.plan)]);
  assert.equal(read.positions.length, 1);
  assert.deepEqual(read.positions[0].exit, { source: "plan", limit: 190, target: 252, preset: null, planId: created.plan.id });
  assert.equal(read.positions[0].state, "on-plan", "$200 between the limit $190 and the target $252");
  assert.equal((await readTradingPlan(store, OWNER, created.plan.id)).status, "executed", "the plan is level with History now");
});

test("a plan's exit stops watching once History says the position was sold in full; a plan never bought gives no exit", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  await recordPlanReview(store, { owner: OWNER, review: review(created.plan) }, deps(WRITTEN_AT));
  const sold = await readWith(store, [entryRow(created.plan), exitRow()]);
  assert.equal(sold.positions[0].state, "exit-not-set", "the tokens held now are not the plan's position any more");

  const other = createMemoryGuardStore();
  await createPlan(other, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  const unbought = await readWith(other, []);
  assert.equal(unbought.positions[0].state, "exit-not-set", "a plan waiting for its entry protects nothing held");
});

test("every plan's exit is read, not a page of them: a purchase older than fifty newer plans keeps its exit, and the exits read whole", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: true }, deps(WRITTEN_AT));
  await recordPlanReview(store, { owner: OWNER, review: review(created.plan) }, deps(WRITTEN_AT));
  /* Fifty-five drafts written after it: a page of fifty would not reach the bought one. */
  for (let index = 0; index < 55; index += 1) {
    const draft = await createPlan(store, { owner: OWNER, mint: SOL, rules: rules(), activate: false }, deps("2026-09-16T10:00:00.000Z"));
    assert.ok(draft.ok, JSON.stringify(draft));
  }
  const page = await listTradingPlans(store, OWNER);
  assert.equal(page.total, 56);
  assert.equal(page.records.some((record) => record.id === created.plan.id), false, "a page of fifty does not reach the bought plan");
  const read = await readWith(store, [entryRow(created.plan)]);
  assert.equal(read.exits, "complete");
  assert.deepEqual(read.positions[0].exit, { source: "plan", limit: 190, target: 252, preset: null, planId: created.plan.id });
  assert.equal(read.positions[0].state, "on-plan");
});
