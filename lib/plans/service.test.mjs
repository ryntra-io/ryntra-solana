// Run from repo root: node --test lib/plans/service.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { PlanResponseSchema, PlanResultsResponseSchema, TradingPlanSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { REFERENCE_UNAVAILABLE, UNKNOWN_SESSION } from "../stocks/session.ts";
import { STOCK_ISSUERS } from "../stocks/representations.ts";
import { createPlan, getPlan, getPlanResults, getPlanVersion, listPlanResults, listPlans, recordPlanExecution, recordPlanReview, setPlanStatus, updatePlan } from "./service.ts";
import { exampleRules } from "./sizing.test.mjs";

/**
 * The plan's lifecycle (canon §9.3–§9.5): a plan is the wallet's, every
 * edit is a new version, a stale version is refused, an executed or
 * cancelled plan is not edited, the size stored on a version is the one the
 * model computes, and another wallet reads nothing.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OTHER = "So11111111111111111111111111111111111111112";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
/** Wrapped SOL, the native asset on the venue's verified list (1.7.0: a crypto plan). */
const SOL = "So11111111111111111111111111111111111111112";
/** A catalogue meme (BONK), verified, five decimals, priced in fractions of a cent. */
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
/** A mint nobody lists — not a stock, not on the catalogue. */
const NOBODY = "11111111111111111111111111111111";
/** A meme the catalogue lists but does not verify. */
const UNVERIFIED = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const NOW = "2026-09-15T12:00:00.000Z";

const row = {
  representation: {
    mint: NVDAX,
    symbol: "NVDAx",
    name: "NVIDIA xStock",
    issuer: STOCK_ISSUERS.xstocks,
    issuerConfirmation: "issuer-catalogue",
    underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US", name: "NVIDIA" },
    exchange: null,
    tokenProgram: null,
    decimals: 8,
    tradingHalted: false,
    sources: ["jupiter-verified", "xstocks-public-api"],
  },
  market: { priceUsd: 212, change24hPct: 0, volume24hUsd: 0, liquidityUsd: 1_000_000, verified: true, observedAt: NOW, icon: null },
  tokenPerShareUsd: 211.6,
  multiplier: { current: 1.001701, pending: null, effectiveAt: null },
  multiplierState: "active",
  reference: { ...REFERENCE_UNAVAILABLE },
  session: UNKNOWN_SESSION,
  deviationPct: null,
};
const universe = { rows: [row], marketsObservedAt: NOW, issuerCatalogue: { ok: true, reason: null }, fetchedAt: NOW };
const findRow = async (ticker) => ({ ok: true, row: ticker === NVDAX || ticker === "NVDAx" ? row : null, universe });

/* The Spot catalogue as a fixture (1.7.0): SOL a verified major, BONK a verified meme with a price in fractions of a cent, one unverified meme, and nothing for anyone else. Nothing here reaches the network. */
const marketOf = (mint, patch) => ({
  mint, symbol: "X", name: "X", icon: null, decimals: 9, tokenProgram: null, price: null, change24hPct: null, change1hPct: null, volume24hUsd: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, holders: null, organicScore: null, organicScoreLabel: null,
  verified: true, tags: ["verified"], category: "crypto", issuer: null, firstPoolAt: null, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: null, devBalancePct: null, suspicious: false }, links: { website: null, twitter: null, telegram: null },
  stats: { h1: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null }, h24: { priceChangePct: null, volumeUsd: null, buys: null, sells: null, traders: null } }, updatedAt: "2026-09-15T11:59:30.000Z", ...patch,
});
const MARKETS = {
  [SOL]: marketOf(SOL, { symbol: "SOL", name: "Wrapped SOL", decimals: 9, price: 212.5, liquidityUsd: 50_000_000, tags: ["verified", "community", "strict"], category: "crypto" }),
  [BONK]: marketOf(BONK, { symbol: "Bonk", name: "Bonk", decimals: 5, price: 0.00001234, liquidityUsd: 3_000_000, tags: ["verified", "meme"], category: "meme" }),
  [UNVERIFIED]: marketOf(UNVERIFIED, { symbol: "COPY", name: "A copy", decimals: 6, price: 0.5, liquidityUsd: 1_000, verified: false, tags: [], category: null }),
};
const readMarket = async (mint) => (MARKETS[mint] ? { ok: true, market: MARKETS[mint], observedAt: NOW, stale: false } : { ok: true, market: null, observedAt: NOW, stale: false });
let ids = 0;
const deps = () => ({ now: () => new Date(NOW), findRow, readMarket, planId: () => `plan_${String(++ids).padStart(32, "0")}` });

