import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { resetEpochCache, resetOnchainMintCache } from "./asset.server.ts";
import { peekXStocksQuote, QUOTE_BREAKER_OPEN_MS, QUOTE_BREAKER_THRESHOLD, QUOTE_TIMEOUT_MS, readXStocksQuote, resetXStocksCaches, xstocksQuoteCircuit } from "./issuer-xstocks.server.ts";
import { resetPythCaches } from "./pyth.server.ts";
import { ISSUER_INSTRUMENT, STOCK_ISSUERS } from "./representations.ts";
import { buildStockRow, buildStockUniverse } from "./universe.server.ts";

/**
 * On 2026-09-19/20 the issuer's `price-data` endpoint stopped answering
 * while the rest of its API stayed up; the universe asked it once per xStocks
 * row and a cold build took 106 s, so every stock page,
 * `/api/stocks/universe` and `/stats` answered 504. These tests pin the two
 * guards: the quote circuit in the adapter and the build's own time budget
 * for the issuers' references. Nothing here invents a price — a reference
 * that did not arrive is stated as unavailable, with the reason — and
 * nothing in the execution path is touched.
 */

const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const NOW = new Date(T0).toISOString();
const realFetch = globalThis.fetch;
const silence = () => Promise.reject(new Error("The operation was aborted due to timeout"));
const answer = (quote) => async () => new Response(JSON.stringify({ quote }), { status: 200, headers: { "content-type": "application/json" } });
const status = (code) => async () => new Response("issuer", { status: code });

beforeEach(() => {
  resetXStocksCaches();
  resetOnchainMintCache();
  resetEpochCache();
  resetPythCaches();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("1 · after three silences in a row the issuer is not asked again for a minute; the refusal is immediate, named, and never cached", async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; return silence(); };
  for (let i = 0; i < QUOTE_BREAKER_THRESHOLD; i += 1) {
    const read = await readXStocksQuote(`S${i}x`, { fetchImpl, now: () => new Date(T0) });
    assert.equal(read.ok, false);
    assert.equal(read.code, "NETWORK");
  }
  assert.equal(calls, QUOTE_BREAKER_THRESHOLD);
  assert.equal(xstocksQuoteCircuit(T0), "open");
  const refused = await readXStocksQuote("NVDAx", { fetchImpl, now: () => new Date(T0 + 1_000) });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /has not answered several times in a row/);
  assert.equal(calls, QUOTE_BREAKER_THRESHOLD, "an open circuit asks nothing");
  assert.equal(peekXStocksQuote("NVDAx", T0 + 1_000), null, "the circuit's own refusal is not the issuer's answer and is not cached");
});

test("2 · after the window one probe goes through; its answer closes the circuit, and a fresh cached quote is served while it is open", async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; return silence(); };
  for (let i = 0; i < QUOTE_BREAKER_THRESHOLD; i += 1) await readXStocksQuote(`S${i}x`, { fetchImpl, now: () => new Date(T0) });
  assert.equal(xstocksQuoteCircuit(T0 + QUOTE_BREAKER_OPEN_MS - 1), "open");
  assert.equal(xstocksQuoteCircuit(T0 + QUOTE_BREAKER_OPEN_MS), "half-open");
  /* A quote read before the outage is still served from the cache. */
  resetXStocksCaches();
  const priced = await readXStocksQuote("NVDAx", { fetchImpl: answer(212.5), now: () => new Date(T0) });
  assert.equal(priced.ok, true);
  for (let i = 0; i < QUOTE_BREAKER_THRESHOLD; i += 1) await readXStocksQuote(`S${i}x`, { fetchImpl, now: () => new Date(T0) });
  assert.equal(xstocksQuoteCircuit(T0), "open");
  const cachedRead = await readXStocksQuote("NVDAx", { fetchImpl, now: () => new Date(T0 + 5_000) });
  assert.equal(cachedRead.ok, true);
  assert.equal(cachedRead.quote, 212.5, "a fresh cached quote stands whatever the circuit says");
  /* The window passes: one probe is asked, it answers, the circuit closes. */
  const probeCalls = calls;
  const probe = await readXStocksQuote("AAPLx", { fetchImpl: answer(250), now: () => new Date(T0 + QUOTE_BREAKER_OPEN_MS + 1) });
  assert.equal(probe.ok, true);
  assert.equal(calls, probeCalls, "the probe went to its own fetch");
  assert.equal(xstocksQuoteCircuit(T0 + QUOTE_BREAKER_OPEN_MS + 2), "closed");
  const after = await readXStocksQuote("TSLAx", { fetchImpl: answer(300), now: () => new Date(T0 + QUOTE_BREAKER_OPEN_MS + 3) });
  assert.equal(after.ok, true);
});

