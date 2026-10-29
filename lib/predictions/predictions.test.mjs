// Run from repo root: node --test lib/predictions/predictions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { AGG_WS_URL, aggSocketUrl, readPredictionsEnv, ryntraExternalId, walletChain } from "./env.ts";
import { classifyProviderError } from "./failure.ts";
import { siwsAddress, startLink, verifyLink, healExternalIdLink } from "./link.ts";
import { aggregateBooks, mapEventSummary, mapRoute, midpointMap, rawToUsd } from "./model.ts";
import { buildReview, listPaperOrders, placePaper, quotePaper, readPaperAccount, syncPaperOrder } from "./paper.ts";
import { computePredictionSizing, createPredictionPlan, listPredictionPlans, readPredictionPlan, setPredictionPlanStatus, updatePredictionPlan, validatePredictionRules } from "./plan.ts";
import { accessExpiry, linkKey, linkStatus, readLink, revokeLink, withProviderSession } from "./session.ts";
import { PREDICTION_TOOLS, PREDICTION_TOOL_NAMES, runPredictionTool } from "./tools.ts";
import { open, seal } from "./vault.ts";
import { readWatchlist, setWatch } from "./watchlist.ts";

const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ENV = { BETA_TOKEN_SECRET: "test-secret-of-sufficient-length" };
/* The services read the deployment's environment; the tests are that deployment. */
process.env.BETA_TOKEN_SECRET = ENV.BETA_TOKEN_SECRET;
delete process.env.AGG_APP_SECRET;
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

/** A durable-looking store for the parts that refuse an ephemeral one. */
function durableStore() {
  const store = createMemoryGuardStore();
  return { ...store, durability: "DURABLE_MULTI_WRITER" };
}

function jwt(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ sub: "u1", exp: expSeconds, iat: expSeconds - 900 })).toString("base64url");
  return `h.${payload}.s`;
}

const EVENT = {
  id: "ev1",
  title: "Fed Decision in October?",
  subtitle: null,
  image: null,
  status: "open",
  venue: "polymarket",
  venues: ["polymarket", "kalshi"],
  volume: 1000,
  endDate: "2026-10-28T23:59:00.000Z",
  categories: [{ id: "c1", slug: "finance", name: "Finance" }],
  marketCount: 1,
  aggKey: "agg_cb-fed_261028",
  structureType: null,
  arbReturn: null,
  leading: [{ id: "o-yes", label: "Yes", probability: 0.32, venueMarketId: "m1" }],
  description: null,
  startDate: null,
  markets: [
    {
      id: "m1",
      venue: "polymarket",
      question: "25 bps cut?",
      status: "open",
      outcomes: [
        { id: "o-yes", label: "Yes", probability: 0.32, venueMarketId: "m1", winner: null, matched: [] },
        { id: "o-no", label: "No", probability: 0.68, venueMarketId: "m1", winner: null, matched: [] },
      ],
      volume: 1000,
      endDate: "2026-10-28T23:59:00.000Z",
      resolutionDate: null,
      rules: { primary: "Resolves Yes if the FOMC cuts by 25 bps.", secondary: null },
      tickSize: 0.01,
      minOrderSize: null,
      aggKey: null,
      arbReturn: null,
      matched: [],
      image: null,
    },
  ],
  settlement: { sharedSummary: "Both venues resolve on the FOMC statement.", differences: [] },
};

function routeFor(spend, price = 0.32, quotedAt = new Date(NOW).toISOString()) {
  const shares = spend / price;
  return {
    quoteId: `q-${spend}`,
    status: "ok",
    side: "buy",
    outcomeId: "o-yes",
    venueMarketId: "m1",
    requested: spend,
    shares,
    costUsd: spend,
    totalCostIncFeesUsd: spend,
    avgProbability: price,
    estimatedPayoutUsd: shares,
    estimatedProfitUsd: shares - spend,
    returnPct: ((shares - spend) / spend) * 100,
    fees: { venue: 0, builder: 0, settlement: 0, app: null },
    fills: [{ venue: "predict", chain: "solana", avgPrice: price, shares, fees: { venue: 0, builder: null, settlement: null } }],
    venueSolo: [],
    warnings: [],
    matchedMarkets: [],
    expiresAt: new Date(Date.parse(quotedAt) + 60_000).toISOString(),
    refreshAt: quotedAt,
    solveMs: 7,
    verifyMs: 1,
    error: null,
    quotedAt,
  };
}