/** A crypto or meme plan's rules: per token, no reference rule (a token has none), the rest as the example. */
const tokenRules = (overrides = {}) => exampleRules({ execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: null, referenceRequired: false, minLiquidityUsd: null }, ...overrides });

test("a plan is created for the wallet with its size computed, read back, listed, and unseen by another wallet", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok, JSON.stringify(created));
  const { plan } = created;
  PlanResponseSchema.parse({ plan });
  assert.equal(plan.status, "active");
  assert.equal(plan.version, 1);
  assert.equal(plan.asset.symbol, "NVDAx");
  assert.equal(plan.asset.underlying.symbol, "NVDA");
  assert.equal(plan.current.sizing.units, 4.587155, "the stored size is the model's");
  assert.deepEqual(plan.journal.map((entry) => entry.event), ["created", "activated"]);
  const read = await getPlan(store, OWNER, plan.id, deps());
  assert.ok(read.ok);
  assert.deepEqual(read.plan, plan);
  const listed = await listPlans(store, OWNER, deps());
  assert.equal(listed.total, 1);
  assert.equal(listed.plans[0].id, plan.id);
  const other = await getPlan(store, OTHER, plan.id, deps());
  assert.equal(other.ok, false);
  assert.equal(other.code, "PLAN_NOT_FOUND");
  assert.equal((await listPlans(store, OTHER, deps())).total, 0);
});

test("rules that do not make a plan are refused with every field named, and an unconfirmed mint is refused as such", async () => {
  const store = createMemoryGuardStore();
  const bad = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules({ risk: { invalidationPerShare: 190, plannedRiskUsd: 5000, costBufferBps: 100 } }), activate: false }, deps());
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "PLAN_INVALID");
  assert.deepEqual(bad.issues.map((issue) => issue.path).sort(), ["risk.invalidationPerShare", "risk.plannedRiskUsd"]);
  const unknown = await createPlan(store, { owner: OWNER, mint: NOBODY, rules: exampleRules(), activate: false }, deps());
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "ASSET_UNCONFIRMED");
  assert.match(unknown.message, /neither a confirmed stock representation nor a token the catalogue lists/);
  assert.equal((await listPlans(store, OWNER, deps())).total, 0, "nothing was stored");
});

