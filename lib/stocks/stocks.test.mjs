import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVATION_WINDOW_MS, baseAmountString, deviationPct, multiplierFromChain, multiplierFromMint, multiplierRatio, multiplierState, perShareExecutable, perShareFromTokenPrice, scaledAmountString } from "./units.ts";
import { REFERENCE_STALE_AFTER_MS, referenceState, sessionFromIssuer, UNKNOWN_SESSION } from "./session.ts";
import { buildRepresentation, indexIssuerAssets, issuerFromTags, matchesTicker, underlyingNameFrom, underlyingNameFromTokenName, underlyingSymbolFromToken } from "./representations.ts";
import { normalizeXStocksAsset, normalizeXStocksReserve } from "./issuer-xstocks.server.ts";

/**
 * Units are security (canon v4.0 §7.6): the raw balance never moves on a
 * corporate event, the multiplier changes what it means, and no function
 * applies it twice.
 */

test("a multiplier becomes an exact ratio, and a scaled amount is integer arithmetic on the raw balance", () => {
  assert.deepEqual(multiplierRatio(1), { num: 1n, den: 1n });
  assert.deepEqual(multiplierRatio(4.4), { num: 22n, den: 5n });
  assert.deepEqual(multiplierRatio(0.5), { num: 1n, den: 2n });
  /* NVDAx on 2026-09-14: 1.001701196801074 — fifteen significant digits, exact thereafter. */
  const ratio = multiplierRatio(1.001701196801074);
  assert.equal(Number(ratio.num) / Number(ratio.den), 1.00170119680107);
  assert.throws(() => multiplierRatio(0), /positive finite/);
  assert.throws(() => multiplierRatio(Number.NaN), /positive finite/);

  /* 1 token with 8 decimals: raw 100000000. */
  assert.equal(baseAmountString(100_000_000n, 8), "1.000000");
  assert.equal(scaledAmountString(100_000_000n, 8, 1), "1.000000");
  assert.equal(scaledAmountString(100_000_000n, 8, 1.1), "1.100000");
  assert.equal(scaledAmountString(100_000_000n, 8, 4.4), "4.400000");
  assert.equal(scaledAmountString(100_000_000n, 8, 2.2), "2.200000");
  /* Truncation toward zero, never rounding up a balance. */
  assert.equal(scaledAmountString(1n, 8, 1.5, 6), "0.000000");
  assert.equal(scaledAmountString(123_456_789n, 8, 1.001701196801074, 6), "1.236668");
  assert.throws(() => scaledAmountString(-1n, 8, 1), /negative/);
});

test("the multiplier's state answers active, pending or activation window from the issuer's timestamps", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  assert.equal(multiplierState({ current: 1.1, pending: null, effectiveAt: null }, now), "active");
  assert.equal(multiplierState({ current: 1.1, pending: 4.4, effectiveAt: "2026-09-15T00:30:00Z" }, now), "pending");
  assert.equal(multiplierState({ current: 1.1, pending: 4.4, effectiveAt: new Date(now + ACTIVATION_WINDOW_MS - 1).toISOString() }, now), "activation-window");
  assert.equal(multiplierState({ current: 1.1, pending: 4.4, effectiveAt: new Date(now - ACTIVATION_WINDOW_MS + 1).toISOString() }, now), "activation-window");
  /* Past the window, the issuer's current multiplier is the one in force. */
  assert.equal(multiplierState({ current: 4.4, pending: 4.4, effectiveAt: new Date(now - ACTIVATION_WINDOW_MS - 1).toISOString() }, now), "active");
  assert.equal(multiplierState({ current: 1.1, pending: 4.4, effectiveAt: "not a date" }, now), "pending");
});

test("the chain's two multipliers become one, decided by the clock", () => {
  /* NVDAx as read on 2026-09-14: the old field 1.00091807…, the new 1.00170119… effective 2026-09-10. */
  const scaled = { multiplier: 1.0009180758490996, newMultiplier: 1.001701196801074, newMultiplierEffectiveAt: "2026-09-10T00:30:00.000Z" };
  const after = multiplierFromChain(scaled, Date.parse("2026-09-14T19:00:00Z"));
  assert.deepEqual(after, { current: 1.001701196801074, pending: null, effectiveAt: null }, "past the activation the new multiplier is the one in force");
  const before = multiplierFromChain(scaled, Date.parse("2026-09-09T12:00:00Z"));
  assert.deepEqual(before, { current: 1.0009180758490996, pending: 1.001701196801074, effectiveAt: "2026-09-10T00:30:00.000Z" });
  assert.equal(multiplierState(before, Date.parse("2026-09-10T00:20:00Z")), "activation-window");
  assert.deepEqual(multiplierFromChain({ multiplier: 1, newMultiplier: 0, newMultiplierEffectiveAt: null }, 0), { current: 1, pending: null, effectiveAt: null });
  /* A mint without the extension is one-to-one by the chain's own statement; an unread mint stays unknown. */
  assert.deepEqual(multiplierFromMint({ scaledUi: null }, 0), { current: 1, pending: null, effectiveAt: null });
  assert.deepEqual(multiplierFromMint({ scaledUi: scaled }, Date.parse("2026-09-14T19:00:00Z")), { current: 1.001701196801074, pending: null, effectiveAt: null });
  assert.equal(multiplierFromMint(null, 0), null);
});

