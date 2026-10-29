import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

import { NAV_GROUPS, NAV_ITEM_IDS, NAV_WORDS } from "@ryntra/core/nav";

import {
  ASSISTANT,
  FORBIDDEN_NAV_WORDS,
  FUTURES_NOW,
  GROUP_LABELS,
  MENU_ACTION,
  MENU_FOOT,
  MENU_PATHS,
  MENU_SECTIONS,
  MENU_SECTION_IDS,
  MENU_TAGS,
  NETWORK_PLATE,
  OFF_SURFACE,
  PAGE_GROUP,
  PAGE_LABELS,
  PAGE_SECTION,
  PERPS_LABEL,
  PRODUCT_GROUP_IDS,
  PRODUCT_PAGE_IDS,
  SECONDARY_LABELS,
  drawn,
  MENU_LIVE,
  menuGroupOf,
  menuNavigation,
  mobileNavigation,
  pageActiveHref,
  registeredPages,
  rowForPath,
} from "./domains.ts";
import { PRODUCT_ROUTES } from "./product-routes.ts";

/**
 * The navigation contract, pinned — Menu 3:
 * Головна, then the core's groups Торгівля · Автоматика · Заробіток · Гроші,
 * each opened by its arrow, with only the rows that live on Solana; every
 * place a row, no tabs above a page; Надіслати and Отримати rows of Гроші; on
 * a phone the core's bar Головна · Торгівля · Гроші · Портфель · Меню. These
 * tests exercise the routes the shell actually consumes, so an obsolete
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

test("Menu 3 — Головна, then the core's groups with the rows that live on Solana, Send and Receive rows of Money", () => {
  assert.deepEqual([...MENU_SECTION_IDS], ["home", "spot", "swap", "markets", "launch", "futures", "predictions", "bots", "assistant", "pools", "rewards", "portfolio", "deposit", "send", "receive", "bridge", "history"]);
  /* Every row is a row of the core's composition; nothing of the product's own. */
  for (const id of MENU_SECTION_IDS) assert.ok(NAV_ITEM_IDS.includes(id), `${id} is not a row of the core's menu`);
  const uk = menuNavigation(ROUTES, "uk");
  const shape = (menu) => menu.groups.map((group) => [group.label, group.rows.map((row) => row.label)]);
  assert.deepEqual(shape(uk), [
    ["Головна", ["Головна"]],
    ["Торгівля", ["Спот", "Обмін", "Ринки", "Лаунч", "Perps", "Прогнози"]],
    ["Автоматика", ["Боти", "Помічник Ryntra"]],
    ["Заробіток", ["Пули", "Винагороди"]],
    ["Гроші", ["Портфель", "Поповнити", "Надіслати", "Отримати", "Між мережами", "Історія"]],
  ]);
  assert.deepEqual(uk.groups.flatMap((group) => group.rows.map((row) => row.href)), [
    "/app/home",
    "/app/spot", "/app/swap", "/app/markets", "/app/launch/markets", "/app/perps", "/app/predictions",
    "/app/bots", "/app/ryn",
    "/app/markets/pools", "/app/rewards",
    "/app/portfolio", "/app/top-up", "/app/send", "/app/receive", "/app/bridge", "/app/activity",
  ]);
  const en = menuNavigation(ROUTES, "en");
  assert.deepEqual(en.groups.map((group) => group.label), ["Home", "Trading", "Automation", "Earning", "Money"]);
  /* Надіслати and Отримати are rows of the first level of Гроші, not a tab of another page. */
  assert.equal(menuGroupOf("send"), "money");
  assert.equal(menuGroupOf("receive"), "money");
  assert.equal(menuGroupOf("home"), null);
  /* What does not live on Solana is not drawn — never a grey row with a caption: no Agents, Earn, Treasury, no «Ще». */
  for (const locale of ["en", "uk"]) {
    const menu = menuNavigation(ROUTES, locale);
    const rows = menu.groups.flatMap((group) => group.rows);
    assert.ok(!rows.some((row) => /^(Agents|Агенти|Earn|Treasury|Казна|Ще|More|Термінал|Terminal)/.test(row.label)), `${locale}: a row that does not live here is drawn`);
    assert.ok(!menu.groups.some((group) => group.id === "treasury"), `${locale}: the treasury is drawn`);
  }
  /* The core's paths after /app: every row opens its own page. */
  assert.equal(MENU_PATHS.home, "home");
  assert.equal(MENU_PATHS.deposit, "top-up");
  assert.equal(MENU_PATHS.history, "activity");
  assert.equal(MENU_PATHS.pools, "markets/pools");
  /* Рішення 56: Perps (Phoenix, B7) and Прогнози (AGG, NAV-6) are rows of Торгівля inside Solana; Ryntra Futures is
     never a row of Solana's Торгівля (and, paused, no link of its menu either — decision 63). */
  assert.deepEqual([...MENU_LIVE], [...MENU_SECTION_IDS]);
  assert.ok(MENU_LIVE.includes("futures"), "Perps live on Solana since B7");
  assert.ok(MENU_LIVE.includes("predictions"), "Прогнози live on Solana since NAV-6");
  /* «Запустити токен» is the Launch page's own action, and the search's. */
  assert.equal(uk.action.label, "Запустити токен");
  assert.equal(en.action.label, "Launch a token");
  assert.equal(uk.action.href, "/app/launch/new");
  /* The assistant is a row of Автоматика and the header's button. */
  assert.equal(uk.assistant.href, "/app/ryn");
  assert.equal(ASSISTANT.ask.uk, "Спитати Ryntra");
  assert.equal(uk.feedbackLabel, "Відгук");
  /* The wallet panel's row is «Акаунт»: «Налаштування» is the menu's own row only. */
  assert.equal(uk.settings.label, "Акаунт");
  assert.equal(uk.settings.href, "/app/settings");
  assert.equal(en.feedbackLabel, "Feedback");
  /* No «Ryn» where a person reads: the assistant is Ryntra. */
  for (const label of [...Object.values(MENU_SECTIONS).map((section) => section.label), ASSISTANT.label, ASSISTANT.caption].flatMap((label) => [label.en, label.uk])) {
    assert.doesNotMatch(label, /\bRyn\b/);
  }
});

