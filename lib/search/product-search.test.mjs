import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FUTURES_NOW, MENU_ACTION, MENU_SECTIONS, menuNavigation } from "../../app/shell/domains.ts";
import { PRODUCT_ROUTES } from "../../app/shell/product-routes.ts";
import { addressOf, CUSTOMIZE_HREF, isSearchIndex, normalize, RESULT_LIMITS, searchActions, searchProduct } from "./product-search.ts";

/**
 * The product's search: one field that finds a token by its name, its ticker
 * or its contract address, a company, or an action. The actions are the
 * menu's own sections and their tabs, so the search can never offer a page
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
  test(`${locale}: every action is a row the menu draws, the pages under a row, the launch, Notifications and Settings — nothing the menu hides`, () => {
    const actions = searchActions(PRODUCT_ROUTES, locale);
    const menu = menuNavigation(PRODUCT_ROUTES, locale);
    const rows = menu.groups.flatMap((group) => group.rows.map((row) => row.href));
    assert.deepEqual(
      actions.map((action) => action.href),
      [...rows, "/app/launch/mine", "/app/bots/catalog", MENU_ACTION.href, "/app/alerts", CUSTOMIZE_HREF, menu.settings.href],
    );
    /* A row is hinted by its group; Home by nothing. */
    const hint = (id) => actions.find((action) => action.id === id)?.hint;
    assert.equal(hint("send"), locale === "uk" ? "Гроші" : "Money");
    assert.equal(hint("launch-mine"), MENU_SECTIONS.launch.label[locale]);
    assert.equal(hint("home"), null);
    assert.equal(new Set(actions.map((action) => action.id)).size, actions.length, "two actions share an id");
    /* The two actions people look for first: «Запустити токен» and «Поповнити». */
    const label = (id) => actions.find((action) => action.id === id)?.label;
    assert.equal(label("launch-new"), locale === "uk" ? "Запустити токен" : "Launch a token");
    assert.equal(label("deposit"), locale === "uk" ? "Поповнити" : "Add funds");
    /* Прогнози is a row of Торгівля, so the search finds it as one. */
    assert.equal(actions.filter((action) => action.href === "/app/predictions").length, 1, "Predictions is one action of the search");
    /* One Perps, Phoenix's, saying what it lets a person do now; no other product at its own address (SOL-C2). «Perps»
       in both languages (PERP-1); the old words still find it. */
    const futures = actions.filter((action) => /perps|futures|ф'ючерс/i.test(`${action.label} ${action.hint}`));
    assert.deepEqual(futures.map((action) => [action.label, action.href]), [["Perps", "/app/perps"]]);
    for (const query of ["perps", "perp", "перпи", "ф'ючерси", "futures"]) {
      assert.equal(searchProduct(INDEX, actions, query).actions[0]?.href, "/app/perps", `«${query}» does not find Perps first`);
    }
    assert.equal(futures[0].hint, `${locale === "uk" ? "Торгівля" : "Trading"} · Phoenix · ${FUTURES_NOW[locale]}`);
    assert.ok(!actions.some((action) => /^https?:/.test(action.href)), "an action leads out of Solana");
    for (const action of actions) assert.ok(action.label.trim().length > 0, `${action.id} has a label`);
  });
}

test("an empty query offers the starter actions and no shelf", () => {
  const actions = searchActions(PRODUCT_ROUTES, "uk");
  const found = searchProduct(INDEX, actions, "   ");
  assert.deepEqual(
    found.actions.map((action) => action.href),
    ["/app/markets", "/app/launch/new", "/app/top-up", "/app/send", "/app/activity", CUSTOMIZE_HREF],
  );
  assert.deepEqual([found.companies, found.privateCompanies, found.coins], [[], [], []]);
});

test("two letters match the start of a word, never the inside of one", () => {
  const actions = searchActions(PRODUCT_ROUTES, "uk");
  const labels = searchProduct(null, actions, "по").actions.map((action) => action.label);
  assert.ok(labels.includes("Поповнити"));
  /* «Портфель» and «Позиції» open one page: the search answers once for it. */
  assert.ok(labels.includes("Портфель") !== labels.includes("Позиції"), "one place answers twice");
  assert.equal(new Set(searchProduct(null, actions, "боти").actions.map((action) => action.href)).size, searchProduct(null, actions, "боти").actions.length, "a page is offered twice");
  assert.equal(labels.includes("Спот"), false, "«по» inside «Спот» is noise, not an answer");
  /* From three letters a match inside a word counts. */
  assert.ok(searchProduct(null, actions, "тфель").actions.some((action) => action.label === "Портфель"));
});

