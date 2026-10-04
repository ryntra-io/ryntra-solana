// Run from repo root: node --test lib/site/company-seo.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { companyPathFor } from "../stocks/company-path.ts";
import { LIFECYCLE_EVENTS } from "../stocks/lifecycle-events.ts";
import { DESCRIPTION_MAX, TITLE_MAX, companySearchDescription, companySearchTitle } from "./company-seo.ts";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const spacexEvent = LIFECYCLE_EVENTS.find((event) => event.watch?.symbol === "SPACEX");
const spcx = spacexEvent.watch.into;

const operating = { kind: "operating", foreign: false };
const COMPANIES = {
  NVDAx: { name: "NVIDIA", symbol: "NVDAx", issuer: "xstocks", instrumentClass: "listed-equity", facts: operating, path: null },
  SPYx: { name: "S&P 500", symbol: "SPYx", issuer: "xstocks", instrumentClass: "listed-equity", facts: { kind: "fund", foreign: false }, path: null },
  DJT: { name: "Trump Media & Technology Group", symbol: "DJT", issuer: "backpack", instrumentClass: "listed-equity", facts: operating, path: null },
  OPENAI: { name: "OpenAI", symbol: "OPENAI", issuer: "prestocks", instrumentClass: "pre-ipo", facts: null, path: null },
  SPACEX: {
    name: "SpaceX", symbol: "SPACEX", issuer: "prestocks", instrumentClass: "pre-ipo", facts: null,
    path: companyPathFor({ mint: spacexEvent.mint, symbol: "SPACEX", issuerId: "prestocks", instrumentClass: "pre-ipo" }, NOW),
  },
  SPCXx: {
    name: "SpaceX", symbol: "SPCXx", issuer: "xstocks", instrumentClass: "listed-equity", facts: null,
    path: companyPathFor({ mint: spcx.mint, symbol: spcx.symbol, issuerId: "xstocks", instrumentClass: "listed-equity" }, NOW),
  },
  /* A foreign filer: no SEC figures on the page, so none promised. */
  ASML: { name: "ASML Holding", symbol: "ASMLx", issuer: "xstocks", instrumentClass: "listed-equity", facts: { kind: "operating", foreign: true }, path: null },
};

test("the worked examples read word for word in both languages", () => {
  const en = (id) => [companySearchTitle(COMPANIES[id], "en"), companySearchDescription(COMPANIES[id], "en")];
  const uk = (id) => [companySearchTitle(COMPANIES[id], "uk"), companySearchDescription(COMPANIES[id], "uk")];
  assert.deepEqual(en("NVDAx"), ["NVIDIA (NVDAx) — tokenized stock · Ryntra", "NVDAx is a token that tracks NVIDIA's share price (xStocks). The price in $, key figures from SEC filings, what you buy — and a purchase in dollars."]);
  assert.deepEqual(uk("NVDAx"), ["NVIDIA (NVDAx) — токенізована акція · Ryntra", "NVDAx — токен, що відстежує ціну акції NVIDIA (xStocks). Ціна в $, ключові показники зі звітів SEC, що ти купуєш — і купівля в доларах."]);
  assert.equal(en("SPYx")[0], "S&P 500 (SPYx) — tokenized fund · Ryntra");
  assert.equal(uk("SPYx")[0], "S&P 500 (SPYx) — токенізований фонд · Ryntra");
  assert.deepEqual(en("DJT"), ["Trump Media & Technology Group (DJT) — tokenized stock", "DJT is a Backpack token that tracks the share price of Trump Media & Technology Group. The price in $, key figures from SEC filings and what you buy."]);
  assert.deepEqual(en("OPENAI"), ["OpenAI (OPENAI) — pre-IPO token by PreStocks · Ryntra", "OPENAI is PreStocks' token of economic exposure to OpenAI — not a share. The price against PreStocks' valuation, the path to an IPO, and the risks."]);
  assert.deepEqual(uk("OPENAI"), ["OpenAI (OPENAI) — токен до IPO від PreStocks · Ryntra", "OPENAI — токен PreStocks з економічною експозицією на OpenAI, не акція. Ціна до оцінки PreStocks, шлях до IPO і ризики."]);
  assert.deepEqual(en("SPACEX"), ["SpaceX (SPACEX) — PreStocks token after the IPO · Ryntra", "SPACEX is a PreStocks token, not a share. SpaceX is listed on Nasdaq: swap SPACEX for SPCXx by 12 Mar 2027, 23:59 UTC, or the token expires."]);
  assert.deepEqual(uk("SPACEX"), ["SpaceX (SPACEX) — токен PreStocks після IPO · Ryntra", "SPACEX — токен PreStocks, не акція. SpaceX уже на Nasdaq: обміняй SPACEX на SPCXx до 12.03.2027, 23:59 UTC, інакше токен згорить."]);
  assert.deepEqual(en("SPCXx"), ["SpaceX (SPCXx) — tokenized stock · Ryntra", "SPCXx is a token that tracks SpaceX's share price on Nasdaq (xStocks). The price in $, the company's path from PreStocks to Nasdaq, and what you buy."]);
});

test("every title fits 60 and every description 160, and none names a price or «from $1»", () => {
  for (const company of Object.values(COMPANIES)) {
    for (const locale of ["en", "uk"]) {
      const title = companySearchTitle(company, locale);
      const description = companySearchDescription(company, locale);
      assert.ok(title.length <= TITLE_MAX, `${company.symbol} ${locale} title ${title.length}`);
      assert.ok(description.length <= DESCRIPTION_MAX, `${company.symbol} ${locale} description ${description.length}`);
      assert.ok(title.startsWith(company.name), "the company's name first, never the token's");
      assert.doesNotMatch(`${title} ${description}`, /\$\s?\d|від \$1|from \$1|\d+(?:[.,]\d+)?\s?%/u);
    }
  }
  /* A foreign filer's page carries no SEC figures, so its words promise none. */
  assert.doesNotMatch(companySearchDescription(COMPANIES.ASML, "en"), /SEC/);
  assert.doesNotMatch(companySearchDescription(COMPANIES.ASML, "uk"), /SEC/);
});

test("a name too long for the full title falls back to a shorter form, never a cut word", () => {
  const long = { ...COMPANIES.NVDAx, name: "The Very Long Name of an International Holding Company", symbol: "LONGx" };
  const title = companySearchTitle(long, "en");
  assert.ok(title.length <= TITLE_MAX || title === `${long.name} (${long.symbol})`);
  assert.ok(title.startsWith(long.name));
  const description = companySearchDescription(long, "uk");
  assert.ok(description.length <= DESCRIPTION_MAX);
});
