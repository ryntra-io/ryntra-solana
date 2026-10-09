import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

import {
  ASSISTANT,
  FORBIDDEN_NAV_WORDS,
  GROUP_LABELS,
  MENU_ACTION,
  MENU_FOOT,
  MENU_GROUPS,
  MENU_SECTIONS,
  MENU_SECTION_IDS,
  OFF_SURFACE,
  PAGE_GROUP,
  PAGE_LABELS,
  PAGE_SECTION,
  PHONE_BAR_SECTIONS,
  PRODUCT_GROUP_IDS,
  PRODUCT_PAGE_IDS,
  SECONDARY_LABELS,
  drawn,
  menuNavigation,
  mobileNavigation,
  pageActiveHref,
  registeredPages,
  sectionTabs,
} from "./domains.ts";
import { PRODUCT_ROUTES } from "./product-routes.ts";

/**
 * The navigation contract, pinned — the menu v6.2 (2026-10-06): on a desk
 * «+ Запустити токен» on top, then Головна · Ринки — Торгувати · Лаунч ·
 * Боти — Портфель · Гроші · Винагороди in three groups without headings, each
 * row with its caption, the assistant in the header; a section's pages as
 * tabs at the top of it; on a phone Головна · Ринки · + · Портфель · Ще.
 * These tests exercise the routes the shell actually consumes, so an obsolete
 * fixture cannot keep a second navigation passing after production changes.
 */

const BASE = "/app";
const ROUTES = PRODUCT_ROUTES;
const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the registry carries fifteen pages in the product's order, each of one kind", () => {
  assert.deepEqual(PRODUCT_PAGE_IDS, [
    "swap", "spot", "stocks", "trends", "perps", "predictions",
    "ideas", "my-strategies", "results",
    "send", "receive", "bridge", "rewards",
    "portfolio", "activity",
  ]);
  assert.deepEqual(ROUTES.map((route) => route.id), [...PRODUCT_PAGE_IDS]);
  /* Stocks and Trends are one screener in «Ринки»; My strategies and Results are «Боти → Мої боти». */
  assert.deepEqual(registeredPages(ROUTES, "en").map((entry) => entry.href), [
    "/app/swap", "/app/spot", "/app/markets", "/app/markets", "/app/perps", "/app/predictions",
    "/app/ideas", "/app/bots", "/app/bots",
    "/app/send", "/app/receive", "/app/bridge", "/app/rewards",
    "/app/portfolio", "/app/activity",
  ]);
  /* The four kinds of work stay a page's category — the API's capabilities carry it as `group`. */
  assert.deepEqual(PRODUCT_GROUP_IDS, ["trade", "strategies", "money", "manage"]);
  for (const id of PRODUCT_PAGE_IDS) assert.ok(PRODUCT_GROUP_IDS.includes(PAGE_GROUP[id]), `${id} has no kind`);
});