test("every drawn page lives in exactly one row; a page that is planned or off the surface is drawn nowhere", () => {
  const placed = MENU_SECTION_IDS.flatMap((id) => MENU_SECTIONS[id].pages);
  assert.deepEqual([...placed].sort(), [...PRODUCT_PAGE_IDS].sort(), "a page is in no row, or in two");
  assert.equal(new Set(placed).size, placed.length, "a page is listed in two rows");
  for (const id of PRODUCT_PAGE_IDS) assert.ok(MENU_SECTIONS[PAGE_SECTION[id]].pages.includes(id), `${id} is placed where it is not listed`);
  /* The registered Perps page stays planned under Spot; the row Perps holds Phoenix's route only (B7, PERP-1). */
  assert.equal(ROUTES.find((route) => route.id === "perps").readiness, "planned");
  assert.equal(PAGE_SECTION.perps, "spot");
  assert.deepEqual([...MENU_SECTIONS.futures.pages], []);
  assert.deepEqual([...OFF_SURFACE], ["predictions"]);
});

test("no tabs above a page: every place is a row of the menu, and the frame draws no row of tabs or tools", () => {
  const frame = code("../app/product-shell.tsx");
  assert.doesNotMatch(frame, /sectionTabs|SectionTabsBar|sol-pagebar|<AskRyntraButton|<HeaderRewards|<NotificationsBell/, "something stands above the page again");
  assert.equal(existsSync(new URL("./section-tabs.tsx", import.meta.url)), false, "the tab bar above a page is back");
  assert.doesNotMatch(code("./app-shell.tsx"), /sectionTabs|SectionTabsBar/, "the old frame draws tabs above a page");
  for (const path of ["../app/portfolio/portfolio-tabs.tsx", "../app/launch/launch-tabs.tsx", "../app/markets/tabs.ts"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, `${path} — a second tab component — is back`);
  }
  for (const path of ["../solana/workspace/holdings/page.tsx", "../solana/workspace/history/page.tsx", "../solana/workspace/send/page.tsx", "../solana/workspace/receive/page.tsx", "../app/launch/new/launch-flow.tsx", "../app/launch/mine/creator-cabinet.tsx"]) {
    assert.doesNotMatch(code(path), /PortfolioTabs|LaunchTabs|<MoneyTabs/, `${path} still draws tabs of its own`);
  }
  /* The frame hands the core the row on screen, its paths and what lives here. */
  assert.match(frame, /section=\{row\}/);
  assert.match(frame, /sectionPaths=\{MENU_PATHS\}/);
  assert.match(frame, /live=\{LIVE\}/);
  assert.match(frame, /onAssistant=/);
});

