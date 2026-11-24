import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { notAStock } from "../../lib/stocks/pool-facts.ts";
import { stockLineOf, stockWhyOf } from "./position-line.ts";
import { STOCK_POSITION } from "./words.ts";

/* The one line before the signature of a position in a stock's pool, and what stands behind its «i». */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const facts = (over = {}) => ({ mint: ANT, isStock: true, issuer: { id: "backpack", label: "Backpack Securities" }, session: "open", nextChangeAt: null, dividendGuard: null, termsUrl: "https://learn.backpack.exchange/articles/what-is-backpack-securities", ...over });

test("the line: one short sentence of the issuer's rights; taking it back and the open's jump wait behind «i»", () => {
  /* Four lines over the button were one too many: the line is the issuer's pause, the rest behind «i». */
  assert.equal(STOCK_POSITION.en.line, "The issuer can pause this token");
  assert.equal(STOCK_POSITION.uk.line, "Емітент може призупинити цей токен");
  const open = stockLineOf(facts(), "en");
  assert.equal(open.offHours, null);
  assert.equal(stockWhyOf(STOCK_POSITION.en, open, "Backpack Securities").length, 4);
  for (const session of ["closed", "pre", "post", "unknown"]) {
    const why = stockWhyOf(STOCK_POSITION.en, stockLineOf(facts({ session }), "en"), "Backpack Securities");
    assert.match(why[0], /move or burn the token in any wallet, the pool included/, session);
    assert.equal(why[1], "Outside exchange hours the price stands still; at the open it may jump.", session);
  }
  assert.equal(stockWhyOf(STOCK_POSITION.uk, stockLineOf(facts({ session: "closed" }), "uk"), "Backpack Securities")[1], "Поза годинами біржі ціна стоїть, на відкритті може стрибнути.");
  /* Facts not read yet, or no stock: the issuer's part alone, nothing behind it guessed. */
  for (const none of [null, undefined, notAStock(ANT)]) assert.deepEqual(stockLineOf(none, "en"), { offHours: null, excluded: null, limited: null, termsUrl: null });
});

test("behind «i»: where the issuer does not offer it, as its own terms say — shown, never enforced", () => {
  const view = stockLineOf(facts(), "en");
  assert.equal(view.excluded, "the United States · the United Kingdom · the United Arab Emirates · Japan · the EU entity of Backpack");
  assert.equal(view.limited, null);
  assert.equal(view.termsUrl, "https://learn.backpack.exchange/articles/what-is-backpack-securities");
  assert.equal(stockLineOf(facts(), "uk").excluded, "США · Велика Британія · ОАЕ · Японія · ЄС-підрозділ Backpack");
  const xstocks = stockLineOf(facts({ issuer: { id: "xstocks", label: "xStocks · Backed Finance" } }), "en");
  assert.match(xstocks.excluded, /Syria and jurisdictions the FATF calls high-risk$/);
  assert.equal(xstocks.limited, "the United Kingdom — qualified investors only");
});

test("the words: a person's, both languages, no word of the token program and no promise of income", () => {
  for (const lang of ["en", "uk"]) {
    const w = STOCK_POSITION[lang];
    const all = [w.label, w.line, w.issuerWhy("Backpack Securities"), w.hoursWhy, w.notOffered("X"), w.limited("X"), w.careWhy].join(" ");
    assert.doesNotMatch(all, /Token-?2022|delegate|делегат|hook|хук|extension|розширенн|mint|мінт|APY|APR|дохід гарант|guarantee|x1000/i, lang);
  }
  assert.deepEqual(Object.keys(STOCK_POSITION.en).sort(), Object.keys(STOCK_POSITION.uk).sort());
});

test("the DLMM Pro ticket draws the stock's line in place of the volatile pair's line — one line, not two", () => {
  const ticket = code("../earn/ProTicket.tsx");
  assert.match(ticket, /\{pier\.stock \? <StockPositionLine mint=\{other\.mint\} issuer=\{pier\.stock\.issuer\} \/> : risk\}/);
  const line = code("./StockPositionLine.tsx");
  assert.match(line, /useStockPoolFacts\(mint, given\)/, "the ticket hands no facts: the line reads them itself");
  assert.match(line, /<OneLine /);
  assert.doesNotMatch(read("./stocks.module.css").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "colours only from the tokens");
});