test("the menu v6.2 — «+ Запустити токен», then three groups of sections with their captions, nothing behind «Ще»", () => {
  assert.deepEqual([...MENU_SECTION_IDS], ["home", "markets", "trade", "launch", "bots", "portfolio", "money", "rewards"]);
  assert.deepEqual(MENU_GROUPS.map((group) => [...group.sections]), [["home", "markets"], ["trade", "launch", "bots"], ["portfolio", "money", "rewards"]]);
  const uk = menuNavigation(ROUTES, "uk");
  const shape = (menu) => menu.groups.map((group) => group.rows.map((row) => [row.label, row.caption ?? null]));
  assert.deepEqual(shape(uk), [
    [["Головна", null], ["Ринки", "Акції, крипта, меми"]],
    [["Торгувати", "Спот і обмін"], ["Лаунч", "Свій токен"], ["Боти", "Регулярна купівля, плани"]],
    [["Портфель", "Позиції й історія"], ["Гроші", "Поповнення й перекази"], ["Винагороди", "Бали, таблиці, сезон"]],
  ]);
  assert.deepEqual(uk.groups.flatMap((group) => group.rows.map((row) => row.href)), [
    "/app/home", "/app/markets",
    "/app/spot", "/app/launch/new", "/app/bots",
    "/app/portfolio", "/app/top-up", "/app/rewards",
  ]);
  const en = menuNavigation(ROUTES, "en");
  assert.deepEqual(en.groups.flatMap((group) => group.rows.map((row) => row.label)), ["Home", "Markets", "Trade", "Launch", "Bots", "Portfolio", "Money", "Rewards"]);
  /* Home is not called Pulse until Pulse is live; no section is Pools or Perps until their tasks are. */
  for (const locale of ["en", "uk"]) {
    const rows = menuNavigation(ROUTES, locale).groups.flatMap((group) => group.rows);
    assert.ok(!rows.some((row) => /Pulse|Пули|Pools|Перпи|Perps/.test(`${row.label} ${row.caption ?? ""}`)), `${locale}: a section that is not live is drawn`);
  }
  /* The action on top: «+ Запустити токен», the launch form. */
  assert.equal(uk.action.label, "Запустити токен");
  assert.equal(en.action.label, "Launch a token");
  assert.equal(uk.action.href, "/app/launch/new");
  /* The assistant is not a row of the desk's groups; it is «Спитати Ryntra» in the header. */
  assert.ok(!uk.groups.some((group) => group.rows.some((row) => row.id === "agent" || row.href === "/app/ryn")), "Ryntra is a row of the menu");
  assert.equal(uk.assistant.href, "/app/ryn");
  assert.equal(uk.assistant.caption, "ШІ-помічник");
  assert.equal(ASSISTANT.ask.uk, "Спитати Ryntra");
  /* The foot: Відгук, then Settings. */
  assert.equal(uk.feedbackLabel, "Відгук");
  assert.equal(uk.settings.label, "Налаштування");
  assert.equal(uk.settings.href, "/app/settings");
  assert.equal(en.feedbackLabel, "Feedback");
  /* No «Ryn» where a person reads: the assistant is Ryntra. */
  for (const label of [...Object.values(MENU_SECTIONS).flatMap((section) => [section.label, section.caption].filter(Boolean)), ASSISTANT.label, ASSISTANT.caption].flatMap((label) => [label.en, label.uk])) {
    assert.doesNotMatch(label, /\bRyn\b/);
  }
});

test("every drawn page lives in exactly one drawn section; a page that is planned or off the surface is drawn nowhere", () => {
  const placed = [...MENU_SECTION_IDS.flatMap((id) => MENU_SECTIONS[id].pages), ...ASSISTANT.pages];
  assert.deepEqual([...placed].sort(), [...PRODUCT_PAGE_IDS].sort(), "a page is in no section, or in two");
  assert.equal(new Set(placed).size, placed.length, "a page is listed in two sections");
  for (const id of PRODUCT_PAGE_IDS) {
    if (id === "ideas") continue;
    assert.ok(MENU_SECTIONS[PAGE_SECTION[id]].pages.includes(id), `${id} is placed where it is not listed`);
  }
  /* A tab bound to a page that is not drawn is not a tab: Perps is planned, the prediction demo is off the surface. */
  for (const id of MENU_SECTION_IDS) {
    for (const tab of MENU_SECTIONS[id].tabs ?? []) {
      if (!tab.page) continue;
      const route = ROUTES.find((candidate) => candidate.id === tab.page);
      assert.ok(drawn(route), `${tab.id} is a tab over ${tab.page}, which is not drawn`);
    }
  }
  assert.equal(ROUTES.find((route) => route.id === "perps").readiness, "planned");
  assert.deepEqual([...OFF_SURFACE], ["predictions"]);
});

