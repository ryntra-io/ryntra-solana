/**
 * Contract 1.11.0: every answer the Ryntra Predictions routes compose, and
 * every failure they answer, is the contract's shape on the wire. Each answer
 * is built the way its handler builds it — from this domain's own mappers,
 * stores and fixtures (the domain test's fake provider, SDK-shaped provider
 * payloads) — serialized as `NextResponse.json` does and parsed; the failure
 * bodies come from the real HTTP helpers and from handlers that answer before
 * any provider, store or proof. No network: `fetch` is refused.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

globalThis.fetch = async (input) => {
  throw new Error(`network refused in the harness: ${String(input)}`);
};
/* The services read the deployment's environment; this harness is that deployment (the same test-only secret the domain's tests set). */
process.env.BETA_TOKEN_SECRET = "test-secret-of-sufficient-length";
delete process.env.AGG_APP_SECRET;

const C = await import("../api/v1/contract.ts");
const { createMemoryGuardStore } = await import("../guard/store.ts");
const { classifyProviderError, failure } = await import("./failure.ts");
const { startLink, verifyLink } = await import("./link.ts");
const M = await import("./model.ts");
const { listPaperOrders, placePaper, quotePaper, readPaperAccount, readPaperOrder, syncPaperOrder } = await import("./paper.ts");
const P = await import("./plan.ts");
const { revokeLink } = await import("./session.ts");
const { readWatchlist, setWatch } = await import("./watchlist.ts");
const { createAggClient } = await import("@agg-build/sdk");

const results = [];
function wire(value) {
  /* NextResponse.json(body) is JSON.stringify(body). */
  return JSON.parse(JSON.stringify(value));
}
function check(label, schema, value, expect = true) {
  const parsed = schema.safeParse(wire(value));
  const ok = parsed.success === expect;
  results.push({ label, ok, expect });
  if (!ok) {
    console.log(`FAIL ${label} (expected ${expect ? "parse" : "refusal"})`);
    if (!parsed.success) console.log(JSON.stringify(parsed.error.issues.slice(0, 6), null, 1).slice(0, 2500));
  }
  return parsed;
}

/* ------------------------------------------------------------- fixtures (the domain test's, verbatim where it has them) */

const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

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

