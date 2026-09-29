// Run from repo root: node --test lib/plans/results.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { PlanMemoryResponseSchema, PlanResultsResponseSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { memoryFactsOf } from "./memory.ts";
import { noTradeOutcomeOf } from "./outcomes.ts";
import { positionOf } from "./position.ts";
import { createPlan, getPlanResults, listPlanMemory, listPlanResults, recordPlanReview, setPlanStatus, updatePlan } from "./service.ts";
import { readTradingPlan } from "./store.ts";
import { exampleRules } from "./sizing.test.mjs";

/**
 * Results beyond the entry — `RYN-RESULTS-MEMORY-001`.
 *
 * What a plan's result must answer once the trade is behind it: which side
 * the operation was, what the position is, what an exit did against the
 * rules that existed *before* it, why a plan that never traded did not, and
 * what may be remembered — with every figure either measured, modelled or
 * plainly absent. Nothing here reaches a network; the clock is a value.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OTHER = "6dNVGbAbsBP1z2tYCFeqMdBnYYU3rxPMtvhKMPFkvpJk";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = "2026-09-20T12:00:00.000Z";
const ENTRY_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const EXIT_SIG = "5pobZhDyagXu3VGxSgb7sshzXsibnDJkfgkUyQ2BdXTyWctXB5KMdoXD4aaQL2ih4kJ7sDXQXcEffH2d2iL2LhJD";
const REVIEW_ID = "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c";

/* SOL as the venue lists it: a verified major, priced per token, nine decimals — no multiplier, so its units are countable from the mint alone. */
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

/** A plan on SOL: entry $210, max $215, invalidation $190, target $260, $500 of budget, $50 of planned risk. */
const solRules = (overrides = {}) =>
  exampleRules({
    entry: { pricePerShare: 210, maxPricePerShare: 215, validUntil: "2026-10-15T00:00:00.000Z" },
    capital: { budgetUsd: 500, reserveForCostsUsd: 10 },
    risk: { invalidationPerShare: 190, plannedRiskUsd: 50, costBufferBps: 100 },
    exit: { targetPerShare: 260, timeExitAt: null, invalidationIsOrder: false },
    execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null },
    ...overrides,
  });

function reviewFor(plan, overrides = {}) {
  return {
    planId: plan.id,
    version: plan.version,
    latestVersion: plan.version,
    reviewId: REVIEW_ID,
    checkedAt: "2026-09-15T11:58:40.000Z",
    verdict: "ready",
    checks: [{ id: "status", outcome: "pass", required: true, expected: "active", actual: "active" }],
    quote: {
      side: "BUY", usd: 420, amount: "1.970000", unit: "token", multiplier: null, perShareUsd: 213.2, referencePerShareUsd: null, referenceState: "unavailable",
      deviationPct: null, priceImpactPct: 0.01, slippageBps: 50, feeBps: 85, observedAt: "2026-09-15T11:58:37.000Z", reviewExpiresAt: "2026-09-15T11:59:37.000Z", modelledLossUsd: 46.06, fitUsd: 490,
    },
    ...overrides,
  };
}

const swapRow = (over) => ({
  schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, lane: "SWAP", outcome: "DONE",
  destination: null, receiptHash: null, sourceTx: null, destinationTx: null, providerRef: null, statedUsd: null, ...over,
});

/** The entry the plan bound before the signature: $420.00 out, 1.97 SOL in. */
const entryRow = (plan, over = {}) =>
  swapRow({
    actionId: ENTRY_SIG, signature: ENTRY_SIG,
    out: { mint: USDC, amountRaw: "420000000", decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "1970000000", decimals: null, symbol: null },
    fee: { collected: true, basisPoints: 85, amountRaw: null, decimals: null, symbol: null, usd: 0.36, asset: null, providerRaw: null, ryntraRaw: null },
    origin: { surface: "SPOT", side: "BUY", plan: { planId: plan.id, version: plan.version, reviewId: REVIEW_ID } },
    startedAt: "2026-09-15T11:59:50.000Z", updatedAt: "2026-09-15T12:00:10.000Z",
    ...over,
  });

/** The exit, made on Spot with no plan on it: 1.97 SOL out, $370.00 in — $187.82 a token. */
const exitRow = (over = {}) =>
  swapRow({
    actionId: EXIT_SIG, signature: EXIT_SIG,
    out: { mint: SOL, amountRaw: "1970000000", decimals: null, symbol: null },
    in: { mint: USDC, amountRaw: "370000000", decimals: null, symbol: null },
    fee: { collected: true, basisPoints: 85, amountRaw: null, decimals: null, symbol: null, usd: 0.31, asset: null, providerRaw: null, ryntraRaw: null },
    origin: { surface: "SPOT", side: "SELL" },
    startedAt: "2026-09-19T15:19:42.000Z", updatedAt: "2026-09-19T15:20:00.000Z",
    ...over,
  });