test("a section's pages are tabs at the top of its page — one component, drawn by the shell", () => {
  const tabs = (path, locale = "uk") => {
    const found = sectionTabs(path, ROUTES, locale);
    return found ? [found.section, found.tabs.map((tab) => tab.label), found.current] : null;
  };
  assert.deepEqual(tabs("/app/spot"), ["trade", ["Спот", "Обмін"], "/app/spot"]);
  assert.deepEqual(tabs("/app/swap"), ["trade", ["Спот", "Обмін"], "/app/swap"]);
  assert.deepEqual(tabs("/app/launch/new"), ["launch", ["Запустити токен", "Лаунчі на Ryntra", "Мої лаунчі"], "/app/launch/new"]);
  assert.deepEqual(tabs("/app/launch/markets"), ["launch", ["Запустити токен", "Лаунчі на Ryntra", "Мої лаунчі"], "/app/launch/markets"]);
  assert.deepEqual(tabs("/app/launch/mine"), ["launch", ["Запустити токен", "Лаунчі на Ryntra", "Мої лаунчі"], "/app/launch/mine"]);
  assert.deepEqual(tabs("/app/bots"), ["bots", ["Мої боти", "Каталог"], "/app/bots"]);
  assert.deepEqual(tabs("/app/bots/catalog"), ["bots", ["Мої боти", "Каталог"], "/app/bots/catalog"]);
  assert.deepEqual(tabs("/app/strategies/new"), ["bots", ["Мої боти", "Каталог"], "/app/bots"], "the plan builder stands under «Мої боти»");
  assert.deepEqual(tabs("/app/portfolio"), ["portfolio", ["Позиції", "Історія"], "/app/portfolio"]);
  assert.deepEqual(tabs("/app/activity"), ["portfolio", ["Позиції", "Історія"], "/app/activity"]);
  assert.deepEqual(tabs("/app/receipts/abc"), ["portfolio", ["Позиції", "Історія"], "/app/activity"]);
  assert.deepEqual(tabs("/app/top-up"), ["money", ["Поповнити", "Надіслати", "Отримати", "Між мережами"], "/app/top-up"]);
  assert.deepEqual(tabs("/app/bridge", "en"), ["money", ["Top up", "Send", "Receive", "Cross-chain"], "/app/bridge"]);
  /* A page that is none of a section's tabs draws none: a launch's page, a company's page, Markets, Home, Rewards. */
  for (const path of ["/app/launch/So11111111111111111111111111111111111111112", "/app/stocks/NVDAx", "/app/markets", "/app/home", "/app/rewards", "/app/settings"]) {
    assert.equal(sectionTabs(path, ROUTES, "uk"), null, `${path} draws tabs it does not have`);
  }
  /* The shell draws them, and the pages no longer draw tabs of their own. */
  const shell = code("./app-shell.tsx");
  assert.match(shell, /const tabs = product \? sectionTabs\(pathname, product\.routes, product\.locale\) : null;/);
  assert.match(shell, /\{tabs \? <SectionTabsBar tabs=\{tabs\} \/> : null\}/);
  for (const path of ["../app/portfolio/portfolio-tabs.tsx", "../app/launch/launch-tabs.tsx", "../app/markets/tabs.ts"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} — a second tab component — is back`);
  }
  for (const path of ["../solana/workspace/holdings/page.tsx", "../solana/workspace/history/page.tsx", "../solana/workspace/send/page.tsx", "../solana/workspace/receive/page.tsx", "../app/launch/new/launch-flow.tsx", "../app/launch/mine/creator-cabinet.tsx"]) {
    assert.doesNotMatch(code(path), /PortfolioTabs|LaunchTabs|<MoneyTabs/, `${path} still draws tabs of its own`);
  }
  const bar = readFileSync(new URL("./section-tabs.tsx", import.meta.url), "utf8");
  assert.match(bar, /aria-current=\{tabs\.current === tab\.href \? "page" : undefined\}/);
});

test("the phone: Головна · Ринки · + · Портфель · Ще, and «Ще» opens Торгувати, Боти, Гроші, Винагороди, Ryntra and Налаштування", () => {
  const phone = mobileNavigation(ROUTES, "uk");
  assert.deepEqual(phone.map((entry) => entry.label), ["Головна", "Ринки", "Лаунч", "Портфель", "Ще"]);
  assert.deepEqual(phone.map((entry) => entry.href), ["/app/home", "/app/markets", "/app/launch/new", "/app/portfolio", null]);
  assert.deepEqual(mobileNavigation(ROUTES, "en").map((entry) => entry.label), ["Home", "Markets", "Launch", "Portfolio", "More"]);
  assert.equal(phone[2].action, true, "«+» is the launch, drawn as an action");
  assert.equal(phone[2].icon, MENU_ACTION.icon);
  assert.deepEqual(phone[4].matches, ["/app/spot", "/app/bots", "/app/top-up", "/app/rewards", "/app/ryn", "/app/settings"]);
  assert.deepEqual([...PHONE_BAR_SECTIONS], ["home", "markets", "portfolio"]);
  /* Every row «Ще» opens lights it. */
  const { routes } = menuNavigation(ROUTES, "uk");
  for (const path of ["/app/swap", "/app/send", "/app/bridge", "/app/rewards", "/app/bots/catalog", "/app/ryn", "/app/settings"]) {
    assert.ok(phone[4].matches.includes(pageActiveHref(path, routes)), `«Ще» is not current on ${path}`);
  }
  /* «Ще» opens the drawer; on a phone it hides the rows the bar holds and shows Ryntra. */
  const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /onMore=\{\(\) => setDrawer\(\(value\) => !value\)\}/);
  assert.match(shell, /onNavigate=\{\(\) => setDrawer\(false\)\}/);
  assert.match(shell, /id: "domains-assistant"/);
  const css = readFileSync(new URL("./shell.css", import.meta.url), "utf8");
  const phoneRules = css.slice(css.indexOf("the menu v6.2 =="));
  for (const selector of ['.rs-group[data-group="domains-discover"]', '.rs-link[data-row="launch"]', '.rs-link[data-row="portfolio"]', ".rs-nav-launch"]) {
    assert.ok(phoneRules.includes(selector), `the phone's «Ще» does not hide ${selector}`);
  }
  assert.match(phoneRules, /\.rs-group\[data-group="domains-assistant"\] \{\s*display: none;/, "the assistant is a row of the desk's menu");
});

test("one projection, taking nothing but the routes and a language — no depth, no switch, no cookie", () => {
  for (const projector of [mobileNavigation, menuNavigation]) {
    assert.equal(projector.length, 2, `${projector.name} takes (routes, locale) and nothing else`);
  }
  assert.equal(sectionTabs.length, 3, "sectionTabs takes (path, routes, locale) and nothing else");
  const shell = code("./app-shell.tsx");
  assert.doesNotMatch(shell, /simpleNavigation|simpleMobileNavigation|resolveDepth\(|modeForDepth|lib\/product\/depth/, "the shell still chooses a menu by depth");
  assert.match(shell, /const menu = product \? menuNavigation\(product\.routes, product\.locale\) : null;/);
  assert.match(shell, /domainRoutes=\{menu\?\.routes\}/);
  assert.match(shell, /entries=\{mobileNavigation\(product\.routes, product\.locale\)\}/);
  assert.match(shell, /activeHref=\{pageActiveHref\(pathname, menu\.routes\)\}/);
  assert.doesNotMatch(code("../app/product-shell.tsx"), /DepthSwitch/, "the product rail still carries the switch");
  assert.equal(existsSync(new URL("../../lib/product/depth.ts", import.meta.url)), false, "the depth cookie module is back");
  for (const path of ["../app/layout.tsx", "../app/stocks/[ticker]/page.tsx", "../solana/workspace/holdings/page.tsx", "./shell-state.tsx", "../../lib/product/customer-routing.ts"]) {
    assert.doesNotMatch(code(path), /ryntra-depth|DEPTH_COOKIE|depthFromCookie/, `${path} still reads the depth cookie`);
  }
});

test("a row of the menu is current on every route it stands for, and nowhere else", () => {
  const { routes } = menuNavigation(ROUTES, "en");
  const cases = [
    ["/app/home", "/app/home"],
    ["/app/markets", "/app/markets"],
    ["/app/stocks", "/app/markets"],
    ["/app/stocks/AAPLx", "/app/markets"],
    ["/app/stocks/screener", "/app/markets"],
    ["/app/trends", "/app/markets"],
    ["/app/assets", "/app/markets"],
    ["/app/spot", "/app/spot"],
    ["/app/swap", "/app/spot"],
    ["/app/trade", "/app/spot"],
    ["/app/launch/new", "/app/launch/new"],
    ["/app/launch/mine", "/app/launch/new"],
    ["/app/bots", "/app/bots"],
    ["/app/bots/catalog", "/app/bots"],
    ["/app/autoinvest", "/app/bots"],
    ["/app/strategies/new", "/app/bots"],
    ["/app/strategies/plans/plan_1", "/app/bots"],
    ["/app/plans", "/app/bots"],
    ["/app/results", "/app/bots"],
    ["/app/journal", "/app/bots"],
    ["/app/portfolio", "/app/portfolio"],
    ["/app/activity", "/app/portfolio"],
    ["/app/receipts", "/app/portfolio"],
    ["/app/top-up", "/app/top-up"],
    ["/app/send", "/app/top-up"],
    ["/app/receive", "/app/top-up"],
    ["/app/bridge", "/app/top-up"],
    ["/app/rewards", "/app/rewards"],
    ["/app/ryn", "/app/ryn"],
    ["/app/research", "/app/ryn"],
    ["/app/settings", "/app/settings"],
  ];
  for (const [path, expected] of cases) assert.equal(pageActiveHref(path, routes), expected, `${path} lights the wrong row`);
  /* Monitoring is the bell's page, not a row's; the demo is off the surface. */
  assert.equal(pageActiveHref("/app/alerts", routes), null, "the bell's page lights a row of the menu");
  assert.equal(pageActiveHref("/app/predictions/abc", routes), null, "the demo lights a row of the menu");
  assert.equal(pageActiveHref("/app/markets-extra", routes), null, "an unknown sibling must not light a row");
});

test("the prediction demo is off every surface; its code and its addresses stay", async () => {
  const predictions = ROUTES.find((route) => route.id === "predictions");
  assert.equal(predictions.readiness, "available");
  assert.equal(drawn(predictions), false);
  for (const locale of ["en", "uk"]) {
    const tabs = MENU_SECTION_IDS.flatMap((id) => sectionTabs(MENU_SECTIONS[id].href, ROUTES, locale)?.tabs ?? []);
    assert.ok(!tabs.some((tab) => /predictions/.test(tab.href)), `a tab (${locale}) draws the demo`);
  }
  const { CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  for (const source of ["/app/predictions", "/app/predictions/:path*"]) {
    const row = CUSTOMER_REDIRECTS.find((candidate) => candidate.source === source);
    assert.ok(row, `${source} is still a place a person can land`);
    assert.equal(row.destination, "/app/markets");
    assert.equal(row.permanent, false);
  }
  for (const path of ["../app/predictions/page.tsx", "../app/predictions/paper-portfolio.tsx", "../app/predictions/paper-history.tsx", "../app/predictions/prediction-plans-panel.tsx"]) {
    assert.ok(existsSync(new URL(path, import.meta.url)), `${path} was deleted; the demo leaves the surface, not the repository`);
  }
  const predictionsPage = readFileSync(new URL("../app/predictions/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(predictionsPage, /<NotYet/, "Predictions draws the hub, not the not-yet surface");
});

test("the never-a-row list stays out of the rail, and a planned page is a destination nowhere", async () => {
  const labels = registeredPages(ROUTES, "en").map((entry) => entry.label);
  for (const never of ["Memes", "RWA", "Screeners", "DCA", "Grid", "Liquidity", "Spend & Invest", "Research", "Critic", "Risk", "Strategy Memory", "Receipts", "Nansen", "Wallet Radar"]) {
    assert.ok(!labels.includes(never), `${never} is a sidebar row`);
  }
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
  assert.throws(() => menuNavigation(ROUTES.filter((route) => route.id !== "send"), "en"), /send.*has no route/i);
  assert.throws(() => menuNavigation(ROUTES.map((r) => (r.id === "stocks" ? { ...r, href: "  " } : r)), "en"), /stocks.*empty route/i);
});

test("every page, section and tab is a page the router actually serves", () => {
  const served = (href) => {
    const dir = new URL(`../../app${href}/`, import.meta.url);
    return ["page.tsx", "page.ts", "page.jsx", "page.js"].some((name) => existsSync(new URL(name, dir)));
  };
  for (const route of ROUTES) {
    assert.ok(route.href.startsWith(`${BASE}/`), `${route.id} leaves the wallet provider's subtree`);
    assert.ok(served(route.href), `${route.id} points at ${route.href}, which no page file serves`);
  }
  for (const id of MENU_SECTION_IDS) {
    assert.ok(served(MENU_SECTIONS[id].href), `the section ${id} opens on ${MENU_SECTIONS[id].href}, which no page file serves`);
    for (const tab of MENU_SECTIONS[id].tabs ?? []) assert.ok(served(tab.href), `the tab ${tab.id} opens on ${tab.href}, which no page file serves`);
  }
  assert.ok(served(ASSISTANT.href) && served(MENU_ACTION.href) && served(MENU_FOOT.settings.href));
  /* The cabinet's «not found» is inside the shell: a catch-all under /app and a not-found of its own. */
  assert.ok(existsSync(new URL("../app/not-found.tsx", import.meta.url)));
  assert.match(readFileSync(new URL("../app/[...missing]/page.tsx", import.meta.url), "utf8"), /notFound\(\)/);
});

test("readiness is declared once, and only in the three-status vocabulary", () => {
  for (const route of ROUTES) {
    assert.ok(["available", "building", "planned"].includes(route.readiness), `${route.id} carries the readiness "${route.readiness}", which is not one of the three`);
  }
  const byId = new Map(registeredPages(ROUTES, "en").map((entry) => [entry.id, entry]));
  for (const route of ROUTES) assert.equal(byId.get(route.id).readiness, route.readiness);
  const available = ROUTES.filter((route) => route.readiness === "available").map((route) => route.id).sort();
  assert.deepEqual(available, ["activity", "bridge", "my-strategies", "portfolio", "predictions", "receive", "results", "rewards", "send", "spot", "stocks", "swap", "trends"]);
  const byRoute = new Map(ROUTES.map((route) => [route.id, route]));
  for (const id of ["perps", "ideas"]) {
    const source = readFileSync(new URL(`../app/${id}/page.tsx`, import.meta.url), "utf8");
    assert.ok(source.includes(`page="${id}"`) && source.includes("<NotYet"), `${id} must take its status from the registry, not from a prop`);
    assert.doesNotMatch(source, /readiness=/, `${id} states a readiness of its own`);
    assert.notEqual(byRoute.get(id).readiness, "available", `${id} renders the not-yet surface and calls itself available`);
  }
});

test("both locales are complete, and neither is the other's fallback", () => {
  for (const id of PRODUCT_PAGE_IDS) {
    const label = PAGE_LABELS[id];
    assert.ok(label.en && label.uk, `${id} is missing a locale`);
    assert.notEqual(label.uk, label.en, `${id} is the same word in both locales, so one of them is untranslated`);
  }
  for (const id of PRODUCT_GROUP_IDS) assert.notEqual(GROUP_LABELS[id].uk, GROUP_LABELS[id].en, `the kind ${id} is untranslated`);
  for (const [key, label] of Object.entries(SECONDARY_LABELS)) {
    assert.ok(label.en.length > 0 && label.uk.length > 0, `${key} is missing a locale`);
    assert.notEqual(label.uk, label.en, `${key} is untranslated`);
  }
  for (const id of MENU_SECTION_IDS) {
    const section = MENU_SECTIONS[id];
    assert.notEqual(section.label.uk, section.label.en, `the section ${id} is untranslated`);
    if (section.caption) assert.notEqual(section.caption.uk, section.caption.en, `the caption of ${id} is untranslated`);
    for (const tab of section.tabs ?? []) assert.notEqual(tab.label.uk, tab.label.en, `the tab ${tab.id} is untranslated`);
  }
  /* The assistant carries the product's own name in both languages, on purpose. */
  assert.equal(ASSISTANT.label.uk, "Ryntra");
  assert.equal(ASSISTANT.label.en, "Ryntra");
});

test("the rail cannot throw for want of a translation", () => {
  const source = readFileSync(new URL("./domains.ts", import.meta.url), "utf8");
  assert.ok(!/translateSolana\s*\(/.test(source), "the rail now calls the fail-closed translator");
  assert.ok(!/^import\s/m.test(source), "the page vocabulary took a dependency it does not need");
  assert.ok(!/from\s+"/.test(source), "the page vocabulary took a dependency it does not need");
});

test("the retired names never reach a label", () => {
  const words = [
    ...Object.values(PAGE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(GROUP_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(SECONDARY_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(MENU_SECTIONS).flatMap((section) => [section.label, section.caption, ...(section.tabs ?? []).map((tab) => tab.label)].filter(Boolean)).flatMap((label) => [label.en, label.uk]),
    ASSISTANT.label.en, ASSISTANT.caption.en, ASSISTANT.caption.uk, MENU_ACTION.label.en, MENU_ACTION.label.uk,
    MENU_FOOT.feedback.en, MENU_FOOT.feedback.uk,
  ];
  for (const word of words) {
    for (const forbidden of FORBIDDEN_NAV_WORDS) {
      assert.ok(!word.toLowerCase().includes(forbidden.toLowerCase()), `"${word}" carries the retired word "${forbidden}"`);
    }
    assert.doesNotMatch(word, /Простий|Профі|\bSimple\b|\bPro\b/, `"${word}" names a depth that no longer exists`);
  }
  for (const retired of ["Passport", "Agents", "Паспорт", "Агенти", "Activity", "Активність", "Operations", "Операції"]) {
    assert.ok(FORBIDDEN_NAV_WORDS.includes(retired), `${retired} is not pinned as retired`);
  }
  for (const live of ["Bridge", "Міст", "History", "Історія", "Stocks", "Акції", "Ринки", "Home", "Головна", "Гроші"]) {
    assert.ok(!FORBIDDEN_NAV_WORDS.includes(live), `${live} is a live page name`);
  }
  assert.equal(PAGE_LABELS.activity.en, "History", "English must read History, not Activity");
  assert.equal(PAGE_LABELS.activity.uk, "Історія", "Ukrainian must not read Активність");
  assert.equal(GROUP_LABELS.money.uk, "Кошти", "the API's kind of work keeps «Кошти»");
  assert.ok(!PRODUCT_PAGE_IDS.includes("home"), "Home is a section, not a registered page");
  const history = readFileSync(new URL("../solana/workspace/history/page.tsx", import.meta.url), "utf8");
  assert.match(history, /<PageHead title="History" \/>/);
  assert.doesNotMatch(history, /text\("Activity"\)/);
});

test("a sub-route marks the page it belongs to, never a page it is not inside", () => {
  assert.equal(pageActiveHref(`${BASE}/bridge`, ROUTES), `${BASE}/bridge`, "Bridge is a page, and owns its own route");
  assert.equal(pageActiveHref(`${BASE}/trade`, ROUTES), `${BASE}/swap`, "the old trade route belongs to Swap");
  assert.equal(pageActiveHref(`${BASE}/receipts`, ROUTES), `${BASE}/activity`, "a receipt belongs to History");
  assert.equal(pageActiveHref(`${BASE}/assets`, ROUTES), `${BASE}/markets`, "asset detail belongs to Markets' screener");
  assert.equal(pageActiveHref(`${BASE}/stocks/AAPLx`, ROUTES), `${BASE}/markets`, "a company's page is inside Markets");
  assert.equal(pageActiveHref(`${BASE}/swap`, ROUTES), `${BASE}/swap`);
  assert.equal(pageActiveHref("/app/agents/inspect", ROUTES), "/app/bots", "agent inspection belongs to My strategies, now «Мої боти»");
  assert.equal(pageActiveHref("/app/plans", ROUTES), "/app/bots", "saved plans are «Мої боти», not a second system");
  assert.equal(pageActiveHref("/app/strategies/abc", ROUTES), "/app/bots", "a strategy's detail is inside its page");
  assert.equal(pageActiveHref("/app/journal", ROUTES), "/app/bots", "plan against outcome is a plan's card");
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
  const { PRODUCT_SCOPE, PRODUCT_SCOPE_SOURCES, parseLayout } = await import("./layout-store.ts");
  assert.deepEqual(PRODUCT_SCOPE_SOURCES, ["solana", "agent-control"], "the order is the migration");
  const chosen = (mode) => ({ mode, depthChosen: true, density: "comfortable", navCollapsed: false, inspectorOpen: false, hidden: [], order: [], panels: {} });
  const both = parseLayout({ version: 2, byWorkspace: { solana: chosen("guided"), "agent-control": chosen("pro") } });
  assert.equal(both.byWorkspace[PRODUCT_SCOPE].mode, "guided", "the money surfaces decide, by the stated rule");
  assert.ok(both.byWorkspace.solana && both.byWorkspace["agent-control"], "a live workspace must keep its own record");
  const onlyControl = parseLayout({ version: 2, byWorkspace: { "agent-control": chosen("pro") } });
  assert.equal(onlyControl.byWorkspace[PRODUCT_SCOPE].mode, "pro", "the second source is used when the first has none");
  const already = parseLayout({ version: 2, byWorkspace: { [PRODUCT_SCOPE]: chosen("pro"), solana: chosen("guided") } });
  assert.equal(already.byWorkspace[PRODUCT_SCOPE].mode, "pro", "an existing choice was overwritten");
  const unchosen = parseLayout({ version: 2, byWorkspace: { solana: { ...chosen("pro"), depthChosen: false } } });
  assert.equal(unchosen.byWorkspace[PRODUCT_SCOPE], undefined, "a default was adopted as if it were a decision");
});

test("a page owns its routes, so no route the product ships is left marking nothing", () => {
  const owned = ROUTES.flatMap((route) => route.match);
  const shipped = [
    `${BASE}/portfolio`, `${BASE}/assets`, `${BASE}/trends`,
    `${BASE}/swap`, `${BASE}/spot`, `${BASE}/stocks`, `${BASE}/perps`, `${BASE}/bridge`,
    `${BASE}/ideas`, `${BASE}/bots`, `${BASE}/strategies`, `${BASE}/results`,
    `${BASE}/send`, `${BASE}/receive`, `${BASE}/rewards`,
    `${BASE}/activity`, `${BASE}/receipts`,
    `${BASE}/agents`, `${BASE}/agents/inspect`, `${BASE}/agents/verify`, `${BASE}/plans`,
  ];
  for (const route of shipped) {
    const landing = pageActiveHref(route, ROUTES);
    assert.notEqual(landing, null, `${route} belongs to no page`);
    assert.ok(ROUTES.find((candidate) => candidate.href === landing), `${route} resolved to a landing no page declares`);
  }
  assert.equal(new Set(owned).size, owned.length, "two pages claim the same route");
});

test("the old addresses of the menu lead to their new places, and /app/history keeps its cached answer", async () => {
  const { customerHref, CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  assert.equal(customerHref("/app/history"), "/app/activity");
  assert.equal(customerHref("/app/activity"), "/app/activity");
  const moved = [
    ["/app/stocks", "/app/markets?tab=stocks"],
    ["/app/stocks/screener", "/app/markets?tab=stocks"],
    ["/app/trends", "/app/markets"],
    ["/app/autoinvest", "/app/bots"],
    ["/app/strategies", "/app/bots"],
    ["/app/plans", "/app/bots"],
    ["/app/results", "/app/bots"],
    ["/app/trade", "/app/swap"],
    ["/app/launch", "/app/launch/new"],
  ];
  for (const [source, destination] of moved) {
    const row = CUSTOMER_REDIRECTS.find((candidate) => candidate.source === source);
    assert.ok(row, `${source} leads nowhere`);
    assert.equal(row.destination, destination, `${source} leads to ${row.destination}`);
    assert.equal(row.permanent, false, `${source} is moved, so its row stays temporary`);
    assert.equal(customerHref(source), destination);
  }
  /* A link's own query follows the target's: the old screener's pre-IPO filter. */
  assert.equal(customerHref("/app/stocks/screener?kind=preipo"), "/app/markets?tab=stocks&kind=preipo");
});