/** A provider that behaves like the aggregator did on 2026-09-17, in memory. */
function fakeProvider(options = {}) {
  const calls = [];
  const state = { access: "acc-1", refresh: "ref-1", refreshes: 0, execution: null, balance: 10000, positions: [], orders: [], linkedExternalId: null, signOutCalls: 0, refuseRefresh: false, expiredTokens: new Set() };
  const requireLive = (session) => {
    if (state.expiredTokens.has(session.accessToken)) return { ok: false, code: "SESSION_EXPIRED", message: "expired" };
    return null;
  };
  const provider = {
    id: "agg",
    state,
    calls,
    categories: async () => ({ ok: true, value: [{ id: "c1", slug: "finance", name: "Finance", eventCount: 10, volume24h: 1 }] }),
    discover: async () => ({ ok: true, value: { events: [EVENT], nextCursor: null, readAt: new Date(NOW).toISOString() } }),
    search: async () => ({ ok: true, value: [EVENT] }),
    event: async (id) => (id === "ev1" ? { ok: true, value: EVENT } : { ok: false, code: "NOT_FOUND", message: "no" }),
    events: async () => ({ ok: true, value: [EVENT] }),
    prices: async () => ({ ok: true, value: [] }),
    book: async () => ({ ok: true, value: { venueMarketId: "m1", status: "ok", error: null, requested: null, venues: [], matched: [], aggregated: { bids: [], asks: [] }, readAt: "" } }),
    chart: async () => ({ ok: true, value: { outcomeId: "o-yes", venue: "polymarket", resolution: "1h", bars: [], staleSeconds: null, lastBarAt: null } }),
    signals: async () => ({ ok: true, value: null }),
    related: async () => ({ ok: true, value: [] }),
    ripple: async () => ({ ok: true, value: { mode: "expand", items: [] } }),
    news: async () => ({ ok: true, value: { window: null, query: null, articles: [] } }),
    engine: async () => ({ ok: true, value: { tradingMode: "paper", paperStartingBalance: 10000, disabledVenues: [], signals: null } }),
    signInChallenge: async ({ address, domain, uri }) => ({ ok: true, value: { nonce: "N0NCE", statement: "Sign in to AGG", message: `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to AGG\n\nURI: ${uri}\nVersion: 1\nChain ID: mainnet\nNonce: N0NCE\nIssued At: 2026-09-17T12:00:00.000Z` } }),
    verifySignIn: async ({ message, signature }) => {
      calls.push("verify");
      if (signature !== "good") return { ok: false, code: "SIGNATURE_INVALID", message: "bad" };
      const address = message.split("\n")[1];
      return { ok: true, value: { accessToken: jwt(NOW / 1000 + 900), refreshToken: "ref-1", user: { id: "agguser", username: null, externalId: state.linkedExternalId, wallets: [{ chain: "solana", address }], locationBlocked: false } } };
    },
    refresh: async (token) => {
      calls.push(`refresh:${token}`);
      state.refreshes += 1;
      if (state.refuseRefresh || token !== state.refresh) return { ok: false, code: "SESSION_EXPIRED", message: "refused" };
      state.access = jwt(NOW / 1000 + 900 + state.refreshes);
      state.refresh = `ref-${state.refreshes + 1}`;
      return { ok: true, value: { accessToken: state.access, refreshToken: state.refresh } };
    },
    profile: async (session) => requireLive(session) ?? { ok: true, value: { id: "agguser", username: null, externalId: state.linkedExternalId, wallets: [{ chain: "solana", address: WALLET }], locationBlocked: false } },
    linkExternalId: async (session, assertion) => {
      calls.push(`link:${assertion.externalId}`);
      if (options.refuseLink) return { ok: false, code: "FORBIDDEN", message: "no key" };
      state.linkedExternalId = assertion.externalId;
      return { ok: true, value: { id: "agguser", username: null, externalId: assertion.externalId, wallets: [{ chain: "solana", address: WALLET }], locationBlocked: false } };
    },
    signOut: async () => {
      state.signOutCalls += 1;
      return { ok: true, value: null };
    },
    paperBalance: async (session) => requireLive(session) ?? { ok: true, value: { startingBalance: 10000, cashBalance: state.balance, positionsValue: 0, realizedPnl: 0, unrealizedPnl: 0, earnings: 0 } },
    paperPositions: async (session) => requireLive(session) ?? { ok: true, value: state.positions },
    paperOrders: async (session) => requireLive(session) ?? { ok: true, value: state.orders },
    route: async (session, request) => {
      calls.push("route");
      const live = session ? requireLive(session) : null;
      if (live) return live;
      return { ok: true, value: routeFor(request.spendUsd ?? 0, options.price ?? 0.32) };
    },
    execute: async (session, request) => {
      calls.push("execute");
      const live = requireLive(session);
      if (live) return live;
      if (options.refuseExecute) return { ok: false, code: "VALIDATION_ERROR", message: "quote stale" };
      state.execution = { quoteId: request.quoteId, executionId: "ex1", orderIds: ["ord1"], state: options.pending ? "placing" : "filled", terminal: !options.pending, error: null, pollAfterMs: 10, steps: [], orders: [{ orderId: "ord1", venue: "predict", status: "filled", event: "filled", filledUsd: 2, actualShares: 6.25, executionPrice: 0.32, error: null }] };
      if (!options.pending) {
        state.balance -= 2;
        state.orders = [{ id: "ord1", quoteId: request.quoteId, status: "filled", venue: "predict", side: "buy", createdAt: "", updatedAt: "", amountUsd: 2, filledUsd: 2, quotedPrice: 0.32, executionPrice: 0.32, quotedShares: 6.25, actualShares: 6.25, quotedToWin: 6.25, actualToWin: 6.25, partialFillReason: null, error: null, question: "25 bps cut?", venueEventId: "ev1", outcomeLabel: "Yes" }];
        state.positions = [{ eventId: "ev1", venueEventId: "ev1", question: "25 bps cut?", image: null, marketStatus: "open", status: "active", redeemStatus: "ineligible", resolutionDate: null, outcomes: [] }];
      }
      return { ok: true, value: { quoteId: request.quoteId, orderIds: ["ord1"], status: "pending", alreadyAccepted: false } };
    },
    executionStatus: async (session) => requireLive(session) ?? (state.execution ? { ok: true, value: state.execution } : { ok: false, code: "NOT_FOUND", message: "no execution" }),
  };
  return provider;
}

