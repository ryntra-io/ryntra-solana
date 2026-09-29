import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isUnsupportedMarket, normalizeSpotMarket, rankMarkets, rankSearch, toListRow, tradingAvailability, UNSUPPORTED_ISSUER } from "../spot/markets.ts";
import { isRetiredMint, isRetiredToken, RETIRED_REASON, RETIRED_TOKENS, RETIRED_WORDS, retiredTokenFor } from "./retired.ts";
import { needsDevelopmentRepository } from "../development-repository.mjs";

/**
 * Private companies come through PreStocks only — canon v5.2 В25–В27,
 * `RYN-PRESTOCKS-001`, session 1. The disconnected issuer's tokens are
 * offered nowhere: no list, no search, no page, no plan, no quote, no order;
 * what a person already has with one reads as history — «Більше не
 * підтримується в Ryntra», sold in the person's own wallet. And its name
 * stays out of the product's code: only the one rule that keeps its tokens
 * out, and the contract's values kept for old records, carry it.
 */

const T_OPENAI = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
const T_SPACEX = "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v";
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const read = (path) => readFileSync(path, "utf8");

/* The venue's row for a retired token, as Jupiter Tokens V2 answered it on 2026-09-25 (trimmed). */
const venueRow = (overrides = {}) => ({
  id: T_OPENAI,
  name: "T-OpenAI",
  symbol: "tOpenAI",
  icon: "https://cdn.example/tokenicon_T-OpenAI.svg",
  decimals: 9,
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  isVerified: true,
  tags: ["tessera", "verified", "token-2022", "stocks", "rwa"],
  usdPrice: 1030.07,
  liquidity: 377000,
  stats24h: { priceChange: 1.1, buyVolume: 700000, sellVolume: 654820 },
  audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false },
  website: "https://issuer.example",
  updatedAt: "2026-09-25T06:00:00.000Z",
  ...overrides,
});

test("the retired tokens are known by mint and by symbol in any case, and by the disconnected issuer's tag on the venue's lists", () => {
  assert.deepEqual(RETIRED_TOKENS.map((token) => token.symbol), ["tOpenAI", "tSpaceX", "tKalshi"]);
  for (const token of RETIRED_TOKENS) {
    assert.equal(isRetiredMint(token.mint), true, token.symbol);
    assert.equal(retiredTokenFor(token.mint)?.symbol, token.symbol);
    assert.equal(retiredTokenFor(token.symbol.toUpperCase())?.mint, token.mint);
    assert.equal(retiredTokenFor(` ${token.symbol.toLowerCase()} `)?.mint, token.mint);
  }
  assert.equal(isRetiredMint(OPENAI), false, "a PreStocks token is never retired");
  assert.equal(retiredTokenFor("OPENAI"), null);
  assert.equal(retiredTokenFor(""), null);
  assert.equal(isRetiredMint(null), false);
  /* A later mint of the same issuer is caught by the venue's tag. */
  assert.equal(isRetiredToken({ mint: "So11111111111111111111111111111111111111112", tags: ["verified", "tessera"] }), true);
  assert.equal(isRetiredToken({ mint: OPENAI, tags: ["prestocks", "pre-ipo", "verified"] }), false);
  assert.equal(RETIRED_WORDS.state.uk, "Більше не підтримується в Ryntra");
  assert.equal(RETIRED_WORDS.exit.uk, "Продати можна у своєму гаманці");
  assert.match(RETIRED_REASON, /No longer supported in Ryntra/);
});

test("Spot reads a retired token by its address with no issuer's name, tag, icon or links, and offers it on no list, in no search and in no ticket", () => {
  const market = normalizeSpotMarket(venueRow());
  assert.ok(market);
  assert.equal(market.symbol, "tOpenAI", "its identity and figures stay readable for a holder");
  assert.equal(market.price, 1030.07);
  assert.deepEqual(market.issuer, UNSUPPORTED_ISSUER);
  assert.equal(market.tags.includes("tessera"), false, "the disconnected issuer's tag is not carried");
  assert.equal(market.icon, null);
  assert.deepEqual(market.links, { website: null, twitter: null, telegram: null });
  assert.equal(isUnsupportedMarket(market), true);
  /* The watchlist's and the holdings' read by address keeps the row; a list or a search never offers it. */
  assert.equal(toListRow(market).issuer.tag, "unsupported");
  const openai = normalizeSpotMarket(venueRow({ id: OPENAI, symbol: "OPENAI", name: "OpenAI PreStocks", tags: ["prestocks", "pre-ipo", "stocks", "rwa", "verified"] }));
  const later = normalizeSpotMarket(venueRow({ id: "So11111111111111111111111111111111111111112", symbol: "tLater", name: "T-Later" }));
  assert.equal(isUnsupportedMarket(later), true, "a later mint of the issuer, by its tag");
  for (const view of ["all", "stock"]) {
    assert.deepEqual(rankMarkets([market, openai, later], view, 10).map((row) => row.symbol), ["OPENAI"], view);
  }
  assert.deepEqual(rankSearch([market, openai], "tOpenAI", 10).map((row) => row.symbol), ["OPENAI"]);
  assert.deepEqual(tradingAvailability(market), { allowed: false, reason: "NO_LONGER_SUPPORTED" });
  assert.deepEqual(tradingAvailability({ category: "stock", mint: T_SPACEX, issuer: null }), { allowed: false, reason: "NO_LONGER_SUPPORTED" }, "by mint alone");
  assert.deepEqual(tradingAvailability(openai), { allowed: true, notice: "ISSUER_TERMS" });
});

