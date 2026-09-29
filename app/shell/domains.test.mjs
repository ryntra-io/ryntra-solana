import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

import {
  FORBIDDEN_NAV_WORDS,
  GROUP_LABELS,
  IN_PLACE_LABELS,
  MENU_DESTINATIONS,
  MENU_FOOT,
  MENU_PAGE_LABELS,
  MENU_SECTION_IDS,
  MENU_SECTION_LABELS,
  OFF_SURFACE,
  PAGE_GROUP,
  PAGE_LABELS,
  PAGE_PLACE,
  PLACE_IDS,
  PLACE_LABELS,
  PLACE_PAGES,
  PLACES,
  PRODUCT_GROUP_IDS,
  PRODUCT_PAGE_IDS,
  SECONDARY_LABELS,
  drawn,
  menuNavigation,
  mobileNavigation,
  pageActiveHref,
  placePages,
  productNavigation,
  registeredPages,
} from "./domains.ts";
import { PRODUCT_ROUTES } from "./product-routes.ts";

/**
 * The navigation contract, pinned.
 *
 * Canon v5.3 (adopted 2026-09-24, MASTER-PLAN В28, §3): one version for
 * everyone — one menu of five places, Головна · Ринки · Ryntra · Портфель ·
 * Ще, the same on the web and the phone, for every person and every guest;
 * what «Профі» held a tap deeper in the same places. These tests exercise the
 * routes the shell actually consumes, so an obsolete fixture cannot keep a
 * second navigation passing after production changes.
 */

const BASE = "/app";
const ROUTES = PRODUCT_ROUTES;

test("the registry carries fifteen pages in the Owner's order, each of one kind", () => {
  assert.deepEqual(PRODUCT_PAGE_IDS, [
    "swap", "spot", "stocks", "trends", "perps", "predictions",
    "ideas", "my-strategies", "results",
    "send", "receive", "bridge", "rewards",
    "portfolio", "activity",
  ]);
  /* The registry and the routes agree on the order, so every surface that
     reads routes directly says the same sequence. */
  assert.deepEqual(ROUTES.map((route) => route.id), [...PRODUCT_PAGE_IDS]);
  assert.deepEqual(registeredPages(ROUTES, "en").map((entry) => entry.href), [
    "/app/swap", "/app/spot", "/app/stocks/screener", "/app/trends", "/app/perps", "/app/predictions",
    "/app/ideas", "/app/strategies", "/app/results",
    "/app/send", "/app/receive", "/app/bridge", "/app/rewards",
    "/app/portfolio", "/app/activity",
  ]);
  /* The four kinds of work stay a page's category — the API's capabilities
     carry it as `group` — and are no longer a menu. */
  assert.deepEqual(PRODUCT_GROUP_IDS, ["trade", "strategies", "money", "manage"]);
  for (const id of PRODUCT_PAGE_IDS) assert.ok(PRODUCT_GROUP_IDS.includes(PAGE_GROUP[id]), `${id} has no kind`);
});

test("the menu you can see — every section with its caption, nothing behind «Ще» (canon v5.4 В30)", () => {
  assert.deepEqual([...MENU_SECTION_IDS], ["home", "invest", "trade", "money", "portfolio", "agent", "rewards"]);
  const uk = menuNavigation(ROUTES, "uk");
  const shape = (menu) => menu.sections.map((section) => [section.title, section.rows.map((row) => row.label)]);
  assert.deepEqual(shape(uk), [
    [null, ["Головна"]],
    ["Інвестувати", ["Ринки", "Автоінвест"]],
    ["Торгувати", ["Обмін", "Спот", "Скринер акцій", "Тренди"]],
    ["Гроші", ["Поповнити", "Надіслати", "Отримати", "Міст"]],
    ["Портфель", ["Позиції", "Стратегії", "Результати", "Історія"]],
    [null, ["Ryntra"]],
    [null, ["Винагороди"]],
  ]);
  assert.deepEqual(uk.sections.flatMap((section) => section.rows.map((row) => row.href)), [
    "/app/home",
    "/app/markets", "/app/autoinvest",
    "/app/swap", "/app/spot", "/app/stocks/screener", "/app/trends",
    "/app/top-up", "/app/send", "/app/receive", "/app/bridge",
    "/app/portfolio", "/app/strategies", "/app/results", "/app/activity",
    "/app/ryn",
    "/app/rewards",
  ]);
  /* The assistant says it is the AI (the Owner, 2026-09-24). */
  const agent = uk.sections.find((section) => section.id === "agent").rows[0];
  assert.equal(agent.caption, "ШІ-помічник");
  assert.equal(menuNavigation(ROUTES, "en").sections.find((section) => section.id === "agent").rows[0].caption, "AI assistant");
  /* The foot: Відгук, then Settings. */
  assert.equal(uk.feedbackLabel, "Відгук");
  assert.equal(uk.settings.label, "Налаштування");
  assert.equal(uk.settings.href, "/app/settings");

  const en = menuNavigation(ROUTES, "en");
  assert.deepEqual(shape(en), [
    [null, ["Home"]],
    ["Invest", ["Markets", "Autoinvest"]],
    ["Trade", ["Swap", "Spot", "Stock screener", "Trends"]],
    ["Money", ["Top up", "Send", "Receive", "Bridge"]],
    ["Portfolio", ["Positions", "Strategies", "Results", "History"]],
    [null, ["Ryntra"]],
    [null, ["Rewards"]],
  ]);
  assert.equal(en.feedbackLabel, "Feedback");

  /* Nothing hidden behind «Ще» on a desk, no planned page and no page off the surface. */
  const rows = uk.sections.flatMap((section) => section.rows);
  assert.ok(!rows.some((row) => row.label === "Ще" || row.id === "more"), "the desk's menu still hides a list behind «Ще»");
  for (const route of ROUTES) {
    const listed = rows.some((row) => row.id === route.id);
    if (drawn(route)) assert.ok(listed, `${route.id} is built and on the surface, and the menu does not draw it`);
    else assert.ok(!listed, `${route.id} is drawn although it is ${route.readiness === "planned" ? "planned" : "off the surface"}`);
  }
  /* No «Ryn» where a person reads: the assistant is Ryntra. */
  for (const label of [...Object.values(PLACE_LABELS), ...Object.values(MENU_DESTINATIONS).flatMap((destination) => [destination.label, destination.caption].filter(Boolean))].flatMap((label) => [label.en, label.uk])) {
    assert.doesNotMatch(label, /\bRyn\b/);
  }
});