/* SDK-shaped provider payloads, fed through the repository's own mappers. */
const SDK_MARKET = {
  id: "m1",
  venue: "polymarket",
  question: "25 bps cut?",
  externalIdentifier: "pm-1",
  venueMarketOutcomes: [
    { id: "o-no", venueMarketId: "m1", label: "No", winner: null },
    { id: "o-yes", venueMarketId: "m1", label: "Yes", matchedVenueMarketOutcomes: [{ venueMarketId: "k1", venueMarketOutcomeId: "k-yes" }] },
  ],
  status: "open",
  volume: 1000,
  endDate: "2026-10-28T23:59:00Z",
  resolutionDate: null,
  description: "This market resolves to Yes if the FOMC announces a 25 bps cut.",
  rulesPrimary: "Primary resolution source: the FOMC statement.",
  rulesSecondary: null,
  tickSize: 0.01,
  minOrderSize: 5,
  image: "https://img.example/m1.png",
  matchedVenueMarkets: [
    {
      id: "k1",
      venue: "kalshi",
      question: "Fed cuts 25 bps in October?",
      externalIdentifier: "KX",
      status: "open",
      venueMarketOutcomes: [
        { id: "k-yes", venueMarketId: "k1", label: "Yes" },
        { id: "k-no", venueMarketId: "k1", label: "No", winner: false },
      ],
      volume: null,
      description: null,
      rulesPrimary: "Kalshi's rule.",
    },
  ],
};
const SDK_MARKET_MULTI = {
  id: "m2",
  venue: "kalshi",
  question: "Upper bound after October?",
  externalIdentifier: "k-2",
  venueMarketOutcomes: [
    { id: "b1", venueMarketId: "m2", label: "4.00%", price: 0.1 },
    { id: "b2", venueMarketId: "m2", label: "4.25%", price: 1.4 },
    { id: "b3", venueMarketId: "m2", label: "4.50%" },
  ],
  status: "paused",
};
const SDK_EVENT = {
  id: "ev1",
  venue: "polymarket",
  image: null,
  title: "Fed Decision in October?",
  externalIdentifier: "fed-oct",
  categories: [{ id: "x", category: { id: "c1", name: "finance", displayName: "Finance", parentId: null, eventCount: 12, volume24hr: 1500.5, volume: 90000 } }],
  status: "active",
  description: "The October FOMC meeting.",
  volume: 123456.78,
  startDate: "2026-09-01T00:00:00Z",
  endDate: "2026-10-28T23:59:00Z",
  subtitle: "FOMC",
  venues: ["polymarket", "kalshi"],
  aggKey: "agg_cb-fed_261028",
  structureType: "dates",
  arbReturn: 0.0085,
  settlementDiff: {
    sharedSummary: "Both venues resolve on the FOMC statement.",
    differences: [{ type: "source", title: "Resolution source", perVenue: { polymarket: "FOMC statement", kalshi: "Federal Reserve website" } }],
  },
  venueMarkets: [SDK_MARKET, SDK_MARKET_MULTI],
};
const SDK_EVENT_BARE = { id: "ev2", venue: "kalshi", image: null, title: "Recession in 2027?", externalIdentifier: "rec", categories: [], status: "unopened", venueMarkets: [] };
const SDK_MID_ROWS = [
  {
    venueMarketId: "m1",
    venue: "polymarket",
    midpoint: 0.3212345,
    spread: 0.02,
    timestamp: 1758540000000,
    bestBid: 0.31,
    bestAsk: 0.33,
    arbReturn: 0.004,
    marketStatus: "open",
    outcomes: [
      { venueMarketOutcomeId: "o-yes", label: "Yes", midpoint: 0.32, bestBid: 0.31, bestAsk: 0.33 },
      { venueMarketOutcomeId: "o-no", label: "No", midpoint: 0.68 },
    ],
    matched: [{ venueMarketId: "k1", venue: "kalshi", midpoint: 1.2, spread: 0.01, timestamp: 1758540000500 }],
  },
  { venueMarketId: "m9", venue: "kalshi", midpoint: null, spread: null, timestamp: null, outcomes: [], matched: [], marketStatus: "resolved", error: { code: "market_resolved", message: "resolved", retryable: false } },
];
const SDK_BOOK = {
  venueMarketId: "m1",
  status: "ok",
  error: null,
  requestedMarket: { venueMarketId: "m1", venue: "polymarket", marketStatus: "open", tickSize: 0.01, endDate: null, resolutionDate: null },
  venueOrderbooks: {
    polymarket: { venueMarketId: "m1", tickSize: 0.01, orderbook: { bids: [{ price: 0.32, size: 100 }, { price: 0.31, size: 50 }], asks: [{ price: 0.33, size: 80 }] } },
    kalshi: { venueMarketId: "k1", tickSize: null, orderbook: { bids: [{ price: 0.31, size: 10 }], asks: [{ price: 0.34, size: 5 }] } },
  },
  matchedMarkets: [{ venue: "kalshi", venueMarketId: "k1", marketStatus: "open", tickSize: null, hasOrderbook: true }, { venue: "limitless" }],
};
const SDK_BOOK_RESOLVED = { venueMarketId: "m9", status: "market_resolved", error: { code: "market_resolved", message: "The market resolved.", retryable: false }, requestedMarket: null, venueOrderbooks: {}, matchedMarkets: [] };
const SDK_CHART = {
  venueMarketOutcomeId: "o-yes",
  venue: "polymarket",
  resolution: "1h",
  data: [
    { t: 1758536400000, o: 0.3, h: 0.33, l: 0.29, c: 0.32, v: 1200 },
    { t: 1758540000000, o: 0.32, h: 0.32, l: 0.31, c: 0.31, v: null },
  ],
  meta: { serverTime: 1758540100000, lastBarOpenTime: 1758540000000, staleSeconds: 100 },
};
const SDK_CHART_EMPTY = { venueMarketOutcomeId: "o-yes", venue: "polymarket", resolution: "1d", data: [], meta: { serverTime: 1, lastBarOpenTime: null, staleSeconds: null } };
const SDK_SIGNALS = { venueMarketId: "m1", sourceModel: "signal-model-x", promptVersion: 3, createdAt: "2026-09-20T10:00:00Z", signals: [{ id: "s1", text: "Inflation prints cool.", side: "yes", direction: "more_likely", domain: "macro" }] };
const SDK_RELATED = [
  {
    venueMarketId: "m7",
    marketQuestion: "Will CPI fall below 3%?",
    marketStatus: "open",
    marketStartDate: "2026-09-01T00:00:00Z",
    marketEndDate: null,
    eventTitle: "CPI",
    eventStatus: "open",
    eventStartDate: "2026-09-01T00:00:00Z",
    eventEndDate: null,
    score: 0.81,
    matchedSignal: { id: "s1", text: "Inflation prints cool.", side: "yes", direction: "more_likely", domain: "macro" },
    matchSource: "signal",
    venue: "kalshi",
  },
];
const SDK_RIPPLE = [{ venueEventId: "ev7", eventTitle: "Recession in 2027?", eventStatus: "open", eventStartDate: "2026-01-01T00:00:00Z", eventEndDate: "2027-12-31T00:00:00Z", score: 0.7, action: "buy_yes", reason: "Rates and growth move together.", reasonDomain: "macro" }];
const SDK_NEWS = {
  results: [
    {
      question: "q",
      eventTitle: "t",
      category: "c",
      searchQuery: "fed cut october",
      timeRange: "7d",
      timeRangeLabel: "Past 7 days",
      articles: [
        { title: "Fed signals a cut", source: "Reuters", publishedAt: "2026-09-20", url: "https://example.com/a", impactSummary: "Raises the odds of a cut." },
        { headline: "", domain: "x.com", date: "yesterday", link: "", snippet: "…" },
      ],
    },
  ],
};
const SDK_ROUTE = (spend, quotedAt) => ({
  quoteId: `rq-${spend}`,
  venueMarketOutcomeId: "o-yes",
  venueMarketId: "m1",
  estimatedCostRaw: "1955850",
  expiresAt: new Date(Date.parse(quotedAt) + 60_000).toISOString(),
  refreshAt: new Date(Date.parse(quotedAt) + 30_000).toISOString(),
  status: "ok",
  fills: [{ venue: "predict", venueMarketId: "m1", venueMarketOutcomeId: "o-yes", chain: "solana", avgPrice: 0.32, yesPrice: 0.32, noPrice: 0.68, fills: [], venueQty: spend / 0.32, venueFee: 0.01, builderFee: 0 }],
  totalFilled: spend / 0.32,
  rawExecCost: spend,
  solveTimeMs: 7,
  verifyTimeMs: 1,
  matchedMarkets: [{ venue: "kalshi", venueMarketId: "k1" }],
  warnings: [{ venue: "kalshi", venueMarketOutcomeId: "k-yes", reason: "Unavailable for this account's region." }],
  venueSoloQuotes: [{ quoteId: null, unavailableReason: "geo", venue: "kalshi", avgPrice: null, filledQty: 0, rawExecCost: 0, estimatedPayout: 0, estimatedProfit: 0, returnPct: 0, status: "infeasible", fills: [], quoteFailure: { venue: "kalshi", code: "geo" } }],
  estimatedPayout: spend / 0.32,
  totalCostIncFees: spend + 0.01,
  estimatedProfit: spend / 0.32 - spend - 0.01,
  returnPct: 200,
  appFee: { bips: 10, categoryKey: "default", quotedAppFeeRaw: "2000" },
});
const SDK_POSITION = {
  venueMarket: {
    venueEventId: "ev1",
    question: "25 bps cut?",
    image: null,
    status: "open",
    venueMarketOutcomes: [
      { unrealizedPnl: 0.1, label: "Yes", title: null, winner: null, venueBreakdown: [{ venue: "predict", size: 6.25, venueMarketId: "m1", venueMarketOutcomeId: "o-yes" }], totalSize: 6.25, avgEntryPrice: 0.32, currentPrice: 0.34, totalValue: 2.125, unrealizedPnlPercent: 6.25, priceSource: "orderbook_midpoint", bookQuality: "ok" },
    ],
  },
  targetMarketId: "m1",
  eventId: "ev1",
  redeemStatus: "ineligible",
  status: "active",
  resolutionDate: null,
};
const SDK_ORDER = (quoteId) => ({
  status: "filled",
  id: "ord1",
  quoteId,
  externalId: null,
  clientOrderId: null,
  createdAt: new Date(NOW),
  updatedAt: "2026-09-17T12:00:05.000Z",
  venue: "predict",
  side: "buy",
  amountRaw: "2000000",
  limitPriceRaw: null,
  timeInForce: null,
  expiresAt: null,
  slippageBps: null,
  quotedPriceRaw: "0.32",
  quotedCostRaw: null,
  quotedSharesRaw: "6250000",
  quotedToWinRaw: "6250000",
  filledAmountRaw: "2000000",
  executionPrice: "0.32",
  actualSharesRaw: "6250000",
  actualToWinRaw: "6250000",
  partialFillReason: null,
  txHash: null,
  errorMessage: null,
  dagRunId: null,
  venueMarket: { id: "m1", venueEventId: "ev1", question: "25 bps cut?", image: null },
  venueMarketOutcome: { label: "Yes", title: null },
});
const SDK_ORDER_BARE = { ...SDK_ORDER(null), id: "ord2", createdAt: "", updatedAt: null, amountRaw: "not-a-number", venueMarket: null, venueMarketOutcome: null };
const SDK_EXECUTION = (quoteId, state = "filled", terminal = true) => ({
  executionId: "ex1",
  quoteId,
  orderIds: ["ord1"],
  overallState: state,
  terminal,
  errorReason: null,
  pollAfterMs: terminal ? null : 10,
  dagProgress: null,
  steps: [{ sequence: 1, stepType: "fill", status: "completed", attempt: 1, startedAt: null, completedAt: null, errorReason: null, orderIds: ["ord1"], kind: "fill", groupId: "g1", groupStatus: "completed", label: "Filled on Predict" }],
  orders: [{ orderId: "ord1", venue: "predict", status: "filled", event: terminal ? "filled" : null, filledAmountRaw: "2000000", actualSharesRaw: "6250000", executionPriceRaw: "0.32", updatedAt: "2026-09-17T12:00:05.000Z" }],
});