test("the quote and order routes refuse a retired token on either side before any provider is asked", () => {
  for (const path of ["app/api/solana/swap/quote/route.ts", "app/api/solana/swap/order/route.ts"]) {
    const source = read(path);
    const refusal = source.indexOf("if (isRetiredMint(input.inputMint) || isRetiredMint(input.outputMint))");
    assert.ok(refusal > 0, `${path} refuses a retired token`);
    assert.match(source.slice(refusal, refusal + 200), /failure\(409, "ASSET_NOT_OFFERED", RETIRED_REASON/);
    for (const provider of ["resolveJupiterSwapEndpoint(", "fetchJupiterExecutableOrder(", "fetchJupiterOrder("]) {
      const at = source.indexOf(provider);
      if (at >= 0) assert.ok(refusal < at, `${path}: the refusal comes before ${provider}`);
    }
  }
});

test("the stock page, the plan's asset, the agent and the monitoring tick read a retired token as history", () => {
  assert.match(read("app/app/stocks/[ticker]/page.tsx"), /retiredTokenFor\(ticker\)[\s\S]*RetiredCompany/);
  assert.match(read("lib/plans/service.ts"), /if \(isRetiredMint\(mint\)\) return \{ ok: false, code: "ASSET_UNCONFIRMED"/);
  assert.match(read("lib/agent/tools/readers.ts"), /if \(retiredTokenFor\(text\) !== null\) return \{ kind: "none", query, reason: "retired" \}/);
  assert.match(read("lib/monitoring/service.server.ts"), /if \(isRetiredMint\(plan\.asset\.mint\)\) \{\s*await applyMonitorResult\(store, monitor, "paused"/);
});

/* The name stays out of the product (the Owner: «пошук не знаходить Tessera ніде»). */
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path.replace(/\\/g, "/");
  }
}

const isTest = (path) => /\.test\.(mjs|ts|tsx)$/.test(path) || path.includes("/__fixtures__/") || path.includes("/fixtures/");
/* The one rule that keeps its tokens out, and the contract's values kept for records written before canon v5.2 В26. */
const ALLOWED = new Set(["lib/stocks/retired.ts", "lib/api/v1/contract.ts"]);
/* The public record of the disconnection names what was disconnected (the Owner's word, 2026-09-25) — and offers none of its tokens. */
const RECORD_OF_DISCONNECTION = "public-surfaces/progress/entries/2026-09-25-private-companies-through-prestocks.json";

test("no product source, customer page, document for people or public page names the disconnected issuer or its tokens", { skip: needsDevelopmentRepository("the documents under docs/ and public-surfaces/") }, () => {
  const offenders = [];
  for (const root of ["app", "lib", "packages/ryntra-api-client/src", "packages/tokenized-stocks", "public-surfaces/product", "public-surfaces/progress/entries"]) {
    for (const path of files(root)) {
      if (isTest(path) || ALLOWED.has(path) || !/\.(ts|tsx|mjs|js|json|md|css)$/.test(path)) continue;
      const text = read(path);
      /* The client package mirrors the contract's historical values and nothing more; the public progress entries of the past are history and never rewritten. */
      if (path === "packages/ryntra-api-client/src/types.ts") {
        for (const line of text.split(/\r?\n/)) if (/tessera/i.test(line) && !/STOCK_ISSUER_IDS|issuer-tessera|tessera\?:/.test(line)) offenders.push(`${path}: ${line.trim().slice(0, 80)}`);
        continue;
      }
      if (path.startsWith("public-surfaces/progress/entries/") && path < "public-surfaces/progress/entries/2026-09-25") continue;
      if (/tessera/i.test(text) && path !== RECORD_OF_DISCONNECTION) offenders.push(path);
      if (/\b(tOpenAI|tSpaceX|tKalshi)\b/.test(text) && path !== "lib/stocks/retired.ts") offenders.push(`${path} (a retired ticker)`);
    }
  }
  assert.deepEqual(offenders, []);
});