test("1.7.0: a plan on SOL and on a catalogue meme — token units, the kind, the planning price with its time; the reference rules refused on a token; an unverified token refused", async () => {
  const store = createMemoryGuardStore();
  const sol = await createPlan(store, { owner: OWNER, mint: SOL, rules: tokenRules(), activate: true }, deps());
  assert.ok(sol.ok, JSON.stringify(sol));
  PlanResponseSchema.parse({ plan: sol.plan });
  assert.equal(sol.plan.asset.kind, "crypto");
  assert.equal(sol.plan.asset.unitBasis, "token");
  assert.equal(sol.plan.asset.symbol, "SOL");
  assert.equal(sol.plan.asset.decimals, 9);
  assert.deepEqual(sol.plan.asset.underlying, { symbol: "SOL", name: "Wrapped SOL" }, "the token is its own underlying");
  assert.deepEqual(sol.plan.asset.issuer, { id: "jupiter-verified", label: "Jupiter verified" }, "the list that confirms the token stands where a stock names its issuer");
  assert.deepEqual(sol.plan.current.planningPrice, { perUnit: 212.5, source: "jupiter-token-price", observedAt: "2026-09-15T11:59:30.000Z", state: "current" }, "the indication the server read at the write, with the source's own time");
  assert.equal(sol.plan.current.sizing.units, 4.587155, "the same formula on the person's entry, not on the indication");
  assert.ok(sol.plan.current.sizing.assumptions[0].includes("per token"), sol.plan.current.sizing.assumptions[0]);

  const bonk = await createPlan(store, { owner: OWNER, mint: BONK, rules: tokenRules({ entry: { pricePerShare: 0.00001234, maxPricePerShare: 0.0000126, validUntil: "2026-10-15T00:00:00.000Z" }, risk: { invalidationPerShare: 0.00001, plannedRiskUsd: 10, costBufferBps: 100 }, capital: { budgetUsd: 100, reserveForCostsUsd: 1 }, exit: { targetPerShare: 0.00002, timeExitAt: null, invalidationIsOrder: false } }), activate: false }, deps());
  assert.ok(bonk.ok, JSON.stringify(bonk));
  assert.equal(bonk.plan.asset.kind, "meme");
  assert.equal(bonk.plan.asset.decimals, 5);
  assert.ok(bonk.plan.current.sizing.lossPerShareUsd > 0, "a loss in millionths of a dollar is not rounded to nothing");
  assert.equal(bonk.plan.current.sizing.lossPerShareUsd, 0.0000024634);
  assert.equal(bonk.plan.current.sizing.limitedBy, "risk");
  assert.ok(bonk.plan.current.sizing.assumptions[0].includes("$0.00001 per token"), bonk.plan.current.sizing.assumptions[0]);

  /* The reference rules cannot stand on a token: refused at the write with their paths and codes, nothing stored. */
  const required = await createPlan(store, { owner: OWNER, mint: SOL, rules: exampleRules(), activate: false }, deps());
  assert.equal(required.ok, false);
  assert.equal(required.code, "PLAN_INVALID");
  assert.deepEqual(required.issues.map((issue) => [issue.path, issue.code]), [["execution.referenceRequired", "REFERENCE_NOT_ON_TOKEN"], ["execution.maxReferenceDeviationPct", "DEVIATION_NOT_ON_TOKEN"]]);

  /* An edit is sized in the same context, and records the indication of its own write. */
  const edited = await updatePlan(store, { owner: OWNER, planId: sol.plan.id, rules: tokenRules({ capital: { budgetUsd: 1200, reserveForCostsUsd: 20 } }), ifVersion: 1, reason: "More budget." }, deps());
  assert.ok(edited.ok, JSON.stringify(edited));
  assert.equal(edited.plan.version, 2);
  assert.equal(edited.plan.current.planningPrice.perUnit, 212.5);
  const stale = await updatePlan(store, { owner: OWNER, planId: sol.plan.id, rules: exampleRules(), ifVersion: 2, reason: null }, deps());
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "PLAN_INVALID");

  /* Not verified by the venue: no plan, with the reason. */
  const copy = await createPlan(store, { owner: OWNER, mint: UNVERIFIED, rules: tokenRules(), activate: false }, deps());
  assert.equal(copy.ok, false);
  assert.equal(copy.code, "ASSET_UNCONFIRMED");
  assert.match(copy.message, /not on the venue's verified list/);
  assert.equal((await listPlans(store, OWNER, deps())).total, 2);

  /* No indication: the catalogue lists the token without a price, so the version records null and the entry stands as the person's own figure. */
  const priceless = { ...deps(), readMarket: async () => ({ ok: true, market: { ...MARKETS[SOL], price: null }, observedAt: NOW, stale: false }) };
  const manual = await createPlan(store, { owner: OTHER, mint: SOL, rules: tokenRules(), activate: false }, priceless);
  assert.ok(manual.ok, JSON.stringify(manual));
  assert.equal(manual.plan.current.planningPrice, null);

  /* The catalogue did not answer: unavailability, never a refusal of the asset. */
  const dark = { ...deps(), readMarket: async () => ({ ok: false, code: "UNREACHABLE", reason: "The catalogue did not answer." }) };
  const unavailable = await createPlan(store, { owner: OTHER, mint: SOL, rules: tokenRules(), activate: false }, dark);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "UNAVAILABLE");
});

