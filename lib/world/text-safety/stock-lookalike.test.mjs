/* A coin passing for a tokenized stock: the real one, a copy with its ticker, with its company's name, with
   hidden or look-alike letters; and what the rule must leave alone. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { KNOWN_STOCKS } from "../../stocks/known-stocks.ts";
import { KNOWN_STOCK_BOOK, passesForStock, withStocks } from "../../stocks/stock-book.ts";
import { COMPANY_NAME_MIN, EMPTY_STOCK_BOOK, companySkeleton, lookalikeOf as lookalikeIn, stockBookOf, stockLookalikeOf as stockIn } from "./lookalike.ts";

/* The rule reads the book it is handed; the terminal hands it the static book of known stocks. */
const stockLookalikeOf = (coin, book = KNOWN_STOCK_BOOK) => stockIn(coin, book);
const lookalikeOf = (symbol, mint, book = KNOWN_STOCK_BOOK) => lookalikeIn(symbol, mint, book);

const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const ANTHROPIC_PRESTOCKS = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
/** Copies seen on 19.11 in Jupiter's search (`ANT-LIVE.md`): pump.fun mints with the ticker ANT. */
const PUMP_ANT = "4WdnFakeAnthropicCopy11111111111111111bpump";
const PUMP_ANTHROPIC = "81KrFakeANThropicCopy111111111111111111pump";

test("the real stock is its own: no mark on ANT, on the PreStocks token, on any known stock", () => {
  assert.equal(stockLookalikeOf({ symbol: "ANT", name: "Anthropic - Backpack Securities", mint: ANT, verified: true }), null);
  assert.equal(stockLookalikeOf({ symbol: "ANTHROPIC", name: "Anthropic PreStocks", mint: ANTHROPIC_PRESTOCKS, verified: true }), null);
  for (const stock of KNOWN_STOCKS) {
    assert.equal(stockLookalikeOf({ symbol: stock.symbol, name: stock.company, mint: stock.mint }), null, stock.symbol);
    assert.equal(lookalikeOf(stock.symbol, stock.mint), null, stock.symbol);
  }
});

test("a copy with the stock's ticker on another mint is not the stock, and points at the real one", () => {
  const hit = stockLookalikeOf({ symbol: "ANT", name: "Anthropic", mint: PUMP_ANT, verified: false });
  assert.deepEqual(hit, { ticker: "ANT", company: "Anthropic", mint: ANT, reason: "ticker" });
  /* «$ANT», «ant»: the same ticker as a person reads it. */
  assert.equal(stockLookalikeOf({ symbol: "$ant", mint: PUMP_ANT })?.reason, "ticker");
  /* A verified coin keeps its own name, never its ticker: another «ANT» is not the stock either way. */
  assert.equal(stockLookalikeOf({ symbol: "ANT", name: "AntMiner", mint: PUMP_ANT, verified: true })?.ticker, "ANT");
  /* The coin-wide rule says the same, so every picker that hides a coin passing for SOL hides this one too. */
  assert.deepEqual(lookalikeOf("ANT", PUMP_ANT), { famous: "ANT", reason: "impersonation", stock: { company: "Anthropic", mint: ANT } });
  assert.deepEqual(lookalikeOf("AMD", PUMP_ANT), { famous: "AMD", reason: "impersonation", stock: { company: "Advanced Micro Devices", mint: KNOWN_STOCKS.find((s) => s.symbol === "AMD").mint } });
});

test("a copy named as the company, under any ticker, is not the stock — when the venue did not verify it", () => {
  for (const name of ["Anthropic", "ANThropic", "anthropic", "Anthropic Stock", "Tokenized Anthropic", "Anthropic - Backpack Securities", "Anthropic PreStocks", "Anthropic Inc."]) {
    const hit = stockLookalikeOf({ symbol: "ANTHRP", name, mint: PUMP_ANTHROPIC, verified: false });
    assert.equal(hit?.reason, "company", name);
    /* A private token is pointed at the share a person can buy now. */
    assert.equal(hit?.mint, ANT, name);
  }
  /* A ticker that spells the company counts as its name. */
  assert.equal(stockLookalikeOf({ symbol: "TESLA", name: "Tesla PreStocks", mint: PUMP_ANTHROPIC })?.company, "Tesla");
  /* A coin the venue verified keeps its own name. */
  assert.equal(stockLookalikeOf({ symbol: "ANTHRP", name: "Anthropic", mint: PUMP_ANTHROPIC, verified: true }), null);
  /* A coin that only riffs on the name is its own: «Anthropic Inu», «Anthropic Cat». */
  assert.equal(stockLookalikeOf({ symbol: "AINU", name: "Anthropic Inu", mint: PUMP_ANTHROPIC }), null);
  assert.equal(stockLookalikeOf({ symbol: "ACAT", name: "Anthropic Cat", mint: PUMP_ANTHROPIC }), null);
  /* lookalikeOf has no name to read: a name-only copy is stockLookalikeOf's. */
  assert.equal(lookalikeOf("ANTHRP", PUMP_ANTHROPIC), null);
});