test("per-share prices and the §7.5 deviation compare like with like, or refuse", () => {
  /* A token that trades at $212.33 and stands for 1.0017 shares is a share at $211.97. */
  const perShare = perShareFromTokenPrice(212.33, 1.001701196801074);
  assert.ok(perShare !== null && Math.abs(perShare - 211.9694) < 0.001);
  assert.equal(perShareFromTokenPrice(0, 1), null);
  assert.equal(perShareFromTokenPrice(1, 0), null);
  /* $1,000 buys 4.700000 underlying units → $212.77 per share. */
  const executable = perShareExecutable(1000, "4.700000");
  assert.ok(executable !== null && Math.abs(executable - 212.7659) < 0.001);
  assert.equal(perShareExecutable(1000, "0.000000"), null);
  assert.equal(perShareExecutable(0, "1"), null);
  /* (212.77 / 211.97 − 1) × 100 ≈ +0.376 %. */
  const deviation = deviationPct(executable, perShare);
  assert.ok(deviation !== null && Math.abs(deviation - 0.3757) < 0.001);
  assert.equal(deviationPct(null, 1), null);
  assert.equal(deviationPct(1, null), null);
  assert.equal(deviationPct(1, 0), null);
  /* The multiplier is never applied twice: the reference is per share already. */
  assert.equal(deviationPct(perShareFromTokenPrice(100, 2), 50), 0);
});

/** Canon §7.4: five reference states, and the session promotes none of them. */
test("a reference is current only when fetched recently with the exchange open; closed means last available; old means stale", () => {
  const now = Date.parse("2026-09-14T15:00:00Z");
  const fresh = new Date(now - 10_000).toISOString();
  const old = new Date(now - REFERENCE_STALE_AFTER_MS - 1).toISOString();
  assert.equal(referenceState({ perShare: 212, fetchedAt: fresh, exchangeOpen: true, nowMs: now }), "current");
  assert.equal(referenceState({ perShare: 212, fetchedAt: fresh, exchangeOpen: false, nowMs: now }), "last-available");
  assert.equal(referenceState({ perShare: 212, fetchedAt: fresh, exchangeOpen: null, nowMs: now }), "last-available");
  assert.equal(referenceState({ perShare: 212, fetchedAt: old, exchangeOpen: true, nowMs: now }), "stale");
  assert.equal(referenceState({ perShare: null, fetchedAt: fresh, exchangeOpen: true, nowMs: now }), "unavailable");
  assert.equal(referenceState({ perShare: 212, fetchedAt: null, exchangeOpen: true, nowMs: now }), "stale");
  /* No function here produces `confirmed-close`: only a source that states an official close may. */
});

test("the session comes from the issuer's own period words, never from a weekday rule", () => {
  assert.deepEqual(sessionFromIssuer(null), UNKNOWN_SESSION);
  const session = sessionFromIssuer({ currentPeriod: "closed", openNow: false, nextChangeAt: "2026-09-15T13:30:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq Stock Market", timezone: "America/New_York" } });
  assert.equal(session.period, "closed");
  assert.equal(session.exchangeOpen, false);
  assert.equal(session.source, "issuer");
  assert.equal(sessionFromIssuer({ currentPeriod: "lunch", openNow: null, nextChangeAt: null, exchange: null }).period, "unknown");
});