/** The plan is written before the operations it is read against — a version is only in force from the moment it was written. */
const WRITTEN_AT = "2026-09-15T10:00:00.000Z";

async function planWithEntry(store, overrides = {}) {
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(overrides), activate: true }, deps(WRITTEN_AT));
  assert.ok(created.ok, JSON.stringify(created));
  await recordPlanReview(store, { owner: OWNER, review: reviewFor(created.plan) }, deps(WRITTEN_AT));
  return created.plan;
}

test("the entry is an entry: the side comes off the row's origin, the money checks judge the fill, and the position is open with no realised figure", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan)] });
  assert.ok(read.ok);
  PlanResultsResponseSchema.parse({ address: OWNER, results: read.results, sync: read.sync, outcomes: read.outcomes, positions: read.positions, summary: read.summary });
  assert.equal(read.results.length, 1);
  const result = read.results[0];
  assert.equal(result.actual.side, "BUY");
  assert.equal(result.actual.leg, "entry");
  assert.equal(result.actual.matchedBy, "binding");
  assert.equal(result.actual.usd, 420, "what left the wallet");
  assert.equal(result.actual.proceedsUsd, null, "an entry brings no proceeds");
  assert.equal(result.actual.amount, "1.970000");
  assert.equal(result.actual.unitsOut, null);
  assert.equal(result.actual.valueBasis, "PAR");
  assert.ok(Math.abs(result.actual.perShareUsd - 213.198) < 0.01);
  assert.equal(result.verdict, "followed");
  assert.equal(result.exit, null, "an entry is judged by no exit rule");
  /* The plan itself now carries the side, so a later read never has to guess. */
  const record = await readTradingPlan(store, OWNER, plan.id);
  assert.equal(record.executions[0].side, "BUY");

  assert.equal(read.positions.length, 1);
  const position = read.positions[0].position;
  assert.equal(position.state, "open");
  assert.equal(position.unitsIn, "1.970000");
  assert.equal(position.unitsHeld, "1.970000");
  assert.equal(position.costBasisUsd, 420);
  assert.equal(position.proceedsUsd, null);
  assert.equal(position.realisedUsd, null, "an open position has no realised profit or loss");
  assert.deepEqual(position.unknowns, ["position-open"]);
  assert.deepEqual(read.summary, { plans: 1, trades: 1, entries: 1, exits: 0, noTrade: 0, openPositions: 1, closedPositions: 0 });
});

test("the exit is an exit: a sell of the plan's mint is paired by asset, valued off the leg that arrived, and closes the position with a realised figure that names its method", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan), exitRow()] });
  assert.ok(read.ok);
  assert.equal(read.results.length, 2);
  const exit = read.results.find((row) => row.actual.leg === "exit");
  assert.ok(exit, "the sell is read as an exit, not a second entry");
  assert.equal(exit.actual.side, "SELL");
  assert.equal(exit.actual.matchedBy, "asset", "it was paired, not declared — and the result says so");
  assert.equal(exit.actual.proceedsUsd, 370);
  assert.equal(exit.actual.usd, null, "nothing left the wallet in dollars on an exit");
  assert.equal(exit.actual.unitsOut, "1.970000");
  assert.equal(exit.actual.amount, null);
  assert.ok(Math.abs(exit.actual.perShareUsd - 187.817) < 0.01);
  assert.equal(exit.verdict, "unknown", "the entry's money checks do not speak of an exit");
  assert.deepEqual(exit.checks, []);

  const position = read.positions[0].position;
  assert.equal(position.state, "closed");
  assert.equal(position.unitsHeld, "0.000000");
  assert.equal(position.entries, 1);
  assert.equal(position.exits, 1);
  assert.equal(position.costBasisUsd, 420);
  assert.equal(position.proceedsUsd, 370);
  assert.equal(position.feesUsd, 0.67);
  assert.equal(position.realisedUsd, -50.67, "370.00 − 420.00 − 0.67");
  assert.equal(position.realisedMethod, "proceeds-minus-cost-basis-and-fees");
  assert.deepEqual(position.unknowns, []);
  assert.equal(read.summary.exits, 1);
  assert.equal(read.summary.closedPositions, 1);
});