test("the phone keeps the five places — Головна · Ринки · Ryntra · Портфель · Ще (canon v5.3 В28, v5.4 В30)", () => {
  assert.deepEqual([...PLACE_IDS], ["home", "markets", "agent", "portfolio", "more"]);
  const uk = productNavigation(ROUTES, "uk");
  assert.deepEqual(uk.places.map((place) => place.label), ["Головна", "Ринки", "Ryntra", "Портфель"]);
  assert.deepEqual(uk.places.map((place) => place.href), ["/app/home", "/app/markets", "/app/ryn", "/app/portfolio"]);
  assert.equal(uk.more.title, "Ще");
  /* The pages «Ще» lights on a phone; the prediction demo is not one of them (В32). */
  assert.deepEqual(uk.more.entries.map((entry) => entry.label), ["Обмін", "Міст", "Надіслати", "Отримати", "Винагороди"]);
  assert.deepEqual(uk.more.entries.map((entry) => entry.href), ["/app/swap", "/app/bridge", "/app/send", "/app/receive", "/app/rewards"]);

  const en = productNavigation(ROUTES, "en");
  assert.deepEqual(en.places.map((place) => place.label), ["Home", "Markets", "Ryntra", "Portfolio"]);
  assert.equal(en.more.title, "More");
  assert.deepEqual(en.more.entries.map((entry) => entry.label), ["Swap", "Bridge", "Send", "Receive", "Rewards"]);

  /* No planned page is drawn anywhere — not in «Ще», not in a place. */
  for (const place of PLACE_IDS) {
    for (const entry of placePages(place, ROUTES, "en")) {
      assert.notEqual(ROUTES.find((route) => route.id === entry.id).readiness, "planned", `${entry.id} is planned and drawn in ${place}`);
    }
  }
  /* No «Ryn» where a person reads: the assistant's place is Ryntra. */
  for (const label of Object.values(PLACE_LABELS).flatMap((label) => [label.en, label.uk])) {
    assert.doesNotMatch(label, /\bRyn\b/);
  }
  /* Predictions stays built (canon v4.3) and off the surface (v5.4 В32); Results is a real page since RYN-RESULTS-MEMORY-001. */
  assert.equal(ROUTES.find((entry) => entry.id === "predictions").readiness, "available");
  assert.ok(OFF_SURFACE.has("predictions"));
  const predictionsPage = readFileSync(new URL("../app/predictions/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(predictionsPage, /<NotYet/, "Predictions draws the hub, not the not-yet surface");
  assert.equal(ROUTES.find((entry) => entry.id === "results").readiness, "available");
  const resultsPage = readFileSync(new URL("../app/results/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(resultsPage, /<NotYet/, "Results draws its own surface, not the not-yet one");
  assert.doesNotMatch(resultsPage, /StatusChip/, "a finished page carries no readiness chip");
  assert.match(resultsPage, /ResultsPanel/, "the panel is the page");
  /* And the rail does not tag rows: the shell reads no readiness label. */
  const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /readinessLabel/, "the shell draws a readiness tag on a rail row");
});

test("one projection, taking nothing but the routes and a language — no depth, no switch, no cookie", () => {
  for (const projector of [productNavigation, mobileNavigation, menuNavigation]) {
    assert.equal(projector.length, 2, `${projector.name} takes (routes, locale) and nothing else`);
  }
  assert.equal(placePages.length, 3, "placePages takes (place, routes, locale) and nothing else");
  const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /* The shell draws the one navigation, whatever a person once stored: the menu's sections on the rail and in «Ще», the places on a phone's bar. */
  const shell = code("./app-shell.tsx");
  assert.doesNotMatch(shell, /simpleNavigation|simpleMobileNavigation|resolveDepth\(|modeForDepth|lib\/product\/depth/, "the shell still chooses a menu by depth");
  assert.match(shell, /const navigation = product \? productNavigation\(product\.routes, product\.locale\) : null;/);
  assert.match(shell, /const menu = product \? menuNavigation\(product\.routes, product\.locale\) : null;/);
  assert.match(shell, /domainRoutes=\{menu\?\.routes\}/);
  assert.match(shell, /entries=\{mobileNavigation\(product\.routes, product\.locale\)\}/);
  /* The foot of the rail carries no «Простий»/«Профі» switch. */
  assert.doesNotMatch(code("../app/product-shell.tsx"), /DepthSwitch/, "the product rail still carries the switch");
  /* And the depth cookie decides nothing: its module is gone and nothing reads it. */
  assert.equal(existsSync(new URL("../../lib/product/depth.ts", import.meta.url)), false, "the depth cookie module is back");
  for (const path of ["../app/layout.tsx", "../app/stocks/page.tsx", "../app/stocks/[ticker]/page.tsx", "../solana/workspace/holdings/page.tsx", "./shell-state.tsx", "../../lib/product/customer-routing.ts"]) {
    assert.doesNotMatch(code(path), /ryntra-depth|DEPTH_COOKIE|depthFromCookie/, `${path} still reads the depth cookie`);
  }
});

test("every page lives in exactly one place, and the places hold what canon v5.3 says", () => {
  const listed = PLACE_IDS.flatMap((place) => PLACE_PAGES[place]);
  assert.deepEqual([...listed].sort(), [...PRODUCT_PAGE_IDS].sort(), "a page is in no place, or in two");
  assert.equal(new Set(listed).size, listed.length, "a page is listed in two places");
  for (const id of PRODUCT_PAGE_IDS) assert.ok(PLACE_PAGES[PAGE_PLACE[id]].includes(id), `${id} is placed where it is not listed`);
  assert.deepEqual(PLACE_PAGES.home, []);
  assert.deepEqual(PLACE_PAGES.markets, ["spot", "stocks", "trends", "perps"]);
  assert.deepEqual(PLACE_PAGES.agent, ["ideas"]);
  assert.deepEqual(PLACE_PAGES.portfolio, ["portfolio", "my-strategies", "results", "activity"]);
  assert.deepEqual(PLACE_PAGES.more, ["swap", "bridge", "send", "receive", "rewards", "predictions"]);
  assert.deepEqual(PLACES.map((place) => place.id), [...PLACE_IDS]);
  assert.equal(PLACES.find((place) => place.id === "more").href, null, "«Ще» opens its list, not a page");
});

test("Markets: tabs on top — Усі · Компанії · Приватні · Крипта · Меми · Долари — and «Для досвідчених» there too (canon v5.4 В33)", async () => {
  const uk = placePages("markets", ROUTES, "uk");
  assert.deepEqual(uk.map((page) => page.label), ["Спот", "Скринер", "Тренди"]);
  assert.deepEqual(uk.map((page) => page.href), ["/app/spot", "/app/stocks/screener", "/app/trends"]);
  assert.deepEqual(placePages("markets", ROUTES, "en").map((page) => page.label), ["Spot", "Screener", "Trends"]);
  const { MARKETS_TABS, isMarketsTab } = await import("../app/markets/tabs.ts");
  assert.deepEqual([...MARKETS_TABS], ["all", "companies", "private", "crypto", "memes", "dollars"]);
  assert.equal(isMarketsTab("crypto"), true);
  assert.equal(isMarketsTab("predictions"), false);
  /* The page draws the tools from the registry, above every list and whatever state the lists are in. */
  const place = readFileSync(new URL("../app/markets/markets-place.tsx", import.meta.url), "utf8");
  assert.match(place, /placePages\("markets", PRODUCT_ROUTES, locale\)/);
  assert.match(place, /<MarketsTabs locale=\{locale\} tools=\{tools\} initialTab=\{initialTab\}>/);
  for (const slot of ["<CompaniesSlot", "<CoinsSlot", "<MemesSlot"]) assert.ok(place.includes(slot), `${slot} is not on the board`);
  const surface = readFileSync(new URL("../app/markets/markets-surface.tsx", import.meta.url), "utf8");
  const tabs = surface.slice(surface.indexOf("export function MarketsTabs"), surface.indexOf("/** A list's head"));
  assert.ok(tabs.indexOf('role="tablist"') < tabs.indexOf("data-experienced-tools") && tabs.indexOf("data-experienced-tools") < tabs.indexOf('id="markets-board"'), "the tabs and «Для досвідчених» are not above the lists");
  /* In «Усі» crypto stands right after the companies, so it is on the first screen. */
  const css = readFileSync(new URL("../app/invest/invest.module.css", import.meta.url), "utf8");
  const order = (section) => Number(new RegExp(`\\.board \\[data-section="${section}"\\] \\{\\s*order: (\\d+);`).exec(css)?.[1]);
  assert.deepEqual(["companies", "crypto", "private", "memes", "dollars"].map(order), [1, 2, 3, 4, 5]);
  /* Memes say the risk before a single figure. */
  const memes = surface.slice(surface.indexOf("function MemesView"));
  assert.match(memes, /note=\{word\("memesRisk"\)\}/);
});

test("Portfolio's tabs — Позиції · Стратегії · Результати · Історія — stand on each of its four pages", () => {
  const uk = placePages("portfolio", ROUTES, "uk");
  assert.deepEqual(uk.map((page) => page.label), ["Позиції", "Стратегії", "Результати", "Історія"]);
  assert.deepEqual(uk.map((page) => page.href), ["/app/portfolio", "/app/strategies", "/app/results", "/app/activity"]);
  assert.deepEqual(placePages("portfolio", ROUTES, "en").map((page) => page.label), ["Positions", "Strategies", "Results", "History"]);
  assert.deepEqual(Object.keys(IN_PLACE_LABELS).sort(), ["my-strategies", "portfolio", "stocks"]);
  for (const path of ["../solana/workspace/holdings/page.tsx", "../app/strategies/page.tsx", "../app/results/page.tsx", "../solana/workspace/history/page.tsx"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /<PortfolioTabs locale=\{locale\} \/>/, `${path} does not draw Portfolio's tabs`);
  }
  const tabs = readFileSync(new URL("../app/portfolio/portfolio-tabs.tsx", import.meta.url), "utf8");
  assert.match(tabs, /placePages\("portfolio", PRODUCT_ROUTES, locale\)/);
  assert.match(tabs, /aria-current=\{current === page\.href \? "page" : undefined\}/);
});

test("every page on the surface is one tap from the menu on a desk and at most two on a phone", () => {
  /* A desk: every row of the menu is on screen, one tap away (canon v5.4 В30). */
  const desk = new Set(menuNavigation(ROUTES, "en").sections.flatMap((section) => section.rows.map((row) => row.href)));
  /* A phone: one tap reaches a place; «Ще» opens the same rows, so every row is two. */
  const { places } = productNavigation(ROUTES, "en");
  const oneTap = new Set(places.map((place) => place.href));
  for (const route of ROUTES.filter(drawn)) {
    assert.ok(desk.has(route.href), `${route.id} (${route.href}) is not a row of the menu on a desk`);
  }
  for (const href of ["/app/markets", "/app/autoinvest", "/app/top-up"]) assert.ok(desk.has(href), `${href} is not a row of the menu`);
  /* «Купити» lives on Home and a company's page, «Спитати Ryntra» is a place: one tap from anywhere. */
  assert.ok(oneTap.has("/app/home") && oneTap.has("/app/ryn"));
});

test("the prediction demo is off every surface; its code and its addresses stay (canon v5.4 В32)", async () => {
  assert.deepEqual([...OFF_SURFACE], ["predictions"]);
  const predictions = ROUTES.find((route) => route.id === "predictions");
  assert.equal(drawn(predictions), false);
  for (const locale of ["en", "uk"]) {
    assert.ok(!menuNavigation(ROUTES, locale).sections.some((section) => section.rows.some((row) => row.id === "predictions")), `the menu (${locale}) draws the demo`);
    assert.ok(!productNavigation(ROUTES, locale).more.entries.some((entry) => entry.id === "predictions"), `«Ще» (${locale}) draws the demo`);
  }
  /* Every address of it leads to Markets, temporarily, so it can come back on the Owner's word. */
  const { CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  for (const source of ["/app/predictions", "/app/predictions/:path*"]) {
    const row = CUSTOMER_REDIRECTS.find((candidate) => candidate.source === source);
    assert.ok(row, `${source} is still a place a person can land`);
    assert.equal(row.destination, "/app/markets");
    assert.equal(row.permanent, false);
  }
  /* The code stays: the demo's page and its paper sections are in the repository, drawn nowhere. */
  for (const path of ["../app/predictions/page.tsx", "../app/predictions/paper-portfolio.tsx", "../app/predictions/paper-history.tsx", "../app/predictions/prediction-plans-panel.tsx"]) {
    assert.ok(existsSync(new URL(path, import.meta.url)), `${path} was deleted; the demo leaves the surface, not the repository`);
  }
  for (const path of ["../solana/workspace/holdings/page.tsx", "../solana/workspace/history/page.tsx", "../app/strategies/page.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    assert.doesNotMatch(source, /PaperPortfolioSection|PaperHistorySection|PredictionPlansPanel/, `${path} still draws the demo`);
  }
});

test("the never-a-row list stays out of the rail, and a planned page is a destination nowhere", async () => {
  const labels = registeredPages(ROUTES, "en").map((entry) => entry.label);
  for (const never of ["Memes", "RWA", "Screeners", "DCA", "Grid", "Liquidity", "Spend & Invest", "Research", "Critic", "Risk", "Strategy Memory", "Receipts", "Nansen", "Wallet Radar"]) {
    assert.ok(!labels.includes(never), `${never} is a sidebar row`);
  }
  /* Canon v5.0 §0.0 rule 10 (2026-09-23, RYN-SURFACE-CLEAN-001): a planned
     page stays registered as the Owner's target, is not a row, carries no
     word for «not yet» and is not a place a person can land — its address
     leads to a page that works, temporarily, so it can come back when built. */
  const perps = registeredPages(ROUTES, "en").find((entry) => entry.id === "perps");
  assert.equal(perps.readiness, "planned");
  for (const entry of registeredPages(ROUTES, "uk")) {
    assert.equal("readinessLabel" in entry, false, `${entry.id} carries a word for an unfinished page`);
  }
  const source = readFileSync(new URL("./domains.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"(Скоро|Робимо|Soon|Building)"/, "the registry still holds a word for «not yet»");
  const { CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  const byPath = new Map(CUSTOMER_REDIRECTS.map((row) => [row.source, row]));
  const working = new Set(ROUTES.filter((route) => route.readiness !== "planned").map((route) => route.href));
  for (const route of ROUTES.filter((candidate) => candidate.readiness === "planned")) {
    const row = byPath.get(route.href);
    assert.ok(row, `${route.href} is planned and still a place a person can land`);
    assert.equal(row.permanent, false, `${route.href} must be free to come back when it is built`);
    assert.ok(working.has(row.destination) || row.destination === "/app/ryn", `${route.href} leads to ${row.destination}, which is not a page that works`);
  }
});

test("a page with no destination cannot be rendered at all", () => {
  assert.throws(
    () => productNavigation(ROUTES.filter((route) => route.id !== "send"), "en"),
    /send.*has no route/i,
  );
  assert.throws(
    () => productNavigation(ROUTES.map((r) => (r.id === "stocks" ? { ...r, href: "  " } : r)), "en"),
    /stocks.*empty route/i,
  );
});

test("every page in the registry is a page the router actually serves", () => {
  for (const route of ROUTES) {
    assert.ok(route.href.startsWith(`${BASE}/`), `${route.id} leaves the wallet provider's subtree`);
    const dir = new URL(`../../app${route.href}/`, import.meta.url);
    const served = ["page.tsx", "page.ts", "page.jsx", "page.js"].some((name) => existsSync(new URL(name, dir)));
    assert.ok(served, `${route.id} points at ${route.href}, which no page file serves`);
  }
  for (const place of PLACES.filter((candidate) => candidate.href !== null)) {
    const dir = new URL(`../../app${place.href}/`, import.meta.url);
    assert.ok(existsSync(new URL("page.tsx", dir)), `the place ${place.id} opens on ${place.href}, which no page file serves`);
  }
});

test("readiness is declared once, and only in the canon's vocabulary", () => {
  for (const route of ROUTES) {
    assert.ok(
      ["available", "building", "planned"].includes(route.readiness),
      `${route.id} carries the readiness "${route.readiness}", which is not one of the three`,
    );
  }
  const byId = new Map(registeredPages(ROUTES, "en").map((entry) => [entry.id, entry]));
  for (const route of ROUTES) {
    const entry = byId.get(route.id);
    assert.equal(entry.readiness, route.readiness);
  }
  /* The surfaces proved to work are the ones allowed to claim they do. */
  const available = ROUTES.filter((route) => route.readiness === "available").map((route) => route.id).sort();
  /* Trends is available since RYN-SURFACE-CLEAN-001 (2026-09-23): its two
     modes with no list left the surface (canon v5.0 §0.0 rule 10), and every
     mode still drawn lists the provider's own figures and opens Spot. */
  assert.deepEqual(available, ["activity", "bridge", "my-strategies", "portfolio", "predictions", "receive", "results", "rewards", "send", "spot", "stocks", "swap", "trends"]);
  /* Stocks is available since RYN-STOCKS-PRO-001 (2026-09-15); since canon
     v5.3 (В28) the page opens on its screener — every confirmed token over the
     universe the server keeps warm, with the way into Spot — and `/app/stocks`
     itself is Markets for everyone. */
  const stocks = ROUTES.find((route) => route.id === "stocks");
  assert.equal(stocks.readiness, "available");
  assert.equal(stocks.href, "/app/stocks/screener");
  const screener = readFileSync(new URL("../app/stocks/screener/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screener, /<NotYet/);
  assert.match(screener, /readStockUniverse\(/, "the screener is the stock universe built on the verified set Spot trades");
  assert.match(screener, /\/app\/spot\?view=stock/, "the useful action opens the Stocks\/RWA view of Spot");
  assert.match(screener, /<StockStripBar strip=\{strip\}/, "the desk's market strip stands over the screener");
  const markets = readFileSync(new URL("../app/stocks/page.tsx", import.meta.url), "utf8");
  assert.match(markets, /<MarketsPlace locale=\{locale\} \/>/, "`/app/stocks` is Markets for everyone");

  const byRoute = new Map(ROUTES.map((route) => [route.id, route]));
  for (const id of ["perps", "ideas"]) {
    const source = readFileSync(new URL(`../app/${id}/page.tsx`, import.meta.url), "utf8");
    assert.ok(source.includes(`page="${id}"`) && source.includes("<NotYet"), `${id} must take its status from the registry, not from a prop`);
    assert.doesNotMatch(source, /readiness=/, `${id} states a readiness of its own`);
    assert.notEqual(byRoute.get(id).readiness, "available", `${id} renders the not-yet surface and calls itself available`);
  }
});

test("the phone carries the same five places; «Ще» opens the menu's sections and is lit on the pages it holds", () => {
  const phone = mobileNavigation(ROUTES, "uk");
  assert.deepEqual(phone.map((entry) => entry.label), ["Головна", "Ринки", "Ryntra", "Портфель", "Ще"]);
  assert.deepEqual(phone.map((entry) => entry.href), ["/app/home", "/app/markets", "/app/ryn", "/app/portfolio", null]);
  assert.deepEqual(mobileNavigation(ROUTES, "en").map((entry) => entry.label), ["Home", "Markets", "Ryntra", "Portfolio", "More"]);
  for (const entry of phone.slice(0, 4)) assert.deepEqual(entry.matches, [entry.href]);
  assert.deepEqual(phone[4].matches, ["/app/swap", "/app/bridge", "/app/send", "/app/receive", "/app/rewards"]);
  const { routes } = productNavigation(ROUTES, "uk");
  for (const path of ["/app/send", "/app/receive", "/app/bridge", "/app/rewards", "/app/swap"]) {
    assert.ok(phone[4].matches.includes(pageActiveHref(path, routes)), `«Ще» is not current on ${path}`);
  }
  /* «Ще» opens the drawer, which on a phone is the same list of sections the desk draws (the shell's one rail). */
  const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /onMore=\{\(\) => setDrawer\(\(value\) => !value\)\}/);
  assert.match(shell, /onNavigate=\{\(\) => setDrawer\(false\)\}/);
});

test("a row of the menu is current on every route it stands for, and nowhere else", () => {
  const { routes } = menuNavigation(ROUTES, "en");
  const cases = [
    ["/app/home", "/app/home"],
    ["/app/markets", "/app/markets"],
    ["/app/stocks", "/app/markets"],
    ["/app/stocks/AAPLx", "/app/markets"],
    ["/app/stocks/screener", "/app/stocks/screener"],
    ["/app/autoinvest", "/app/autoinvest"],
    ["/app/swap", "/app/swap"],
    ["/app/trade", "/app/swap"],
    ["/app/spot", "/app/spot"],
    ["/app/trends", "/app/trends"],
    ["/app/assets", "/app/trends"],
    ["/app/top-up", "/app/top-up"],
    ["/app/send", "/app/send"],
    ["/app/receive", "/app/receive"],
    ["/app/bridge", "/app/bridge"],
    ["/app/portfolio", "/app/portfolio"],
    ["/app/strategies/new", "/app/strategies"],
    ["/app/plans", "/app/strategies"],
    ["/app/results", "/app/results"],
    ["/app/journal", "/app/results"],
    ["/app/activity", "/app/activity"],
    ["/app/receipts", "/app/activity"],
    ["/app/ryn", "/app/ryn"],
    ["/app/research", "/app/ryn"],
    ["/app/rewards", "/app/rewards"],
    ["/app/settings", "/app/settings"],
  ];
  for (const [path, expected] of cases) assert.equal(pageActiveHref(path, routes), expected, `${path} lights the wrong row`);
  /* Monitoring is the bell's page, not a row's; the demo is off the surface. */
  assert.equal(pageActiveHref("/app/alerts", routes), null, "the bell's page lights a row of the menu");
  assert.equal(pageActiveHref("/app/predictions/abc", routes), null, "the demo lights a row of the menu");
  assert.equal(pageActiveHref("/app/markets-extra", routes), null, "an unknown sibling must not light a row");
});

test("both locales are complete, and neither is the other's fallback", () => {
  for (const id of PRODUCT_PAGE_IDS) {
    const label = PAGE_LABELS[id];
    assert.ok(label.en && label.en.length > 0, `${id} has no English label`);
    assert.ok(label.uk && label.uk.length > 0, `${id} has no Ukrainian label`);
    assert.notEqual(label.uk, label.en, `${id} is the same word in both locales, so one of them is untranslated`);
  }
  for (const id of PRODUCT_GROUP_IDS) {
    const label = GROUP_LABELS[id];
    assert.notEqual(label.uk, label.en, `the kind ${id} is untranslated`);
  }
  for (const [key, label] of Object.entries(SECONDARY_LABELS)) {
    assert.ok(label.en.length > 0 && label.uk.length > 0, `${key} is missing a locale`);
    assert.notEqual(label.uk, label.en, `${key} is untranslated`);
  }
  /* The third place carries the product's own name in both languages, on purpose; every other is translated. */
  for (const id of PLACE_IDS) {
    const label = PLACE_LABELS[id];
    if (id === "agent") assert.equal(label.uk, "Ryntra");
    else assert.notEqual(label.uk, label.en, `the place ${id} is untranslated`);
  }
  for (const [id, label] of Object.entries(IN_PLACE_LABELS)) assert.notEqual(label.uk, label.en, `${id}'s in-place label is untranslated`);
});

test("the rail cannot throw for want of a translation", () => {
  const source = readSource();
  assert.ok(!/translateSolana\s*\(/.test(source), "the rail now calls the fail-closed translator");
  assert.ok(!/^import\s/m.test(source), "the page vocabulary took a dependency it does not need");
  assert.ok(!/from\s+"/.test(source), "the page vocabulary took a dependency it does not need");
});

test("a place is current on every route it stands for, and nowhere else", () => {
  const { routes } = productNavigation(ROUTES, "en");
  const cases = [
    ["/app/home", "/app/home"],
    ["/app/top-up", "/app/home"],
    ["/app/autoinvest", "/app/home"],
    ["/app/markets", "/app/markets"],
    ["/app/stocks", "/app/markets"],
    ["/app/stocks/AAPLx", "/app/markets"],
    ["/app/stocks/screener", "/app/markets"],
    ["/app/spot", "/app/markets"],
    ["/app/trends", "/app/markets"],
    ["/app/assets", "/app/markets"],
    ["/app/ryn", "/app/ryn"],
    ["/app/research", "/app/ryn"],
    ["/app/portfolio", "/app/portfolio"],
    ["/app/activity", "/app/portfolio"],
    ["/app/receipts", "/app/portfolio"],
    ["/app/strategies/new", "/app/portfolio"],
    ["/app/strategies/plans/plan_1", "/app/portfolio"],
    ["/app/plans", "/app/portfolio"],
    ["/app/alerts", "/app/portfolio"],
    ["/app/results", "/app/portfolio"],
    ["/app/swap", "/app/swap"],
    ["/app/trade", "/app/swap"],
    ["/app/bridge", "/app/bridge"],
    ["/app/send", "/app/send"],
    ["/app/receive", "/app/receive"],
    ["/app/rewards", "/app/rewards"],
    /* The demo is off the surface (canon v5.4 В32): its old address lights no place. */
    ["/app/predictions/abc", null],
  ];
  for (const [path, expected] of cases) assert.equal(pageActiveHref(path, routes), expected, `${path} lights the wrong place`);
  assert.equal(pageActiveHref("/app/settings", routes), null, "Settings is pinned at the foot, not a place");
  assert.equal(pageActiveHref("/app/markets-extra", routes), null, "an unknown sibling must not light a place");
});

test("the retired names never reach a label", () => {
  const words = [
    ...Object.values(PAGE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(GROUP_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(SECONDARY_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(PLACE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(IN_PLACE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(MENU_SECTION_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(MENU_PAGE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(MENU_DESTINATIONS).flatMap((destination) => [destination.label, destination.caption].filter(Boolean)).flatMap((label) => [label.en, label.uk]),
    MENU_FOOT.feedback.en, MENU_FOOT.feedback.uk,
  ];
  for (const word of words) {
    for (const forbidden of FORBIDDEN_NAV_WORDS) {
      assert.ok(
        !word.toLowerCase().includes(forbidden.toLowerCase()),
        `"${word}" carries the retired word "${forbidden}"`,
      );
    }
    /* No depth is named where a person reads the menu. */
    assert.doesNotMatch(word, /Простий|Профі|\bSimple\b|\bPro\b/, `"${word}" names a depth that no longer exists`);
  }
  for (const retired of ["Passport", "Agents", "Паспорт", "Агенти", "Activity", "Активність", "Operations", "Операції"]) {
    assert.ok(FORBIDDEN_NAV_WORDS.includes(retired), `${retired} is not pinned as retired`);
  }
  /* «Ринки» and Home came back with canon v5.0 §3 as two of the five places;
     «Гроші» with canon v5.4 (В30) as the caption of a section of the menu. */
  for (const live of ["Bridge", "Міст", "History", "Історія", "Stocks", "Акції", "Ринки", "Home", "Головна", "Гроші"]) {
    assert.ok(!FORBIDDEN_NAV_WORDS.includes(live), `${live} is a live page name`);
  }
  assert.equal(PAGE_LABELS.bridge.en, "Bridge");
  assert.equal(PAGE_LABELS.bridge.uk, "Міст");
  assert.equal(PAGE_LABELS.activity.en, "History", "English must read History since canon v4.0");
  assert.equal(PAGE_LABELS.activity.uk, "Історія", "Ukrainian must not read Активність");
  assert.equal(PAGE_LABELS.stocks.en, "Stocks");
  assert.equal(PAGE_LABELS.stocks.uk, "Акції");
  assert.equal(GROUP_LABELS.money.uk, "Кошти", "Ukrainian must not read Гроші");
  assert.ok(!PRODUCT_PAGE_IDS.includes("home"), "Home is a place, not a registered page");
  /* The page that carries the History label says History on itself too. */
  const history = readFileSync(new URL("../solana/workspace/history/page.tsx", import.meta.url), "utf8");
  assert.match(history, /<PageHead title="History" \/>/);
  assert.doesNotMatch(history, /text\("Activity"\)/);
});

function readSource() {
  return readFileSync(new URL("./domains.ts", import.meta.url), "utf8");
}

test("a sub-route marks the page it belongs to, never a page it is not inside", () => {
  assert.equal(pageActiveHref(`${BASE}/bridge`, ROUTES), `${BASE}/bridge`, "Bridge is a page, and owns its own route");
  assert.equal(pageActiveHref(`${BASE}/trade`, ROUTES), `${BASE}/swap`, "the pre-canon trade route belongs to Swap");
  assert.equal(pageActiveHref(`${BASE}/receipts`, ROUTES), `${BASE}/activity`, "a receipt belongs to History");
  assert.equal(pageActiveHref(`${BASE}/assets`, ROUTES), `${BASE}/trends`, "asset detail belongs to Trends");
  assert.equal(pageActiveHref(`${BASE}/markets`, ROUTES), `${BASE}/trends`, "the old Markets landing belongs to Trends");
  assert.equal(pageActiveHref(`${BASE}/stocks`, ROUTES), `${BASE}/stocks/screener`, "the stock desk's addresses are the Stocks page's");
  assert.equal(pageActiveHref(`${BASE}/stocks/screener`, ROUTES), `${BASE}/stocks/screener`, "the screener is the Stocks page");
  assert.equal(pageActiveHref(`${BASE}/stocks/AAPLx`, ROUTES), `${BASE}/stocks/screener`, "a company's page is inside Stocks");
  assert.equal(pageActiveHref(`${BASE}/swap`, ROUTES), `${BASE}/swap`);
  assert.equal(pageActiveHref("/app/agents/inspect", ROUTES), "/app/strategies", "agent inspection belongs to My strategies");
  assert.equal(pageActiveHref("/app/plans", ROUTES), "/app/strategies", "saved plans are My strategies, not a second system");
  assert.equal(pageActiveHref("/app/strategies/abc", ROUTES), "/app/strategies", "a strategy's detail is inside its page");
  assert.equal(pageActiveHref("/app/journal", ROUTES), "/app/results", "plan against outcome is Results");
  assert.equal(pageActiveHref("/app/research", ROUTES), "/app/ideas", "research is Ideas");
  assert.equal(pageActiveHref(BASE, ROUTES), null, "the product root is a doorway and marks nothing");
  assert.equal(pageActiveHref("/app/settings", ROUTES), null, "Settings is pinned separately and marks no page");
  assert.equal(pageActiveHref("/app/markets-extra", ROUTES), null, "an unknown sibling must not mark a page active");
  assert.equal(pageActiveHref("/elsewhere", ROUTES), null, "a route outside the product marks nothing");
});

test("matching is on segment boundaries, so no page swallows a sibling", () => {
  const routes = PRODUCT_PAGE_IDS.map((id, index) => ({
    id,
    href: index === 0 ? "/x/send" : index === 1 ? "/x/sender" : `/x/p${index}`,
    icon: "swap",
    readiness: "planned",
    match: [index === 0 ? "/x/send" : index === 1 ? "/x/sender" : `/x/p${index}`],
  }));
  assert.equal(pageActiveHref("/x/sender", routes), "/x/sender", "/x/send must not swallow /x/sender");
  assert.equal(pageActiveHref("/x/send", routes), "/x/send");
});

test("the product scope adopts a depth instead of resetting or guessing at one", async () => {
  /* The layout store's migration, kept for the workspaces that still have a
     depth; the product itself reads its one version whatever is stored
     (`shell-state.tsx`, `oneVersion`). */
  const { PRODUCT_SCOPE, PRODUCT_SCOPE_SOURCES, parseLayout } = await import("./layout-store.ts");

  assert.deepEqual(PRODUCT_SCOPE_SOURCES, ["solana", "agent-control"], "the order is the migration");

  const chosen = (mode) => ({
    mode,
    depthChosen: true,
    density: "comfortable",
    navCollapsed: false,
    inspectorOpen: false,
    hidden: [],
    order: [],
    panels: {},
  });

  const both = parseLayout({
    version: 2,
    byWorkspace: { solana: chosen("guided"), "agent-control": chosen("pro") },
  });
  assert.equal(both.byWorkspace[PRODUCT_SCOPE].mode, "guided", "the money surfaces decide, by the stated rule");
  assert.ok(both.byWorkspace.solana, "a live workspace must keep its own record");
  assert.ok(both.byWorkspace["agent-control"], "a live workspace must keep its own record");

  const onlyControl = parseLayout({ version: 2, byWorkspace: { "agent-control": chosen("pro") } });
  assert.equal(onlyControl.byWorkspace[PRODUCT_SCOPE].mode, "pro", "the second source is used when the first has none");

  const already = parseLayout({
    version: 2,
    byWorkspace: { [PRODUCT_SCOPE]: chosen("pro"), solana: chosen("guided") },
  });
  assert.equal(already.byWorkspace[PRODUCT_SCOPE].mode, "pro", "an existing choice was overwritten");

  const unchosen = parseLayout({
    version: 2,
    byWorkspace: { solana: { ...chosen("pro"), depthChosen: false } },
  });
  assert.equal(unchosen.byWorkspace[PRODUCT_SCOPE], undefined, "a default was adopted as if it were a decision");
});

test("a page owns its routes, so no route the product ships is left marking nothing", () => {
  const owned = ROUTES.flatMap((route) => route.match);
  const shipped = [
    `${BASE}/portfolio`, `${BASE}/assets`, `${BASE}/markets`, `${BASE}/trends`,
    `${BASE}/swap`, `${BASE}/spot`, `${BASE}/stocks`, `${BASE}/perps`, `${BASE}/bridge`,
    `${BASE}/ideas`, `${BASE}/strategies`, `${BASE}/results`,
    `${BASE}/send`, `${BASE}/receive`, `${BASE}/rewards`,
    `${BASE}/activity`, `${BASE}/receipts`,
    `${BASE}/agents`, `${BASE}/agents/inspect`, `${BASE}/agents/verify`, `${BASE}/plans`,
  ];
  for (const route of shipped) {
    const landing = pageActiveHref(route, ROUTES);
    assert.notEqual(landing, null, `${route} belongs to no page`);
    const owner = ROUTES.find((candidate) => candidate.href === landing);
    assert.ok(owner, `${route} resolved to a landing no page declares`);
  }
  assert.equal(new Set(owned).size, owned.length, "two pages claim the same route");
});

test("the Stocks/RWA mode of Trends leads to the Stocks page, and /app/history keeps its cached answer", async () => {
  /* Canon v4.0 §5.1: saved transitions to Stocks/RWA inside Trends lead to
     the new context; there are not two screeners of one class. The Stocks
     page is the screener since canon v5.3. */
  const { TREND_MODE_SPECS } = await import("../app/trends/modes.ts");
  assert.equal(TREND_MODE_SPECS.find((spec) => spec.id === "stocks").movedTo, ROUTES.find((route) => route.id === "stocks").href);
  /* `/app/history` has been a permanent redirect to `/app/activity` since the
     six-domain model; a browser that followed it will never re-ask, so the
     page keeps its address under the History label rather than moving and
     looping those browsers (canon v4.0 §5.2 allows exactly this). */
  const { customerHref } = await import("../../lib/product/customer-routing.ts");
  assert.equal(customerHref("/app/history"), "/app/activity");
  assert.equal(customerHref("/app/activity"), "/app/activity");
  assert.equal(customerHref("/app/stocks"), "/app/stocks");
});
