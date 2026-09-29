import assert from "node:assert/strict";
import test from "node:test";

import { REFERENCE_STALE_AFTER_MS } from "../../../lib/stocks/session.ts";
import { clockOf, collect, LIQUID_FLOOR_USD, matchRows, periodTone, sortRows, STOCK_COLLECTIONS, STOCK_WORDS, stripOf, toSlimRow } from "./stock-model.ts";

/**
 * The stock surface's model: what the browser draws is a slim, honest copy
 * of the server's row; the collections and the sort answer what a person
 * pressed; every word exists in both languages.
 */

const NOW = Date.parse("2026-09-14T20:00:00.000Z");

function serverRow(overrides = {}) {
  const base = {
    representation: {
      mint: "XsMint1111111111111111111111111111111111111",
      symbol: "NVDAx",
      name: "NVIDIA xStock",
      issuer: { id: "xstocks", label: "xStocks · Backed Finance", catalogue: true },
      issuerConfirmation: "issuer-catalogue",
      underlying: { symbol: "NVDA", isin: "US67066G1040", listingCountry: "US", name: "NVIDIA" },
      exchange: { mic: "XNAS", name: "Nasdaq Stock Market", timezone: "America/New_York" },
      tokenProgram: null,
      decimals: 8,
      tradingHalted: false,
      sources: [],
    },
    market: { priceUsd: 211.38, change24hPct: 1.2, volume24hUsd: 7_700_000, liquidityUsd: 1_700_000, verified: true, observedAt: null, icon: null },
    tokenPerShareUsd: 211.02,
    multiplier: { current: 1.0017, pending: null, effectiveAt: null },
    multiplierState: "active",
    reference: { state: "current", perShare: 211.32, currency: "USD", source: { id: "issuer-xstocks", label: "xStocks · Backed Finance" }, observedAt: null, fetchedAt: new Date(NOW - 2_000).toISOString(), note: null },
    session: { period: "extended", exchangeOpen: true, nextChangeAt: "2026-09-15T00:00:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq Stock Market", timezone: "America/New_York" }, source: "issuer" },
    deviationPct: -0.14,
  };
  return { ...base, ...overrides, representation: { ...base.representation, ...(overrides.representation ?? {}) }, market: { ...base.market, ...(overrides.market ?? {}) } };
}

test("the slim row keeps the identity, the figures and the states, and judges the reference's state again at render", () => {
  const fresh = toSlimRow(serverRow(), NOW);
  assert.equal(fresh.symbol, "NVDAx");
  assert.equal(fresh.name, "NVIDIA");
  assert.equal(fresh.issuer, "xstocks");
  assert.equal(fresh.reference, 211.32);
  assert.equal(fresh.referenceState, "current");
  assert.equal(fresh.period, "extended");
  assert.equal(fresh.deviation, -0.14);
  /* Six significant digits for a price, whole dollars for a sum — the row's own precision. */
  const long = toSlimRow(serverRow({ market: { priceUsd: 211.38333215687668, volume24hUsd: 4351.4, change24hPct: 1.23456 } }), NOW);
  assert.equal(long.price, 211.383);
  assert.equal(long.volume, 4351);
  assert.equal(long.change24h, 1.23);
  /* The same row served from a shared cache six minutes later is stale, whatever the server said when it built it. */
  const later = toSlimRow(serverRow(), NOW + REFERENCE_STALE_AFTER_MS + 1);
  assert.equal(later.referenceState, "stale");
  /* An issuer without a reference is an unavailable state and a null figure, never a zero. */
  const tagOnly = toSlimRow(serverRow({ representation: { issuer: { id: "ondo", label: "Ondo Global Markets", catalogue: false } }, reference: { state: "unavailable", perShare: null, currency: "USD", source: { id: "none", label: "" }, observedAt: null, fetchedAt: null, note: null }, deviationPct: null }), NOW);
  assert.equal(tagOnly.reference, null);
  assert.equal(tagOnly.referenceState, "unavailable");
  assert.equal(tagOnly.deviation, null);
});