/* ------------------------------------------------------------- model */

test("a No outcome's probability is the complement of the Yes midpoint, and a route keeps its provenance", () => {
  const summary = mapEventSummary(
    { id: "e", title: "t", venue: "polymarket", image: null, externalIdentifier: "x", categories: [], venueMarkets: [{ id: "m", venue: "polymarket", question: "q", externalIdentifier: "y", venueMarketOutcomes: [{ id: "y", label: "Yes", venueMarketId: "m" }, { id: "n", label: "No", venueMarketId: "m" }] }] },
    new Map([["m", 0.32]]),
  );
  assert.equal(summary.leading[0].probability, 0.32);
  assert.equal(summary.leading[1].probability, 0.68);
  assert.deepEqual(summary.venues, ["polymarket"]);

  const route = mapRoute(
    { quoteId: "q", venueMarketOutcomeId: "y", venueMarketId: "m", estimatedCostRaw: "1955850", expiresAt: "2026-09-17T09:30:39.747Z", refreshAt: "x", status: "ok", fills: [{ venue: "predict", venueMarketId: "m", venueMarketOutcomeId: "y", chain: "solana", avgPrice: 0.32, yesPrice: 0.32, noPrice: 0.68, fills: [], venueQty: 6.112032, venueFee: 0.01 }], totalFilled: 6.112032, rawExecCost: 1.95585, solveTimeMs: 7, verifyTimeMs: 1, matchedMarkets: [] },
    "buy",
    2,
    "2026-09-17T09:29:39.000Z",
  );
  assert.equal(route.fills[0].venue, "predict");
  assert.ok(Math.abs(route.avgProbability - 0.32) < 0.001);
  assert.equal(route.fees.venue, 0.01);
  assert.equal(rawToUsd("1955850"), 1.95585);
  assert.deepEqual([...midpointMap([{ venueMarketId: "a", midpoint: 0.5 }, { venueMarketId: "b", midpoint: null }])], [["a", 0.5]]);
});

test("books across venues merge per price with the venue breakdown kept and the sides ordered", () => {
  const merged = aggregateBooks([
    { venue: "kalshi", venueMarketId: "k", tickSize: null, bids: [{ price: 0.31, size: 10, venues: { kalshi: 10 } }], asks: [{ price: 0.33, size: 5, venues: { kalshi: 5 } }] },
    { venue: "polymarket", venueMarketId: "p", tickSize: null, bids: [{ price: 0.32, size: 4, venues: { polymarket: 4 } }, { price: 0.31, size: 6, venues: { polymarket: 6 } }], asks: [{ price: 0.34, size: 8, venues: { polymarket: 8 } }] },
  ]);
  assert.deepEqual(merged.bids.map((l) => [l.price, l.size]), [[0.32, 4], [0.31, 16]]);
  assert.deepEqual(merged.bids[1].venues, { kalshi: 10, polymarket: 6 });
  assert.deepEqual(merged.asks.map((l) => l.price), [0.33, 0.34]);
});

