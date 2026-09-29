// Run from repo root: node --test lib/stocks/popular.test.mjs
//
// «Популярне», listed by the server (RYN-BUY-FLOW-001 subtask 2, contract
// 1.20.0): the same cards Home and the column beside a company's page drew
// from the shelf until now, in the same published order, and the phone's list
// from the same function.
import assert from "node:assert/strict";
import test from "node:test";

import { PopularCompaniesResponseSchema, POPULAR_DEFAULT_LIMIT, POPULAR_MAX_LIMIT } from "../api/v1/contract.ts";
import { POPULAR_LIMIT, POPULAR_LIMIT_MAX, popularCompanies } from "./popular.ts";
import { POPULAR_WIDE_COUNT, shelfCompanies } from "./shelf.ts";

let mintSeq = 0;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A base58 mint of the fixture, unique per row. */
const mintOf = (symbol, seq) => `Mint${B58[Math.floor(seq / 58) % 58]}${B58[seq % 58]}${symbol.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "x")}`.padEnd(40, "1");
function row({ symbol, underlying, name, issuer = "xstocks", kind = "listed-equity", volume = 1000, liquidity = 10_000, price = 100 }) {
  mintSeq += 1;
  return {
    representation: {
      mint: mintOf(symbol, mintSeq),
      symbol,
      name: `${name} token`,
      issuer: { id: issuer, label: issuer, catalogue: issuer === "xstocks" },
      issuerConfirmation: issuer === "xstocks" ? "issuer-catalogue" : "tag-only",
      instrument: { class: kind, unitBasis: kind === "pre-ipo" ? "token" : "share", rights: "issuer-terms" },
      underlying: { symbol: underlying, isin: null, listingCountry: null, name },
      companyKey: name.toLowerCase(),
      tradingHalted: false,
    },
    market: { priceUsd: price, change24hPct: 1.234, volume24hUsd: volume, liquidityUsd: liquidity, icon: `https://logo/${symbol}.png` },
    lifecycle: { tradable: true },
  };
}

const ROWS = [
  row({ symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA", volume: 25_000 }),
  row({ symbol: "SPYx", underlying: "SPY", name: "SP500", volume: 22_000 }),
  row({ symbol: "AAPLx", underlying: "AAPL", name: "Apple", volume: 12_000, liquidity: 50_000 }),
  /* Apple through Backpack: the same company, one card. */
  row({ symbol: "AAPL", underlying: "AAPL", name: "Apple Inc.", issuer: "backpack", volume: 3_000 }),
  row({ symbol: "MSFTx", underlying: "MSFT", name: "Microsoft", volume: 700 }),
  /* A private company is never on «Популярне». */
  row({ symbol: "OPENAI", underlying: "OPENAI", name: "OpenAI", issuer: "prestocks", kind: "pre-ipo", volume: 90_000 }),
  ...Array.from({ length: 30 }, (_, index) => row({ symbol: `Z${index}x`, underlying: `Z${index}`, name: `Company ${index}`, volume: 100 - index })),
];

test("the server's list is the shelf's: the same cards in the same published order, Home's twelve by default", () => {
  const cards = popularCompanies(ROWS);
  assert.equal(POPULAR_LIMIT, POPULAR_WIDE_COUNT, "Home's wide list");
  assert.equal(cards.length, 12);
  assert.deepEqual(cards.map((card) => card.ticker), shelfCompanies(ROWS).slice(0, 12).map((card) => card.ticker));
  assert.deepEqual(cards.slice(0, 4).map((card) => card.name), ["NVIDIA", "S&P 500", "Apple", "Microsoft"]);
  assert.equal(cards[2].volume24h, 15_000, "Apple's day is both its tokens' day");
  assert.ok(!cards.some((card) => card.issuer === "prestocks"), "no private company");
  assert.ok(cards.every((card) => !("premiumPct" in card)), "a listed company carries no premium");
});

test("beside a company's page the company is left out — by its mint, and by its name through another issuer's token", () => {
  const appleBackpack = ROWS[3].representation.mint;
  const beside = popularCompanies(ROWS, { limit: 6, exclude: appleBackpack });
  assert.equal(beside.length, 6);
  assert.ok(!beside.some((card) => card.name === "Apple"), "Backpack's Apple page leaves out xStocks' Apple card");
  assert.deepEqual(beside.slice(0, 3).map((card) => card.name), ["NVIDIA", "S&P 500", "Microsoft"]);
  const unknown = popularCompanies(ROWS, { limit: 3, exclude: "So11111111111111111111111111111111111111112" });
  assert.deepEqual(unknown.map((card) => card.name), ["NVIDIA", "S&P 500", "Apple"], "a mint the universe does not hold leaves nothing out");
});

test("the limit is bounded, and the answer is the contract's shape", () => {
  assert.equal(POPULAR_DEFAULT_LIMIT, POPULAR_LIMIT);
  assert.equal(POPULAR_MAX_LIMIT, POPULAR_LIMIT_MAX);
  assert.equal(popularCompanies(ROWS, { limit: 0 }).length, 1);
  assert.equal(popularCompanies(ROWS, { limit: 500 }).length, POPULAR_LIMIT_MAX);
  const body = PopularCompaniesResponseSchema.parse({ companies: popularCompanies(ROWS, { limit: 8 }), order: "volume-24h", fetchedAt: "2026-09-27T12:00:00.000Z" });
  assert.equal(body.companies.length, 8);
  assert.equal(body.companies[0].change24h, 1.23);
});
