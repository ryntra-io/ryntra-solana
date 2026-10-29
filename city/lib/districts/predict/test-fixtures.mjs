// Answers shaped as Ryntra Predictions' routes give them (lib/predictions/model.ts and the route files), for the
// window's tests and its screens. The questions and figures are fixtures, not a read of AGG.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const cat = (slug, name) => ({ id: `c-${slug}`, slug, name });

const binary = (id, title, yes, extra = {}) => ({
  id,
  title,
  subtitle: null,
  image: null,
  status: "open",
  venue: "polymarket",
  venues: ["polymarket", "kalshi"],
  volume: 1_000_000,
  endDate: null,
  categories: [],
  marketCount: 1,
  aggKey: null,
  structureType: null,
  arbReturn: null,
  leading: [
    { id: `${id}-yes`, label: "Yes", probability: yes, venueMarketId: `${id}-m` },
    { id: `${id}-no`, label: "No", probability: yes === null ? null : Math.round((1 - yes) * 10_000) / 10_000, venueMarketId: `${id}-m` },
  ],
  leadingQuestion: null,
  ...extra,
});

/** The engine's categories, as `discover` answers them (top-level only). */
export const CATEGORIES = [
  { id: "c-sports", slug: "sports", name: "Sports", eventCount: 900, volume24h: 9_000_000 },
  { id: "c-crypto", slug: "crypto", name: "Crypto", eventCount: 400, volume24h: 12_000_000 },
  { id: "c-economy", slug: "economy", name: "Economy", eventCount: 120, volume24h: 3_000_000 },
  { id: "c-politics", slug: "politics", name: "Politics", eventCount: 300, volume24h: 7_000_000 },
  { id: "c-world", slug: "world", name: "World", eventCount: 200, volume24h: 2_000_000 },
  { id: "c-tech", slug: "tech", name: "tech", eventCount: 80, volume24h: 4_000_000 },
];

/** A page of the day's most traded events at `now`. */
export function discoverEvents(now) {
  const at = (ms) => new Date(now + ms).toISOString();
  return [
    binary("ev-btc", "Will Bitcoin close October above $120,000?", 0.58, { volume: 4_210_000, endDate: at(4 * DAY + 3 * HOUR), categories: [cat("crypto", "Crypto")] }),
    {
      ...binary("ev-fed", "Fed decision in December?", 0.765, { volume: 18_400_000, endDate: at(42 * DAY), marketCount: 5, leadingQuestion: "25 bps increase", categories: [cat("politics", "Politics")] }),
      // The leading bracket of five, as AGG leads it: its own market, its own Yes and No.
      leading: [
        { id: "fed-hike25-yes", label: "Yes", probability: 0.765, venueMarketId: "fed-hike25" },
        { id: "fed-hike25-no", label: "No", probability: 0.235, venueMarketId: "fed-hike25" },
      ],
    },
    binary("ev-sol", "Will SOL reach $300 in 2026?", 0.62, { volume: 2_130_000, endDate: at(65 * DAY), venues: ["polymarket"], categories: [cat("crypto", "Crypto")] }),
    {
      ...binary("ev-ars", "Arsenal vs Chelsea", null, { volume: 862_000, endDate: at(2 * DAY), venues: ["polymarket", "limitless"], categories: [cat("sports", "Sports")] }),
      leadingQuestion: "Match winner",
      marketCount: 2,
      leading: [
        { id: "ev-ars-draw", label: "Draw", probability: 0.27, venueMarketId: "ev-ars-m" },
        { id: "ev-ars-home", label: "Arsenal", probability: 0.48, venueMarketId: "ev-ars-m" },
        { id: "ev-ars-away", label: "Chelsea", probability: 0.25, venueMarketId: "ev-ars-m" },
      ],
    },
    binary("ev-etf", "Solana ETF approved this year?", 0.49, { volume: 640_000, endDate: at(36 * DAY), venues: ["kalshi"], categories: [cat("crypto", "Crypto")] }),
    binary("ev-cease", "US–Iran ceasefire through October?", 0.63, { volume: 3_120_000, endDate: at(3 * DAY), categories: [cat("world", "World")] }),
    // Never a card: closed, past its close, unpriced, its sides from two markets, a duplicate.
    binary("ev-closed", "A market the venue closed", 0.5, { status: "closed", endDate: at(DAY) }),
    binary("ev-past", "A market past its close", 0.5, { endDate: at(-HOUR) }),
    binary("ev-unpriced", "A market with no price", null, { endDate: at(DAY) }),
    {
      ...binary("ev-mixed", "Sides of two markets", 0.5, { endDate: at(DAY) }),
      leading: [
        { id: "a", label: "Yes", probability: 0.5, venueMarketId: "m-1" },
        { id: "b", label: "No", probability: 0.5, venueMarketId: "m-2" },
      ],
    },
    binary("ev-btc", "Will Bitcoin close October above $120,000?", 0.58, { volume: 4_210_000, endDate: at(4 * DAY + 3 * HOUR) }),
    binary("ev-eth", "Will ETH flip $5,000 this year?", 0.19, { volume: 1_480_000, endDate: at(65 * DAY), venues: ["polymarket", "kalshi", "limitless"], categories: [cat("crypto", "Crypto")] }),
    binary("ev-gold", "Gold above $4,000 on Friday?", 0.985, { volume: 312_000, endDate: at(3 * DAY), categories: [cat("economy", "Economy")] }),
  ];
}