test("provider errors classify by status; a network failure is an outage, never a session problem", () => {
  assert.equal(classifyProviderError(Object.assign(new Error("x"), { status: 429 })).code, "RATE_LIMITED");
  assert.equal(classifyProviderError(Object.assign(new Error("x"), { status: 401 })).code, "SESSION_EXPIRED");
  assert.equal(classifyProviderError(new TypeError("fetch failed")).code, "PROVIDER_UNAVAILABLE");
  assert.equal(classifyProviderError(Object.assign(new Error("x"), { status: 422 })).code, "VALIDATION_ERROR");
});

/* ------------------------------------------------------------- vault and session */

test("tokens are sealed at rest and open only under the same secret", () => {
  const sealed = seal("secret-token", ENV);
  assert.ok(sealed.startsWith("v1."));
  assert.ok(!sealed.includes("secret-token"));
  assert.equal(open(sealed, ENV), "secret-token");
  assert.equal(open(sealed, { BETA_TOKEN_SECRET: "another-secret-entirely" }), null);
  assert.equal(open("v1.garbage", ENV), null);
  assert.equal(accessExpiry(jwt(1_800_000_000)), new Date(1_800_000_000_000).toISOString());
});

test("the identity link: the message must name the proven wallet, the provider must hold it, the external id is linked with the key and the tokens never reach the answer", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const env = { ...ENV, AGG_APP_SECRET: "ab".repeat(32) };

  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, env);
  assert.ok(started.ok);
  assert.equal(siwsAddress(started.value.message), WALLET);
  assert.match(started.value.message, /^ryntra\.io wants you to sign in/);

  const wrongWallet = await verifyLink(store, provider, OTHER, { message: started.value.message, signature: "good" }, env, NOW);
  assert.equal(wrongWallet.ok, false);
  assert.equal(wrongWallet.code, "WALLET_MISMATCH");

  const bad = await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "bad" }, env, NOW);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "SIGNATURE_INVALID");

  const linked = await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, env, NOW);
  assert.ok(linked.ok);
  assert.equal(linked.value.state, "active");
  assert.equal(linked.value.externalIdLinked, true);
  assert.equal(linked.value.providerUserId, "agguser");
  assert.ok(!JSON.stringify(linked).includes("acc"), "no token in the answer");
  assert.equal(provider.state.linkedExternalId, ryntraExternalId(WALLET));

  const record = await readLink(store, WALLET);
  assert.ok(record.access.startsWith("v1."));
  assert.equal(record.externalId, `ryntra:solana:${WALLET}`);
  assert.equal(await readLink(store, OTHER), null, "another wallet sees nothing");
});

test("without the signing key the link is honest — signing_key_missing — and heals once the key exists", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  const linked = await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);
  assert.ok(linked.ok);
  assert.equal(linked.value.externalIdLinked, false);
  assert.equal(linked.value.linkError, "signing_key_missing");
  assert.ok(!provider.calls.some((c) => c.startsWith("link:")), "no assertion without a key");

  await healExternalIdLink(store, provider, WALLET, { ...ENV, AGG_APP_SECRET: "not-hex!" }, NOW);
  assert.equal((await readLink(store, WALLET)).externalIdLinked, false, "an invalid key links nothing");

  await healExternalIdLink(store, provider, WALLET, { ...ENV, AGG_APP_SECRET: "cd".repeat(32) }, NOW);
  const healed = await readLink(store, WALLET);
  assert.equal(healed.externalIdLinked, true);
  assert.equal(healed.linkError, null);
});

