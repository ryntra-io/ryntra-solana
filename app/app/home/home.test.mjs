// Run from repo root: node --test app/app/home/home.test.mjs
//
// Home 2 (B2b, огляд B13 п. 2) as the screen draws it. A guest: «Ринки зараз» and Pulse open in the main column,
// «Почни за три кроки» and «Лаунчі на Ryntra» beside them, «Підключити гаманець» the one orange action. A wallet:
// «Вартість портфеля» — wallet, pools and orders by the one rule Portfolio draws — with four quick actions, «Мої
// активи», «Останні операції» from the server's history; beside them «Потребує уваги», «Відкриті ордери», «Рухи дня»;
// Pulse open below, only the portfolio's risk under «Деталі». Words in both languages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATTENTION_ROWS,
  HOME_ACTION_HREF,
  HOME_ROWS_SHOWN,
  LAUNCH_ROWS,
  MARKET_ROWS,
  MARKET_TABS,
  assetRows,
  attentionItems,
  dayChangeOf,
  homeAction,
  homeRows,
  launchLines,
  marketRows,
  ordersView,
  recentOperations,
} from "./home-model.ts";
import { homeWords } from "./home-words.ts";

const code = (name) =>
  readFileSync(new URL(name, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
const SURFACE = code("./home-surface.tsx");
const CSS = readFileSync(new URL("./home.module.css", import.meta.url), "utf8");
const PULSE = code("./pulse.tsx");

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const order = (over) => ({
  key: "k",
  venue: "trigger",
  order: "o",
  side: "buy",
  baseMint: SOL,
  quoteMint: USDC,
  inputMint: USDC,
  outputMint: SOL,
  makingRaw: "5200000",
  takingRaw: "48941177",
  filledInputRaw: "0",
  filledOutputRaw: "0",
  ryntraFeeRaw: "0",
  ryntraBps: 10,
  fillPrice: 106.14,
  state: "OPEN",
  placeSignature: null,
  cancelSignature: null,
  fills: [],
  createdAt: "2026-10-16T08:00:00.000Z",
  updatedAt: "2026-10-16T08:00:00.000Z",
  throughRyntra: true,
  canCancel: true,
  canClaim: false,
  pool: null,
  ...over,
});
const position = (key, dollars, change = null) => ({ key, name: key, href: `/app/spot?mint=${key}`, value: BigInt(Math.round(dollars * 1_000_000)), change });
let actions = 0;
const action = (over) => ({ actionId: `a${(actions += 1)}`, outcome: "DONE", updatedAt: "2026-10-16T08:00:00.000Z", lane: "SWAP", origin: null, out: null, in: null, ...over });
const card = (n) => ({ name: `Company ${n}`, ticker: `C${n}x`, mint: `mintC${n}`, icon: null, price: 100 + n, change24h: n % 2 ? 1.5 : -0.5, volume24h: 1_000_000 - n, issuer: "xstocks" });
const coin = (n, prefix = "coin") => ({ name: `${prefix} ${n}`, symbol: `${prefix.toUpperCase()}${n}`, mint: `${prefix}${n}`, icon: null, price: 1 + n, change24h: null, volume24h: 500_000 - n });
const INDEX = {
  companies: Array.from({ length: 12 }, (_, n) => card(n)),
  privateCompanies: [],
  coins: Array.from({ length: 12 }, (_, n) => coin(n)),
  memes: Array.from({ length: 3 }, (_, n) => coin(n, "meme")),
  dollars: [],
};

test("the one orange action is the step that works next: dollars, then the network's SOL, then a trade", () => {
  assert.equal(homeAction("usdc"), "top-up");
  assert.equal(homeAction("sol"), "top-up-sol");
  assert.equal(homeAction("ready"), "trade");
  assert.equal(homeAction("unknown"), "trade");
  assert.equal(HOME_ACTION_HREF["top-up"], "/app/top-up");
  assert.equal(HOME_ACTION_HREF["top-up-sol"], "/app/top-up?need=sol");
  assert.equal(HOME_ACTION_HREF.trade, "/app/spot");
});

test("«Ринки зараз»: Акції · Крипта · Меми · Рухи дня, eight rows of each list in its own order; a company opens its page, a coin its market", () => {
  assert.deepEqual([...MARKET_TABS], ["stocks", "crypto", "memes", "movers"], "Home's one list of markets: the movers are its tab (SOL-C5)");
  const stocks = marketRows(INDEX, "stocks");
  assert.equal(stocks.length, MARKET_ROWS);
  assert.equal(MARKET_ROWS, 8);
  assert.deepEqual(stocks.map((row) => row.symbol).slice(0, 2), ["C0x", "C1x"], "the shelf's own order: the day's volume");
  assert.equal(stocks[0].href, "/app/stocks/C0x");
  const crypto = marketRows(INDEX, "crypto", 5);
  assert.equal(crypto.length, 5, "a phone's five");
  assert.equal(crypto[0].href, "/app/spot?mint=coin0");
  assert.equal(crypto[0].change24h, null, "an unknown day is not a zero");
  assert.equal(marketRows(INDEX, "memes").length, 3, "a short list is drawn as it is");
  assert.deepEqual(marketRows({ ...INDEX, companies: [] }, "stocks"), []);
  /* The day's movers: the biggest moves first, a company its page, a coin its market — never a meme. */
  const movers = marketRows(INDEX, "movers");
  assert.ok(movers.length > 0 && movers.length <= MARKET_ROWS);
  assert.ok(movers.every((row, at) => at === 0 || Math.abs(row.change24h) <= Math.abs(movers[at - 1].change24h)), "the largest moves first");
  assert.ok(movers.every((row) => !INDEX.memes.some((meme) => meme.mint === row.mint)));
});

test("«Лаунчі на Ryntra»: people's launches only — never the team's technical validations — four rows, the curve's way to the DEX", () => {
  const row = (token, over) => ({ token, name: token, symbol: token.toUpperCase(), image: null, technicalValidation: false, progress: { bps: 5_400, migrated: false }, holders: 12, holdersAtLeast: false, ...over });
  const lines = launchLines([row("a"), row("team", { technicalValidation: true }), row("b", { progress: { bps: 10_000, migrated: true } }), row("c", { progress: null }), row("d"), row("e")]);
  assert.equal(lines.length, LAUNCH_ROWS);
  assert.deepEqual(lines.map((line) => line.key), ["a", "b", "c", "d"]);
  assert.equal(lines[0].progressPct, 54);
  assert.equal(lines[0].href, "/app/launch/a");
  assert.equal(lines[1].onDex, true);
  assert.equal(lines[1].progressPct, null, "on the DEX: no curve bar");
  assert.equal(lines[2].progressPct, null, "a curve not read: no bar, never 0 %");
  /* Never a name with a hate word under Ryntra's name on a guest's first screen. */
  assert.deepEqual(launchLines([row("ok"), row(["na", "zi"].join(""), { name: ["Na", "zi Coin"].join("") })]).map((line) => line.key), ["ok"]);
});

test("«Мої активи»: the largest five above dust, each with its part of the portfolio's value", () => {
  const rows = assetRows([position("SOL", 60, 3.4), position("USDC", 30), position("BONK", 10), position("DUST", 0.004)], 200_000_000n);
  assert.deepEqual(rows.map((row) => row.key), ["SOL", "USDC", "BONK"]);
  assert.equal(rows[0].sharePct, 30, "the share of the whole value — wallet, pools and orders");
  assert.equal(assetRows([position("SOL", 1)], null)[0].sharePct, null, "no value, no share");
  assert.equal(assetRows(Array.from({ length: 9 }, (_, n) => position(`T${n}`, 9 - n)), 45_000_000n).length, 5);
});

test("«Останні операції»: the newest five of the server's history, never the browser's memory", () => {
  const rows = recentOperations([
    action({ actionId: "old", updatedAt: "2026-10-10T00:00:00.000Z" }),
    action({ actionId: "new", updatedAt: "2026-10-18T00:00:00.000Z" }),
    action({ actionId: "mid", updatedAt: "2026-10-15T00:00:00.000Z" }),
  ]);
  assert.deepEqual(rows.map((row) => row.actionId), ["new", "mid", "old"]);
  assert.equal(recentOperations(Array.from({ length: 9 }, () => action({}))).length, 5);
  assert.match(SURFACE, /recentOperations\(actions, wide \? 5 : 3\)/);
  assert.match(SURFACE, /router\.push\(`\/app\/activity\?action=\$\{encodeURIComponent\(row\.actionId\)\}`\)/, "a row opens its receipt in History");
  assert.match(SURFACE, /describeAction\(row, text\)/, "History's own words for an operation");
  assert.doesNotMatch(SURFACE, /receiptRows|lastReceipt|localStorage/, "no receipt from this browser's memory");
});

test("«Потребує уваги»: what waits on the person, most pressing first, three at most; nothing — «Усе спокійно»", () => {
  const items = attentionItems({
    actions: [action({ outcome: "NEEDS_YOU" }), action({ outcome: "NEEDS_YOU" }), action({ outcome: "IN_FLIGHT" }), action({})],
    orders: [order({ state: "PARTIAL" }), order({ venue: "dlmm", state: "FILLED", canClaim: true, baseMint: "BONK" })],
    pools: [
      { pool: "P", address: "A", rangeState: "below" },
      { pool: "Q", address: "B", rangeState: "in_range" },
    ],
    risk: "attention",
  });
  assert.equal(items.length, ATTENTION_ROWS);
  assert.deepEqual(
    items.map((item) => [item.kind, item.count]),
    [
      ["needs-you", 2],
      ["in-flight", 1],
      ["order-claim", 1],
    ],
  );
  assert.equal(items[0].href, "/app/activity?filter=pending");
  assert.equal(items[2].href, "/app/spot?mint=BONK", "a filled order opens its market, where it is taken back");
  const pool = attentionItems({ actions: [], orders: [], pools: [{ pool: "P", address: "A", rangeState: "above" }], risk: null });
  assert.deepEqual(pool, [{ kind: "pool-out", count: 1, href: "/app/markets/pools/P/position/A" }]);
  assert.deepEqual(attentionItems({ actions: [action({})], orders: [order({})], pools: [], risk: "calm" }), []);
  assert.match(SURFACE, /words\.calm/);
  /* Never calm on a read that failed. */
  assert.match(SURFACE, /const attentionUnread = activity\.status === "error" \|\| limits\.status === "failed" \|\| pools\.status === "failed";/);
  assert.match(SURFACE, /items\.length === 0 && unread \? \(\s*<p className=\{home\.sentence\}>\{words\.attentionUnread\}<\/p>/);
});

test("«Відкриті ордери»: waiting orders, newest first; done ones left out; a failed read is named, never an empty list", () => {
  const rows = homeRows(
    [
      order({ key: "partial", state: "PARTIAL", updatedAt: "2026-10-14T00:00:00.000Z" }),
      order({ key: "old", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" }),
      order({ key: "filled", state: "FILLED" }),
      order({ key: "new", side: "sell", inputMint: SOL, outputMint: USDC, makingRaw: "50000000", updatedAt: "2026-10-16T09:00:00.000Z" }),
      order({ key: "cancelled", state: "CANCELLED" }),
    ],
    {},
    [],
  );
  assert.deepEqual(rows.map((row) => row.key), ["order:new", "order:old", "order:partial"]);
  assert.equal(rows[0].baseSymbol, "SOL", "a busy catalogue never turns SOL into «So11…»");
  assert.equal(rows[0].amount, 0.05);
  assert.equal(rows[1].price, 106.14);
  assert.equal(HOME_ROWS_SHOWN, 4);
  assert.deepEqual(ordersView({ status: "failed", complete: true }, "ready", 0).notes, ["orders-unread"]);
  assert.deepEqual(ordersView({ status: "ready", complete: false }, "ready", 1), { loading: false, notes: ["orders-partial"], retry: true });
  assert.match(SURFACE, /title=\{all\.length > 0 \? `\$\{words\.ordersTitle\} · \$\{all\.length\}` : words\.ordersTitle\}/, "the count beside the title");
});

test("the day's change counts only what has a price and a day, and is shown only when that covers most of the value", () => {
  const holding = (dollars, change) => ({ catalog: { usdPrice: String(dollars), dayChangePct: change }, amountRaw: "1", decimals: 0 });
  const covered = dayChangeOf([holding(110, 10)], 110_000_000n);
  assert.ok(covered);
  assert.ok(Math.abs(covered.usd - 10) < 1e-9);
  assert.ok(Math.abs(covered.pct - 10) < 1e-9);
  assert.equal(dayChangeOf([holding(110, 10), holding(110, null)], 220_000_000n), null);
  /* A pool worth as much as the wallet has no day of its own: the change is not claimed for the whole. */
  assert.equal(dayChangeOf([holding(110, 10)], 220_000_000n), null);
  assert.equal(dayChangeOf([], 0n), null);
  /* Home measures the wallet's day against the wallet, and says it is the wallet's when pools or orders stand beside it. */
  assert.match(SURFACE, /dayChangeOf\(holdings, value\.parts\.wallet\)/);
  assert.match(SURFACE, /beyondWallet \? words\.dayChangeWallet : words\.dayChange/);
});

test("the guest's page: one list of markets and Pulse in the main column, the steps and the launches beside them, one orange door", () => {
  const guest = SURFACE.slice(SURFACE.indexOf("function GuestHome"), SURFACE.indexOf("function StartSteps"));
  assert.match(guest, /<Page\s+kind="overview"/);
  assert.match(guest, /aside=\{\s*<>\s*<StartSteps [^>]*className=\{home\.deskOnly\} \/>\s*<LaunchesBlock locale=\{locale\} className=\{home\.deskOnly\} \/>\s*<\/>/, "the side column: the steps and the launches");
  /* DSC-1: «Події ринку» stands where Pulse is, right after it; the launches still come after both below 1280 px. */
  assert.match(guest, /<MarketsNow locale=\{locale\} \/>\s*<Pulse locale=\{locale\} rows=\{wide \? PULSE_ROWS : PULSE_ROWS_PHONE\} \/>\s*(?:\{\s*\}\s*)?<MarketEvents locale=\{locale\} place="home" rows=\{wide \? EVENTS_ROWS : EVENTS_ROWS_PHONE\} \/>\s*<LaunchesBlock locale=\{locale\} className=\{home\.narrowOnly\} \/>/, "Pulse is a block of the page, not behind «Деталі»; below 1280 px the launches come after it");
  assert.doesNotMatch(SURFACE, /MoversBlock/, "«Рухи дня» is a list of «Ринки зараз», not a third table (SOL-C5, UX-103)");
  assert.match(SURFACE, /if \(rows\.length === 0\) return null;/, "an empty or unread «Лаунчі на Ryntra» is no block on Home (UX-104)");
  assert.doesNotMatch(guest, /<Details\b|EmptyState/, "no sentence-and-door page any more");
  assert.match(guest, /<StartStrip [^>]*className=\{home\.narrowOnly\} \/>/, "below 1280 px the steps come first, as a strip");
  assert.match(guest, /action=\{\s*<Button variant="primary" icon="wallet" onClick=\{reach\} lang=\{lang\} className=\{home\.guest\}/, "the page's one orange action, pinned on a phone by the core");
  /* The door reaches the wallet: a phone's browser without one opens the page in Phantom. */
  assert.match(guest, /const door = openInWallet \? words\.openInPhantom : words\.connectWallet;/);
  assert.doesNotMatch(SURFACE.slice(SURFACE.indexOf("function StartSteps"), SURFACE.indexOf("function StartStrip")), /<Button\b/, "the page's action is the first step's door — not a third «Підключити гаманець»");
  assert.match(CSS, /:global\(html\[data-wallet-hint="1"\]\) \.page \.guest:not\(\[data-settled\]\) \{\s*display: none;/, "a returning wallet is never invited to connect");
  assert.match(CSS, /@media \(max-width: 1279px\) \{\s*\.page \.deskOnly \{\s*display: none;/);
  assert.match(CSS, /@media \(min-width: 1280px\) \{\s*\.page \.narrowOnly \{\s*display: none;/);
  assert.match(SURFACE, /fetch\("\/api\/v1\/launch\/markets"/, "the launches the board reads");
  assert.match(SURFACE, /readSearchIndex\(\)/, "the lists Markets and the search read — no second source");
  assert.match(SURFACE, /href=\{tab === "movers" \? "\/app\/markets" : `\/app\/markets\?tab=\$\{tab\}`\}/, "«Переглянути ринки» opens the same list in Markets");
  assert.match(SURFACE, /const tab = chosen \?\? \(market\.index \? \(MARKET_TABS\.find\(/, "an empty list never greets a guest: the first list with markets until one is picked");
});

test("the wallet's page: the value with its parts and four quick actions, assets and operations; attention and orders beside; the markets and Pulse below", () => {
  const wallet = SURFACE.slice(SURFACE.indexOf("function WalletHome"), SURFACE.indexOf("function HomeActionLink"));
  assert.match(wallet, /usePortfolioValue\(owner\)/, "Portfolio's own rule for the number");
  assert.match(wallet, /aside=\{\s*<>\s*\{attentionBlock\(home\.deskOnly\)\}\s*\{ordersBlock\(home\.deskOnly\)\}\s*<\/>/);
  const main = wallet.slice(wallet.indexOf("<ValueBlock"));
  const order = ["<ValueBlock", "attentionBlock(home.narrowOnly)", "<AssetsBlock", "<RecentBlock", "ordersBlock(home.narrowOnly)", "<MarketsNow locale={locale} />", "<Pulse", "<Details"].map((tag) => main.indexOf(tag));
  assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `main column order ${order}`);
  assert.match(wallet, /<Details summary=\{words\.detailsNote\}[^>]*>\s*<PortfolioRisk locale=\{locale\} place="main" \/>\s*<\/Details>/, "only the risk check stays under «Деталі»");
  for (const href of ["/app/top-up", "/app/send", "/app/receive", "/app/swap"]) assert.ok(SURFACE.includes(`<BlockLink href="${href}">`), href);
  assert.match(SURFACE, /action=\{<HomeActionLink action=\{action\} words=\{words\} \/>\}/);
});

test("one orange action per page: the wallet's next step, or the guest's door — never in a block", () => {
  assert.equal((SURFACE.match(/ryntra-button--primary/g) ?? []).length + (SURFACE.match(/variant="primary"/g) ?? []).length, 2);
  assert.doesNotMatch(SURFACE.slice(SURFACE.indexOf("function BlockLink"), SURFACE.indexOf("function RetryButton")), /ryntra-button--primary/, "a block's action is quiet");
  assert.match(SURFACE.slice(SURFACE.indexOf("function RetryButton"), SURFACE.indexOf("function BlockFoot")), /variant="secondary"/);
});

test("a read that failed is never shown as zero: a dash with the reason, or the block's sentence and «Спробувати ще»", () => {
  assert.match(SURFACE, /value=\{value\.phase === "ready" && value\.total !== null \? signedUsd\(value\.total, locale\) : "—"\}/);
  assert.match(SURFACE, /unavailable=\{value\.reason === "unread" \? words\.valueUnread : value\.reason === "partial" \? words\.valuePartial : value\.reason === "unpriced" \? words\.valueUnpriced : undefined\}/);
  assert.match(SURFACE, /value\.reads\[part\] === "loading"\s*\? words\.partReading\s*: value\.reads\[part\] === "failed"\s*\? words\.partUnread/, "a part not read says so, never $0");
  /* A wallet read in part: no number, no shares of it — the parts that were read under the dash, and «Спробувати ще» beside it. */
  assert.match(SURFACE, /total=\{value\.phase === "ready" \? value\.parts\.wallet : null\}/);
  assert.match(SURFACE, /value\.reason === "unread" \|\| value\.reason === "partial" \? <RetryButton/);
  assert.match(SURFACE, /part === "wallet" && value\.reason === "partial" \? "≥ " : ""/);
  assert.ok((SURFACE.match(/<RetryButton\b/g) ?? []).length >= 3, "every block that reads can be asked again");
});

test("Pulse is a section of Home: its heading is the second level, it starts with a few rows, and it shows people's tokens only", () => {
  assert.match(PULSE, /<h2 id=\{ids\.title\} className=\{s\.title\}>/);
  assert.doesNotMatch(PULSE, /<h1\b/);
  assert.match(PULSE, /export function Pulse\(\{ locale, rows: first = PAGE \}/);
  /* Tokens minutes old show their letters, not pictures nobody has looked at. */
  assert.match(PULSE, /plainMark=\{view\.feed === "new" \|\| view\.feed === "soon"\}/);
  assert.match(PULSE, /icon=\{plainMark \|\| row\.ryntra !== null \? null : row\.icon\}/);
  assert.match(SURFACE, /<MarketIcon mint=\{row\.key\} icon=\{null\} symbol=\{row\.symbol\} size=\{28\} \/>/, "launches on Home: letters until a launch's image is checked");
  assert.match(PULSE, /\.filter\(\(row\) => !row\.ryntra\?\.technicalValidation && !isOffensiveName\(row\.name, row\.symbol\)\)/, "the team's technical validations are not on Home's feed");
  /* SOL-C5: four feeds — the movers are a list of «Ринки зараз»; the risk count is the row's flags, the card's risks with them. */
  assert.match(PULSE, /const HOME_FEEDS: readonly HomeFeed\[\] = \["new", "soon", "dex", "trending"\];/);
  assert.match(PULSE, /const flags = pulseFlagsOf\(row, now\);/);
  assert.match(PULSE, /\{level === "unread" \? "\?" : level === 0 \? "0" : \(/, "a figure nobody stated and no flag: «?», never «0»");
  assert.match(PULSE, /\{unstated\.length > 0 \? <span className=\{s\.riskUnread\}>\?<\/span> : null\}/, "flags with a figure nobody stated: the count and «?» apart from it");
  assert.match(PULSE, /\{borrowed \? \(\s*<span className=\{s\.borrowed\}/, "a borrowed name is marked in the row");
  assert.match(PULSE, /\{twins > 0 \? \(\s*<span className=\{s\.twin\}/, "copies of one name show their own address");
  assert.match(PULSE, /const quick = row\.ryntra === null \? row\.price !== null && row\.liquidityUsd !== null : row\.ryntra\.dollarPair;/, "no quick sum where there is no price or no stated pool (UX-165); a launch on Ryntra keeps its own");
});

test("both languages say everything, and the door is «Підключити гаманець»", () => {
  const en = homeWords("en");
  const uk = homeWords("uk");
  const keys = (words) => Object.keys(words).sort();
  assert.deepEqual(keys(uk), keys(en));
  for (const group of ["tabs", "parts", "quick", "attention"]) assert.deepEqual(Object.keys(uk[group]).sort(), Object.keys(en[group]).sort(), group);
  assert.equal(uk.steps.length, 3);
  assert.equal(en.steps.length, 3);
  assert.equal(uk.connectWallet, "Підключити гаманець");
  assert.equal(en.connectWallet, "Connect wallet");
  assert.deepEqual([1, 3, 56].map(uk.unpriced), ["1 актив без ціни", "3 активи без ціни", "56 активів без ціни"]);
  assert.deepEqual([1, 2, 5].map(uk.attention["needs-you"]), ["Операція чекає на тебе", "2 операції чекають на тебе", "5 операцій чекають на тебе"]);
  assert.equal(en.attention["in-flight"](3), "3 operations are on their way");
  /* Every Ukrainian word is Ukrainian: Cyrillic, save the names that stay as they are. */
  const NAMES = /Phantom|Phoenix|SOL|USDC|Ryntra|Solana|Jupiter|DEX/g;
  const lines = (value) => (typeof value === "string" ? [value] : typeof value === "function" ? [1, 3, 56].map((n) => String(value(n))) : Object.values(value).flatMap(lines));
  for (const [key, value] of Object.entries(uk)) for (const line of lines(value)) assert.doesNotMatch(line.replace(NAMES, ""), /[A-Za-z]/, `«${key}» is Ukrainian`);
  /* «ти», never «Ви», in what Home says. */
  for (const [key, value] of Object.entries(uk)) for (const line of lines(value)) assert.doesNotMatch(line, /(^|\s)(Ви|ви|Ваш|ваш)(\s|$)|Підключіть|Під'єднай/u, key);
  /* One sentence: every empty or failed block's. */
  for (const words of [en, uk]) for (const key of ["attentionUnread", "marketsUnread", "marketsEmpty", "moversQuiet", "assetsNone", "assetsUnread", "recentNone", "recentUnread", "ordersNone", "ordersUnread", "valueUnread", "valuePartial", "valueUnpriced", "calm"]) assert.equal(words[key].split(/[.!?](\s|$)/).filter((part) => part && part.trim()).length, 1, key);
});