test("a person's own words find an action in either language", () => {
  const en = searchActions(PRODUCT_ROUTES, "en");
  const uk = searchActions(PRODUCT_ROUTES, "uk");
  assert.equal(searchProduct(null, uk, "history").actions[0].href, "/app/activity");
  assert.equal(searchProduct(null, en, "історія").actions[0].href, "/app/activity");
  assert.equal(searchProduct(null, uk, "сповіщення").actions[0].href, "/app/alerts");
  /* The theme and the language open the menu's own «Налаштування»; the account's words open its page (UX-013). */
  for (const [actions, query] of [[en, "language"], [uk, "мова"], [uk, "тема"], [en, "settings"], [uk, "налаштування"]]) {
    assert.equal(searchProduct(null, actions, query).actions[0].href, CUSTOMIZE_HREF, query);
  }
  for (const [actions, query] of [[en, "account"], [uk, "акаунт"], [uk, "telegram"]]) {
    assert.equal(searchProduct(null, actions, query).actions[0].href, "/app/settings", query);
  }
  assert.equal(searchProduct(null, uk, "hyperliquid").actions.length, 0, "the paused terminal is found from Solana again");
});

test("«SOL» + Enter opens Solana, not «Поповнити»: the group with the best match stands first (UX-002)", () => {
  for (const locale of ["en", "uk"]) {
    const actions = searchActions(PRODUCT_ROUTES, locale);
    for (const query of ["SOL", "sol", "Solana", "USDC"]) {
      const found = searchProduct(INDEX, actions, query);
      assert.equal(found.order[0], "coins", `${locale} ${query}: ${found.order.join(", ")}`);
      assert.ok(!found.actions.some((action) => action.href === "/app/top-up"), `${locale} ${query} finds «Поповнити»`);
    }
    assert.equal(searchProduct(INDEX, actions, "SOL").coins[0].symbol, "SOL");
    /* A company's whole ticker leads too; an action's whole word keeps it first on a tie. */
    assert.equal(searchProduct(INDEX, actions, "nvdax").order[0], "companies");
    assert.equal(searchProduct(INDEX, actions, locale === "uk" ? "обмін" : "swap").order[0], "actions");
    assert.equal(searchProduct(INDEX, actions, locale === "uk" ? "поповнити" : "top up").actions[0].href, "/app/top-up");
    /* Nothing typed: the starters, actions first. */
    assert.equal(searchProduct(INDEX, actions, "").order[0], "actions");
  }
  /* The dialog draws the groups in that order, so the first row — the one Enter opens — is the best match. */
  const ui = fs.readFileSync(new URL("../../app/app/search/product-search.tsx", import.meta.url), "utf8");
  assert.match(ui, /\.sort\(\(a, b\) => rank\(a\.id\) - rank\(b\.id\)\)/);
  assert.match(ui, /if \(row\.href === CUSTOMIZE_HREF\) \{\s*openCustomize\(\);/);
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

test("a pasted contract address is a token: it opens the token's page, and finds the row that carries it", () => {
  const actions = searchActions(PRODUCT_ROUTES, "uk");
  const mint = "So11111111111111111111111111111111111111112";
  assert.equal(addressOf(`  ${mint} `), mint);
  assert.equal(addressOf("NVDAx"), null, "a ticker is not an address");
  assert.equal(addressOf("0x52908400098527886E0F7030069857D2E4169EE7"), null, "an EVM address is not a Solana token");
  assert.equal(searchProduct(INDEX, actions, mint).address, mint);
  assert.equal(searchProduct(INDEX, actions, "sol").address, null);
  assert.equal(searchProduct(INDEX, actions, "   ").address, null);
  /* A mint the index carries finds its own row as well. */
  assert.deepEqual(searchProduct(INDEX, actions, "AAPLx-mint").companies.map((company) => company.name), ["Apple"]);
  /* The header opens it at the token's page, which finds whose it is. */
  const ui = fs.readFileSync(new URL("../../app/app/search/product-search.tsx", import.meta.url), "utf8");
  assert.match(ui, /href: `\/app\/token\/\$\{results\.address\}`/);
  const page = fs.readFileSync(new URL("../../app/app/token/[mint]/page.tsx", import.meta.url), "utf8");
  for (const destination of ["/app/stocks/", "/app/launch/", "/app/spot?mint="]) assert.ok(page.includes(destination), `the token's page never leads to ${destination}`);
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