test("an edit is a new version that keeps every earlier version readable; a stale ifVersion is refused; a draft activates", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: false }, deps());
  assert.ok(created.ok);
  const id = created.plan.id;
  assert.equal(created.plan.status, "draft");
  const edited = await updatePlan(store, { owner: OWNER, planId: id, rules: exampleRules({ capital: { budgetUsd: 1200, reserveForCostsUsd: 20 } }), ifVersion: 1, reason: "More budget." }, deps());
  assert.ok(edited.ok, JSON.stringify(edited));
  assert.equal(edited.plan.version, 2);
  assert.equal(edited.plan.current.rules.capital.budgetUsd, 1200);
  assert.deepEqual(edited.plan.versions.map((v) => v.version), [1, 2]);
  assert.equal(edited.plan.versions[1].reason, "More budget.");
  const v1 = await getPlanVersion(store, OWNER, id, 1);
  assert.ok(v1.ok);
  assert.equal(v1.version.rules.capital.budgetUsd, 1000, "version 1 keeps its own rules");
  const stale = await updatePlan(store, { owner: OWNER, planId: id, rules: exampleRules(), ifVersion: 1, reason: null }, deps());
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "PLAN_VERSION_CONFLICT");
  const activated = await setPlanStatus(store, { owner: OWNER, planId: id, status: "active", ifVersion: 2, reason: null }, deps());
  assert.ok(activated.ok);
  assert.equal(activated.plan.status, "active");
  assert.equal(activated.plan.version, 2, "a status change is not a version");
  assert.equal(activated.plan.journal.at(-1).event, "activated");
  TradingPlanSchema.parse(activated.plan);
});

test("a cancelled plan is not edited or re-activated; an unknown version is not found", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const id = created.plan.id;
  const cancelled = await setPlanStatus(store, { owner: OWNER, planId: id, status: "cancelled", ifVersion: 1, reason: "The thesis no longer holds." }, deps());
  assert.ok(cancelled.ok);
  assert.equal(cancelled.plan.status, "cancelled");
  const edit = await updatePlan(store, { owner: OWNER, planId: id, rules: exampleRules(), ifVersion: 1, reason: null }, deps());
  assert.equal(edit.ok, false);
  assert.equal(edit.code, "PLAN_STATE_REFUSED");
  const revive = await setPlanStatus(store, { owner: OWNER, planId: id, status: "active", ifVersion: 1, reason: null }, deps());
  assert.equal(revive.ok, false);
  assert.equal(revive.code, "PLAN_STATE_REFUSED");
  const missing = await getPlanVersion(store, OWNER, id, 9);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "PLAN_NOT_FOUND");
});

test("an active plan whose entry validity has passed reads as expired without a write, and a new version with a later validity brings it back", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules({ entry: { pricePerShare: 180, maxPricePerShare: 185, validUntil: "2026-09-16T00:00:00.000Z" } }), activate: true }, deps());
  assert.ok(created.ok);
  const later = { ...deps(), now: () => new Date("2026-09-17T00:00:00.000Z") };
  const read = await getPlan(store, OWNER, created.plan.id, later);
  assert.ok(read.ok);
  assert.equal(read.plan.status, "expired");
  const renewed = await updatePlan(store, { owner: OWNER, planId: created.plan.id, rules: exampleRules({ entry: { pricePerShare: 180, maxPricePerShare: 185, validUntil: "2026-10-01T00:00:00.000Z" } }), ifVersion: 1, reason: "Extended." }, later);
  assert.ok(renewed.ok, JSON.stringify(renewed));
  assert.equal(renewed.plan.status, "active");
});

/* ------------------------------------------------------------ stage B: the Review, the execution, the reconciliation, Plan vs Actual */

const SIGNATURE = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const SIGNATURE_2 = "3o4Vm9d5DYYbMN2eBFzcnQ2p8pWyCm5BtLv3vD1sdfS6fZ9Hh4YR2UjpxK1mU4o6XyG7tJ8LqW2pRt9Nc3sM6aBe";
const REVIEW_ID = "0b6d1a4e-6f5c-4b1e-9d2a-3c4e5f6a7b8c";

