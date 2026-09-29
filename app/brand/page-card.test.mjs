// Run from repo root: node --test app/brand/page-card.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DOC_PAGES } from "../docs/content/index.ts";
import { PAGE_CARD_IDS, cardAlt, cardPath, companyCard, docsCard, marketsCard, pageCard } from "./page-card.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every page offered to the index has a card of its own, in both languages", () => {
  for (const locale of ["en", "uk"]) {
    for (const id of PAGE_CARD_IDS) {
      const card = pageCard(id, locale);
      assert.ok(card.eyebrow && card.headline, `${id} ${locale}`);
      assert.equal(card.token, null);
    }
    for (const page of DOC_PAGES) {
      const card = docsCard(page.slug, locale);
      assert.ok(card, `docs ${page.slug} ${locale}`);
      assert.equal(card.headline, page.title[locale]);
      assert.equal(card.context, page.summary[locale]);
      assert.match(card.eyebrow, locale === "uk" ? /^Документація Ryntra/ : /^Ryntra Docs/);
    }
    assert.equal(docsCard("no/such/page", locale), null, "an unknown page has no card");
    assert.match(marketsCard(locale).headline, locale === "uk" ? /Токенізовані акції на Solana/ : /Tokenized stocks on Solana/);
  }
});

test("a company's card says what the token is in its issuer's words, never a price or «from $1»", () => {
  const nvda = companyCard({ name: "NVIDIA", symbol: "NVDAx", issuer: "xstocks", icon: null }, "uk");
  assert.deepEqual(nvda, { eyebrow: "Трекер із забезпеченням · xStocks", headline: "NVIDIA", token: "NVDAx", context: "У твоєму гаманці, на Solana.", icon: null });
  const openai = companyCard({ name: "OpenAI", symbol: "OPENAI", issuer: "prestocks", icon: null }, "en");
  assert.equal(openai.eyebrow, "Economic exposure · private · PreStocks");
  assert.equal(companyCard({ name: "Trump Media & Technology Group", symbol: "DJT", issuer: "backpack", icon: null }, "en").eyebrow, "Tracker · exchangeable for the share · Backpack");
  for (const card of [nvda, openai]) {
    assert.doesNotMatch(JSON.stringify(card), /\$\s?\d|від \$1|from \$1/);
  }
  assert.equal(cardAlt(nvda), "Трекер із забезпеченням · xStocks — NVIDIA (NVDAx) — У твоєму гаманці, на Solana.");
});

test("a card's address carries the fingerprint of everything drawn on it", () => {
  const card = docsCard("invest/buy", "uk");
  const path = cardPath("uk", ["docs", "invest", "buy"], card);
  assert.match(path, /^\/og\/uk\/docs\/invest\/buy\?v=[0-9a-f]{8}$/);
  assert.equal(cardPath("uk", ["docs", "invest", "buy"], card), path, "the same card, the same address");
  assert.notEqual(cardPath("uk", ["docs", "invest", "buy"], { ...card, headline: "Changed" }), path, "a changed card is a new address");
  assert.notEqual(cardPath("en", ["docs", "invest", "buy"], card), path);
  /* The route answers exactly the addresses the pages name, and nothing under `/api/` — robots keeps crawlers out of that. */
  const route = read("../og/[locale]/[...key]/route.tsx");
  assert.match(route, /kind === "markets"/);
  assert.match(route, /kind === "page" && rest\.length === 1 && isPageCardId/);
  assert.match(route, /kind === "docs"/);
  assert.match(route, /kind === "company"/);
  /* The drawing: no drop shadow under the R — satori draws it as a box. */
  assert.doesNotMatch(read("./page-og.tsx"), /drop-shadow/);
});