test("the slim row names a pending multiplier until it activates, and when the session next changes (request 26)", () => {
  const at = new Date(NOW + 3 * 86_400_000).toISOString();
  const pending = serverRow({ multiplier: { current: 1.0017, pending: 1.0021, effectiveAt: at }, multiplierState: "pending" });
  const before = toSlimRow(pending, NOW);
  assert.equal(before.multiplierPending, 1.0021);
  assert.equal(before.multiplierPendingAt, at);
  assert.equal(before.sessionNextChangeAt, "2026-09-15T00:00:00.000Z");
  /* The same cached row answered after the activation names nothing pending: the new multiplier is the one in force. */
  const after = toSlimRow(pending, Date.parse(at) + 1);
  assert.equal(after.multiplierPending, null);
  assert.equal(after.multiplierPendingAt, null);
  /* No multiplier, none pending, or a time that does not read: nothing named, never a guess. */
  for (const multiplier of [null, { current: 1, pending: null, effectiveAt: null }, { current: 1, pending: 2, effectiveAt: "soon" }]) {
    const row = toSlimRow(serverRow({ multiplier }), NOW);
    assert.equal(row.multiplierPending, null);
    assert.equal(row.multiplierPendingAt, null);
  }
  const quiet = toSlimRow(serverRow({ session: { period: "unknown", exchangeOpen: null, nextChangeAt: null, exchange: null, source: "none" } }), NOW);
  assert.equal(quiet.sessionNextChangeAt, null);
});

test("the collections order by what they say, and movers need a pool worth trading into", () => {
  const rows = [
    toSlimRow(serverRow({ representation: { mint: "A", symbol: "AAA" }, market: { volume24hUsd: 100, liquidityUsd: 50_000, change24hPct: 9 } }), NOW),
    toSlimRow(serverRow({ representation: { mint: "B", symbol: "BBB" }, market: { volume24hUsd: 300, liquidityUsd: 5_000, change24hPct: 40 } }), NOW),
    toSlimRow(serverRow({ representation: { mint: "C", symbol: "CCC" }, market: { volume24hUsd: 200, liquidityUsd: 900_000, change24hPct: -7 }, session: { period: "closed", exchangeOpen: false, nextChangeAt: null, exchange: null, source: "issuer" } }), NOW),
    toSlimRow(serverRow({ representation: { mint: "D", symbol: "DDD" }, market: { volume24hUsd: null, liquidityUsd: null, change24hPct: null } }), NOW),
  ];
  assert.deepEqual(STOCK_COLLECTIONS, ["traded", "liquid", "gainers", "losers", "preipo"]);
  /* The pre-IPO collection is a class of instrument, not an issuer: none of these listed rows is in it. */
  assert.deepEqual(collect(rows, "preipo"), []);
  assert.deepEqual(collect(rows, "traded").map((row) => row.symbol), ["BBB", "CCC", "AAA", "DDD"]);
  assert.deepEqual(collect(rows, "liquid").map((row) => row.symbol), ["CCC", "AAA", "BBB", "DDD"]);
  /* BBB is +40 % on a $5,000 pool: not a gainer a person can act on. */
  assert.ok(LIQUID_FLOOR_USD === 10_000);
  assert.deepEqual(collect(rows, "gainers").map((row) => row.symbol), ["AAA", "CCC"]);
  assert.deepEqual(collect(rows, "losers").map((row) => row.symbol), ["CCC", "AAA"]);
});

test("every header sorts, a missing figure sinks, and the deviation sorts by its size", () => {
  const rows = [
    toSlimRow(serverRow({ representation: { mint: "A", symbol: "b" }, market: { priceUsd: 10 }, deviationPct: -3 }), NOW),
    toSlimRow(serverRow({ representation: { mint: "B", symbol: "a" }, market: { priceUsd: null }, deviationPct: 0.5 }), NOW),
    toSlimRow(serverRow({ representation: { mint: "C", symbol: "c" }, market: { priceUsd: 30 }, deviationPct: null }), NOW),
  ];
  assert.deepEqual(sortRows(rows, "symbol", "asc").map((row) => row.symbol), ["a", "b", "c"]);
  assert.deepEqual(sortRows(rows, "price", "desc").map((row) => row.symbol), ["c", "b", "a"]);
  assert.deepEqual(sortRows(rows, "deviation", "desc").map((row) => row.symbol), ["b", "a", "c"]);
  assert.deepEqual(sortRows(rows, "session", "desc").map((row) => row.period), ["extended", "extended", "extended"]);
});