test("hidden and look-alike letters do not hide a copy", () => {
  /* A zero-width space, a Greek capital alpha, a Cyrillic «А»: the same ticker to a person's eye. */
  for (const symbol of ["A​NT", "ΑNT", "АNT", "ＡＮＴ"]) {
    const hit = stockLookalikeOf({ symbol, mint: PUMP_ANT });
    assert.equal(hit?.ticker, "ANT", JSON.stringify(symbol));
  }
  assert.equal(stockLookalikeOf({ symbol: "A​NT", mint: PUMP_ANT })?.reason, "lookalike");
  /* Full-width letters fold to the ticker itself. */
  assert.equal(stockLookalikeOf({ symbol: "ＡＮＴ", mint: PUMP_ANT })?.reason, "ticker");
  /* A name with a hidden character and a Cyrillic «о» still reads as the company. */
  assert.equal(stockLookalikeOf({ symbol: "X", name: "Anthr​оpic", mint: PUMP_ANTHROPIC })?.company, "Anthropic");
});

test("what the rule leaves alone: other tickers, funds' common words, short company names", () => {
  assert.equal(stockLookalikeOf({ symbol: "ANTS", name: "Ants", mint: PUMP_ANT }), null);
  assert.equal(stockLookalikeOf({ symbol: "ANTx", name: "Anthropic xStock", mint: PUMP_ANT, verified: true }), null);
  /* A fund is matched by its ticker only: a coin named «Gold» or «Nasdaq 100» is not taken for one. */
  assert.equal(stockLookalikeOf({ symbol: "GOLD", name: "Gold", mint: PUMP_ANT }), null);
  assert.equal(stockLookalikeOf({ symbol: "N100", name: "Nasdaq 100", mint: PUMP_ANT }), null);
  /* A company's name shorter than five letters folded is a word: «Meta», «Snap», «Oura». */
  for (const name of ["Meta", "Snap", "Oura"]) assert.equal(stockLookalikeOf({ symbol: "ZZZ", name, mint: PUMP_ANT }), null, name);
  assert.ok(companySkeleton("Meta").length < COMPANY_NAME_MIN);
  /* A famous coin's ticker stays the coin's: the stock book never takes it. */
  assert.equal(stockLookalikeOf({ symbol: "SOL", mint: PUMP_ANT }), null);
});

test("the server's book adds the universe's stocks, the static ones first", () => {
  const listed = { mint: "XsYzw7AnthropicxStockMint11111111111DN1DL", symbol: "ANTx", company: "Anthropic", issuer: "xstocks", kind: "company" };
  const book = withStocks([listed]);
  assert.equal(book.mints.has(listed.mint), true);
  assert.equal(stockLookalikeOf({ symbol: "ANTx", name: "Anthropic xStock", mint: listed.mint }, book), null);
  assert.equal(stockLookalikeOf({ symbol: "ANTX", name: "Anthropic xStock", mint: PUMP_ANT }, book)?.ticker, "ANTx");
  /* The company still points at the stock the static book names first. */
  assert.equal(stockLookalikeOf({ symbol: "Q", name: "Anthropic", mint: PUMP_ANT }, book)?.mint, ANT);
  assert.equal(withStocks([]), KNOWN_STOCK_BOOK);
  /* A company known only by its private token points at that token. */
  const only = stockBookOf([{ mint: ANTHROPIC_PRESTOCKS, symbol: "ANTHROPIC", company: "Anthropic", issuer: "prestocks", kind: "private" }]);
  assert.equal(stockLookalikeOf({ symbol: "Q", name: "Anthropic", mint: PUMP_ANT }, only)?.mint, ANTHROPIC_PRESTOCKS);
});

test("without a book no coin passes for a stock, and the famous coins stay the rule's own", () => {
  assert.equal(stockIn({ symbol: "ANT", name: "Anthropic", mint: PUMP_ANT }), null);
  assert.equal(lookalikeIn("ANT", PUMP_ANT), null);
  assert.equal(stockIn({ symbol: "ANT", mint: PUMP_ANT }, EMPTY_STOCK_BOOK), null);
  assert.deepEqual(lookalikeIn("S0L", PUMP_ANT), { famous: "SOL", reason: "lookalike" });
  assert.deepEqual(passesForStock({ symbol: "ANT", mint: PUMP_ANT }), { ticker: "ANT", company: "Anthropic", mint: ANT });
});