/**
 * The domain test's fake provider, with the paper account, the route and the
 * execution answered through the real mappers from SDK-shaped payloads.
 */
function harnessProvider(options = {}) {
  const calls = [];
  const state = { access: "acc-1", refresh: "ref-1", refreshes: 0, execution: null, balance: 10000, positions: [], orders: [], linkedExternalId: null, expiredTokens: new Set(), failBalance: null, failExecution: null };
  const requireLive = (session) => (state.expiredTokens.has(session.accessToken) ? { ok: false, code: "SESSION_EXPIRED", message: "expired" } : null);
  return {
    id: "agg",
    state,
    calls,
    categories: async () => ({ ok: true, value: [{ id: "c1", slug: "finance", name: "Finance", eventCount: 10, volume24h: 1 }] }),
    discover: async () => ({ ok: true, value: { events: [EVENT], nextCursor: null, readAt: new Date(NOW).toISOString() } }),
    search: async () => ({ ok: true, value: [EVENT] }),
    event: async (id) => (id === "ev1" ? { ok: true, value: options.mappedEvent ?? EVENT } : { ok: false, code: "NOT_FOUND", message: "no" }),
    signInChallenge: async ({ address, domain, uri, statement }) => ({
      ok: true,
      value: { nonce: "N0NCE", statement: statement ?? null, message: (() => {
        /* The SDK client opens a BroadcastChannel for its session; destroy() closes it, or the test process never exits. */
        const client = createAggClient({ baseUrl: "http://127.0.0.1:9", appId: "harness", persistSession: false });
        try {
          return client.buildSiwsMessage({ address, chainId: "mainnet", nonce: "N0NCE", domain, uri, statement });
        } finally {
          client.destroy();
        }
      })() },
    }),
    verifySignIn: async ({ message, signature }) => {
      calls.push("verify");
      if (signature !== "good") return { ok: false, code: "SIGNATURE_INVALID", message: "bad" };
      const address = message.split("\n")[1];
      return { ok: true, value: { accessToken: jwt(NOW / 1000 + 900), refreshToken: "ref-1", user: { id: "agguser", username: null, externalId: state.linkedExternalId, wallets: [{ chain: "solana", address }], locationBlocked: false } } };
    },
    refresh: async (token) => {
      state.refreshes += 1;
      if (token !== state.refresh) return { ok: false, code: "SESSION_EXPIRED", message: "refused" };
      state.access = jwt(Date.now() / 1000 + 900 + state.refreshes);
      state.refresh = `ref-${state.refreshes + 1}`;
      return { ok: true, value: { accessToken: state.access, refreshToken: state.refresh } };
    },
    linkExternalId: async (session, assertion) => {
      state.linkedExternalId = assertion.externalId;
      return { ok: true, value: { id: "agguser", username: null, externalId: assertion.externalId, wallets: [{ chain: "solana", address: WALLET }], locationBlocked: false } };
    },
    signOut: async () => ({ ok: true, value: null }),
    profile: async (session) => requireLive(session) ?? { ok: true, value: { id: "agguser", username: null, externalId: state.linkedExternalId, wallets: [{ chain: "solana", address: WALLET }], locationBlocked: Boolean(state.locationBlocked) } },
    paperBalance: async (session) =>
      requireLive(session) ??
      (state.failBalance
        ? state.failBalance
        : { ok: true, value: M.mapPaperBalance({ cash: [], positions: [], paper: { startingBalance: 10000, cashBalance: state.balance, positionsValue: 2.125, realizedPnl: 0, unrealizedPnl: 0.1, earnings: 0.1 } }) }),
    paperPositions: async (session, status) => requireLive(session) ?? { ok: true, value: status === "active" ? state.positions.map(M.mapPaperPosition) : [] },
    paperOrders: async (session) => requireLive(session) ?? { ok: true, value: state.orders.map(M.mapPaperOrder) },
    route: async (session, request) => {
      calls.push("route");
      const live = session ? requireLive(session) : null;
      if (live) return live;
      const quotedAt = new Date(NOW).toISOString();
      if (options.sdkRoute) {
        const raw = SDK_ROUTE(request.side === "buy" ? request.spendUsd : request.sellShares, quotedAt);
        return { ok: true, value: M.mapRoute(raw, request.side, request.side === "buy" ? request.spendUsd : request.sellShares, quotedAt) };
      }
      return { ok: true, value: { ...routeFor(request.spendUsd ?? request.sellShares ?? 0, options.price ?? 0.32), side: request.side } };
    },
    execute: async (session, request) => {
      calls.push("execute");
      const live = requireLive(session);
      if (live) return live;
      state.execution = SDK_EXECUTION(request.quoteId, options.pending ? "placing" : "filled", !options.pending);
      if (!options.pending) {
        state.balance -= 2;
        state.orders = [SDK_ORDER(request.quoteId), SDK_ORDER_BARE];
        state.positions = [SDK_POSITION];
      }
      return { ok: true, value: { quoteId: request.quoteId, orderIds: ["ord1"], status: "pending", alreadyAccepted: false } };
    },
    executionStatus: async (session) =>
      requireLive(session) ?? (state.failExecution ? state.failExecution : state.execution ? { ok: true, value: M.mapExecution(state.execution) } : { ok: false, code: "NOT_FOUND", message: "no execution" }),
  };
}

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
  resolutionDeadline: "2026-10-29T00:00:00.000Z",
  monitoring: [{ metric: "probability", direction: "above", threshold: 0.5, note: null }],
  references: ["https://www.federalreserve.gov/"],
  assumptions: ["No emergency meeting."],
};