test("an exit is judged by the exit rules of the version in force when it settled, and the checks carry both figures", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan), exitRow()] });
  const exit = read.results.find((row) => row.actual.leg === "exit");
  assert.equal(exit.exit.ruledByVersion, 1);
  assert.equal(exit.exit.verdict, "deviated");
  const byId = Object.fromEntries(exit.exit.checks.map((check) => [check.id, check]));
  assert.equal(byId.exitTarget.outcome, "fail", "$187.82 is under the $260.00 target that stood");
  assert.equal(byId.exitInvalidation.outcome, "fail", "and at or below the $190.00 invalidation");
  assert.equal(byId.exitTarget.expected, "at least $260.00 / token");
  assert.equal(byId.exitInvalidation.actual, "$187.82 / token");
  assert.equal(exit.exit.notBackdated, false);

});

test("a rule written after an exit is not applied backwards to it, and the result says a later rule exists", async () => {
  const store = createMemoryGuardStore();
  /* Version 1 names no exit rule at all. */
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules({ exit: { targetPerShare: null, timeExitAt: null, invalidationIsOrder: false } }), activate: true }, deps("2026-09-14T09:00:00.000Z"));
  assert.ok(created.ok, JSON.stringify(created));
  const plan = created.plan;
  await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps("2026-09-14T09:05:00.000Z"));
  /* The target is written on the sixteenth — the day after the exit. */
  const edited = await updatePlan(store, { owner: OWNER, planId: plan.id, rules: solRules(), ifVersion: 1, reason: "A target, after the fact." }, deps("2026-09-16T09:00:00.000Z"));
  assert.ok(edited.ok, JSON.stringify(edited));

  const ledger = async () => [
    entryRow(plan, { startedAt: "2026-09-14T11:59:50.000Z", updatedAt: "2026-09-14T12:00:10.000Z" }),
    exitRow({ startedAt: "2026-09-15T15:19:42.000Z", updatedAt: "2026-09-15T15:20:00.000Z" }),
  ];
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger });
  const exit = read.results.find((row) => row.actual.leg === "exit");
  assert.equal(exit.exit.ruledByVersion, 1, "the version in force at the exit, not the current one");
  assert.ok(!exit.exit.checks.some((check) => check.id === "exitTarget"), "the $260.00 target was written after the exit and is not judged against it");
  assert.equal(exit.exit.notBackdated, true, "the reader is told a later version carries an exit rule this judgement did not use");
  assert.equal(exit.exit.verdict, "deviated", "on the one rule that did exist: the exit was at or below the invalidation");
  assert.equal(exit.costs.plannedPerUnitUsd, null, "version 1 planned no exit price, so there is none to compare against");
});

test("a rule that refused every Review is the no-trade outcome, with the bound and what was found, and it is not a failure", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(), activate: true }, deps());
  assert.ok(created.ok);
  const blocked = reviewFor(created.plan, {
    verdict: "blocked",
    checks: [
      { id: "status", outcome: "pass", required: true, expected: "active", actual: "active" },
      { id: "entryPrice", outcome: "fail", required: true, expected: "at most $215.00 / token", actual: "$228.40 / token" },
    ],
  });
  await recordPlanReview(store, { owner: OWNER, review: blocked }, deps());
  const read = await listPlanResults(store, OWNER, { ...deps(), ledger: async () => [] });
  assert.equal(read.results.length, 0);
  assert.equal(read.outcomes.length, 1);
  const outcome = read.outcomes[0];
  assert.equal(outcome.kind, "no-trade");
  assert.equal(outcome.reason, "entry-bound-unmet");
  assert.equal(outcome.blockedBy, "entryPrice");
  assert.equal(outcome.expected, "at most $215.00 / token");
  assert.equal(outcome.found, "$228.40 / token");
  assert.equal(outcome.reviews, 1);
  assert.equal(outcome.everyReview, true, "the rule refused every Review, so *never satisfied* is a safe sentence");
  assert.equal(outcome.failure, false);
  assert.equal(read.summary.noTrade, 1);
  assert.equal(read.summary.trades, 0);
});