/** Canon §7.1 / §7.7: a symbol is never an identity. */
const market = (over = {}) => ({
  mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  symbol: "NVDAx",
  name: "NVIDIA xStock",
  icon: null,
  decimals: 8,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  price: 212.33,
  change24hPct: -1.6,
  change1hPct: null,
  volume24hUsd: 8_800_000,
  liquidityUsd: 1_700_000,
  marketCapUsd: null,
  fdvUsd: null,
  holders: null,
  organicScore: null,
  organicScoreLabel: null,
  verified: true,
  tags: ["verified", "xstocks", "stocks"],
  category: "stock",
  issuer: { label: "xStocks · Backed Finance", tag: "xstocks" },
  firstPoolAt: null,
  audit: { mintAuthorityDisabled: null, freezeAuthorityDisabled: null, topHoldersPct: null, devBalancePct: null, suspicious: false },
  links: { website: null, twitter: null, telegram: null },
  stats: { h1: {}, h24: {} },
  updatedAt: null,
  ...over,
});

const issuerAsset = {
  symbol: "NVDAx",
  name: "NVIDIA xStock",
  isin: "CH1436219195",
  underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US" },
  solanaMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  tradingHalted: false,
  trading: { currency: "USD", currentPeriod: "market", openNow: true, nextChangeAt: "2026-09-14T20:00:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq Stock Market", timezone: "America/New_York" } },
  logo: null,
};

test("a representation needs the venue's verification and, for a catalogued issuer, the issuer's own mint", () => {
  assert.equal(issuerFromTags(["verified", "xstocks"]), "xstocks");
  assert.equal(issuerFromTags(["verified", "backpack", "stocks"]), "backpack");
  /* `pre-ipo` is a class of instrument, not an issuer: alone it names nobody; each pre-IPO issuer has its own tag. */
  assert.equal(issuerFromTags(["pre-ipo"]), null);
  assert.equal(issuerFromTags(["verified", "stocks", "pre-ipo", "prestocks"]), "prestocks");
  /* Private companies come through PreStocks only (canon v5.2 В26): the disconnected issuer's tag names nobody. */
  assert.equal(issuerFromTags(["verified", "stocks", "rwa", "tessera"]), null);
  assert.equal(issuerFromTags(["verified", "meme"]), null);

  const confirmed = buildRepresentation(market(), issuerAsset);
  assert.ok(confirmed);
  assert.equal(confirmed.issuerConfirmation, "issuer-catalogue");
  assert.equal(confirmed.underlying.symbol, "NVDA");
  assert.equal(confirmed.underlying.name, "NVIDIA");
  assert.equal(confirmed.exchange.mic, "XNAS");
  assert.deepEqual(confirmed.sources, ["jupiter-verified", "xstocks-public-api"]);

  /* The look-alike: same symbol, another mint, not on the issuer's list. */
  assert.equal(buildRepresentation(market({ mint: "So11111111111111111111111111111111111111112" }), issuerAsset), null, "a copy that borrows a symbol is not a representation");
  assert.equal(buildRepresentation(market(), null), null, "an xStock the issuer does not list is not a representation");
  assert.equal(buildRepresentation(market({ verified: false }), issuerAsset), null, "an unverified token is not a representation");
  assert.equal(buildRepresentation(market({ tags: ["verified"], category: "crypto", issuer: null }), issuerAsset), null, "a token without an issuer tag is not a stock");

  /* A tag-only issuer: known by the venue's tag, honest about it. */
  const backpack = buildRepresentation(market({ mint: "2vbzRwqjiqBpo8WXEcyvKUmbyCxMLrZXPqFQRAFkYqzM", symbol: "SCHH", name: "Schwab U.S. REIT ETF - Backpack Securities", tags: ["verified", "backpack", "stocks"], issuer: { label: "Backpack Securities", tag: "backpack" } }), null);
  assert.ok(backpack);
  assert.equal(backpack.issuerConfirmation, "tag-only");
  assert.equal(backpack.issuer.id, "backpack");
  assert.equal(backpack.exchange, null);
  assert.equal(backpack.tradingHalted, null);
  assert.equal(backpack.underlying.symbol, "SCHH");
  assert.equal(backpack.underlying.name, "Schwab U.S. REIT ETF", "the issuer suffix leaves the company name");
  assert.equal(underlyingNameFromTokenName("Nike - Backpack Securities", "backpack"), "Nike");
  assert.equal(underlyingNameFromTokenName("Anthropic PreStocks", "prestocks"), "Anthropic");
  assert.equal(underlyingNameFromTokenName("Meta Platforms (Ondo Tokenized)", "ondo"), "Meta Platforms");
  assert.equal(underlyingNameFromTokenName("Nike", "backpack"), null, "a name without the suffix implies nothing new");

  assert.equal(underlyingNameFrom("NVIDIA xStock"), "NVIDIA");
  assert.equal(underlyingNameFrom("xStock"), null);
  assert.equal(underlyingSymbolFromToken("SPYx", "xstocks"), "SPY");
  assert.equal(underlyingSymbolFromToken("NKE", "backpack"), "NKE");
  assert.equal(underlyingSymbolFromToken("METAon", "ondo"), "META", "Ondo's suffix comes off the same way xStocks' does");
  assert.equal(underlyingSymbolFromToken("ANTHROPIC", "prestocks"), "ANTHROPIC");
  assert.ok(matchesTicker(confirmed, "nvdax"));
  assert.ok(matchesTicker(confirmed, confirmed.mint));
  assert.ok(!matchesTicker(confirmed, "NVDA"));
  assert.equal(indexIssuerAssets([issuerAsset]).get(issuerAsset.solanaMint), issuerAsset);
});

