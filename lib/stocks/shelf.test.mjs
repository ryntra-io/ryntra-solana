import assert from "node:assert/strict";
import test from "node:test";

import { companyDisplayName, companyFromTokenName, companyShelf, isShelfStock, matchShelf, POPULAR_COUNT, POPULAR_WIDE_COUNT, shelfCompanies, shelfPrivateCompanies } from "./shelf.ts";

/**
 * «Простий»'s shelf, pinned: one company one card, the default the most
 * liquid representation the issuer confirms, Ondo off the beginner's shelf,
 * nothing a person cannot buy now, the day's volume as the one order, and
 * every private instrument its own card.
 */

let mintSeq = 0;
function row({ symbol, underlying, name = null, issuer, confirmation = issuer === "backpack" || issuer === "ondo" ? "tag-only" : "issuer-catalogue", kind = "listed-equity", isin = null, price = 100, change = 1, volume = 1000, liquidity = 10_000, halted = false, tradable = true }) {
  mintSeq += 1;
  return {
    representation: {
      mint: `Mint${String(mintSeq).padStart(4, "0")}${symbol}`,
      symbol,
      name: `${name ?? underlying} token`,
      issuer: { id: issuer, label: issuer, catalogue: confirmation === "issuer-catalogue" },
      issuerConfirmation: confirmation,
      instrument: { class: kind, unitBasis: kind === "pre-ipo" ? "token" : "share", rights: "issuer-terms" },
      underlying: { symbol: underlying, isin, listingCountry: null, name },
      companyKey: name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "") : null,
      tradingHalted: halted,
    },
    market: { priceUsd: price, change24hPct: change, volume24hUsd: volume, liquidityUsd: liquidity, icon: `https://logo/${symbol}.png` },
    lifecycle: { tradable },
  };
}

test("one company is one card, and its default is the representation the issuer confirms", () => {
  const rows = [
    row({ symbol: "AAPLx", underlying: "AAPL", name: "Apple", issuer: "xstocks", liquidity: 50_000, volume: 5_000 }),
    /* Deeper, but only the venue's tag vouches for it: the issuer's catalogue wins. */
    row({ symbol: "AAPL", underlying: "AAPL", name: "Apple Inc.", issuer: "backpack", liquidity: 900_000, volume: 7_000 }),
    row({ symbol: "AAPLon", underlying: "AAPL", name: "Apple", issuer: "ondo", liquidity: 1_000, volume: 10 }),
  ];
  const cards = shelfCompanies(rows);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "Apple");
  assert.equal(cards[0].ticker, "AAPLx");
  /* The company's day is every representation's day. */
  assert.equal(cards[0].volume24h, 12_010);
});

test("a card says whether the issuer's catalogue names its token — the same answer the mandate's shelf gives", () => {
  const rows = [
    row({ symbol: "AAPLx", underlying: "AAPL", name: "Apple", issuer: "xstocks", volume: 5_000 }),
    /* Only Backpack lists the company, and only by the venue's tag: the card stands to be looked at, a bot does not buy it. */
    row({ symbol: "DJT", underlying: "DJT", name: "Trump Media", issuer: "backpack", volume: 4_000 }),
    row({ symbol: "ANT", underlying: "ANT", name: "Anthropic", issuer: "backpack", confirmation: "issuer-catalogue", volume: 3_000 }),
  ];
  const cards = shelfCompanies(rows);
  assert.deepEqual(cards.map((card) => [card.ticker, card.catalogued]), [["AAPLx", true], ["DJT", false], ["ANT", true]]);
  for (const card of cards) assert.equal(card.catalogued, isShelfStock(rows, card.mint), `${card.ticker}: the card and the mandate's shelf agree`);
});

test("Ondo is not on the beginner's shelf, and neither is what cannot be bought now", () => {
  const rows = [
    row({ symbol: "METAon", underlying: "META", name: "Meta", issuer: "ondo", volume: 1_000_000 }),
    row({ symbol: "TQQQx", underlying: "TQQQ", name: "TQQQ", issuer: "xstocks", halted: true }),
    row({ symbol: "KLACx", underlying: "KLAC", name: "KLA Corporation", issuer: "xstocks", price: null }),
    row({ symbol: "PAUSEDx", underlying: "PAUSED", name: "Paused", issuer: "xstocks", tradable: false }),
    row({ symbol: "IONQ", underlying: "IONQ", name: "IonQ", issuer: "backpack", volume: 3_000 }),
  ];
  assert.deepEqual(shelfCompanies(rows).map((card) => card.ticker), ["IONQ"]);
});