test("a deployment without a session secret or a durable store cannot link, and says so", async () => {
  const provider = fakeProvider();
  const noSecret = await startLink(durableStore(), provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, {});
  assert.equal(noSecret.ok, false);
  assert.equal(noSecret.code, "LINK_UNAVAILABLE");
  const ephemeral = await startLink(createMemoryGuardStore(), provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  assert.equal(ephemeral.ok, false);
  assert.equal(ephemeral.code, "LINK_UNAVAILABLE");
});

test("the session refreshes ahead of expiry and after a 401, persists the rotated refresh token, and expires honestly when the refresh is refused", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);

  /* Fresh token: no refresh. */
  const first = await withProviderSession(store, provider, WALLET, async (session) => provider.paperBalance(session), ENV, NOW);
  assert.ok(first.ok);
  assert.equal(provider.state.refreshes, 0);

  /* Near expiry: refreshed before the call; the rotated refresh token is what the store holds now. */
  const later = NOW + 14 * 60_000 + 30_000;
  const second = await withProviderSession(store, provider, WALLET, async (session) => provider.paperBalance(session), ENV, later);
  assert.ok(second.ok);
  assert.equal(provider.state.refreshes, 1);
  const record = await readLink(store, WALLET);
  assert.equal(open(record.refresh, ENV), "ref-2");
  assert.equal(record.refreshedAt, new Date(later).toISOString());

  /* A 401 mid-call: one refresh, one retry. */
  provider.state.expiredTokens.add(provider.state.access);
  const third = await withProviderSession(store, provider, WALLET, async (session) => provider.paperBalance(session), ENV, later);
  assert.ok(third.ok);
  assert.equal(provider.state.refreshes, 2);

  /* The refresh refused: the link is expired, the tokens gone, the next call says so. */
  provider.state.refuseRefresh = true;
  provider.state.expiredTokens.add(provider.state.access);
  const fourth = await withProviderSession(store, provider, WALLET, async (session) => provider.paperBalance(session), ENV, later);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, "SESSION_EXPIRED");
  const expired = await readLink(store, WALLET);
  assert.equal(expired.state, "expired");
  assert.equal(expired.access, null);
  const status = await linkStatus(store, WALLET, ENV);
  assert.equal(status.state, "expired");

  /* Nothing linked for the other wallet, ever. */
  const other = await withProviderSession(store, provider, OTHER, async (session) => provider.paperBalance(session), ENV, later);
  assert.equal(other.code, "NOT_LINKED");
});

test("revoke signs the provider out and wipes the tokens; the row stays as history", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);
  const revoked = await revokeLink(store, provider, WALLET, ENV);
  assert.ok(revoked.ok);
  assert.equal(revoked.value.state, "revoked");
  assert.equal(provider.state.signOutCalls, 1);
  const record = await readLink(store, WALLET);
  assert.equal(record.access, null);
  assert.equal(record.refresh, null);
  const after = await withProviderSession(store, provider, WALLET, async (session) => provider.paperBalance(session), ENV, NOW);
  assert.equal(after.code, "NOT_LINKED");
});

/* ------------------------------------------------------------- plan */

const RULES = {
  thesis: "The FOMC cuts by 25 bps in October.",
  whyNow: null,
  eventId: "ev1",
  eventTitle: "Fed Decision in October?",
  venueMarketId: "m1",
  question: "25 bps cut?",
  outcomeId: "o-yes",
  outcomeLabel: "Yes",
  amountUsd: 10,
  entryProbability: 0.32,
  maxProbability: 0.4,
  invalidation: { text: "Core PCE re-accelerates above 3%.", probabilityBelow: 0.15 },
  resolutionDeadline: "2027-10-29T00:00:00.000Z",
  monitoring: [{ metric: "probability", direction: "above", threshold: 0.5, note: null }],
  references: [],
  assumptions: [],
};

test("the Prediction Plan sizes from the amount and the entry probability, refuses rules that contradict, and versions its edits", async () => {
  const sizing = computePredictionSizing({ amountUsd: 10, entryProbability: 0.32 });
  assert.equal(sizing.maxLossUsd, 10);
  assert.equal(sizing.payoutIfRightUsd, 31.25);
  assert.equal(sizing.profitIfRightUsd, 21.25);
  assert.equal(sizing.returnIfRightPct, 212.5);

  const bad = validatePredictionRules({ ...RULES, maxProbability: 0.2, invalidation: { text: "x", probabilityBelow: 0.5 }, resolutionDeadline: "2020-01-01T00:00:00.000Z" }, NOW);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues.map((i) => i.path).sort(), ["invalidation.probabilityBelow", "maxProbability", "resolutionDeadline"]);

  const store = durableStore();
  const created = await createPredictionPlan(store, { owner: WALLET, rules: RULES, activate: true }, { now: () => new Date(NOW), planId: () => "pplan_000000000000000000000001" });
  assert.ok(created.ok);
  assert.equal(created.value.status, "active");
  assert.equal(created.value.current.sizing.maxLossUsd, 10);

  const edited = await updatePredictionPlan(store, WALLET, created.value.id, { version: 1, rules: { ...RULES, amountUsd: 20 }, reason: "more" }, new Date(NOW + 1000));
  assert.ok(edited.ok);
  assert.equal(edited.value.version, 2);
  assert.equal(edited.value.current.rules.amountUsd, 20);
  const stale = await updatePredictionPlan(store, WALLET, created.value.id, { version: 1, rules: RULES }, new Date(NOW + 2000));
  assert.equal(stale.code, "PLAN_VERSION_CONFLICT");

  const cancelled = await setPredictionPlanStatus(store, WALLET, created.value.id, { version: 2, status: "cancelled" }, new Date(NOW + 3000));
  assert.ok(cancelled.ok);
  assert.equal(cancelled.value.status, "cancelled");
  const refused = await updatePredictionPlan(store, WALLET, created.value.id, { version: 2, rules: RULES }, new Date(NOW + 4000));
  assert.equal(refused.code, "PLAN_STATE_REFUSED");

  assert.equal((await listPredictionPlans(store, WALLET, NOW)).length, 1);
  assert.equal((await listPredictionPlans(store, OTHER, NOW)).length, 0, "another wallet sees no plan");
  assert.equal((await readPredictionPlan(store, OTHER, created.value.id, NOW)).code, "PLAN_NOT_FOUND");
});