/** The Strategy block the order route judged for this plan and version: $780 buys 4.29942 NVDA at $181.42. */
function reviewFor(plan, overrides = {}) {
  return {
    planId: plan.id,
    version: plan.version,
    latestVersion: plan.version,
    reviewId: REVIEW_ID,
    checkedAt: "2026-09-15T12:00:00.000Z",
    verdict: "ready",
    checks: [{ id: "status", outcome: "pass", required: true, expected: "active", actual: "active" }],
    quote: {
      side: "BUY", usd: 780, amount: "4.299420", unit: "underlying", multiplier: 1.001701, perShareUsd: 181.42, referencePerShareUsd: 181.1, referenceState: "current",
      deviationPct: 0.177, priceImpactPct: 0.02, slippageBps: 50, feeBps: 85, observedAt: "2026-09-15T11:59:57.000Z", reviewExpiresAt: "2026-09-15T12:00:57.000Z", modelledLossUsd: 99.89, fitUsd: 780.8,
    },
    ...overrides,
  };
}

/** The History row the chain settled for that Review: $780.00 left, 4.29212 NVDAx arrived. */
function rowFor(plan, overrides = {}) {
  return {
    schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, actionId: SIGNATURE, lane: "SWAP", outcome: "DONE",
    out: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "780000000", decimals: null, symbol: null },
    in: { mint: NVDAX, amountRaw: "429212000", decimals: null, symbol: null },
    destination: null, signature: SIGNATURE, receiptHash: null, sourceTx: null, destinationTx: null,
    fee: { collected: true, basisPoints: 85, amountRaw: null, decimals: null, symbol: null, usd: 0.66, asset: null, providerRaw: null, ryntraRaw: null },
    origin: { surface: "SPOT", side: "BUY", plan: { planId: plan.id, version: plan.version, reviewId: REVIEW_ID } },
    startedAt: "2026-09-15T12:00:10.000Z", updatedAt: "2026-09-15T12:00:20.000Z",
    ...overrides,
  };
}

/** A store whose plan writes can be made to lose every race — the shape of a slow or contended Postgres. */
function fallibleStore() {
  const store = createMemoryGuardStore();
  const state = { failPlanWrites: false, writes: 0 };
  const versioned = store.versioned.bind(store);
  return {
    state,
    store: {
      ...store,
      versioned(name) {
        const collection = versioned(name);
        if (name !== "tradingPlans") return collection;
        return {
          ...collection,
          async compareAndSet(key, expected, next) {
            state.writes += 1;
            if (state.failPlanWrites) return false;
            return collection.compareAndSet(key, expected, next);
          },
        };
      },
    },
  };
}

test("the Review is written on the plan before any signature: a reviewed entry with the operation's id; a stale version or a cancelled plan refuses it", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  const recorded = await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  assert.ok(recorded.ok, JSON.stringify(recorded));
  assert.equal(recorded.plan.journal.at(-1).event, "reviewed");
  assert.equal(recorded.plan.journal.at(-1).ref, REVIEW_ID);
  assert.equal(recorded.plan.journal.at(-1).note, "ready");
  assert.equal(recorded.plan.version, 1, "a Review makes no version");
  const again = await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  assert.ok(again.ok);
  assert.equal(again.plan.journal.filter((e) => e.event === "reviewed").length, 1, "the same Review is not journaled twice");
  const edited = await updatePlan(store, { owner: OWNER, planId: plan.id, rules: exampleRules({ capital: { budgetUsd: 1200, reserveForCostsUsd: 20 } }), ifVersion: 1, reason: null }, deps());
  assert.ok(edited.ok);
  const stale = await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan, { reviewId: "second-review-id-0001" }) }, deps());
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "PLAN_VERSION_CONFLICT");
  const cancelled = await setPlanStatus(store, { owner: OWNER, planId: plan.id, status: "cancelled", ifVersion: 2, reason: null }, deps());
  assert.ok(cancelled.ok);
  const dead = await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan, { version: 2, latestVersion: 2, reviewId: "third-review-id-00001" }) }, deps());
  assert.equal(dead.ok, false);
  assert.equal(dead.code, "PLAN_STATE_REFUSED");
  const other = await recordPlanReview(store, { owner: OTHER, review: reviewFor(plan) }, deps());
  assert.equal(other.ok, false);
  assert.equal(other.code, "PLAN_NOT_FOUND");
});