/* ------------------------------------------------------------- the market reads (public) */

const summaries = [M.mapEventSummary(SDK_EVENT, M.midpointMap(SDK_MID_ROWS.map(M.mapMarketPrices))), M.mapEventSummary(SDK_EVENT_BARE)];
const categoriesPage = [
  { id: "c1", name: "finance", displayName: "Finance", parentId: null, eventCount: 12, volume24hr: 1500.5, volume: 90000 },
  { id: "c2", name: "politics", displayName: null, parentId: null, eventCount: 30, volume24hr: 9000, volume: 1 },
  { id: "c3", name: "fed", displayName: "Fed", parentId: "c1", eventCount: 3, volume24hr: 1, volume: 1 },
];
/* adapter.ts readCategories, restated (not exported). */
const categories = categoriesPage.filter((c) => c.parentId === null).map((c) => ({ id: c.id, slug: c.name, name: c.displayName ?? c.name, eventCount: c.eventCount, volume24h: c.volume24hr }));

/* discover/route.ts, its query reading restated. */
const SORTS = new Set(["volume24h", "volume", "newest", "ending"]);
function discoverAnswer(search, listed, { categoriesOk = true, watched = [], wallet = null } = {}) {
  const url = new URL(`http://h/api/predictions/discover${search}`);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() || null;
  const sortParam = url.searchParams.get("sort") ?? "volume24h";
  const sort = SORTS.has(sortParam) ? sortParam : "volume24h";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 24) || 24, 1), 50);
  const value = listed;
  const page = Array.isArray(value) ? { events: value, nextCursor: null, readAt: new Date().toISOString() } : value;
  return { categories: categoriesOk ? categories : [], categoriesUnavailable: !categoriesOk, query: { q: q || null, category, sort, limit }, events: page.events, nextCursor: page.nextCursor, readAt: page.readAt, watched, wallet };
}
check("discover: a page from the real mappers", C.PredictionsDiscoverResponseSchema, discoverAnswer("?category=finance&sort=volume&limit=12", { events: summaries, nextCursor: "cur_eyJpZCI6IjEyMyJ9", readAt: new Date().toISOString() }));
check("discover: a search, a proven wallet with a watch", C.PredictionsDiscoverResponseSchema, discoverAnswer("?q=%20fed%20", summaries, { watched: ["ev1", "ev9"], wallet: WALLET }));
check("discover: odd parameters (limit=2.5, unknown sort), categories unavailable", C.PredictionsDiscoverResponseSchema, discoverAnswer("?limit=2.5&sort=hot&category=%20", { events: summaries, nextCursor: null, readAt: new Date(NOW).toISOString() }, { categoriesOk: false }));
/* The test's fake discover lists the whole EVENT (a detail) where the adapter lists summaries: a strict summary refuses the extra keys. */
check("discover: the test fake's page, verbatim (a detail as a list item)", C.PredictionsDiscoverResponseSchema, discoverAnswer("", (await harnessProvider().discover({})).value), false);
const summaryKeys = Object.keys(C.PredictionEventSummarySchema.shape);
const asSummary = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => summaryKeys.includes(k)));
check("discover: the test fake's page, its event cut to the summary the adapter lists", C.PredictionsDiscoverResponseSchema, discoverAnswer("", { ...(await harnessProvider().discover({})).value, events: [asSummary(EVENT)] }));

