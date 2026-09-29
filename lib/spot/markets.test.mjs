import assert from "node:assert/strict";
import test from "node:test";

import { categoryOfTags, issuerOfTags, marketAgeDays, normalizeSpotMarket, rankMarkets, rankSearch, toListRow, tradingAvailability } from "./markets.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const FART = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const COPY = "Dn8CGUZr61mBJK1qqhvM7RKL6CvwXnABHrJuiDRspump";

/* Recorded from Jupiter Tokens V2 on 2026-09-11, trimmed to the fields read. */
function row(overrides) {
  return {
    id: SOL,
    name: "Wrapped SOL",
    symbol: "SOL",
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    decimals: 9,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    firstPool: { id: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", createdAt: "2021-03-29T10:05:48Z" },
    holderCount: 3820000,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 1.24 },
    organicScore: 98.9,
    organicScoreLabel: "high",
    isVerified: true,
    tags: ["community", "strict", "verified", "major"],
    fdv: 87824499429.2,
    mcap: 58400000000,
    usdPrice: 99.61,
    liquidity: 830100000,
    stats1h: { priceChange: -0.25, buyVolume: 100, sellVolume: 50 },
    stats24h: { priceChange: -1.46, buyVolume: 3000000000, sellVolume: 3100000000, numBuys: 15, numSells: 17, numTraders: 754618 },
    website: "https://solana.com",
    updatedAt: "2026-09-11T05:02:21.034Z",
    ...overrides,
  };
}

test("a Tokens V2 row becomes one market with the provider's own figures and nothing invented", () => {
  const market = normalizeSpotMarket(row());
  assert.ok(market);
  assert.equal(market.symbol, "SOL");
  assert.equal(market.price, 99.61);
  assert.equal(market.change24hPct, -1.46);
  assert.equal(market.change1hPct, -0.25);
  assert.equal(market.volume24hUsd, 6100000000, "volume is buys plus sells");
  assert.equal(market.liquidityUsd, 830100000);
  assert.equal(market.holders, 3820000);
  assert.equal(market.verified, true);
  assert.equal(market.category, "crypto");
  assert.equal(market.issuer, null);
  assert.equal(market.firstPoolAt, "2021-03-29T10:05:48.000Z");
  assert.equal(market.audit.topHoldersPct, 1.24);
  assert.equal(market.links.website, "https://solana.com/");
  assert.equal(market.links.twitter, null);
});

test("a stat the provider did not state is null, never zero; an unpriced token has no price", () => {
  const market = normalizeSpotMarket(row({ usdPrice: undefined, liquidity: undefined, stats24h: undefined, holderCount: "many", mcap: Number.NaN }));
  assert.equal(market.price, null);
  assert.equal(market.liquidityUsd, null);
  assert.equal(market.volume24hUsd, null);
  assert.equal(market.change24hPct, null);
  assert.equal(market.holders, null);
  assert.equal(market.marketCapUsd, null);
});

test("verification is a fact about Jupiter's list: absent means not verified, never unknown", () => {
  assert.equal(normalizeSpotMarket(row({ id: COPY, isVerified: undefined, tags: ["unknown"] })).verified, false);
  assert.equal(normalizeSpotMarket(row({ isVerified: undefined, tags: ["verified"] })).verified, true);
});

test("the category comes from Jupiter's tags: a stock tag wins, then meme, then verified crypto, else none", () => {
  assert.equal(categoryOfTags(["verified", "xstocks", "stocks", "rwa", "equities", "token-2022"]), "stock");
  assert.equal(categoryOfTags(["verified", "meme", "community"]), "meme");
  assert.equal(categoryOfTags(["meme", "stocks"]), "stock", "the issuer's classification wins over the community one");
  assert.equal(categoryOfTags(["verified", "defi"]), "crypto");
  assert.equal(categoryOfTags(["unknown", "token-2022"]), null, "an unclassified token is not called crypto by default");
  assert.deepEqual(issuerOfTags(["xstocks", "stocks"]), { label: "xStocks · Backed Finance", tag: "xstocks" });
  assert.deepEqual(issuerOfTags(["ondo", "stocks", "rwa"]), { label: "Ondo Global Markets", tag: "ondo" });
  assert.equal(issuerOfTags(["stocks", "rwa"]), null, "a stock tag alone names no issuer");
});

test("a row without identity or with a malformed mint is dropped", () => {
  assert.equal(normalizeSpotMarket(row({ symbol: undefined, name: undefined })), null);
  assert.equal(normalizeSpotMarket(row({ id: "not-a-mint" })), null);
  assert.equal(normalizeSpotMarket(null), null);
  assert.equal(normalizeSpotMarket("x"), null);
});

test("links are kept only as http(s) URLs and icons only as URLs", () => {
  const market = normalizeSpotMarket(row({ website: "javascript:alert(1)", twitter: "https://x.com/solana", icon: "ipfs://abc" }));
  assert.equal(market.links.website, null);
  assert.equal(market.links.twitter, "https://x.com/solana");
  assert.equal(market.icon, null);
});

function market(overrides) {
  return normalizeSpotMarket(row(overrides));
}