/* ------------------------------------------------------------- Review and paper execution */

test("the Review names every check: paper mode, the route, the quote's age, the amount, the balance, the market and the plan's conditions", () => {
  const plan = { id: "pplan_000000000000000000000002", version: 1, status: "active", current: { rules: RULES } };
  const fine = buildReview({ event: EVENT, venueMarketId: "m1", outcomeId: "o-yes", side: "buy", requested: 5, route: routeFor(5), balance: { startingBalance: 10000, cashBalance: 10000, positionsValue: 0, realizedPnl: 0, unrealizedPnl: 0, earnings: 0 }, plan, nowMs: NOW + 5000 });
  assert.equal(fine.canPlace, true);
  assert.equal(fine.mode, "paper");
  assert.deepEqual(fine.checks.map((c) => `${c.id}:${c.state}`), ["mode:pass", "route:pass", "quote_age:pass", "amount:pass", "balance:pass", "market:pass"]);
  assert.equal(fine.figures.maxLossUsd, 5);
  assert.ok(Math.abs(fine.figures.payoutIfRightUsd - 15.625) < 0.001);
  assert.equal(fine.plan.checks.every((c) => c.state === "pass"), true);

  const overBound = buildReview({ event: EVENT, venueMarketId: "m1", outcomeId: "o-yes", side: "buy", requested: 50, route: routeFor(50, 0.45), balance: { startingBalance: 10000, cashBalance: 20, positionsValue: 0, realizedPnl: 0, unrealizedPnl: 0, earnings: 0 }, plan, nowMs: NOW + 120_000 });
  assert.equal(overBound.canPlace, false);
  assert.deepEqual(overBound.blockedBy, ["quote_age", "balance", "plan:amount", "plan:max_probability"]);
  assert.ok(overBound.warnings.some((w) => /market last showed/.test(w)));
});

test("paper execution end to end: quote → Review → place → the provider's terminal state → the order, the position and the balance re-read; the plan records it", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);
  const plan = await createPredictionPlan(store, { owner: WALLET, rules: RULES, activate: true }, { now: () => new Date(NOW), planId: () => "pplan_000000000000000000000003" });

  const notLinked = await quotePaper(store, provider, OTHER, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 2 }, NOW);
  assert.equal(notLinked.code, "NOT_LINKED");

  const quoted = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 2, planId: plan.value.id }, NOW);
  assert.ok(quoted.ok);
  assert.equal(quoted.value.review.canPlace, true);
  assert.equal(quoted.value.record.state, "reviewed");
  assert.equal((await readPredictionPlan(store, WALLET, plan.value.id, NOW)).value.executions[0].state, "reviewed");

  const placed = await placePaper(store, provider, WALLET, quoted.value.review.quoteId, NOW + 1000);
  assert.ok(placed.ok);
  assert.equal(placed.value.state, "filled");
  assert.deepEqual(placed.value.providerOrderIds, ["ord1"]);
  assert.equal(placed.value.execution.terminal, true);
  assert.equal(placed.value.providerOrders[0].status, "filled");
  assert.equal(provider.state.balance, 9998);

  const account = await readPaperAccount(store, provider, WALLET);
  assert.equal(account.balance.cashBalance, 9998);
  assert.equal(account.positions.length, 1);
  assert.equal(account.orders[0].state, "filled");
  assert.equal((await listPaperOrders(store, OTHER)).length, 0);

  const planAfter = await readPredictionPlan(store, WALLET, plan.value.id, NOW);
  assert.equal(planAfter.value.status, "executed");
  assert.equal(planAfter.value.journal.at(-1).kind, "executed");

  /* Placing the same reviewed quote twice changes nothing. */
  const again = await placePaper(store, provider, WALLET, quoted.value.review.quoteId, NOW + 2000);
  assert.ok(again.ok);
  assert.equal(provider.calls.filter((c) => c === "execute").length, 1);
});