check("events: summaries by id", C.PredictionsEventsResponseSchema, { events: summaries, readAt: new Date().toISOString() });

const mappedEvent = M.mapEvent(SDK_EVENT, [SDK_MARKET, SDK_MARKET_MULTI], M.midpointMap(SDK_MID_ROWS.map(M.mapMarketPrices)));
const mappedBare = M.mapEvent(SDK_EVENT_BARE, []);
check("event: the real mapper, public", C.PredictionsEventResponseSchema, { event: mappedEvent, watch: null, wallet: null, readAt: new Date().toISOString() });
check("event: an event with no markets", C.PredictionsEventResponseSchema, { event: mappedBare, watch: null, wallet: null, readAt: new Date().toISOString() });
/* The test's EVENT market has no `description` key, which `mapVenueMarket` always writes (`?? null`). */
check("event: the test's EVENT fixture, verbatim (its market lacks `description`)", C.PredictionsEventResponseSchema, { event: EVENT, watch: null, wallet: null, readAt: new Date().toISOString() }, false);
check("event: the test's EVENT fixture with `description: null` as the mapper writes it", C.PredictionsEventResponseSchema, { event: { ...EVENT, markets: EVENT.markets.map((m) => ({ ...m, description: null })) }, watch: null, wallet: null, readAt: new Date().toISOString() });

check("book: the real mapper, two venues", C.PredictionsBookResponseSchema, { book: M.mapBook(SDK_BOOK, new Date().toISOString()) });
check("book: a resolved market", C.PredictionsBookResponseSchema, { book: M.mapBook(SDK_BOOK_RESOLVED, new Date().toISOString()) });
check("book: the test fake's book (readAt '' — never the adapter's)", C.PredictionsBookResponseSchema, (await (async () => ({ book: { venueMarketId: "m1", status: "ok", error: null, requested: null, venues: [], matched: [], aggregated: { bids: [], asks: [] }, readAt: "" } }))()), false);

check("prices: the real mapper (with a resolved market)", C.PredictionsPricesResponseSchema, { prices: SDK_MID_ROWS.map(M.mapMarketPrices), readAt: new Date().toISOString() });
check("prices: none answered", C.PredictionsPricesResponseSchema, { prices: [], readAt: new Date().toISOString() });

check("chart: the real mapper", C.PredictionsChartResponseSchema, { chart: M.mapChart(SDK_CHART), readAt: new Date().toISOString() });
check("chart: no bars", C.PredictionsChartResponseSchema, { chart: M.mapChart(SDK_CHART_EMPTY), readAt: new Date().toISOString() });

/* research/route.ts `part`, restated. */
const part = (r) => (r.ok ? r : { ok: false, code: r.code });
check("research: every part answered", C.PredictionsResearchResponseSchema, {
  signals: part({ ok: true, value: M.mapSignals(SDK_SIGNALS) }),
  expand: part({ ok: true, value: M.mapRipple("expand", SDK_RIPPLE) }),
  hedge: part({ ok: true, value: M.mapRipple("hedge", []) }),
  news: part({ ok: true, value: M.mapNews(SDK_NEWS) }),
  related: part({ ok: true, value: M.mapRelated(SDK_RELATED) }),
  readAt: new Date().toISOString(),
});
check("research: parts failed or empty", C.PredictionsResearchResponseSchema, {
  signals: part({ ok: true, value: null }),
  expand: part(classifyProviderError(Object.assign(new Error("busy"), { status: 429 }))),
  hedge: part(classifyProviderError(new TypeError("fetch failed"))),
  news: part({ ok: true, value: M.mapNews(undefined) }),
  related: part({ ok: true, value: [] }),
  readAt: new Date().toISOString(),
});

/* adapter.ts engine(), restated. */
function engineOf(config, status) {
  const cfg = config;
  return {
    tradingMode: String(cfg.tradingMode ?? "unknown"),
    paperStartingBalance: typeof cfg.paperStartingBalance === "number" ? cfg.paperStartingBalance : null,
    disabledVenues: Array.isArray(cfg.disabledVenues) ? cfg.disabledVenues : [],
    signals: status ? { marketsProcessed: status.markets.processed, marketsTotal: status.markets.total, coveragePct: status.markets.coverage, total: status.signals.total } : null,
  };
}
check("engine: config and coverage", C.PredictionsEngineResponseSchema, { engine: engineOf({ tradingMode: "paper", paperStartingBalance: 10000, disabledVenues: ["limitless"] }, { markets: { total: 1000, processed: 800, coverage: 80 }, signals: { total: 5000 } }), readAt: new Date().toISOString() });
check("engine: nothing stated", C.PredictionsEngineResponseSchema, { engine: engineOf({}, null), readAt: new Date().toISOString() });

