// B15 «Дані без порожнечі» (огляд B13, п. 4, 5, 6, 9): «Пули» й «Лаунч» стоять скелетом з першої секунди й відкриваються
// з входом; графік дешевого токена має шкалу й ціну з нулями під індексом; заголовок і графік — одна остання ціна;
// вибраний період видно; тестових ринків у публічних «Лаунчах» немає; позначки ризику — лише неперевіреним і новим.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { publicLaunchMarkets } from "../launch/markets/public-markets.ts";
import { authorityFlagsShown, NEW_TOKEN_DAYS } from "../../../lib/markets/screener.ts";
import { formatTerminalPrice, priceDecimals } from "../../solana/workspace/spot/spot-format.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("a price prints with the decimals its size needs, four zeros or more in a subscript, from 1e-9 to 1e5", () => {
  const cases = [
    [1e-9, "en", "0.0₈1000"],
    [3.012e-6, "en", "0.0₅3012"],
    [3.012e-6, "uk", "0,0₅3012"],
    [0.0000301, "en", "0.0₄3010"],
    [0.00012, "en", "0.0001200"],
    [0.004512, "en", "0.004512"],
    [0.1408, "uk", "0,1408"],
    [1.2345, "en", "1.23"],
    [104.11, "en", "104.11"],
    [104.11, "uk", "104,11"],
    [12_345.678, "en", "12,345.68"],
    [1e5, "en", "100,000.00"],
  ];
  for (const [value, locale, expected] of cases) assert.equal(formatTerminalPrice(value, locale), expected, `${value} in ${locale}`);
  assert.equal(formatTerminalPrice(null, "en"), "—");
  assert.equal(formatTerminalPrice(Number.NaN, "en"), "—");
  /* An axis prints every step with the reference price's decimals, so its labels line up. */
  const decimals = priceDecimals(3.012e-6);
  assert.equal(decimals, 9);
  assert.equal(formatTerminalPrice(3.1e-6, "en", decimals), "0.0₅3100");
  assert.equal(formatTerminalPrice(2.95e-6, "en", decimals), "0.0₅2950");
  assert.equal(priceDecimals(null), 2);
  assert.equal(priceDecimals(0.001), 6, "0.001 has two zeros after the point, then four digits");
});

