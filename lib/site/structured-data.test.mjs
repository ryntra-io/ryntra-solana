// Run from repo root: node --test lib/site/structured-data.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ORGANIZATION_ID, WEBSITE_ID, breadcrumbList, companyEntity, itemList, jsonLdScript, techArticle, webPage } from "./structured-data.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a page names itself, its language, its site and its publisher", () => {
  const page = webPage({ type: "AboutPage", url: "https://ryntra.io/uk/company", name: "Про Ryntra", description: "…", locale: "uk", crumbs: [] });
  assert.equal(page["@type"], "AboutPage");
  assert.equal(page["@id"], "https://ryntra.io/uk/company#page");
  assert.equal(page.inLanguage, "uk");
  assert.deepEqual(page.isPartOf, { "@id": WEBSITE_ID });
  assert.deepEqual(page.publisher, { "@id": ORGANIZATION_ID });
  assert.deepEqual(page.breadcrumb, { "@id": "https://ryntra.io/uk/company#breadcrumbs" });
  const crumbs = breadcrumbList("https://ryntra.io/uk/company", [{ name: "Ryntra", url: "https://ryntra.io/uk" }, { name: "Про Ryntra", url: "https://ryntra.io/uk/company" }]);
  assert.deepEqual(crumbs.itemListElement.map((item) => [item.position, item.item]), [[1, "https://ryntra.io/uk"], [2, "https://ryntra.io/uk/company"]]);
  const article = techArticle({ url: "https://ryntra.io/docs/invest/buy", headline: "Buy", description: "…", locale: "en", dateModified: "2026-09-26", section: "Invest" });
  assert.equal(article["@type"], "TechArticle");
  assert.equal(article.dateModified, "2026-09-26");
});

test("a company page is about the company — never a product with a price or a rating", () => {
  assert.deepEqual(companyEntity({ name: "NVIDIA", tickerSymbol: "NVDA" }), { "@type": "Corporation", name: "NVIDIA", tickerSymbol: "NVDA" });
  assert.deepEqual(companyEntity({ name: "OpenAI", tickerSymbol: null }), { "@type": "Organization", name: "OpenAI" });
  const list = itemList("https://ryntra.io/app/markets", [{ name: "NVIDIA", url: "https://ryntra.io/app/stocks/NVDAx" }]);
  assert.equal(list.numberOfItems, 1);
  for (const source of [read("./structured-data.ts"), read("../../app/app/stocks/[ticker]/page.tsx"), read("../../app/app/markets/page.tsx")]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /"Product"|"Offer"|aggregateRating|priceCurrency|lowPrice|"price"/);
  }
});

test("no string in a graph can close its script", () => {
  const script = jsonLdScript([webPage({ url: "https://ryntra.io/x", name: "</script><script>alert(1)</script>", description: "a < b", locale: "en" })]);
  assert.doesNotMatch(script, /<\/script>|</);
  assert.equal(JSON.parse(script)[0].name, "</script><script>alert(1)</script>");
});
