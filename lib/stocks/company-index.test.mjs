import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { pythFeedForUsListing, pythIndexFeedForCompany, readPythEquityCatalogue, resetPythCaches } from "./pyth.server.ts";
import { buildStockRow, COMPANY_INDEX_STALE_AFTER_MS, companyIndexOf } from "./universe.server.ts";

/* Pyth's 24/7 indices are context for the
   company behind a pre-IPO token — a separate field with its own state,
   never the row's reference, never a deviation against a token whose unit
   is not a share. The catalogue's two families stay apart even where they
   share a display symbol. */

const OPENAI_ID = "96d4bb23a3db78fdb72b3a03ce80ead686096f324319166534d9a27c0519c483";
const NVDA_US_ID = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
const NVDA_INDEX_ID = "c".repeat(64);
const T0 = Date.UTC(2026, 8, 20, 18, 0, 0);
const realFetch = globalThis.fetch;

beforeEach(() => resetPythCaches());
afterEach(() => { globalThis.fetch = realFetch; });

const catalogueRow = (id, displaySymbol, symbol, open) => ({
  id,
  attributes: { asset_type: "Equity", display_symbol: displaySymbol, symbol, description: "", quote_currency: "USD", schedule: open ? "America/New_York;O,O,O,O,O,O,O;" : "America/New_York;0930-1600" },
  market_hours: { is_open: open, next_open: null, next_close: null },
});

test("the catalogue keeps the exchange feeds and the 24/7 indices apart, even where a display symbol names both", async () => {
  /* The index comes first in the list on purpose: before the split it took NVDA's place and the listing lost its reference. */
  const body = [
    catalogueRow(NVDA_INDEX_ID, "NVDA", "Equity.Index.NVDA/USD", true),
    catalogueRow(NVDA_US_ID, "NVDA", "Equity.US.NVDA/USD", false),
    catalogueRow(OPENAI_ID, "OPENAI", "Equity.Index.OPENAI/USD", true),
    catalogueRow("d".repeat(64), "0700", "Equity.HK.0700/HKD", false),
  ];
  const read = await readPythEquityCatalogue({ fetchImpl: async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }), now: () => new Date(T0) });
  assert.equal(read.ok, true);
  assert.equal(read.bySymbol.get("NVDA")?.id, NVDA_US_ID, "the US listing wins the display symbol");
  assert.equal(read.bySymbol.has("OPENAI"), false, "an index is never an exchange feed");
  assert.equal(read.indexBySymbol.get("NVDA")?.id, NVDA_INDEX_ID);
  assert.equal(read.indexBySymbol.get("OPENAI")?.id, OPENAI_ID);
  assert.equal(pythFeedForUsListing(read.bySymbol, "NVDA")?.id, NVDA_US_ID);
  assert.equal(pythIndexFeedForCompany(read.indexBySymbol, "openai")?.id, OPENAI_ID, "OpenAI is on the verified map");
  assert.equal(pythIndexFeedForCompany(read.indexBySymbol, "kalshi"), null, "Kalshi has no index — nothing is borrowed");
  assert.equal(pythIndexFeedForCompany(read.indexBySymbol, "nvidia"), null, "a listed company's index is not a pre-IPO context");
  assert.equal(pythIndexFeedForCompany(read.indexBySymbol, null), null);
});

const market = { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", symbol: "OPENAI", name: "OpenAI PreStocks", price: 966.37, change24hPct: -1.8, volume24hUsd: 1_128_997, liquidityUsd: 380_129, verified: true, updatedAt: null, icon: null, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", decimals: 9 };
const representation = {
  mint: market.mint,
  symbol: "OPENAI",
  name: "OpenAI PreStocks",
  issuer: { id: "prestocks", label: "PreStocks", catalogue: true },
  issuerConfirmation: "issuer-catalogue",
  instrument: { class: "pre-ipo", unitBasis: "token", rights: "economic-exposure" },
  underlying: { symbol: "OPENAI", isin: null, listingCountry: null, name: "OpenAI" },
  companyKey: "openai",
  exchange: null,
  tokenProgram: market.tokenProgram,
  decimals: 9,
  tradingHalted: null,
  issuerUrl: null,
  issuerNote: null,
  sources: ["jupiter-verified", "prestocks-public-api"],
};