test("a plan whose entry window closed and one the person cancelled are outcomes of their own", async () => {
  const store = createMemoryGuardStore();
  const expiring = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules({ entry: { pricePerShare: 210, maxPricePerShare: 215, validUntil: "2026-09-18T00:00:00.000Z" } }), activate: true }, deps("2026-09-16T10:00:00.000Z"));
  assert.ok(expiring.ok, JSON.stringify(expiring));
  const cancelled = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(), activate: true }, deps("2026-09-16T10:05:00.000Z"));
  assert.ok(cancelled.ok);
  await setPlanStatus(store, { owner: OWNER, planId: cancelled.plan.id, status: "cancelled", ifVersion: 1, reason: "The thesis no longer holds." }, deps("2026-09-17T08:00:00.000Z"));

  const read = await listPlanResults(store, OWNER, { ...deps(), ledger: async () => [] });
  const byPlan = Object.fromEntries(read.outcomes.map((outcome) => [outcome.planId, outcome]));
  assert.equal(byPlan[expiring.plan.id].reason, "expired");
  assert.equal(byPlan[expiring.plan.id].observedAt, "2026-09-18T00:00:00.000Z", "the window's own end, not the read's clock");
  assert.equal(byPlan[cancelled.plan.id].reason, "cancelled");
  assert.equal(byPlan[cancelled.plan.id].observedAt, "2026-09-17T08:00:00.000Z");
  for (const outcome of read.outcomes) assert.equal(outcome.failure, false);
  /* An active plan nobody has reviewed says exactly that, rather than nothing. */
  const fresh = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(), activate: true }, deps());
  const again = await listPlanResults(store, OWNER, { ...deps(), ledger: async () => [] });
  assert.equal(again.outcomes.find((outcome) => outcome.planId === fresh.plan.id).reason, "no-review");
});

test("costs are three parts that are never added together, and what the Review modelled is never called paid", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan)] });
  const costs = read.results[0].costs;
  assert.equal(costs.plannedPerUnitUsd, 210);
  assert.equal(costs.quotedPerUnitUsd, 213.2);
  assert.ok(Math.abs(costs.filledPerUnitUsd - 213.198) < 0.01);
  assert.equal(costs.marketMove.basis, "known");
  assert.ok(Math.abs(costs.marketMove.pct - 1.5238) < 0.001, "the market between writing the plan and the Review");
  assert.equal(costs.execution.basis, "known");
  assert.ok(Math.abs(costs.execution.pct) < 0.01, "the fill matched the quote");
  assert.equal(costs.fee.basis, "known");
  assert.equal(costs.fee.usd, 0.36);
  assert.equal(costs.expected.feeBps, 85, "the quoted rate stays under `expected`");
  assert.equal(costs.expected.slippageBps, 50);
  assert.equal(costs.expected.quotedUsd, 420);
  assert.equal(read.results[0].actual.feeBasis, "PROVIDER_STATED");
});

test("what was not measured is not invented: a row with no fee, no Review and an unreadable value leaves each figure null with its reason", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  /* No Review was kept, the fee was never recorded, and the dollars left in a mint nothing carries at par. */
  const bare = entryRow(plan, { fee: null, out: { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", amountRaw: "420000000", decimals: null, symbol: null } });
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [bare] });
  const result = read.results[0];
  assert.equal(result.beforeSigning, null);
  assert.equal(result.actual.usd, null, "an unpriced leg is not valued, and not zero");
  assert.equal(result.actual.valueBasis, null);
  assert.equal(result.actual.feeUsd, null);
  assert.equal(result.actual.feeBasis, null);
  assert.equal(result.verdict, "unknown");
  assert.equal(result.costs.marketMove.basis, "unknown");
  assert.equal(result.costs.marketMove.reason, "no-review");
  assert.equal(result.costs.fee.basis, "unknown");
  assert.equal(result.costs.fee.reason, "fee-not-recorded");
  assert.equal(read.positions[0].position.costBasisUsd, null);
  assert.equal(read.positions[0].position.realisedUsd, null);
  assert.ok(read.positions[0].position.unknowns.includes("entry-not-valued"));
  /* A fee the provider reported as not taken is a measured zero, which is a different fact from no fee at all. */
  const free = entryRow(plan, { fee: { collected: false, basisPoints: null, amountRaw: null, decimals: null, symbol: null, usd: null, asset: null, providerRaw: null, ryntraRaw: null, state: "NOT_APPLIED", note: "under the floor" } });
  const second = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [free] });
  assert.equal(second.results[0].actual.feeUsd, 0);
  assert.equal(second.results[0].actual.feeBasis, "NOT_TAKEN");
});

