import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPANY_FACTS, COMPANY_FACTS_READ_AT } from "./company-facts.data.ts";
import { companyFactsFor, companyFigures, fiscalYearEndWords, headquartersLabel } from "./company-facts.ts";
import { companyLine, isKnownFund } from "./company-profiles.ts";
import { FUND_SECTOR, sectorLabel } from "./company-sectors.ts";

/* The company's own facts from its SEC filings, and what the page sets against the live price. */

const operating = (overrides = {}) => ({
  cik: "1045810",
  name: "NVIDIA CORP",
  sic: "3674",
  kind: "operating",
  foreign: false,
  exchange: "Nasdaq",
  city: "Santa Clara",
  region: "CA",
  foreignLocation: null,
  fiscalYearEnd: "0131",
  shares: { value: 24_100_000_000, asOf: "2026-08-21", classes: 1, basis: "outstanding" },
  revenue: { value: 302_950_000_000, end: "2026-07-26", basis: "ttm" },
  netIncome: { value: 192_900_000_000, end: "2026-07-26", basis: "ttm" },
  eps: { value: 7.91, end: "2026-07-26", basis: "ttm" },
  dividend: { value: 0.28, end: "2026-07-26", basis: "ttm" },
  report: { form: "10-Q", filed: "2026-08-26", end: "2026-07-26", url: "https://www.sec.gov/Archives/edgar/data/1045810/x/nvda.htm" },
  ...overrides,
});

test("the market value is shares × the price of one share; P/E is that value over twelve months' net income", () => {
  const figures = companyFigures("NVDA", operating(), 225);
  assert.equal(figures.marketCapUsd, 24_100_000_000 * 225);
  assert.ok(Math.abs(figures.pe - (24_100_000_000 * 225) / 192_900_000_000) < 1e-9);
  assert.ok(Math.abs(figures.dividendYieldPct - (0.28 / 225) * 100) < 1e-9);
  assert.equal(figures.revenue.value, 302_950_000_000);
});

test("a loss has no P/E, a figure of months short of a year sets nothing against the price, and a missing price sets nothing at all", () => {
  const loss = companyFigures("HIMS", operating({ netIncome: { value: -142_000_000, end: "2026-06-30", basis: "ttm" } }), 30);
  assert.equal(loss.pe, null);
  assert.equal(loss.netIncome.value, -142_000_000);
  const young = companyFigures("SPCX", operating({ netIncome: { value: 5e9, end: "2026-06-30", basis: "ytd", months: 6 } }), 150);
  assert.equal(young.pe, null);
  const listedInTheQuarter = companyFigures("SPCX", operating({ shares: { value: 5.9e9, asOf: "2026-06-30", classes: 1, basis: "diluted-average" }, revenue: { value: 12.5e9, end: "2026-06-30", basis: "ytd", months: 6 } }), 148);
  assert.equal(listedInTheQuarter.marketCapUsd, null);
  assert.equal(listedInTheQuarter.revenue.value, 12.5e9);
  const unpriced = companyFigures("NVDA", operating(), null);
  assert.equal(unpriced.marketCapUsd, null);
  assert.equal(unpriced.pe, null);
  assert.equal(unpriced.revenue.value, 302_950_000_000);
});

test("a fund, a foreign issuer and a class whose price is not the class the filings count set nothing against the price", () => {
  for (const [symbol, facts] of [
    ["SPY", operating({ kind: "fund" })],
    ["TSM", operating({ foreign: true })],
    ["BRK.B", operating()],
  ]) {
    const figures = companyFigures(symbol, facts, 400);
    assert.equal(figures.marketCapUsd, null, symbol);
    assert.equal(figures.pe, null, symbol);
  }
  assert.equal(companyFigures("SPY", operating({ kind: "fund" }), 400).revenue, null);
});