test("3 · a 404 or a malformed body for one symbol is that symbol's answer, not the endpoint's state; a 5xx and a 429 are", async () => {
  await readXStocksQuote("A1x", { fetchImpl: status(404), now: () => new Date(T0) });
  await readXStocksQuote("A2x", { fetchImpl: status(404), now: () => new Date(T0) });
  await readXStocksQuote("A3x", { fetchImpl: async () => new Response(JSON.stringify({ quote: "no" }), { status: 200, headers: { "content-type": "application/json" } }), now: () => new Date(T0) });
  await readXStocksQuote("A4x", { fetchImpl: status(404), now: () => new Date(T0) });
  assert.equal(xstocksQuoteCircuit(T0), "closed", "four answers that are not the endpoint being down");
  await readXStocksQuote("B1x", { fetchImpl: status(503), now: () => new Date(T0) });
  await readXStocksQuote("B2x", { fetchImpl: status(429), now: () => new Date(T0) });
  assert.equal(xstocksQuoteCircuit(T0), "closed");
  await readXStocksQuote("B3x", { fetchImpl: () => silence(), now: () => new Date(T0) });
  assert.equal(xstocksQuoteCircuit(T0), "open", "a 5xx, a 429 and a silence: three in a row");
});

test("4 · a silence inside a caller's shorter budget is not counted against the issuer", async () => {
  const fetchImpl = () => silence();
  for (let i = 0; i < QUOTE_BREAKER_THRESHOLD + 2; i += 1) {
    const read = await readXStocksQuote(`S${i}x`, { fetchImpl, timeoutMs: QUOTE_TIMEOUT_MS - 1, now: () => new Date(T0) });
    assert.equal(read.ok, false);
  }
  assert.equal(xstocksQuoteCircuit(T0), "closed", "five short-window silences say nothing about the endpoint");
});

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const xrep = (mint, symbol, underlying) => ({ mint, symbol, name: `${underlying} xStock`, issuer: STOCK_ISSUERS.xstocks, issuerConfirmation: "issuer-catalogue", instrument: ISSUER_INSTRUMENT.xstocks, underlying: { symbol: underlying, isin: null, listingCountry: "US", name: underlying }, companyKey: underlying.toLowerCase(), exchange: null, tokenProgram: null, decimals: 8, tradingHalted: false, issuerUrl: null, issuerNote: null, sources: [] });
const venue = (mint, symbol, price) => ({ mint, symbol, name: `${symbol} xStock`, decimals: 8, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", tags: ["xstocks", "stocks", "verified"], verified: true, category: "stock", issuer: { label: "xStocks", tag: "xstocks" }, price, change24hPct: 0, volume24hUsd: 1, liquidityUsd: 1, updatedAt: NOW, icon: null, audit: { suspicious: false } });

test("5 · past the build's budget a row takes a fresh cached reference or states that none arrived in time; nothing is asked and nothing is invented", async () => {
  globalThis.fetch = async () => new Response("not in this test", { status: 503 });
  let asked = 0;
  const fetchImpl = (url) => { if (String(url).includes("/price-data")) asked += 1; return silence(); };
  /* A quote cached before the deadline is used after it. */
  const priced = await readXStocksQuote("NVDAx", { fetchImpl: answer(212.5), now: () => new Date(T0) });
  assert.equal(priced.ok, true);
  const cachedRow = await buildStockRow(venue(NVDAX, "NVDAx", 213), xrep(NVDAX, "NVDAx", "NVDA"), null, T0, null, { epoch: 1035n, quoteDeadlineMs: Date.now() - 1 });
  assert.equal(cachedRow.reference.perShare, 212.5, "the fresh cached reference stands past the deadline");
  /* No cache, no time: the reference is unavailable and says why. */
  resetXStocksCaches();
  globalThis.fetch = fetchImpl;
  const late = await buildStockRow(venue(NVDAX, "NVDAx", 213), xrep(NVDAX, "NVDAx", "NVDA"), null, T0, null, { epoch: 1035n, quoteDeadlineMs: Date.now() - 1 });
  assert.equal(asked, 0, "past the deadline the issuer is not asked");
  assert.equal(late.reference.state, "unavailable");
  assert.equal(late.reference.perShare, null, "no figure from anywhere else");
  assert.match(late.reference.note, /did not arrive in time/);
  assert.equal(late.deviationPct, null);
  assert.equal(late.tokenPerShareUsd, null, "the chain did not state the units in this test, so no per-share figure is drawn");
});

/** Forty xStocks rows with valid-looking mints, the way the venue and the issuer's catalogue name them. */
const symbols = Array.from({ length: 40 }, (_, i) => `S${String(i + 1).padStart(2, "0")}x`);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const mintOf = (i) => `Xs${ALPHABET[i % ALPHABET.length]}${ALPHABET[Math.floor(i / ALPHABET.length)]}qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9q`;
const catalogueNodes = symbols.map((symbol, i) => ({ symbol, name: `${symbol} xStock`, isin: `CH${i}`, underlying: { symbol: symbol.slice(0, -1), isin: null, listingCountry: "US" }, deployments: [{ network: "Solana", address: mintOf(i) }], isTradingHalted: false, trading: null, logo: null }));
const venueRows = symbols.map((symbol, i) => ({ id: mintOf(i), name: `${symbol} xStock`, symbol, decimals: 8, tags: ["xstocks", "stocks", "verified"], isVerified: true, usdPrice: 100 + i, stats24h: {}, audit: {} }));

function stubUniverse(priceData) {
  const seen = { priceData: 0 };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.xstocks.fi") && u.includes("/price-data")) {
      seen.priceData += 1;
      return priceData(init);
    }
    if (u.includes("api.xstocks.fi")) return new Response(JSON.stringify(u.includes("page=0") ? { nodes: catalogueNodes, page: { hasNextPage: false } } : { nodes: [], page: { hasNextPage: false } }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("prestocks.com")) return new Response("down", { status: 503 });
    if (u.includes("hermes.pyth.network")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/tokens/v2/")) return new Response(JSON.stringify(venueRows), { status: 200, headers: { "content-type": "application/json" } });
    /* The chain: no answer in this test — the units are unknown, nothing false is drawn. */
    return new Response("not in this test", { status: 503 });
  };
  return seen;
}

test("6 · the live failure, reproduced: an issuer whose price endpoint never answers no longer holds the universe — the build completes inside its budget, forty rows stand, every reference says it did not arrive, and the issuer was asked at most eight times", async () => {
  const { resetSpotMarketCaches } = await import("../spot/markets.server.ts");
  resetSpotMarketCaches();
  const seen = stubUniverse((init) => new Promise((_, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout"))); }));
  const started = Date.now();
  const built = await buildStockUniverse({ now: () => new Date(T0), quoteBudgetMs: 400 });
  const elapsed = Date.now() - started;
  assert.equal(built.ok, true);
  assert.equal(built.universe.rows.length, 40, "the list is the list");
  assert.ok(elapsed < 5_000, `the build waited on the issuer no longer than its budget (${elapsed} ms)`);
  assert.ok(seen.priceData <= 8, `at most one ask per worker before the budget ran out (${seen.priceData})`);
  for (const row of built.universe.rows) {
    assert.equal(row.reference.state, "unavailable");
    assert.equal(row.reference.perShare, null);
    assert.match(row.reference.note, /did not arrive in time|aborted|has not answered/);
    assert.equal(row.market.priceUsd, venueRows.find((v) => v.id === row.representation.mint).usdPrice, "the venue's price stands on the row");
  }
  assert.equal(built.universe.issuerCatalogues.xstocks.ok, true, "the catalogue answered; it is the quote that did not");
});

test("7 · an issuer whose price endpoint refuses at once opens the circuit after three answers, and the remaining rows do not ask", async () => {
  const { resetSpotMarketCaches } = await import("../spot/markets.server.ts");
  resetSpotMarketCaches();
  const seen = stubUniverse(async () => new Response("issuer down", { status: 503 }));
  const built = await buildStockUniverse({ now: () => new Date(T0) });
  assert.equal(built.ok, true);
  assert.equal(built.universe.rows.length, 40);
  assert.equal(xstocksQuoteCircuit(), "open");
  assert.ok(seen.priceData <= 8, `the circuit opened after ${QUOTE_BREAKER_THRESHOLD} refusals; ${seen.priceData} asks in all`);
  assert.ok(built.universe.rows.some((row) => /has not answered several times/.test(row.reference.note ?? "")), "the later rows carry the circuit's reason");
});