test("the shelf's order is the day's volume, the same for everyone", () => {
  const rows = [
    row({ symbol: "MSFTx", underlying: "MSFT", name: "Microsoft", issuer: "xstocks", volume: 700 }),
    row({ symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA", issuer: "xstocks", volume: 25_000 }),
    row({ symbol: "SPYx", underlying: "SPY", name: "SP500", issuer: "xstocks", volume: 22_000 }),
    row({ symbol: "GMEx", underlying: "GME", name: "Gamestop", issuer: "xstocks", volume: 12_000 }),
  ];
  const cards = shelfCompanies(rows);
  assert.deepEqual(cards.map((card) => card.ticker), ["NVDAx", "SPYx", "GMEx", "MSFTx"]);
  /* An index fund is named by the index it tracks. */
  assert.equal(cards[1].name, "S&P 500");
  assert.equal(POPULAR_COUNT, 8);
  /* A wide desk shows three full rows of four beside the right column. */
  assert.equal(POPULAR_WIDE_COUNT, 12);
});

test("two listings under one ticker with different ISINs stay two companies", () => {
  const rows = [
    row({ symbol: "ABCx", underlying: "ABC", name: "Abc One", issuer: "xstocks", isin: "US0000000001" }),
    row({ symbol: "ABC", underlying: "ABC", name: "Abc Two", issuer: "backpack", isin: "CA0000000002" }),
  ];
  assert.equal(shelfCompanies(rows).length, 2);
});

test("the private shelf is PreStocks' tokens only, each its own card with its one number and the time of the valuation behind it", () => {
  const MARK_AT = "2026-09-25T09:05:00.000Z";
  const priced = (input, premium) => ({ ...row(input), markPremiumPct: premium, issuerMark: { source: { id: "issuer-prestocks", label: "PreStocks" }, perUnit: 100, valuationUsd: null, impliedValuationUsd: null, supply: null, holders: null, observedAt: null, fetchedAt: MARK_AT, stale: false } });
  const rows = [
    priced({ symbol: "OPENAI", underlying: "OPENAI", name: "OpenAI", issuer: "prestocks", kind: "pre-ipo", volume: 10_588 }, 30.161),
    priced({ symbol: "KALSHI", underlying: "KALSHI", name: "Kalshi", issuer: "prestocks", kind: "pre-ipo", volume: 3_224 }, -1.3387),
    /* A company that went public is no private company — its token leaves the private shelf. */
    priced({ symbol: "ANTHROPIC", underlying: "ANTHROPIC", name: "Anthropic", issuer: "prestocks", kind: "pre-ipo", volume: 50_000 }, -12),
    /* A pre-IPO row of any other issuer never reaches the shelf, whatever reached the rows. */
    row({ symbol: "OTHER", underlying: "OTHER", name: "Other", issuer: "other", kind: "pre-ipo", volume: 99_999 }),
    row({ symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA", issuer: "xstocks", volume: 1 }),
  ];
  const privates = shelfPrivateCompanies(rows);
  assert.deepEqual(privates.map((card) => card.ticker), ["OPENAI", "KALSHI"]);
  assert.deepEqual(privates.map((card) => card.premiumPct), [30.16, -1.34], "the premium to two decimals, as the server stated it");
  assert.ok(privates.every((card) => card.premiumAt === MARK_AT));
  /* A private instrument is never on the companies' shelf, and the reverse. */
  assert.deepEqual(shelfCompanies(rows).map((card) => card.ticker), ["NVDAx"]);
  assert.equal(shelfCompanies(rows)[0].premiumPct, undefined, "a listed company's card carries no premium");
  const shelf = companyShelf({ rows, fetchedAt: "2026-09-23T17:00:00.000Z" });
  assert.equal(shelf.fetchedAt, "2026-09-23T17:00:00.000Z");
  assert.equal(shelf.privateCompanies.length, 2);
});

test("a company is named the way a person names it", () => {
  const cases = [
    ["Applied Materials, Inc.", "Applied Materials"],
    ["Trump Media & Technology Group Corp. Common Stock", "Trump Media & Technology Group"],
    ["Krispy Kreme, Inc. Common Stock", "Krispy Kreme"],
    ["The Boeing Company", "Boeing"],
    ["Eli Lilly and Company", "Eli Lilly"],
    ["Southwest Airlines Co.", "Southwest Airlines"],
    ["Nebius Group N.V.", "Nebius Group"],
    ["Johnson & Johnson", "Johnson & Johnson"],
    ["Amazon.com", "Amazon.com"],
    ["Apple", "Apple"],
  ];
  for (const [issuerName, expected] of cases) assert.equal(companyDisplayName(issuerName), expected, issuerName);
  assert.equal(companyDisplayName("SP500", "SPY"), "S&P 500");
  assert.equal(companyDisplayName("Nasdaq", "qqq"), "Nasdaq 100");
  /* A wallet's token name → the company. */
  assert.equal(companyFromTokenName("Apple xStock"), "Apple");
  assert.equal(companyFromTokenName("Nike - Backpack Securities"), "Nike");
  assert.equal(companyFromTokenName("Anthropic PreStocks"), "Anthropic");
});

test("search finds a company by its name or its token, the closest first", () => {
  const cards = shelfCompanies([
    row({ symbol: "AAPLx", underlying: "AAPL", name: "Apple", issuer: "xstocks", volume: 5 }),
    row({ symbol: "APPx", underlying: "APP", name: "AppLovin", issuer: "xstocks", volume: 50 }),
    row({ symbol: "AMATx", underlying: "AMAT", name: "Applied Materials, Inc.", issuer: "xstocks", volume: 500 }),
  ]);
  assert.deepEqual(matchShelf(cards, "apple").map((card) => card.ticker), ["AAPLx"]);
  /* Every name starts with «app»: equally close, so the day's volume orders them. */
  assert.deepEqual(matchShelf(cards, "app").map((card) => card.ticker), ["AMATx", "APPx", "AAPLx"]);
  /* An exact token beats a prefix. */
  assert.deepEqual(matchShelf(cards, "appx").map((card) => card.ticker), ["APPx"]);
  assert.equal(matchShelf(cards, "").length, 3);
  assert.equal(matchShelf(cards, "zzz").length, 0);
});

test("a stock of the shelf for a mandate, asked by its address: a token its issuer's own catalogue names — the card or not — and nothing a tag alone vouches for", () => {
  const antx = row({ symbol: "ANTx", underlying: "ANT", name: "Anthropic", issuer: "xstocks", liquidity: 43_000 });
  const ant = row({ symbol: "ANT", underlying: "ANT", name: "Anthropic", issuer: "backpack", confirmation: "issuer-catalogue", liquidity: 2_350_000 });
  const tagOnly = row({ symbol: "AAPL", underlying: "AAPL", name: "Apple", issuer: "backpack", liquidity: 900_000 });
  const aaplx = row({ symbol: "AAPLx", underlying: "AAPL", name: "Apple", issuer: "xstocks", liquidity: 50_000 });
  const ionq = row({ symbol: "IONQ", underlying: "IONQ", name: "IonQ", issuer: "backpack" });
  const halted = row({ symbol: "TQQQx", underlying: "TQQQ", name: "TQQQ", issuer: "xstocks", halted: true });
  const unpriced = row({ symbol: "KLACx", underlying: "KLAC", name: "KLA", issuer: "xstocks", price: null });
  const ondo = row({ symbol: "METAon", underlying: "META", name: "Meta", issuer: "ondo", confirmation: "issuer-catalogue" });
  const privateCo = row({ symbol: "OPENAI", underlying: "OPENAI", name: "OpenAI", issuer: "prestocks", kind: "pre-ipo" });
  const rows = [antx, ant, tagOnly, aaplx, ionq, halted, unpriced, ondo, privateCo];
  const on = (r) => isShelfStock(rows, r.representation.mint);
  /* Anthropic's card is the deeper ANT; ANTx, named by its issuer too, is a stock of the shelf all the same — and the other way round when the card moves. */
  assert.equal(shelfCompanies(rows).find((card) => card.name === "Anthropic").ticker, "ANT");
  assert.ok(on(ant) && on(antx));
  /* Apple's card is the token its issuer names; the deeper one only the venue's tag vouches for is not taken beside it. */
  assert.ok(on(aaplx));
  assert.equal(on(tagOnly), false);
  /* A company whose only token is the venue's: it is the card a person is shown — and for a mandate, no stock. */
  assert.equal(shelfCompanies(rows).find((card) => card.name === "IonQ").ticker, "IONQ");
  assert.equal(on(ionq), false);
  /* What cannot be bought now, an issuer off the shelf, a private company's token, an address of no row: not on it. */
  for (const off of [halted, unpriced, ondo, privateCo]) assert.equal(on(off), false, off.representation.symbol);
  assert.equal(isShelfStock(rows, "So11111111111111111111111111111111111111112"), false);
  assert.equal(isShelfStock([], ant.representation.mint), false);
});