test("the issuer's catalogue node is reduced to what Ryntra keeps, and a node without a Solana deployment is dropped", () => {
  const node = {
    id: "0997ed45", name: "NVIDIA xStock", symbol: "NVDAx", isin: "CH1436219195", underlyingSymbol: "NVDA", underlyingIsin: "US67066G1040",
    underlying: { symbol: "NVDA", isin: "US67066G1040", type: null, listingCountry: "US" }, logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png", isTradingHalted: false,
    trading: { currency: "USD", tradingHoursMode: "TwentyFourFive", isTradingHalted: false, currentPeriod: "market", openNow: true, nextChangeAt: "2026-09-14T20:00:00.000Z", exchange: { mic: "XNAS", abbreviation: "NASDAQ", name: "Nasdaq Stock Market", timezone: "America/New_York" } },
    deployments: [{ address: "0x19b7680118fd54b8d52ef922afb3bbb13e3ad47f", network: "Arbitrum" }, { address: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", network: "Solana", supportsAtomicSwaps: true }],
  };
  const asset = normalizeXStocksAsset(node);
  assert.ok(asset);
  assert.equal(asset.solanaMint, "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
  assert.equal(asset.trading.exchange.timezone, "America/New_York");
  assert.equal(asset.trading.currentPeriod, "market");
  assert.equal(normalizeXStocksAsset({ ...node, deployments: [{ address: "0x1", network: "Ethereum" }] }), null);
  assert.equal(normalizeXStocksAsset({ ...node, symbol: "" }), null);
  assert.equal(normalizeXStocksAsset("nonsense"), null);
  const reserve = normalizeXStocksReserve({ symbol: "NVDAx", timestamp: "2026-09-14T19:20:41.349Z", sharesHeld: "184799.24989831", circulatingSupply: "184479.18760803728588", holdings: [{ provider: "Alpaca", quantity: "184799.24989831", symbol: "NVDA" }] });
  assert.deepEqual(reserve, { symbol: "NVDAx", sharesHeld: "184799.24989831", circulatingSupply: "184479.18760803728588", observedAt: "2026-09-14T19:20:41.349Z", custodians: ["Alpaca"] });
  assert.equal(normalizeXStocksReserve({ symbol: "NVDAx" }), null);
});

test("a scaled-unit amount a person types becomes the raw base amount behind it, exactly, and a multiplier of one changes nothing", async () => {
  const { rawFromScaledRaw, isScaledMultiplier } = await import("./units.ts");
  /* NFLXx at ×10, eight decimals: 1.3 tokens as the wallet shows them = 0.13 base tokens = 13,000,000 raw. */
  assert.equal(rawFromScaledRaw(130_000_000n, 10), 13_000_000n);
  /* OPENAI at ×1.4861347, nine decimals: 1.028405 scaled = 691,999,857 raw (truncated toward zero). */
  assert.equal(rawFromScaledRaw(1_028_405_000n, 1.4861347), 691_999_857n);
  assert.equal(rawFromScaledRaw(123_456n, 1), 123_456n);
  assert.equal(rawFromScaledRaw(0n, 5), 0n);
  assert.throws(() => rawFromScaledRaw(-1n, 5));
  /* The round trip truncates toward zero on both legs: never a unit more than the person typed. */
  assert.equal(scaledAmountString(rawFromScaledRaw(1_028_405_000n, 1.4861347), 9, 1.4861347, 6), "1.028404");
  assert.equal(scaledAmountString(rawFromScaledRaw(130_000_000n, 10), 8, 10, 6), "1.300000");
  assert.equal(isScaledMultiplier(1), false);
  assert.equal(isScaledMultiplier(null), false);
  assert.equal(isScaledMultiplier(1.0000000001), false);
  assert.equal(isScaledMultiplier(1.001701), true);
  assert.equal(isScaledMultiplier(10), true);
});