/* ------------------------------------------------------------- the wallet routes */

const store = durableStore();
const provider = harnessProvider({ sdkRoute: true, mappedEvent: M.mapEvent({ ...SDK_EVENT, venueMarkets: [SDK_MARKET] }, [SDK_MARKET], M.midpointMap(SDK_MID_ROWS.map(M.mapMarketPrices))) });

/* Before any link. */
check("account: not linked", C.PredictionsAccountResponseSchema, { wallet: OTHER, ...(await readPaperAccount(store, provider, OTHER)), watchlist: await readWatchlist(store, OTHER), plans: await P.listPredictionPlans(store, OTHER) });

const started = await startLink(store, provider, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io", locale: "uk" });
check("link/start: the challenge", C.PredictionsLinkStartResponseSchema, started.value);
const verified = await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, process.env, NOW);
check("link/verify: signing_key_missing", C.PredictionsLinkResponseSchema, { wallet: WALLET, link: verified.value });
const verifiedKeyed = await verifyLink(store, provider, WALLET, { message: started.value.message, signature: "good" }, { ...process.env, AGG_APP_SECRET: "ab".repeat(32) }, NOW);
check("link/verify: linked", C.PredictionsLinkResponseSchema, { wallet: WALLET, link: verifiedKeyed.value });

/* Plans. */
const created = await P.createPredictionPlan(store, { owner: WALLET, rules: RULES, activate: true }, { now: () => new Date(NOW), planId: () => "pplan_000000000000000000000001" });
check("plans POST (201): created", C.PredictionsPlanResponseSchema, { wallet: WALLET, plan: created.value });
const tiny = await P.createPredictionPlan(store, { owner: WALLET, rules: { ...RULES, amountUsd: 0.004, maxProbability: null, invalidation: { text: "x", probabilityBelow: null } } }, { now: () => new Date(NOW), planId: () => "pplan_00000000000000000000000f" });
check("plans POST: a plan under half a cent (sizes maxLossUsd 0)", C.PredictionsPlanResponseSchema, { wallet: WALLET, plan: tiny.value });
const internalRefusesTiny = !P.PredictionPlanSchema.safeParse(wire(tiny.value)).success;
results.push({ label: "the web's own PredictionPlanSchema refuses that stored plan (maxLossUsd 0)", ok: internalRefusesTiny, expect: true });
const edited = await P.updatePredictionPlan(store, WALLET, "pplan_000000000000000000000001", { version: 1, rules: { ...RULES, amountUsd: 20 }, reason: "more" }, new Date(NOW + 1000));
check("plans/{id} PATCH: version 2", C.PredictionsPlanResponseSchema, { wallet: WALLET, plan: edited.value });
const draft = await P.createPredictionPlan(store, { owner: WALLET, rules: RULES }, { now: () => new Date(NOW), planId: () => "pplan_000000000000000000000002" });
const activated = await P.setPredictionPlanStatus(store, WALLET, draft.value.id, { version: 1, status: "active", note: "go" }, new Date(NOW + 2000));
check("plans/{id}/status POST: activated", C.PredictionsPlanResponseSchema, { wallet: WALLET, plan: activated.value });
check("plans/{id} GET", C.PredictionsPlanResponseSchema, { wallet: WALLET, plan: (await P.readPredictionPlan(store, WALLET, "pplan_000000000000000000000001", NOW)).value });

/* Watchlist. */
await setWatch(store, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeLabel: "Yes", probabilityAtWatch: 0.32 }, true, NOW);
const watched = await setWatch(store, WALLET, { eventId: "ev2", venueMarketId: null, outcomeLabel: null, probabilityAtWatch: null }, true, NOW + 1);
check("watchlist PUT", C.PredictionsWatchlistResponseSchema, { wallet: WALLET, entries: watched.value });
check("watchlist GET", C.PredictionsWatchlistResponseSchema, { wallet: WALLET, entries: await readWatchlist(store, WALLET) });
check("event: with the wallet's watch", C.PredictionsEventResponseSchema, { event: mappedEvent, watch: (await readWatchlist(store, WALLET)).find((e) => e.eventId === "ev1") ?? null, wallet: WALLET, readAt: new Date().toISOString() });

/* Quote → place, through the real route mapper. */
const quoted = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 2, planId: "pplan_000000000000000000000001", locale: "uk" }, NOW);
if (!quoted.ok) console.log("quote failed", quoted);
check("quote: a Review under a plan (SDK route through mapRoute)", C.PredictionsQuoteResponseSchema, { wallet: WALLET, review: quoted.value.review, link: quoted.value.link, order: quoted.value.record });
const refusedQuote = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "gone", outcomeId: "o-none", side: "buy", spendUsd: 0.5 }, NOW);
check("quote: a refusing Review (market gone, outcome gone, amount low)", C.PredictionsQuoteResponseSchema, { wallet: WALLET, review: refusedQuote.value.review, link: refusedQuote.value.link, order: refusedQuote.value.record });
const sellQuote = await quotePaper(store, provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "sell", sellShares: 3 }, NOW);
check("quote: a sell", C.PredictionsQuoteResponseSchema, { wallet: WALLET, review: sellQuote.value.review, link: sellQuote.value.link, order: sellQuote.value.record });