test("a stale quote is not placed, a refused Review is not placed, and a pending execution stays submitted until the provider settles it", async () => {
  const store = durableStore();
  const provider = fakeProvider({ pending: true });
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);

  const quoted = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 2 }, NOW);
  const expired = await placePaper(store, provider, WALLET, quoted.value.review.quoteId, NOW + 10 * 60_000);
  assert.equal(expired.code, "QUOTE_EXPIRED");
  assert.equal((await listPaperOrders(store, WALLET))[0].state, "expired");

  const refused = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 0.5 }, NOW);
  assert.ok(refused.ok);
  assert.equal(refused.value.review.canPlace, false);
  const notPlaced = await placePaper(store, provider, WALLET, refused.value.review.quoteId, NOW);
  assert.equal(notPlaced.code, "ORDER_REFUSED");

  const fresh = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 3 }, NOW);
  const placed = await placePaper(store, provider, WALLET, fresh.value.review.quoteId, NOW);
  assert.ok(placed.ok);
  assert.equal(placed.value.state, "submitted", "pending at the provider is submitted here, never filled");
  provider.state.execution = { ...provider.state.execution, state: "filled", terminal: true };
  const synced = await syncPaperOrder(store, provider, WALLET, fresh.value.review.quoteId);
  assert.equal(synced.value.state, "filled");
});

/* ------------------------------------------------------------- watchlist and tools */

test("the watchlist is per wallet and remembers the probability at the moment of watching", async () => {
  const store = durableStore();
  await setWatch(store, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeLabel: "Yes", probabilityAtWatch: 0.32 }, true, NOW);
  await setWatch(store, WALLET, { eventId: "ev2", venueMarketId: null, outcomeLabel: null, probabilityAtWatch: null }, true, NOW + 1);
  assert.deepEqual((await readWatchlist(store, WALLET)).map((e) => e.eventId), ["ev2", "ev1"]);
  await setWatch(store, WALLET, { eventId: "ev2", venueMarketId: null, outcomeLabel: null, probabilityAtWatch: null }, false, NOW + 2);
  const entries = await readWatchlist(store, WALLET);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].probabilityAtWatch, 0.32);
  assert.deepEqual(await readWatchlist(store, OTHER), []);
});

test("the Agent tools are the eleven named ones, read or prepare only, wallet-permissioned where the paper account is involved, with no execute tool", async () => {
  assert.deepEqual(PREDICTION_TOOL_NAMES, [
    "searchPredictionMarkets",
    "getPredictionEvent",
    "getPredictionMarket",
    "getPredictionChart",
    "getPredictionOrderbook",
    "getPredictionNews",
    "getRelatedPredictionMarkets",
    "getPredictionSignals",
    "getPredictionRipple",
    "preparePredictionRoute",
    "getPaperPredictionPortfolio",
  ]);
  assert.ok(!PREDICTION_TOOLS.some((t) => /execute|place|submit|fill/i.test(t.name)));
  const store = durableStore();
  const provider = fakeProvider();
  const anonymous = { wallet: null, provider, store };
  assert.ok((await runPredictionTool(anonymous, "getPredictionEvent", { eventId: "ev1" })).ok);
  assert.equal((await runPredictionTool(anonymous, "preparePredictionRoute", { outcomeId: "o-yes", side: "buy", spendUsd: 2 })).code, "UNAUTHORIZED");
  assert.equal((await runPredictionTool(anonymous, "getPaperPredictionPortfolio", {})).code, "UNAUTHORIZED");
  assert.equal((await runPredictionTool(anonymous, "placeOrder", {})).code, "NOT_FOUND");
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);
  const routed = await runPredictionTool({ wallet: WALLET, provider, store }, "preparePredictionRoute", { outcomeId: "o-yes", side: "buy", spendUsd: 2 });
  assert.ok(routed.ok);
  assert.equal(provider.calls.filter((c) => c === "execute").length, 0, "a tool never executes");
});

/* ------------------------------------------------------------------ EVM wallets */

const EVM = "0x52908400098527886e0f7030069857d2e4169ee7";
const EVM_CHECKSUM = "0x52908400098527886E0F7030069857D2E4169EE7";