test("a pre-IPO row carries the company index with its own state, keeps the reference unavailable and draws no deviation", async () => {
  globalThis.fetch = async () => new Response("not in this test", { status: 503 });
  const price = { ok: true, id: OPENAI_ID, price: 730.25, confidence: 0.5, publishTime: new Date(T0 - 20_000).toISOString(), fetchedAt: new Date(T0).toISOString() };
  const row = await buildStockRow(market, representation, null, T0, { price: null, index: { symbol: "OPENAI", feedId: OPENAI_ID, price } });
  assert.equal(row.companyIndex?.symbol, "OPENAI");
  assert.equal(row.companyIndex?.valueUsd, 730.25);
  assert.equal(row.companyIndex?.state, "current");
  assert.equal(row.companyIndex?.observedAt, price.publishTime);
  assert.equal(row.companyIndex?.source.id, "pyth");
  assert.equal(row.reference.state, "unavailable", "the index is not the row's reference");
  assert.match(row.reference.note, /private company has no exchange reference/);
  assert.equal(row.reference.perShare, null);
  assert.equal(row.deviationPct, null, "no deviation between a token and a company-level index");
  assert.equal(row.tokenPerShareUsd, null);
});

test("without the key, or on a refusal, the company index is unavailable and says why — never a figure; a stale publish time is stale", async () => {
  globalThis.fetch = async () => new Response("not in this test", { status: 503 });
  const noKey = await buildStockRow(market, representation, null, T0, { price: null, index: { symbol: "OPENAI", feedId: OPENAI_ID, price: { ok: false, code: "NO_KEY", reason: "Hermes needs a Pyth API key for price updates; none is configured." } } });
  assert.equal(noKey.companyIndex?.state, "unavailable");
  assert.equal(noKey.companyIndex?.valueUsd, null);
  assert.match(noKey.companyIndex?.note, /API key/);
  const stale = companyIndexOf({ symbol: "OPENAI", feedId: OPENAI_ID, price: { ok: true, id: OPENAI_ID, price: 730.25, confidence: 0, publishTime: new Date(T0 - COMPANY_INDEX_STALE_AFTER_MS - 1000).toISOString(), fetchedAt: new Date(T0).toISOString() } }, T0);
  assert.equal(stale.state, "stale");
  assert.equal(stale.valueUsd, 730.25, "a stale value is still shown, named stale");
  const none = await buildStockRow(market, representation, null, T0, null);
  assert.equal(none.companyIndex, null, "no index on the map → nothing on the row");
});

test("a listed-equity row of another issuer never carries a company index, whatever the build passed", async () => {
  globalThis.fetch = async () => new Response("not in this test", { status: 503 });
  const listed = { ...representation, mint: "PTNzAfFAB4LvoUQEUUGrFMyUoRLExMYjH6CcfyQfsVP", symbol: "MU", issuer: { id: "backpack", label: "Backpack Securities", catalogue: false }, issuerConfirmation: "tag-only", instrument: { class: "listed-equity", unitBasis: "share", rights: "issuer-terms" }, underlying: { symbol: "MU", isin: null, listingCountry: "US", name: "Micron Technology" }, companyKey: "microntechnology" };
  const price = { ok: true, id: NVDA_INDEX_ID, price: 100, confidence: 0, publishTime: new Date(T0 - 5_000).toISOString(), fetchedAt: new Date(T0).toISOString() };
  const row = await buildStockRow({ ...market, mint: listed.mint, symbol: "MU" }, listed, null, T0, { price: null, index: { symbol: "MU", feedId: NVDA_INDEX_ID, price } });
  assert.equal(row.companyIndex, null);
});