test("the old frame's phone bar is the core's: Головна · Торгівля · Гроші · Портфель · Меню", () => {
  const phone = mobileNavigation(ROUTES, "uk");
  assert.deepEqual(phone.map((entry) => entry.label), ["Головна", "Торгівля", "Гроші", "Портфель", "Меню"]);
  assert.deepEqual(phone.map((entry) => entry.href), ["/app/home", "/app/spot", "/app/top-up", "/app/portfolio", null]);
  assert.deepEqual(mobileNavigation(ROUTES, "en").map((entry) => entry.label), ["Home", "Trading", "Money", "Portfolio", "Menu"]);
  /* Гроші stands for every row of its group, Send and Receive among them. */
  assert.ok(phone[2].matches.includes("/app/send") && phone[2].matches.includes("/app/receive"));
  /* The product's own frame is the core's: below 1024 px it draws the same bar of the core's places (`PhoneBar`), with
     «Гроші» opening its four large actions and «Меню» the core's sheet (NAV-1, in place of B19) — handed to the core as
     its `bottomBar` (A14, SOL-C11), which pins it and keeps a page's pinned action above it (UX-900). */
  assert.doesNotMatch(code("../app/product-shell.tsx"), /mobileNavigation|ProductMobileNav|RyntraAppShell/);
  assert.match(code("../app/product-shell.tsx"), /bottomBar=\{\(menu\) => <PhoneBar locale=\{locale\} row=\{row\} onNavigate=\{navigate\} menu=\{menu\} \/>\}/);
  const bar = code("../app/phone-bar.tsx");
  assert.match(bar, /PHONE_BAR\.map/);
  assert.match(bar, /MONEY_ACTIONS\.map/);
  assert.match(bar, /menu\.onOpen\(\)/);
  assert.doesNotMatch(bar, /\.ryntra-header__menu--phone/, "the bar presses the header's button again instead of opening the core's sheet");
  /* The core pins the bar: the product's stylesheet pins nothing of it and pads no page for it. */
  const css = code("../app/frame.css");
  assert.doesNotMatch(css, /\.sol-phonebar \{[^}]*position: fixed/);
  assert.doesNotMatch(css, /\.sol-canvas \{ padding-bottom/);
});

test("one projection, taking nothing but the routes and a language — no depth, no switch, no cookie", () => {
  for (const projector of [mobileNavigation, menuNavigation]) {
    assert.equal(projector.length, 2, `${projector.name} takes (routes, locale) and nothing else`);
  }
  assert.equal(rowForPath.length, 1, "rowForPath takes a path and nothing else");
  const shell = code("./app-shell.tsx");
  assert.doesNotMatch(shell, /simpleNavigation|simpleMobileNavigation|resolveDepth\(|modeForDepth|lib\/product\/depth/, "the shell still chooses a menu by depth");
  assert.match(shell, /const menu = product \? menuNavigation\(product\.routes, product\.locale\) : null;/);
  assert.match(shell, /domainRoutes=\{menu\?\.routes\}/);
  assert.match(shell, /entries=\{mobileNavigation\(product\.routes, product\.locale\)\}/);
  assert.match(shell, /activeHref=\{pageActiveHref\(pathname, menu\.routes\)\}/);
  /* The core's frame takes the row from the same routes: no depth, no cookie decides it. */
  assert.match(code("../app/product-shell.tsx"), /return rowForPath\(pathname\);/);
  assert.doesNotMatch(code("../app/product-shell.tsx"), /DepthSwitch/, "the product rail still carries the switch");
  assert.equal(existsSync(new URL("../../lib/product/depth.ts", import.meta.url)), false, "the depth cookie module is back");
  for (const path of ["../app/layout.tsx", "../app/stocks/[ticker]/page.tsx", "../solana/workspace/holdings/page.tsx", "./shell-state.tsx", "../../lib/product/customer-routing.ts"]) {
    assert.doesNotMatch(code(path), /ryntra-depth|DEPTH_COOKIE|depthFromCookie/, `${path} still reads the depth cookie`);
  }
});

test("a row of the menu is current on every route it stands for, and nowhere else", () => {
  const cases = [
    ["/app/home", "home"],
    ["/app/markets", "markets"],
    ["/app/stocks", "markets"],
    ["/app/stocks/AAPLx", "markets"],
    ["/app/stocks/screener", "markets"],
    ["/app/trends", "markets"],
    ["/app/assets", "markets"],
    ["/app/markets/pools", "pools"],
    ["/app/markets/pools/5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6", "pools"],
    ["/app/launch/new", "launch"],
    ["/app/launch/markets", "launch"],
    ["/app/launch/mine", "launch"],
    ["/app/launch/So11111111111111111111111111111111111111112", "launch"],
    ["/app/spot", "spot"],
    ["/app/swap", "swap"],
    ["/app/trade", "swap"],
    ["/app/bots", "bots"],
    ["/app/bots/catalog", "bots"],
    ["/app/autoinvest", "bots"],
    ["/app/strategies/new", "bots"],
    ["/app/strategies/plans/plan_1", "bots"],
    ["/app/plans", "bots"],
    ["/app/results", "bots"],
    ["/app/journal", "bots"],
    ["/app/portfolio", "portfolio"],
    ["/app/activity", "history"],
    ["/app/receipts", "history"],
    ["/app/receipts/abc", "history"],
    ["/app/fees", "history"],
    ["/app/rewards", "rewards"],
    ["/app/rewards/season", "rewards"],
    ["/app/top-up", "deposit"],
    ["/app/send", "send"],
    ["/app/receive", "receive"],
    ["/app/bridge", "bridge"],
    ["/app/ryn", "assistant"],
    ["/app/research", "assistant"],
    ["/app/predictions", "predictions"],
    ["/app/predictions/evt_1", "predictions"],
    ["/app/predictions/portfolio", "predictions"],
  ];
  for (const [path, expected] of cases) assert.equal(rowForPath(path), expected, `${path} lights the wrong row`);
  /* Settings and Нагляд light no row; nor does an unknown sibling. */
  for (const path of ["/app/settings", "/app/alerts", "/app/predictions-extra", "/app/markets-extra", "/app"]) {
    assert.equal(rowForPath(path), null, `${path} lights a row of the menu`);
  }
});

test("Прогнози is a row of Торгівля after Ф'ючерси; its pages answer at their own address", async () => {
  const predictions = ROUTES.find((route) => route.id === "predictions");
  assert.equal(predictions.readiness, "available");
  /* The registered page has no documentation yet, so it stays off the documented surface; the row holds the route. */
  assert.equal(drawn(predictions), false);
  assert.deepEqual([...MENU_SECTIONS.predictions.pages], []);
  for (const locale of ["en", "uk"]) {
    const trading = menuNavigation(ROUTES, locale).groups.find((group) => group.id === "trading");
    const ids = trading.rows.map((row) => row.id);
    assert.equal(ids[ids.indexOf("launch") + 1], "futures", `Ф'ючерси (${locale}) stand right after Лаунч`);
    assert.equal(ids[ids.indexOf("futures") + 1], "predictions", `Прогнози (${locale}) stands right after Ф'ючерси`);
    assert.equal(trading.rows.find((row) => row.id === "predictions").href, "/app/predictions");
    assert.equal(trading.rows.find((row) => row.id === "predictions").label, locale === "uk" ? "Прогнози" : "Predictions");
  }
  const { CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  for (const source of ["/app/predictions", "/app/predictions/:path*"]) {
    assert.ok(!CUSTOMER_REDIRECTS.some((candidate) => candidate.source === source), `${source} leads away from its own pages`);
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
  for (const route of ROUTES.filter((candidate) => candidate.readiness === "planned" && candidate.id !== "perps")) {
    const row = byPath.get(route.href);
    assert.ok(row, `${route.href} is planned and still a place a person can land`);
    assert.equal(row.permanent, false, `${route.href} must be free to come back when it is built`);
    assert.ok(working.has(row.destination) || row.destination === "/app/ryn", `${route.href} leads to ${row.destination}, which is not a page that works`);
  }
  /* The one planned page with no redirect: Perps, whose address is the row Perps' own — Phoenix inside Solana (B7,
     PERP-1), a row of the menu that holds its route only. The page its address serves is Phoenix's, not the not-yet. */
  for (const route of ROUTES.filter((candidate) => candidate.readiness === "planned" && !byPath.has(candidate.href))) {
    assert.equal(route.id, "perps", `${route.href} is planned and still a place a person can land`);
    assert.equal(route.href, MENU_SECTIONS.futures.href);
  }
});

test("a page with no destination cannot be rendered at all", () => {
  assert.throws(() => menuNavigation(ROUTES.filter((route) => route.id !== "send"), "en"), /send.*has no route/i);
  assert.throws(() => menuNavigation(ROUTES.map((r) => (r.id === "stocks" ? { ...r, href: "  " } : r)), "en"), /stocks.*empty route/i);
});

test("every page and row is a page the router actually serves", () => {
  const served = (href) => {
    const dir = new URL(`../../app${href}/`, import.meta.url);
    return ["page.tsx", "page.ts", "page.jsx", "page.js"].some((name) => existsSync(new URL(name, dir)));
  };
  for (const route of ROUTES) {
    assert.ok(route.href.startsWith(`${BASE}/`), `${route.id} leaves the wallet provider's subtree`);
    assert.ok(served(route.href), `${route.id} points at ${route.href}, which no page file serves`);
  }
  for (const id of MENU_SECTION_IDS) {
    assert.ok(served(MENU_SECTIONS[id].href), `the row ${id} opens on ${MENU_SECTIONS[id].href}, which no page file serves`);
  }
  /* The pages under a row that its page links to. */
  for (const href of ["/app/launch/mine", "/app/bots/catalog"]) assert.ok(served(href), `${href} is no page`);
  assert.ok(served(ASSISTANT.href) && served(MENU_ACTION.href) && served(MENU_FOOT.settings.href) && served(MENU_FOOT.notifications.href));
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
  /* Perps draws Phoenix's markets, not the not-yet surface: its address re-exports Phoenix's page (PERP-1). */
  assert.doesNotMatch(readFileSync(new URL("../solana/workspace/futures/page.tsx", import.meta.url), "utf8"), /NotYet/);
  assert.doesNotMatch(readFileSync(new URL("../app/perps/page.tsx", import.meta.url), "utf8"), /NotYet/);
  for (const id of ["ideas"]) {
    const source = readFileSync(new URL(`../app/${id}/page.tsx`, import.meta.url), "utf8");
    assert.ok(source.includes(`page="${id}"`) && source.includes("<NotYet"), `${id} must take its status from the registry, not from a prop`);
    assert.doesNotMatch(source, /readiness=/, `${id} states a readiness of its own`);
    assert.notEqual(byRoute.get(id).readiness, "available", `${id} renders the not-yet surface and calls itself available`);
  }
});

test("both locales are complete, and neither is the other's fallback", () => {
  /* «Perps» is the same word in both languages on purpose, as Ryntra is. */
  for (const id of PRODUCT_PAGE_IDS) {
    const label = PAGE_LABELS[id];
    assert.ok(label.en && label.uk, `${id} is missing a locale`);
    if (id === "perps") assert.deepEqual(label, PERPS_LABEL);
    else assert.notEqual(label.uk, label.en, `${id} is the same word in both locales, so one of them is untranslated`);
  }
  for (const id of PRODUCT_GROUP_IDS) assert.notEqual(GROUP_LABELS[id].uk, GROUP_LABELS[id].en, `the kind ${id} is untranslated`);
  for (const [key, label] of Object.entries(SECONDARY_LABELS)) {
    assert.ok(label.en.length > 0 && label.uk.length > 0, `${key} is missing a locale`);
    assert.notEqual(label.uk, label.en, `${key} is untranslated`);
  }
  for (const id of MENU_SECTION_IDS) {
    const section = MENU_SECTIONS[id];
    if (id === "futures") assert.deepEqual(section.label, PERPS_LABEL);
    else assert.notEqual(section.label.uk, section.label.en, `the row ${id} is untranslated`);
  }
  /* The assistant carries the product's own name in both languages, on purpose. */
  assert.equal(ASSISTANT.label.uk, "Ryntra");
  assert.equal(ASSISTANT.label.en, "Ryntra");
});

test("the rail cannot throw for want of a translation", () => {
  const source = readFileSync(new URL("./domains.ts", import.meta.url), "utf8");
  assert.ok(!/translateSolana\s*\(/.test(source), "the rail now calls the fail-closed translator");
  /* One dependency: the core's composition of the menu — pure data and words, no React, no styles. */
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["@ryntra/core/nav"], "the page vocabulary took a dependency it does not need");
  assert.ok(NAV_GROUPS.length >= 4);
});

test("the retired names never reach a label", () => {
  const words = [
    ...Object.values(PAGE_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(GROUP_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(SECONDARY_LABELS).flatMap((label) => [label.en, label.uk]),
    ...Object.values(MENU_SECTIONS).flatMap((section) => [section.label.en, section.label.uk]),
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
  assert.ok(!PRODUCT_PAGE_IDS.includes("home"), "Home is a row, not a registered page");
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

test("Perps of Торгівля are Phoenix inside Solana, one row with what it lets a person do now; no «Мережа», no «Інші продукти» (B7, SOL-C2, PERP-1)", async () => {
  for (const locale of ["en", "uk"]) {
    const trading = menuNavigation(ROUTES, locale).groups.find((group) => group.id === "trading");
    const futures = trading.rows.find((row) => row.id === "futures");
    assert.equal(futures.href, "/app/perps");
    /* «Perps» in both languages, not the core's «Ф'ючерси» / «Futures». */
    assert.equal(futures.label, "Perps");
    assert.equal(MENU_SECTIONS.futures.label[locale], "Perps");
    assert.equal(registeredPages(ROUTES, locale).find((entry) => entry.id === "perps").label, "Perps");
  }
  assert.deepEqual(PERPS_LABEL, { en: "Perps", uk: "Perps" });
  /* The core's word stays the core's: the other networks and the phone read it unchanged. */
  assert.equal(NAV_WORDS.uk.items.futures, "Ф'ючерси");
  assert.equal(rowForPath("/app/perps"), "futures");
  assert.equal(rowForPath("/app/futures"), "futures");
  assert.equal(MENU_PATHS.futures, "perps");
  const frame = code("../app/product-shell.tsx");
  /* The core reads one address per id: its `futures` row is Phoenix's page; no separate product and no second network
     of the core's catalogue is handed to the menu for now (decision 63). */
  assert.match(frame, /futures: "\/app\/perps"/);
  assert.doesNotMatch(frame, /"\/app\/futures"/);
  assert.doesNotMatch(frame, /trade\.ryntra\.io|app\.ryntra\.io|FUTURES_TERMINAL|SECOND_APP|PHONE_APP_URL/);
  /* No «Мережа» (an empty list), no «Інші продукти» (no separate product reaches the menu). */
  assert.match(frame, /networks=\{NO_NETWORKS\}/);
  assert.match(frame, /const NO_NETWORKS: readonly NetworkOption\[\] = \[\];/);
  assert.match(frame, /const MENU_PRODUCTS = PRODUCTS\.filter\(\(product\) => !product\.separate\);/);
  assert.match(frame, /products=\{MENU_PRODUCTS\}/);
  /* The core draws its `futures` row as another product's; the frame leaves the arrow out for Solana's own page. */
  const css = code("../app/frame.css");
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\] > \.ryntra-menu__mark/);
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\] > \.ryntra-visually-hidden/);
  assert.doesNotMatch(css, /\/app\/futures/);
  /* The row's word: the core's label leaves the page (hidden from the eye and a screen reader alike) and the frame's
     «Perps» — the search's word too — stands in its place, handed over as a custom property. */
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\] > \.ryntra-menu__label \{\s*visibility: hidden;\s*font-size: 0;\s*\}/);
  /* The word is the row's own generated content — a hidden label's would not be the link's name — and the core's bar of
     the page on screen moves to the hidden label for this row. */
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\]::before,\s*[^{]*\.ryntra-menu__row\[href="\/app\/perps"\]\[aria-current="page"\]::before \{[^}]*position: static;[^}]*background: none;[^}]*content: var\(--sol-menu-word-futures, "Perps"\);/);
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\]\[aria-current="page"\] > \.ryntra-menu__label::before \{[^}]*position: absolute;[^}]*background: var\(--ryntra-brand\);[^}]*visibility: visible;[^}]*content: "";/);
  assert.match(frame, /"--sol-menu-word-futures": JSON\.stringify\(PERPS_LABEL\[locale\]\)/);
  /* Orders are open (B6b, 22.10): the row carries no tag — a tag stands only where a place does less than its word. */
  assert.equal(MENU_TAGS.futures, undefined);
  assert.deepEqual(FUTURES_NOW, { en: "orders open", uk: "ордери відкриті" });
  assert.match(css, /\.ryntra-menu__row\[href="\/app\/perps"\]::after \{\s*content: var\(--sol-menu-tag-futures, none\);/);
  assert.match(frame, /style=\{menuTagStyle\(locale\)\}/);
  /* `/app/perps` is the page itself — Phoenix's, no longer the Hyperliquid terminal, no Hyperliquid code in it — and the
     old `/app/futures` leads there for good (PERP-1): a permanent redirect, one hop, the query kept. */
  const { customerHref, CUSTOMER_REDIRECTS, CUSTOMER_PATHS } = await import("../../lib/product/customer-routing.ts");
  assert.equal(code("../app/perps/page.tsx").trim(), 'export { default, generateMetadata } from "@/app/solana/workspace/futures/page";');
  assert.equal(existsSync(new URL("../app/futures/page.tsx", import.meta.url)), false, "/app/futures is a redirect, not a page");
  assert.equal(CUSTOMER_REDIRECTS.some((row) => row.source === "/app/perps"), false, "/app/perps is the page, never a redirect");
  assert.deepEqual(CUSTOMER_REDIRECTS.find((row) => row.source === "/app/futures"), { source: "/app/futures", destination: "/app/perps", permanent: true });
  assert.equal(customerHref("/app/futures"), "/app/perps");
  assert.equal(customerHref("/app/futures?market=BTC"), "/app/perps?market=BTC");
  assert.equal(customerHref("/app/perps"), "/app/perps");
  assert.equal(CUSTOMER_PATHS.perps, "/app/perps");
  /* The old workspace address too (UX-952), straight to the new one: a row of the redirects, not a `redirect()` in the
     page `/app/perps` re-exports — that would loop. */
  assert.equal(customerHref("/solana/workspace/futures"), "/app/perps");
  assert.deepEqual(CUSTOMER_REDIRECTS.find((row) => row.source === "/solana/workspace/futures"), { source: "/solana/workspace/futures", destination: "/app/perps", permanent: true });
  assert.ok(CUSTOMER_REDIRECTS.every((row) => row.destination !== "/app/futures"), "a redirect still leads to /app/futures, a second hop");
  assert.doesNotMatch(code("../solana/workspace/futures/page.tsx"), /\bredirect\(/);
  /* Every link of line A to the page names the new address; the API keeps its name. */
  for (const file of ["../app/home/home-surface.tsx", "../solana/workspace/holdings/phoenix-block.tsx", "../solana/workspace/holdings/holdings-card.tsx", "../app/account/account-context.tsx"]) {
    assert.match(code(file), /"\/app\/perps"/, `${file} does not open /app/perps`);
    assert.doesNotMatch(code(file), /"\/app\/futures"/, `${file} still opens /app/futures`);
  }
  assert.match(code("../solana/workspace/futures/use-futures-data.ts"), /\/api\/solana\/futures\/markets/);
  for (const file of ["futures-workspace.tsx", "use-futures-data.ts", "futures-chart-source.ts", "page.tsx"]) {
    assert.doesNotMatch(code(`../solana/workspace/futures/${file}`), /hyperliquid|lib\/arc\/perps/i, `${file} pulls Hyperliquid into the Solana build`);
  }
});

test("the header names the network on a plate: «Solana Mainnet Beta», the core's `network`, no switch (SOL-C11, decision 63)", () => {
  assert.equal(NETWORK_PLATE, "Solana Mainnet Beta");
  const frame = code("../app/product-shell.tsx");
  assert.match(frame, /network=\{NETWORK_PLATE\}/);
  /* A plate, not a choice: no «Мережа» and no «Інші продукти» at the foot of the menu (SOL-C2). */
  assert.match(frame, /networks=\{NO_NETWORKS\}/);
});