test("the execution after the History row: appended once by signature, the plan executed, a second write of the same settlement changes nothing", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  const execution = { signature: SIGNATURE, version: 1, reviewId: REVIEW_ID, review: reviewFor(plan), reviewedAt: "2026-09-15T12:00:00.000Z", outcome: "DONE" };
  const first = await recordPlanExecution(store, { owner: OWNER, planId: plan.id, execution }, deps());
  assert.deepEqual(first, { ok: true, changed: true });
  const second = await recordPlanExecution(store, { owner: OWNER, planId: plan.id, execution }, deps());
  assert.deepEqual(second, { ok: true, changed: false });
  const read = await getPlan(store, OWNER, plan.id, { ...deps(), ledger: async () => [rowFor(plan)] });
  assert.ok(read.ok);
  assert.equal(read.plan.status, "executed");
  assert.equal(read.plan.executions.length, 1);
  assert.equal(read.plan.executions[0].signature, SIGNATURE);
  assert.equal(read.plan.executions[0].reviewId, REVIEW_ID);
  assert.equal(read.plan.executions[0].outcome, "DONE");
  assert.equal(read.plan.journal.filter((e) => e.event === "executed").length, 1);
  assert.deepEqual(read.sync, { state: "complete", pending: 0 });
  TradingPlanSchema.parse(read.plan);
  const edit = await updatePlan(store, { owner: OWNER, planId: plan.id, rules: exampleRules(), ifVersion: 1, reason: null }, deps());
  assert.equal(edit.ok, false, "an executed plan is not edited; its rules are the rules that stood");
});

test("History is the durable source: a plan whose execution write failed is repaired on the next read, idempotently, and says pending until then", async () => {
  const { store, state } = fallibleStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  const reviewed = await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  assert.ok(reviewed.ok);

  /* The swap executed and History holds the row; the plan's write loses every race. */
  state.failPlanWrites = true;
  const lost = await recordPlanExecution(store, { owner: OWNER, planId: plan.id, execution: { signature: SIGNATURE, version: 1, reviewId: REVIEW_ID, review: reviewFor(plan), reviewedAt: "2026-09-15T12:00:00.000Z", outcome: "DONE" } }, deps());
  assert.equal(lost.ok, false);
  const ledger = async () => [rowFor(plan)];
  const pending = await getPlan(store, OWNER, plan.id, { ...deps(), ledger });
  assert.ok(pending.ok);
  assert.equal(pending.plan.executions.length, 0, "nothing is invented while the write fails");
  assert.equal(pending.plan.status, "active");
  assert.deepEqual(pending.sync, { state: "pending", pending: 1 });
  const pendingResults = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger });
  assert.ok(pendingResults.ok);
  assert.equal(pendingResults.sync.state, "pending");

  /* The store answers again: the next read restores the link from History — one execution, the Review the plan kept, no duplicate. */
  state.failPlanWrites = false;
  const repaired = await getPlan(store, OWNER, plan.id, { ...deps(), ledger });
  assert.ok(repaired.ok);
  assert.deepEqual(repaired.sync, { state: "complete", pending: 0 });
  assert.equal(repaired.plan.executions.length, 1);
  assert.equal(repaired.plan.executions[0].signature, SIGNATURE);
  assert.equal(repaired.plan.executions[0].reviewId, REVIEW_ID);
  assert.equal(repaired.plan.executions[0].reviewedAt, "2026-09-15T12:00:00.000Z", "the Review the plan kept dates the execution");
  assert.equal(repaired.plan.status, "executed");
  const writesAfterRepair = state.writes;
  const again = await getPlan(store, OWNER, plan.id, { ...deps(), ledger });
  assert.equal(again.plan.executions.length, 1);
  assert.equal(state.writes, writesAfterRepair, "a read that finds nothing to repair writes nothing");
  const results = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger });
  assert.ok(results.ok);
  assert.equal(results.results.length, 1);
  assert.ok(results.results[0].beforeSigning, "the Strategy block that stood before the signature is on the result");
  assert.equal(results.results[0].beforeSigning.reviewId, REVIEW_ID);
});