const placed = await placePaper(store, provider, WALLET, quoted.value.review.quoteId, NOW + 1000);
if (!placed.ok) console.log("place failed", placed);
check(`orders POST (${placed.value.state === "submitted" ? 202 : 200}): placed and settled`, C.PredictionsOrderPlacedResponseSchema, { wallet: WALLET, order: placed.value });
check("orders GET: the records", C.PredictionsOrdersResponseSchema, { wallet: WALLET, orders: await listPaperOrders(store, WALLET) });
const one = await readPaperOrder(store, WALLET, quoted.value.review.quoteId);
check("orders/{quoteId} GET: terminal", C.PredictionsOrderResponseSchema, { wallet: WALLET, order: one });

const linkedAccount = { wallet: WALLET, ...(await readPaperAccount(store, provider, WALLET)), watchlist: await readWatchlist(store, WALLET), plans: await P.listPredictionPlans(store, WALLET) };
check("account: linked, a position, provider rows (a Date and an empty time among them)", C.PredictionsAccountResponseSchema, linkedAccount);
{
  const a = wire(linkedAccount);
  const review = wire(quoted.value.review);
  const placedPlan = a.plans.find((p) => p.id === "pplan_000000000000000000000001");
  console.log(
    "exercised:",
    JSON.stringify({
      positions: a.positions.length,
      providerOrderTimes: a.providerOrders.map((o) => [o.createdAt, o.updatedAt]),
      providerOrderAmounts: a.providerOrders.map((o) => o.amountUsd),
      orders: a.orders.map((o) => o.state),
      executionOrders: a.orders[0]?.execution?.orders.length ?? 0,
      recordProviderOrders: a.orders.map((o) => o.providerOrders.length),
      watchlist: a.watchlist.length,
      plans: a.plans.map((p) => `${p.id.slice(-2)}:${p.status}:v${p.version}:maxLoss=${p.current.sizing.maxLossUsd}`),
      planExecutions: placedPlan?.executions,
      reviewChecks: review.checks.map((c) => `${c.id}:${c.state}`),
      reviewPlanChecks: review.plan?.checks.map((c) => `${c.id}:${c.state}`),
      venueSoloFields: Object.keys(review.route.venueSolo[0]?.fields ?? {}),
      routeWarnings: review.route.warnings.length,
      appFee: review.route.fees.app,
      linkError: wire(verified.value).linkError,
      challengeLength: started.value.message.length,
    }),
  );
}
check("plans GET", C.PredictionsPlansResponseSchema, { wallet: WALLET, plans: await P.listPredictionPlans(store, WALLET) });

/* A pending execution: submitted (202), then a failed re-read answers `sync`. */
const pendingStore = durableStore();
const pending = harnessProvider({ pending: true });
const s2 = await startLink(pendingStore, pending, WALLET, { domain: "ryntra.io", uri: "https://ryntra.io" });
await verifyLink(pendingStore, pending, WALLET, { message: s2.value.message, signature: "good" }, process.env, NOW);
const q2 = await quotePaper(pendingStore, pending, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "buy", spendUsd: 3 }, NOW);
const placedPending = await placePaper(pendingStore, pending, WALLET, q2.value.review.quoteId, NOW);
check(`orders POST (${placedPending.value.state === "submitted" ? 202 : 200}): still submitted`, C.PredictionsOrderPlacedResponseSchema, { wallet: WALLET, order: placedPending.value });
pending.state.failExecution = classifyProviderError(Object.assign(new Error("The provider is busy."), { status: 503 }));
const current = await readPaperOrder(pendingStore, WALLET, q2.value.review.quoteId);
const synced = await syncPaperOrder(pendingStore, pending, WALLET, q2.value.review.quoteId);
check("orders/{quoteId} GET: re-read failed → sync", C.PredictionsOrderResponseSchema, synced.ok ? { wallet: WALLET, order: synced.value } : { wallet: WALLET, order: current, sync: { code: synced.code, message: synced.message } });
pending.state.failBalance = classifyProviderError(Object.assign(new Error("slow down"), { status: 429, retryAfter: 5 }));
const failedAccount = await readPaperAccount(pendingStore, pending, WALLET);
check("account: the provider failed → providerFailure (with retryAfterSeconds)", C.PredictionsAccountResponseSchema, { wallet: WALLET, ...failedAccount, watchlist: [], plans: [] });

const revoked = await revokeLink(store, provider, WALLET);
check("link/revoke", C.PredictionsLinkResponseSchema, { wallet: WALLET, link: revoked.value });

/* ------------------------------------------------------------- the failure envelope, from the real http helpers and handlers */