test("the headquarters and the fiscal year are said in the reader's language", () => {
  assert.equal(headquartersLabel(operating(), "uk"), "Santa Clara, California, США");
  assert.equal(headquartersLabel(operating(), "en"), "Santa Clara, California, US");
  assert.equal(headquartersLabel(operating({ city: "Cambridge", region: null, foreignLocation: "United Kingdom" }), "uk"), "Cambridge, United Kingdom");
  assert.equal(fiscalYearEndWords(operating(), "uk"), "до кінця січня");
  assert.equal(fiscalYearEndWords(operating({ fiscalYearEnd: "1231" }), "en"), "ends in December");
  assert.equal(fiscalYearEndWords(operating({ fiscalYearEnd: null }), "en"), null);
});

test("the industry reads in plain words, a mismatched filing code yields to the ticker, an unknown code to its group", () => {
  assert.equal(sectorLabel("NVDA", "3674", "uk"), "Напівпровідники");
  assert.equal(sectorLabel("MSFT", "7372", "en"), "Software");
  assert.equal(sectorLabel("V", "7389", "uk"), "Платежі");
  assert.equal(sectorLabel("MMM", "3841", "en"), "Industrial conglomerate");
  assert.equal(sectorLabel("XYZ1", "2099", "en"), "Manufacturing");
  assert.equal(sectorLabel("NVDA", null, "en"), null);
  assert.equal(FUND_SECTOR.uk, "Біржовий фонд");
});

test("the generated SEC data is dated and holds the companies the page names, each record in its shape", () => {
  assert.match(COMPANY_FACTS_READ_AT, /^\d{4}-\d{2}-\d{2}$/);
  for (const symbol of ["NVDA", "AAPL", "MSFT", "TSLA", "HOOD", "CRCL"]) {
    const facts = companyFactsFor(symbol);
    assert.ok(facts, symbol);
    assert.equal(facts.kind, "operating", symbol);
    assert.ok(facts.revenue && facts.revenue.value > 0, `${symbol} revenue`);
    assert.ok(facts.shares && facts.shares.value > 0, `${symbol} shares`);
    assert.match(facts.report.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//, symbol);
  }
  for (const record of Object.values(COMPANY_FACTS)) {
    assert.ok(["operating", "fund", "other"].includes(record.kind));
    for (const figure of [record.revenue, record.netIncome, record.eps, record.dividend]) {
      if (figure) assert.ok(["ttm", "fy", "ytd"].includes(figure.basis) && /^\d{4}-\d{2}-\d{2}$/.test(figure.end));
    }
  }
  assert.equal(companyFactsFor("GLD")?.kind, "fund");
  assert.equal(companyFactsFor(null), null);
});

test("what a company does is one line in both languages; a fund says what it holds; nothing is made up for the rest", () => {
  assert.equal(companyLine("NVDA", "uk"), "Чипи для ШІ й дата-центрів, відеокарти GeForce");
  assert.equal(companyLine("BRK.B", "en"), "Berkshire Hathaway — insurance, railways, energy and investments");
  assert.equal(companyLine("SPY", "uk"), "500 найбільших компаній США — індекс S&P 500");
  assert.equal(companyLine("SPACEX", "en"), "Falcon rockets, Starship and Starlink satellite internet");
  assert.equal(companyLine("ZZZZ", "en"), null);
  assert.ok(isKnownFund("QQQ"));
  assert.ok(!isKnownFund("NVDA"));
});

test("no line of what a company does gives a view, a forecast or a superlative about it (an index's own definition — «500 найбільших» — is a fund's, not a view)", () => {
  for (const symbol of ["NVDA", "AAPL", "TSLA", "MSTR", "COIN", "HOOD", "SPACEX", "OPENAI", "TSM", "JPM", "WMT", "BRK.B"]) {
    for (const lang of ["en", "uk"]) {
      const line = companyLine(symbol, lang) ?? "";
      assert.doesNotMatch(line, /\b(best|leading|largest|leader|undervalued|growth stock|buy)\b|найкращ|лідер|найбільш[иа]й|недооцін|купуй/i, `${symbol} ${lang}: ${line}`);
    }
  }
});