test("search matches the ticker first, then the company, and never asks a provider", () => {
  const rows = [
    toSlimRow(serverRow({ representation: { mint: "A", symbol: "NVDAx", underlying: { symbol: "NVDA", isin: null, listingCountry: null, name: "NVIDIA" } } }), NOW),
    toSlimRow(serverRow({ representation: { mint: "B", symbol: "NVDAon", underlying: { symbol: "NVDA", isin: null, listingCountry: null, name: "NVIDIA" } }, market: { volume24hUsd: 10 } }), NOW),
    toSlimRow(serverRow({ representation: { mint: "C", symbol: "AAPLx", underlying: { symbol: "AAPL", isin: null, listingCountry: null, name: "Apple" } } }), NOW),
  ];
  assert.deepEqual(matchRows(rows, "nvda").map((row) => row.symbol), ["NVDAx", "NVDAon"]);
  assert.deepEqual(matchRows(rows, "apple").map((row) => row.symbol), ["AAPLx"]);
  assert.deepEqual(matchRows(rows, "C").map((row) => row.symbol), ["AAPLx"]);
  assert.equal(matchRows(rows, "zzz").length, 0);
  assert.equal(matchRows(rows, "   ").length, 3);
});

test("the strip counts the venue's rows and takes the session from the issuer with a calendar", () => {
  const rows = [
    serverRow({ representation: { mint: "A" }, market: { volume24hUsd: 100, liquidityUsd: 1_000 } }),
    serverRow({ representation: { mint: "B", issuer: { id: "backpack", label: "Backpack Securities", catalogue: false } }, market: { volume24hUsd: 0, liquidityUsd: 500 }, session: { period: "unknown", exchangeOpen: null, nextChangeAt: null, exchange: null, source: "none" } }),
    serverRow({ representation: { mint: "C", issuer: { id: "ondo", label: "Ondo Global Markets", catalogue: false } }, market: { volume24hUsd: null, liquidityUsd: null }, session: { period: "closed", exchangeOpen: false, nextChangeAt: null, exchange: null, source: "feed-catalogue" } }),
  ];
  const strip = stripOf({ rows, marketsObservedAt: "", issuerCatalogue: { ok: true, reason: null }, fetchedAt: "2026-09-14T20:23:00.000Z" });
  assert.equal(strip.listed, 3);
  assert.equal(strip.issuers, 3);
  assert.equal(strip.tradedToday, 1);
  assert.equal(strip.volumeUsd, 100);
  assert.equal(strip.liquidityUsd, 1_500);
  /* Ondo's feed-calendar "closed" does not outvote the issuer's own "extended": the session is the catalogued issuer's word. */
  assert.equal(strip.session.period, "extended");
  assert.equal(strip.session.nextChangeAt, "2026-09-15T00:00:00.000Z");
  assert.equal(clockOf(strip.fetchedAt, "en"), "20:23");
  assert.equal(clockOf(null, "uk"), null);
});

test("the session tone is a state, never a caution, and every word exists in both languages", () => {
  assert.equal(periodTone("market"), "open");
  assert.equal(periodTone("extended"), "extended");
  assert.equal(periodTone("overnight"), "extended");
  assert.equal(periodTone("closed"), "closed");
  assert.equal(periodTone("unknown"), null);
  for (const [key, pair] of Object.entries(STOCK_WORDS)) {
    assert.ok(pair.en.trim().length > 0, `${key} has English`);
    assert.ok(pair.uk.trim().length > 0, `${key} has Ukrainian`);
  }
  /* The surface never calls itself unfinished and never narrates a source at rest. */
  assert.ok(!Object.values(STOCK_WORDS).some((pair) => /being built|under construction/i.test(pair.en)));
});

test("an issuer reference that did not arrive is unavailable right now, never «publishes none»", async () => {
  /* Seen on production 2026-09-23 11:45 UTC: SPYx's xStocks reference timed out and the page said the issuer publishes no reference. */
  const { readFileSync } = await import("node:fs");
  /* The Market card moved out of the page into the cards both depths share (RYN-INVEST-SIMPLE-001, session 2). */
  const page = readFileSync(new URL("./[ticker]/asset-facts.tsx", import.meta.url), "utf8");
  const outage = page.indexOf('row.reference.source.id === "issuer-xstocks"');
  const none = page.indexOf("the issuer publishes no reference");
  assert.ok(outage > 0 && none > outage, "the xStocks branch is decided before the no-reference words");
  assert.match(page.slice(outage, none), /the issuer's reference is unavailable right now/);
  assert.match(page.slice(outage, none), /референс емітента зараз недоступний/);
});