test("the chart, the header and the tape print the price with that one formatter, and the chart's last bar is the page's last price", () => {
  const CHART = read("app/solana/workspace/spot/spot-chart.tsx");
  const SOURCE = read("app/solana/workspace/spot/core-chart-source.ts");
  const HEADER = read("app/solana/workspace/spot/market-header.tsx");
  const TAPE = read("app/solana/workspace/spot/token-tabs.tsx");
  const PAGE = read("app/solana/workspace/spot/spot-workspace.tsx");
  /* The core's chart (CH-17): the price's step is the header's decimals, the core folds a cheap price's zeros as the header does. */
  assert.match(SOURCE, /const decimals = priceDecimals\(reference\);/, "the series steps by the price's decimals");
  assert.match(SOURCE, /withLivePrice\(read\.candles, this\.#live\?\.price \?\? null/, "the live price closes the bar of the moment");
  assert.match(CHART, /feed\?\.live\(livePrice \?\? null\)/, "the page's one last price goes to the chart");
  assert.match(PAGE, /livePrice=\{livePrice\}/);
  assert.match(PAGE, /market\.status === "ready" && !market\.stale \? \(market\.value\?\.price \?\? null\) : null/, "only a fresh price closes the bar");
  assert.match(HEADER, /\$\{formatTerminalPrice\(market\.price, locale\)\}/);
  assert.match(HEADER, /data-price-age/, "a price past a minute carries its age");
  assert.match(TAPE, /<th scope="col" data-num data-narrow-hide>\{text\("Price"\)\}<\/th>/, "the tape has a price column, beside the size on a desk");
});

test("the chosen window, the chosen filter and the chosen timeframe show — by the state they state, not a renamed class", () => {
  const CSS = read("app/solana/workspace/spot/spot.module.css");
  assert.match(CSS, /\.tokenFilters button\[aria-pressed="true"\]/);
  assert.doesNotMatch(CSS, /\.tokenFilters button\.on/, "`.on` inside a CSS module never matched a literal class");
  /* SOL-C12: one interval switch on the page — the chart's; the strip's change is the day's, named as such. */
  assert.doesNotMatch(read("app/solana/workspace/spot/market-header.tsx"), /<select/);
  assert.match(read("app/components/chart/ProChart.tsx"), /aria-pressed=\{tf === x\}/);
});

test("«Лаунчі на Ryntra» shows people's launches only: the team's technical validations stay off the public board", () => {
  const rows = [
    { token: "STAIR", technicalValidation: true },
    { token: "THUMB", technicalValidation: true },
    { token: "PEOPLE", technicalValidation: false },
  ];
  assert.deepEqual(publicLaunchMarkets(rows).map((row) => row.token), ["PEOPLE"]);
  assert.deepEqual(publicLaunchMarkets(rows.slice(0, 2)), [], "only tests: the board is honestly empty");
  const BOARD = read("app/app/launch/markets/markets-board.tsx");
  assert.match(BOARD, /const markets = publicLaunchMarkets\(list\?\.markets \?\? \[\]\)/);
  assert.match(BOARD, /markets\.length === 0 \? \([\s\S]{0,200}?<EmptyState[\s\S]*?text=\{word\("marketsEmpty"\)\}[\s\S]*?<LinkButton href="\/app\/launch\/new">/, "empty: one sentence and «Запустити токен», quietly beside the heading's orange one");
});

test("«Випуск відкритий» and «Заморозка можлива» only for a token not verified, flagged or new", () => {
  const row = (over) => ({ verified: true, suspicious: false, ageDays: 900, ...over });
  assert.equal(authorityFlagsShown(row({})), false, "cbBTC, ETH, WBTC, JitoSOL: verified and old — no false alarm");
  assert.equal(authorityFlagsShown(row({ verified: false })), true);
  assert.equal(authorityFlagsShown(row({ suspicious: true })), true);
  assert.equal(authorityFlagsShown(row({ ageDays: NEW_TOKEN_DAYS - 1 })), true, "a new token, verified or not");
  assert.equal(authorityFlagsShown(row({ ageDays: null })), false);
  const SCREENER = read("app/app/markets/markets-screener.tsx");
  assert.match(SCREENER, /authorityFlagsShown\(row\) && row\.mintAuthorityOff === false/);
  assert.match(SCREENER, /authorityFlagsShown\(row\) && row\.freezeAuthorityOff === false/);
});

test("«Пули», a pool, «Додати ліквідність» and «Лаунч» stand in their own skeleton from the first paint, and a failure stays in the frame", () => {
  for (const route of [
    "app/app/markets/pools/loading.tsx",
    "app/app/markets/pools/[address]/loading.tsx",
    "app/app/markets/pools/[address]/add/loading.tsx",
    "app/app/markets/pools/[address]/position/[position]/loading.tsx",
    "app/app/launch/markets/loading.tsx",
    "app/app/launch/[mint]/loading.tsx",
  ]) {
    assert.ok(existsSync(new URL(route, root)), `${route} exists`);
  }
  const SKELETONS = read("app/app/markets/pools/pools-loading.tsx") + read("app/app/launch/launch-loading.tsx");
  assert.doesNotMatch(SKELETONS, /"Завантаження…"|"Loading…"/, "a skeleton of the page, not a bare word");
  assert.match(read("app/app/markets/pools/pools-catalog.tsx"), /style=\{\{ height: 40 \}\}/, "the catalogue's rows are the table's own height (40 since B17), so nothing jumps");
  const ERROR = read("app/app/error.tsx");
  assert.match(ERROR, /<EmptyState[\s\S]*role="alert"/);
  assert.match(ERROR, /router\.refresh\(\);\s*reset\(\);/, "«Спробувати знову» reads the page again");
});

test("with a sign-in, every pool and every launch page stays public — never «Перевіряємо вхід…»", () => {
  const ACCOUNT = read("app/app/account/account-context.tsx");
  assert.match(ACCOUNT, /const PUBLIC_PREFIXES = \["\/app\/markets\/", "\/app\/launch\/"\] as const;/);
  assert.match(ACCOUNT, /"\/app\/launch"\]\);/);
  assert.match(ACCOUNT, /if \(checking && !isPublicPage\(pathname\)\)/);
  assert.match(ACCOUNT, /if \(privacyBlocked && !isPublicPage\(pathname\)\)/);
});

test("a page's metadata waits for a read 400 ms at most, so the skeleton is never held behind Meteora or the chain", async () => {
  const { withinMetadataBudget, METADATA_BUDGET_MS } = await import("../metadata-budget.ts");
  assert.equal(METADATA_BUDGET_MS, 400);
  assert.equal(await withinMetadataBudget(Promise.resolve("SOL/USDC"), null, 50), "SOL/USDC", "a read in time names the page");
  const started = Date.now();
  assert.equal(await withinMetadataBudget(new Promise((resolve) => setTimeout(() => resolve("late"), 500)), null, 50), null, "a late read leaves the section's title");
  assert.ok(Date.now() - started < 400);
  assert.equal(await withinMetadataBudget(Promise.reject(new Error("down")), null, 50), null, "a failed read too");
  assert.match(read("app/app/markets/pools/[address]/page.tsx"), /await withinMetadataBudget\(\s*Promise\.all\(LIQUIDITY_POOL_KINDS/);
  assert.match(read("app/app/launch/[mint]/page.tsx"), /await withinMetadataBudget\(view\(mint\), null\)/);
});

test("a wallet's own pages under the public catalogues keep the sign-in gate; a failure page claims nothing it cannot know", () => {
  const ACCOUNT = read("app/app/account/account-context.tsx");
  assert.match(ACCOUNT, /const PERSONAL_PAGES = \[/);
  assert.match(ACCOUNT, /\(\?:mine\|positions\)/, "«Мої лаунчі» and the launch positions");
  assert.ok(ACCOUNT.includes("pools\\/[^/]+\\/(?:position|add)"), "a pool position's page and the add form that spends the wallet's balances");
  const ERROR = read("app/app/error.tsx");
  assert.doesNotMatch(ERROR, /нічого не змінилось|Nothing was changed/, "it cannot know what an action's page already did");
  assert.match(ERROR, /href="\/app\/activity"/, "what the wallet signed is in History");
});
