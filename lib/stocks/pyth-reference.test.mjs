import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { PYTH_SOURCE, pythFeedForUsListing, readPythLatestMany, resetPythCaches } from "./pyth.server.ts";
import { buildStockRow } from "./universe.server.ts";

const NVDA_ID = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
const T0 = Date.UTC(2026, 8, 15, 7, 40, 0);
const realFetch = globalThis.fetch;

beforeEach(() => resetPythCaches());
afterEach(() => { globalThis.fetch = realFetch; });

const feed = (displaySymbol, symbol) => ({ id: NVDA_ID, displaySymbol, symbol, description: "", quoteCurrency: "USD", schedule: null, marketHours: { isOpen: false, nextOpen: null, nextClose: null } });

test("a US-listed underlying takes only the same ticker on the US listing; anything else has no feed", () => {
  const bySymbol = new Map([["NVDA", feed("NVDA", "Equity.US.NVDA/USD")], ["0700", feed("0700", "Equity.HK.0700/HKD")]]);
  assert.equal(pythFeedForUsListing(bySymbol, "NVDA")?.id, NVDA_ID);
  assert.equal(pythFeedForUsListing(bySymbol, "0700"), null, "a Hong Kong listing is not a US reference");
  assert.equal(pythFeedForUsListing(bySymbol, "PTN"), null, "no feed, no reference");
  assert.equal(pythFeedForUsListing(bySymbol, null), null);
});

test("without the key nothing is asked and every id answers NO_KEY", async () => {
  let called = 0;
  const prices = await readPythLatestMany([NVDA_ID], { env: {}, fetchImpl: async () => { called += 1; return new Response("{}"); } });
  assert.equal(called, 0);
  assert.equal(prices.get(NVDA_ID).ok, false);
  assert.equal(prices.get(NVDA_ID).code, "NO_KEY");
});

test("with the key the batch is one request with a bearer header; the parsed price is scaled by its exponent and cached for twenty seconds", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization });
    return new Response(JSON.stringify({ parsed: [{ id: NVDA_ID, price: { price: "21205000000", conf: "1000000", expo: -8, publish_time: Math.floor(T0 / 1000) - 30 } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = { PYTH_HERMES_API_KEY: "test-key-not-real" };
  const first = await readPythLatestMany([NVDA_ID, NVDA_ID.toUpperCase()], { env, fetchImpl, now: () => new Date(T0) });
  assert.equal(seen.length, 1, "one batch for one unique id");
  assert.match(seen[0].url, /\/v2\/updates\/price\/latest\?ids\[\]=b1073854/);
  assert.equal(seen[0].auth, "Bearer test-key-not-real");
  const price = first.get(NVDA_ID);
  assert.equal(price.ok, true);
  assert.equal(price.price, 212.05);
  assert.equal(price.publishTime, new Date(T0 - 30_000).toISOString());
  const second = await readPythLatestMany([NVDA_ID], { env, fetchImpl, now: () => new Date(T0 + 10_000) });
  assert.equal(seen.length, 1, "inside twenty seconds the price is reused");
  assert.equal(second.get(NVDA_ID).price, 212.05);
  await readPythLatestMany([NVDA_ID], { env, fetchImpl, now: () => new Date(T0 + 25_000) });
  assert.equal(seen.length, 2, "after twenty seconds it is asked again");
});

test("a refused key answers HTTP for every id in the batch, and a feed Hermes did not return answers SHAPE — never a price", async () => {
  const env = { PYTH_HERMES_API_KEY: "test-key-not-real" };
  const refused = await readPythLatestMany([NVDA_ID], { env, fetchImpl: async () => new Response("unauthorized", { status: 401 }) });
  assert.equal(refused.get(NVDA_ID).code, "HTTP");
  assert.match(refused.get(NVDA_ID).reason, /refused the key \(401\)/);
  resetPythCaches();
  const other = "a".repeat(64);
  const partial = await readPythLatestMany([NVDA_ID, other], { env, fetchImpl: async () => new Response(JSON.stringify({ parsed: [{ id: NVDA_ID, price: { price: "21205000000", conf: "0", expo: -8, publish_time: Math.floor(T0 / 1000) } }] }), { status: 200 }) });
  assert.equal(partial.get(NVDA_ID).ok, true);
  assert.equal(partial.get(other).code, "SHAPE");
});

test("a Backpack row takes the feed's price as its reference with the feed's own publish time; a refusal leaves UNAVAILABLE, named; an xStocks row ignores the feed", async () => {
  globalThis.fetch = async () => new Response("not in this test", { status: 503 });
  const market = { mint: "PTNzAfFAB4LvoUQEUUGrFMyUoRLExMYjH6CcfyQfsVP", symbol: "MU", name: "Micron Technology - Backpack Securities", price: 930.89, change24hPct: -0.6, volume24hUsd: 5_500_000, liquidityUsd: 1_700_000, verified: true, updatedAt: null, icon: null, decimals: 9, tokenProgram: null };
  const representation = { mint: market.mint, symbol: "MU", name: "Micron Technology", decimals: 9, issuer: { id: "backpack", label: "Backpack Securities", catalogue: false }, issuerConfirmation: "tag-only", underlying: { symbol: "MU", name: "Micron Technology", isin: null, listing: null } };
  const price = { ok: true, id: NVDA_ID, price: 931.4, confidence: 0.1, publishTime: new Date(T0 - 20_000).toISOString(), fetchedAt: new Date(T0).toISOString() };
  const row = await buildStockRow(market, representation, null, T0, { price });
  assert.equal(row.reference.perShare, 931.4);
  assert.equal(row.reference.source.id, "pyth");
  assert.equal(row.reference.source.label, PYTH_SOURCE.label);
  assert.equal(row.reference.observedAt, price.publishTime);
  assert.ok(["current", "last-available", "stale"].includes(row.reference.state));
  const refused = await buildStockRow(market, representation, null, T0, { price: { ok: false, code: "HTTP", reason: "Hermes refused the key (401)." } });
  assert.equal(refused.reference.perShare, null);
  assert.equal(refused.reference.state, "unavailable");
  assert.equal(refused.reference.source.id, "pyth");
  assert.match(refused.reference.note, /refused the key/);
  const none = await buildStockRow(market, representation, null, T0, null);
  assert.equal(none.reference.source.id, "none");
  const xstocks = { ...representation, issuer: { id: "xstocks", label: "xStocks · Backed Finance", catalogue: true } };
  const xrow = await buildStockRow({ ...market, price: null }, xstocks, null, T0, { price });
  assert.equal(xrow.reference.source.id, "none", "the issuer's own reference path decides for xStocks; the feed is not consulted");
});