test("a view ranks by volume within its category, sinks stablecoins, dedupes by mint and keeps unpriced rows last", () => {
  const rows = [
    market({ id: USDC, symbol: "USDC", tags: ["verified", "stable"], stats24h: { buyVolume: 5e9, sellVolume: 5e9 } }),
    market(),
    market({ id: FART, symbol: "Fartcoin", tags: ["verified", "meme"], stats24h: { buyVolume: 1e6, sellVolume: 1e6 } }),
    market({ id: NVDAX, symbol: "NVDAx", tags: ["verified", "xstocks", "stocks"], stats24h: { buyVolume: 6e6, sellVolume: 6e6 } }),
    market(),
    market({ id: COPY, symbol: "NVDAx", isVerified: undefined, tags: ["unknown"], stats24h: undefined, usdPrice: undefined }),
  ];
  const all = rankMarkets(rows, "all", 10);
  assert.deepEqual(all.map((entry) => entry.symbol), ["SOL", "NVDAx", "Fartcoin", "NVDAx", "USDC"], "SOL once, the stable last, the unpriced copy before it");
  assert.deepEqual(rankMarkets(rows, "meme", 10).map((entry) => entry.mint), [FART]);
  assert.deepEqual(rankMarkets(rows, "stock", 10).map((entry) => entry.mint), [NVDAX]);
  assert.deepEqual(rankMarkets(rows, "crypto", 10).map((entry) => entry.symbol), ["SOL", "USDC"]);
  assert.equal(rankMarkets(rows, "all", 2).length, 2);
});

test("search puts the exact verified ticker first and keeps the copies, labelled by their own row", () => {
  const rows = [
    market({ id: COPY, symbol: "NVDAx", isVerified: undefined, tags: ["unknown"], liquidity: 3108 }),
    market({ id: NVDAX, symbol: "NVDAx", tags: ["verified", "xstocks", "stocks"], liquidity: 1771008 }),
    market({ id: FART, symbol: "NVDA", name: "$NVDAx", isVerified: undefined, tags: ["unknown"], audit: { isSus: true } }),
  ];
  const ranked = rankSearch(rows, "nvdax", 10);
  assert.equal(ranked[0].mint, NVDAX);
  assert.equal(ranked[0].verified, true);
  assert.equal(ranked.length, 3, "nothing is dropped");
  assert.equal(ranked[1].mint, COPY);
  assert.equal(ranked[2].suspicious, true, "the flagged copy sinks below the plain one");
});

test("the list row is a projection of the market, and age counts whole days from the first pool", () => {
  const entry = market();
  const listed = toListRow(entry);
  assert.deepEqual(Object.keys(listed).sort(), ["category", "change24hPct", "decimals", "icon", "issuer", "liquidityUsd", "mint", "name", "price", "suspicious", "symbol", "tokenProgram", "verified", "volume24hUsd"]);
  assert.equal(marketAgeDays(entry, Date.parse("2021-04-01T10:05:48Z")), 3);
  assert.equal(marketAgeDays({ firstPoolAt: null }, Date.now()), null);
  assert.equal(marketAgeDays({ firstPoolAt: "2999-01-01T00:00:00Z" }, Date.now()), null, "a pool from the future is not an age");
});

test("every market trades; a tokenized stock carries the issuer-terms notice, nothing else does", () => {
  /* Owner decision 2026-09-12: every market in the terminal trades; the
     2026-09-11 *not yet* for the whole stock category is withdrawn. The
     notice is the one fact the chain does not carry — whose terms apply. */
  assert.deepEqual(tradingAvailability({ category: "stock" }), { allowed: true, notice: "ISSUER_TERMS" });
  assert.deepEqual(tradingAvailability({ category: "crypto" }), { allowed: true, notice: null });
  assert.deepEqual(tradingAvailability({ category: "meme" }), { allowed: true, notice: null });
  assert.deepEqual(tradingAvailability({ category: null }), { allowed: true, notice: null }, "an unclassified token is not a stock");
  assert.deepEqual(tradingAvailability({ category: normalizeSpotMarket(row({ id: NVDAX, tags: ["verified", "xstocks", "stocks"] })).category }), { allowed: true, notice: "ISSUER_TERMS" });
});

test("every market, list row and list answer the routes serve is the contract's shape on the wire (1.11.0)", async () => {
  const { SpotMarketListRowSchema, SpotMarketResponseSchema, SpotMarketSchema, SpotMarketsResponseSchema } = await import("../api/v1/contract.ts");
  const wire = (value) => JSON.parse(JSON.stringify(value));
  const markets = [
    normalizeSpotMarket(row()),
    normalizeSpotMarket(row({ id: NVDAX, symbol: "NVDAx", name: "NVIDIA xStock", tags: ["verified", "xstocks", "stocks"] })),
    normalizeSpotMarket(row({ id: FART, symbol: "Fartcoin", name: "Fartcoin", tags: ["meme"], isVerified: undefined, audit: { isSus: true }, website: "not a url", firstPool: null, updatedAt: "garbage" })),
    normalizeSpotMarket({ id: COPY, symbol: "NVDAx" }),
  ];
  for (const market of markets) {
    assert.notEqual(market, null);
    assert.equal(SpotMarketSchema.safeParse(wire(market)).success, true, market.symbol);
    assert.equal(SpotMarketListRowSchema.safeParse(wire(toListRow(market))).success, true, market.symbol);
  }
  const observedAt = "2026-09-11T05:02:21.034Z";
  const source = { label: "Jupiter Tokens API, lite tier", tier: "lite" };
  const rows = rankMarkets(markets, "all", 150);
  assert.equal(SpotMarketsResponseSchema.safeParse(wire({ rows, observedAt, stale: false, partial: false, source })).success, true);
  assert.equal(SpotMarketsResponseSchema.safeParse(wire({ rows: rankSearch(markets, "nvda", 40), observedAt, stale: true, source })).success, true);
  assert.equal(SpotMarketsResponseSchema.safeParse(wire({ rows: [toListRow(markets[0])], missing: ["11111111111111111111111111111111"], observedAt, stale: false })).success, true);
  assert.equal(SpotMarketResponseSchema.safeParse(wire({ market: markets[1], observedAt, stale: false })).success, true);
  assert.equal(SpotMarketResponseSchema.safeParse(wire({ market: null, observedAt, stale: false })).success, true, "not listed is an answer");
});