test("an outcome that moves in History moves on the plan: an unknown row is on the plan as unknown, then DONE once recovery settles it", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  const inFlight = rowFor(plan, { outcome: "IN_FLIGHT", in: null });
  const first = await getPlan(store, OWNER, plan.id, { ...deps(), ledger: async () => [inFlight] });
  assert.equal(first.plan.executions[0].outcome, "UNKNOWN");
  assert.equal(first.plan.status, "active", "an unknown outcome does not close the plan");
  const settled = await getPlan(store, OWNER, plan.id, { ...deps(), ledger: async () => [rowFor(plan)] });
  assert.equal(settled.plan.executions.length, 1);
  assert.equal(settled.plan.executions[0].outcome, "DONE");
  assert.equal(settled.plan.status, "executed");
  /* A row under another plan, or with no binding, is never this plan's. */
  const foreign = await getPlan(store, OWNER, plan.id, { ...deps(), ledger: async () => [rowFor(plan, { signature: SIGNATURE_2, actionId: SIGNATURE_2, origin: { surface: "SPOT", side: "BUY" } })] });
  assert.equal(foreign.plan.executions.length, 1);
});

test("Plan vs Actual: three columns off the version, the kept Review and the settled row; the verdict speaks of the entry only", async () => {
  const store = createMemoryGuardStore();
  const created = await createPlan(store, { owner: OWNER, mint: NVDAX, rules: exampleRules(), activate: true }, deps());
  assert.ok(created.ok);
  const plan = created.plan;
  await recordPlanReview(store, { owner: OWNER, review: reviewFor(plan) }, deps());
  const ledger = async () => [rowFor(plan)];
  const read = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger });
  assert.ok(read.ok);
  assert.equal(read.results.length, 1);
  const result = read.results[0];
  PlanResultsResponseSchema.parse({ address: OWNER, results: read.results, sync: read.sync });
  assert.equal(result.version, 1);
  assert.equal(result.plan.entryPerShareUsd, 180);
  assert.equal(result.plan.plannedRiskUsd, 100);
  assert.equal(result.plan.sizedUnits, 4.587155);
  assert.equal(result.beforeSigning.quote.usd, 780);
  assert.equal(result.actual.outcome, "DONE");
  assert.equal(result.actual.usd, 780);
  assert.equal(result.actual.amount, "4.299420", "the fill through the multiplier the Review stored");
  assert.equal(result.actual.unit, "underlying");
  assert.ok(Math.abs(result.actual.perShareUsd - 181.42) < 0.01);
  assert.ok(Math.abs(result.actual.modelledLossUsd - 99.89) < 0.02);
  assert.equal(result.actual.feeUsd, 0.66);
  assert.deepEqual(result.checks.map((c) => c.id), ["budget", "spend", "entryPrice", "invalidation", "risk", "size"]);
  assert.equal(result.verdict, "followed");
  /* A fill above the entry bound deviates; a row that has not settled is unknown. */
  const dear = await getPlanResults(store, OWNER, plan.id, { ...deps(), ledger: async () => [rowFor(plan, { out: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "800000000", decimals: null, symbol: null }, in: { mint: NVDAX, amountRaw: "400000000", decimals: null, symbol: null } })] });
  assert.equal(dear.results[0].verdict, "deviated");
  assert.equal(dear.results[0].checks.find((c) => c.id === "entryPrice").outcome, "fail");
  const all = await listPlanResults(store, OWNER, { ...deps(), ledger });
  assert.equal(all.results.length, 1);
  assert.equal((await listPlanResults(store, OTHER, { ...deps(), ledger })).results.length, 0);
});