/** `/api/predictions/discover` as the route answers it; a category keeps the events filed under it. */
export function discoverBody(now, { readAt = new Date(now).toISOString(), category = null, categories = CATEGORIES, categoriesUnavailable = false } = {}) {
  const events = discoverEvents(now).filter((e) => !category || e.categories.some((c) => c.slug === category));
  return { categories, categoriesUnavailable, query: { q: null, category, sort: "volume24h", limit: 40 }, events, nextCursor: null, readAt, watched: [], wallet: null };
}

/** `/api/predictions/events/<id>` as the route answers it: the event's markets, live midpoints, the venue's rules and winner. */
export function eventBody(id, { now = Date.now(), winner = null, status = "open", yes = 0.58, marketId = `${id}-m`, outcomes = null } = {}) {
  if (id === "ev-fed" && winner === null && outcomes === null) return fedEventBody(now);
  const card = discoverEvents(now).find((e) => e.id === id);
  const sides = outcomes ?? (card?.leading ?? [{ id: `${id}-yes`, label: "Yes" }, { id: `${id}-no`, label: "No" }]).map((o) => ({ id: o.id, label: o.label, probability: o.label === "Yes" ? yes : o.label === "No" ? Math.round((1 - yes) * 10_000) / 10_000 : o.probability }));
  return {
    event: {
      id,
      title: card?.title ?? id,
      subtitle: null,
      image: null,
      status,
      venue: "polymarket",
      venues: card?.venues ?? ["polymarket"],
      volume: card?.volume ?? 1_000,
      endDate: card?.endDate ?? null,
      categories: card?.categories ?? [],
      marketCount: 2,
      description: "The event's own description.",
      startDate: null,
      settlement: { sharedSummary: "Resolves Yes if the close on the last day of October is above $120,000.", differences: [] },
      markets: [
        { id: "other-market", venue: "polymarket", question: "Another market", status: "open", outcomes: [{ id: "x", label: "Yes", probability: 0.5, winner: null, venueMarketId: "other-market", matched: [] }], rules: { primary: null, secondary: null } },
        {
          id: marketId,
          venue: "polymarket",
          question: card?.leadingQuestion ?? card?.title ?? id,
          status,
          endDate: card?.endDate ?? null,
          description: "Resolves to Yes if Bitcoin closes above $120,000 on Binance BTC/USDT.",
          rules: { primary: "The close of the 1-minute candle at 23:59 UTC on October 31.", secondary: null },
          outcomes: sides.map((o) => ({ ...o, winner: winner === null ? null : o.id === winner, venueMarketId: marketId, matched: [] })),
        },
      ],
    },
    watch: null,
    wallet: null,
    readAt: new Date(now).toISOString(),
  };
}

