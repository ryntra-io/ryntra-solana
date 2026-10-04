import assert from "node:assert/strict";
import test from "node:test";

import { menuNavigation } from "../../app/shell/domains.ts";
import { PRODUCT_ROUTES } from "../../app/shell/product-routes.ts";
import { isSearchIndex, normalize, RESULT_LIMITS, searchActions, searchProduct } from "./product-search.ts";

/**
 * The product's search: one field that finds a company, a coin or an action.
 * The actions are the menu's own rows, so the search can never offer a page
 * the menu does not draw — the prediction demo included — and a match inside
 * a word counts only from three letters on.
 */

const card = (name, ticker, volume24h = 1) => ({ name, ticker, mint: `${ticker}-mint`, icon: null, price: 10, change24h: 0, volume24h, issuer: "xstocks" });
const coin = (name, symbol, volume24h = 1) => ({ name, symbol, mint: `${symbol}-mint`, icon: null, price: 1, change24h: 0, volume24h });

const INDEX = {
  companies: [card("NVIDIA", "NVDAx", 900), card("Apple", "AAPLx", 800), card("SpaceX", "SPCXx", 700), card("S&P 500", "SPYx", 600)],
  privateCompanies: [card("OpenAI", "OPENAI", 50)],
  coins: [coin("Solana", "SOL", 5000), coin("Jupiter", "JUP", 400)],
  memes: [coin("Bonk", "BONK", 300)],
  dollars: [coin("USD Coin", "USDC", 9000)],
};

for (const locale of ["en", "uk"]) {
  test(`${locale}: every action is a row the menu draws, plus Notifications and Settings — nothing the menu hides`, () => {
    const actions = searchActions(PRODUCT_ROUTES, locale);
    const menu = menuNavigation(PRODUCT_ROUTES, locale);
    const rows = menu.sections.flatMap((section) => section.rows.map((row) => row.href));
    assert.deepEqual(
      actions.map((action) => action.href),
      [...rows, "/app/alerts", menu.settings.href],
    );
    assert.equal(actions.some((action) => action.href.startsWith("/app/predictions")), false, "the prediction demo is off the surface");
    for (const action of actions) assert.ok(action.label.trim().length > 0, `${action.id} has a label`);
  });
}

test("an empty query offers the starter actions and no shelf", () => {
  const actions = searchActions(PRODUCT_ROUTES, "uk");
  const found = searchProduct(INDEX, actions, "   ");
  assert.deepEqual(
    found.actions.map((action) => action.href),
    ["/app/markets", "/app/top-up", "/app/autoinvest", "/app/activity", "/app/alerts", "/app/settings"],
  );
  assert.deepEqual([found.companies, found.privateCompanies, found.coins], [[], [], []]);
});

test("two letters match the start of a word, never the inside of one", () => {
  const actions = searchActions(PRODUCT_ROUTES, "uk");
  const labels = searchProduct(null, actions, "по").actions.map((action) => action.label);
  assert.ok(labels.includes("Поповнити"));
  assert.ok(labels.includes("Позиції"));
  assert.equal(labels.includes("Спот"), false, "«по» inside «Спот» is noise, not an answer");
  /* From three letters a match inside a word counts. */
  assert.ok(searchProduct(null, actions, "інвест").actions.some((action) => action.label === "Автоінвест"));
});

test("a person's own words find an action in either language", () => {
  const en = searchActions(PRODUCT_ROUTES, "en");
  const uk = searchActions(PRODUCT_ROUTES, "uk");
  assert.equal(searchProduct(null, uk, "history").actions[0].href, "/app/activity");
  assert.equal(searchProduct(null, en, "історія").actions[0].href, "/app/activity");
  assert.equal(searchProduct(null, uk, "сповіщення").actions[0].href, "/app/alerts");
  assert.equal(searchProduct(null, en, "language").actions[0].href, "/app/settings");
});

test("one letter finds a company, a coin and an action together", () => {
  const found = searchProduct(INDEX, searchActions(PRODUCT_ROUTES, "en"), "s");
  assert.ok(found.actions.some((action) => action.label === "Swap"));
  assert.deepEqual(found.companies.map((company) => company.name), ["SpaceX", "S&P 500"]);
  assert.deepEqual(found.coins.map((entry) => [entry.name, entry.kind]), [["Solana", "crypto"]]);
});

test("a ticker finds its company; a whole name ranks before a partial one; volume breaks the tie", () => {
  const actions = searchActions(PRODUCT_ROUTES, "en");
  assert.deepEqual(searchProduct(INDEX, actions, "aaplx").companies.map((company) => company.name), ["Apple"]);
  assert.deepEqual(searchProduct(INDEX, actions, "usdc").coins.map((entry) => [entry.symbol, entry.kind]), [["USDC", "dollar"]]);
  assert.deepEqual(searchProduct(INDEX, actions, "openai").privateCompanies.map((company) => company.ticker), ["OPENAI"]);
  assert.deepEqual(searchProduct(INDEX, actions, "bonk").coins.map((entry) => entry.kind), ["meme"]);
});

test("each group is capped, and a coin listed twice is shown once", () => {
  const many = {
    ...INDEX,
    companies: Array.from({ length: 12 }, (_, i) => card(`Stock ${i}`, `S${i}x`, i)),
    coins: [coin("Solana", "SOL", 5), ...Array.from({ length: 10 }, (_, i) => coin(`Sun ${i}`, `SUN${i}`, i))],
    memes: [coin("Solana", "SOL", 5)],
  };
  const found = searchProduct(many, searchActions(PRODUCT_ROUTES, "en"), "s");
  assert.equal(found.companies.length, RESULT_LIMITS.companies);
  assert.equal(found.coins.length, RESULT_LIMITS.coins);
  assert.equal(found.coins.filter((entry) => entry.mint === "SOL-mint").length, 1);
  assert.ok(found.actions.length <= RESULT_LIMITS.actions);
});

test("without an index the actions still answer", () => {
  const found = searchProduct(null, searchActions(PRODUCT_ROUTES, "uk"), "міст");
  assert.equal(found.actions[0].href, "/app/bridge");
  assert.deepEqual([found.companies, found.coins], [[], []]);
});

test("normalize folds case, apostrophes and spaces", () => {
  assert.equal(normalize("  Від’єднати   Гаманець "), "від'єднати гаманець");
  assert.equal(normalize("Обʼєднати"), normalize("Об'єднати"));
});

test("isSearchIndex accepts the route's shape and nothing else", () => {
  assert.equal(isSearchIndex(INDEX), true);
  assert.equal(isSearchIndex({ ...INDEX, coins: null }), false);
  assert.equal(isSearchIndex(null), false);
  assert.equal(isSearchIndex("index"), false);
});
