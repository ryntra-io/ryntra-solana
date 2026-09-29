// Run from repo root: node --test lib/site/localized.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DOC_PAGES } from "../../app/docs/content/index.ts";
import { DOC_SLUGS, hasUkAddress, languageSwitchHref, localizedPath, pagePath, splitUkPrefix } from "./localized.ts";

test("the documentation's addresses here are exactly its pages", () => {
  assert.deepEqual([...DOC_SLUGS].sort(), DOC_PAGES.map((page) => page.slug).filter(Boolean).sort());
});

test("every page offered to the index has a Ukrainian address, and nothing else does", () => {
  for (const path of ["/", "/app/home", "/app/markets", "/app/stocks/NVDAx", "/app/stocks/SPACEX", "/company", "/security", "/methodology", "/contact", "/support", "/stats", "/docs", "/docs/invest/buy", "/docs/reference/faq"]) {
    assert.equal(hasUkAddress(path), true, path);
  }
  for (const path of [
    "/app", "/app/portfolio", "/app/stocks", "/app/stocks/screener", "/app/stocks/NVDAx/extra", "/app/autoinvest", "/app/rewards",
    "/legal/terms", "/legal/privacy", "/legal/review/terms", "/verify", "/developers", "/docs/developers", "/docs/developers/guard",
    "/docs/faq", "/docs/glossary", "/docs/trade/tokenized-stocks", "/docs/reference/security", "/api/stocks", "/uk", "/uk/docs",
  ]) {
    assert.equal(hasUkAddress(path), false, path);
  }
});

test("the prefix splits off, and a link takes the Ukrainian address only where one exists", () => {
  assert.deepEqual(splitUkPrefix("/uk"), { uk: true, path: "/" });
  assert.deepEqual(splitUkPrefix("/uk/docs/invest/buy"), { uk: true, path: "/docs/invest/buy" });
  assert.deepEqual(splitUkPrefix("/ukraine"), { uk: false, path: "/ukraine" });
  assert.equal(pagePath("/uk/app/markets"), "/app/markets");
  assert.equal(pagePath("/app/markets"), "/app/markets");

  assert.equal(localizedPath("/", "uk"), "/uk");
  assert.equal(localizedPath("/docs", "uk"), "/uk/docs");
  assert.equal(localizedPath("/app/stocks/NVDAx?rule=r1&due=x", "uk"), "/uk/app/stocks/NVDAx?rule=r1&due=x");
  assert.equal(localizedPath("/docs/invest/buy#reserve", "uk"), "/uk/docs/invest/buy#reserve");
  assert.equal(localizedPath("/app/autoinvest", "uk"), "/app/autoinvest", "the app's own pages keep one address");
  assert.equal(localizedPath("/legal/terms", "uk"), "/legal/terms", "the legal texts are English until a lawyer's word");
  assert.equal(localizedPath("/uk/docs", "uk"), "/uk/docs", "never twice");
  assert.equal(localizedPath("/docs", "en"), "/docs");
  assert.equal(localizedPath("https://x.com/Ryntra_io", "uk"), "https://x.com/Ryntra_io");
});

test("choosing a language goes to that language's address, or asks the page again where it has one", () => {
  assert.equal(languageSwitchHref("/uk/docs/invest/buy", "", "en"), "/docs/invest/buy");
  assert.equal(languageSwitchHref("/docs/invest/buy", "", "uk"), "/uk/docs/invest/buy");
  assert.equal(languageSwitchHref("/uk", "", "en"), "/");
  assert.equal(languageSwitchHref("/", "", "uk"), "/uk");
  assert.equal(languageSwitchHref("/uk/app/markets", "?tab=crypto", "en"), "/app/markets?tab=crypto");
  assert.equal(languageSwitchHref("/app/portfolio", "", "uk"), null);
  assert.equal(languageSwitchHref("/legal/terms", "", "uk"), null);
});

test("the app's menus and the site's header mark the page by its own path, at either language's address", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const shell = read("app/shell/app-shell.tsx");
  /* The rail, the phone's bar and the workspace all read the page's path — `/uk/app/markets` marks Markets. */
  assert.doesNotMatch(shell, /usePathname\(/, "the shell never matches a route against the raw address");
  assert.equal((shell.match(/usePagePath\(\)/g) ?? []).length, 3);
  assert.match(read("app/site/frozen/public-header.tsx"), /const page = pagePath\(pathname\);/);
  assert.match(read("app/docs/docs-experience.tsx"), /const active = pagePath\(pathname\) === item\.href;/);
});