/** The Fed's December decision as the engine answers it (shape read on prod 29.10): one event, five brackets, each its own market with Yes and No. */
export function fedEventBody(now = Date.now()) {
  const at = (ms) => new Date(now + ms).toISOString();
  const bracket = (id, question, yes, matched = []) => ({
    id,
    venue: "polymarket",
    question,
    status: "open",
    outcomes: [
      { id: `${id}-yes`, label: "Yes", probability: yes, venueMarketId: id, winner: null, matched: matched.map((m) => ({ venueMarketId: `${m}-m`, outcomeId: `${m}-yes` })) },
      { id: `${id}-no`, label: "No", probability: Math.round((1 - yes) * 10_000) / 10_000, venueMarketId: id, winner: null, matched: [] },
    ],
    volume: Math.round(yes * 1_700_000),
    endDate: at(41 * DAY),
    description: `This market resolves Yes on «${question}».`,
    rules: { primary: null, secondary: null },
    image: null,
  });
  return {
    event: {
      id: "ev-fed",
      title: "Fed decision in December?",
      subtitle: null,
      image: null,
      status: "open",
      venue: "polymarket",
      venues: ["kalshi", "polymarket", "predict"],
      volume: 18_400_000,
      endDate: at(42 * DAY),
      categories: [cat("finance", "Finance"), cat("politics", "Politics")],
      marketCount: 5,
      description: "The upper bound of the target federal funds range after the December meeting.",
      markets: [
        bracket("fed-cut25", "25 bps decrease", 0.0045),
        bracket("fed-hold", "No change", 0.215, ["k-hold"]),
        bracket("fed-hike25", "25 bps increase", 0.765, ["k-hike25", "p-hike25"]),
        bracket("fed-hike50", "50+ bps increase", 0.024),
        bracket("fed-cut50", "50+ bps decrease", 0.0025),
      ],
      settlement: { sharedSummary: "What will be the Federal Reserve's interest rate change at its December meeting?", differences: [] },
    },
    watch: null,
    wallet: null,
    readAt: new Date(now).toISOString(),
  };
}