test("a sell is paired to a plan only when one plan of the wallet names its mint, and never before that plan's own entry", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  /* A sale made before this plan ever bought belongs to nothing here. */
  const early = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan), exitRow({ startedAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:20.000Z" })] });
  assert.equal(early.results.length, 1, "an earlier sale is not this plan's exit");
  /* A second plan on the same mint makes the association a guess, so nothing is paired at all. */
  const second = await createPlan(store, { owner: OWNER, mint: SOL, rules: solRules(), activate: true }, deps(WRITTEN_AT));
  assert.ok(second.ok);
  const ambiguous = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [entryRow(plan), exitRow()] });
  assert.equal(ambiguous.results.length, 1, "two plans on one mint pair no sale");
  assert.equal(ambiguous.positions[0].position.state, "open");
});

test("memory is derived from the records and cites them; another wallet's memory is empty", async () => {
  const store = createMemoryGuardStore();
  const plan = await planWithEntry(store);
  const ledger = async () => [entryRow(plan), exitRow()];
  const note = { id: "inb_4c7a1e9b2d5f", href: `/app/strategies/plans/${plan.id}`, createdAt: "2026-09-19T06:10:00.000Z", subject: { kind: "trading-plan", id: plan.id }, finding: { kind: "invalidation", outcome: "crossed", facts: { observedAt: "2026-09-19T06:09:30.000Z" } } };
  const read = await listPlanMemory(store, OWNER, [note], { ...deps(), ledger });
  PlanMemoryResponseSchema.parse({ address: OWNER, facts: read.facts, sync: read.sync });
  const kinds = read.facts.map((fact) => fact.kind);
  assert.ok(kinds.includes("plans-written"));
  assert.ok(kinds.includes("entry-vs-plan"));
  assert.ok(kinds.includes("exit-adherence"));
  assert.ok(kinds.includes("monitoring-said"));
  for (const fact of read.facts) assert.ok(fact.cites.length > 0, `every fact cites a record: ${fact.kind}`);
  const entry = read.facts.find((fact) => fact.kind === "entry-vs-plan");
  assert.equal(entry.figures.find((figure) => figure.key === "planned").value, 210);
  assert.ok(Math.abs(entry.figures.find((figure) => figure.key === "diff").value - 1.5228) < 0.001);
  assert.deepEqual(entry.cites.map((cite) => cite.kind), ["plan", "version", "execution"]);
  assert.equal(entry.cites.find((cite) => cite.kind === "execution").id, ENTRY_SIG);
  const said = read.facts.find((fact) => fact.kind === "monitoring-said");
  assert.equal(said.cites[0].id, note.id);
  /* Memory is a projection: the same records read twice give the same facts, and a wallet reads only its own. */
  const again = await listPlanMemory(store, OWNER, [note], { ...deps(), ledger });
  assert.deepEqual(again.facts, read.facts);
  assert.deepEqual((await listPlanMemory(store, OTHER, [note], { ...deps(), ledger })).facts, []);
  assert.deepEqual((await listPlanResults(store, OTHER, { ...deps(), ledger })).results, []);
});

test("the pure projections stand on their own: no results is no position, and a plan that traded has no no-trade outcome", () => {
  assert.equal(positionOf([]).state, "none");
  assert.deepEqual(positionOf([]).unknowns, ["no-entry"]);
  const record = {
    id: "plan_00000000000000000000000000000001", owner: OWNER, network: "solana:mainnet", status: "executed", side: "BUY", planVersion: 1, version: 2,
    asset: { network: "solana:mainnet", mint: SOL, symbol: "SOL", issuer: { id: "jupiter-verified", label: "Jupiter verified" }, underlying: { symbol: "SOL", name: "Wrapped SOL" }, decimals: 9, unitBasis: "token", kind: "crypto" },
    history: [{ version: 1, rules: solRules(), sizing: { model: "spot-long-v1", lossPerShareUsd: 22.1, riskLimitedUnits: 2.262443, capitalLimitedUnits: 2.333333, units: 2.262443, notionalUsd: 475.11, limitedBy: "risk", assumptions: ["x"] }, createdAt: "2026-09-15T10:00:00.000Z", reason: null }],
    journal: [{ at: "2026-09-15T10:00:00.000Z", event: "created", version: 1, note: null, ref: null }],
    executions: [{ signature: ENTRY_SIG, version: 1, reviewedAt: "2026-09-15T11:58:40.000Z", recordedAt: "2026-09-15T12:00:10.000Z", outcome: "DONE", reviewId: REVIEW_ID, side: "BUY", review: null }],
    reviews: [], createdAt: "2026-09-15T10:00:00.000Z", updatedAt: "2026-09-15T12:00:10.000Z",
  };
  assert.equal(noTradeOutcomeOf(record, Date.parse(NOW)), null, "a plan that traded is never also a no-trade outcome");
  assert.deepEqual(memoryFactsOf([]), []);
});