test("the account opens with a Solana wallet only: an EVM wallet is refused before the provider is asked", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const env = { ...ENV, AGG_APP_SECRET: "ab".repeat(32) };
  const started = await startLink(store, provider, EVM, { domain: "ryntra.io", uri: "https://ryntra.io" }, env);
  assert.equal(started.ok, false);
  assert.equal(started.code, "UNAUTHORIZED");
  const message = `ryntra.io wants you to sign in with your Ethereum account:
${EVM_CHECKSUM}

URI: https://ryntra.io`;
  const verified = await verifyLink(store, provider, EVM, { message, signature: `0x${"1b".repeat(65)}` }, env, NOW);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "UNAUTHORIZED");
  assert.equal(provider.calls.filter((c) => c.startsWith("challenge") || c.startsWith("verify")).length, 0, "the provider was never asked");
  assert.equal(await readLink(store, EVM), null);
});

test("a sign-in message is read as SIWS only: an Ethereum message names no wallet", () => {
  const solanaMessage = `ryntra.io wants you to sign in with your Solana account:
${WALLET}

URI: https://ryntra.io`;
  assert.equal(siwsAddress(solanaMessage), WALLET);
  const evmMessage = `ryntra.io wants you to sign in with your Ethereum account:
${EVM_CHECKSUM}

URI: https://ryntra.io`;
  assert.equal(siwsAddress(evmMessage), null);
  assert.equal(walletChain(EVM), "evm");
  assert.equal(walletChain(WALLET), "solana");
  assert.equal(ryntraExternalId(WALLET), `ryntra:solana:${WALLET}`);
  assert.equal(linkKey(WALLET), `solana:mainnet:${WALLET}`, "the Solana key is unchanged");
});

test("without an app id the product is not configured: no fallback app", () => {
  assert.equal(readPredictionsEnv({}).appId, null);
  assert.equal(readPredictionsEnv({ AGG_APP_ID: "  " }).appId, null);
  assert.equal(readPredictionsEnv({ AGG_APP_ID: "app-1" }).appId, "app-1");
});

test("the provider's socket is addressed on /ws: the bare host never answers", () => {
  assert.equal(AGG_WS_URL, "wss://ws.agg.market/ws");
  assert.equal(readPredictionsEnv({}).wsUrl, "wss://ws.agg.market/ws");
  // A deployment that still sets the bare host gets the path the socket answers on.
  assert.equal(readPredictionsEnv({ AGG_WS_URL: "wss://ws.agg.market" }).wsUrl, "wss://ws.agg.market/ws");
  assert.equal(readPredictionsEnv({ AGG_WS_URL: "wss://ws.agg.market/" }).wsUrl, "wss://ws.agg.market/ws");
  // A value with its own path (a stand, a proxy) is kept; one that is no socket address falls back to the default.
  assert.equal(readPredictionsEnv({ AGG_WS_URL: "ws://127.0.0.1:54377/socket" }).wsUrl, "ws://127.0.0.1:54377/socket");
  assert.equal(readPredictionsEnv({ AGG_WS_URL: "https://ws.agg.market" }).wsUrl, "wss://ws.agg.market/ws");
  assert.equal(readPredictionsEnv({ AGG_WS_URL: "not a url" }).wsUrl, "wss://ws.agg.market/ws");
  // The page adds the app id as the provider asks: the path survives it.
  const url = new URL(readPredictionsEnv({}).wsUrl);
  url.searchParams.set("appId", "app-1");
  assert.equal(url.toString(), "wss://ws.agg.market/ws?appId=app-1");
  assert.equal(aggSocketUrl("wss://ws.agg.market"), "wss://ws.agg.market/ws");
});

test("the account carries the provider's own location status, and none when the provider was not read", async () => {
  const store = durableStore();
  const provider = fakeProvider();
  const unlinked = await readPaperAccount(store, provider, WALLET);
  assert.equal(unlinked.access, null);
  const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" }, ENV);
  await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, ENV, NOW);
  const linked = await readPaperAccount(store, provider, WALLET);
  assert.deepEqual(linked.access, { locationBlocked: false, venueAccounts: null });
  const blocked = await readPaperAccount(store, { ...provider, profile: async () => ({ ok: true, value: { id: "agguser", username: null, externalId: null, wallets: [], locationBlocked: true, venueAccounts: [{ venue: "kalshi", status: "active", kycStatus: "pending" }] } }) }, WALLET);
  assert.deepEqual(blocked.access, { locationBlocked: true, venueAccounts: [{ venue: "kalshi", status: "active", kycStatus: "pending" }] });
});