/** A live order as the engine keeps its record (`PredictionOrderRecord`), as `/live` lists it under `account.orders`. */
export function orderRecord(wallet, { quoteId = "q_live_1", state = "filled", side = "buy", spend = 10, price = 0.58, mode = "live", eventId = "ev-btc", createdAt = new Date().toISOString() } = {}) {
  const shares = Math.floor((spend / price) * 100) / 100;
  return {
    version: 1,
    wallet,
    quoteId,
    eventId,
    eventTitle: "Will Bitcoin close October above $120,000?",
    venueMarketId: `${eventId}-m`,
    question: "Will Bitcoin close October above $120,000?",
    outcomeId: `${eventId}-yes`,
    outcomeLabel: "Yes",
    side,
    requested: spend,
    review: { mode, quoteId, figures: { probability: price, shares, costUsd: spend, feesUsd: 0.03, totalUsd: spend + 0.03, payoutIfRightUsd: shares, profitIfRightUsd: shares - spend - 0.03, maxLossUsd: spend + 0.03, returnIfRightPct: null } },
    planId: null,
    planVersion: null,
    state,
    providerOrderIds: [],
    execution: null,
    providerOrders: [],
    submittedAt: createdAt,
    settledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/** `/api/predictions/outcomes/<id>/chart`: a day of five-minute bars rising from 52% to 58%. */
export function chartBody(outcomeId, now = Date.now(), { count = 288, stepMs = 5 * 60_000, from = 0.52, to = 0.58 } = {}) {
  const bars = Array.from({ length: count }, (_, i) => {
    const t = now - (count - 1 - i) * stepMs;
    const k = i / (count - 1);
    const c = Math.round((from + (to - from) * k + 0.025 * Math.sin(i / 9) * (1 - k)) * 10_000) / 10_000;
    return { t, o: c, h: c, l: c, c, v: 100 };
  });
  return { chart: { outcomeId, venue: "polymarket", resolution: "5m", bars, staleSeconds: 30, lastBarAt: bars.at(-1).t }, readAt: new Date(now).toISOString() };
}

/** `/api/predictions/live` for a wallet live trading is open to, with a linked account holding two positions. */
export function liveBody(wallet, { state = "open", linked = true, cash = 1240, positions = true, orders = [], redeemable = [], receipts = [] } = {}) {
  return {
    wallet,
    access: { state, venues: ["polymarket"], maxOrderUsd: 25, appMode: "live" },
    account:
      state === "off"
        ? null
        : {
            link: { state: linked ? "active" : "none" },
            balance: linked ? { startingBalance: 0, cashBalance: cash, positionsValue: 2791.09, realizedPnl: 0, unrealizedPnl: 0, earnings: 0 } : null,
            positions: positions && linked
              ? [
                  {
                    eventId: "ev-btc",
                    venueEventId: "v-btc",
                    question: "Bitcoin > $120K in October?",
                    image: null,
                    marketStatus: "open",
                    status: "active",
                    redeemStatus: "none",
                    resolutionDate: null,
                    outcomes: [{ label: "Yes", totalSize: 2862, avgEntryPrice: 0.4666, currentPrice: 0.58, totalValue: 1659.96, unrealizedPnl: 324.55, unrealizedPnlPercent: 24.3, winner: null, venues: [{ venue: "polymarket", size: 2862, venueMarketId: "ev-btc-m", outcomeId: "ev-btc-yes" }] }],
                  },
                  {
                    eventId: "ev-sol",
                    venueEventId: "v-sol",
                    question: "SOL reaches $300 in 2026?",
                    image: null,
                    marketStatus: "open",
                    status: "active",
                    redeemStatus: "none",
                    resolutionDate: null,
                    outcomes: [
                      {
                        label: "Yes",
                        totalSize: 1824.4,
                        avgEntryPrice: 0.52233,
                        currentPrice: 0.62,
                        totalValue: 1131.13,
                        unrealizedPnl: 178.2,
                        unrealizedPnlPercent: 18.7,
                        winner: null,
                        venues: [
                          { venue: "polymarket", size: 1200, venueMarketId: "ev-sol-m", outcomeId: "ev-sol-yes" },
                          { venue: "kalshi", size: 624.4, venueMarketId: "k-sol", outcomeId: "k-sol-yes" },
                        ],
                      },
                    ],
                  },
                ]
              : [],
            closedPositions: [],
            orders,
          },
    redeemable,
    receipts,
  };
}

/** `/api/predictions/funding` for a linked wallet with live money on. */
export function fundingBody(wallet, { enabled = true } = {}) {
  return {
    wallet,
    enabled,
    custody: { holder: "AGG", walletProvider: "Portal" },
    destination: wallet,
    limits: { withdrawMinUsd: 1, crossChainMinUsd: 2.5, bridgeFeeUsd: 0.23 },
    deposit: enabled ? { state: "ready", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", chainId: 792703809, chainName: "Solana", token: { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 } } : { state: "off" },
    balance: enabled ? { cashUsd: 1240, availableUsd: 1240, reservedUsd: 0, tokens: [], positionsUsd: 2791.09 } : null,
    deposits: [],
    withdrawals: [],
    providerFailure: null,
    readAt: new Date().toISOString(),
  };
}

/** `/api/predictions/quote` with a live Review of a buy. */
export function quoteBody(wallet, { quoteId = "q_live_1", side = "buy", spend = 10, price = 0.58, mode = "live", canPlace = true, expiresAt = new Date(Date.now() + 60_000).toISOString() } = {}) {
  const shares = Math.floor((spend / price) * 100) / 100;
  return {
    wallet,
    review: {
      mode,
      quoteId,
      event: { id: "ev-btc", title: "Will Bitcoin close October above $120,000?", endDate: null },
      market: { id: "ev-btc-m", question: "?", venue: "polymarket", resolutionDate: null, rules: { primary: null, secondary: null } },
      outcome: { id: "ev-btc-yes", label: "Yes" },
      side,
      requested: spend,
      route: { quoteId, expiresAt, quotedAt: new Date().toISOString() },
      figures: { probability: price, shares, costUsd: spend, feesUsd: 0.03, totalUsd: spend + 0.03, payoutIfRightUsd: shares, profitIfRightUsd: shares - spend - 0.03, maxLossUsd: spend + 0.03, returnIfRightPct: null },
      quote: { quotedAt: new Date().toISOString(), expiresAt, ageSeconds: 0, expired: false },
      venues: ["polymarket"],
      settlement: null,
      balance: null,
      checks: [],
      warnings: [],
      plan: null,
      canPlace,
      blockedBy: canPlace ? [] : ["balance"],
    },
    link: { state: "active" },
    order: { quoteId, state: "reviewed" },
  };
}