let httpNote = "not attempted";
try {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const candidates = [];
      if (specifier.startsWith("@/")) {
        const base = new URL(specifier.slice(2), new URL("../../", import.meta.url)).href;
        candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
      } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
        const base = new URL(specifier, context.parentURL).href;
        candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
      } else {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          /* Next's bundler resolves `next/server` without an extension; Node's ESM resolver needs `next/server.js`. */
          if (!specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
          throw error;
        }
      }
      for (const c of candidates) {
        const path = fileURLToPath(c);
        if (existsSync(path) && !statSync(path).isDirectory()) return nextResolve(c, context);
      }
      return nextResolve(specifier, context);
    },
  });
  const http = await import("./http.ts");
  const bodyOf = async (res) => ({ status: res.status, body: await res.json() });

  const plain = await bodyOf(http.predictionFailure(failure("NOT_LINKED", "The paper account is not linked to this wallet yet.")));
  check(`failure: NOT_LINKED (${plain.status})`, C.PredictionsFailureSchema, plain.body);
  const limited = await bodyOf(http.predictionFailure(classifyProviderError(Object.assign(new Error("x"), { status: 429, retryAfter: 7 }))));
  check(`failure: RATE_LIMITED (${limited.status})`, C.PredictionsFailureSchema, limited.body);
  const rootIssue = await bodyOf((await http.readPredictionBody(new Request("http://h/x", { method: "POST", body: "5" }), P.PredictionPlanCreateSchema, 32_768)).response);
  check(`failure: a body that is not an object (${rootIssue.status}, issue path "")`, C.PredictionsFailureSchema, rootIssue.body);
  const notJson = await bodyOf((await http.readPredictionBody(new Request("http://h/x", { method: "POST", body: "{" }), P.PredictionPlanCreateSchema)).response);
  check(`failure: not JSON (${notJson.status})`, C.PredictionsFailureSchema, notJson.body);
  let n = 1;
  while (JSON.stringify({ rules: { monitoring: Array(n + 1).fill({}) } }).length <= 32_768) n += 1;
  const flood = await bodyOf((await http.readPredictionBody(new Request("http://h/x", { method: "POST", body: JSON.stringify({ rules: { monitoring: Array(n).fill({}) } }) }), P.PredictionPlanCreateSchema, 32_768)).response);
  check(`failure: a 32 KB plan body → ${flood.body.error.issues.length} issues (${flood.status})`, C.PredictionsFailureSchema, flood.body);
  const longKey = await bodyOf((await http.readPredictionBody(new Request("http://h/x", { method: "POST", body: JSON.stringify({ ["k".repeat(32_700)]: 0 }) }), P.PredictionPlanCreateSchema, 32_768)).response);
  check(`failure: an unknown 32,700-character key quoted in the message (${longKey.status})`, C.PredictionsFailureSchema, longKey.body);
  const planInvalid = await bodyOf(http.predictionFailure(await P.createPredictionPlan(durableStore(), { owner: WALLET, rules: { ...RULES, maxProbability: 0.2 } })));
  check(`failure: PLAN_INVALID with issues (${planInvalid.status})`, C.PredictionsFailureSchema, planInvalid.body);
  const zeroAmount = await bodyOf(http.predictionFailure(await quotePaper(durableStore(), provider, WALLET, { eventId: "ev1", venueMarketId: "m1", outcomeId: "o-yes", side: "sell" }, NOW)));
  check(`failure: a sell without shares (${zeroAmount.status})`, C.PredictionsFailureSchema, zeroAmount.body);
  httpNote = "http.ts helpers: ran";

  /* Handlers that answer before any provider, store or proof. */
  const handler = async (path, name, request, params) => {
    const mod = await import(`../../app/api/predictions/${path}/route.ts`);
    const res = await mod[name](request, params ? { params: Promise.resolve(params) } : undefined);
    return { status: res.status, body: await res.json() };
  };
  const runs = [
    ["events/[id] bad id", () => handler("events/[id]", "GET", new Request("http://h/api/predictions/events/bad%20id"), { id: "bad id" })],
    ["events no ids", () => handler("events", "GET", new Request("http://h/api/predictions/events?ids=,%20,bad%20id"))],
    ["discover q over 200", () => handler("discover", "GET", new Request(`http://h/api/predictions/discover?q=${"x".repeat(201)}`))],
    ["markets/[id]/book bad id", () => handler("markets/[id]/book", "GET", new Request("http://h/x"), { id: "a/b" })],
    ["markets/[id]/prices bad id", () => handler("markets/[id]/prices", "GET", new Request("http://h/x"), { id: "" })],
    ["markets/[id]/research bad id", () => handler("markets/[id]/research", "GET", new Request("http://h/x"), { id: "x".repeat(65) })],
    ["outcomes/[id]/chart bad id", () => handler("outcomes/[id]/chart", "GET", new Request("http://h/x"), { id: "é" })],
    ["orders/[quoteId] bad id", () => handler("orders/[quoteId]", "GET", new Request("http://h/x"), { quoteId: "q q" })],
  ];
  for (const [label, run] of runs) {
    try {
      const r = await run();
      check(`handler ${label} → ${r.status} ${r.body?.error?.code}`, C.PredictionsFailureSchema, r.body);
    } catch (error) {
      results.push({ label: `handler ${label}: could not run (${String(error?.message ?? error).slice(0, 160)})`, ok: false, expect: true, skipped: true });
    }
  }
} catch (error) {
  httpNote = `http.ts not importable here: ${String(error?.message ?? error).slice(0, 300)}`;
}


/* ------------------------------------------------------------- the assertions */

test("every prediction answer and failure the routes compose parses with its 1.11.0 schema", () => {
  const failed = results.filter((entry) => !entry.ok && !entry.skipped);
  assert.deepEqual(failed.map((entry) => entry.label), []);
  assert.equal(results.filter((entry) => entry.skipped).length, 0, `every check ran (${httpNote})`);
  assert.ok(results.filter((entry) => entry.ok).length >= 60, `only ${results.length} checks ran`);
});

test("a refused 32 KB plan body draws at most thirty-two bounded issues, not tens of thousands (1.11.0)", () => {
  const flood = results.find((entry) => entry.label.startsWith("failure: a 32 KB plan body"));
  assert.ok(flood, "the flood check ran");
  const count = Number(/→ (\d+) issues/.exec(flood.label)?.[1]);
  assert.ok(count > 0 && count <= 32, `${count} issues`);
});
